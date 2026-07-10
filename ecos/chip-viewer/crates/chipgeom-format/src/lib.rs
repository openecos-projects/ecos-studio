use bytemuck::{Pod, Zeroable};
use serde::{Deserialize, Serialize};

pub const GEOMETRY_SCHEMA_VERSION: u32 = 1;
pub const GEOMETRY_FILE_MAGIC: u64 = 0x4543_4745_4f4d_3031;
pub const GEOMETRY_FILE_HEADER_SIZE: usize = core::mem::size_of::<GeometryFileHeader>();

pub type ShapeId = u64;
pub type ShapeVersion = u32;
pub type OwnerId = u64;
pub type LayerId = u16;
pub type NameId = u32;

#[repr(C)]
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize, Deserialize, Pod, Zeroable)]
pub struct Point32 {
    pub x: i32,
    pub y: i32,
}

#[repr(C)]
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize, Deserialize, Pod, Zeroable)]
pub struct Rect32 {
    pub lx: i32,
    pub ly: i32,
    pub hx: i32,
    pub hy: i32,
}

impl Rect32 {
    pub fn intersects(self, other: Rect32) -> bool {
        !(self.hx < other.lx || other.hx < self.lx || self.hy < other.ly || other.hy < self.ly)
    }

    pub fn include(&mut self, other: Rect32) {
        if *self == Rect32::default() {
            *self = other;
            return;
        }
        self.lx = self.lx.min(other.lx);
        self.ly = self.ly.min(other.ly);
        self.hx = self.hx.max(other.hx);
        self.hy = self.hy.max(other.hy);
    }
}

#[repr(u8)]
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum ShapeKind {
    Point = 1,
    Line = 2,
    Rect = 3,
}

#[repr(u8)]
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum ShapeState {
    Alive = 1,
    Deleted = 2,
}

#[repr(u8)]
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
pub enum OwnerType {
    None = 0,
    Die = 1,
    Core = 2,
    Row = 3,
    InstanceBBox = 4,
    InstanceHalo = 5,
    NetWireSegment = 6,
    SpecialWireSegment = 7,
    Via = 8,
    PinPortShape = 9,
    Blockage = 10,
    Fill = 11,
    Region = 12,
    Slot = 13,
    TrackGrid = 14,
    GCellGrid = 15,
    Obs = 16,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum GeometryEditOp {
    MoveShape,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum GeometryEditStatus {
    Accepted,
    AdjustedAccepted,
    Rejected,
    Conflict,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct GeometryEditCommand {
    pub command_id: u64,
    pub shape_id: ShapeId,
    pub expected_version: ShapeVersion,
    pub op: GeometryEditOp,
    pub requested_bbox: Rect32,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct GeometryEditResult {
    pub command_id: u64,
    pub shape_id: ShapeId,
    pub new_version: ShapeVersion,
    pub status: GeometryEditStatus,
    pub committed_bbox: Rect32,
}

impl OwnerType {
    pub fn from_raw(value: u8) -> Option<Self> {
        Some(match value {
            0 => OwnerType::None,
            1 => OwnerType::Die,
            2 => OwnerType::Core,
            3 => OwnerType::Row,
            4 => OwnerType::InstanceBBox,
            5 => OwnerType::InstanceHalo,
            6 => OwnerType::NetWireSegment,
            7 => OwnerType::SpecialWireSegment,
            8 => OwnerType::Via,
            9 => OwnerType::PinPortShape,
            10 => OwnerType::Blockage,
            11 => OwnerType::Fill,
            12 => OwnerType::Region,
            13 => OwnerType::Slot,
            14 => OwnerType::TrackGrid,
            15 => OwnerType::GCellGrid,
            16 => OwnerType::Obs,
            _ => return None,
        })
    }
}

#[repr(u16)]
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum GeometryFileKind {
    Unknown = 0,
    Meta = 1,
    Shapes = 2,
    Payload = 3,
    Owners = 4,
    Names = 5,
    NameIndex = 6,
    OwnerIndex = 7,
    Tiles = 8,
    View = 9,
    SidMap = 10,
    Delta = 11,
}

#[repr(C)]
#[derive(Clone, Copy, Debug, Default, Pod, Zeroable)]
pub struct GeometryFileHeader {
    pub magic: u64,
    pub schema_version: u32,
    pub header_size: u32,
    pub file_kind: u16,
    pub flags: u16,
    pub record_size: u32,
    pub record_count: u64,
    pub payload_size: u64,
    pub reserved0: u64,
    pub reserved1: u64,
}

#[repr(C)]
#[derive(Clone, Copy, Debug, Default, Pod, Zeroable)]
pub struct ShapeRecord {
    pub id: ShapeId,
    pub version: ShapeVersion,
    pub layer_id: LayerId,
    pub kind: u8,
    pub state: u8,
    pub flags: u16,
    pub reserved_padding0: u16,
    pub owner_index: u32,
    pub payload_offset: u64,
    pub payload_size: u32,
    pub style_class: u32,
    pub bbox: Rect32,
}

#[repr(C)]
#[derive(Clone, Copy, Debug, Default, Pod, Zeroable)]
pub struct OwnerRef {
    pub owner_type: u8,
    pub reserved0: u8,
    pub flags: u16,
    pub reserved_padding0: u32,
    pub owner_id: OwnerId,
    pub path0: u32,
    pub path1: u32,
    pub path2: u32,
    pub path3: u32,
    pub name_id: NameId,
    pub reserved_padding1: u32,
}

#[repr(C)]
#[derive(Clone, Copy, Debug, Default, Pod, Zeroable)]
pub struct GeometryNameRecord {
    pub owner_type: u8,
    pub reserved0: u8,
    pub flags: u16,
    pub reserved_padding0: u32,
    pub owner_id: OwnerId,
    pub name_offset: u64,
    pub name_size: u32,
    pub reserved1: u32,
}

#[repr(C)]
#[derive(Clone, Copy, Debug, Default, Pod, Zeroable)]
pub struct GeometryMetaRecord {
    pub shape_count: u64,
    pub owner_count: u64,
    pub payload_size: u64,
    pub name_record_count: u64,
    pub name_payload_size: u64,
    pub next_shape_id: ShapeId,
    pub reserved0: u64,
    pub reserved1: u64,
}

#[repr(C)]
#[derive(Clone, Copy, Debug, Default, Pod, Zeroable)]
pub struct GeometrySidMapRecord {
    pub shape_id: ShapeId,
    pub owner: OwnerRef,
}

#[repr(C)]
#[derive(Clone, Copy, Debug, Default, Pod, Zeroable)]
pub struct GeometryDeltaRecord {
    pub sequence_id: u64,
    pub command_id: u64,
    pub op: u8,
    pub reserved0: u8,
    pub reserved1: u16,
    pub reserved2: u32,
    pub shape_id: ShapeId,
    pub old_version: ShapeVersion,
    pub new_version: ShapeVersion,
    pub old_bbox: Rect32,
    pub new_bbox: Rect32,
}

#[repr(C)]
#[derive(Clone, Copy, Debug, Default, Pod, Zeroable)]
pub struct GeometryViewTileRecord {
    pub lod_level: u8,
    pub reserved0: u8,
    pub layer_id: LayerId,
    pub tile_x: i32,
    pub tile_y: i32,
    pub shape_count: u32,
    pub reserved1: u32,
    pub bbox: Rect32,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn c_layout_sizes_match_cpp_snapshot_schema() {
        assert_eq!(core::mem::size_of::<GeometryFileHeader>(), 56);
        assert_eq!(core::mem::size_of::<ShapeRecord>(), 56);
        assert_eq!(core::mem::size_of::<OwnerRef>(), 40);
        assert_eq!(core::mem::size_of::<GeometryNameRecord>(), 32);
        assert_eq!(core::mem::size_of::<GeometryMetaRecord>(), 64);
        assert_eq!(core::mem::size_of::<GeometrySidMapRecord>(), 48);
        assert_eq!(GeometryFileKind::Delta as u16, 11);
        assert_eq!(core::mem::size_of::<GeometryDeltaRecord>(), 72);
        assert_eq!(GeometryFileKind::View as u16, 9);
        assert_eq!(core::mem::size_of::<GeometryViewTileRecord>(), 36);
    }
}
