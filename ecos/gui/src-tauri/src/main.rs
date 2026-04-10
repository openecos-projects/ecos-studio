#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod gen_layout_tiles;

#[cfg(not(debug_assertions))]
use std::io::IsTerminal;
use std::net::TcpListener;
use std::process::{Child, Command, Stdio};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::Duration;
use tauri::Manager;
use tauri_plugin_fs::FsExt;
use log::{info, warn, error, debug};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

/// Returns true when the process was launched from an interactive terminal
/// (i.e. stderr is a TTY). False when launched from a desktop file / launcher.
#[cfg(not(debug_assertions))]
fn is_launched_from_terminal() -> bool {
    std::io::stderr().is_terminal()
}

/// Drain a child's stdout or stderr pipe in a background thread to prevent
/// the child from blocking when the OS pipe buffer fills up.
#[cfg(not(debug_assertions))]
fn drain_pipe(reader: impl std::io::Read + Send + 'static) {
    use std::io::{BufRead, BufReader};
    thread::spawn(move || {
        let reader = BufReader::new(reader);
        for line in reader.lines() {
            if line.is_err() {
                break;
            }
        }
    });
}

// Global reference to the FastAPI server process
type ApiServerProcess = Arc<Mutex<Option<Child>>>;

/// Shared state for the actual API port in use (may differ from DEFAULT_API_PORT)
type ActualApiPort = Arc<Mutex<u16>>;

/// Default API server port (used as starting point for dynamic port discovery)
const DEFAULT_API_PORT: u16 = 8765;

/// How many ports to scan beyond the default before giving up
const PORT_SEARCH_RANGE: u16 = 100;

/// Result of attempting to start the API server
enum ApiStartResult {
    /// A new child process was successfully spawned on the given port
    Started(Child, u16),
    /// A healthy external server was detected on the given port (e.g. VS Code debugger)
    ExternalDetected(u16),
    /// Failed to start or detect a server
    Failed,
}

/// Check if a port is available
fn is_port_available(port: u16) -> bool {
    TcpListener::bind(format!("127.0.0.1:{}", port)).is_ok()
}

/// Kill process using a specific port (platform-specific)
fn kill_process_on_port(port: u16) -> bool {
    #[cfg(target_os = "windows")]
    {
        // Windows: use netstat + taskkill
        let output = Command::new("cmd")
            .args(["/C", &format!(
                "for /f \"tokens=5\" %a in ('netstat -ano ^| findstr :{} ^| findstr LISTENING') do taskkill /F /PID %a",
                port
            )])
            .output();

        match output {
            Ok(out) => {
                if out.status.success() {
                    info!("Killed process on port {}", port);
                    true
                } else {
                    warn!("Could not kill process on port {}", port);
                    false
                }
            }
            Err(e) => {
                error!("Failed to execute kill command: {}", e);
                false
            }
        }
    }

    #[cfg(unix)]
    {
        // Unix (macOS/Linux): use lsof + kill
        let lsof_output = Command::new("lsof")
            .args(["-ti", &format!(":{}", port)])
            .output();

        match lsof_output {
            Ok(out) => {
                let pid_str = String::from_utf8_lossy(&out.stdout);
                let pids: Vec<&str> = pid_str
                    .trim()
                    .split('\n')
                    .filter(|s| !s.is_empty())
                    .collect();

                if pids.is_empty() {
                    debug!("No process found on port {}", port);
                    return true;
                }

                let mut all_killed = true;
                for pid in pids {
                    info!("Found process {} on port {}, killing...", pid, port);
                    let kill_result = Command::new("kill").args(["-9", pid]).output();

                    match kill_result {
                        Ok(kill_out) => {
                            if kill_out.status.success() {
                                info!("Killed process {} on port {}", pid, port);
                            } else {
                                warn!("Failed to kill process {}", pid);
                                all_killed = false;
                            }
                        }
                        Err(e) => {
                            error!("Failed to execute kill command: {}", e);
                            all_killed = false;
                        }
                    }
                }
                all_killed
            }
            Err(e) => {
                error!("Failed to execute lsof: {}", e);
                false
            }
        }
    }
}

/// Find an available port, starting from the preferred port.
/// Returns the first available port, or None if no port could be found.
fn find_available_port(preferred: u16) -> Option<u16> {
    // Try the preferred port first
    if is_port_available(preferred) {
        return Some(preferred);
    }

    warn!(
        "Preferred port {} is in use, scanning for available port...",
        preferred
    );

    // Scan a range of ports after the preferred one
    for offset in 1..=PORT_SEARCH_RANGE {
        if let Some(port) = preferred.checked_add(offset) {
            if is_port_available(port) {
                info!("Found available port: {}", port);
                return Some(port);
            }
        }
    }

    error!(
        "Could not find any available port in range {}-{}",
        preferred,
        preferred.saturating_add(PORT_SEARCH_RANGE)
    );
    None
}

/// Get candidate binary names for api-server.
/// Prefer target-suffixed names, but also support unsuffixed names from bundled artifacts.
#[cfg(not(debug_assertions))]
fn get_api_server_binary_candidates() -> Vec<String> {
    let target = env!("TARGET");

    #[cfg(target_os = "windows")]
    {
        vec![
            format!("api-server-{}.exe", target),
            "api-server.exe".to_string(),
        ]
    }
    #[cfg(not(target_os = "windows"))]
    {
        vec![format!("api-server-{}", target), "api-server".to_string()]
    }
}

/// Check if a healthy FastAPI server is already running on the given port
fn is_api_server_healthy(port: u16) -> bool {
    let health_url = format!("http://127.0.0.1:{}/health", port);
    ureq::get(&health_url)
        .timeout(Duration::from_secs(2))
        .call()
        .map(|r| r.status() == 200u16)
        .unwrap_or(false)
}

/// Wait for the API server to become healthy, with exponential backoff.
///
/// Starts polling at 100ms intervals, increasing by 1.5x each attempt up to 1000ms.
/// Total timeout is approximately `timeout_secs` seconds.
fn wait_for_server_ready(port: u16, timeout_secs: u64) -> bool {
    use std::time::Instant;

    info!("Waiting for FastAPI server to be ready on port {}...", port);
    let start = Instant::now();
    let deadline = Duration::from_secs(timeout_secs);
    let mut delay_ms: u64 = 100;
    let mut attempt: u32 = 0;

    while start.elapsed() < deadline {
        attempt += 1;
        thread::sleep(Duration::from_millis(delay_ms));

        let addr: std::net::SocketAddr = format!("127.0.0.1:{}", port).parse().unwrap();
        if std::net::TcpStream::connect_timeout(&addr, Duration::from_millis(200)).is_ok()
            && is_api_server_healthy(port)
        {
            info!(
                "FastAPI server ready on port {} after {} attempts ({:.1}s)",
                port,
                attempt,
                start.elapsed().as_secs_f32()
            );
            return true;
        }

        if start.elapsed().as_secs() >= 4 && attempt.is_multiple_of(3) {
            debug!(
                "Still waiting for server on port {}... ({:.1}s elapsed)",
                port,
                start.elapsed().as_secs_f32()
            );
        }

        delay_ms = (delay_ms * 3 / 2).min(1000);
    }
    false
}

/// Start the FastAPI server process
/// In debug mode: runs Python script directly
/// In release mode: runs the bundled executable
#[cfg(not(debug_assertions))]
fn get_oss_cad_dir(app_handle: &tauri::AppHandle) -> Option<std::path::PathBuf> {
    app_handle
        .path()
        .resource_dir()
        .ok()
        .map(|resource_dir| resource_dir.join("resources").join("oss-cad-suite"))
        .filter(|path| path.exists())
}

fn start_api_server(
    #[cfg(debug_assertions)] _app_handle: &tauri::AppHandle,
    #[cfg(not(debug_assertions))] app_handle: &tauri::AppHandle,
) -> ApiStartResult {
    use std::path::PathBuf;

    // Check if a healthy API server is already running on the default port.
    //
    // On shared remote servers another user's ChipCompiler instance may occupy
    // the same port.  Blindly reusing it would connect this GUI to someone
    // else's backend — a serious bug.
    //
    // Therefore, auto-reuse is **off by default**.  Developers who manually start
    // the API server for debugging can opt in by setting:
    //     ECOS_REUSE_API_SERVER=1
    if !is_port_available(DEFAULT_API_PORT) && is_api_server_healthy(DEFAULT_API_PORT) {
        let reuse = std::env::var("ECOS_REUSE_API_SERVER")
            .unwrap_or_default()
            == "1";
        if reuse {
            info!(
                "Healthy API server on port {} and ECOS_REUSE_API_SERVER=1, reusing it",
                DEFAULT_API_PORT
            );
            return ApiStartResult::ExternalDetected(DEFAULT_API_PORT);
        }
        warn!(
            "Port {} has a healthy API server but ECOS_REUSE_API_SERVER is not set - \
             will start on a different port (set ECOS_REUSE_API_SERVER=1 to reuse)",
            DEFAULT_API_PORT
        );
    }

    // Find an available port (starting from the default)
    let port = match find_available_port(DEFAULT_API_PORT) {
        Some(p) => p,
        None => {
            error!(
                "Cannot start API server: no available port found (tried {} - {})",
                DEFAULT_API_PORT,
                DEFAULT_API_PORT + PORT_SEARCH_RANGE
            );
            return ApiStartResult::Failed;
        }
    };

    if port != DEFAULT_API_PORT {
        info!(
            "Using alternative port {} (default port {} was occupied)",
            port, DEFAULT_API_PORT
        );
    }

    #[cfg(debug_assertions)]
    {
        // Development mode: use Python script with virtual environment
        // Server lives at ecos/server/ (sibling of ecos/gui/)
        let server_dir = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("..")
            .join("..")
            .join("server");
        let server_script = server_dir.join("run_server.py");

        // Use venv Python from ecos/server/.venv if available
        #[cfg(target_os = "windows")]
        let venv_python = server_dir.join(".venv").join("Scripts").join("python.exe");
        #[cfg(not(target_os = "windows"))]
        let venv_python = server_dir.join(".venv").join("bin").join("python3");

        let interpreter = if venv_python.exists() {
            debug!("Using venv Python: {:?}", venv_python);
            venv_python.to_string_lossy().to_string()
        } else {
            debug!("Venv not found at {:?}, using system Python", venv_python);
            #[cfg(target_os = "windows")]
            {
                "python".to_string()
            }
            #[cfg(not(target_os = "windows"))]
            {
                "python3".to_string()
            }
        };

        info!(
            "Starting FastAPI server (dev mode) from: {:?} on port {}",
            server_script, port
        );

        let mut cmd = Command::new(&interpreter);
        cmd.arg(&server_script)
            .arg("--host")
            .arg("127.0.0.1")
            .arg("--port")
            .arg(port.to_string())
            .arg("--reload")
            .arg("--reload-dir")
            .arg(server_dir.to_string_lossy().to_string())
            .arg("--disable-stdio-redirect")
            .stdout(Stdio::inherit())
            .stderr(Stdio::inherit())
            .current_dir(&server_dir);

        match cmd.spawn() {
            Ok(child) => {
                info!(
                    "FastAPI server started with PID: {} on port {}",
                    child.id(),
                    port
                );
                ApiStartResult::Started(child, port)
            }
            Err(e) => {
                error!("Failed to start FastAPI server: {}", e);
                ApiStartResult::Failed
            }
        }
    }

    #[cfg(not(debug_assertions))]
    {
        // Production mode: use bundled executable
        // Tauri's externalBin places binaries in the same directory as the main executable

        let binary_candidates = get_api_server_binary_candidates();
        let mut checked_paths: Vec<std::path::PathBuf> = Vec::new();
        let mut server_binary: Option<PathBuf> = None;

        for binary_name in &binary_candidates {
            let possible_paths = get_possible_binary_paths(app_handle, binary_name);
            for path in possible_paths {
                debug!("Checking for api-server at: {:?}", path);
                checked_paths.push(path.clone());
                if path.exists() {
                    server_binary = Some(path);
                    break;
                }
            }
            if server_binary.is_some() {
                break;
            }
        }

        let server_binary = match server_binary {
            Some(path) => path,
            None => {
                error!("API server binary not found. Checked locations:");
                let mut seen = std::collections::HashSet::new();
                for path in checked_paths {
                    if seen.insert(path.clone()) {
                        error!("   - {:?}", path);
                    }
                }
                return ApiStartResult::Failed;
            }
        };

        let launched_from_terminal = is_launched_from_terminal();

        info!(
            "Starting FastAPI server (prod mode) from: {:?} on port {} (terminal: {})",
            server_binary, port, launched_from_terminal
        );

        let mut cmd = Command::new(&server_binary);

        if let Some(oss_dir) = get_oss_cad_dir(app_handle) {
            debug!("Setting CHIPCOMPILER_OSS_CAD_DIR to {:?}", oss_dir);
            cmd.env("CHIPCOMPILER_OSS_CAD_DIR", &oss_dir);
        } else {
            warn!("Expected oss-cad-suite at <resource_dir>/resources/oss-cad-suite, but it was not found.");
            warn!("Synthesis may fail if yosys is unavailable in PATH.");
        }

        cmd.arg("--host")
            .arg("127.0.0.1")
            .arg("--port")
            .arg(port.to_string())
            .arg("--disable-stdio-redirect");

        if launched_from_terminal {
            info!("Server output -> terminal (stdio)");
        } else {
            info!("Server output -> discarded (desktop mode, no terminal)");
        }
        info!("Workspace logs will be saved to <workspace>/log/ when a project is opened");

        if launched_from_terminal {
            cmd.stdout(Stdio::inherit()).stderr(Stdio::inherit());
        } else {
            cmd.stdout(Stdio::piped()).stderr(Stdio::piped());
        }

        match cmd.spawn() {
            Ok(mut child) => {
                info!(
                    "FastAPI server started with PID: {} on port {}",
                    child.id(),
                    port
                );
                if !launched_from_terminal {
                    if let Some(stdout) = child.stdout.take() { drain_pipe(stdout); }
                    if let Some(stderr) = child.stderr.take() { drain_pipe(stderr); }
                }
                ApiStartResult::Started(child, port)
            }
            Err(e) => {
                error!("Failed to start FastAPI server: {}", e);
                error!("   Binary path: {:?}", server_binary);
                error!("   Error details: {:?}", e.kind());
                ApiStartResult::Failed
            }
        }
    }
}

/// Get possible paths where the api-server binary might be located
/// This handles differences between macOS, Linux, and Windows
#[cfg(not(debug_assertions))]
fn get_possible_binary_paths(
    app_handle: &tauri::AppHandle,
    binary_name: &str,
) -> Vec<std::path::PathBuf> {
    let mut paths = Vec::new();

    // Method 1: Next to the current executable (works for bundled apps on Linux and Windows)
    if let Ok(exe_path) = std::env::current_exe() {
        if let Some(exe_dir) = exe_path.parent() {
            paths.push(exe_dir.join(binary_name));

            // Also check in binaries subdirectory next to executable
            paths.push(exe_dir.join("binaries").join(binary_name));

            // Method 1b: For running directly from target/release, look in src-tauri/binaries
            // exe is at: src-tauri/target/release/ecc-client
            // binary is at: src-tauri/binaries/api-server-xxx
            if let Some(target_dir) = exe_dir.parent() {
                // target
                if let Some(src_tauri_dir) = target_dir.parent() {
                    // src-tauri
                    paths.push(src_tauri_dir.join("binaries").join(binary_name));
                }
            }
        }
    }

    // Method 2: Using Tauri's resource_dir (may work for some setups)
    if let Ok(resource_dir) = app_handle.path().resource_dir() {
        // Direct in resource dir
        paths.push(resource_dir.join(binary_name));
        // In binaries subdirectory
        paths.push(resource_dir.join("binaries").join(binary_name));
    }

    // Method 3: macOS specific - inside the .app bundle
    #[cfg(target_os = "macos")]
    {
        if let Ok(exe_path) = std::env::current_exe() {
            // exe_path is typically: ECC.app/Contents/MacOS/ECC
            // Binary should be at: ECC.app/Contents/MacOS/api-server-xxx
            if let Some(macos_dir) = exe_path.parent() {
                paths.push(macos_dir.join(binary_name));

                // Also check Resources directory
                if let Some(contents_dir) = macos_dir.parent() {
                    paths.push(contents_dir.join("Resources").join(binary_name));
                    paths.push(
                        contents_dir
                            .join("Resources")
                            .join("binaries")
                            .join(binary_name),
                    );
                }
            }
        }
    }

    // Remove duplicates while preserving order
    let mut seen = std::collections::HashSet::new();
    paths.retain(|p| seen.insert(p.clone()));

    paths
}

/// Stop the FastAPI server process and clean up any orphaned children.
///
/// `port` is the actual port the server was started on (may differ from DEFAULT_API_PORT).
///
/// When `process` is `None` (external/debugger mode), this is a no-op —
/// the external server is intentionally left running.
fn stop_api_server(process: &mut Option<Child>, port: u16) {
    if let Some(ref mut child) = process {
        let pid = child.id();
        info!("Stopping FastAPI server (PID: {}, port: {})...", pid, port);

        // On Unix, kill the entire process group so that child workers
        // (e.g. uvicorn reloader/workers spawned by `--reload`) are also
        // terminated.  We send SIGTERM first for graceful shutdown.
        #[cfg(unix)]
        {
            // Negative PID = kill the whole process group
            let pgid_kill = Command::new("kill")
                .args(["--", &format!("-{}", pid)])
                .output();
            match pgid_kill {
                Ok(out) if out.status.success() => {
                    info!("Sent SIGTERM to process group -{}", pid);
                }
                _ => {
                    // Process group kill failed; fall back to single-process kill
                    let _ = Command::new("kill").args([&pid.to_string()]).output();
                }
            }
            // Brief grace period for graceful shutdown
            thread::sleep(Duration::from_millis(500));
        }

        // Force-kill the direct child (SIGKILL on Unix, TerminateProcess on Windows)
        match child.kill() {
            Ok(_) => info!("FastAPI server process killed"),
            Err(e) => {
                // "InvalidInput" / "not running" is fine — process already exited
                warn!("child.kill(): {} (process may have already exited)", e);
            }
        }

        // Reap the zombie so it doesn't linger in the process table
        let _ = child.wait();
        *process = None;

        // Safety net: if orphaned workers survived the group kill, clean them
        // up via port-based lookup (lsof + kill) so the port is free on next start.
        thread::sleep(Duration::from_millis(300));
        if !is_port_available(port) {
            warn!("Port {} still occupied after stopping server, cleaning up orphaned processes...", port);
            kill_process_on_port(port);
            thread::sleep(Duration::from_millis(300));
        }

        if is_port_available(port) {
            info!("Port {} is now free", port);
        } else {
            error!("Port {} is still occupied after cleanup", port);
        }
    }
}

/// 窗口最小化
#[tauri::command]
fn window_minimize(window: tauri::Window) {
    debug!("cmd=window_minimize window={}", window.label());
    let _ = window.minimize();
}

/// 窗口最大化/还原
#[tauri::command]
fn window_maximize(window: tauri::Window) {
    let is_maximized = window.is_maximized().unwrap_or(false);
    debug!("cmd=window_maximize window={} action={}", window.label(), if is_maximized { "unmaximize" } else { "maximize" });
    if is_maximized {
        let _ = window.unmaximize();
    } else {
        let _ = window.maximize();
    }
}

/// 窗口关闭
#[tauri::command]
fn window_close(window: tauri::Window) {
    debug!("cmd=window_close window={}", window.label());
    let _ = window.close();
}

/// 获取 API 服务器状态
#[tauri::command]
fn get_api_server_status(port_state: tauri::State<'_, ActualApiPort>) -> serde_json::Value {
    let port = *port_state.lock().unwrap();
    debug!("cmd=get_api_server_status port={}", port);
    let port_available = is_port_available(port);
    let server_running = !port_available; // If port is not available, server might be running

    // Try to check health endpoint
    let health_ok = if server_running {
        is_api_server_healthy(port)
    } else {
        false
    };

    serde_json::json!({
        "port": port,
        "default_port": DEFAULT_API_PORT,
        "port_available": port_available,
        "server_running": server_running,
        "health_ok": health_ok
    })
}

/// 重启 API 服务器
#[tauri::command]
fn restart_api_server(
    app: tauri::AppHandle,
    state: tauri::State<'_, ApiServerProcess>,
    port_state: tauri::State<'_, ActualApiPort>,
) -> Result<String, String> {
    let current_port = *port_state.lock().map_err(|e| format!("Lock error: {}", e))?;
    let has_server = state.lock().map_err(|e| format!("Lock error: {}", e))?.is_some();
    info!("cmd=restart_api_server current_port={} has_server={}", current_port, has_server);
    let mut server = state.lock().map_err(|e| format!("Lock error: {}", e))?;

    // Stop our managed child process (if any).
    // External servers (e.g. VS Code debugger) are `None` and won't be touched.
    if server.is_some() {
        let current_port = *port_state
            .lock()
            .map_err(|e| format!("Lock error: {}", e))?;
        stop_api_server(&mut server, current_port);
    }

    // Start fresh — port discovery, external detection, etc. handled internally
    match start_api_server(&app) {
        ApiStartResult::Started(child, port) => {
            *server = Some(child);
            *port_state
                .lock()
                .map_err(|e| format!("Lock error: {}", e))? = port;
            Ok(format!("API server restarted on port {}", port))
        }
        ApiStartResult::ExternalDetected(port) => {
            *server = None;
            *port_state
                .lock()
                .map_err(|e| format!("Lock error: {}", e))? = port;
            Ok(format!(
                "External API server detected on port {}, reusing it",
                port
            ))
        }
        ApiStartResult::Failed => {
            *server = None;
            Err("Failed to start API server".to_string())
        }
    }
}

/// Forcefully clean up processes on a port
#[tauri::command]
fn kill_port_process(port_state: tauri::State<'_, ActualApiPort>) -> Result<String, String> {
    let port = *port_state
        .lock()
        .map_err(|e| format!("Lock error: {}", e))?;
    info!("cmd=kill_port_process port={}", port);

    if is_port_available(port) {
        return Ok(format!("Port {} is already available", port));
    }

    if kill_process_on_port(port) {
        thread::sleep(Duration::from_millis(300));
        if is_port_available(port) {
            return Ok(format!("Successfully killed process on port {}", port));
        }
    }

    Err(format!("Could not free port {}", port))
}

/// Get debug information (for diagnosing production issues)
#[tauri::command]
fn get_debug_info(
    app: tauri::AppHandle,
    port_state: tauri::State<'_, ActualApiPort>,
) -> serde_json::Value {
    let port = *port_state.lock().unwrap();
    debug!("cmd=get_debug_info port={} is_debug={}", port, cfg!(debug_assertions));

    let mut info = serde_json::json!({
        "api_port": port,
        "default_api_port": DEFAULT_API_PORT,
        "port_available": is_port_available(port),
        "is_debug_build": cfg!(debug_assertions),
    });

    // Get executable path
    if let Ok(exe_path) = std::env::current_exe() {
        info["exe_path"] = serde_json::json!(exe_path.to_string_lossy());
        if let Some(exe_dir) = exe_path.parent() {
            info["exe_dir"] = serde_json::json!(exe_dir.to_string_lossy());
        }
    }

    // Get resource directory
    if let Ok(resource_dir) = app.path().resource_dir() {
        info["resource_dir"] = serde_json::json!(resource_dir.to_string_lossy());
    }

    // Check for API server binary in production mode
    #[cfg(not(debug_assertions))]
    {
        let binary_candidates = get_api_server_binary_candidates();
        info["api_binary_name"] = serde_json::json!(binary_candidates);

        let possible_paths: Vec<std::path::PathBuf> = binary_candidates
            .iter()
            .flat_map(|binary_name| get_possible_binary_paths(&app, binary_name))
            .collect();

        let mut seen = std::collections::HashSet::new();
        let possible_paths: Vec<std::path::PathBuf> = possible_paths
            .into_iter()
            .filter(|p| seen.insert(p.clone()))
            .collect();
        let path_status: Vec<serde_json::Value> = possible_paths
            .iter()
            .map(|p| {
                serde_json::json!({
                    "path": p.to_string_lossy(),
                    "exists": p.exists(),
                    "is_file": p.is_file(),
                })
            })
            .collect();
        info["api_binary_paths"] = serde_json::json!(path_status);
    }

    // Check health endpoint
    let health_ok = is_api_server_healthy(port);
    info["health_ok"] = serde_json::json!(health_ok);

    info
}

#[tauri::command]
fn get_api_port(port_state: tauri::State<'_, ActualApiPort>) -> u16 {
    let port = *port_state.lock().unwrap();
    debug!("cmd=get_api_port port={}", port);
    port
}

#[tauri::command]
async fn request_project_permission(app: tauri::AppHandle, path: String) -> Result<(), String> {
    use std::path::PathBuf;

    info!("cmd=request_project_permission path={}", path);
    let scope = app.fs_scope();
    let path_buf = PathBuf::from(&path);

    scope
        .allow_directory(&path_buf, true)
        .map_err(|e| format!("Unable to grant file system access permissions {}: {}", path_buf.display(), e))?;
    Ok(())
}

fn sanitize_step_key(raw: &str) -> String {
    let mapped: String = raw
        .trim()
        .chars()
        .map(|c| {
            if c.is_ascii_alphanumeric() || c == '.' || c == '_' || c == '-' {
                c
            } else {
                '_'
            }
        })
        .collect();
    let mut collapsed = String::new();
    let mut prev_us = false;
    for c in mapped.chars() {
        if c == '_' {
            if !prev_us {
                collapsed.push('_');
            }
            prev_us = true;
        } else {
            collapsed.push(c);
            prev_us = false;
        }
    }
    let s = collapsed.trim_matches('_');
    if s.is_empty() {
        "_default".to_string()
    } else {
        s.to_string()
    }
}

fn sha256_hex_file(path: &std::path::Path) -> Result<String, String> {
    let bytes =
        std::fs::read(path).map_err(|e| format!("read layout json {}: {}", path.display(), e))?;
    let digest = Sha256::digest(&bytes);
    Ok(digest.iter().map(|b| format!("{:02x}", b)).collect())
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct TileCacheMeta {
    layout_json_path: String,
    content_sha256: String,
    generated_at: String,
}

/// 准备按步骤划分的瓦片缓存目录：计算布局 JSON 内容 SHA-256，若与 `tile-cache.meta.json` 一致且已有 `manifest.json` 则跳过生成。
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct PrepareLayoutTileCachePayload {
    project_path: String,
    step_key: String,
    layout_json_path: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct PrepareLayoutTileCacheResult {
    out_dir: String,
    from_cache: bool,
    content_sha256: String,
}

#[tauri::command]
async fn prepare_layout_tile_cache(
    app: tauri::AppHandle,
    payload: PrepareLayoutTileCachePayload,
) -> Result<PrepareLayoutTileCacheResult, String> {
    use std::path::PathBuf;

    let project_path = payload.project_path;
    let step = sanitize_step_key(&payload.step_key);
    let layout_json = PathBuf::from(&payload.layout_json_path);

    info!(
        "cmd=prepare_layout_tile_cache project_path={} step_key={} layout_json={}",
        project_path,
        step,
        layout_json.display()
    );

    if !layout_json.is_file() {
        return Err(format!("布局 JSON 不存在: {}", layout_json.display()));
    }

    let content_sha256 = sha256_hex_file(&layout_json)?;

    let base = PathBuf::from(&project_path);
    let out = base
        .join(".ecos")
        .join("tile-cache")
        .join("layout")
        .join(&step);

    let meta_path = out.join("tile-cache.meta.json");
    let manifest_path = out.join("manifest.json");

    let cache_hit = if meta_path.is_file() && manifest_path.is_file() {
        let raw = std::fs::read_to_string(&meta_path)
            .map_err(|e| format!("read {}: {}", meta_path.display(), e))?;
        let meta: TileCacheMeta = serde_json::from_str(&raw).map_err(|e| {
            format!(
                "parse {}: {}",
                meta_path.display(),
                e
            )
        })?;
        meta.content_sha256 == content_sha256
    } else {
        false
    };

    if !cache_hit {
        if out.exists() {
            std::fs::remove_dir_all(&out)
                .map_err(|e| format!("remove_dir_all {}: {}", out.display(), e))?;
        }
        std::fs::create_dir_all(&out)
            .map_err(|e| format!("create_dir_all {}: {}", out.display(), e))?;
    } else {
        std::fs::create_dir_all(&out)
            .map_err(|e| format!("create_dir_all {}: {}", out.display(), e))?;
    }

    let canonical = out.canonicalize().unwrap_or_else(|_| out.clone());

    let scope = app.fs_scope();
    scope
        .allow_directory(&canonical, true)
        .map_err(|e| format!("fs_scope allow_directory {}: {}", canonical.display(), e))?;

    Ok(PrepareLayoutTileCacheResult {
        out_dir: canonical.to_string_lossy().into_owned(),
        from_cache: cache_hit,
        content_sha256,
    })
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct FinalizeLayoutTileCacheMetaPayload {
    out_dir: String,
    layout_json_path: String,
    content_sha256: String,
}

/// 在瓦片生成成功写入输出目录后调用，持久化缓存指纹。
#[tauri::command]
async fn finalize_layout_tile_cache_meta(
    payload: FinalizeLayoutTileCacheMetaPayload,
) -> Result<(), String> {
    use std::path::PathBuf;

    let out = PathBuf::from(&payload.out_dir);
    let meta_path = out.join("tile-cache.meta.json");
    let meta = TileCacheMeta {
        layout_json_path: payload.layout_json_path.clone(),
        content_sha256: payload.content_sha256,
        generated_at: chrono::Utc::now().to_rfc3339(),
    };
    let json = serde_json::to_string_pretty(&meta).map_err(|e| e.to_string())?;
    std::fs::write(&meta_path, json)
        .map_err(|e| format!("write {}: {}", meta_path.display(), e))?;
    info!("cmd=finalize_layout_tile_cache_meta path={}", meta_path.display());
    Ok(())
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct GenerateLayoutTilesPayload {
    layout_json_path: String,
    out_dir: String,
}

/// 从布局 JSON 生成瓦片目录。
#[tauri::command]
async fn generate_layout_tiles(payload: GenerateLayoutTilesPayload) -> Result<(), String> {
    use std::path::PathBuf;

    let layout = PathBuf::from(payload.layout_json_path);
    let out = PathBuf::from(payload.out_dir);
    tauri::async_runtime::spawn_blocking(move || gen_layout_tiles::generate(&layout, &out))
        .await
        .map_err(|e| e.to_string())?
}

fn main() {
    use std::path::PathBuf;

    // Default to warnings in production while still honoring RUST_LOG overrides.
    env_logger::Builder::from_env(
        env_logger::Env::default().default_filter_or("warn")
    ).init();

    // Shared state for the API server process and discovered port
    let api_server: ApiServerProcess = Arc::new(Mutex::new(None));
    let api_port: ActualApiPort = Arc::new(Mutex::new(DEFAULT_API_PORT));

    tauri::Builder::default()
        .manage(api_server.clone())
        .manage(api_port.clone())
        .plugin(tauri_plugin_store::Builder::new().build())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .setup({
            let api_server = api_server.clone();
            let api_port = api_port.clone();
            move |app| {
                let window = app.get_webview_window("main").unwrap();

                // Start the FastAPI server (or detect an externally started one)
                let (using_external_server, actual_port) = {
                    let mut server = api_server.lock().unwrap();
                    match start_api_server(app.handle()) {
                        ApiStartResult::Started(child, port) => {
                            *server = Some(child);
                            *api_port.lock().unwrap() = port;
                            (false, port)
                        }
                        ApiStartResult::ExternalDetected(port) => {
                            *server = None;
                            *api_port.lock().unwrap() = port;
                            (true, port)
                        }
                        ApiStartResult::Failed => {
                            *server = None;
                            *api_port.lock().unwrap() = DEFAULT_API_PORT;
                            warn!(
                                "No API server available — GUI may not function correctly"
                            );
                            (false, DEFAULT_API_PORT)
                        }
                    }
                };

                // Wait for the server in the background so the webview can start
                // loading immediately (splash screen visible sooner).
                thread::spawn(move || {
                    if using_external_server {
                        info!(
                            "Using externally started API server (debugger mode) on port {}",
                            actual_port
                        );
                    }
                    if !wait_for_server_ready(actual_port, 15) {
                        warn!("FastAPI server may not be fully ready after 15s");
                    }
                });

                // Grant fs scope for the built-in data directory (demo data)
                let mut data_path = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
                data_path.push("..");
                data_path.push("data");
                if data_path.exists() {
                    let final_path = data_path.canonicalize().unwrap_or(data_path.clone());
                    let scope = app.fs_scope();
                    match scope.allow_directory(&final_path, true) {
                        Ok(()) => info!("Granted fs scope: {:?}", final_path),
                        Err(e) => error!("Failed to grant fs scope: {}", e),
                    }
                }

                #[cfg(debug_assertions)]
                {
                    let scale_factor = window.scale_factor().unwrap_or(1.0);
                    if let Ok(size) = window.inner_size() {
                        debug!("=== Window Debug Info ===");
                        debug!(
                            "Logical size: {}x{}",
                            size.width as f64 / scale_factor,
                            size.height as f64 / scale_factor
                        );
                    }
                }

                Ok(())
            }
        })
        .on_page_load(|webview, payload| {
            if matches!(payload.event(), tauri::webview::PageLoadEvent::Finished) {
                let window = webview.window();
                if let Ok(false) = window.is_visible() {
                    let _ = window.show();
                    let _ = window.set_focus();
                    debug!("Window shown via page load finished");
                }
            }
        })
        .on_window_event(move |_window, event| {
            // Stop the API server when the window is destroyed
            if let tauri::WindowEvent::Destroyed = event {
                let mut server = api_server.lock().unwrap();
                let port = *api_port.lock().unwrap();
                stop_api_server(&mut server, port);
            }
        })
        .invoke_handler(tauri::generate_handler![
            request_project_permission,
            prepare_layout_tile_cache,
            finalize_layout_tile_cache_meta,
            generate_layout_tiles,
            window_minimize,
            window_maximize,
            window_close,
            get_api_port,
            get_api_server_status,
            restart_api_server,
            kill_port_process,
            get_debug_info
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
