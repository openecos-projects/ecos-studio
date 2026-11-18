use super::*;
use crate::replay::dashboard::{
    signoff_report::{Field, ReportDetails, Section},
    ChecklistSummary, DesignSummary, QorSummary,
};

fn summary() -> SignoffSummary {
    SignoffSummary {
        design: DesignSummary {
            name: "aes".into(),
            top_module: "aes_cipher_top".into(),
            pdk: "ics55".into(),
            harden_state: "Success".into(),
        },
        qor: QorSummary {
            score: Some(70.3279),
            scalar_status: "ORANGE".into(),
            feasibility_status: "PASS".into(),
            gate_summary: "7 pass · 0 attention · 0 blocked".into(),
        },
        checklist: ChecklistSummary {
            status: "attention".into(),
            passed: Some(36),
            attention: Some(2),
            blocked: Some(0),
            unavailable: Some(0),
        },
        details: ReportDetails {
            design: vec![Section {
                title: "1. PHYSICAL & AREA METRICS".into(),
                fields: (0..80)
                    .map(|i| Field {
                        label: format!("Report field {i}"),
                        value: "55,743.12 µm² with a long descriptive value".into(),
                        note: String::new(),
                    })
                    .collect(),
                ..Default::default()
            }],
            ..Default::default()
        },
    }
}
fn texts(shape: &egui::Shape, result: &mut Vec<(String, egui::Rect, bool)>) {
    match shape {
        egui::Shape::Text(t) => result.push((
            t.galley.job.text.clone(),
            t.galley.rect.translate(t.pos.to_vec2()),
            t.galley.elided,
        )),
        egui::Shape::Vec(v) => {
            for s in v {
                texts(s, result)
            }
        }
        _ => {}
    }
}
#[test]
fn cards_fit_above_playback_controls_and_text_wraps_without_overflow() {
    for size in [
        Vec2::new(1920.0, 1080.0),
        Vec2::new(1440.0, 900.0),
        Vec2::new(800.0, 600.0),
        Vec2::new(640.0, 480.0),
        Vec2::new(480.0, 360.0),
    ] {
        let ctx = egui::Context::default();
        let screen = egui::Rect::from_min_size(egui::Pos2::ZERO, size);
        let mut rect = egui::Rect::NOTHING;
        let mut bounds = egui::Rect::NOTHING;
        let mut timeline = egui::Rect::NOTHING;
        let mut output = egui::FullOutput::default();
        for frame in 0..4 {
            output = ctx.run(
                egui::RawInput {
                    screen_rect: Some(screen),
                    time: Some(frame as f64),
                    ..Default::default()
                },
                |ctx| {
                    egui::TopBottomPanel::top("toolbar")
                        .exact_height(32.0)
                        .show(ctx, |_| {});
                    timeline = egui::TopBottomPanel::bottom("timeline")
                        .exact_height(160.0)
                        .show(ctx, |_| {})
                        .response
                        .rect;
                    bounds = egui::CentralPanel::default()
                        .show(ctx, |_| {})
                        .response
                        .rect;
                    rect = show(ctx, &summary(), bounds).rect;
                },
            );
        }
        assert!(bounds.contains_rect(rect), "{bounds:?}: {rect:?}");
        assert!(
            rect.bottom() <= timeline.top() - 10.0,
            "{rect:?} overlaps {timeline:?}"
        );
        assert!(
            rect.center().distance(bounds.center()) < 1.0,
            "{screen:?}: {rect:?}"
        );
        let mut rendered = Vec::new();
        let scrim = output.shapes.iter().position(|s| matches!(&s.shape,egui::Shape::Rect(r) if r.fill == Color32::from_rgba_unmultiplied(5,12,22,100))).expect("background scrim");
        let first_text = output
            .shapes
            .iter()
            .position(|s| matches!(&s.shape, egui::Shape::Text(_)))
            .expect("card text");
        assert!(scrim < first_text, "scrim must not darken the card text");
        for s in &output.shapes {
            texts(&s.shape, &mut rendered);
        }
        if size.x < 800.0 {
            continue;
        } // Smaller windows expose the rest via horizontal scrolling.
        let titles: Vec<_> = ["01 / DESIGN", "02 / QOR", "03 / CHECKLIST"]
            .map(|s| rendered.iter().find(|(t, _, _)| t == s).expect(s))
            .into();
        for pair in titles.windows(2) {
            assert!(pair[0].1.right() < pair[1].1.left());
            assert!((pair[0].1.top() - pair[1].1.top()).abs() < 1.0);
        }
        for (t, r, elided) in &rendered {
            assert!(!elided, "truncated: {t}");
            if t.starts_with("Report field") || t.starts_with("55,743") {
                assert!(
                    r.left() >= rect.left() && r.right() <= titles[1].1.left(),
                    "overflows design card: {t} {r:?}"
                );
            }
        }
    }
}
#[test]
fn report_scroll_reveals_final_fields() {
    let ctx = egui::Context::default();
    let screen = egui::Rect::from_min_size(egui::Pos2::ZERO, Vec2::new(1440.0, 900.0));
    let mut output = egui::FullOutput::default();
    for i in 0..10 {
        output = ctx.run(
            egui::RawInput {
                screen_rect: Some(screen),
                time: Some(i as f64),
                events: if i > 3 {
                    vec![
                        egui::Event::PointerMoved(egui::pos2(250.0, 450.0)),
                        egui::Event::MouseWheel {
                            unit: egui::MouseWheelUnit::Point,
                            delta: egui::vec2(0.0, -10000.0),
                            modifiers: Default::default(),
                        },
                    ]
                } else {
                    vec![]
                },
                ..Default::default()
            },
            |ctx| {
                let bounds = egui::CentralPanel::default()
                    .show(ctx, |_| {})
                    .response
                    .rect;
                show(ctx, &summary(), bounds);
            },
        );
    }
    let mut found = false;
    for s in &output.shapes {
        let mut rendered = Vec::new();
        texts(&s.shape, &mut rendered);
        for (t, r, _) in rendered {
            if t == "Report field 79" && s.clip_rect.intersects(r) {
                found = true;
            }
        }
    }
    assert!(found, "last report field should be accessible by scrolling");
}

#[test]
fn cards_reveal_one_at_a_time_and_restart_after_leaving_completion() {
    assert_eq!([0, 1, 2].map(|i| reveal_progress(0.0, i)), [0.0; 3]);
    for index in 0..3 {
        let time = index as f64 * (REVEAL_SECONDS + REVEAL_GAP_SECONDS) + REVEAL_SECONDS / 2.0;
        let progress = [0, 1, 2].map(|i| reveal_progress(time, i));
        assert!((progress[index] - 0.5).abs() < 0.001);
        assert!(progress[..index].iter().all(|p| *p == 1.0));
        assert!(progress[index + 1..].iter().all(|p| *p == 0.0));
    }
    assert_eq!(
        [0, 1, 2].map(|i| reveal_progress(ENTRANCE_SECONDS, i)),
        [1.0; 3]
    );
    let ctx = egui::Context::default();
    for (time, expected) in [(5.0, 0.0), (6.0, 1.0)] {
        let _ = ctx.run(
            egui::RawInput {
                time: Some(time),
                ..Default::default()
            },
            |ctx| assert_eq!(animation_elapsed(ctx), expected),
        );
    }
    reset_animation(&ctx);
    let _ = ctx.run(
        egui::RawInput {
            time: Some(10.0),
            ..Default::default()
        },
        |ctx| assert_eq!(animation_elapsed(ctx), 0.0),
    );
}

#[test]
fn target_frequency_uses_the_same_two_column_alignment_as_other_metrics() {
    let ctx = egui::Context::default();
    let mut s = summary();
    s.details.design[0].fields = vec![
        Field {
            label: "Target Clock Period".into(),
            value: "10 ns".into(),
            note: "Target freq: 100 MHz".into(),
        },
        Field {
            label: "Achieved Fmax".into(),
            value: "141 MHz".into(),
            note: String::new(),
        },
    ];
    let output = ctx.run(egui::RawInput::default(), |ctx| {
        egui::CentralPanel::default().show(ctx, |ui| {
            ui.set_width(430.0);
            content::design(ui, &s);
        });
    });
    let mut rendered = Vec::new();
    for shape in output.shapes {
        texts(&shape.shape, &mut rendered);
    }
    let rect = |text: &str| rendered.iter().find(|(t, _, _)| t == text).unwrap().1;
    assert!(!rendered.iter().any(|(t, _, _)| t == "Target freq: 100 MHz"));
    assert!((rect("Target freq").left() - rect("Target Clock Period").left()).abs() < 0.5);
    assert!((rect("100 MHz").right() - rect("10 ns").right()).abs() < 0.5);
    assert!((rect("100 MHz").right() - rect("141 MHz").right()).abs() < 0.5);
}

#[test]
fn reveal_moves_down_each_fixed_card_without_sliding_or_reflow() {
    let ctx = egui::Context::default();
    let screen = egui::Rect::from_min_size(egui::Pos2::ZERO, Vec2::new(1440.0, 900.0));
    let mut snapshots = Vec::new();
    for time in [0.0, 0.1, 0.35, 1.15, 1.95, 3.0] {
        let output = ctx.run(
            egui::RawInput {
                screen_rect: Some(screen),
                time: Some(time),
                ..Default::default()
            },
            |ctx| {
                egui::TopBottomPanel::bottom("timeline")
                    .exact_height(160.0)
                    .show(ctx, |_| {});
                let bounds = egui::CentralPanel::default()
                    .show(ctx, |_| {})
                    .response
                    .rect;
                show(ctx, &summary(), bounds);
            },
        );
        let mut cards = Vec::new();
        for shape in output.shapes {
            if let egui::Shape::Rect(rect) = shape.shape {
                if rect.fill == Color32::from_rgba_unmultiplied(12, 29, 45, 238)
                    && shape.clip_rect.intersects(rect.rect)
                {
                    cards.push((rect.rect, shape.clip_rect.intersect(rect.rect)));
                }
            }
        }
        cards.sort_by(|a, b| a.0.left().total_cmp(&b.0.left()));
        snapshots.push(cards);
    }
    let complete = snapshots.last().unwrap();
    assert_eq!(complete.len(), 3);
    for (sample, index) in [(2, 0), (3, 1), (4, 2)] {
        let cards = &snapshots[sample];
        assert_eq!(cards.len(), index + 1, "later cards stay hidden");
        for (i, (rect, clip)) in cards.iter().enumerate() {
            assert_eq!(*rect, complete[i].0, "fixed card position and height");
            assert!((clip.top() - rect.top()).abs() < 0.5);
            let expected = if i == index { 0.5 } else { 1.0 };
            assert!(
                (clip.height() / rect.height() - expected).abs() < 0.01,
                "{rect:?} {clip:?}"
            );
        }
    }
}

#[test]
fn playback_controls_remain_clickable_with_cards_open() {
    let ctx = egui::Context::default();
    let screen = egui::Rect::from_min_size(egui::Pos2::ZERO, Vec2::new(800.0, 600.0));
    let mut button = egui::Rect::NOTHING;
    let mut clicked = false;
    for frame in 0..6 {
        let events = if frame >= 4 {
            vec![
                egui::Event::PointerMoved(button.center()),
                egui::Event::PointerButton {
                    pos: button.center(),
                    button: egui::PointerButton::Primary,
                    pressed: frame == 4,
                    modifiers: Default::default(),
                },
            ]
        } else {
            vec![]
        };
        let _ = ctx.run(
            egui::RawInput {
                screen_rect: Some(screen),
                time: Some(if frame == 5 { 4.05 } else { frame as f64 }),
                events,
                ..Default::default()
            },
            |ctx| {
                egui::TopBottomPanel::bottom("timeline")
                    .exact_height(160.0)
                    .show(ctx, |ui| {
                        ui.add_space(60.0);
                        let response = ui.button("Play from start");
                        button = response.rect;
                        clicked |= response.clicked();
                    });
                let bounds = egui::CentralPanel::default()
                    .show(ctx, |_| {})
                    .response
                    .rect;
                show(ctx, &summary(), bounds);
            },
        );
    }
    assert!(clicked, "cards must not intercept playback controls");
}

#[test]
fn narrow_windows_can_scroll_to_the_complete_checklist_card() {
    let ctx = egui::Context::default();
    let screen = egui::Rect::from_min_size(egui::Pos2::ZERO, Vec2::new(640.0, 480.0));
    let mut output = egui::FullOutput::default();
    for frame in 0..8 {
        output = ctx.run(
            egui::RawInput {
                screen_rect: Some(screen),
                time: Some(frame as f64),
                events: if frame > 3 {
                    vec![
                        egui::Event::PointerMoved(egui::pos2(300.0, 120.0)),
                        egui::Event::MouseWheel {
                            unit: egui::MouseWheelUnit::Point,
                            delta: egui::vec2(-1000.0, 0.0),
                            modifiers: Default::default(),
                        },
                    ]
                } else {
                    vec![]
                },
                ..Default::default()
            },
            |ctx| {
                egui::TopBottomPanel::bottom("timeline")
                    .exact_height(160.0)
                    .show(ctx, |_| {});
                let bounds = egui::CentralPanel::default()
                    .show(ctx, |_| {})
                    .response
                    .rect;
                show(ctx, &summary(), bounds);
            },
        );
    }
    assert!(
        output.shapes.iter().any(|s| {
            let mut rendered = Vec::new();
            texts(&s.shape, &mut rendered);
            rendered
                .iter()
                .any(|(t, r, _)| t == "03 / CHECKLIST" && s.clip_rect.contains_rect(*r))
        }),
        "horizontal scrolling reveals the full third card heading"
    );
}
