use eframe::egui;
use egui::emath::GuiRounding as _;

/// Measures label text with the same font layout used for display. Implementors
/// may reject text without keeping its mesh, but must preserve exact fit decisions
/// and return the full layout size whenever the text fits.
pub(in crate::app) trait LabelMeasurement {
    fn measure(&self, text: &str, size: f32) -> egui::Vec2;

    fn fit(&self, text: &str, size: f32, available: egui::Vec2) -> Option<egui::Vec2> {
        let measured = self.measure(text, size);
        (measured.x <= available.x && measured.y <= available.y).then_some(measured)
    }
}

impl<Measure: Fn(&str, f32) -> egui::Vec2> LabelMeasurement for Measure {
    fn measure(&self, text: &str, size: f32) -> egui::Vec2 {
        self(text, size)
    }
}

pub(in crate::app) struct FontMeasurement<'a>(pub(in crate::app) &'a egui::epaint::Fonts);

impl FontMeasurement<'_> {
    fn bounded_layout(&self, text: &str, size: f32, width: f32) -> std::sync::Arc<egui::Galley> {
        let mut job = egui::text::LayoutJob::simple(
            text.to_owned(),
            egui::FontId::proportional(size),
            egui::Color32::WHITE,
            (width + 1.0).ceil(),
        );
        if width.is_finite() && !text.contains('\n') {
            job.wrap.max_rows = 1;
            job.wrap.break_anywhere = true;
            job.wrap.overflow_character = None;
        } else {
            job.wrap.max_width = f32::INFINITY;
        }
        self.0.layout_job(job)
    }
}

impl LabelMeasurement for FontMeasurement<'_> {
    fn measure(&self, text: &str, size: f32) -> egui::Vec2 {
        self.bounded_layout(text, size, f32::INFINITY).size()
    }

    fn fit(&self, text: &str, size: f32, available: egui::Vec2) -> Option<egui::Vec2> {
        if !text.contains('\n') {
            let mut locked = self.0.lock();
            let fonts = &mut locked.fonts;
            let scale = fonts.pixels_per_point();
            let height = fonts.font(&egui::FontId::proportional(size)).row_height();
            if ((height * scale).round() / scale).round_ui() > available.y {
                return None;
            }
        }
        let galley = self.bounded_layout(text, size, available.x);
        let measured = galley.size();
        (!galley.elided && measured.x <= available.x && measured.y <= available.y)
            .then_some(measured)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn labels_too_tall_for_the_anchor_do_not_create_a_text_layout() {
        for dpr in [1.0, 1.25, 1.5, 2.0, 4.0] {
            let fonts = egui::epaint::Fonts::new(dpr, 2048, egui::FontDefinitions::default());
            let measurement = FontMeasurement(&fonts);
            for size in [6.0, 8.0, 11.0, 17.5, 18.0] {
                let height = ((fonts.row_height(&egui::FontId::proportional(size)) * dpr).round()
                    / dpr)
                    .round_ui();
                let before = fonts.num_galleys_in_cache();
                for text in [
                    "",
                    "minirv2/core/very_long_instance_name[123]",
                    "AV To α🙂\t\r",
                ] {
                    assert_eq!(
                        measurement.fit(text, size, egui::vec2(500.0, height - 0.001)),
                        None
                    );
                }
                assert_eq!(
                    fonts.num_galleys_in_cache(),
                    before,
                    "DPR {dpr} size {size}"
                );
            }
        }
    }

    #[test]
    fn rejected_long_names_do_not_generate_the_full_text_mesh() {
        let fonts = egui::epaint::Fonts::new(1.0, 2048, egui::FontDefinitions::default());
        let measurement = FontMeasurement(&fonts);
        let text = "minirv2/core/data_bus[31:0]/".repeat(100);
        let full = measurement.bounded_layout(&text, 11.0, f32::INFINITY);
        let bounded = measurement.bounded_layout(&text, 11.0, 25.0);
        assert!(full.num_vertices > 1000);
        assert!(bounded.elided);
        assert!(bounded.num_vertices < 40);
        assert_eq!(measurement.fit(&text, 11.0, egui::vec2(25.0, 30.0)), None);
    }

    #[test]
    fn bounded_fit_preserves_exact_sizes_at_egui_rounding_boundaries() {
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
                let measurement = FontMeasurement(&fonts);
                for text in [
                    "",
                    "AV To/wide_α🙂[31:0]  ",
                    "\t\r_\u{a0}",
                    "first\nsecond",
                    "\n\n",
                ] {
                    for size in [6.0, 8.0, 8.5, 11.0, 17.5, 18.0] {
                        let full = fonts
                            .layout_no_wrap(
                                text.to_owned(),
                                egui::FontId::proportional(size),
                                egui::Color32::WHITE,
                            )
                            .size();
                        for width in [0.0, 5.0, full.x - 0.001, full.x, full.x + 0.001] {
                            for height in [0.0, full.y - 0.001, full.y, full.y + 0.001] {
                                let available = egui::vec2(width, height);
                                let expected =
                                    (full.x <= width && full.y <= height).then_some(full);
                                assert_eq!(measurement.fit(text, size, available), expected,
                                    "dpr={dpr}, monospace={monospace}, text={text:?}, size={size}, available={available:?}");
                            }
                        }
                    }
                }
            }
        }
    }
}
