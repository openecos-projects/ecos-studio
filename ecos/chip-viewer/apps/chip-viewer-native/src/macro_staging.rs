//! Staging state for manual macro placement in the layout edit session.
//!
//! After preFloorplan every instance is unplaced, and the geometry snapshot
//! skips unplaced instances, so the Electron bridge publishes a macro staging
//! manifest (built from the step DEF and master metadata). This module owns
//! the viewer-side state for those macros: the staging row extending left
//! from the die origin, an aggregate placeholder for unplaced standard cells
//! parked just outside the die to the right of its bottom-right corner,
//! multi-selection, placement constraints, and reconciliation against
//! snapshots that already contain placed macros.

use std::collections::{BTreeMap, BTreeSet};
use std::path::Path;

use chip_view_db::ChipViewDb;
use chipgeom_format::{OwnerRef, OwnerType, Point32, Rect32, ShapeRecord};
use serde::Deserialize;

use crate::macro_ops::{MacroOpQueue, PlacementStatus, PlannedMacroMove};
use crate::macro_orient::{MacroOrientation, MasterSymmetry};

/// Layout geometry lives on layer 0; see `LAYOUT_GEOMETRY_LAYER` in app.rs.
const LAYOUT_GEOMETRY_LAYER: u16 = 0;

/// Gap between staged macro slots, as a fraction of the largest macro.
const STAGING_SLOT_GAP_FRACTION: i64 = 10;
/// Maximum fraction of the die width/height the stdcell blob may occupy.
const STDCELL_BLOB_MAX_FRACTION: i64 = 5;

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct MacroStagingManifestFile {
    #[serde(default)]
    schema: u32,
    #[serde(default)]
    die_area: Option<Rect32>,
    #[serde(default)]
    macros: Vec<MacroStagingEntryFile>,
    #[serde(default)]
    stdcell_staging: Option<StdcellStagingFile>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct StdcellStagingFile {
    #[serde(default)]
    count: u64,
    #[serde(default)]
    area_dbu: i64,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
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
    #[serde(default)]
    saved_placement: Option<SavedMacroPlacementFile>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct SavedMacroPlacementFile {
    x_dbu: i32,
    y_dbu: i32,
}

/// A selected or manipulated macro: either a placed snapshot shape or an
/// unplaced macro in the staging row.
#[derive(Clone, Debug, PartialEq, Eq, PartialOrd, Ord)]
pub(crate) enum MacroTarget {
    Placed(String),
    Staged(String),
}

impl MacroTarget {
    pub(crate) fn name(&self) -> &str {
        match self {
            Self::Placed(name) | Self::Staged(name) => name,
        }
    }
}

/// Ordered macro selection. A set alone cannot represent "first selected",
/// which is part of the alignment and spacing contract.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub(crate) struct MacroSelection {
    order: Vec<MacroTarget>,
    members: BTreeSet<MacroTarget>,
}

impl MacroSelection {
    pub(crate) fn clear(&mut self) {
        self.order.clear();
        self.members.clear();
    }

    pub(crate) fn is_empty(&self) -> bool {
        self.order.is_empty()
    }

    pub(crate) fn contains(&self, target: &MacroTarget) -> bool {
        self.members.contains(target)
    }

    pub(crate) fn insert(&mut self, target: MacroTarget) -> bool {
        if self.members.insert(target.clone()) {
            self.order.push(target);
            true
        } else {
            false
        }
    }

    pub(crate) fn remove(&mut self, target: &MacroTarget) -> bool {
        if self.members.remove(target) {
            self.order.retain(|existing| existing != target);
            true
        } else {
            false
        }
    }

    pub(crate) fn toggle(&mut self, target: MacroTarget) {
        if !self.remove(&target) {
            self.insert(target);
        }
    }

    pub(crate) fn extend(&mut self, targets: impl IntoIterator<Item = MacroTarget>) {
        for target in targets {
            self.insert(target);
        }
    }

    pub(crate) fn replace(&mut self, targets: impl IntoIterator<Item = MacroTarget>) {
        self.clear();
        self.extend(targets);
    }

    pub(crate) fn first(&self) -> Option<&MacroTarget> {
        self.order.first()
    }

    pub(crate) fn iter(&self) -> impl Iterator<Item = &MacroTarget> {
        self.order.iter()
    }
}

impl<'a> IntoIterator for &'a MacroSelection {
    type Item = &'a MacroTarget;
    type IntoIter = std::slice::Iter<'a, MacroTarget>;

    fn into_iter(self) -> Self::IntoIter {
        self.order.iter()
    }
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

/// Consistent snapshot of one macro used by the operation planners and drag
/// previews.
#[derive(Clone, Debug)]
pub(crate) struct MacroPlacementView {
    pub name: String,
    pub orient: MacroOrientation,
    pub bbox: Rect32,
    pub symmetry: MasterSymmetry,
    pub staged: bool,
}

pub(crate) struct MacroStagingState {
    pub staged: Vec<StagedMacro>,
    pub selection: MacroSelection,
    /// Orientations of macros that already have a placed shape; the snapshot
    /// does not encode instance orientation.
    pub orient_by_name: BTreeMap<String, MacroOrientation>,
    /// Session-local placement status. The staging manifest does not yet
    /// carry the DEF placement status, so this starts from conservative
    /// defaults and is updated as the user applies status changes.
    pub status_by_name: BTreeMap<String, PlacementStatus>,
    pub die_rect: Option<Rect32>,
    pub core_rect: Option<Rect32>,
    pub queue: MacroOpQueue,
    pub message: Option<String>,
    /// Aggregate placeholder for unplaced standard cells just outside the
    /// die, to the right of its bottom-right corner; purely visual, never
    /// selectable or saved.
    pub stdcell_blob: Option<StdcellBlob>,
}

/// Visual placeholder covering the unplaced standard-cell population.
pub(crate) struct StdcellBlob {
    pub count: u64,
    pub area_dbu: i64,
    /// Blob rectangle in world (DBU) coordinates.
    pub rect: Rect32,
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

        let die_rect = die_rect(db).or(manifest.die_area);
        let mut state = MacroStagingState {
            staged: Vec::new(),
            selection: MacroSelection::default(),
            orient_by_name: BTreeMap::new(),
            status_by_name: BTreeMap::new(),
            die_rect,
            core_rect: resolve_core_rect(db).or(die_rect),
            queue: MacroOpQueue::default(),
            message: None,
            stdcell_blob: None,
        };
        let mut saved_positions = BTreeMap::new();
        for entry in manifest.macros {
            let orient = entry
                .orient
                .as_deref()
                .and_then(MacroOrientation::from_str)
                .unwrap_or(MacroOrientation::R0);
            if entry.placed {
                state.orient_by_name.insert(entry.name.clone(), orient);
                state
                    .status_by_name
                    .insert(entry.name.clone(), PlacementStatus::Fixed);
                continue;
            }
            state
                .status_by_name
                .insert(entry.name.clone(), PlacementStatus::Unplaced);
            if let Some(saved) = entry.saved_placement {
                saved_positions.insert(
                    entry.name.clone(),
                    Point32 {
                        x: saved.x_dbu,
                        y: saved.y_dbu,
                    },
                );
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
        if let Some(die) = state.die_rect {
            state.layout_staged(die);
            if let Some(stdcell) = manifest.stdcell_staging {
                state.layout_stdcell_blob(die, stdcell.count, stdcell.area_dbu);
            }
        }
        for staged in &mut state.staged {
            let Some(position) = saved_positions.get(&staged.name).copied() else {
                continue;
            };
            let (width, height) = staged.orient.bbox_size(staged.width, staged.height);
            staged.rect = saved_macro_rect(position, width, height)?;
            if state
                .core_rect
                .is_some_and(|core| rect_fits_inside(staged.rect, core))
            {
                state
                    .status_by_name
                    .insert(staged.name.clone(), PlacementStatus::Placed);
            }
        }
        state.reconcile(db);
        Some(state)
    }

    /// Assigns each unplaced macro a slot in the row extending left from the
    /// die origin, ordered by manifest order: the first macro's right edge
    /// sits at the die lower-left corner x and every bottom aligns with the
    /// die bottom y.
    pub(crate) fn layout_staged(&mut self, die: Rect32) {
        if self.staged.is_empty() {
            return;
        }
        let gap = self
            .staged
            .iter()
            .map(|macro_entry| macro_entry.height.max(macro_entry.width))
            .max()
            .unwrap_or(1)
            / STAGING_SLOT_GAP_FRACTION;
        let mut slot_right = die.lx;
        for macro_entry in &mut self.staged {
            let (width, height) = macro_entry
                .orient
                .bbox_size(macro_entry.width, macro_entry.height);
            let left = slot_right.saturating_sub(width as i32);
            macro_entry.rect = Rect32 {
                lx: left,
                ly: die.ly,
                hx: slot_right,
                hy: die.ly.saturating_add(height as i32),
            };
            slot_right = left.saturating_sub(gap as i32);
        }
    }

    /// Places the unplaced-stdcell placeholder blob just outside the die to
    /// the right of its bottom-right corner: the blob bottom edge aligns with
    /// the die bottom edge and it extends rightward from the die right edge.
    /// The blob never exceeds a small fraction of the die so it stays a
    /// visual hint rather than a placement obstacle.
    fn layout_stdcell_blob(&mut self, die: Rect32, count: u64, area_dbu: i64) {
        if count == 0 {
            return;
        }
        let die_width = (die.hx as i64 - die.lx as i64).max(1);
        let die_height = (die.hy as i64 - die.ly as i64).max(1);
        let max_side = (die_width.min(die_height) / STDCELL_BLOB_MAX_FRACTION).max(1);
        let area_side = (area_dbu.max(1) as f64).sqrt().ceil() as i64;
        let side = area_side.clamp(1, max_side);
        let lx = die.hx as i64;
        let ly = die.ly as i64;
        self.stdcell_blob = Some(StdcellBlob {
            count,
            area_dbu,
            rect: Rect32 {
                lx: lx as i32,
                ly: ly as i32,
                hx: (lx + side) as i32,
                hy: (ly + side) as i32,
            },
        });
    }

    /// Staging bounds that the canvas world rect must cover (staging row and
    /// stdcell blob).
    pub(crate) fn expanded_world(&self, base: Rect32) -> Rect32 {
        let mut world = base;
        for macro_entry in &self.staged {
            world.include(macro_entry.rect);
        }
        if let Some(blob) = &self.stdcell_blob {
            world.include(blob.rect);
        }
        world
    }

    /// Index of the staged macro whose rectangle contains the point, allowing
    /// `tolerance_dbu` of slop per side so far-out macros stay clickable at
    /// fit zoom. `tolerance_dbu` is 0 for an exact hit test.
    pub(crate) fn staged_index_at(&self, point: Point32, tolerance_dbu: i32) -> Option<usize> {
        self.staged
            .iter()
            .position(|macro_entry| rect_contains_with_slop(macro_entry.rect, point, tolerance_dbu))
    }

    pub(crate) fn staged_target_at(
        &self,
        point: Point32,
        tolerance_dbu: i32,
    ) -> Option<MacroTarget> {
        self.staged_index_at(point, tolerance_dbu)
            .and_then(|index| self.staged.get(index))
            .map(|macro_entry| MacroTarget::Staged(macro_entry.name.clone()))
    }

    /// A staged macro is considered placed once its accepted rectangle fits
    /// inside the core. It remains in this list until a later snapshot emits
    /// a real placed shape, but it no longer blocks Save.
    pub(crate) fn unplaced_staged_names(&self) -> Vec<&str> {
        self.staged
            .iter()
            .filter(|macro_entry| {
                self.status_of(&macro_entry.name) == PlacementStatus::Unplaced
                    || self
                        .core_rect
                        .is_none_or(|core| !rect_fits_inside(macro_entry.rect, core))
            })
            .map(|macro_entry| macro_entry.name.as_str())
            .collect()
    }

    pub(crate) fn unplaced_staged_count(&self) -> usize {
        self.unplaced_staged_names().len()
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

    pub(crate) fn status_of(&self, name: &str) -> PlacementStatus {
        if let Some(status) = self.status_by_name.get(name) {
            return *status;
        }
        if let Some(staged) = self.staged.iter().find(|entry| entry.name == name) {
            if self
                .core_rect
                .is_some_and(|core| rect_fits_inside(staged.rect, core))
            {
                return PlacementStatus::Placed;
            }
            return PlacementStatus::Unplaced;
        }
        PlacementStatus::Fixed
    }

    pub(crate) fn set_status(&mut self, name: &str, status: PlacementStatus) {
        self.status_by_name.insert(name.to_owned(), status);
    }

    pub(crate) fn common_selected_status(&self) -> Option<PlacementStatus> {
        let mut statuses = self
            .selection
            .iter()
            .map(|target| self.status_of(target.name()));
        let first = statuses.next()?;
        statuses.all(|status| status == first).then_some(first)
    }

    /// Drops staged macros that now have a placed shape and prunes selection
    /// entries whose shapes disappeared. Called after every snapshot reload.
    pub(crate) fn reconcile(&mut self, db: &ChipViewDb) {
        let selected_names: Vec<String> = self
            .selection
            .iter()
            .map(|target| target.name().to_owned())
            .collect();
        self.staged
            .retain(|macro_entry| instance_shape(db, &macro_entry.name).is_none());
        let reconciled = selected_names
            .into_iter()
            .filter_map(|name| {
                if instance_shape(db, &name).is_some() {
                    Some(MacroTarget::Placed(name))
                } else if self
                    .staged
                    .iter()
                    .any(|macro_entry| macro_entry.name == name)
                {
                    Some(MacroTarget::Staged(name))
                } else {
                    None
                }
            })
            .collect::<Vec<_>>();
        self.selection.replace(reconciled);
        self.die_rect = die_rect(db).or(self.die_rect);
        self.core_rect = resolve_core_rect(db).or(self.die_rect);
    }

    /// Gathers the current placement views for every selected macro.
    pub(crate) fn selected_placement_views(&self, db: &ChipViewDb) -> Vec<MacroPlacementView> {
        let mut views = Vec::new();
        for target in &self.selection {
            match target {
                MacroTarget::Staged(name) => {
                    let Some(macro_entry) = self
                        .staged
                        .iter()
                        .find(|macro_entry| macro_entry.name == *name)
                    else {
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
                MacroTarget::Placed(name) => {
                    let Some(shape) = instance_shape(db, name) else {
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

    pub(crate) fn selected_placed_count(&self) -> usize {
        self.selection
            .iter()
            .filter(|target| match target {
                MacroTarget::Placed(_) => true,
                MacroTarget::Staged(name) => self
                    .staged
                    .iter()
                    .find(|entry| entry.name == *name)
                    .is_some_and(|entry| {
                        self.core_rect
                            .is_none_or(|core| rect_fits_inside(entry.rect, core))
                    }),
            })
            .count()
    }

    pub(crate) fn staged_names_intersecting_except(
        &self,
        rect: Rect32,
        skipped_names: &BTreeSet<String>,
    ) -> Vec<String> {
        self.staged
            .iter()
            .filter(|entry| !skipped_names.contains(&entry.name))
            .filter(|entry| rects_overlap(entry.rect, rect))
            .map(|entry| entry.name.clone())
            .collect()
    }

    pub(crate) fn targets_intersecting(
        &self,
        db: &ChipViewDb,
        rect: Rect32,
    ) -> BTreeSet<MacroTarget> {
        let mut targets = self
            .staged
            .iter()
            .filter(|macro_entry| macro_entry.rect.intersects(rect))
            .map(|macro_entry| MacroTarget::Staged(macro_entry.name.clone()))
            .collect::<BTreeSet<_>>();
        for name in self.orient_by_name.keys() {
            if instance_shape(db, name).is_some_and(|shape| shape.bbox.intersects(rect)) {
                targets.insert(MacroTarget::Placed(name.clone()));
            }
        }
        targets
    }

    /// Applies orientation-only operations to macros that still live in the
    /// local staging row and returns the moves that require backend commands.
    pub(crate) fn apply_staged_moves(
        &mut self,
        moves: Vec<PlannedMacroMove>,
    ) -> Vec<PlannedMacroMove> {
        let mut committed = Vec::new();
        for item in moves {
            if item.staged {
                if let Some(macro_entry) = self
                    .staged
                    .iter_mut()
                    .find(|macro_entry| macro_entry.name == item.name)
                {
                    macro_entry.orient = item.orient;
                    macro_entry.rect = item.rect;
                }
            } else {
                committed.push(item);
            }
        }
        committed
    }

    /// Applies an accepted manual drag from the unplaced staging row. Staged
    /// macros have no snapshot shape, so their preview rectangle is the only
    /// source of truth until Save publishes macro locations.
    pub(crate) fn commit_staged_move(
        &mut self,
        name: &str,
        orient: MacroOrientation,
        rect: Rect32,
    ) -> bool {
        let Some(macro_entry) = self
            .staged
            .iter_mut()
            .find(|macro_entry| macro_entry.name == name)
        else {
            return false;
        };
        macro_entry.orient = orient;
        macro_entry.rect = rect;
        true
    }
}

fn saved_macro_rect(position: Point32, width: i64, height: i64) -> Option<Rect32> {
    if width <= 0 || height <= 0 {
        return None;
    }
    let hx = i64::from(position.x).checked_add(width)?;
    let hy = i64::from(position.y).checked_add(height)?;
    Some(Rect32 {
        lx: position.x,
        ly: position.y,
        hx: i32::try_from(hx).ok()?,
        hy: i32::try_from(hy).ok()?,
    })
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

/// Names of placed instances overlapping `bbox`, excluding every instance
/// participating in the same planned batch.
pub(crate) fn instance_names_intersecting_except(
    db: &ChipViewDb,
    bbox: Rect32,
    skipped_names: &BTreeSet<String>,
) -> Vec<String> {
    db.query_layer_intersect_records(LAYOUT_GEOMETRY_LAYER, bbox)
        .into_iter()
        .filter(|shape| {
            db.owner_for_shape(shape)
                .is_some_and(|owner| owner_type_is(owner, OwnerType::InstanceBBox))
        })
        .filter(|shape| rects_overlap(shape.bbox, bbox))
        .filter_map(|shape| shape_instance_name(db, shape))
        .filter(|name| !skipped_names.contains(*name))
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

pub(crate) fn rect_contains_with_slop(rect: Rect32, point: Point32, slop_dbu: i32) -> bool {
    point.x >= rect.lx.saturating_sub(slop_dbu)
        && point.x <= rect.hx.saturating_add(slop_dbu)
        && point.y >= rect.ly.saturating_sub(slop_dbu)
        && point.y <= rect.hy.saturating_add(slop_dbu)
}

/// Paints the unplaced-stdcell placeholder blob in screen space. The striped
/// fill marks it as aggregate staging geometry rather than real shapes.
pub(crate) fn paint_stdcell_blob(painter: &egui::Painter, blob: &StdcellBlob, screen: egui::Rect) {
    if !screen.is_positive() {
        return;
    }
    let base = egui::Color32::from_rgb(150, 150, 160);
    painter.rect_filled(
        screen,
        0.0,
        egui::Color32::from_rgba_unmultiplied(150, 150, 160, 40),
    );
    let clipped = painter.with_clip_rect(screen);
    let step = 14.0;
    let mut x = screen.left();
    while x < screen.right() {
        clipped.line_segment(
            [egui::pos2(x, screen.top()), egui::pos2(x, screen.bottom())],
            egui::Stroke::new(
                1.0,
                egui::Color32::from_rgba_unmultiplied(150, 150, 160, 70),
            ),
        );
        x += step;
    }
    painter.rect_stroke(
        screen,
        0.0,
        egui::Stroke::new(1.0, base),
        egui::StrokeKind::Inside,
    );
    let label = format!("{} unplaced stdcells", blob.count);
    painter.text(
        screen.center(),
        egui::Align2::CENTER_CENTER,
        label,
        egui::FontId::proportional(12.0),
        base,
    );
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
    fn manifest_file_deserializes_camel_case_fields() {
        let manifest: MacroStagingManifestFile = serde_json::from_str(
            r#"{
                "schema": 1,
                "dbuPerMicron": 1000,
                "dieArea": { "lx": 0, "ly": 0, "hx": 52000, "hy": 53000 },
                "macros": [
                    {
                        "name": "u_rom01",
                        "master": "ROM_16x8",
                        "widthDbu": 12000,
                        "heightDbu": 8000,
                        "orient": "R0",
                        "placed": false,
                        "savedPlacement": { "xDbu": 12000, "yDbu": 16000 }
                    }
                ],
                "stdcellStaging": { "count": 42, "areaDbu": 900 }
            }"#,
        )
        .expect("manifest parses");

        assert_eq!(manifest.schema, 1);
        assert_eq!(
            manifest.die_area,
            Some(Rect32 {
                lx: 0,
                ly: 0,
                hx: 52000,
                hy: 53000,
            })
        );
        let entry = &manifest.macros[0];
        assert_eq!(entry.name, "u_rom01");
        assert_eq!(entry.width_dbu, 12000);
        assert_eq!(entry.height_dbu, 8000);
        assert!(!entry.placed);
        assert_eq!(
            entry
                .saved_placement
                .as_ref()
                .map(|saved| (saved.x_dbu, saved.y_dbu)),
            Some((12000, 16000))
        );
        let stdcell = manifest.stdcell_staging.expect("stdcell staging");
        assert_eq!(stdcell.count, 42);
        assert_eq!(stdcell.area_dbu, 900);
    }

    #[test]
    fn manifest_file_omits_stdcell_staging_when_absent() {
        let manifest: MacroStagingManifestFile =
            serde_json::from_str(r#"{ "schema": 1, "macros": [] }"#)
                .expect("legacy manifest parses");
        assert!(manifest.stdcell_staging.is_none());
    }

    #[test]
    fn saved_macro_rect_uses_oriented_dimensions() {
        let (width, height) = MacroOrientation::R0.bbox_size(400, 300);
        assert_eq!(
            saved_macro_rect(Point32 { x: 100, y: 200 }, width, height),
            Some(Rect32 {
                lx: 100,
                ly: 200,
                hx: 500,
                hy: 500,
            })
        );
        let (width, height) = MacroOrientation::R90.bbox_size(400, 300);
        assert_eq!(
            saved_macro_rect(Point32 { x: 100, y: 200 }, width, height),
            Some(Rect32 {
                lx: 100,
                ly: 200,
                hx: 400,
                hy: 600,
            })
        );
    }

    #[test]
    fn saved_macro_rect_rejects_invalid_sizes_and_overflow() {
        assert_eq!(saved_macro_rect(Point32 { x: 0, y: 0 }, 0, 10), None);
        assert_eq!(saved_macro_rect(Point32 { x: i32::MAX, y: 0 }, 1, 10), None);
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

    fn staged_state(sizes: &[(i64, i64)]) -> MacroStagingState {
        MacroStagingState {
            staged: sizes
                .iter()
                .enumerate()
                .map(|(index, &(width, height))| StagedMacro {
                    name: format!("u_macro{index}"),
                    master: "BLK".to_string(),
                    width,
                    height,
                    orient: MacroOrientation::R0,
                    rect: Rect32::default(),
                })
                .collect(),
            selection: MacroSelection::default(),
            orient_by_name: BTreeMap::new(),
            status_by_name: BTreeMap::new(),
            die_rect: None,
            core_rect: None,
            queue: MacroOpQueue::default(),
            message: None,
            stdcell_blob: None,
        }
    }

    #[test]
    fn layout_staged_rows_macros_left_from_die_origin() {
        let die = Rect32 {
            lx: 1000,
            ly: 500,
            hx: 51000,
            hy: 5500,
        };
        let mut state = staged_state(&[(400, 300), (200, 100)]);
        state.layout_staged(die);

        // Largest macro is 400 DBU, so the gap is 40 DBU.
        assert_eq!(
            state.staged[0].rect,
            Rect32 {
                lx: 600,
                ly: 500,
                hx: 1000,
                hy: 800,
            },
        );
        assert_eq!(
            state.staged[1].rect,
            Rect32 {
                lx: 360,
                ly: 500,
                hx: 560,
                hy: 600,
            },
        );
    }

    #[test]
    fn explicit_unplaced_status_blocks_save_even_inside_core() {
        let mut state = staged_state(&[(400, 300)]);
        state.core_rect = Some(Rect32 {
            lx: 0,
            ly: 0,
            hx: 1000,
            hy: 1000,
        });
        state.staged[0].rect = Rect32 {
            lx: 100,
            ly: 100,
            hx: 500,
            hy: 400,
        };
        assert!(state.unplaced_staged_names().is_empty());

        state.set_status("u_macro0", PlacementStatus::Unplaced);
        assert_eq!(state.unplaced_staged_names(), vec!["u_macro0"]);
    }

    #[test]
    fn layout_stdcell_blob_parks_right_of_die_bottom_right() {
        let die = Rect32 {
            lx: 0,
            ly: 0,
            hx: 100_000,
            hy: 80_000,
        };
        let mut state = staged_state(&[]);
        state.layout_stdcell_blob(die, 42_000, 900_000_000);
        let blob = state.stdcell_blob.expect("blob");
        assert_eq!(blob.count, 42_000);
        // sqrt(900_000_000) ≈ 30000 clamps to the 5% die cap of 16000.
        assert_eq!(blob.rect.lx, die.hx);
        assert_eq!(blob.rect.ly, die.ly);
        assert_eq!(blob.rect.hx - blob.rect.lx, 16_000);
        assert!(blob.rect.lx >= die.hx);
        assert!(blob.rect.ly >= die.ly);

        let mut empty = staged_state(&[]);
        empty.layout_stdcell_blob(die, 0, 0);
        assert!(empty.stdcell_blob.is_none());
    }

    #[test]
    fn expanded_world_covers_staging_row_and_blob() {
        let die = Rect32 {
            lx: 0,
            ly: 0,
            hx: 10_000,
            hy: 5_000,
        };
        let mut state = staged_state(&[(400, 300)]);
        state.layout_staged(die);
        state.layout_stdcell_blob(die, 10, 100);
        let world = state.expanded_world(die);
        assert!(world.lx <= state.staged[0].rect.lx);
        assert!(world.ly <= die.ly);
        let blob = state.stdcell_blob.expect("blob");
        assert_eq!(world.hx, blob.rect.hx);
        assert!(world.hx > die.hx);
    }

    #[test]
    fn apply_staged_moves_updates_local_preview_and_returns_placed_moves() {
        let mut state = staged_state(&[(400, 300)]);
        state.staged[0].rect = Rect32 {
            lx: -400,
            ly: 0,
            hx: 0,
            hy: 300,
        };
        let staged_move = PlannedMacroMove {
            name: "u_macro0".to_string(),
            orient: MacroOrientation::R90,
            rect: Rect32 {
                lx: -350,
                ly: -50,
                hx: -50,
                hy: 350,
            },
            staged: true,
            placement_status: None,
        };
        let placed_move = PlannedMacroMove {
            name: "u_placed".to_string(),
            orient: MacroOrientation::My,
            rect: Rect32 {
                lx: 100,
                ly: 200,
                hx: 500,
                hy: 500,
            },
            staged: false,
            placement_status: None,
        };

        let committed = state.apply_staged_moves(vec![staged_move.clone(), placed_move.clone()]);

        assert_eq!(state.staged[0].orient, staged_move.orient);
        assert_eq!(state.staged[0].rect, staged_move.rect);
        assert_eq!(committed.len(), 1);
        assert_eq!(committed[0].name, placed_move.name);
        assert_eq!(committed[0].orient, placed_move.orient);
        assert_eq!(committed[0].rect, placed_move.rect);
        assert_eq!(committed[0].staged, placed_move.staged);
    }

    #[test]
    fn apply_staged_moves_ignores_unknown_staged_names() {
        let mut state = staged_state(&[(400, 300)]);
        let original_name = state.staged[0].name.clone();
        let original_orient = state.staged[0].orient;
        let original_rect = state.staged[0].rect;

        let committed = state.apply_staged_moves(vec![PlannedMacroMove {
            name: "missing".to_string(),
            orient: MacroOrientation::R180,
            rect: Rect32 {
                lx: 10,
                ly: 20,
                hx: 410,
                hy: 320,
            },
            staged: true,
            placement_status: None,
        }]);

        assert!(committed.is_empty());
        assert_eq!(state.staged[0].name, original_name);
        assert_eq!(state.staged[0].orient, original_orient);
        assert_eq!(state.staged[0].rect, original_rect);
    }

    #[test]
    fn commit_staged_move_updates_rect_and_orientation() {
        let mut state = staged_state(&[(400, 300)]);
        let name = state.staged[0].name.clone();
        let rect = Rect32 {
            lx: 100,
            ly: 200,
            hx: 500,
            hy: 500,
        };

        assert!(state.commit_staged_move(&name, MacroOrientation::R90, rect));
        assert_eq!(state.staged[0].rect, rect);
        assert_eq!(state.staged[0].orient, MacroOrientation::R90);
        assert!(!state.commit_staged_move("missing", MacroOrientation::R0, rect));
    }

    #[test]
    fn staged_macros_are_unplaced_until_their_rect_is_inside_the_core() {
        let mut state = staged_state(&[(400, 300)]);
        state.core_rect = Some(Rect32 {
            lx: 0,
            ly: 0,
            hx: 1_000,
            hy: 1_000,
        });
        state.staged[0].rect = Rect32 {
            lx: -400,
            ly: 0,
            hx: 0,
            hy: 300,
        };

        assert_eq!(state.unplaced_staged_count(), 1);

        state.staged[0].rect = Rect32 {
            lx: 100,
            ly: 100,
            hx: 500,
            hy: 400,
        };

        assert_eq!(state.unplaced_staged_count(), 0);
        assert!(state.unplaced_staged_names().is_empty());
    }
}
