//! Shared 3D scale and stack-cut controls.
use egui::{Slider, Ui};

fn step(value: &mut f32, factor: f32, delta: f32, range: std::ops::RangeInclusive<f32>) {
    *value = (*value * factor + delta).clamp(*range.start(), *range.end());
}

pub fn scale(ui: &mut Ui, value: &mut f32) {
    ui.horizontal(|ui| {
        ui.spacing_mut().slider_width = (ui.available_width() - 145.0).clamp(35.0, 100.0);
        ui.spacing_mut().item_spacing.x = 2.0;
        if ui
            .small_button("-")
            .on_hover_text("Decrease Z-scale")
            .clicked()
        {
            step(value, 1.0 / 1.2, 0.0, 0.05..=6.0);
        }
        ui.add(
            Slider::new(value, 0.05..=6.0)
                .logarithmic(true)
                .show_value(false),
        )
        .on_hover_text(
            "Vertical elevation scale (0.05 = flat, 1.0 = standard depth, 6.0 = exaggerated)",
        );
        if ui
            .small_button("+")
            .on_hover_text("Increase Z-scale")
            .clicked()
        {
            step(value, 1.2, 0.0, 0.05..=6.0);
        }
        ui.label("Z-scale");
        ui.add(egui::DragValue::new(value).speed(0.01).range(0.05..=6.0));
    });
}

pub fn layers(ui: &mut Ui, value: &mut f32, inverted: bool) {
    ui.horizontal(|ui| {
        ui.spacing_mut().slider_width = (ui.available_width() - 145.0).clamp(35.0, 100.0);
        ui.spacing_mut().item_spacing.x = 2.0;
        let direction = if inverted { -1.0 } else { 1.0 };
        if ui
            .small_button("-")
            .on_hover_text("Show fewer layers")
            .clicked()
        {
            step(value, 1.0, -0.05 * direction, 0.0..=1.0);
        }
        ui.add(Slider::new(value, 0.0..=1.0).show_value(false))
            .on_hover_text("Adjust the visible layer stack");
        if ui
            .small_button("+")
            .on_hover_text("Show more layers")
            .clicked()
        {
            step(value, 1.0, 0.05 * direction, 0.0..=1.0);
        }
        ui.label(if inverted { "Z-Cut" } else { "Layers" });
        let mut percent = *value * 100.0;
        if ui
            .add(
                egui::DragValue::new(&mut percent)
                    .speed(1.0)
                    .range(0.0..=100.0)
                    .suffix("%"),
            )
            .changed()
        {
            *value = percent / 100.0;
        }
    });
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn steps_respect_limits() {
        let mut scale = 6.0;
        step(&mut scale, 1.2, 0.0, 0.05..=6.0);
        assert_eq!(scale, 6.0);
        let mut layers = 0.0;
        step(&mut layers, 1.0, -0.05, 0.0..=1.0);
        assert_eq!(layers, 0.0);
    }
}
