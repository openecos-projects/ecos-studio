//! Opt-in screenshots of signoff cards using existing workspace reports.
use super::*;
use std::{path::PathBuf, time::Instant};

struct Preview {
    summary: SignoffSummary,
    directory: PathBuf,
    started: Instant,
    frames: usize,
    sample: usize,
}

impl eframe::App for Preview {
    fn update(&mut self, ctx: &egui::Context, _frame: &mut eframe::Frame) {
        assert!(
            self.started.elapsed().as_secs() < 60,
            "Screenshot timed out"
        );
        let screenshot = ctx.input(|input| {
            input.events.iter().find_map(|event| match event {
                egui::Event::Screenshot { image, .. } => Some(image.clone()),
                _ => None,
            })
        });
        if let Some(image) = screenshot {
            let name = [
                "signoff-reveal-1.png",
                "signoff-reveal-2.png",
                "signoff-reveal-3.png",
                "signoff-desktop.png",
                "signoff-laptop.png",
                "signoff-small.png",
            ][self.sample];
            let pixels: Vec<_> = image
                .pixels
                .iter()
                .flat_map(|pixel| pixel.to_array())
                .collect();
            image::save_buffer(
                self.directory.join(name),
                &pixels,
                image.width() as u32,
                image.height() as u32,
                image::ColorType::Rgba8,
            )
            .unwrap();
            self.sample += 1;
            if self.sample == 6 {
                ctx.send_viewport_cmd(egui::ViewportCommand::Close);
                return;
            }
            self.frames = 0;
            ctx.send_viewport_cmd(egui::ViewportCommand::InnerSize(if self.sample == 4 {
                Vec2::new(1440.0, 900.0)
            } else if self.sample == 5 {
                Vec2::new(800.0, 600.0)
            } else {
                Vec2::new(1920.0, 1200.0)
            }));
        }
        egui::TopBottomPanel::top("toolbar").show(ctx, |ui| {
            ui.heading("Layout Replay");
        });
        egui::TopBottomPanel::bottom("timeline")
            .exact_height(160.0)
            .show(ctx, |ui| {
                ui.label("Harden / completed");
                ui.add_space(28.0);
                ui.add(egui::ProgressBar::new(1.0).text("Replay complete"));
                ui.add_space(12.0);
                ui.horizontal(|ui| {
                    let _ = ui.button("Previous step");
                    let _ = ui.button("Play from start");
                    ui.label("Harden");
                });
            });
        let display = egui::CentralPanel::default().show(ctx, |_| {});
        // Hold representative animation phases to capture the real native painter.
        let elapsed = if self.sample < 3 {
            self.sample as f64 * (REVEAL_SECONDS + REVEAL_GAP_SECONDS) + REVEAL_SECONDS / 2.0
        } else {
            ENTRANCE_SECONDS + 1.0
        };
        let now = ctx.input(|i| i.time);
        ctx.data_mut(|data| data.insert_temp(Id::new("signoff_entrance_start"), now - elapsed));
        let overlay = show(ctx, &self.summary, display.response.rect);
        assert!(
            overlay.rect.bottom() <= display.response.rect.bottom(),
            "overlay covers playback controls"
        );
        self.frames += 1;
        if self.frames == 10 {
            ctx.send_viewport_cmd(egui::ViewportCommand::Screenshot(Default::default()));
        }
        ctx.request_repaint();
    }
}

#[test]
#[ignore = "requires X11, ECOS_SIGNOFF_TEST_WORKSPACE and ECOS_SIGNOFF_EVIDENCE"]
fn existing_workspace_reports_render_in_native_windows() {
    use winit::platform::x11::EventLoopBuilderExtX11;
    let workspace = PathBuf::from(std::env::var("ECOS_SIGNOFF_TEST_WORKSPACE").unwrap());
    let directory = PathBuf::from(std::env::var("ECOS_SIGNOFF_EVIDENCE").unwrap());
    let summary = crate::replay::dashboard::Dashboard::load(&workspace, &[]).signoff;
    assert!(!summary.design.name.is_empty());
    assert!(summary.qor.score.is_some());
    assert!(summary.checklist.passed.is_some());
    assert!(
        summary.details.design_error.is_empty(),
        "{}",
        summary.details.design_error
    );
    assert!(!summary.details.design.is_empty());
    assert!(!summary.details.checks.is_empty());
    println!(
        "Existing signoff reports: {} design sections, {} table rows, {} checklist items",
        summary.details.design.len(),
        summary
            .details
            .design
            .iter()
            .map(|s| s.rows.len())
            .sum::<usize>(),
        summary.details.checks.len()
    );
    std::fs::create_dir_all(&directory).unwrap();
    let options = eframe::NativeOptions {
        renderer: eframe::Renderer::Glow,
        viewport: egui::ViewportBuilder::default().with_inner_size([1920.0, 1200.0]),
        event_loop_builder: Some(Box::new(|builder| {
            builder.with_any_thread(true);
        })),
        ..Default::default()
    };
    eframe::run_native(
        "Replay signoff validation",
        options,
        Box::new(move |_| {
            Ok(Box::new(Preview {
                summary,
                directory,
                started: Instant::now(),
                frames: 0,
                sample: 0,
            }))
        }),
    )
    .unwrap();
}
