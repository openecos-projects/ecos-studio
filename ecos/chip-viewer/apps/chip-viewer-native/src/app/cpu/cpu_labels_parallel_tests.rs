use super::*;

#[test]
fn parallel_font_workers_match_serial_layout_across_dpr_fonts_and_selection() {
    let fixture = Fixture::new();
    let mut resolver = labels::LabelResolver::default();
    let mut collector = ShapeLabelCollector::default();
    for index in 0..300 {
        let kind = [
            ShapeLabelKind::IoPin,
            ShapeLabelKind::Pin,
            ShapeLabelKind::Net,
            ShapeLabelKind::Pdn,
            ShapeLabelKind::Instance,
        ][index % 5];
        let anchor_rect = egui::Rect::from_min_size(
            egui::pos2(
                (index % 19) as f32 * 23.25 - 7.0,
                (index / 19) as f32 * 24.75 + 10.0,
            ),
            egui::vec2(86.0, 34.0),
        );
        collector.insert(ShapeLabelCandidate {
            key: ShapeLabelKey::Owner {
                owner_type: kind as u8,
                owner_id: index as u64,
            },
            text: format!("core_α_{index}/data[31:0]"),
            kind,
            anchor_rect,
            rank_area: anchor_rect.area(),
            selected: index % 73 == 0,
            highlighted: index % 19 == 0,
        });
    }
    for (dpr, monospace) in [(1.0, false), (1.5, false), (2.0, true), (1.0, false)] {
        let mut request = fixture.request(1.0, dpr);
        if monospace {
            request.label_fonts.families.insert(
                egui::FontFamily::Proportional,
                request.label_fonts.families[&egui::FontFamily::Monospace].clone(),
            );
        }
        request.overlay_labels.insert(ShapeLabelCandidate {
            key: ShapeLabelKey::Owner {
                owner_type: ShapeLabelKind::Pin as u8,
                owner_id: 1,
            },
            text: "selected/pin_θ".to_string(),
            kind: ShapeLabelKind::Pin,
            anchor_rect: egui::Rect::from_min_size(egui::pos2(505.0, 60.0), egui::vec2(48.0, 22.0)),
            rank_area: 1056.0,
            selected: true,
            highlighted: false,
        });
        let fonts =
            egui::epaint::Fonts::new(dpr, request.label_texture_side, request.label_fonts.clone());
        let expected =
            collector.resolve_with(&request.overlay_labels, request.key.canvas, |text, size| {
                fonts
                    .layout_no_wrap(
                        text.to_owned(),
                        egui::FontId::proportional(size),
                        egui::Color32::WHITE,
                    )
                    .size()
            });
        assert!(!expected.labels.is_empty());
        assert_eq!(
            resolver.resolve(&request, &collector, || true),
            Some(expected.clone())
        );
        assert_eq!(
            resolver.resolve(&request, &collector, || true),
            Some(expected)
        );
        assert!(resolver.resolve(&request, &collector, || false).is_none());
    }
}
