//! Smooth visual scrolling, separate from source-time visibility of log lines.
#[derive(Default)]
pub struct LogScroll {
    pub offset: f32,
}
impl LogScroll {
    pub fn advance(
        &mut self,
        count: usize,
        row: f32,
        height: f32,
        dt: f32,
        synced: bool,
        follow: bool,
    ) -> f32 {
        let maximum = (count as f32 * row - height).max(0.0);
        // A rewind must never retain an offset beyond the available source lines.
        self.offset = self.offset.min(maximum);
        if follow {
            let distance = maximum - self.offset;
            let speed = if synced {
                (distance * 7.0).max(48.0)
            } else {
                row * 5.0
            };
            self.offset += (speed * dt.clamp(0.0, 0.1)).min(distance.max(0.0));
        }
        self.offset
    }
    pub fn reset(&mut self) {
        *self = Self::default();
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn appended_lines_scroll_smoothly_and_rewind_clamps_immediately() {
        let mut scroll = LogScroll::default();
        let offset = scroll.advance(100, 18.0, 44.0, 0.016, true, true);
        assert!(offset > 0.0 && offset < 1756.0);
        assert_eq!(scroll.advance(100, 18.0, 44.0, 0.016, true, false), offset);
        assert_eq!(scroll.advance(2, 18.0, 44.0, 0.016, true, true), 0.0);
    }
    #[test]
    fn legacy_browsing_moves_without_inventing_line_timestamps() {
        let mut scroll = LogScroll::default();
        assert_eq!(scroll.advance(100, 18.0, 44.0, 0.1, false, true), 9.0);
        assert_eq!(scroll.advance(100, 18.0, 44.0, 0.1, false, false), 9.0);
        scroll.reset();
        assert_eq!(scroll.offset, 0.0);
    }
}
