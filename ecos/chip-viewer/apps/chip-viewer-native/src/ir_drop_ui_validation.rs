//! Opt-in standalone EMIR Map window using verified real solver samples.
use super::*;
use eframe::App;

struct Probe {
    app: ChipViewerApp,
    directory: PathBuf,
    sample: usize,
    selected: bool,
    requested: bool,
    settled: usize,
    started: Instant,
}
impl App for Probe {
    fn update(&mut self, ctx: &egui::Context, frame: &mut eframe::Frame) {
        if self.sample >= 2 {
            ctx.send_viewport_cmd(egui::ViewportCommand::Close);
            return;
        }
        assert!(self.started.elapsed() < Duration::from_secs(90));
        let screenshot = ctx.input(|i| {
            i.events.iter().find_map(|event| match event {
                egui::Event::Screenshot { image, .. } => Some(image.clone()),
                _ => None,
            })
        });
        if let Some(image) = screenshot {
            let name = ["native-vdd.png", "native-vss.png"][self.sample];
            let bytes: Vec<_> = image.pixels.iter().flat_map(|p| p.to_array()).collect();
            image::save_buffer(
                self.directory.join(name),
                &bytes,
                image.width() as u32,
                image.height() as u32,
                image::ColorType::Rgba8,
            )
            .unwrap();
            self.sample += 1;
            self.selected = false;
            self.requested = false;
            self.settled = 0;
            if self.sample == 2 {
                ctx.send_viewport_cmd(egui::ViewportCommand::Close);
                return;
            }
        }
        self.app.update(ctx, frame);
        match &mut self.app.state {
            ViewerState::Error(error) => panic!("{error}"),
            ViewerState::Loaded(loaded) => {
                if !self.selected {
                    let Some(catalog) = loaded.map_catalog.as_ref() else {
                        ctx.request_repaint();
                        return;
                    };
                    assert!(catalog.warnings.is_empty(), "{:?}", catalog.warnings);
                    assert_eq!(catalog.categories.len(), 2);
                    let item = catalog.categories[self.sample].items[0].clone();
                    loaded.activate_map_item(&item, None);

                    self.selected = true;
                }
                let Some(map) = loaded.active_heatmap.as_ref() else {
                    ctx.request_repaint();
                    return;
                };
                assert!(map.data.is_ir_drop());
                self.settled += 1;
                if self.settled > 8 && !self.requested {
                    ctx.send_viewport_cmd(egui::ViewportCommand::Screenshot(Default::default()));
                    self.requested = true;
                }
            }
            ViewerState::Loading(_) => {}
        }
        ctx.request_repaint();
    }
}

#[test]
#[ignore = "requires X11/GPU, ECOS_REPLAY_TEST_CATALOG and ECOS_IR_EVIDENCE"]
fn real_ir_standalone_screenshots() {
    use winit::platform::x11::EventLoopBuilderExtX11;
    let catalog: crate::replay::data::Catalog = crate::replay::data::read(Path::new(
        &std::env::var("ECOS_REPLAY_TEST_CATALOG").unwrap(),
    ))
    .unwrap();
    let step = catalog.steps.iter().find(|s| s.name == "emir").unwrap();
    let record =
        crate::replay::data::Recording::open(&catalog.workspace, step.manifest.as_ref().unwrap())
            .unwrap();
    let manifest = record.final_geometry_path().unwrap().unwrap();
    let source: serde_json::Value = crate::replay::data::read(
        &record
            .asset(record.manifest.analysis.as_ref().unwrap())
            .unwrap(),
    )
    .unwrap();
    let directory = PathBuf::from(std::env::var("ECOS_IR_EVIDENCE").unwrap());
    let map_root = directory.join("native-input");
    std::fs::create_dir_all(&map_root).unwrap();
    if source["geometry_display"] != true {
        // Adapt legacy structured Replay samples to the new native document envelope.
        // This is a visual test input; the benchmark workspace is never modified.
        let units = chipgeom_reader::read_manifest(&manifest)
            .unwrap()
            .dbu_per_micron
            .unwrap();
        let views: Vec<_> = source["views"]
            .as_array()
            .unwrap()
            .iter()
            .filter(|v| v["kind"] == "ir")
            .collect();
        let document = serde_json::json!({"schema":"ecos.emir.ir.v1","coordinate_unit":"dbu","dbu_per_micron":units,"views":views});
        std::fs::write(
            map_root.join("ir_drop.json"),
            serde_json::to_vec(&document).unwrap(),
        )
        .unwrap();
    }
    let mut options = crate::create_native_options(crate::RenderMode::Gpu, wgpu::Backends::VULKAN);
    options.event_loop_builder = Some(Box::new(|builder| {
        builder.with_any_thread(true);
    }));
    eframe::run_native(
        "EMIR standalone validation",
        options,
        Box::new(move |cc| {
            let format = cc.wgpu_render_state.as_ref().unwrap().target_format;
            let app = ChipViewerApp::open(
                manifest,
                "view".into(),
                None,
                None,
                false,
                None,
                None,
                None,
                None,
                None,
                None,
                Some(map_root),
                None,
                format,
                crate::RenderMode::Gpu,
            );
            Ok(Box::new(Probe {
                app,
                directory,
                sample: 0,
                selected: false,
                requested: false,
                settled: 0,
                started: Instant::now(),
            }))
        }),
    )
    .unwrap();
}
