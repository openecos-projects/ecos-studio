use super::*;

#[derive(Default)]
pub(super) struct WheelCamera {
    anchor: Option<Anchor>,
}

struct Anchor {
    zoom: f32,
    pan: egui::Vec2,
    cursor: egui::Pos2,
    canvas: egui::Rect,
    logarithm: f64,
    output: (f32, egui::Vec2),
}

impl WheelCamera {
    pub(super) fn update(
        &mut self,
        canvas: egui::Rect,
        zoom: f32,
        pan: egui::Vec2,
        cursor: egui::Pos2,
        logarithm: f64,
    ) -> (f32, egui::Vec2) {
        if self.anchor.as_ref().is_none_or(|anchor| {
            anchor.output != (zoom, pan) || anchor.cursor != cursor || anchor.canvas != canvas
        }) {
            self.anchor = Some(Anchor {
                zoom,
                pan,
                cursor,
                canvas,
                logarithm: 0.0,
                output: (zoom, pan),
            });
        }
        let anchor = self.anchor.as_mut().unwrap();
        anchor.logarithm += logarithm;
        if anchor.logarithm.abs() < 1e-12 {
            anchor.logarithm = 0.0;
        }
        if anchor.logarithm == 0.0 {
            anchor.output = (anchor.zoom, anchor.pan);
            return anchor.output;
        }
        let requested = f64::from(anchor.zoom) * anchor.logarithm.exp();
        let new_zoom = requested.clamp(0.05, 50_000.0);
        let ratio = new_zoom / f64::from(anchor.zoom);
        let offset = cursor - canvas.center();
        let project = |offset: f32, pan: f32| {
            (f64::from(offset) - (f64::from(offset) - f64::from(pan)) * ratio) as f32
        };
        let new_pan = egui::vec2(
            project(offset.x, anchor.pan.x),
            project(offset.y, anchor.pan.y),
        );
        anchor.output = (new_zoom as f32, new_pan);
        if requested != new_zoom {
            anchor.zoom = new_zoom as f32;
            anchor.pan = new_pan;
            anchor.logarithm = 0.0;
        }
        anchor.output
    }
}

pub(super) fn scroll_logarithm(scroll: f32) -> f64 {
    let steps = if scroll.abs() <= 5.0 {
        f64::from(scroll)
    } else {
        f64::from(scroll) / 25.0
    };
    (steps * 1.35_f64.ln()).clamp(0.05_f64.ln(), 20.0_f64.ln())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn repeated_wheel_round_trips_restore_identical_zoom_and_pan_bits() {
        let canvas = egui::Rect::from_min_size(egui::pos2(300.0, 90.0), egui::vec2(1500.0, 1100.0));
        let cursor = egui::pos2(1024.0, 640.0);
        let original = (1.0, egui::vec2(73.125, -28.25));
        let mut current = original;
        let mut camera = WheelCamera::default();
        for _ in 0..100 {
            for delta in [80.0, 80.0, 80.0, -80.0, -80.0, -80.0] {
                current = camera.update(
                    canvas,
                    current.0,
                    current.1,
                    cursor,
                    scroll_logarithm(delta),
                );
            }
            assert_eq!(current, original);
        }
    }

    #[test]
    fn wheel_keeps_world_point_under_cursor_and_rebases_after_external_pan() {
        let canvas = egui::Rect::from_min_size(egui::Pos2::ZERO, egui::vec2(1600.0, 1000.0));
        let cursor = egui::pos2(400.0, 230.0);
        let mut camera = WheelCamera::default();
        let previous = (cursor - canvas.center() - egui::vec2(31.5, -12.25)) / 2.0;
        let (zoom, pan) = camera.update(
            canvas,
            2.0,
            egui::vec2(31.5, -12.25),
            cursor,
            scroll_logarithm(80.0),
        );
        let after = (cursor - canvas.center() - pan) / zoom;
        assert!((previous - after).length() < 0.0001);
        let external = pan + egui::vec2(40.0, 20.0);
        let first = camera.update(canvas, zoom, external, cursor, scroll_logarithm(80.0));
        let back = camera.update(canvas, first.0, first.1, cursor, scroll_logarithm(-80.0));
        assert_eq!(back, (zoom, external));
    }

    #[test]
    fn clamping_does_not_accumulate_hidden_wheel_steps() {
        let canvas = egui::Rect::from_min_size(egui::Pos2::ZERO, egui::vec2(800.0, 600.0));
        let mut camera = WheelCamera::default();
        let maximum = camera.update(
            canvas,
            50_000.0,
            egui::Vec2::ZERO,
            canvas.center(),
            scroll_logarithm(80.0),
        );
        let smaller = camera.update(
            canvas,
            maximum.0,
            maximum.1,
            canvas.center(),
            scroll_logarithm(-80.0),
        );
        assert!(smaller.0 < maximum.0);
    }
}
