mod app;
mod camera3d;
mod canvas_gpu;
mod canvas_gpu3d;
mod map_data;
mod nav3d;

use std::path::{Path, PathBuf};

use anyhow::Result;
use app::ChipViewerApp;
use clap::Parser;

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
        let has_dxg = Path::new("/dev/dxg").exists();
        let has_d3d12_mesa = Path::new("/usr/lib/x86_64-linux-gnu/dri/d3d12_dri.so").exists()
            || Path::new("/usr/lib/dri/d3d12_dri.so").exists();
        let has_dzn = (Path::new("/usr/share/vulkan/icd.d/dzn_icd.json").exists()
            || Path::new("/usr/share/vulkan/icd.d/dzn_icd.x86_64.json").exists())
            && (Path::new("/usr/lib/x86_64-linux-gnu/libvulkan_dzn.so").exists()
                || Path::new("/usr/lib/libvulkan_dzn.so").exists());

        Self {
            is_wsl,
            has_dxg,
            has_d3d12_mesa,
            has_dzn,
        }
    }

    fn configure_wsl_windowing(&self) {
        if self.is_wsl {
            if std::env::var_os("WAYLAND_DISPLAY").is_some() {
                std::env::remove_var("WAYLAND_DISPLAY");
            }
            if std::env::var_os("WINIT_UNIX_BACKEND").is_none() {
                std::env::set_var("WINIT_UNIX_BACKEND", "x11");
            }
        }
    }
}

fn is_software_adapter(info: &wgpu::AdapterInfo) -> bool {
    matches!(info.device_type, wgpu::DeviceType::Cpu)
        || info.name.to_ascii_lowercase().contains("llvmpipe")
        || info.name.to_ascii_lowercase().contains("softpipe")
        || info.driver.to_ascii_lowercase().contains("llvmpipe")
        || info.driver.to_ascii_lowercase().contains("swrast")
}

fn is_hardware_adapter(info: &wgpu::AdapterInfo) -> bool {
    !is_software_adapter(info)
}

fn probe_wgpu_adapter(backends: wgpu::Backends) -> Option<wgpu::AdapterInfo> {
    let instance = wgpu::Instance::new(&wgpu::InstanceDescriptor {
        backends,
        ..Default::default()
    });
    let adapter = pollster::block_on(instance.request_adapter(&wgpu::RequestAdapterOptions {
        power_preference: wgpu::PowerPreference::HighPerformance,
        compatible_surface: None,
        force_fallback_adapter: false,
    }))?;
    Some(adapter.get_info())
}

fn print_startup_diagnostics(
    env: &GraphicsEnvironment,
    adapter_info: Option<&wgpu::AdapterInfo>,
    has_hardware_gpu: bool,
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

    let gpu_device_str = adapter_info
        .map(|info| info.name.clone())
        .unwrap_or_else(|| "None / Unprobed".to_string());

    let backend_str = adapter_info
        .map(|info| format!("{:?}", info.backend))
        .unwrap_or_else(|| "None".to_string());

    let driver_str = adapter_info
        .map(|info| info.driver.clone())
        .unwrap_or_else(|| "None".to_string());

    let adapter_type_str = adapter_info
        .map(|info| {
            if is_software_adapter(info) {
                "Software / CPU rasterizer"
            } else {
                "Hardware Accelerated GPU"
            }
        })
        .unwrap_or("Unavailable");

    let rendering_mode = if has_hardware_gpu {
        "GPU Canvas (Hardware Accelerated)"
    } else {
        "CPU 2D (Software Fallback)"
    };

    let three_d_mode = if has_hardware_gpu {
        "Available (GPU Instanced)"
    } else {
        "Unavailable (Requires Hardware GPU)"
    };

    eprintln!("============================================================");
    eprintln!("ECOS Chip Viewer Graphics Diagnostic");
    eprintln!("------------------------------------------------------------");
    eprintln!("Platform:        {}", platform);
    if env.is_wsl {
        eprintln!(
            "WSL /dev/dxg:    {}",
            if env.has_dxg {
                "Available"
            } else {
                "Not found"
            }
        );
        eprintln!(
            "Mesa D3D12:      {}",
            if env.has_d3d12_mesa {
                "Available"
            } else {
                "Not found"
            }
        );
        eprintln!(
            "Vulkan Dozen:    {}",
            if env.has_dzn {
                "Available"
            } else {
                "Not found"
            }
        );
    }
    eprintln!("Adapter Name:    {}", gpu_device_str);
    eprintln!("Adapter Backend: {}", backend_str);
    eprintln!("Adapter Driver:  {}", driver_str);
    eprintln!("Adapter Type:    {}", adapter_type_str);
    eprintln!("------------------------------------------------------------");
    eprintln!("Rendering Mode:  {}", rendering_mode);
    eprintln!("3D Canvas:       {}", three_d_mode);
    eprintln!("============================================================");
}

fn main() -> Result<()> {
    let args = Args::parse();

    let env = GraphicsEnvironment::detect();
    env.configure_wsl_windowing();

    let force_cpu_env = std::env::var("ECOS_FORCE_CPU")
        .ok()
        .map(|v| canvas_gpu::env_flag_requested(Some(&v)))
        .unwrap_or(false);

    let wgpu_backends = wgpu::Backends::from_env().unwrap_or(wgpu::Backends::all());
    let probed_adapter = probe_wgpu_adapter(wgpu_backends);
    let is_hardware_gpu = probed_adapter.as_ref().is_some_and(is_hardware_adapter)
        && !args.force_cpu
        && !force_cpu_env;

    print_startup_diagnostics(&env, probed_adapter.as_ref(), is_hardware_gpu);

    let native_options = eframe::NativeOptions {
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
                power_preference: wgpu::PowerPreference::None,
                device_descriptor: std::sync::Arc::new(|adapter| {
                    let adapter_limits = adapter.limits();
                    let base_limits = if adapter.get_info().backend == wgpu::Backend::Gl {
                        wgpu::Limits::downlevel_webgl2_defaults().using_resolution(adapter_limits)
                    } else {
                        wgpu::Limits::downlevel_defaults().using_resolution(adapter_limits)
                    };
                    wgpu::DeviceDescriptor {
                        label: Some("egui wgpu device"),
                        required_features: wgpu::Features::default(),
                        required_limits: base_limits,
                        memory_hints: wgpu::MemoryHints::default(),
                    }
                }),
                ..Default::default()
            }),
            ..Default::default()
        },
        ..Default::default()
    };

    match eframe::run_native(
        "Chip Viewer",
        native_options,
        Box::new(move |_cc| {
            let has_wgpu = _cc.wgpu_render_state.as_ref().is_some_and(|rs| {
                let limits = rs.device.limits();
                let info = rs.adapter.get_info();
                limits.max_storage_buffers_per_shader_stage >= 1 && is_hardware_adapter(&info)
            }) && !args.force_cpu
                && !force_cpu_env;

            Ok(Box::new(ChipViewerApp::open(
                args.manifest.clone(),
                args.mode.clone(),
                args.edit_command_dir.clone(),
                args.edit_result_dir.clone(),
                args.edit_dirty,
                args.drc_data.clone(),
                args.drc_statis.clone(),
                args.antenna_data.clone(),
                args.antenna_statis.clone(),
                args.map_root.clone(),
                _cc.wgpu_render_state
                    .as_ref()
                    .map(|s| s.target_format)
                    .unwrap_or(wgpu::TextureFormat::Bgra8UnormSrgb),
                has_wgpu,
            )))
        }),
    ) {
        Ok(()) => Ok(()),
        Err(err) => {
            eprintln!("Chip Viewer encountered a windowing error: {err}");
            std::process::exit(1);
        }
    }
}
