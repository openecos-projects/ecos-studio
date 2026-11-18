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
fn three_cards_are_centered_and_text_wraps_without_horizontal_overflow() {
    for size in [
        Vec2::new(1920.0, 1080.0),
        Vec2::new(1440.0, 900.0),
        Vec2::new(800.0, 600.0),
    ] {
        let ctx = egui::Context::default();
        let screen = egui::Rect::from_min_size(egui::Pos2::ZERO, size);
        let mut rect = egui::Rect::NOTHING;
        let mut output = egui::FullOutput::default();
        for _ in 0..4 {
            output = ctx.run(
                egui::RawInput {
                    screen_rect: Some(screen),
                    ..Default::default()
                },
                |ctx| {
                    egui::TopBottomPanel::bottom("timeline")
                        .exact_height(160.0)
                        .show(ctx, |_| {});
                    rect = show(ctx, &summary()).rect;
                },
            );
        }
        assert!(screen.contains_rect(rect), "{screen:?}: {rect:?}");
        assert!(
            rect.center().distance(screen.center()) < 1.0,
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
                show(ctx, &summary());
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
