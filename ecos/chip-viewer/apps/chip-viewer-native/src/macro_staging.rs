//! Staging state for manual macro placement in the layout edit session.
//!
//! After preFloorplan every instance is unplaced, and the geometry snapshot
//! skips unplaced instances, so the Electron bridge publishes a macro staging
//! manifest (built from the step DEF and master metadata). This module owns
//! the viewer-side state for those macros: the staging column left of the
//! die, multi-selection, placement constraints, and reconciliation against
//! snapshots that already contain placed macros.

use std::collections::{BTreeMap, BTreeSet};
use std::path::Path;

use chip_view_db::ChipViewDb;
use chipgeom_format::{OwnerRef, OwnerType, Point32, Rect32, ShapeRecord};
use serde::Deserialize;

use crate::macro_ops::MacroOpQueue;
use crate::macro_orient::{MacroOrientation, MasterSymmetry};

/// Layout geometry lives on layer 0; see `LAYOUT_GEOMETRY_LAYER` in app.rs.
const LAYOUT_GEOMETRY_LAYER: u16 = 0;

/// Fraction of the die width kept as a gap between die and staging column.
const STAGING_COLUMN_MARGIN_FRACTION: i64 = 10;
/// Gap between staged macro slots, as a fraction of the tallest macro.
const STAGING_SLOT_GAP_FRACTION: i64 = 10;

#[derive(Deserialize)]
struct MacroStagingManifestFile {
    #[serde(default)]
    schema: u32,
    #[serde(default)]
    macros: Vec<MacroStagingEntryFile>,
}

#[derive(Deserialize)]
struct MacroStagingEntryFile {
    name: String,
    #[serde(default)]
    master: String,
    #[serde(default)]
    width_dbu: i64,
    #[serde(default)]
    height_dbu: i64,
    #[serde(default)]
    orient: Option<String>,
    #[serde(default)]
    placed: bool,
}

/// A selected or manipulated macro: either a placed snapshot shape or an
/// unplaced macro in the staging column.
#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord)]
pub(crate) enum MacroTarget {
    Placed(u64),
    Staged(usize),
}

pub(crate) struct StagedMacro {
    pub name: String,
    pub master: String,
    /// Master width in DBU at R0 orientation.
    pub width: i64,
    /// Master height in DBU at R0 orientation.
    pub height: i64,
    pub orient: MacroOrientation,
    /// Current staging slot rectangle in world (DBU) coordinates.
    pub rect: Rect32,
}

/// Consistent snapshot of one macro used by the operation planners.
pub(crate) struct MacroPlacementView {
    pub name: String,
    pub orient: MacroOrientation,
    pub bbox: Rect32,
    pub symmetry: MasterSymmetry,
    pub staged: bool,
}

pub(crate) struct MacroStagingState {
    pub staged: Vec<StagedMacro>,
    pub selection: BTreeSet<MacroTarget>,
    /// Orientations of macros that already have a placed shape; the snapshot
    /// does not encode instance orientation.
    pub orient_by_name: BTreeMap<String, MacroOrientation>,
    pub core_rect: Option<Rect32>,
    pub queue: MacroOpQueue,
    pub message: Option<String>,
}

impl MacroStagingState {
    /// Loads the staging manifest published by the Electron bridge and
    /// reconciles it against the snapshot. Returns `None` when the file is
    /// unreadable or malformed; the viewer then stays in move-only mode.
    pub(crate) fn load(path: &Path, db: &ChipViewDb) -> Option<Self> {
        let content = std::fs::read_to_string(path).ok()?;
        let manifest: MacroStagingManifestFile = serde_json::from_str(&content).ok()?;
        if manifest.schema != 1 {
            return None;
        }

        let mut state = MacroStagingState {
            staged: Vec::new(),
            selection: BTreeSet::new(),
            orient_by_name: BTreeMap::new(),
            core_rect: resolve_core_rect(db),
            queue: MacroOpQueue::default(),
            message: None,
        };
        for entry in manifest.macros {
            let orient = entry
                .orient
                .as_deref()
                .and_then(MacroOrientation::from_str)
                .unwrap_or(MacroOrientation::R0);
            if entry.placed {
                state.orient_by_name.insert(entry.name.clone(), orient);
                continue;
            }
            state.staged.push(StagedMacro {
                name: entry.name,
                master: entry.master,
                width: entry.width_dbu,
                height: entry.height_dbu,
                orient,
                rect: Rect32::default(),
            });
        }
        state.layout_staged(db);
        state.reconcile(db);
        Some(state)
    }

    /// Assigns each unplaced macro a slot in the column directly left of the
    /// die origin, ordered by manifest order, top to bottom.
    pub(crate) fn layout_staged(&mut self, db: &ChipViewDb) {
        if self.staged.is_empty() {
            return;
        }
        let Some(die) = die_rect(db) else {
            return;
        };
        let margin = ((die.hx as i64 - die.lx as i64) / STAGING_COLUMN_MARGIN_FRACTION).max(1);
        let gap = self
            .staged
            .iter()
            .map(|macro_entry| macro_entry.height.max(macro_entry.width))
            .max()
            .unwrap_or(1)
            / STAGING_SLOT_GAP_FRACTION;
        let column_right = die.lx.saturating_sub(margin as i32);
        let mut slot_top = die.hy;
        for macro_entry in &mut self.staged {
            let (width, height) = macro_entry
                .orient
                .bbox_size(macro_entry.width, macro_entry.height);
            let bottom = slot_top.saturating_sub(height as i32);
            macro_entry.rect = Rect32 {
                lx: column_right.saturating_sub(width as i32),
                ly: bottom,
                hx: column_right,
                hy: slot_top,
            };
            slot_top = bottom.saturating_sub(gap as i32);
        }
    }

    /// Staging column bounds that the canvas world rect must cover.
    pub(crate) fn expanded_world(&self, base: Rect32) -> Rect32 {
        let mut world = base;
        for macro_entry in &self.staged {
            world.include(macro_entry.rect);
        }
        world
    }

    pub(crate) fn staged_index_at(&self, point: Point32) -> Option<usize> {
        self.staged
            .iter()
            .position(|macro_entry| rect_contains(macro_entry.rect, point))
    }

    /// True when the instance name belongs to a block macro: staged here,
    /// placed with a tracked orientation, or backed by a block master.
    pub(crate) fn is_macro_instance(&self, db: &ChipViewDb, name: &str) -> bool {
        if self
            .staged
            .iter()
            .any(|macro_entry| macro_entry.name == name)
            || self.orient_by_name.contains_key(name)
        {
            return true;
        }
        instance_master_name(db, name)
            .and_then(|master| db.master_by_name(&master))
            .is_some_and(is_block_master)
    }

    /// Orientation tracked for a placed macro, defaulting to R0 when the
    /// manifest did not carry it.
    pub(crate) fn orient_of(&self, name: &str) -> MacroOrientation {
        self.orient_by_name
            .get(name)
            .copied()
            .unwrap_or(MacroOrientation::R0)
    }

    /// Drops staged macros that now have a placed shape and prunes selection
    /// entries whose shapes disappeared. Called after every snapshot reload.
    pub(crate) fn reconcile(&mut self, db: &ChipViewDb) {
        self.staged
            .retain(|macro_entry| instance_shape(db, &macro_entry.name).is_none());
        self.selection.retain(|target| match *target {
            MacroTarget::Staged(index) => index < self.staged.len(),
            MacroTarget::Placed(shape_id) => db.find_shape(shape_id).is_some(),
        });
        self.core_rect = resolve_core_rect(db);
    }

    /// Gathers the current placement views for every selected macro.
    pub(crate) fn selected_placement_views(&self, db: &ChipViewDb) -> Vec<MacroPlacementView> {
        let mut views = Vec::new();
        for target in &self.selection {
            match *target {
                MacroTarget::Staged(index) => {
                    let Some(macro_entry) = self.staged.get(index) else {
                        continue;
                    };
                    views.push(MacroPlacementView {
                        name: macro_entry.name.clone(),
                        orient: macro_entry.orient,
                        bbox: macro_entry.rect,
                        symmetry: master_symmetry(db, &macro_entry.master),
                        staged: true,
                    });
                }
                MacroTarget::Placed(shape_id) => {
                    let Some(shape) = db.find_shape(shape_id) else {
                        continue;
                    };
                    let Some(name) = shape_instance_name(db, shape) else {
                        continue;
                    };
                    views.push(MacroPlacementView {
                        name: name.to_owned(),
                        orient: self.orient_of(name),
                        bbox: shape.bbox,
                        symmetry: instance_symmetry(db, name),
                        staged: false,
                    });
                }
            }
        }
        views
    }
}

pub(crate) fn is_block_master(master: &chip_view_db::MasterMetadata) -> bool {
    master
        .master_type
        .trim()
        .to_ascii_uppercase()
        .starts_with("BLOCK")
}

fn master_symmetry(db: &ChipViewDb, master: &str) -> MasterSymmetry {
    db.master_by_name(master)
        .map(|metadata| MasterSymmetry::parse(&metadata.symmetry))
        .unwrap_or_default()
}

fn instance_symmetry(db: &ChipViewDb, instance: &str) -> MasterSymmetry {
    instance_master_name(db, instance)
        .and_then(|master| {
            db.master_by_name(&master)
                .map(|metadata| metadata.symmetry.clone())
        })
        .map(|symmetry| MasterSymmetry::parse(&symmetry))
        .unwrap_or_default()
}

/// Master name for a placed instance from its `master:<name> site:<name>`
/// owner local name.
pub(crate) fn instance_master_name(db: &ChipViewDb, instance: &str) -> Option<String> {
    let shape = instance_shape(db, instance)?;
    let owner = db.owner_for_shape(shape)?;
    let local = db.owner_local_name(owner)?;
    chip_view_db::OwnerLocalInfo::parse(local)
        .and_then(|info| info.field("master").map(str::to_owned))
}

/// The placed `InstanceBBox` shape for an instance name, if any.
pub(crate) fn instance_shape<'a>(db: &'a ChipViewDb, instance: &str) -> Option<&'a ShapeRecord> {
    db.query_owner_name(instance)
        .into_iter()
        .filter_map(|shape_id| db.find_shape(shape_id))
        .find(|shape| {
            db.owner_for_shape(shape).is_some_and(|owner| {
                OwnerType::from_raw(owner.owner_type) == Some(OwnerType::InstanceBBox)
            })
        })
}

pub(crate) fn shape_instance_name<'a>(db: &'a ChipViewDb, shape: &ShapeRecord) -> Option<&'a str> {
    db.owner_for_shape(shape)
        .and_then(|owner| db.owner_name(owner))
}

/// Names of placed instances whose bounding boxes strictly overlap `bbox`.
pub(crate) fn instance_names_intersecting(
    db: &ChipViewDb,
    bbox: Rect32,
    skip: &str,
) -> Vec<String> {
    db.query_layer_intersect_records(LAYOUT_GEOMETRY_LAYER, bbox)
        .into_iter()
        .filter(|shape| {
            db.owner_for_shape(shape)
                .is_some_and(|owner| owner_type_is(owner, OwnerType::InstanceBBox))
        })
        .filter(|shape| rects_overlap(shape.bbox, bbox))
        .filter_map(|shape| shape_instance_name(db, shape))
        .filter(|name| *name != skip)
        .map(str::to_owned)
        .collect()
}

fn owner_type_is(owner: &OwnerRef, expected: OwnerType) -> bool {
    OwnerType::from_raw(owner.owner_type) == Some(expected)
}

fn die_rect(db: &ChipViewDb) -> Option<Rect32> {
    boundary_rect(db, OwnerType::Die)
}

/// Core boundary used for placement constraints, falling back to the die
/// when the snapshot has no explicit core shape.
pub(crate) fn resolve_core_rect(db: &ChipViewDb) -> Option<Rect32> {
    boundary_rect(db, OwnerType::Core).or_else(|| boundary_rect(db, OwnerType::Die))
}

fn boundary_rect(db: &ChipViewDb, expected: OwnerType) -> Option<Rect32> {
    let query_bounds = db.stats().bbox.unwrap_or(Rect32 {
        lx: i32::MIN / 2,
        ly: i32::MIN / 2,
        hx: i32::MAX / 2,
        hy: i32::MAX / 2,
    });
    db.query_layer_intersect_records(LAYOUT_GEOMETRY_LAYER, query_bounds)
        .into_iter()
        .find(|shape| {
            db.owner_for_shape(shape)
                .is_some_and(|owner| owner_type_is(owner, expected))
        })
        .map(|shape| shape.bbox)
}

pub(crate) fn rect_contains(rect: Rect32, point: Point32) -> bool {
    point.x >= rect.lx && point.x <= rect.hx && point.y >= rect.ly && point.y <= rect.hy
}

/// Strict interior overlap; macros sharing only an edge do not conflict.
pub(crate) fn rects_overlap(a: Rect32, b: Rect32) -> bool {
    a.lx < b.hx && b.lx < a.hx && a.ly < b.hy && b.ly < a.hy
}

/// True when `rect` lies completely within `bounds` (edges may touch).
pub(crate) fn rect_fits_inside(rect: Rect32, bounds: Rect32) -> bool {
    rect.lx >= bounds.lx && rect.ly >= bounds.ly && rect.hx <= bounds.hx && rect.hy <= bounds.hy
}

/// Translates `rect` by the smallest amount that keeps it inside `bounds`.
pub(crate) fn clamp_rect_into(rect: Rect32, bounds: Rect32) -> Rect32 {
    let dx = if rect.hx > bounds.hx {
        bounds.hx - rect.hx
    } else if rect.lx < bounds.lx {
        bounds.lx - rect.lx
    } else {
        0
    };
    let dy = if rect.hy > bounds.hy {
        bounds.hy - rect.hy
    } else if rect.ly < bounds.ly {
        bounds.ly - rect.ly
    } else {
        0
    };
    Rect32 {
        lx: rect.lx.saturating_add(dx),
        ly: rect.ly.saturating_add(dy),
        hx: rect.hx.saturating_add(dx),
        hy: rect.hy.saturating_add(dy),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn clamp_keeps_rect_inside_bounds_by_translation() {
        let bounds = Rect32 {
            lx: 0,
            ly: 0,
            hx: 100,
            hy: 100,
        };
        let outside_right = Rect32 {
            lx: 90,
            ly: 10,
            hx: 130,
            hy: 30,
        };
        assert_eq!(
            clamp_rect_into(outside_right, bounds),
            Rect32 {
                lx: 60,
                ly: 10,
                hx: 100,
                hy: 30
            },
        );
        let inside = Rect32 {
            lx: 10,
            ly: 10,
            hx: 30,
            hy: 30,
        };
        assert_eq!(clamp_rect_into(inside, bounds), inside);
    }

    #[test]
    fn overlap_detection_excludes_touching_edges() {
        let a = Rect32 {
            lx: 0,
            ly: 0,
            hx: 10,
            hy: 10,
        };
        let touching = Rect32 {
            lx: 10,
            ly: 0,
            hx: 20,
            hy: 10,
        };
        let overlapping = Rect32 {
            lx: 5,
            ly: 5,
            hx: 15,
            hy: 15,
        };
        assert!(!rects_overlap(a, touching));
        assert!(rects_overlap(a, overlapping));
    }
}
