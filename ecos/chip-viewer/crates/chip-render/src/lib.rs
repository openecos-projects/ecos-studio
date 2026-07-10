use chip_view_db::ChipViewDb;
use chipgeom_format::{Rect32, ShapeId};

pub struct RenderPlanner;

impl RenderPlanner {
    pub fn visible_shape_ids(db: &ChipViewDb, layer_id: u16, viewport: Rect32) -> Vec<ShapeId> {
        db.query_layer_intersect(layer_id, viewport)
    }
}
