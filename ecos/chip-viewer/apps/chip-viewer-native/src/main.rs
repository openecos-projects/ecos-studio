mod app;
mod camera3d;
mod canvas_gpu;
mod canvas_gpu3d;
mod map_data;
mod nav3d;

use std::path::PathBuf;

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

fn probe_gpu_backends(preferred: wgpu::Backends) -> wgpu::Backends {
    if try_adapter(wgpu::InstanceDescriptor {
        backends: preferred,
        ..Default::default()
    }) {
        return preferred;
    }

    let lvp = std::path::Path::new("/usr/share/vulkan/icd.d/lvp_icd.json");
    let lvp64 = std::path::Path::new("/usr/share/vulkan/icd.d/lvp_icd.x86_64.json");
    if lvp.exists() || lvp64.exists() {
        let path = if lvp.exists() { lvp } else { lvp64 };
        std::env::set_var("VK_ICD_FILENAMES", path);
        std::env::set_var("VK_DRIVER_FILES", path);
        if try_adapter(wgpu::InstanceDescriptor {
            backends: wgpu::Backends::VULKAN,
            ..Default::default()
        }) {
            return wgpu::Backends::VULKAN;
        }
    }

    if try_adapter(wgpu::InstanceDescriptor {
        backends: wgpu::Backends::GL,
        ..Default::default()
    }) {
        return wgpu::Backends::GL;
    }

    wgpu::Backends::empty()
}

fn try_adapter(desc: wgpu::InstanceDescriptor) -> bool {
    let instance = wgpu::Instance::new(&desc);
    pollster::block_on(instance.request_adapter(&wgpu::RequestAdapterOptions {
        power_preference: wgpu::PowerPreference::None,
        force_fallback_adapter: false,
        compatible_surface: None,
    }))
    .is_some()
}

fn main() -> Result<()> {
    let args = Args::parse();

    if cfg!(target_os = "linux") {
        let is_wsl = std::env::var_os("WSL_DISTRO_NAME").is_some()
            || std::env::var_os("WSL_INTEROP").is_some()
            || std::path::Path::new("/dev/dxg").exists();

        if is_wsl && std::env::var_os("WINIT_UNIX_BACKEND").is_none() {
            std::env::set_var("WINIT_UNIX_BACKEND", "x11");
        }
    }

    let force_cpu_env = std::env::var("ECOS_FORCE_CPU")
        .ok()
        .map(|v| canvas_gpu::env_flag_requested(Some(&v)))
        .unwrap_or(false);

    let resolved_backends = if force_cpu_env || args.force_cpu {
        wgpu::Backends::empty()
    } else {
        let env_backends = wgpu::Backends::from_env().unwrap_or(wgpu::Backends::all());
        probe_gpu_backends(env_backends)
    };

    let native_options = eframe::NativeOptions {
        viewport: eframe::egui::ViewportBuilder::default()
            .with_inner_size([1280.0, 860.0])
            .with_min_inner_size([960.0, 640.0])
            .with_active(true),
        centered: true,
        wgpu_options: egui_wgpu::WgpuConfiguration {
            wgpu_setup: egui_wgpu::WgpuSetup::CreateNew(egui_wgpu::WgpuSetupCreateNew {
                instance_descriptor: wgpu::InstanceDescriptor {
                    backends: resolved_backends,
                    ..Default::default()
                },
                power_preference: wgpu::PowerPreference::None,
                device_descriptor: std::sync::Arc::new(|adapter| {
                    let base_limits = if adapter.get_info().backend == wgpu::Backend::Gl {
                        wgpu::Limits::downlevel_webgl2_defaults()
                    } else {
                        wgpu::Limits::default()
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
            let has_wgpu = _cc
                .wgpu_render_state
                .as_ref()
                .is_some_and(|rs| rs.device.limits().max_storage_buffers_per_shader_stage >= 1)
                && !args.force_cpu;

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
            let msg = format!(
                "Chip Viewer failed to start.\n\n\
                 Error: {err}\n\n\
                "
            );
            eprintln!("{msg}");
            std::process::exit(1);
        }
    }
}
