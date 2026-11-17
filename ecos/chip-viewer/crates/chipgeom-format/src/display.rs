//! Geometry-owned display assets. All numeric header/cell fields are little endian.
pub const MAGIC: &[u8; 8] = b"ECOSDSP1";
pub const VERSION: u32 = 1;
pub const HEADER_SIZE: usize = 40;
pub const CELL_SIZE: usize = 32;
pub const CELLS: u32 = 1;
pub const RECORDS: u32 = 2;
pub const MAX_METADATA_BYTES: usize = 1024 * 1024;
pub const MAX_RECORD_BYTES: usize = 64 * 1024 * 1024;

#[derive(Clone, Debug, PartialEq)]
pub struct DisplayCell {
    pub row: u32,
    pub column: u32,
    pub bounds: crate::Rect32,
    pub value: f64,
}
