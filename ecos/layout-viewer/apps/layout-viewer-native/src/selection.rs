use layoutpkg_format::LayoutRectRecord;
use layoutpkg_reader::{LayoutLayer, QueryHit, QueryHitSource, Rect};

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SelectedObject {
    pub record: LayoutRectRecord,
    pub tile_id: Option<String>,
    pub source: QueryHitSource,
    pub layer_name: Option<String>,
}

impl SelectedObject {
    pub fn from_hit(hit: QueryHit, layers: &[LayoutLayer]) -> Self {
        let layer_name = layers
            .iter()
            .find(|layer| layer.id == hit.record.layer_id)
            .map(|layer| layer.name.clone());
        Self {
            record: hit.record,
            tile_id: hit.tile_id,
            source: hit.source,
            layer_name,
        }
    }

    pub fn bbox(&self) -> Rect {
        Rect::new(
            self.record.x1,
            self.record.y1,
            self.record.x2,
            self.record.y2,
        )
    }

    pub fn source_label(&self) -> &'static str {
        match self.source {
            QueryHitSource::Tile => "tile",
            QueryHitSource::LargeObject => "large object",
        }
    }
}

#[cfg(test)]
mod tests {
    use layoutpkg_format::LayoutObjectKind;

    use super::*;

    #[test]
    fn selected_object_resolves_layer_name_from_hit() {
        let hit = QueryHit {
            record: LayoutRectRecord {
                x1: 10,
                y1: 20,
                x2: 30,
                y2: 40,
                layer_id: 7,
                kind: LayoutObjectKind::RegularWire,
                flags: 0,
                source_id: 42,
            },
            tile_id: Some("1:2".to_string()),
            source: QueryHitSource::Tile,
        };
        let layers = [LayoutLayer {
            id: 7,
            name: "MET1".to_string(),
            layer_type: None,
            direction: None,
        }];

        let selected = SelectedObject::from_hit(hit, &layers);

        assert_eq!(selected.layer_name.as_deref(), Some("MET1"));
        assert_eq!(selected.bbox(), Rect::new(10, 20, 30, 40));
        assert_eq!(selected.source_label(), "tile");
    }
}
