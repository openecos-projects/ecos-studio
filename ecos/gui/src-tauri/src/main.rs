#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::io::IsTerminal;
use std::net::TcpListener;
use std::process::{Child, Command, Stdio};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::Duration;
use tauri::Manager;
use tauri_plugin_fs::FsExt;

/// Fixed log file path for the API server (matches Python's --log-file default).
/// In terminal mode Rust tees here; in desktop mode Python writes here directly.
const API_SERVER_LOG_FILE: &str = "/tmp/ecos-studio-api-server.log";

/// Returns true when the process was launched from an interactive terminal
/// (i.e. stderr is a TTY). False when launched from a desktop file / launcher.
fn is_launched_from_terminal() -> bool {
    std::io::stderr().is_terminal()
}

/// Open a file with the system's default application (text editor / file manager).
fn open_log_file(path: &str) {
    #[cfg(target_os = "linux")]
    let _ = Command::new("xdg-open").arg(path).spawn();
    #[cfg(target_os = "macos")]
    let _ = Command::new("open").arg(path).spawn();
    #[cfg(target_os = "windows")]
    let _ = Command::new("cmd").args(["/C", "start", "", path]).spawn();
}

/// Drain a child's stdout or stderr pipe in a background thread.
///
/// * `to_terminal` – if true, also echo each line to Rust's own stdout/stderr
///   AND write it to `log_path` (used in terminal-launch mode where Python has
///   `--disable-stdio-redirect` so all output stays on the pipe).
/// * `to_terminal = false` – desktop-launch mode: Python writes to log itself;
///   we only drain the pipe to prevent the child from blocking on a full buffer.
#[cfg(not(debug_assertions))]
fn tee_output(
    reader: impl std::io::Read + Send + 'static,
    log_path: String,
    to_terminal: bool,
    is_stderr: bool,
) {
    use std::fs::OpenOptions;
    use std::io::{BufRead, BufReader, Write};

    thread::spawn(move || {
        // Only open the log file when WE are responsible for writing to it
        // (terminal mode). In desktop mode Python already writes there.
        let mut log_writer = if to_terminal {
            OpenOptions::new()
                .create(true)
                .append(true)
                .open(&log_path)
                .map_err(|e| {
                    eprintln!("⚠️ Cannot open log file {}: {}", log_path, e);
                    e
                })
                .ok()
        } else {
            None
        };

        let reader = BufReader::new(reader);
        for line in reader.lines() {
            match line {
                Ok(l) => {
                    if let Some(ref mut f) = log_writer {
                        let _ = writeln!(f, "{}", l);
                    }
                    if to_terminal {
                        if is_stderr {
                            eprintln!("{}", l);
                        } else {
                            println!("{}", l);
                        }
                    }
                }
                Err(_) => break,
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
                    println!("✅ Killed process on port {}", port);
                    true
                } else {
                    eprintln!("⚠️ Could not kill process on port {}", port);
                    false
                }
            }
            Err(e) => {
                eprintln!("❌ Failed to execute kill command: {}", e);
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
                    println!("No process found on port {}", port);
                    return true;
                }

                let mut all_killed = true;
                for pid in pids {
                    println!("Found process {} on port {}, killing...", pid, port);
                    let kill_result = Command::new("kill").args(["-9", pid]).output();

                    match kill_result {
                        Ok(kill_out) => {
                            if kill_out.status.success() {
                                println!("✅ Killed process {} on port {}", pid, port);
                            } else {
                                eprintln!("⚠️ Failed to kill process {}", pid);
                                all_killed = false;
                            }
                        }
                        Err(e) => {
                            eprintln!("❌ Failed to execute kill command: {}", e);
                            all_killed = false;
                        }
                    }
                }
                all_killed
            }
            Err(e) => {
                eprintln!("❌ Failed to execute lsof: {}", e);
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

    println!(
        "⚠️ Preferred port {} is in use, scanning for available port...",
        preferred
    );

    // Scan a range of ports after the preferred one
    for offset in 1..=PORT_SEARCH_RANGE {
        if let Some(port) = preferred.checked_add(offset) {
            if is_port_available(port) {
                println!("✅ Found available port: {}", port);
                return Some(port);
            }
        }
    }

    eprintln!(
        "❌ Could not find any available port in range {}-{}",
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

    println!("Waiting for FastAPI server to be ready on port {}...", port);
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
            println!(
                "✅ FastAPI server ready on port {} after {} attempts ({:.1}s)",
                port,
                attempt,
                start.elapsed().as_secs_f32()
            );
            return true;
        }

        if start.elapsed().as_secs() >= 4 && attempt % 3 == 0 {
            println!(
                "⏳ Still waiting for server on port {}... ({:.1}s elapsed)",
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
            println!(
                "✅ Healthy API server on port {} and ECOS_REUSE_API_SERVER=1, reusing it",
                DEFAULT_API_PORT
            );
            return ApiStartResult::ExternalDetected(DEFAULT_API_PORT);
        }
        println!(
            "⚠️ Port {} has a healthy API server but ECOS_REUSE_API_SERVER is not set — \
             will start on a different port (set ECOS_REUSE_API_SERVER=1 to reuse)",
            DEFAULT_API_PORT
        );
    }

    // Find an available port (starting from the default)
    let port = match find_available_port(DEFAULT_API_PORT) {
        Some(p) => p,
        None => {
            eprintln!(
                "❌ Cannot start API server: no available port found (tried {} - {})",
                DEFAULT_API_PORT,
                DEFAULT_API_PORT + PORT_SEARCH_RANGE
            );
            return ApiStartResult::Failed;
        }
    };

    if port != DEFAULT_API_PORT {
        println!(
            "📌 Using alternative port {} (default port {} was occupied)",
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
            println!("Using venv Python: {:?}", venv_python);
            venv_python.to_string_lossy().to_string()
        } else {
            println!("Venv not found at {:?}, using system Python", venv_python);
            #[cfg(target_os = "windows")]
            {
                "python".to_string()
            }
            #[cfg(not(target_os = "windows"))]
            {
                "python3".to_string()
            }
        };

        println!(
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
                println!(
                    "✅ FastAPI server started with PID: {} on port {}",
                    child.id(),
                    port
                );
                return ApiStartResult::Started(child, port);
            }
            Err(e) => {
                eprintln!("❌ Failed to start FastAPI server: {}", e);
                return ApiStartResult::Failed;
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
                println!("Checking for api-server at: {:?}", path);
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
                eprintln!("❌ API server binary not found. Checked locations:");
                let mut seen = std::collections::HashSet::new();
                for path in checked_paths {
                    if seen.insert(path.clone()) {
                        eprintln!("   - {:?}", path);
                    }
                }
                return ApiStartResult::Failed;
            }
        };

        let launched_from_terminal = is_launched_from_terminal();

        println!(
            "Starting FastAPI server (prod mode) from: {:?} on port {} (terminal: {})",
            server_binary, port, launched_from_terminal
        );

        let mut cmd = Command::new(&server_binary);

        if let Some(oss_dir) = get_oss_cad_dir(app_handle) {
            println!("Setting CHIPCOMPILER_OSS_CAD_DIR to {:?}", oss_dir);
            cmd.env("CHIPCOMPILER_OSS_CAD_DIR", &oss_dir);
        } else {
            eprintln!("⚠️ Expected oss-cad-suite at <resource_dir>/resources/oss-cad-suite, but it was not found.");
            eprintln!("⚠️ Synthesis may fail if yosys is unavailable in PATH.");
        }

        // Always pass a fixed log-file path so we know where to look on errors.
        cmd.arg("--host")
            .arg("127.0.0.1")
            .arg("--port")
            .arg(port.to_string())
            .arg("--log-file")
            .arg(API_SERVER_LOG_FILE)
            .arg("--no-timestamp-log-file");

        if launched_from_terminal {
            // Terminal launch: keep output on child's stdio so we can tee it.
            // Python will NOT redirect to file; Rust handles writing to both
            // the terminal and the log file via the tee threads below.
            cmd.arg("--disable-stdio-redirect");
            println!("📋 Server logs → terminal + {}", API_SERVER_LOG_FILE);
        } else {
            // Desktop launch: Python redirects its own stdio to the log file.
            // Rust only needs to drain the pipes to prevent buffer blocking.
            println!("📋 Server logs → {}", API_SERVER_LOG_FILE);
        }
        println!("📋 Workspace logs will be saved to <workspace>/log/ when a project is opened");

        cmd.stdout(Stdio::piped()).stderr(Stdio::piped());

        match cmd.spawn() {
            Ok(mut child) => {
                println!(
                    "✅ FastAPI server started with PID: {} on port {}",
                    child.id(),
                    port
                );

                // Drain (and optionally tee) the child's stdout/stderr pipes.
                // This is required in both modes to prevent the child from
                // blocking when the OS pipe buffer fills up.
                if let Some(stdout) = child.stdout.take() {
                    tee_output(
                        stdout,
                        API_SERVER_LOG_FILE.to_string(),
                        launched_from_terminal,
                        false,
                    );
                }
                if let Some(stderr) = child.stderr.take() {
                    tee_output(
                        stderr,
                        API_SERVER_LOG_FILE.to_string(),
                        launched_from_terminal,
                        true,
                    );
                }

                ApiStartResult::Started(child, port)
            }
            Err(e) => {
                eprintln!("❌ Failed to start FastAPI server: {}", e);
                eprintln!("   Binary path: {:?}", server_binary);
                eprintln!("   Error details: {:?}", e.kind());
                // Write the error into the log file so desktop users can see it
                // when the file is opened automatically.
                if !launched_from_terminal {
                    use std::io::Write;
                    if let Ok(mut f) = std::fs::OpenOptions::new()
                        .create(true)
                        .append(true)
                        .open(API_SERVER_LOG_FILE)
                    {
                        let _ = writeln!(f, "❌ Failed to start FastAPI server: {}", e);
                        let _ = writeln!(f, "   Binary path: {:?}", server_binary);
                        let _ = writeln!(f, "   Error details: {:?}", e.kind());
                    }
                }
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
        println!("Stopping FastAPI server (PID: {}, port: {})...", pid, port);

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
                    println!("Sent SIGTERM to process group -{}", pid);
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
            Ok(_) => println!("✅ FastAPI server process killed"),
            Err(e) => {
                // "InvalidInput" / "not running" is fine — process already exited
                eprintln!("⚠️ child.kill(): {} (process may have already exited)", e);
            }
        }

        // Reap the zombie so it doesn't linger in the process table
        let _ = child.wait();
        *process = None;

        // Safety net: if orphaned workers survived the group kill, clean them
        // up via port-based lookup (lsof + kill) so the port is free on next start.
        thread::sleep(Duration::from_millis(300));
        if !is_port_available(port) {
            println!("⚠️ Port {} still occupied after stopping server, cleaning up orphaned processes...", port);
            kill_process_on_port(port);
            thread::sleep(Duration::from_millis(300));
        }

        if is_port_available(port) {
            println!("✅ Port {} is now free", port);
        } else {
            eprintln!("❌ Port {} is still occupied after cleanup", port);
        }
    }
}

/// 窗口最小化
#[tauri::command]
fn window_minimize(window: tauri::Window) {
    let _ = window.minimize();
}

/// 窗口最大化/还原
#[tauri::command]
fn window_maximize(window: tauri::Window) {
    if window.is_maximized().unwrap_or(false) {
        let _ = window.unmaximize();
    } else {
        let _ = window.maximize();
    }
}

/// 窗口关闭
#[tauri::command]
fn window_close(window: tauri::Window) {
    let _ = window.close();
}

/// 获取 API 服务器状态
#[tauri::command]
fn get_api_server_status(port_state: tauri::State<'_, ActualApiPort>) -> serde_json::Value {
    let port = *port_state.lock().unwrap();
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
    *port_state.lock().unwrap()
}

#[tauri::command]
async fn request_project_permission(app: tauri::AppHandle, path: String) -> Result<(), String> {
    use std::path::PathBuf;

    let scope = app.fs_scope();
    let path_buf = PathBuf::from(&path);

    scope
        .allow_directory(&path_buf, true)
        .map_err(|e| format!("Unable to grant file system access permissions {}: {}", path_buf.display(), e))?;
    Ok(())
}

fn main() {
    use std::path::PathBuf;

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
                    match start_api_server(&app.handle()) {
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
                            eprintln!(
                                "⚠️ No API server available — GUI may not function correctly"
                            );
                            (false, DEFAULT_API_PORT)
                        }
                    }
                };

                // Wait for the server in the background so the webview can start
                // loading immediately (splash screen visible sooner).
                thread::spawn(move || {
                    if using_external_server {
                        println!(
                            "Using externally started API server (debugger mode) on port {}",
                            actual_port
                        );
                    }
                    if !wait_for_server_ready(actual_port, 15) {
                        eprintln!("⚠️ FastAPI server may not be fully ready after 15s");
                        // In release desktop mode, open the log file so the user
                        // can see what went wrong without needing a terminal.
                        #[cfg(not(debug_assertions))]
                        if !is_launched_from_terminal() {
                            eprintln!("Opening server log: {}", API_SERVER_LOG_FILE);
                            open_log_file(API_SERVER_LOG_FILE);
                        }
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
                        Ok(()) => println!("✅ Granted fs scope: {:?}", final_path),
                        Err(e) => eprintln!("❌ Failed to grant fs scope: {}", e),
                    }
                }

                #[cfg(debug_assertions)]
                {
                    let scale_factor = window.scale_factor().unwrap_or(1.0);
                    if let Ok(size) = window.inner_size() {
                        println!("=== Window Debug Info ===");
                        println!(
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
                    println!("Window shown via page load finished");
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
