//! Opt-in actual-window checks against a completed EMIR recording.
use super::*;
use eframe::App;
use std::{path::PathBuf, time::Duration};

#[test]
#[ignore = "requires ECOS_REPLAY_TEST_CATALOG with a completed EMIR attempt"]
fn real_ir_values_and_seek_match_structured_solver_nodes() {
    let catalog: Catalog = read(Path::new(
        &std::env::var("ECOS_REPLAY_TEST_CATALOG").unwrap(),
    ))
    .unwrap();
    let step = catalog
        .steps
        .iter()
        .find(|step| step.name == "emir")
        .unwrap();
    let record = Recording::open(&catalog.workspace, step.manifest.as_ref().unwrap()).unwrap();
    let data = crate::replay::analysis_data::load(&record).unwrap();
    for view in data.views.iter().filter(|v| v.kind == "ir") {
        let map = crate::ir_drop::IrDrop::from_view(view).unwrap();
        let expected = view
            .items
            .iter()
            .filter_map(|i| i.value)
            .fold(0.0, f64::max)
            * 1000.0;
        let actual = map
            .all
            .cells()
            .filter_map(|((r, c), _)| map.all.value(r, c))
            .fold(0.0, f64::max);
        assert_eq!(expected, actual);
        assert_eq!(map.layers.len(), 5);
        println!(
            "{}: {} nodes, {} layers, max {:.12} mV",
            view.label,
            map.samples,
            map.layers.len(),
            actual
        );
    }
    let mut analysis = crate::replay::analysis::ReplayAnalysis::open(&record);
    assert!(analysis.error.is_empty(), "{}", analysis.error);
    analysis.auto_select_time(1.5);
    let first = analysis.selected_label().unwrap().to_owned();
    analysis.auto_select_time(4.0);
    assert_ne!(analysis.selected_label(), Some(first.as_str()));
    analysis.auto_select_time(1.5);
    assert_eq!(analysis.selected_label(), Some(first.as_str()));
}

struct Probe {
    app: ReplayApp,
    directory: PathBuf,
    started: Instant,
    sample: usize,
    selected: bool,
    settled: usize,
    requested: bool,
}
impl App for Probe {
    fn update(&mut self, ctx: &egui::Context, frame: &mut eframe::Frame) {
        if self.sample >= 4 {
            ctx.send_viewport_cmd(egui::ViewportCommand::Close);
            return;
        }
        assert!(
            self.started.elapsed() < Duration::from_secs(120),
            "IR screenshot timeout"
        );
        let image = ctx.input(|i| {
            i.events.iter().find_map(|event| match event {
                egui::Event::Screenshot { image, .. } => Some(image.clone()),
                _ => None,
            })
        });
        if let Some(image) = image {
            let name = [
                "replay-vdd-half.png",
                "replay-vdd-full.png",
                "replay-vss-full.png",
                "replay-vdd-3d.png",
            ][self.sample];
            let pixels: Vec<u8> = image.pixels.iter().flat_map(|p| p.to_array()).collect();
            image::save_buffer(
                self.directory.join(name),
                &pixels,
                image.width() as u32,
                image.height() as u32,
                image::ColorType::Rgba8,
            )
            .unwrap();
            self.sample += 1;
            self.selected = false;
            self.requested = false;
            self.settled = 0;
            if self.sample == 4 {
                ctx.send_viewport_cmd(egui::ViewportCommand::Close);
                return;
            }
        }
        self.app.playing = false;
        if self.app.preparation.is_none() && self.app.pending.is_none() && !self.selected {
            let step = self
                .app
                .catalog
                .steps
                .iter()
                .position(|s| s.name == "emir")
                .unwrap();
            self.app.view3d.auto_spin = false;
            self.app.view3d.enabled = self.sample == 3;
            self.app.view3d.needs_prepare = true;
            let offset = [1.5, 3.2, 7.2, 3.2][self.sample];
            let position = self.app.starts[step]
                + self.app.plans[step].process_seconds
                + plan::RESULT_SECONDS
                + offset;
            self.app.select(step, position, false);
            self.app.analysis_open = self.sample != 3;
            self.selected = true;
        }
        self.app.update(ctx, frame);
        assert!(self.app.error.is_empty(), "{}", self.app.error);
        assert!(
            self.app.analysis.error.is_empty(),
            "{}",
            self.app.analysis.error
        );
        if self.selected && self.app.pending.is_none() && !self.requested {
            self.settled += 1;
            if self.settled > 8 {
                assert!(self.app.analysis.selected_label().is_some());
                ctx.send_viewport_cmd(egui::ViewportCommand::Screenshot(Default::default()));
                self.requested = true;
            }
        }
        ctx.request_repaint();
    }
}

#[test]
#[ignore = "requires X11/GPU, ECOS_REPLAY_TEST_CATALOG and ECOS_IR_EVIDENCE"]
fn real_ir_replay_screenshots() {
    use winit::platform::x11::EventLoopBuilderExtX11;
    let path = std::env::var("ECOS_REPLAY_TEST_CATALOG").unwrap();
    let directory = PathBuf::from(std::env::var("ECOS_IR_EVIDENCE").unwrap());
    std::fs::create_dir_all(&directory).unwrap();
    let mut options = crate::create_native_options(crate::RenderMode::Gpu, wgpu::Backends::VULKAN);
    options.event_loop_builder = Some(Box::new(|builder| {
        builder.with_any_thread(true);
    }));
    eframe::run_native(
        "EMIR heatmap validation",
        options,
        Box::new(move |cc| {
            let mut app = ReplayApp::open(Path::new(&path))?;
            app.configure_renderer(cc);
            Ok(Box::new(Probe {
                app,
                directory,
                started: Instant::now(),
                sample: 0,
                selected: false,
                settled: 0,
                requested: false,
            }))
        }),
    )
    .unwrap();
}

#[test]
#[ignore = "requires ECOS_REPLAY_TEST_CATALOG with native geometry analyses"]
fn real_geometry_catalog_duration_matches_decoded_views() {
    let catalog: Catalog = read(Path::new(
        &std::env::var("ECOS_REPLAY_TEST_CATALOG").unwrap(),
    ))
    .unwrap();
    let step = catalog.steps.iter().find(|s| s.name == "emir").unwrap();
    let record = Recording::open(&catalog.workspace, step.manifest.as_ref().unwrap()).unwrap();
    let analysis = analysis::ReplayAnalysis::open(&record);
    assert!(analysis.error.is_empty(), "{}", analysis.error);
    assert_eq!(
        analysis_data::duration(&record).unwrap(),
        analysis.duration()
    );
}
