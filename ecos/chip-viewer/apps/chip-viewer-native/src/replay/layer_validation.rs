//! Opt-in real-window evidence for stage focus and the DRC result sweep.
use super::*;
use eframe::App;
use std::{
    path::PathBuf,
    sync::{
        atomic::{AtomicUsize, Ordering},
        Arc,
    },
    time::Duration,
};

const SAMPLES: [(&str, &str, f64); 7] = [
    ("postFloorplan", "stripes", 0.6),
    ("place", "", 0.5),
    ("route", "detailed_route_final", 0.6),
    ("drc", "review", 0.4),
    ("drc", "review", 2.2),
    ("drc", "review", 5.0),
    ("drc", "complete", 0.0),
];

struct Probe {
    app: ReplayApp,
    directory: PathBuf,
    done: Arc<AtomicUsize>,
    started: Instant,
    selected: bool,
    settled: usize,
    requested: bool,
}
impl App for Probe {
    fn update(&mut self, ctx: &egui::Context, frame: &mut eframe::Frame) {
        assert!(
            self.started.elapsed() < Duration::from_secs(180),
            "Layer review timed out"
        );
        if let Some(image) = ctx.input(|input| {
            input.events.iter().find_map(|event| match event {
                egui::Event::Screenshot { image, .. } => Some(image.clone()),
                _ => None,
            })
        }) {
            let sample = self.done.load(Ordering::Relaxed);
            let pixels: Vec<u8> = image.pixels.iter().flat_map(|p| p.to_array()).collect();
            image::save_buffer(
                self.directory
                    .join(format!("layer-{sample}-{}.png", SAMPLES[sample].0)),
                &pixels,
                image.width() as u32,
                image.height() as u32,
                image::ColorType::Rgba8,
            )
            .unwrap();
            self.done.fetch_add(1, Ordering::Relaxed);
            self.selected = false;
            self.settled = 0;
            self.requested = false;
        }
        let sample = self.done.load(Ordering::Relaxed);
        if sample == SAMPLES.len() {
            ctx.send_viewport_cmd(egui::ViewportCommand::Close);
            return;
        }
        self.app.playing = false;
        if self.app.preparation.is_none() && self.app.pending.is_none() && !self.selected {
            let (name, phase, offset) = SAMPLES[sample];
            let step = self
                .app
                .catalog
                .steps
                .iter()
                .position(|s| s.name.eq_ignore_ascii_case(name))
                .expect(name);
            let plan = &self.app.plans[step];
            assert!(plan.error.is_empty(), "{}", plan.error);
            let local = match phase {
                "complete" => plan.seconds,
                "review" => plan.process_seconds + plan::RESULT_SECONDS + offset,
                _ => {
                    let record = Recording::open(
                        &self.app.catalog.workspace,
                        self.app.catalog.steps[step].manifest.as_ref().unwrap(),
                    )
                    .unwrap();
                    let clip = if phase.is_empty() {
                        &plan.clips[plan.clips.len() / 2]
                    } else {
                        plan.clips
                            .iter()
                            .find(|c| record.manifest.frames[c.frame].phase == phase)
                            .expect(phase)
                    };
                    clip.start + (clip.end - clip.start) * offset
                }
            };
            self.app.view3d.enabled = true;
            self.app.view3d.auto_spin = false;
            self.app.view3d.automatic = true;
            self.app.view3d.needs_prepare = true;
            self.app.analysis_open = false;
            self.app
                .select(step, self.app.starts[step] + local, phase == "complete");
            self.selected = true;
        }
        self.app.update(ctx, frame);
        if self.selected && self.app.pending.is_none() && !self.requested {
            assert!(self.app.error.is_empty(), "{}", self.app.error);
            assert!(
                self.app.view3d.error.is_empty(),
                "{}",
                self.app.view3d.error
            );
            assert!(
                self.app.analysis.error.is_empty(),
                "{}",
                self.app.analysis.error
            );
            self.settled += 1;
            if self.settled == 10 {
                let style = self.app.layer_transition();
                if (3..6).contains(&sample) {
                    let scan = self.app.analysis.drc_scan().expect("DRC scan");
                    assert_eq!(scan.layer, [0, 2, 5][sample - 3]);
                    assert_eq!(style, scan.transition);
                }
                if sample == 6 {
                    assert!(self.app.analysis.drc_scan().is_none());
                    assert_eq!(style, layer_focus::Transition::default());
                }
                // Manual visibility suspends policy; camera control does not.
                self.app.view3d.auto_layers = false;
                assert_eq!(
                    self.app.layer_transition(),
                    layer_focus::Transition::default()
                );
                self.app.view3d.auto_layers = true;
                assert_eq!(self.app.layer_transition(), style);
                println!("{}: {} · {:?}", sample, self.app.current_phase(), style);
                ctx.send_viewport_cmd(egui::ViewportCommand::Screenshot(Default::default()));
                self.requested = true;
            }
        }
        ctx.request_repaint();
    }
}

#[test]
#[ignore = "requires X11/GPU, ECOS_REPLAY_TEST_CATALOG and ECOS_LAYER_EVIDENCE"]
fn real_stage_layers_and_drc_screenshots() {
    use winit::platform::x11::EventLoopBuilderExtX11;
    let path = std::env::var("ECOS_REPLAY_TEST_CATALOG").unwrap();
    let directory = PathBuf::from(std::env::var("ECOS_LAYER_EVIDENCE").unwrap());
    std::fs::create_dir_all(&directory).unwrap();
    let done = Arc::new(AtomicUsize::new(0));
    let observed = done.clone();
    let mut options = crate::create_native_options(crate::RenderMode::Gpu, wgpu::Backends::VULKAN);
    options.event_loop_builder = Some(Box::new(|builder| {
        builder.with_any_thread(true);
    }));
    eframe::run_native(
        "Replay layer validation",
        options,
        Box::new(move |cc| {
            let mut app = ReplayApp::open(Path::new(&path))?;
            app.configure_renderer(cc);
            Ok(Box::new(Probe {
                app,
                directory,
                done,
                started: Instant::now(),
                selected: false,
                settled: 0,
                requested: false,
            }))
        }),
    )
    .unwrap();
    assert_eq!(observed.load(Ordering::Relaxed), SAMPLES.len());
}
