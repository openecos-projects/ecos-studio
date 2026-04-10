//! 从 Floorplan 布局 JSON 生成瓦片包（manifest、cells.bin、global.bin、tiles）。

use flate2::write::ZlibEncoder;
use flate2::Compression;
use serde::Serialize;
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::collections::{BTreeMap, HashMap};
use std::io::Write;
use std::path::Path;

const TILE_PIXEL_SIZE: i64 = 256;
const VECTOR_THRESHOLD: f64 = 3000.0;
const MIN_FEATURE_FLOOR: i64 = 50;
const MAX_Z_HARD_CAP: i32 = 10;

const PALETTE: &[[u8; 3]] = &[
    [120, 120, 120],
    [65, 105, 225],
    [0, 206, 209],
    [50, 205, 50],
    [127, 255, 0],
    [255, 215, 0],
    [255, 140, 0],
    [232, 69, 60],
    [255, 105, 180],
    [147, 112, 219],
    [255, 99, 71],
    [32, 178, 170],
    [186, 85, 211],
    [60, 179, 113],
    [123, 104, 238],
    [70, 130, 180],
    [218, 165, 32],
    [205, 92, 92],
    [106, 90, 205],
    [30, 144, 255],
    [220, 20, 60],
];

#[derive(Clone)]
struct LayerStyle {
    name: String,
    rgb: [u8; 3],
    alpha: u8,
    z_order: i32,
}

struct LayerRuntime {
    gds_id_to_idx: HashMap<i64, usize>,
    by_idx: Vec<LayerStyle>,
}

struct ScreenRect {
    min_x: f64,
    min_y: f64,
    max_x: f64,
    max_y: f64,
    layer_idx: usize,
}

#[derive(Clone)]
struct CellDef {
    cell_id: u32,
    bbox_w: i32,
    bbox_h: i32,
    coord_bits: u8,
    layers: Vec<LayerRects>,
}

#[derive(Clone)]
struct LayerRects {
    layer_idx: u8,
    /// lx, ly, lw, lh 序列，i16 或 i32
    packed: Vec<u8>,
    rect_count: usize,
}

#[derive(Clone)]
struct CellInst {
    instance_id: u32,
    cell_id: u32,
    origin_x: f64,
    origin_y: f64,
    orient: u8,
    bbox_w: f64,
    bbox_h: f64,
}

#[derive(Serialize)]
struct LocalRectJson {
    #[serde(rename = "layerIdx")]
    layer_idx: i32,
    lx: i64,
    ly: i64,
    lw: i64,
    lh: i64,
}

fn build_layer_runtime(layer_info: &[(i64, String)]) -> LayerRuntime {
    let mut sorted: Vec<_> = layer_info.to_vec();
    sorted.sort_by_key(|(id, _)| *id);
    let mut gds_id_to_idx = HashMap::new();
    let mut by_idx = Vec::new();
    for (i, (id, name)) in sorted.iter().enumerate() {
        gds_id_to_idx.insert(*id, i);
        let rgb = PALETTE[i % PALETTE.len()];
        let alpha = if i == 0 { 76 } else { 153 };
        let nm = name
            .to_lowercase()
            .chars()
            .map(|c| if c.is_whitespace() { '_' } else { c })
            .collect::<String>();
        by_idx.push(LayerStyle {
            name: nm,
            rgb,
            alpha,
            z_order: (i as i32) * 5,
        });
    }
    LayerRuntime {
        gds_id_to_idx,
        by_idx,
    }
}

/// PNG chunk CRC-32（与 TS `crc32` 一致）
fn crc32_png_chunk(data: &[u8]) -> u32 {
    let mut c: u32 = 0xFFFF_FFFF;
    for &b in data {
        c ^= b as u32;
        for _ in 0..8 {
            c = if c & 1 != 0 {
                (c >> 1) ^ 0xEDB88320
            } else {
                c >> 1
            };
        }
    }
    !c
}

fn png_chunk(chunk_type: &[u8; 4], data: &[u8]) -> Vec<u8> {
    let mut out = Vec::with_capacity(4 + 4 + data.len() + 4);
    out.extend_from_slice(&(data.len() as u32).to_be_bytes());
    out.extend_from_slice(chunk_type);
    out.extend_from_slice(data);
    let mut crc_input = Vec::with_capacity(4 + data.len());
    crc_input.extend_from_slice(chunk_type);
    crc_input.extend_from_slice(data);
    out.extend_from_slice(&crc32_png_chunk(&crc_input).to_be_bytes());
    out
}

fn encode_png_rgba(pixels: &[u8], w: usize, h: usize) -> Result<Vec<u8>, String> {
    let s = TILE_PIXEL_SIZE as usize;
    if w != s || h != s || pixels.len() != s * s * 4 {
        return Err("encode_png: bad dimensions".into());
    }
    let mut rows_concat = Vec::new();
    for y in 0..h {
        rows_concat.push(0u8);
        let row_off = y * w * 4;
        rows_concat.extend_from_slice(&pixels[row_off..row_off + w * 4]);
    }
    let mut enc = ZlibEncoder::new(Vec::new(), Compression::new(6));
    enc.write_all(&rows_concat)
        .map_err(|e| format!("zlib: {}", e))?;
    let compressed = enc.finish().map_err(|e| format!("zlib finish: {}", e))?;

    let mut ihdr = [0u8; 13];
    ihdr[0..4].copy_from_slice(&(w as u32).to_be_bytes());
    ihdr[4..8].copy_from_slice(&(h as u32).to_be_bytes());
    ihdr[8] = 8;
    ihdr[9] = 6;

    let mut out = vec![137, 80, 78, 71, 13, 10, 26, 10];
    out.extend(png_chunk(b"IHDR", &ihdr));
    out.extend(png_chunk(b"IDAT", &compressed));
    out.extend(png_chunk(b"IEND", &[]));
    Ok(out)
}

fn parse_source_data(
    data: &[Value],
    die_h: f64,
    rt: &LayerRuntime,
) -> Result<(Vec<RawInst>, usize), String> {
    let mut raw_insts = Vec::new();
    let mut total_boxes = 0usize;
    for group in data {
        let gtype = group.get("type").and_then(|v| v.as_str());
        if gtype != Some("group") {
            continue;
        }
        let children = group
            .get("children")
            .and_then(|v| v.as_array())
            .ok_or_else(|| "group without children".to_string())?;
        let mut rects = Vec::new();
        for child in children {
            let ctype = child.get("type").and_then(|v| v.as_str());
            if ctype != Some("box") {
                continue;
            }
            let layer = child.get("layer").and_then(|v| v.as_i64()).ok_or("box layer")?;
            let layer_idx = match rt.gds_id_to_idx.get(&layer) {
                Some(&i) => i,
                None => continue,
            };
            let path = child
                .get("path")
                .and_then(|v| v.as_array())
                .ok_or("box path")?;
            let mut x_min = f64::INFINITY;
            let mut x_max = f64::NEG_INFINITY;
            let mut y_min = f64::INFINITY;
            let mut y_max = f64::NEG_INFINITY;
            for pt in path {
                let arr = pt.as_array().ok_or("path point")?;
                if arr.len() < 2 {
                    continue;
                }
                let x = arr[0].as_f64().ok_or("x")?;
                let y = arr[1].as_f64().ok_or("y")?;
                if x < x_min {
                    x_min = x;
                }
                if x > x_max {
                    x_max = x;
                }
                if y < y_min {
                    y_min = y;
                }
                if y > y_max {
                    y_max = y;
                }
            }
            rects.push(ScreenRect {
                min_x: x_min,
                min_y: die_h - y_max,
                max_y: die_h - y_min,
                max_x: x_max,
                layer_idx,
            });
        }
        if !rects.is_empty() {
            let name = group
                .get("struct name")
                .and_then(|v| v.as_str())
                .unwrap_or("instance")
                .to_string();
            total_boxes += rects.len();
            raw_insts.push(RawInst { name, rects });
        }
    }
    Ok((raw_insts, total_boxes))
}

struct RawInst {
    name: String,
    rects: Vec<ScreenRect>,
}

fn extract_hierarchy(raw_insts: Vec<RawInst>) -> (HashMap<u32, CellDef>, Vec<CellInst>) {
    let mut hash_to_cell_id: HashMap<String, u32> = HashMap::new();
    let mut cell_defs: HashMap<u32, CellDef> = HashMap::new();
    let mut cell_insts = Vec::new();
    let mut next_cell_id: u32 = 1;

    for inst in raw_insts {
        let mut w_min_x = f64::INFINITY;
        let mut w_min_y = f64::INFINITY;
        let mut w_max_x = f64::NEG_INFINITY;
        let mut w_max_y = f64::NEG_INFINITY;
        for r in &inst.rects {
            if r.min_x < w_min_x {
                w_min_x = r.min_x;
            }
            if r.max_x > w_max_x {
                w_max_x = r.max_x;
            }
            if r.min_y < w_min_y {
                w_min_y = r.min_y;
            }
            if r.max_y > w_max_y {
                w_max_y = r.max_y;
            }
        }
        let origin_x = w_min_x;
        let origin_y = w_min_y;
        let bbox_w = w_max_x - w_min_x;
        let bbox_h = w_max_y - w_min_y;

        let local_rects: Vec<_> = inst
            .rects
            .iter()
            .map(|r| LocalRect {
                layer_idx: r.layer_idx as i32,
                lx: (r.min_x - origin_x) as i64,
                ly: (r.min_y - origin_y) as i64,
                lw: (r.max_x - r.min_x) as i64,
                lh: (r.max_y - r.min_y) as i64,
            })
            .collect();

        let mut sorted: Vec<LocalRectJson> = local_rects
            .iter()
            .map(|r| LocalRectJson {
                layer_idx: r.layer_idx,
                lx: r.lx,
                ly: r.ly,
                lw: r.lw,
                lh: r.lh,
            })
            .collect();
        sorted.sort_by(|a, b| {
            a.layer_idx.cmp(&b.layer_idx)
                .then(a.lx.cmp(&b.lx))
                .then(a.ly.cmp(&b.ly))
                .then(a.lw.cmp(&b.lw))
                .then(a.lh.cmp(&b.lh))
        });

        let json = serde_json::to_string(&sorted).unwrap();
        let hash_hex = format!("{:x}", md5::compute(json.as_bytes()));

        let cell_id = if let Some(&id) = hash_to_cell_id.get(&hash_hex) {
            id
        } else {
            let id = next_cell_id;
            next_cell_id += 1;
            hash_to_cell_id.insert(hash_hex.clone(), id);

            let mut max_coord: i64 = 0;
            for r in &local_rects {
                let m = r.lx.abs().max(r.ly.abs()).max(r.lx + r.lw).max(r.ly + r.lh);
                if m > max_coord {
                    max_coord = m;
                }
            }
            let coord_bits: u8 = if max_coord > 32767 { 1 } else { 0 };

            let mut by_layer: BTreeMap<i32, Vec<&LocalRect>> = BTreeMap::new();
            for r in &local_rects {
                by_layer.entry(r.layer_idx).or_default().push(r);
            }

            let mut def_layers = Vec::new();
            for (_k, rects) in by_layer {
                let mut packed = Vec::with_capacity(rects.len() * 8);
                for r in &rects {
                    if coord_bits == 0 {
                        packed.extend_from_slice(&(r.lx as i16).to_le_bytes());
                        packed.extend_from_slice(&(r.ly as i16).to_le_bytes());
                        packed.extend_from_slice(&(r.lw as i16).to_le_bytes());
                        packed.extend_from_slice(&(r.lh as i16).to_le_bytes());
                    } else {
                        packed.extend_from_slice(&(r.lx as i32).to_le_bytes());
                        packed.extend_from_slice(&(r.ly as i32).to_le_bytes());
                        packed.extend_from_slice(&(r.lw as i32).to_le_bytes());
                        packed.extend_from_slice(&(r.lh as i32).to_le_bytes());
                    }
                }
                def_layers.push(LayerRects {
                    layer_idx: rects[0].layer_idx as u8,
                    rect_count: rects.len(),
                    packed,
                });
            }

            let bbox_w_i = bbox_w.round() as i32;
            let bbox_h_i = bbox_h.round() as i32;
            cell_defs.insert(
                id,
                CellDef {
                    cell_id: id,
                    bbox_w: bbox_w_i,
                    bbox_h: bbox_h_i,
                    coord_bits,
                    layers: def_layers,
                },
            );
            id
        };

        let hex = format!("{:x}", md5::compute(inst.name.as_bytes()));
        let instance_id = u32::from_str_radix(&hex[..8], 16).unwrap_or(0);

        cell_insts.push(CellInst {
            instance_id,
            cell_id,
            origin_x,
            origin_y,
            orient: 0,
            bbox_w,
            bbox_h,
        });
    }

    (cell_defs, cell_insts)
}

struct LocalRect {
    layer_idx: i32,
    lx: i64,
    ly: i64,
    lw: i64,
    lh: i64,
}

fn build_cells_bin(cell_defs: &HashMap<u32, CellDef>) -> Vec<u8> {
    let mut cells: Vec<_> = cell_defs.values().cloned().collect();
    cells.sort_by_key(|c| c.cell_id);
    let cell_count = cells.len();
    const FILE_HDR_SIZE: usize = 16;
    const INDEX_ENTRY: usize = 12;

    let mut cell_bufs: Vec<Vec<u8>> = Vec::with_capacity(cells.len());
    for cell in &cells {
        let mut parts: Vec<u8> = Vec::new();
        let mut hdr = [0u8; 4 + 4 + 4 + 1 + 1];
        hdr[0..4].copy_from_slice(&cell.cell_id.to_le_bytes());
        hdr[4..8].copy_from_slice(&cell.bbox_w.to_le_bytes());
        hdr[8..12].copy_from_slice(&cell.bbox_h.to_le_bytes());
        hdr[12] = cell.layers.len() as u8;
        hdr[13] = cell.coord_bits;
        parts.extend_from_slice(&hdr);

        for layer in &cell.layers {
            let mut lhdr = [0u8; 3];
            lhdr[0] = layer.layer_idx;
            lhdr[1..3].copy_from_slice(&(layer.rect_count as u16).to_le_bytes());
            parts.extend_from_slice(&lhdr);
            parts.extend_from_slice(&layer.packed);
        }
        cell_bufs.push(parts);
    }

    let mut file_hdr = [0u8; FILE_HDR_SIZE];
    file_hdr[0..4].copy_from_slice(&0x4543454Cu32.to_le_bytes());
    file_hdr[4..6].copy_from_slice(&1u16.to_le_bytes());
    file_hdr[6..8].copy_from_slice(&0u16.to_le_bytes());
    file_hdr[8..12].copy_from_slice(&(cell_count as u32).to_le_bytes());
    file_hdr[12..16].copy_from_slice(&(FILE_HDR_SIZE as u32).to_le_bytes());

    let mut idx_buf = vec![0u8; cell_count * INDEX_ENTRY];
    let mut data_off = FILE_HDR_SIZE + cell_count * INDEX_ENTRY;
    for (i, cell) in cells.iter().enumerate() {
        let off = i * INDEX_ENTRY;
        idx_buf[off..off + 4].copy_from_slice(&cell.cell_id.to_le_bytes());
        idx_buf[off + 4..off + 8].copy_from_slice(&(data_off as u32).to_le_bytes());
        idx_buf[off + 8..off + 12].copy_from_slice(&(cell_bufs[i].len() as u32).to_le_bytes());
        data_off += cell_bufs[i].len();
    }

    let mut out = Vec::new();
    out.extend_from_slice(&file_hdr);
    out.extend_from_slice(&idx_buf);
    for b in cell_bufs {
        out.extend_from_slice(&b);
    }
    out
}

fn build_global_bin() -> Vec<u8> {
    let mut file_hdr = [0u8; 12];
    file_hdr[0..4].copy_from_slice(&0x45434756u32.to_le_bytes());
    file_hdr[4..6].copy_from_slice(&1u16.to_le_bytes());
    file_hdr[6..8].copy_from_slice(&0u16.to_le_bytes());
    file_hdr[8..12].copy_from_slice(&0u32.to_le_bytes());
    file_hdr.to_vec()
}

fn build_vector_tile(instances: &[CellInst]) -> Vec<u8> {
    const INST_SIZE: usize = 17;
    let flags = if instances.is_empty() { 0u8 } else { 1u8 };
    let mut header = [0u8; 16];
    header[0..4].copy_from_slice(&0x45434F53u32.to_le_bytes());
    header[4..6].copy_from_slice(&2u16.to_le_bytes());
    header[6] = flags;
    header[7] = 0;
    header[8..12].copy_from_slice(&(instances.len() as u32).to_le_bytes());
    header[12..16].copy_from_slice(&0u32.to_le_bytes());

    let mut inst_buf = vec![0u8; instances.len() * INST_SIZE];
    for (i, inst) in instances.iter().enumerate() {
        let o = i * INST_SIZE;
        inst_buf[o..o + 4].copy_from_slice(&inst.instance_id.to_le_bytes());
        inst_buf[o + 4..o + 8].copy_from_slice(&inst.cell_id.to_le_bytes());
        inst_buf[o + 8..o + 12].copy_from_slice(&(inst.origin_x.round() as i32).to_le_bytes());
        inst_buf[o + 12..o + 16].copy_from_slice(&(inst.origin_y.round() as i32).to_le_bytes());
        inst_buf[o + 16] = inst.orient;
    }
    let mut out = Vec::with_capacity(16 + inst_buf.len());
    out.extend_from_slice(&header);
    out.extend_from_slice(&inst_buf);
    out
}

fn render_raster_tile(
    instances: &[CellInst],
    cell_defs: &HashMap<u32, CellDef>,
    tile_bounds: (f64, f64, f64, f64),
    tile_world_size: f64,
    rt: &LayerRuntime,
) -> Vec<u8> {
    let s = TILE_PIXEL_SIZE as usize;
    let (tb_x, tb_y, _tb_x2, _tb_y2) = tile_bounds;
    let mut pixels = vec![0u8; s * s * 4];
    let scale = s as f64 / tile_world_size;

    let mut sorted_layer_idx: Vec<usize> = (0..rt.by_idx.len()).collect();
    sorted_layer_idx.sort_by_key(|&i| rt.by_idx[i].z_order);

    for &layer_idx in &sorted_layer_idx {
        let style = &rt.by_idx[layer_idx];
        let sr = style.rgb[0] as f64;
        let sg = style.rgb[1] as f64;
        let sb = style.rgb[2] as f64;
        let sa = style.alpha as f64 / 255.0;

        for inst in instances {
            let Some(def) = cell_defs.get(&inst.cell_id) else {
                continue;
            };
            let Some(ld) = def.layers.iter().find(|l| l.layer_idx as usize == layer_idx) else {
                continue;
            };
            let rects = &ld.packed;
            let rect_count = ld.rect_count;
            let coord_bits = def.coord_bits;

            for ri in 0..rect_count {
                let (lx, ly, lw, lh) = if coord_bits == 0 {
                    let o = ri * 8;
                    (
                        i16::from_le_bytes([rects[o], rects[o + 1]]) as f64,
                        i16::from_le_bytes([rects[o + 2], rects[o + 3]]) as f64,
                        i16::from_le_bytes([rects[o + 4], rects[o + 5]]) as f64,
                        i16::from_le_bytes([rects[o + 6], rects[o + 7]]) as f64,
                    )
                } else {
                    let o = ri * 16;
                    (
                        i32::from_le_bytes([
                            rects[o],
                            rects[o + 1],
                            rects[o + 2],
                            rects[o + 3],
                        ]) as f64,
                        i32::from_le_bytes([
                            rects[o + 4],
                            rects[o + 5],
                            rects[o + 6],
                            rects[o + 7],
                        ]) as f64,
                        i32::from_le_bytes([
                            rects[o + 8],
                            rects[o + 9],
                            rects[o + 10],
                            rects[o + 11],
                        ]) as f64,
                        i32::from_le_bytes([
                            rects[o + 12],
                            rects[o + 13],
                            rects[o + 14],
                            rects[o + 15],
                        ]) as f64,
                    )
                };

                let wx = inst.origin_x + lx;
                let wy = inst.origin_y + ly;

                let px0 = ((wx - tb_x) * scale).floor() as i64;
                let py0 = ((wy - tb_y) * scale).floor() as i64;
                let px1 = ((wx + lw - tb_x) * scale).ceil() as i64;
                let py1 = ((wy + lh - tb_y) * scale).ceil() as i64;

                let x0 = px0.max(0).min(s as i64) as usize;
                let x1 = px1.max(0).min(s as i64) as usize;
                let y0 = py0.max(0).min(s as i64) as usize;
                let y1 = py1.max(0).min(s as i64) as usize;
                if x0 >= x1 || y0 >= y1 {
                    continue;
                }

                for py in y0..y1 {
                    for px in x0..x1 {
                        let idx = (py * s + px) * 4;
                        let dst_a = pixels[idx + 3] as f64 / 255.0;
                        let out_a = sa + dst_a * (1.0 - sa);
                        if out_a > 0.0 {
                            let inv_out_a = 1.0 / out_a;
                            pixels[idx] = ((sr * sa + pixels[idx] as f64 * dst_a * (1.0 - sa)) * inv_out_a)
                                .round()
                                .clamp(0.0, 255.0) as u8;
                            pixels[idx + 1] = ((sg * sa + pixels[idx + 1] as f64 * dst_a * (1.0 - sa))
                                * inv_out_a)
                                .round()
                                .clamp(0.0, 255.0) as u8;
                            pixels[idx + 2] = ((sb * sa + pixels[idx + 2] as f64 * dst_a * (1.0 - sa))
                                * inv_out_a)
                                .round()
                                .clamp(0.0, 255.0) as u8;
                            pixels[idx + 3] = (out_a * 255.0).round().clamp(0.0, 255.0) as u8;
                        }
                    }
                }
            }
        }
    }
    pixels
}

fn parse_dbu_per_micron(units: Option<&Value>) -> i64 {
    let Some(u) = units.and_then(|v| v.as_str()) else {
        return 1000;
    };
    let first = u
        .split_whitespace()
        .next()
        .and_then(|s| s.parse::<f64>().ok())
        .unwrap_or(1.0);
    if first >= 10.0 {
        first.round() as i64
    } else {
        1000
    }
}

fn sha256_tag(data: &[u8]) -> String {
    let mut hasher = Sha256::new();
    hasher.update(data);
    let h = hasher.finalize();
    format!(
        "sha256:{}",
        h.iter().map(|b| format!("{:02x}", b)).collect::<String>()
    )
}

/// 从布局 JSON 生成完整瓦片目录。
pub fn generate(layout_json_path: &Path, out_dir: &Path) -> Result<(), String> {
    let raw = std::fs::read_to_string(layout_json_path)
        .map_err(|e| format!("read layout: {}", e))?;
    let merged: Value = serde_json::from_str(&raw).map_err(|e| format!("parse JSON: {}", e))?;

    let die_pts = merged
        .get("diearea")
        .and_then(|d| d.get("path"))
        .and_then(|p| p.as_array())
        .ok_or("Invalid JSON: missing diearea.path")?;
    if die_pts.is_empty() {
        return Err("Invalid JSON: diearea.path empty".into());
    }

    let layer_info_val = merged
        .get("layerInfo")
        .and_then(|v| v.as_array())
        .ok_or("Invalid JSON: missing layerInfo")?;
    let mut layer_info: Vec<(i64, String)> = Vec::new();
    for li in layer_info_val {
        let id = li.get("id").and_then(|v| v.as_i64()).ok_or("layer id")?;
        let name = li
            .get("layername")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string();
        layer_info.push((id, name));
    }
    if layer_info.is_empty() {
        return Err("Invalid JSON: layerInfo empty".into());
    }

    let data_arr = merged
        .get("data")
        .and_then(|v| v.as_array())
        .ok_or("Invalid JSON: missing data array")?;

    let mut xs = Vec::new();
    let mut ys = Vec::new();
    for p in die_pts {
        let a = p.as_array().ok_or("die point")?;
        if a.len() < 2 {
            continue;
        }
        xs.push(a[0].as_f64().ok_or("die x")?);
        ys.push(a[1].as_f64().ok_or("die y")?);
    }
    let die_min_x = xs.iter().cloned().fold(f64::INFINITY, f64::min);
    let die_min_y = ys.iter().cloned().fold(f64::INFINITY, f64::min);
    let die_w = xs.iter().cloned().fold(f64::NEG_INFINITY, f64::max) - die_min_x;
    let die_h = ys.iter().cloned().fold(f64::NEG_INFINITY, f64::max) - die_min_y;

    let rt = build_layer_runtime(&layer_info);
    let dbu_per_micron = parse_dbu_per_micron(merged.get("units"));
    let design_name = merged
        .get("design name")
        .and_then(|v| v.as_str())
        .unwrap_or("design");

    let (raw_insts, total_boxes) = parse_source_data(data_arr, die_h, &rt)?;

    let mut min_feature = f64::INFINITY;
    for inst in &raw_insts {
        for r in &inst.rects {
            let w = r.max_x - r.min_x;
            let h = r.max_y - r.min_y;
            if w >= MIN_FEATURE_FLOOR as f64 && w < min_feature {
                min_feature = w;
            }
            if h >= MIN_FEATURE_FLOOR as f64 && h < min_feature {
                min_feature = h;
            }
        }
    }
    if !min_feature.is_finite() || min_feature <= 0.0 {
        min_feature = 130.0;
    }

    let die_max_side = die_w.max(die_h);
    let z_by_feature = (die_max_side / min_feature).log2().ceil() as i32;
    let z_floor = (die_max_side / (min_feature * 20.0)).log2().ceil() as i32;

    let mut z_by_density = z_by_feature;
    for z in 0..=z_by_feature {
        let avg_per_tile = total_boxes as f64 / 4_f64.powi(z);
        if avg_per_tile < 10.0 {
            z_by_density = z;
            break;
        }
    }

    // maxZ = min(max(min(zByFeature, zByDensity), zFloor), MAX_Z_HARD_CAP)
    let max_z = (z_by_feature.min(z_by_density))
        .max(z_floor)
        .min(MAX_Z_HARD_CAP);

    let mut raster_max_z = 0i32;
    for z in 0..=max_z {
        let worst_tile = total_boxes as f64 / 4_f64.powi(z);
        if worst_tile > VECTOR_THRESHOLD {
            raster_max_z = z;
        } else {
            break;
        }
    }

    let (cell_defs, cell_insts) = extract_hierarchy(raw_insts);

    std::fs::create_dir_all(out_dir).map_err(|e| format!("mkdir out: {}", e))?;

    let cells_buf = build_cells_bin(&cell_defs);
    std::fs::write(out_dir.join("cells.bin"), &cells_buf).map_err(|e| e.to_string())?;
    let cells_hash = sha256_tag(&cells_buf);

    let global_buf = build_global_bin();
    std::fs::write(out_dir.join("global.bin"), &global_buf).map_err(|e| e.to_string())?;
    let global_hash = sha256_tag(&global_buf);

    let mut sorted_layer_info = layer_info.clone();
    sorted_layer_info.sort_by_key(|(id, _)| *id);

    let layers_json: Vec<Value> = sorted_layer_info
        .iter()
        .enumerate()
        .map(|(idx, (orig_id, _))| {
            let s = &rt.by_idx[idx];
            let hex = format!(
                "#{:02x}{:02x}{:02x}",
                s.rgb[0], s.rgb[1], s.rgb[2]
            );
            json!({
                "id": idx,
                "name": s.name,
                "originalLayerId": orig_id,
                "zOrder": s.z_order,
                "color": hex,
                "alpha": ((s.alpha as f64 / 255.0) * 100.0).round() / 100.0,
            })
        })
        .collect();

    let manifest = json!({
        "version": 1,
        "designName": design_name,
        "dbuPerMicron": dbu_per_micron,
        "dieArea": { "x": 0, "y": 0, "w": die_w, "h": die_h },
        "tileConfig": {
            "tilePixelSize": TILE_PIXEL_SIZE,
            "minZ": 0,
            "maxZ": max_z,
            "rasterMaxZ": raster_max_z,
            "rasterFormat": "png",
            "vectorFormat": "bin",
        },
        "layers": layers_json,
        "cellsFile": { "path": "cells.bin", "size": cells_buf.len(), "hash": cells_hash },
        "globalFile": { "path": "global.bin", "size": global_buf.len(), "hash": global_hash },
        "stats": {
            "totalInstances": cell_insts.len(),
            "uniqueCellTypes": cell_defs.len(),
            "totalBoxes": total_boxes,
            "minFeatureDbu": min_feature,
            "generatedAt": chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Millis, true),
        }
    });

    let manifest_str = serde_json::to_string_pretty(&manifest).map_err(|e| e.to_string())?;
    std::fs::write(out_dir.join("manifest.json"), manifest_str).map_err(|e| e.to_string())?;

    for z in 0..=max_z {
        let tiles_per_side = 2_i64.pow(z as u32) as f64;
        let tile_world_size = die_max_side / tiles_per_side;
        let is_low_z = z <= raster_max_z;

        for tx in 0..(tiles_per_side as i64) {
            for ty in 0..(tiles_per_side as i64) {
                let tb_x = tx as f64 * tile_world_size;
                let tb_y = ty as f64 * tile_world_size;
                let tb_x2 = (tx + 1) as f64 * tile_world_size;
                let tb_y2 = (ty + 1) as f64 * tile_world_size;

                let visible: Vec<CellInst> = cell_insts
                    .iter()
                    .filter(|inst| {
                        inst.origin_x < tb_x2
                            && inst.origin_x + inst.bbox_w > tb_x
                            && inst.origin_y < tb_y2
                            && inst.origin_y + inst.bbox_h > tb_y
                    })
                    .cloned()
                    .collect();

                let has_vector_content = !visible.is_empty();

                if !is_low_z && !has_vector_content {
                    continue;
                }

                if is_low_z {
                    let raster_dir = out_dir.join(format!("tiles/raster/{}/{}", z, tx));
                    std::fs::create_dir_all(&raster_dir).map_err(|e| e.to_string())?;
                    let pixels = render_raster_tile(
                        &visible,
                        &cell_defs,
                        (tb_x, tb_y, tb_x2, tb_y2),
                        tile_world_size,
                        &rt,
                    );
                    let png = encode_png_rgba(&pixels, TILE_PIXEL_SIZE as usize, TILE_PIXEL_SIZE as usize)?;
                    std::fs::write(raster_dir.join(format!("{}.png", ty)), png).map_err(|e| e.to_string())?;

                    if has_vector_content {
                        let vec_dir = out_dir.join(format!("tiles/vector/{}/{}", z, tx));
                        std::fs::create_dir_all(&vec_dir).map_err(|e| e.to_string())?;
                        let bin = build_vector_tile(&visible);
                        std::fs::write(vec_dir.join(format!("{}.bin", ty)), bin).map_err(|e| e.to_string())?;
                    }
                } else {
                    let vec_dir = out_dir.join(format!("tiles/vector/{}/{}", z, tx));
                    std::fs::create_dir_all(&vec_dir).map_err(|e| e.to_string())?;
                    let bin = build_vector_tile(&visible);
                    std::fs::write(vec_dir.join(format!("{}.bin", ty)), bin).map_err(|e| e.to_string())?;
                }
            }
        }
    }

    Ok(())
}
