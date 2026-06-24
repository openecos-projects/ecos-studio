use std::io::{Read, Write};

use anyhow::{bail, Result};
use byteorder::{LittleEndian, ReadBytesExt, WriteBytesExt};
use serde::{Deserialize, Serialize};

pub const LAYOUTPKG_SCHEMA: &str = "ecos.layoutpkg.v1";
pub const DETAIL_INDEX_SCHEMA: &str = "ecos.layoutpkg.detail_index.v1";
pub const DETAIL_SCOPE_SCHEMA: &str = "ecos.layoutpkg.detail_scope.v1";
pub const OVERVIEW_INDEX_SCHEMA: &str = "ecos.layoutpkg.overview_index.v1";
pub const QUERY_INDEX_SCHEMA: &str = "ecos.layoutpkg.query_index.v1";
pub const HIERARCHY_SCHEMA: &str = "ecos.layoutpkg.hierarchy.v2";
pub const HIERARCHY_INDEX_SCHEMA: &str = "ecos.layoutpkg.hierarchy_index.v1";
pub const OVERVIEW_PYRAMID_SCHEMA: &str = "ecos.layoutpkg.overview_pyramid.v1";
pub const DETAIL_TILE_MAGIC: &[u8; 8] = b"ELDTILE1";
pub const DETAIL_TILE_VERSION: u16 = 1;
pub const OVERVIEW_PYRAMID_MAGIC: &[u8; 8] = b"ELOPYR01";
pub const OVERVIEW_PYRAMID_VERSION: u16 = 1;

#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum LayoutObjectKind {
    Die = 1,
    Core = 2,
    Instance = 3,
    RegularWire = 4,
    SpecialWire = 5,
    Via = 6,
    IoPin = 7,
    Blockage = 8,
    Fill = 9,
    Region = 10,
    Row = 11,
    Track = 12,
    GCellGrid = 13,
}

impl LayoutObjectKind {
    pub fn code(self) -> u8 {
        self as u8
    }

    pub fn from_code(code: u8) -> Result<Self> {
        match code {
            1 => Ok(Self::Die),
            2 => Ok(Self::Core),
            3 => Ok(Self::Instance),
            4 => Ok(Self::RegularWire),
            5 => Ok(Self::SpecialWire),
            6 => Ok(Self::Via),
            7 => Ok(Self::IoPin),
            8 => Ok(Self::Blockage),
            9 => Ok(Self::Fill),
            10 => Ok(Self::Region),
            11 => Ok(Self::Row),
            12 => Ok(Self::Track),
            13 => Ok(Self::GCellGrid),
            _ => bail!("unsupported layout object kind code {code}"),
        }
    }

    pub fn is_queryable(self) -> bool {
        !matches!(
            self,
            Self::Die | Self::Core | Self::Row | Self::Track | Self::GCellGrid
        )
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct LayoutRectRecord {
    pub x1: i32,
    pub y1: i32,
    pub x2: i32,
    pub y2: i32,
    pub layer_id: u16,
    pub kind: LayoutObjectKind,
    pub flags: u8,
    pub source_id: u32,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct DetailScopeDocument {
    pub schema: String,
    pub version: u32,
    pub records: Vec<DetailRecordScope>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct DetailRecordScope {
    pub source_id: u32,
    pub cell_id: u32,
    pub coordinates: DetailCoordinates,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum DetailCoordinates {
    Top,
    CellLocal,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct HierarchyDocument {
    pub schema: String,
    pub version: u32,
    pub top_cell: u32,
    pub cells: Vec<HierarchyCell>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct HierarchyCell {
    pub id: u32,
    pub name: String,
    pub bbox: [i32; 4],
    #[serde(default)]
    pub shapes: Vec<HierarchyShape>,
    #[serde(default)]
    pub instances: Vec<HierarchyInstance>,
    #[serde(default)]
    pub layer_summaries: Vec<CellLayerSummary>,
    #[serde(default)]
    pub hierarchy_summary: CellHierarchySummary,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct HierarchyShape {
    pub layer_id: u16,
    pub kind: LayoutObjectKind,
    pub bbox: [i32; 4],
    #[serde(default)]
    pub source_id: u32,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct HierarchyInstance {
    pub id: u32,
    pub name: String,
    pub child_cell: u32,
    pub transform: Transform,
    pub array: CellArray,
    pub bbox: [i32; 4],
    #[serde(default)]
    pub source_id: u32,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct CellLayerSummary {
    pub layer_id: u16,
    pub kind: LayoutObjectKind,
    pub bbox: [i32; 4],
    pub shape_count: u32,
    pub total_area: i64,
}

#[derive(Debug, Clone, PartialEq, Eq, Default, Serialize, Deserialize)]
pub struct CellHierarchySummary {
    pub direct_instance_count: u32,
    pub direct_array_count: u32,
    pub expanded_array_element_count: u64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct GeometryRecord {
    pub layer_id: u16,
    pub kind: LayoutObjectKind,
    pub bbox: [i32; 4],
    pub source_id: u32,
    pub flags: u8,
    pub payload: GeometryPayload,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum GeometryPayload {
    Rect,
    Polygon {
        points: Vec<[i32; 2]>,
    },
    Path {
        points: Vec<[i32; 2]>,
        style: PathStyle,
    },
    Text(TextRecord),
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct PathStyle {
    pub width: i32,
    pub begin_ext: i32,
    pub end_ext: i32,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct TextRecord {
    pub text: String,
    pub origin: [i32; 2],
    pub height: i32,
    pub rotation: i32,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct OverviewPyramidDocument {
    pub schema: String,
    pub version: u32,
    pub world_bbox: [i32; 4],
    pub levels: Vec<OverviewLevel>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct OverviewLevel {
    pub level: u32,
    pub units_per_bin: i32,
    pub grid: [u32; 2],
    pub bins: Vec<OverviewBinRecord>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct OverviewBinRecord {
    pub bbox: [i32; 4],
    pub layer_id: u16,
    pub kind: LayoutObjectKind,
    pub count: u32,
    pub coverage_area: i64,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub struct Transform {
    pub dx: i32,
    pub dy: i32,
    pub orient: Orientation,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum Orientation {
    R0,
    R90,
    R180,
    R270,
    MX,
    MY,
    MXR90,
    MYR90,
    Unknown,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub struct CellArray {
    pub columns: u32,
    pub rows: u32,
    pub step_x: i32,
    pub step_y: i32,
}

impl Default for CellArray {
    fn default() -> Self {
        Self {
            columns: 1,
            rows: 1,
            step_x: 0,
            step_y: 0,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DetailTile {
    pub rects: Vec<LayoutRectRecord>,
}

pub fn write_detail_tile(writer: &mut impl Write, tile: &DetailTile) -> Result<()> {
    writer.write_all(DETAIL_TILE_MAGIC)?;
    writer.write_u16::<LittleEndian>(DETAIL_TILE_VERSION)?;
    writer.write_u16::<LittleEndian>(0)?;
    writer.write_u32::<LittleEndian>(tile.rects.len() as u32)?;
    writer.write_u32::<LittleEndian>(0)?;
    for rect in &tile.rects {
        writer.write_i32::<LittleEndian>(rect.x1)?;
        writer.write_i32::<LittleEndian>(rect.y1)?;
        writer.write_i32::<LittleEndian>(rect.x2)?;
        writer.write_i32::<LittleEndian>(rect.y2)?;
        writer.write_u16::<LittleEndian>(rect.layer_id)?;
        writer.write_u8(rect.kind.code())?;
        writer.write_u8(rect.flags)?;
        writer.write_u32::<LittleEndian>(rect.source_id)?;
    }
    Ok(())
}

pub fn read_detail_tile(reader: &mut impl Read) -> Result<DetailTile> {
    let mut magic = [0_u8; 8];
    reader.read_exact(&mut magic)?;
    if &magic != DETAIL_TILE_MAGIC {
        bail!("invalid detail tile magic");
    }
    let version = reader.read_u16::<LittleEndian>()?;
    if version != DETAIL_TILE_VERSION {
        bail!("unsupported detail tile version {version}");
    }
    let _flags = reader.read_u16::<LittleEndian>()?;
    let rect_count = reader.read_u32::<LittleEndian>()?;
    let _reserved = reader.read_u32::<LittleEndian>()?;
    let mut rects = Vec::with_capacity(rect_count as usize);
    for _ in 0..rect_count {
        rects.push(LayoutRectRecord {
            x1: reader.read_i32::<LittleEndian>()?,
            y1: reader.read_i32::<LittleEndian>()?,
            x2: reader.read_i32::<LittleEndian>()?,
            y2: reader.read_i32::<LittleEndian>()?,
            layer_id: reader.read_u16::<LittleEndian>()?,
            kind: LayoutObjectKind::from_code(reader.read_u8()?)?,
            flags: reader.read_u8()?,
            source_id: reader.read_u32::<LittleEndian>()?,
        });
    }
    Ok(DetailTile { rects })
}

pub fn write_overview_pyramid(
    writer: &mut impl Write,
    pyramid: &OverviewPyramidDocument,
) -> Result<()> {
    writer.write_all(OVERVIEW_PYRAMID_MAGIC)?;
    writer.write_u16::<LittleEndian>(OVERVIEW_PYRAMID_VERSION)?;
    writer.write_u16::<LittleEndian>(0)?;
    for value in pyramid.world_bbox {
        writer.write_i32::<LittleEndian>(value)?;
    }
    writer.write_u32::<LittleEndian>(pyramid.levels.len() as u32)?;
    writer.write_u32::<LittleEndian>(0)?;
    for level in &pyramid.levels {
        writer.write_u32::<LittleEndian>(level.level)?;
        writer.write_i32::<LittleEndian>(level.units_per_bin)?;
        writer.write_u32::<LittleEndian>(level.grid[0])?;
        writer.write_u32::<LittleEndian>(level.grid[1])?;
        writer.write_u32::<LittleEndian>(level.bins.len() as u32)?;
        writer.write_u32::<LittleEndian>(0)?;
        for bin in &level.bins {
            for value in bin.bbox {
                writer.write_i32::<LittleEndian>(value)?;
            }
            writer.write_u16::<LittleEndian>(bin.layer_id)?;
            writer.write_u8(bin.kind.code())?;
            writer.write_u8(0)?;
            writer.write_u32::<LittleEndian>(bin.count)?;
            writer.write_i64::<LittleEndian>(bin.coverage_area)?;
        }
    }
    Ok(())
}

pub fn read_overview_pyramid(reader: &mut impl Read) -> Result<OverviewPyramidDocument> {
    let mut magic = [0_u8; 8];
    reader.read_exact(&mut magic)?;
    if &magic != OVERVIEW_PYRAMID_MAGIC {
        bail!("invalid overview pyramid magic");
    }
    let version = reader.read_u16::<LittleEndian>()?;
    if version != OVERVIEW_PYRAMID_VERSION {
        bail!("unsupported overview pyramid version {version}");
    }
    let _flags = reader.read_u16::<LittleEndian>()?;
    let world_bbox = [
        reader.read_i32::<LittleEndian>()?,
        reader.read_i32::<LittleEndian>()?,
        reader.read_i32::<LittleEndian>()?,
        reader.read_i32::<LittleEndian>()?,
    ];
    let level_count = reader.read_u32::<LittleEndian>()?;
    let _reserved = reader.read_u32::<LittleEndian>()?;
    let mut levels = Vec::with_capacity(level_count as usize);
    for _ in 0..level_count {
        let level = reader.read_u32::<LittleEndian>()?;
        let units_per_bin = reader.read_i32::<LittleEndian>()?;
        let grid = [
            reader.read_u32::<LittleEndian>()?,
            reader.read_u32::<LittleEndian>()?,
        ];
        let bin_count = reader.read_u32::<LittleEndian>()?;
        let _reserved = reader.read_u32::<LittleEndian>()?;
        let mut bins = Vec::with_capacity(bin_count as usize);
        for _ in 0..bin_count {
            bins.push(OverviewBinRecord {
                bbox: [
                    reader.read_i32::<LittleEndian>()?,
                    reader.read_i32::<LittleEndian>()?,
                    reader.read_i32::<LittleEndian>()?,
                    reader.read_i32::<LittleEndian>()?,
                ],
                layer_id: reader.read_u16::<LittleEndian>()?,
                kind: LayoutObjectKind::from_code(reader.read_u8()?)?,
                count: {
                    let _reserved = reader.read_u8()?;
                    reader.read_u32::<LittleEndian>()?
                },
                coverage_area: reader.read_i64::<LittleEndian>()?,
            });
        }
        levels.push(OverviewLevel {
            level,
            units_per_bin,
            grid,
            bins,
        });
    }
    Ok(OverviewPyramidDocument {
        schema: OVERVIEW_PYRAMID_SCHEMA.to_string(),
        version: u32::from(version),
        world_bbox,
        levels,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn detail_tile_round_trips_rect_records() {
        let tile = DetailTile {
            rects: vec![LayoutRectRecord {
                x1: 10,
                y1: 20,
                x2: 30,
                y2: 40,
                layer_id: 7,
                kind: LayoutObjectKind::RegularWire,
                flags: 0,
                source_id: 99,
            }],
        };

        let mut bytes = Vec::new();
        write_detail_tile(&mut bytes, &tile).unwrap();

        let decoded = read_detail_tile(&mut bytes.as_slice()).unwrap();
        assert_eq!(decoded, tile);
    }

    #[test]
    fn detail_scope_manifest_round_trips() {
        let scopes = DetailScopeDocument {
            schema: DETAIL_SCOPE_SCHEMA.to_string(),
            version: 1,
            records: vec![DetailRecordScope {
                source_id: 7,
                cell_id: 3,
                coordinates: DetailCoordinates::CellLocal,
            }],
        };

        let encoded = serde_json::to_string(&scopes).unwrap();
        let decoded: DetailScopeDocument = serde_json::from_str(&encoded).unwrap();

        assert_eq!(decoded.schema, DETAIL_SCOPE_SCHEMA);
        assert_eq!(decoded.records[0].cell_id, 3);
        assert_eq!(decoded.records[0].coordinates, DetailCoordinates::CellLocal);
    }

    #[test]
    fn layout_object_kind_codes_cover_auxiliary_geometry() {
        assert_eq!(LayoutObjectKind::Row.code(), 11);
        assert_eq!(LayoutObjectKind::Track.code(), 12);
        assert_eq!(LayoutObjectKind::GCellGrid.code(), 13);
        assert_eq!(
            LayoutObjectKind::from_code(13).unwrap(),
            LayoutObjectKind::GCellGrid
        );
        assert_eq!(OVERVIEW_INDEX_SCHEMA, "ecos.layoutpkg.overview_index.v1");
    }

    #[test]
    fn layout_object_kind_marks_queryable_geometry() {
        assert!(LayoutObjectKind::Instance.is_queryable());
        assert!(LayoutObjectKind::RegularWire.is_queryable());
        assert!(LayoutObjectKind::IoPin.is_queryable());
        assert!(!LayoutObjectKind::Die.is_queryable());
        assert!(!LayoutObjectKind::Core.is_queryable());
        assert!(!LayoutObjectKind::Track.is_queryable());
    }

    #[test]
    fn hierarchy_document_round_trips_cells_shapes_and_inst_arrays() {
        let document = HierarchyDocument {
            schema: HIERARCHY_SCHEMA.to_string(),
            version: 2,
            top_cell: 0,
            cells: vec![
                HierarchyCell {
                    id: 0,
                    name: "top".to_string(),
                    bbox: [0, 0, 200, 100],
                    shapes: Vec::new(),
                    instances: vec![HierarchyInstance {
                        id: 7,
                        name: "u0".to_string(),
                        child_cell: 1,
                        transform: Transform {
                            dx: 20,
                            dy: 30,
                            orient: Orientation::MX,
                        },
                        array: CellArray {
                            columns: 3,
                            rows: 2,
                            step_x: 50,
                            step_y: 40,
                        },
                        bbox: [20, 30, 170, 110],
                        source_id: 99,
                    }],
                    layer_summaries: Vec::new(),
                    hierarchy_summary: CellHierarchySummary::default(),
                },
                HierarchyCell {
                    id: 1,
                    name: "nand2".to_string(),
                    bbox: [0, 0, 50, 40],
                    shapes: vec![HierarchyShape {
                        layer_id: 7,
                        kind: LayoutObjectKind::RegularWire,
                        bbox: [5, 6, 15, 16],
                        source_id: 11,
                    }],
                    instances: Vec::new(),
                    layer_summaries: Vec::new(),
                    hierarchy_summary: CellHierarchySummary::default(),
                },
            ],
        };

        let encoded = serde_json::to_string(&document).unwrap();
        let decoded: HierarchyDocument = serde_json::from_str(&encoded).unwrap();

        assert_eq!(decoded, document);
        assert_eq!(decoded.schema, HIERARCHY_SCHEMA);
        assert_eq!(decoded.cells[0].instances[0].array.columns, 3);
        assert_eq!(
            decoded.cells[1].shapes[0].kind,
            LayoutObjectKind::RegularWire
        );
    }

    #[test]
    fn hierarchy_cell_round_trips_layer_summaries() {
        let document = HierarchyDocument {
            schema: HIERARCHY_SCHEMA.to_string(),
            version: 3,
            top_cell: 1,
            cells: vec![HierarchyCell {
                id: 1,
                name: "top".to_string(),
                bbox: [0, 0, 100, 200],
                shapes: vec![],
                instances: vec![],
                layer_summaries: vec![CellLayerSummary {
                    layer_id: 7,
                    kind: LayoutObjectKind::RegularWire,
                    bbox: [10, 20, 30, 40],
                    shape_count: 3,
                    total_area: 600,
                }],
                hierarchy_summary: CellHierarchySummary {
                    direct_instance_count: 2,
                    direct_array_count: 1,
                    expanded_array_element_count: 64,
                },
            }],
        };

        let encoded = serde_json::to_string(&document).unwrap();
        let decoded: HierarchyDocument = serde_json::from_str(&encoded).unwrap();

        assert_eq!(decoded.cells[0].layer_summaries[0].layer_id, 7);
        assert_eq!(decoded.cells[0].layer_summaries[0].shape_count, 3);
        assert_eq!(
            decoded.cells[0]
                .hierarchy_summary
                .expanded_array_element_count,
            64
        );
    }

    #[test]
    fn hierarchy_cell_deserializes_legacy_json_without_summaries() {
        let json = r#"{
            "schema": "ecos.layoutpkg.hierarchy.v2",
            "version": 2,
            "top_cell": 0,
            "cells": [{
                "id": 0,
                "name": "top",
                "bbox": [0, 0, 100, 200],
                "shapes": [],
                "instances": []
            }]
        }"#;

        let decoded: HierarchyDocument = serde_json::from_str(json).unwrap();

        assert!(decoded.cells[0].layer_summaries.is_empty());
        assert_eq!(
            decoded.cells[0].hierarchy_summary,
            CellHierarchySummary::default()
        );
    }

    #[test]
    fn geometry_record_round_trips_polygon_path_and_text_payloads() {
        let records = vec![
            GeometryRecord {
                layer_id: 2,
                kind: LayoutObjectKind::Core,
                bbox: [1, 2, 3, 4],
                source_id: 10,
                flags: 0,
                payload: GeometryPayload::Rect,
            },
            GeometryRecord {
                layer_id: 3,
                kind: LayoutObjectKind::RegularWire,
                bbox: [0, 0, 10, 10],
                source_id: 11,
                flags: 0,
                payload: GeometryPayload::Polygon {
                    points: vec![[0, 0], [10, 0], [10, 10], [0, 10]],
                },
            },
            GeometryRecord {
                layer_id: 4,
                kind: LayoutObjectKind::SpecialWire,
                bbox: [0, 0, 100, 10],
                source_id: 12,
                flags: 0,
                payload: GeometryPayload::Path {
                    points: vec![[0, 5], [100, 5]],
                    style: PathStyle {
                        width: 10,
                        begin_ext: 0,
                        end_ext: 0,
                    },
                },
            },
            GeometryRecord {
                layer_id: 5,
                kind: LayoutObjectKind::IoPin,
                bbox: [20, 30, 20, 30],
                source_id: 13,
                flags: 0,
                payload: GeometryPayload::Text(TextRecord {
                    text: "PIN_A".to_string(),
                    origin: [20, 30],
                    height: 12,
                    rotation: 0,
                }),
            },
        ];

        let encoded = serde_json::to_string(&records).unwrap();
        let decoded: Vec<GeometryRecord> = serde_json::from_str(&encoded).unwrap();

        assert_eq!(decoded, records);
    }

    #[test]
    fn overview_pyramid_round_trips_density_levels() {
        let pyramid = OverviewPyramidDocument {
            schema: OVERVIEW_PYRAMID_SCHEMA.to_string(),
            version: 1,
            world_bbox: [0, 0, 1000, 1000],
            levels: vec![OverviewLevel {
                level: 0,
                units_per_bin: 100,
                grid: [10, 10],
                bins: vec![OverviewBinRecord {
                    bbox: [0, 0, 100, 100],
                    layer_id: 9,
                    kind: LayoutObjectKind::Via,
                    count: 12,
                    coverage_area: 240,
                }],
            }],
        };

        let encoded = serde_json::to_string(&pyramid).unwrap();
        let decoded: OverviewPyramidDocument = serde_json::from_str(&encoded).unwrap();

        assert_eq!(decoded.levels[0].bins[0].count, 12);
        assert_eq!(decoded.levels[0].units_per_bin, 100);
    }

    #[test]
    fn overview_pyramid_binary_round_trips_density_levels() {
        let pyramid = OverviewPyramidDocument {
            schema: OVERVIEW_PYRAMID_SCHEMA.to_string(),
            version: 1,
            world_bbox: [0, 0, 1000, 1000],
            levels: vec![OverviewLevel {
                level: 0,
                units_per_bin: 100,
                grid: [10, 10],
                bins: vec![OverviewBinRecord {
                    bbox: [0, 0, 100, 100],
                    layer_id: 9,
                    kind: LayoutObjectKind::Via,
                    count: 12,
                    coverage_area: 240,
                }],
            }],
        };

        let mut bytes = Vec::new();
        write_overview_pyramid(&mut bytes, &pyramid).unwrap();

        assert!(bytes.starts_with(OVERVIEW_PYRAMID_MAGIC));
        let decoded = read_overview_pyramid(&mut bytes.as_slice()).unwrap();
        assert_eq!(decoded, pyramid);
    }
}
