mod app;

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
}

fn main() -> Result<()> {
    let args = Args::parse();
    let native_options = eframe::NativeOptions {
        viewport: eframe::egui::ViewportBuilder::default()
            .with_inner_size([1280.0, 860.0])
            .with_min_inner_size([960.0, 640.0]),
        ..Default::default()
    };
    eframe::run_native(
        "Chip Viewer",
        native_options,
        Box::new(move |_cc| {
            Ok(Box::new(ChipViewerApp::open(
                args.manifest.clone(),
                args.mode.clone(),
                args.edit_command_dir.clone(),
                args.edit_result_dir.clone(),
            )))
        }),
    )
    .map_err(|err| anyhow::anyhow!(err.to_string()))
}
