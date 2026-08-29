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

fn main() -> Result<()> {
    let mut args = Args::parse();
    let mut wgpu_backends = wgpu::Backends::from_env().unwrap_or(wgpu::Backends::all());
    if std::env::var_os("WINIT_UNIX_BACKEND").is_none() {
        let is_wsl = std::env::var_os("WSL_DISTRO_NAME").is_some()
            || std::env::var_os("WSL_INTEROP").is_some()
            || std::path::Path::new("/dev/dxg").exists();
        if is_wsl && !std::path::Path::new("/dev/dri").exists() {
            std::env::set_var("WINIT_UNIX_BACKEND", "x11");
            if std::env::var_os("VK_ICD_FILENAMES").is_none()
                && std::path::Path::new("/usr/share/vulkan/icd.d/lvp_icd.json").exists()
            {
                std::env::set_var("VK_ICD_FILENAMES", "/usr/share/vulkan/icd.d/lvp_icd.json");
            } else {
                wgpu_backends = wgpu::Backends::GL;
                args.force_cpu = true;
            }
        }
    }

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
    eframe::run_native(
        "Chip Viewer",
        native_options,
        Box::new(move |_cc| {
            let has_wgpu = if let Some(render_state) = _cc.wgpu_render_state.as_ref() {
                let limits = render_state.device.limits();
                let supports_storage_buffers = limits.max_storage_buffers_per_shader_stage >= 1;
                supports_storage_buffers && !args.force_cpu
            } else {
                false
            };
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
    )
    .map_err(|err| anyhow::anyhow!(err.to_string()))
}
