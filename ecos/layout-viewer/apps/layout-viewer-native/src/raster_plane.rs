#[derive(Debug, Clone)]
pub struct RasterPlane {
    pub width: usize,
    pub height: usize,
    pub pixels: Vec<u8>,
}

impl RasterPlane {
    pub fn new(width: usize, height: usize) -> Self {
        let pixel_count = width
            .checked_mul(height)
            .expect("raster plane dimensions overflow pixel count");
        let byte_count = pixel_count
            .checked_mul(4)
            .expect("raster plane dimensions overflow RGBA byte count");
        Self {
            width,
            height,
            pixels: vec![0; byte_count],
        }
    }

    pub fn fill_rect(&mut self, rect: [i32; 4], color: [u8; 4]) {
        let Some([x0, y0, x1, y1]) = self.clipped_rect(rect) else {
            return;
        };

        for y in y0..y1 {
            for x in x0..x1 {
                self.set_pixel(x, y, color);
            }
        }
    }

    pub fn stroke_rect(&mut self, rect: [i32; 4], color: [u8; 4]) {
        let [x0, y0, x1, y1] = rect;
        if x0 >= x1 || y0 >= y1 {
            return;
        }

        let left = x0 as i64;
        let right = x1 as i64 - 1;
        let top = y0 as i64;
        let bottom = y1 as i64 - 1;

        if let Some(y) = self.clip_y(top) {
            self.stroke_horizontal(y, x0 as i64, x1 as i64, color);
        }
        if bottom != top {
            if let Some(y) = self.clip_y(bottom) {
                self.stroke_horizontal(y, x0 as i64, x1 as i64, color);
            }
        }

        if let Some(x) = self.clip_x(left) {
            self.stroke_vertical(x, y0 as i64, y1 as i64, color);
        }
        if right != left {
            if let Some(x) = self.clip_x(right) {
                self.stroke_vertical(x, y0 as i64, y1 as i64, color);
            }
        }
    }

    pub fn into_pixels(self) -> Vec<u8> {
        self.pixels
    }

    #[cfg(test)]
    fn non_zero_pixels(&self) -> usize {
        self.pixels
            .chunks_exact(4)
            .filter(|pixel| pixel.iter().any(|channel| *channel != 0))
            .count()
    }

    #[cfg(test)]
    fn pixel_alpha(&self, x: usize, y: usize) -> u8 {
        self.pixels[self.pixel_offset(x, y) + 3]
    }

    fn clipped_rect(&self, rect: [i32; 4]) -> Option<[usize; 4]> {
        let [x0, y0, x1, y1] = rect;
        if x0 >= x1 || y0 >= y1 {
            return None;
        }

        let width = self.width_i64();
        let height = self.height_i64();
        let clipped_x0 = (x0 as i64).clamp(0, width) as usize;
        let clipped_y0 = (y0 as i64).clamp(0, height) as usize;
        let clipped_x1 = (x1 as i64).clamp(0, width) as usize;
        let clipped_y1 = (y1 as i64).clamp(0, height) as usize;

        if clipped_x0 >= clipped_x1 || clipped_y0 >= clipped_y1 {
            None
        } else {
            Some([clipped_x0, clipped_y0, clipped_x1, clipped_y1])
        }
    }

    fn stroke_horizontal(&mut self, y: usize, x0: i64, x1: i64, color: [u8; 4]) {
        let start = x0.clamp(0, self.width_i64()) as usize;
        let end = x1.clamp(0, self.width_i64()) as usize;
        for x in start..end {
            self.set_pixel(x, y, color);
        }
    }

    fn stroke_vertical(&mut self, x: usize, y0: i64, y1: i64, color: [u8; 4]) {
        let start = y0.clamp(0, self.height_i64()) as usize;
        let end = y1.clamp(0, self.height_i64()) as usize;
        for y in start..end {
            self.set_pixel(x, y, color);
        }
    }

    fn clip_x(&self, x: i64) -> Option<usize> {
        (0..self.width_i64()).contains(&x).then_some(x as usize)
    }

    fn clip_y(&self, y: i64) -> Option<usize> {
        (0..self.height_i64()).contains(&y).then_some(y as usize)
    }

    fn width_i64(&self) -> i64 {
        i64::try_from(self.width).unwrap_or(i64::MAX)
    }

    fn height_i64(&self) -> i64 {
        i64::try_from(self.height).unwrap_or(i64::MAX)
    }

    fn set_pixel(&mut self, x: usize, y: usize, color: [u8; 4]) {
        let offset = self.pixel_offset(x, y);
        self.pixels[offset..offset + 4].copy_from_slice(&color);
    }

    fn pixel_offset(&self, x: usize, y: usize) -> usize {
        (y * self.width + x) * 4
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn fill_rect_clips_to_bounds() {
        let mut plane = RasterPlane::new(4, 3);

        plane.fill_rect([-1, 1, 3, 4], [10, 20, 30, 255]);

        assert_eq!(plane.non_zero_pixels(), 6);
        assert_eq!(plane.pixel_alpha(0, 1), 255);
        assert_eq!(plane.pixel_alpha(2, 2), 255);
        assert_eq!(plane.pixel_alpha(3, 2), 0);
        assert_eq!(plane.pixel_alpha(0, 0), 0);
    }

    #[test]
    fn stroke_rect_draws_edges_but_not_center() {
        let mut plane = RasterPlane::new(5, 5);

        plane.stroke_rect([1, 1, 4, 4], [1, 2, 3, 255]);

        assert_eq!(plane.pixel_alpha(1, 1), 255);
        assert_eq!(plane.pixel_alpha(2, 1), 255);
        assert_eq!(plane.pixel_alpha(3, 1), 255);
        assert_eq!(plane.pixel_alpha(1, 2), 255);
        assert_eq!(plane.pixel_alpha(3, 2), 255);
        assert_eq!(plane.pixel_alpha(1, 3), 255);
        assert_eq!(plane.pixel_alpha(2, 3), 255);
        assert_eq!(plane.pixel_alpha(3, 3), 255);
        assert_eq!(plane.pixel_alpha(2, 2), 0);
    }

    #[test]
    fn stroke_rect_does_not_draw_artificial_left_edge_when_clipped() {
        let mut plane = RasterPlane::new(4, 5);

        plane.stroke_rect([-5, 1, 2, 4], [1, 2, 3, 255]);

        assert_eq!(plane.pixel_alpha(0, 1), 255);
        assert_eq!(plane.pixel_alpha(1, 1), 255);
        assert_eq!(plane.pixel_alpha(0, 2), 0);
        assert_eq!(plane.pixel_alpha(1, 2), 255);
        assert_eq!(plane.pixel_alpha(0, 3), 255);
        assert_eq!(plane.pixel_alpha(1, 3), 255);
    }

    #[test]
    fn stroke_rect_does_not_draw_artificial_top_edge_when_clipped() {
        let mut plane = RasterPlane::new(5, 4);

        plane.stroke_rect([1, -5, 4, 2], [1, 2, 3, 255]);

        assert_eq!(plane.pixel_alpha(1, 0), 255);
        assert_eq!(plane.pixel_alpha(2, 0), 0);
        assert_eq!(plane.pixel_alpha(3, 0), 255);
        assert_eq!(plane.pixel_alpha(1, 1), 255);
        assert_eq!(plane.pixel_alpha(2, 1), 255);
        assert_eq!(plane.pixel_alpha(3, 1), 255);
    }

    #[test]
    fn zero_dimensions_allocate_empty_planes() {
        assert!(RasterPlane::new(0, 5).into_pixels().is_empty());
        assert!(RasterPlane::new(5, 0).into_pixels().is_empty());
    }

    #[test]
    fn empty_and_reversed_rects_are_no_ops() {
        let mut plane = RasterPlane::new(4, 4);

        plane.fill_rect([1, 1, 1, 3], [255, 255, 255, 255]);
        plane.fill_rect([3, 3, 2, 2], [255, 255, 255, 255]);
        plane.stroke_rect([2, 2, 2, 4], [255, 255, 255, 255]);
        plane.stroke_rect([3, 3, 1, 1], [255, 255, 255, 255]);

        assert_eq!(plane.non_zero_pixels(), 0);
    }
}
