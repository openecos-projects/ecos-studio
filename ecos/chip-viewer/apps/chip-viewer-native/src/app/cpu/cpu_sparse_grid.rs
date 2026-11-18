use super::*;

impl SparseRects {
    pub(in crate::app::cpu_scene) fn append_axis_overlays(
        &mut self,
        shapes: &[egui::epaint::ClippedShape],
        request: &SceneRequest,
        is_current: &impl Fn() -> bool,
    ) -> bool {
        let mut operations = Vec::with_capacity(shapes.len());
        for (index, shape) in shapes.iter().enumerate() {
            if index % 256 == 0 && !is_current() {
                return false;
            }
            let egui::Shape::LineSegment { points, stroke } = shape.shape else {
                return false;
            };
            if shape.clip_rect != request.key.canvas {
                return false;
            }
            let Some(rect) = axis_grid::rectangle(points, stroke, &request.key) else {
                return false;
            };
            let bounds = self.bounds(rect);
            if bounds[2] > bounds[0]
                && bounds[3] > bounds[1]
                && stroke.color != egui::Color32::TRANSPARENT
            {
                operations.push(Operation::Rect(
                    bounds.map(|coordinate| coordinate as u16),
                    stroke.color,
                ));
            }
        }
        if !is_current() {
            return false;
        }
        self.operations.extend(operations);
        true
    }
}
