#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod api_server;
mod gen_layout_tiles;
mod project_scope;
mod tile_cache;
mod window_commands;

use api_server::{
    get_api_port, get_versions, start_api_server, stop_api_server, ActualApiPort, ApiServerProcess,
    ApiStartResult, DEFAULT_API_PORT,
};
use std::path::PathBuf;
use std::sync::{Arc, Mutex};

use log::{debug, error, info, warn};
use project_scope::{
    clear_project_root, is_project_directory, register_project_root, request_project_permission,
    scan_pdk_directory, ProjectRootState,
};
use tauri::Manager;
use tauri_plugin_fs::FsExt;
use tile_cache::{
    finalize_layout_tile_cache_meta, generate_layout_tiles, prepare_layout_tile_cache,
};
use window_commands::{clamp_window_to_monitor, window_close, window_maximize, window_minimize};

fn main() {
    // Default: third-party crates stay at `warn`, but our own crate emits `info`
    // so key lifecycle logs (API server spawn / readiness / timing) are visible
    // in the terminal when running the packaged AppImage. `RUST_LOG` still wins.
    env_logger::Builder::from_env(
        env_logger::Env::default().default_filter_or("warn,ecos_studio=info"),
    )
    .init();

    // Shared state for the API server process and discovered port
    let api_server: ApiServerProcess = Arc::new(Mutex::new(None));
    let api_port: ActualApiPort = Arc::new(Mutex::new(DEFAULT_API_PORT));
    let project_root: ProjectRootState = Arc::new(Mutex::new(None));

    tauri::Builder::default()
        .manage(api_server.clone())
        .manage(api_port.clone())
        .manage(project_root.clone())
        .plugin(tauri_plugin_store::Builder::new().build())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .setup({
            let api_server = api_server.clone();
            let api_port = api_port.clone();
            move |app| {
                let window = app.get_webview_window("main").unwrap();

                // 根据当前显示器的逻辑尺寸对窗口做一次限幅 + 重新居中，
                // 避免在低分辨率/高 DPI 缩放下窗口溢出屏幕，导致 TopBar
                // 右侧的窗口控制按钮被推到可视区外无法点击。
                clamp_window_to_monitor(&window);

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
                            warn!("No API server available — GUI may not function correctly");
                            (false, DEFAULT_API_PORT)
                        }
                    }
                };

                if using_external_server {
                    info!(
                        "Using externally started API server (debugger mode) on port {}",
                        actual_port
                    );
                }

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
            register_project_root,
            clear_project_root,
            request_project_permission,
            is_project_directory,
            scan_pdk_directory,
            prepare_layout_tile_cache,
            finalize_layout_tile_cache_meta,
            generate_layout_tiles,
            window_minimize,
            window_maximize,
            window_close,
            get_api_port,
            get_versions
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
