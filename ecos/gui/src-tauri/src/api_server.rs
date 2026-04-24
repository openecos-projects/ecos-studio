#[cfg(not(debug_assertions))]
use std::io::IsTerminal;
use std::net::TcpListener;
#[cfg(unix)]
use std::os::unix::process::CommandExt as _;
#[cfg(windows)]
use std::os::windows::process::CommandExt as _;
use std::process::{Child, Command, Stdio};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::Duration;

use log::{debug, error, info, warn};
use sha2::{Digest, Sha256};
#[cfg(not(debug_assertions))]
use tauri::Manager;
pub type ApiServerProcess = Arc<Mutex<Option<Child>>>;
pub type ActualApiPort = Arc<Mutex<u16>>;

/// Default API server port (used as starting point for dynamic port discovery)
pub const DEFAULT_API_PORT: u16 = 8765;

/// How many ports to scan beyond the default before giving up
const PORT_SEARCH_RANGE: u16 = 100;

/// Default deadline (in seconds) for the spawned FastAPI server to reach
/// `/health == ok`. Overridable at runtime via `ECOS_API_READY_TIMEOUT_SECS`
/// — useful when shipping a diagnostic build to a user whose cold start is
/// dominated by PyInstaller onefile extraction / heavy imports.
const API_READY_TIMEOUT_SECS_DEFAULT: u64 = 180;

fn api_ready_timeout_secs() -> u64 {
    match std::env::var("ECOS_API_READY_TIMEOUT_SECS") {
        Ok(raw) => match raw.trim().parse::<u64>() {
            Ok(value) if value > 0 => value,
            Ok(_) => {
                warn!(
                    "ECOS_API_READY_TIMEOUT_SECS=0 is not allowed; falling back to default {}s",
                    API_READY_TIMEOUT_SECS_DEFAULT
                );
                API_READY_TIMEOUT_SECS_DEFAULT
            }
            Err(e) => {
                warn!(
                    "ECOS_API_READY_TIMEOUT_SECS={:?} is not a valid u64 ({}); falling back to default {}s",
                    raw, e, API_READY_TIMEOUT_SECS_DEFAULT
                );
                API_READY_TIMEOUT_SECS_DEFAULT
            }
        },
        Err(_) => API_READY_TIMEOUT_SECS_DEFAULT,
    }
}

#[cfg(windows)]
const CREATE_NEW_PROCESS_GROUP: u32 = 0x0000_0200;

/// Result of attempting to start the API server
pub enum ApiStartResult {
    /// A new child process was successfully spawned on the given port
    Started(Child, u16),
    /// A healthy external server was detected on the given port (e.g. VS Code debugger)
    ExternalDetected(u16),
    /// Failed to start or detect a server
    Failed,
}

enum ServerReadyState {
    Ready,
    PortConflict,
    Failed(String),
}

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

/// Check if a port is available
fn is_port_available(port: u16) -> bool {
    TcpListener::bind(format!("127.0.0.1:{}", port)).is_ok()
}

fn candidate_ports(preferred: u16) -> impl Iterator<Item = u16> {
    (0..=PORT_SEARCH_RANGE).filter_map(move |offset| preferred.checked_add(offset))
}

fn generate_instance_token(port: u16) -> String {
    let timestamp_nanos = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_nanos())
        .unwrap_or_default();
    let seed = format!("{}:{}:{}", std::process::id(), port, timestamp_nanos);
    let digest = Sha256::digest(seed.as_bytes());
    digest.iter().map(|b| format!("{:02x}", b)).collect()
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

/// Check if a healthy FastAPI server is already running on the given port.
fn is_api_server_healthy(port: u16, expected_token: Option<&str>) -> bool {
    let health_url = format!("http://127.0.0.1:{}/health", port);
    ureq::get(&health_url)
        .timeout(Duration::from_secs(2))
        .call()
        .ok()
        .filter(|r| r.status() == 200u16)
        .and_then(|r| r.into_string().ok())
        .and_then(|body| serde_json::from_str::<serde_json::Value>(&body).ok())
        .map(|json| {
            if json.get("status").and_then(|v| v.as_str()) != Some("ok") {
                return false;
            }
            match expected_token {
                Some(token) => json.get("instance_token").and_then(|v| v.as_str()) == Some(token),
                None => true,
            }
        })
        .unwrap_or(false)
}

fn configure_managed_process(cmd: &mut Command) {
    #[cfg(unix)]
    {
        cmd.process_group(0);
    }
    #[cfg(windows)]
    {
        cmd.creation_flags(CREATE_NEW_PROCESS_GROUP);
    }
}

/// Wait for the API server to become healthy and prove it is the expected instance.
///
/// Starts polling at 100ms intervals, increasing by 1.5x each attempt up to 1000ms.
/// If the child exits before becoming healthy, distinguish port conflicts from generic startup failure.
fn wait_for_server_ready(
    child: &mut Child,
    port: u16,
    timeout_secs: u64,
    expected_token: Option<&str>,
) -> ServerReadyState {
    use std::time::Instant;

    info!(
        "Waiting for FastAPI server to be ready on port {} (timeout: {}s, token check: {})...",
        port,
        timeout_secs,
        expected_token.is_some()
    );
    let start = Instant::now();
    let deadline = Duration::from_secs(timeout_secs);
    let mut delay_ms: u64 = 100;
    let mut attempt: u32 = 0;

    while start.elapsed() < deadline {
        attempt += 1;

        let addr: std::net::SocketAddr = format!("127.0.0.1:{}", port).parse().unwrap();
        if std::net::TcpStream::connect_timeout(&addr, Duration::from_millis(200)).is_ok()
            && is_api_server_healthy(port, expected_token)
        {
            info!(
                "FastAPI server ready on port {} after {} attempts ({:.1}s)",
                port,
                attempt,
                start.elapsed().as_secs_f32()
            );
            return ServerReadyState::Ready;
        }

        match child.try_wait() {
            Ok(Some(status)) => {
                if !is_port_available(port) {
                    warn!(
                        "Server process exited before readiness on port {} and the port is already occupied; treating as port conflict",
                        port
                    );
                    return ServerReadyState::PortConflict;
                }
                return ServerReadyState::Failed(format!(
                    "server process exited before readiness with status {}",
                    status
                ));
            }
            Ok(None) => {}
            Err(e) => {
                return ServerReadyState::Failed(format!("failed to query child status: {}", e));
            }
        }

        if start.elapsed().as_secs() >= 4 && attempt.is_multiple_of(3) {
            info!(
                "Still waiting for server on port {}... ({:.1}s elapsed, attempt {})",
                port,
                start.elapsed().as_secs_f32(),
                attempt
            );
        }

        delay_ms = (delay_ms * 3 / 2).min(1000);
        thread::sleep(Duration::from_millis(delay_ms));
    }

    match child.try_wait() {
        Ok(Some(_status)) if !is_port_available(port) => ServerReadyState::PortConflict,
        Ok(Some(status)) => ServerReadyState::Failed(format!(
            "server exited before readiness with status {}",
            status
        )),
        Ok(None) => ServerReadyState::Failed(format!(
            "server did not become ready on port {} within {}s",
            port, timeout_secs
        )),
        Err(e) => ServerReadyState::Failed(format!("failed to query child status: {}", e)),
    }
}

#[cfg(not(debug_assertions))]
fn get_oss_cad_dir(app_handle: &tauri::AppHandle) -> Option<std::path::PathBuf> {
    app_handle
        .path()
        .resource_dir()
        .ok()
        .map(|resource_dir| resource_dir.join("resources").join("oss-cad-suite"))
        .filter(|path| path.exists())
}

/// Start the FastAPI server process.
/// In debug mode: runs Python script directly.
/// In release mode: runs the bundled executable.
pub fn start_api_server(
    #[cfg(debug_assertions)] _app_handle: &tauri::AppHandle,
    #[cfg(not(debug_assertions))] app_handle: &tauri::AppHandle,
) -> ApiStartResult {
    use std::path::PathBuf;

    // Check if a healthy API server is already running on the default port.
    //
    // On shared remote servers another user's ChipCompiler instance may occupy
    // the same port. Blindly reusing it would connect this GUI to someone
    // else's backend — a serious bug.
    //
    // Therefore, auto-reuse is off by default. Developers who manually start
    // the API server for debugging can opt in by setting:
    //     ECOS_REUSE_API_SERVER=1
    if !is_port_available(DEFAULT_API_PORT) && is_api_server_healthy(DEFAULT_API_PORT, None) {
        let reuse = std::env::var("ECOS_REUSE_API_SERVER").unwrap_or_default() == "1";
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

    #[cfg(debug_assertions)]
    {
        // Development mode: use Python script with virtual environment.
        // Server lives at ecos/server/ (sibling of ecos/gui/).
        let server_dir = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("..")
            .join("..")
            .join("server");
        let server_script = server_dir.join("run_server.py");

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

        for port in candidate_ports(DEFAULT_API_PORT) {
            if !is_port_available(port) {
                debug!("Skipping occupied port {} before spawn attempt", port);
                continue;
            }

            let token = generate_instance_token(port);
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
                .current_dir(&server_dir)
                .env("ECOS_SERVER_INSTANCE_TOKEN", &token);
            configure_managed_process(&mut cmd);

            info!(
                "Starting FastAPI server (dev mode) from: {:?} on port {}",
                server_script, port
            );

            let mut child = match cmd.spawn() {
                Ok(child) => child,
                Err(e) => {
                    error!("Failed to start FastAPI server: {}", e);
                    return ApiStartResult::Failed;
                }
            };

            match wait_for_server_ready(&mut child, port, api_ready_timeout_secs(), Some(&token)) {
                ServerReadyState::Ready => {
                    info!(
                        "FastAPI server started with PID: {} on port {}",
                        child.id(),
                        port
                    );
                    return ApiStartResult::Started(child, port);
                }
                ServerReadyState::PortConflict => {
                    warn!(
                        "Port {} was lost during startup; retrying on next candidate",
                        port
                    );
                    let mut child_opt = Some(child);
                    stop_api_server(&mut child_opt, port);
                }
                ServerReadyState::Failed(reason) => {
                    error!(
                        "Failed to start FastAPI server on port {}: {}",
                        port, reason
                    );
                    let mut child_opt = Some(child);
                    stop_api_server(&mut child_opt, port);
                    return ApiStartResult::Failed;
                }
            }
        }

        error!(
            "Cannot start API server: no usable port found (tried {} - {})",
            DEFAULT_API_PORT,
            DEFAULT_API_PORT.saturating_add(PORT_SEARCH_RANGE)
        );
        ApiStartResult::Failed
    }

    #[cfg(not(debug_assertions))]
    {
        // Production mode: use bundled executable.
        // Tauri's externalBin places binaries in the same directory as the main executable.
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

        for port in candidate_ports(DEFAULT_API_PORT) {
            if !is_port_available(port) {
                debug!("Skipping occupied port {} before spawn attempt", port);
                continue;
            }

            let token = generate_instance_token(port);

            info!(
                "Starting FastAPI server (prod mode) from: {:?} on port {} (terminal: {})",
                server_binary, port, launched_from_terminal
            );

            let mut cmd = Command::new(&server_binary);

            if let Some(oss_dir) = get_oss_cad_dir(app_handle) {
                debug!("Setting CHIPCOMPILER_OSS_CAD_DIR to {:?}", oss_dir);
                cmd.env("CHIPCOMPILER_OSS_CAD_DIR", &oss_dir);
            } else {
                warn!(
                    "Expected oss-cad-suite at <resource_dir>/resources/oss-cad-suite, but it was not found."
                );
                warn!("Synthesis may fail if yosys is unavailable in PATH.");
            }

            cmd.arg("--host")
                .arg("127.0.0.1")
                .arg("--port")
                .arg(port.to_string())
                .arg("--disable-stdio-redirect")
                .env("ECOS_SERVER_INSTANCE_TOKEN", &token);

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

            configure_managed_process(&mut cmd);

            let mut child = match cmd.spawn() {
                Ok(child) => child,
                Err(e) => {
                    error!("Failed to start FastAPI server: {}", e);
                    error!("   Binary path: {:?}", server_binary);
                    error!("   Error details: {:?}", e.kind());
                    return ApiStartResult::Failed;
                }
            };

            if !launched_from_terminal {
                if let Some(stdout) = child.stdout.take() {
                    drain_pipe(stdout);
                }
                if let Some(stderr) = child.stderr.take() {
                    drain_pipe(stderr);
                }
            }

            match wait_for_server_ready(&mut child, port, api_ready_timeout_secs(), Some(&token)) {
                ServerReadyState::Ready => {
                    info!(
                        "FastAPI server started with PID: {} on port {}",
                        child.id(),
                        port
                    );
                    return ApiStartResult::Started(child, port);
                }
                ServerReadyState::PortConflict => {
                    warn!(
                        "Port {} was lost during startup; retrying on next candidate",
                        port
                    );
                    let mut child_opt = Some(child);
                    stop_api_server(&mut child_opt, port);
                }
                ServerReadyState::Failed(reason) => {
                    error!(
                        "Failed to start FastAPI server on port {}: {}",
                        port, reason
                    );
                    let mut child_opt = Some(child);
                    stop_api_server(&mut child_opt, port);
                    return ApiStartResult::Failed;
                }
            }
        }

        error!(
            "Cannot start API server: no usable port found (tried {} - {})",
            DEFAULT_API_PORT,
            DEFAULT_API_PORT.saturating_add(PORT_SEARCH_RANGE)
        );
        ApiStartResult::Failed
    }
}

/// Stop the FastAPI server process and clean up any orphaned children.
///
/// `port` is the actual port the server was started on (may differ from DEFAULT_API_PORT).
///
/// When `process` is `None` (external/debugger mode), this is a no-op -
/// the external server is intentionally left running.
pub fn stop_api_server(process: &mut Option<Child>, port: u16) {
    if let Some(ref mut child) = process {
        let pid = child.id();
        info!("Stopping FastAPI server (PID: {}, port: {})...", pid, port);

        // On Unix, place the child in its own process group at spawn time, then
        // terminate the whole group so uvicorn reload/workers do not survive.
        #[cfg(unix)]
        {
            let pgid_kill = Command::new("kill")
                .args(["-TERM", "--", &format!("-{}", pid)])
                .output();
            match pgid_kill {
                Ok(out) if out.status.success() => {
                    info!("Sent SIGTERM to process group -{}", pid);
                }
                _ => {
                    let _ = Command::new("kill").args([&pid.to_string()]).output();
                }
            }
            thread::sleep(Duration::from_millis(500));

            if child.try_wait().ok().flatten().is_none() {
                let _ = Command::new("kill")
                    .args(["-KILL", "--", &format!("-{}", pid)])
                    .output();
            }
        }

        #[cfg(windows)]
        {
            let taskkill = Command::new("taskkill")
                .args(["/PID", &pid.to_string(), "/T", "/F"])
                .output();
            match taskkill {
                Ok(out) if out.status.success() => {
                    info!("Killed FastAPI server process tree rooted at {}", pid);
                }
                Ok(out) => {
                    warn!(
                        "taskkill /T failed for PID {} with status {}; falling back to child.kill()",
                        pid,
                        out.status
                    );
                    let _ = child.kill();
                }
                Err(e) => {
                    warn!("Failed to execute taskkill for PID {}: {}", pid, e);
                    let _ = child.kill();
                }
            }
        }

        #[cfg(unix)]
        if child.try_wait().ok().flatten().is_none() {
            match child.kill() {
                Ok(_) => info!("FastAPI server process killed"),
                Err(e) => {
                    warn!("child.kill(): {} (process may have already exited)", e);
                }
            }
        }

        let _ = child.wait();
        *process = None;
    }
}

#[tauri::command]
pub fn get_api_port(port_state: tauri::State<'_, ActualApiPort>) -> u16 {
    let port = *port_state.lock().unwrap();
    debug!("cmd=get_api_port port={}", port);
    port
}

/// Get possible paths where the api-server binary might be located.
/// This handles differences between macOS, Linux, and Windows.
#[cfg(not(debug_assertions))]
fn get_possible_binary_paths(
    app_handle: &tauri::AppHandle,
    binary_name: &str,
) -> Vec<std::path::PathBuf> {
    let mut paths = Vec::new();

    // Method 1: Next to the current executable (works for bundled apps on Linux and Windows).
    if let Ok(exe_path) = std::env::current_exe() {
        if let Some(exe_dir) = exe_path.parent() {
            paths.push(exe_dir.join(binary_name));
            paths.push(exe_dir.join("binaries").join(binary_name));

            // For running directly from target/release, also look in src-tauri/binaries.
            if let Some(target_dir) = exe_dir.parent() {
                if let Some(src_tauri_dir) = target_dir.parent() {
                    paths.push(src_tauri_dir.join("binaries").join(binary_name));
                }
            }
        }
    }

    // Method 2: Using Tauri's resource_dir.
    if let Ok(resource_dir) = app_handle.path().resource_dir() {
        paths.push(resource_dir.join(binary_name));
        paths.push(resource_dir.join("binaries").join(binary_name));
    }

    // Method 3: macOS specific - inside the .app bundle.
    #[cfg(target_os = "macos")]
    {
        if let Ok(exe_path) = std::env::current_exe() {
            if let Some(macos_dir) = exe_path.parent() {
                paths.push(macos_dir.join(binary_name));

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

    let mut seen = std::collections::HashSet::new();
    paths.retain(|p| seen.insert(p.clone()));

    paths
}
