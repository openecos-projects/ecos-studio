//! Opt-in real-window measurements. Screenshot latency includes GPU readback;
//! it is an upper bound, not a claim about physical monitor presentation time.
use super::ReplayApp;
use eframe::App;
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

#[derive(Default, Debug)]
struct Measurements {
    cpu_ms: Vec<f64>,
    frame_intervals_ms: Vec<f64>,
    seek_readback_ms: Vec<f64>,
    seek_ready_ms: Vec<f64>,
    seek_update_ms: Vec<f64>,
    prepare_ms: [Vec<f64>; 4],
    finished: bool,
}

struct Probe {
    app: ReplayApp,
    selected_step: Option<usize>,
    measurements: Arc<Mutex<Measurements>>,
    started: Instant,
    playback_until: Option<Instant>,
    previous_frame: Option<Instant>,
    seek: Option<(Instant, usize)>,
    screenshot: bool,
    seed: u64,
}

impl App for Probe {
    fn update(&mut self, ctx: &egui::Context, frame: &mut eframe::Frame) {
        if self.app.view3d.enabled && self.app.pending.is_none() && self.app.recording.is_some() {
            assert!(
                self.app.view3d.error.is_empty(),
                "3D preparation: {}",
                self.app.view3d.error
            );
        }
        assert!(
            self.started.elapsed() < Duration::from_secs(900),
            "UI probe timed out"
        );
        let now = Instant::now();
        if self.screenshot && ctx.input(|i| i.events.iter().any(|event| {
            matches!(event, egui::Event::Screenshot { image, .. } if image.width() >= 960 && image.height() >= 640)
        })) {
            let (start, target) = self.seek.take().unwrap();
            assert_eq!(self.app.recording.as_ref().unwrap().scene.revision, Some(target));
            let mut results = self.measurements.lock().unwrap();
            results.seek_readback_ms.push(start.elapsed().as_secs_f64() * 1000.0);
            self.screenshot = false;
            if results.seek_readback_ms.len() % 10 == 0 {
                println!("Replay GPU probe: {} / 100 seeks", results.seek_readback_ms.len());
            }
            if results.seek_readback_ms.len() == 100 {
                results.finished = true;
                ctx.send_viewport_cmd(egui::ViewportCommand::Close);
                return;
            }
        }
        if self.app.preparation.is_none() && self.app.pending.is_none() {
            if self.playback_until.is_none() {
                self.playback_until = Some(now + Duration::from_secs(30));
                if let Some(step) = self.selected_step {
                    self.app.select(step, self.app.starts[step], false);
                }
                self.app.playing = true;
                self.app.tick = now;
            }
            if self.playback_until.is_some_and(|end| now < end) && self.app.playing {
                if let Some(previous) = self.previous_frame {
                    let mut results = self.measurements.lock().unwrap();
                    results
                        .frame_intervals_ms
                        .push((now - previous).as_secs_f64() * 1000.0);
                    if let Some(cpu) = frame.info().cpu_usage {
                        results.cpu_ms.push(f64::from(cpu) * 1000.0);
                    }
                }
                self.previous_frame = Some(now);
            } else if self.seek.is_none() {
                self.previous_frame = None;
                self.app.playing = false;
                self.seed = self.seed.wrapping_mul(6364136223846793005).wrapping_add(1);
                let available: Vec<_> = self
                    .app
                    .plans
                    .iter()
                    .enumerate()
                    .filter(|(step, plan)| {
                        self.selected_step.is_none_or(|selected| selected == *step)
                            && !plan.clips.is_empty()
                            && plan.error.is_empty()
                    })
                    .collect();
                assert!(!available.is_empty(), "No replayable clips");
                let (step, plan) = available[(self.seed >> 32) as usize % available.len()];
                let clip = &plan.clips[(self.seed >> 16) as usize % plan.clips.len()];
                let target = clip.frame;
                let position = self.app.starts[step] + clip.start;
                let record = crate::replay::data::Recording::open(
                    &self.app.catalog.workspace,
                    self.app.catalog.steps[step].manifest.as_ref().unwrap(),
                )
                .unwrap();
                let source = record.manifest.frames[target].elapsed_ns as f64 / 1e9;
                self.seek = Some((
                    Instant::now(),
                    self.app.plans[step].frame_at_source(source).unwrap(),
                ));
                self.app.select_node(step, position, Some(source));
            }
        } else {
            self.previous_frame = None;
        }
        let update_started = Instant::now();
        self.app.update(ctx, frame);
        let update_ms = update_started.elapsed().as_secs_f64() * 1000.0;
        assert!(self.app.error.is_empty(), "{}", self.app.error);
        if let Some((started, target)) = self.seek {
            if self.app.pending.is_none()
                && self
                    .app
                    .recording
                    .as_ref()
                    .is_some_and(|r| r.scene.revision == Some(target))
                && !self.screenshot
            {
                let mut results = self.measurements.lock().unwrap();
                results
                    .seek_ready_ms
                    .push(started.elapsed().as_secs_f64() * 1000.0);
                results.seek_update_ms.push(update_ms);
                for (samples, time) in results
                    .prepare_ms
                    .iter_mut()
                    .zip(self.app.prepare_timings_ms)
                {
                    samples.push(time);
                }
                self.screenshot = true;
                ctx.send_viewport_cmd(egui::ViewportCommand::Screenshot(Default::default()));
            }
        }
        ctx.request_repaint();
    }
}

fn p95(samples: &mut [f64]) -> f64 {
    assert!(!samples.is_empty());
    samples.sort_by(f64::total_cmp);
    samples[(samples.len() * 95).div_ceil(100).saturating_sub(1)]
}

#[test]
#[ignore = "requires X11/GPU and ECOS_REPLAY_TEST_CATALOG; measures 30s playback and 100 seeks"]
fn real_window_gpu_playback_and_seek_readback() {
    use winit::platform::x11::EventLoopBuilderExtX11;
    let path = std::env::var("ECOS_REPLAY_TEST_CATALOG").expect("catalog path");
    let measurements = Arc::new(Mutex::new(Measurements::default()));
    let results = measurements.clone();
    let mut options = crate::create_native_options(crate::RenderMode::Gpu, wgpu::Backends::VULKAN);
    options.event_loop_builder = Some(Box::new(|builder| {
        builder.with_any_thread(true);
    }));
    eframe::run_native(
        "Replay GPU validation",
        options,
        Box::new(move |cc| {
            let gpu = cc.wgpu_render_state.as_ref().expect("wgpu renderer");
            println!("Replay GPU adapter: {:?}", gpu.adapter.get_info());
            let mut app = ReplayApp::open(std::path::Path::new(&path))?;
            app.configure_renderer(cc);
            if std::env::var_os("ECOS_REPLAY_TEST_3D").is_some() {
                app.view3d.enabled = true;
            }
            let selected_step = std::env::var("ECOS_REPLAY_TEST_STEP").ok().map(|name| {
                app.catalog
                    .steps
                    .iter()
                    .position(|step| step.name == name)
                    .expect("requested step missing")
            });
            println!(
                "Replay GPU scope: {}",
                selected_step.map_or("all catalog steps", |step| app.catalog.steps[step]
                    .name
                    .as_str())
            );
            Ok(Box::new(Probe {
                app,
                selected_step,
                measurements,
                started: Instant::now(),
                playback_until: None,
                previous_frame: None,
                seek: None,
                screenshot: false,
                seed: 0x78561432,
            }))
        }),
    )
    .unwrap();
    let mut results = results.lock().unwrap();
    assert!(
        results.finished,
        "Window closed before measurements completed"
    );
    let count = results.frame_intervals_ms.len();
    let cpu = p95(&mut results.cpu_ms);
    let interval = p95(&mut results.frame_intervals_ms);
    let seek = p95(&mut results.seek_readback_ms);
    println!("Replay GPU UI: {count} active frames, CPU+render P95={cpu:.1}ms, frame interval P95={interval:.1}ms, request-to-GPU-readback P95={seek:.1}ms (100 seeks)");
    let ready = p95(&mut results.seek_ready_ms);
    let update = p95(&mut results.seek_update_ms);
    let phases = results.prepare_ms.each_mut().map(|samples| p95(samples));
    println!("Replay seek phases P95: ready={ready:.1}ms, update-with-first-mesh={update:.1}ms, reconstruct={:.1}ms, index={:.1}ms, assets={:.1}ms, handoff-clone={:.1}ms", phases[0], phases[1], phases[2], phases[3]);
}
