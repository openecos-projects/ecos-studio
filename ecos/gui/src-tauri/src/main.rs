#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::net::TcpListener;
use std::process::{Child, Command, Stdio};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::Duration;
use tauri::Manager;
use tauri_plugin_fs::FsExt;

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

/// Wait for the API server to become healthy, retrying up to `max_retries` times.
/// Each retry waits 500ms, so total timeout is roughly `max_retries * 0.5` seconds.
fn wait_for_server_ready(port: u16, max_retries: u32) -> bool {
    println!("Waiting for FastAPI server to be ready on port {}...", port);
    for attempt in 1..=max_retries {
        thread::sleep(Duration::from_millis(500));
        // Quick TCP probe before the heavier HTTP health check
        let addr: std::net::SocketAddr = format!("127.0.0.1:{}", port).parse().unwrap();
        if std::net::TcpStream::connect_timeout(&addr, Duration::from_millis(200)).is_ok()
            && is_api_server_healthy(port)
        {
            println!(
                "✅ FastAPI server ready on port {} after {} attempts ({:.1}s)",
                port,
                attempt,
                attempt as f32 * 0.5
            );
            return true;
        }
        if attempt % 4 == 0 {
            println!(
                "⏳ Still waiting for server on port {}... (attempt {}/{})",
                port, attempt, max_retries
            );
        }
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
        let mut server_script = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
        server_script.push("..");
        server_script.push("..");
        server_script.push("chipcompiler");
        server_script.push("server");
        server_script.push("run_server.py");

        // Use venv Python interpreter if available, otherwise fall back to system Python
        let project_root = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("..")
            .join("..");

        #[cfg(target_os = "windows")]
        let venv_python = project_root
            .join(".venv")
            .join("Scripts")
            .join("python.exe");
        #[cfg(not(target_os = "windows"))]
        let venv_python = project_root.join(".venv").join("bin").join("python3");

        let interpreter = if venv_python.exists() {
            println!("Using venv Python: {:?}", venv_python);
            venv_python.to_string_lossy().to_string()
        } else {
            println!("Venv not found, using system Python");
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

        match Command::new(&interpreter)
            .arg(&server_script)
            .arg("--host")
            .arg("127.0.0.1")
            .arg("--port")
            .arg(port.to_string())
            .arg("--reload")
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn()
        {
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

        println!(
            "Starting FastAPI server (prod mode) from: {:?} on port {}",
            server_binary, port
        );

        let mut cmd = Command::new(&server_binary);

        if let Some(oss_dir) = get_oss_cad_dir(app_handle) {
            println!("Setting CHIPCOMPILER_OSS_CAD_DIR to {:?}", oss_dir);
            cmd.env("CHIPCOMPILER_OSS_CAD_DIR", &oss_dir);
        } else {
            eprintln!("⚠️ Expected oss-cad-suite at <resource_dir>/resources/oss-cad-suite, but it was not found.");
            eprintln!("⚠️ Synthesis may fail if yosys is unavailable in PATH.");
        }

        match cmd
            .arg("--host")
            .arg("127.0.0.1")
            .arg("--port")
            .arg(port.to_string())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn()
        {
            Ok(child) => {
                println!(
                    "✅ FastAPI server started with PID: {} on port {}",
                    child.id(),
                    port
                );
                ApiStartResult::Started(child, port)
            }
            Err(e) => {
                eprintln!("❌ Failed to start FastAPI server: {}", e);
                eprintln!("   Binary path: {:?}", server_binary);
                eprintln!("   Error details: {:?}", e.kind());
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

#[tauri::command]
fn show_main_window(window: tauri::Window) {
    window.show().unwrap();
    window.set_focus().unwrap();
    println!("Window shown via frontend signal");
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

/// 强制清理端口上的进程
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

/// 获取调试信息（用于诊断生产环境问题）
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

/// 获取当前 API 服务器端口（前端用此命令获取实际使用的端口）
#[tauri::command]
fn get_api_port(port_state: tauri::State<'_, ActualApiPort>) -> u16 {
    *port_state.lock().unwrap()
}

/// 动态授予文件系统访问权限
///
/// 此命令允许前端在运行时请求访问特定目录的权限，
/// 实现了最小权限原则：应用启动时无全盘访问，仅在用户明确操作后动态授予。
#[tauri::command]
async fn request_project_permission(app: tauri::AppHandle, path: String) -> Result<(), String> {
    use std::path::PathBuf;

    // 获取文件系统作用域管理器
    let scope = app.fs_scope();
    let path_buf = PathBuf::from(&path);

    // 递归允许访问该目录及其子目录 (文件系统)
    scope
        .allow_directory(&path_buf, true)
        .map_err(|e| format!("无法授予文件系统访问权限 {}: {}", path_buf.display(), e))?;

    // 在 Tauri v2 中，convertFileSrc 自动使用 fs scope，不需要单独的 asset protocol scope
    // println!("✅ 已授予文件系统访问权限: {}", path);
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

                // Wait for the server to become healthy (max ~15s)
                if using_external_server {
                    println!(
                        "Using externally started API server (debugger mode) on port {}",
                        actual_port
                    );
                }
                if !wait_for_server_ready(actual_port, 30) {
                    eprintln!("⚠️ FastAPI server may not be fully ready after 15s");
                }

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

                // Safety timeout: show window after 1s even if frontend hasn't signalled
                let window_clone = window.clone();
                thread::spawn(move || {
                    thread::sleep(Duration::from_secs(1));
                    if let Ok(false) = window_clone.is_visible() {
                        let _ = window_clone.show();
                        println!("Window shown via safety timeout");
                    }
                });

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
        .on_window_event(move |_window, event| {
            // Stop the API server when the window is destroyed
            if let tauri::WindowEvent::Destroyed = event {
                let mut server = api_server.lock().unwrap();
                let port = *api_port.lock().unwrap();
                stop_api_server(&mut server, port);
            }
        })
        .invoke_handler(tauri::generate_handler![
            show_main_window,
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
