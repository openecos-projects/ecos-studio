mod app;
mod camera3d;
mod canvas_gpu;
mod canvas_gpu3d;
mod map_data;
mod nav3d;

use std::path::{Path, PathBuf};

use anyhow::Result;
use app::ChipViewerApp;
use clap::{Parser, ValueEnum};

#[derive(Debug, Clone, Copy, PartialEq, Eq, ValueEnum)]
pub enum RenderMode {
    #[value(name = "gpu")]
    Gpu,
    #[value(name = "software")]
    Software,
    #[value(name = "egui-only")]
    EguiOnly,
}

#[derive(Debug, Parser)]
struct Args {
    #[arg(long)]
    manifest: PathBuf,

    #[arg(long, default_value = "view", value_parser = ["view", "edit"])]
    mode: String,

    #[arg(long)]
    edit_command_dir: Option<PathBuf>,

    #[arg(long)]
    edit_result_dir: Option<PathBuf>,

    #[arg(long)]
    edit_dirty: bool,

    #[arg(long)]
    drc_data: Option<PathBuf>,

    #[arg(long)]
    drc_statis: Option<PathBuf>,

    #[arg(long)]
    antenna_data: Option<PathBuf>,

    #[arg(long)]
    antenna_statis: Option<PathBuf>,

    #[arg(long)]
    map_root: Option<PathBuf>,

    #[arg(long)]
    force_cpu: bool,

    #[arg(long, value_enum)]
    render_mode: Option<RenderMode>,

    #[arg(long, alias = "safe-mode")]
    egui_only: bool,

    #[arg(long)]
    x11: bool,
}

#[derive(Debug, Clone)]
struct GraphicsEnvironment {
    is_wsl: bool,
    has_dxg: bool,
    has_d3d12_mesa: bool,
    has_dzn: bool,
}

impl GraphicsEnvironment {
    fn detect() -> Self {
        let is_wsl = cfg!(target_os = "linux")
            && (std::env::var_os("WSL_DISTRO_NAME").is_some()
                || std::env::var_os("WSL_INTEROP").is_some()
                || Path::new("/dev/dxg").exists());
        let has_dxg = is_wsl && Path::new("/dev/dxg").exists();
        let has_d3d12_mesa = is_wsl
            && (Path::new("/usr/lib/x86_64-linux-gnu/dri/d3d12_dri.so").exists()
                || Path::new("/usr/lib/dri/d3d12_dri.so").exists());
        let has_dzn = is_wsl
            && [
                "/usr/share/vulkan/icd.d/dzn_icd.json",
                "/usr/share/vulkan/icd.d/dzn_icd.x86_64.json",
            ]
            .iter()
            .any(|path| Path::new(path).exists());

        Self {
            is_wsl,
            has_dxg,
            has_d3d12_mesa,
            has_dzn,
        }
    }
}

fn check_libxkbcommon_x11() -> bool {
    #[cfg(target_os = "linux")]
    {
        extern "C" {
            fn dlopen(
                filename: *const std::os::raw::c_char,
                flag: std::os::raw::c_int,
            ) -> *mut std::ffi::c_void;
            fn dlclose(handle: *mut std::ffi::c_void) -> std::os::raw::c_int;
        }
        for name in &["libxkbcommon-x11.so.0\0", "libxkbcommon-x11.so\0"] {
            let handle = unsafe { dlopen(name.as_ptr() as *const _, 1) }; // 1 = RTLD_LAZY
            if !handle.is_null() {
                unsafe {
                    dlclose(handle);
                }
                return true;
            }
        }
        let candidate_paths = [
            "/usr/lib/x86_64-linux-gnu/libxkbcommon-x11.so.0",
            "/usr/lib/x86_64-linux-gnu/libxkbcommon-x11.so",
            "/usr/lib64/libxkbcommon-x11.so.0",
            "/usr/lib64/libxkbcommon-x11.so",
            "/usr/lib/libxkbcommon-x11.so.0",
            "/usr/lib/libxkbcommon-x11.so",
            "/lib/x86_64-linux-gnu/libxkbcommon-x11.so.0",
            "/lib/x86_64-linux-gnu/libxkbcommon-x11.so",
            "/lib64/libxkbcommon-x11.so.0",
            "/lib/libxkbcommon-x11.so.0",
        ];
        candidate_paths.iter().any(|p| Path::new(p).exists())
    }
    #[cfg(not(target_os = "linux"))]
    {
        true
    }
}

fn configure_linux_window_backend(args: &Args, env: &GraphicsEnvironment) -> Result<()> {
    if !cfg!(target_os = "linux") {
        return Ok(());
    }

    let explicit_wayland = std::env::var("ECOS_WINDOW_BACKEND")
        .map(|v| v.eq_ignore_ascii_case("wayland"))
        .unwrap_or(false);

    let explicit_x11 = args.x11
        || std::env::var("ECOS_WINDOW_BACKEND")
            .map(|v| v.eq_ignore_ascii_case("x11"))
            .unwrap_or(false);

    let wsl_prefers_x11 = env.is_wsl && std::env::var_os("DISPLAY").is_some() && !explicit_wayland;

    let force_x11 = explicit_x11 || wsl_prefers_x11;

    if force_x11 {
        if !check_libxkbcommon_x11() {
            eprintln!("============================================================");
            eprintln!("ECOS Chip Viewer: Missing Required System Dependency");
            eprintln!("------------------------------------------------------------");
            eprintln!("The X11 window backend requires 'libxkbcommon-x11.so.0',");
            eprintln!("which is not installed on your Linux system.");
            eprintln!();
            eprintln!("Alternatively, if running inside WSLg, you can run ECOS Studio");
            eprintln!("inside a Wayland kiosk compositor:");
            eprintln!("    sudo apt update && sudo apt install -y cage");
            eprintln!("    cage -- ./ECOS-Studio... --no-sandbox");
            eprintln!("============================================================");
            anyhow::bail!(
                "Missing required system library 'libxkbcommon-x11.so.0' for X11 rendering. Run: sudo apt install -y libxkbcommon-x11-0"
            );
        }
        std::env::remove_var("WAYLAND_DISPLAY");
        std::env::remove_var("WAYLAND_SOCKET");
        if explicit_x11 {
            eprintln!("ECOS: forcing X11 window backend via explicit option (removed WAYLAND_DISPLAY and WAYLAND_SOCKET)");
        } else {
            eprintln!(
                "ECOS: WSLg detected - defaulting to X11 to prevent Weston compositor crash (microsoft/wslg#1386)"
            );
        }
    }

    eprintln!(
        "ECOS window environment: WAYLAND_DISPLAY={:?}, DISPLAY={:?}",
        std::env::var_os("WAYLAND_DISPLAY"),
        std::env::var_os("DISPLAY"),
    );
    Ok(())
}

fn is_software_adapter(info: &wgpu::AdapterInfo) -> bool {
    matches!(info.device_type, wgpu::DeviceType::Cpu)
        || info.name.to_ascii_lowercase().contains("llvmpipe")
        || info.name.to_ascii_lowercase().contains("softpipe")
        || info.driver.to_ascii_lowercase().contains("llvmpipe")
        || info.driver.to_ascii_lowercase().contains("swrast")
}

fn is_hardware_adapter(info: &wgpu::AdapterInfo) -> bool {
    matches!(
        info.device_type,
        wgpu::DeviceType::IntegratedGpu
            | wgpu::DeviceType::DiscreteGpu
            | wgpu::DeviceType::VirtualGpu
    ) && !is_software_adapter(info)
}

fn probe_hardware_adapter(
    backends: wgpu::Backends,
) -> (Option<wgpu::AdapterInfo>, Option<wgpu::AdapterInfo>) {
    let instance = wgpu::Instance::new(&wgpu::InstanceDescriptor {
        backends,
        ..Default::default()
    });
    let mut first_info = None;
    let mut hardware_info = None;

    for adapter in instance.enumerate_adapters(backends) {
        let info = adapter.get_info();
        eprintln!(
            "ECOS GPU probe: backend={:?}, type={:?}, name={}, driver={}",
            info.backend, info.device_type, info.name, info.driver
        );
        if first_info.is_none() {
            first_info = Some(info.clone());
        }
        if is_hardware_adapter(&info) && hardware_info.is_none() {
            hardware_info = Some(info);
        }
    }

    (hardware_info, first_info)
}

fn print_startup_diagnostics(
    env: &GraphicsEnvironment,
    hardware_adapter: Option<&wgpu::AdapterInfo>,
    fallback_adapter: Option<&wgpu::AdapterInfo>,
    render_mode: RenderMode,
) {
    let platform = if env.is_wsl {
        "WSL2 / WSLg"
    } else if cfg!(target_os = "linux") {
        "Native Linux"
    } else if cfg!(target_os = "windows") {
        "Windows"
    } else if cfg!(target_os = "macos") {
        "macOS"
    } else {
        "Other"
    };

    let hw_gpu_str = hardware_adapter
        .map(|info| format!("{} ({:?})", info.name, info.backend))
        .unwrap_or_else(|| "Not detected / Unavailable".to_string());

    let fallback_str = fallback_adapter
        .map(|info| format!("{} ({:?})", info.name, info.backend))
        .unwrap_or_else(|| "None".to_string());

    let active_info = hardware_adapter.or(fallback_adapter);

    let driver_str = active_info
        .map(|info| info.driver.clone())
        .unwrap_or_else(|| "None".to_string());

    let adapter_type_str = active_info
        .map(|info| {
            if is_software_adapter(info) {
                "Software / CPU rasterizer"
            } else {
                "Hardware Accelerated GPU"
            }
        })
        .unwrap_or("Unavailable");

    let rendering_mode = match render_mode {
        RenderMode::Gpu => "GPU Accelerated (wgpu)",
        RenderMode::Software => "Software (egui)",
        RenderMode::EguiOnly => "Software (egui Safe Mode)",
    };

    let three_d_mode = match render_mode {
        RenderMode::Gpu => "Available (GPU Instanced)",
        RenderMode::Software | RenderMode::EguiOnly => "Unavailable (Requires Hardware GPU)",
    };

    eprintln!("============================================================");
    eprintln!("ECOS Chip Viewer Graphics Diagnostic");
    eprintln!("------------------------------------------------------------");
    eprintln!("Platform:         {}", platform);
    if env.is_wsl {
        eprintln!(
            "WSL /dev/dxg:     {}",
            if env.has_dxg {
                "Available"
            } else {
                "Not found"
            }
        );
        eprintln!(
            "Mesa D3D12:       {}",
            if env.has_d3d12_mesa {
                "Available"
            } else {
                "Not found"
            }
        );
        eprintln!(
            "Vulkan Dozen:     {}",
            if env.has_dzn {
                "Available"
            } else {
                "Not detected"
            }
        );
    }
    eprintln!("Hardware GPU:     {}", hw_gpu_str);
    eprintln!("Fallback Adapter: {}", fallback_str);
    eprintln!("Driver:           {}", driver_str);
    eprintln!("Driver Type:      {}", adapter_type_str);
    eprintln!("------------------------------------------------------------");
    eprintln!("Rendering Mode:   {}", rendering_mode);
    eprintln!("3D Canvas:        {}", three_d_mode);
    eprintln!("============================================================");
}

fn main() -> Result<()> {
    let args = Args::parse();

    let env = GraphicsEnvironment::detect();
    configure_linux_window_backend(&args, &env)?;

    let force_cpu_env = std::env::var("ECOS_FORCE_CPU")
        .ok()
        .map(|v| canvas_gpu::env_flag_requested(Some(&v)))
        .unwrap_or(false);

    let env_mode = std::env::var("ECOS_RENDER_MODE").ok().and_then(|v| {
        match v.to_ascii_lowercase().as_str() {
            "gpu" => Some(RenderMode::Gpu),
            "software" | "glow" => Some(RenderMode::Software),
            "egui-only" | "egui" | "safe" | "cpu" => Some(RenderMode::EguiOnly),
            _ => None,
        }
    });

    let forced_egui_only = args.egui_only
        || args.force_cpu
        || force_cpu_env
        || args.render_mode == Some(RenderMode::EguiOnly)
        || env_mode == Some(RenderMode::EguiOnly);

    let wgpu_backends = wgpu::Backends::from_env().unwrap_or(wgpu::Backends::all());

    let (render_mode, hardware_adapter, fallback_adapter) = if forced_egui_only {
        (RenderMode::EguiOnly, None, None)
    } else if args.render_mode == Some(RenderMode::Software)
        || env_mode == Some(RenderMode::Software)
    {
        let (hw, fb) = probe_hardware_adapter(wgpu_backends);
        (RenderMode::Software, hw, fb)
    } else if args.render_mode == Some(RenderMode::Gpu) || env_mode == Some(RenderMode::Gpu) {
        let (hw, fb) = probe_hardware_adapter(wgpu_backends);
        (RenderMode::Gpu, hw, fb)
    } else {
        let (hw, fb) = probe_hardware_adapter(wgpu_backends);
        if hw.is_some() {
            (RenderMode::Gpu, hw, fb)
        } else {
            (RenderMode::EguiOnly, hw, fb)
        }
    };

    print_startup_diagnostics(
        &env,
        hardware_adapter.as_ref(),
        fallback_adapter.as_ref(),
        render_mode,
    );
    eprintln!("ECOS eframe: selected mode = {:?}", render_mode);

    let native_options = match render_mode {
        RenderMode::Gpu => {
            let adapter_selector: egui_wgpu::NativeAdapterSelectorMethod = std::sync::Arc::new(
                move |adapters: &[wgpu::Adapter], surface: Option<&wgpu::Surface<'_>>| {
                    for adapter in adapters {
                        let info = adapter.get_info();
                        let surface_ok = surface.map_or(true, |s| adapter.is_surface_supported(s));
                        if surface_ok && is_hardware_adapter(&info) {
                            eprintln!(
                                "ECOS eframe: selected hardware GPU '{}' ({:?})",
                                info.name, info.backend
                            );
                            return Ok(adapter.clone());
                        }
                    }

                    if let Some(adapter) = adapters.first() {
                        let info = adapter.get_info();
                        eprintln!(
                            "ECOS eframe: fallback to first adapter '{}' ({:?})",
                            info.name, info.backend
                        );
                        Ok(adapter.clone())
                    } else {
                        Err("No compatible graphics adapter found".to_string())
                    }
                },
            );

            eframe::NativeOptions {
                renderer: eframe::Renderer::Wgpu,
                viewport: eframe::egui::ViewportBuilder::default()
                    .with_inner_size([1280.0, 860.0])
                    .with_min_inner_size([960.0, 640.0])
                    .with_active(true),
                centered: true,
                wgpu_options: egui_wgpu::WgpuConfiguration {
                    wgpu_setup: egui_wgpu::WgpuSetup::CreateNew(egui_wgpu::WgpuSetupCreateNew {
                        instance_descriptor: wgpu::InstanceDescriptor {
                            backends: wgpu_backends,
                            ..Default::default()
                        },
                        power_preference: wgpu::PowerPreference::HighPerformance,
                        native_adapter_selector: Some(adapter_selector),
                        device_descriptor: std::sync::Arc::new(|adapter| {
                            let adapter_limits = adapter.limits();
                            let base_limits = if adapter.get_info().backend == wgpu::Backend::Gl {
                                wgpu::Limits::downlevel_webgl2_defaults()
                                    .using_resolution(adapter_limits)
                            } else {
                                wgpu::Limits::downlevel_defaults().using_resolution(adapter_limits)
                            };
                            wgpu::DeviceDescriptor {
                                label: Some("egui wgpu device"),
                                required_features: wgpu::Features::empty(),
                                required_limits: base_limits,
                                memory_hints: wgpu::MemoryHints::default(),
                            }
                        }),
                        ..Default::default()
                    }),
                    ..Default::default()
                },
                ..Default::default()
            }
        }
        RenderMode::Software | RenderMode::EguiOnly => eframe::NativeOptions {
            viewport: eframe::egui::ViewportBuilder::default()
                .with_inner_size(eframe::egui::vec2(800.0, 600.0))
                .with_resizable(true),
            ..Default::default()
        },
    };

    let manifest = args.manifest.clone();
    let mode = args.mode.clone();
    let edit_command_dir = args.edit_command_dir.clone();
    let edit_result_dir = args.edit_result_dir.clone();
    let edit_dirty = args.edit_dirty;
    let drc_data = args.drc_data.clone();
    let drc_statis = args.drc_statis.clone();
    let antenna_data = args.antenna_data.clone();
    let antenna_statis = args.antenna_statis.clone();
    let map_root = args.map_root.clone();

    let run_result = eframe::run_native(
        "Chip Viewer",
        native_options,
        Box::new(move |_cc| {
            let actual_render_mode = match render_mode {
                RenderMode::Gpu => {
                    let has_wgpu = _cc.wgpu_render_state.as_ref().is_some_and(|rs| {
                        let limits = rs.device.limits();
                        let info = rs.adapter.get_info();
                        limits.max_storage_buffers_per_shader_stage >= 1
                            && is_hardware_adapter(&info)
                    });
                    if has_wgpu {
                        RenderMode::Gpu
                    } else {
                        RenderMode::EguiOnly
                    }
                }
                RenderMode::Software => RenderMode::Software,
                RenderMode::EguiOnly => RenderMode::EguiOnly,
            };

            Ok(Box::new(ChipViewerApp::open(
                manifest,
                mode,
                edit_command_dir,
                edit_result_dir,
                edit_dirty,
                drc_data,
                drc_statis,
                antenna_data,
                antenna_statis,
                map_root,
                _cc.wgpu_render_state
                    .as_ref()
                    .map(|s| s.target_format)
                    .unwrap_or(wgpu::TextureFormat::Bgra8UnormSrgb),
                actual_render_mode,
            )))
        }),
    );

    match run_result {
        Ok(()) => Ok(()),
        Err(err) => {
            eprintln!("Chip Viewer windowing failure: {err}");

            let is_wayland_active = std::env::var_os("WAYLAND_DISPLAY").is_some();
            let has_x11_display = std::env::var_os("DISPLAY").is_some();
            let already_retried = std::env::var_os("ECOS_RESTARTED_WITH_X11").is_some();

            if cfg!(target_os = "linux") && is_wayland_active && has_x11_display && !already_retried
            {
                if !check_libxkbcommon_x11() {
                    eprintln!("ECOS: X11 window backend cannot be used because 'libxkbcommon-x11.so.0' is missing.");
                    eprintln!("Please install it with: sudo apt update && sudo apt install -y libxkbcommon-x11-0");
                    eprintln!(
                        "Or run ECOS Studio inside cage: cage -- ./ECOS-Studio... --no-sandbox"
                    );
                    std::process::exit(1);
                }

                eprintln!(
                    "ECOS: Wayland windowing failed ({err}). Restarting process with X11 window backend..."
                );
                let current_exe = std::env::current_exe()?;
                let mut cmd = std::process::Command::new(current_exe);
                cmd.args(std::env::args_os().skip(1));
                cmd.arg("--x11");
                cmd.env_remove("WAYLAND_DISPLAY");
                cmd.env_remove("WAYLAND_SOCKET");
                cmd.env("ECOS_WINDOW_BACKEND", "x11");
                cmd.env("ECOS_RESTARTED_WITH_X11", "1");
                let status = cmd.status()?;
                std::process::exit(status.code().unwrap_or(1));
            }

            eprintln!("Check that your display server (Wayland or X11) is running and accessible.");
            std::process::exit(1);
        }
    }
}
