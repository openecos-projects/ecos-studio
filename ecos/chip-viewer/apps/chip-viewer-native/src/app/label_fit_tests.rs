use super::*;

fn full_layout_fit(
    kind: ShapeLabelKind,
    anchor: egui::Rect,
    text: &str,
    fonts: &egui::epaint::Fonts,
) -> Option<(f32, egui::Vec2)> {
    let (minimum, maximum) = font_range(kind);
    let available = (anchor.size() - egui::vec2(2.0, 1.0)).max(egui::Vec2::ZERO);
    if available.x < minimum * 2.0 || available.y < minimum {
        return None;
    }
    let mut size = maximum;
    while size >= minimum {
        let measured = fonts
            .layout_no_wrap(
                text.to_owned(),
                egui::FontId::proportional(size),
                egui::Color32::WHITE,
            )
            .size();
        if measured.x <= available.x && measured.y <= available.y {
            return Some((size, measured));
        }
        size -= 0.5;
    }
    None
}

#[test]
fn height_constrained_labels_match_full_font_layout() {
    let fonts = egui::epaint::Fonts::new(1.0, 2048, egui::FontDefinitions::default());
    let anchor = egui::Rect::from_min_size(egui::Pos2::ZERO, egui::vec2(300.0, 10.0));
    let text = "minirv2/core/data_bus[31:0]";
    let expected = full_layout_fit(ShapeLabelKind::Instance, anchor, text, &fonts);
    assert!(expected.is_some());
    let actual = fit_inside(
        ShapeLabelKind::Instance,
        anchor,
        text,
        &FontMeasurement(&fonts),
    );
    assert_eq!(actual, expected);
}

#[test]
fn bounded_measurement_matches_full_egui_layout_at_font_and_pixel_boundaries() {
    for dpr in [1.0, 1.25, 1.5, 2.0, 4.0] {
        for monospace in [false, true] {
            let mut definitions = egui::FontDefinitions::default();
            if monospace {
                definitions.families.insert(
                    egui::FontFamily::Proportional,
                    definitions.families[&egui::FontFamily::Monospace].clone(),
                );
            }
            let fonts = egui::epaint::Fonts::new(dpr, 2048, definitions);
            let measure = FontMeasurement(&fonts);
            for text in ["", "AV/To_α🙂[31:0]  ", "first\nsecond", "\n\n"] {
                for kind in [
                    ShapeLabelKind::Net,
                    ShapeLabelKind::Pdn,
                    ShapeLabelKind::Instance,
                ] {
                    for height in [8.0, 9.0, 9.99, 10.0, 10.01, 12.0, 18.0, 35.0] {
                        for width in [12.0, 35.0, 90.0, 400.0] {
                            let anchor = egui::Rect::from_min_size(
                                egui::pos2(-10.25, 7.75),
                                egui::vec2(width, height),
                            );
                            assert_eq!(
                                fit_inside(kind, anchor, text, &measure),
                                full_layout_fit(kind, anchor, text, &fonts),
                                "dpr={dpr}, monospace={monospace}, text={text:?}, kind={kind:?}, anchor={anchor:?}"
                            );
                        }
                    }
                }
            }
        }
    }
}
