use std::collections::BTreeSet;

use layoutpkg_format::{LayoutObjectKind, LayoutRectRecord};
use layoutpkg_reader::LayoutLayer;

#[derive(Debug, Clone)]
pub struct VisibilityState {
    visible_kinds: BTreeSet<LayoutObjectKind>,
    visible_layers: BTreeSet<u16>,
    pub show_tracks: bool,
    pub show_gcell_grids: bool,
}

impl VisibilityState {
    pub fn new(layers: &[LayoutLayer]) -> Self {
        Self {
            visible_kinds: all_kinds().into_iter().collect(),
            visible_layers: layers.iter().map(|layer| layer.id).collect(),
            show_tracks: true,
            show_gcell_grids: true,
        }
    }

    pub fn is_kind_visible(&self, kind: LayoutObjectKind) -> bool {
        self.visible_kinds.contains(&kind)
    }

    pub fn set_kind_visible(&mut self, kind: LayoutObjectKind, visible: bool) {
        if visible {
            self.visible_kinds.insert(kind);
        } else {
            self.visible_kinds.remove(&kind);
        }
    }

    pub fn is_layer_visible(&self, layer_id: u16) -> bool {
        if self.visible_layers.is_empty() {
            return true;
        }
        self.visible_layers.contains(&layer_id)
    }

    pub fn set_layer_visible(&mut self, layer_id: u16, visible: bool) {
        if visible {
            self.visible_layers.insert(layer_id);
        } else {
            self.visible_layers.remove(&layer_id);
        }
    }

    pub fn is_record_visible(&self, record: &LayoutRectRecord) -> bool {
        self.is_kind_visible(record.kind) && self.is_layer_visible(record.layer_id)
    }
}

pub fn all_kinds() -> [LayoutObjectKind; 13] {
    [
        LayoutObjectKind::Die,
        LayoutObjectKind::Core,
        LayoutObjectKind::Instance,
        LayoutObjectKind::RegularWire,
        LayoutObjectKind::SpecialWire,
        LayoutObjectKind::Via,
        LayoutObjectKind::IoPin,
        LayoutObjectKind::Blockage,
        LayoutObjectKind::Fill,
        LayoutObjectKind::Region,
        LayoutObjectKind::Row,
        LayoutObjectKind::Track,
        LayoutObjectKind::GCellGrid,
    ]
}

#[cfg(test)]
mod tests {
    use super::*;

    fn layer(id: u16) -> LayoutLayer {
        LayoutLayer {
            id,
            name: format!("M{id}"),
            layer_type: None,
            direction: None,
        }
    }

    fn record(kind: LayoutObjectKind, layer_id: u16) -> LayoutRectRecord {
        LayoutRectRecord {
            x1: 0,
            y1: 0,
            x2: 10,
            y2: 10,
            layer_id,
            kind,
            flags: 0,
            source_id: 0,
        }
    }

    #[test]
    fn records_are_visible_when_kind_and_layer_are_enabled() {
        let visibility = VisibilityState::new(&[layer(1)]);

        assert!(visibility.is_record_visible(&record(LayoutObjectKind::RegularWire, 1)));
    }

    #[test]
    fn hiding_kind_filters_matching_records() {
        let mut visibility = VisibilityState::new(&[layer(1)]);

        visibility.set_kind_visible(LayoutObjectKind::RegularWire, false);

        assert!(!visibility.is_record_visible(&record(LayoutObjectKind::RegularWire, 1)));
        assert!(visibility.is_record_visible(&record(LayoutObjectKind::SpecialWire, 1)));
    }

    #[test]
    fn hiding_layer_filters_matching_records() {
        let mut visibility = VisibilityState::new(&[layer(1), layer(2)]);

        visibility.set_layer_visible(2, false);

        assert!(visibility.is_record_visible(&record(LayoutObjectKind::RegularWire, 1)));
        assert!(!visibility.is_record_visible(&record(LayoutObjectKind::RegularWire, 2)));
    }
}
