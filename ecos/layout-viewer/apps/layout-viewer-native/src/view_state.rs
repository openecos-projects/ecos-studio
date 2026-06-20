use layoutpkg_reader::Rect;

#[derive(Debug, Clone, Copy, PartialEq)]
pub struct ViewState {
    pub center_x: f32,
    pub center_y: f32,
    pub units_per_pixel: f32,
}

impl ViewState {
    pub fn fit(world: Rect, viewport_width: f32, viewport_height: f32) -> Self {
        let units_per_pixel = ((world.width() as f32 / viewport_width)
            .max(world.height() as f32 / viewport_height))
        .max(1.0);
        Self {
            center_x: (world.x1 + world.x2) as f32 / 2.0,
            center_y: (world.y1 + world.y2) as f32 / 2.0,
            units_per_pixel,
        }
    }

    pub fn viewport_rect(self, viewport_width: f32, viewport_height: f32) -> Rect {
        let half_w = viewport_width * self.units_per_pixel / 2.0;
        let half_h = viewport_height * self.units_per_pixel / 2.0;
        Rect::new(
            (self.center_x - half_w).floor() as i32,
            (self.center_y - half_h).floor() as i32,
            (self.center_x + half_w).ceil() as i32,
            (self.center_y + half_h).ceil() as i32,
        )
    }

    pub fn pan_pixels(&mut self, dx: f32, dy: f32) {
        self.center_x -= dx * self.units_per_pixel;
        self.center_y -= dy * self.units_per_pixel;
    }

    pub fn zoom_at_screen(
        &mut self,
        factor: f32,
        screen_x: f32,
        screen_y: f32,
        width: f32,
        height: f32,
    ) {
        let before = self.screen_to_world(screen_x, screen_y, width, height);
        self.units_per_pixel = (self.units_per_pixel / factor).clamp(0.01, 1_000_000.0);
        let after = self.screen_to_world(screen_x, screen_y, width, height);
        self.center_x += before.0 - after.0;
        self.center_y += before.1 - after.1;
    }

    pub fn world_to_screen(self, x: f32, y: f32, width: f32, height: f32) -> (f32, f32) {
        (
            width / 2.0 + (x - self.center_x) / self.units_per_pixel,
            height / 2.0 + (y - self.center_y) / self.units_per_pixel,
        )
    }

    pub fn screen_to_world(self, x: f32, y: f32, width: f32, height: f32) -> (f32, f32) {
        (
            self.center_x + (x - width / 2.0) * self.units_per_pixel,
            self.center_y + (y - height / 2.0) * self.units_per_pixel,
        )
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn fit_covers_world_bbox() {
        let view = ViewState::fit(Rect::new(0, 0, 1000, 500), 100.0, 100.0);
        assert_eq!(
            view.viewport_rect(100.0, 100.0),
            Rect::new(0, -250, 1000, 750)
        );
    }

    #[test]
    fn pan_moves_world_viewport_opposite_drag() {
        let mut view = ViewState::fit(Rect::new(0, 0, 1000, 1000), 100.0, 100.0);
        view.pan_pixels(10.0, -5.0);
        assert_eq!(
            view.viewport_rect(100.0, 100.0),
            Rect::new(-100, 50, 900, 1050)
        );
    }

    #[test]
    fn zoom_keeps_cursor_world_point_stable() {
        let mut view = ViewState::fit(Rect::new(0, 0, 1000, 1000), 100.0, 100.0);
        let before = view.screen_to_world(25.0, 25.0, 100.0, 100.0);
        view.zoom_at_screen(2.0, 25.0, 25.0, 100.0, 100.0);
        let after = view.screen_to_world(25.0, 25.0, 100.0, 100.0);
        assert!((before.0 - after.0).abs() < 0.001);
        assert!((before.1 - after.1).abs() < 0.001);
    }
}
