use std::path::PathBuf;
use std::time::Instant;

use anyhow::Result;
use chip_view_db::{ChipViewDb, ChipViewMemoryStats, DeltaStats, SnapshotStats};
use chipgeom_format::{OwnerRef, OwnerType, Rect32, ShapeId, ShapeKind, ShapeRecord, ShapeState};
use clap::Parser;
use serde_json::{json, Value};

#[derive(Debug, Parser)]
struct Args {
    #[arg(long)]
    manifest: PathBuf,
    #[arg(long)]
    json: bool,
    #[arg(long)]
    name: Option<String>,
    #[arg(long)]
    net_name: Option<String>,
    #[arg(long)]
    instance_name: Option<String>,
    #[arg(long)]
    owner_type: Option<String>,
    #[arg(long)]
    shape_id: Option<u64>,
    #[arg(long)]
    bench_viewport: bool,
    #[arg(long)]
    layer: Option<u16>,
    #[arg(long, num_args = 4, value_names = ["LX", "LY", "HX", "HY"])]
    bbox: Option<Vec<i32>>,
    #[arg(long, default_value_t = 100)]
    iterations: usize,
}

fn main() -> Result<()> {
    let args = Args::parse();
    let db = ChipViewDb::open(&args.manifest)?;
    let stats = db.stats();
    let memory_stats = db.memory_stats();
    let delta_stats = db.delta_stats();
    let bbox = args.bbox.as_deref().map(parse_bbox_values).transpose()?;
    let layer_query_report = match (args.layer, bbox) {
        (Some(layer_id), Some(viewport)) => Some(query_layer(&db, layer_id, viewport)),
        _ => None,
    };
    let bench_report = if args.bench_viewport {
        let layer_id = args
            .layer
            .ok_or_else(|| anyhow::anyhow!("--bench-viewport requires --layer"))?;
        let viewport = bbox.ok_or_else(|| anyhow::anyhow!("--bench-viewport requires --bbox"))?;
        Some(bench_viewport(
            &db,
            layer_id,
            viewport,
            args.iterations.max(1),
        ))
    } else {
        None
    };

    if args.json {
        print_json(
            &args,
            &db,
            &stats,
            layer_query_report.as_ref(),
            bench_report.as_ref(),
        )?;
        return Ok(());
    }
    let name_report = args
        .name
        .as_deref()
        .map(|name| bench_name_query(&db, name, args.iterations.max(1)));

    println!("manifest={}", args.manifest.display());
    println!("schema_version={}", db.snapshot().manifest().schema_version);
    println!("shape_count={}", stats.shape_count);
    println!("owner_count={}", stats.owner_count);
    println!("name_count={}", stats.name_count);
    println!("layer_count={}", db.layer_summaries().len());
    println!("view_tile_count={}", db.view_tile_count());
    print_memory_stats(&memory_stats);
    print_delta_stats(&delta_stats);
    if let Some(bbox) = stats.bbox {
        println!("bbox={} {} {} {}", bbox.lx, bbox.ly, bbox.hx, bbox.hy);
    }
    for (owner_type, count) in stats.owner_type_counts {
        println!(
            "owner_type.{}={}",
            ChipViewDb::owner_type_label(owner_type),
            count
        );
    }
    if let Some(name) = args.name {
        println!("name.{}={}", name, db.query_owner_name(&name).len());
    }
    if let Some(name) = args.net_name {
        let shape_ids = query_net_name(&db, &name);
        println!("net_name.{}={}", name, shape_ids.len());
        println!(
            "net_name.{}.shape_ids={}",
            name,
            format_shape_ids(&shape_ids)
        );
    }
    if let Some(name) = args.instance_name {
        let shape_ids = query_instance_name(&db, &name);
        println!("instance_name.{}={}", name, shape_ids.len());
        println!(
            "instance_name.{}.shape_ids={}",
            name,
            format_shape_ids(&shape_ids)
        );
    }
    if let Some(report) = &layer_query_report {
        println!("layer_query.layer={}", report.layer_id);
        println!(
            "layer_query.bbox={} {} {} {}",
            report.bbox.lx, report.bbox.ly, report.bbox.hx, report.bbox.hy
        );
        println!("layer_query.hits={}", report.hit_count);
        println!("layer_query.candidates={}", report.candidate_count);
        println!(
            "layer_query.shape_ids={}",
            format_shape_ids(&report.shape_ids)
        );
    }
    if let Some(owner_type) = args.owner_type {
        let mut count = 0usize;
        let mut first_shape = None;
        for shape in db.snapshot().shapes() {
            let Some(owner) = db.owner_for_shape(shape) else {
                continue;
            };
            if ChipViewDb::owner_type_label(owner.owner_type) == owner_type {
                count += 1;
                first_shape.get_or_insert(shape.id);
            }
        }
        println!("owner_type_query.{}={}", owner_type, count);
        if let Some(shape_id) = first_shape {
            println!(
                "owner_type_query.{}.first_shape_id={}",
                owner_type, shape_id
            );
        }
    }
    if let Some(shape_id) = args.shape_id {
        if let Some(shape) = db.find_shape(shape_id) {
            println!("shape.{}.version={}", shape_id, shape.version);
            println!("shape.{}.layer={}", shape_id, shape.layer_id);
            println!("shape.{}.kind={}", shape_id, shape_kind_label(shape.kind));
            println!(
                "shape.{}.state={}",
                shape_id,
                shape_state_label(shape.state)
            );
            println!(
                "shape.{}.bbox={} {} {} {}",
                shape_id, shape.bbox.lx, shape.bbox.ly, shape.bbox.hx, shape.bbox.hy
            );
            if let Some(owner) = db.owner_for_shape(shape) {
                println!(
                    "shape.{}.owner={} {} {} {} {} {}",
                    shape_id,
                    ChipViewDb::owner_type_label(owner.owner_type),
                    owner.owner_id,
                    owner.path0,
                    owner.path1,
                    owner.path2,
                    owner.path3
                );
            }
        } else {
            println!("shape.{}.missing=true", shape_id);
        }
    }
    if let Some(report) = bench_report {
        println!("bench_viewport.layer={}", report.layer_id);
        println!(
            "bench_viewport.bbox={} {} {} {}",
            report.bbox.lx, report.bbox.ly, report.bbox.hx, report.bbox.hy
        );
        println!("bench_viewport.iterations={}", report.iterations);
        println!("bench_viewport.hits={}", report.hit_count);
        println!("bench_viewport.candidates={}", report.candidate_count);
        println!("bench_viewport.p50_ns={}", report.p50_ns);
        println!("bench_viewport.p95_ns={}", report.p95_ns);
    }
    if let Some(report) = name_report {
        println!("bench_name.name={}", report.name);
        println!("bench_name.iterations={}", report.iterations);
        println!("bench_name.hits={}", report.hit_count);
        println!("bench_name.p50_ns={}", report.p50_ns);
        println!("bench_name.p95_ns={}", report.p95_ns);
    }

    Ok(())
}

#[derive(Clone, Debug)]
struct BenchReport {
    bbox: Rect32,
    candidate_count: usize,
    hit_count: usize,
    iterations: usize,
    layer_id: u16,
    p50_ns: u128,
    p95_ns: u128,
}

#[derive(Clone, Debug)]
struct LayerQueryReport {
    bbox: Rect32,
    candidate_count: usize,
    hit_count: usize,
    layer_id: u16,
    shape_ids: Vec<ShapeId>,
}

#[derive(Clone, Debug)]
struct NameBenchReport {
    hit_count: usize,
    iterations: usize,
    name: String,
    p50_ns: u128,
    p95_ns: u128,
}

fn query_layer(db: &ChipViewDb, layer_id: u16, bbox: Rect32) -> LayerQueryReport {
    let shape_ids = db.query_layer_intersect(layer_id, bbox);
    LayerQueryReport {
        bbox,
        candidate_count: db.layer_viewport_candidate_count(layer_id, bbox),
        hit_count: shape_ids.len(),
        layer_id,
        shape_ids,
    }
}

fn query_net_name(db: &ChipViewDb, name: &str) -> Vec<ShapeId> {
    db.query_owner_name_for_owner_types(
        name,
        &[OwnerType::NetWireSegment, OwnerType::SpecialWireSegment],
    )
}

fn query_instance_name(db: &ChipViewDb, name: &str) -> Vec<ShapeId> {
    db.query_owner_name_for_owner_types(name, &[OwnerType::InstanceBBox, OwnerType::InstanceHalo])
}

fn format_shape_ids(shape_ids: &[ShapeId]) -> String {
    shape_ids
        .iter()
        .map(|shape_id| shape_id.to_string())
        .collect::<Vec<_>>()
        .join(",")
}

fn bench_viewport(db: &ChipViewDb, layer_id: u16, bbox: Rect32, iterations: usize) -> BenchReport {
    let mut samples = Vec::with_capacity(iterations);
    let mut hit_count = 0usize;
    for _ in 0..iterations {
        let start = Instant::now();
        let hits = db.query_layer_intersect(layer_id, bbox);
        let elapsed = start.elapsed();
        hit_count = hits.len();
        samples.push(elapsed.as_nanos());
    }

    BenchReport {
        bbox,
        candidate_count: db.layer_viewport_candidate_count(layer_id, bbox),
        hit_count,
        iterations,
        layer_id,
        p50_ns: percentile_nanos(&samples, 50.0),
        p95_ns: percentile_nanos(&samples, 95.0),
    }
}

fn bench_name_query(db: &ChipViewDb, name: &str, iterations: usize) -> NameBenchReport {
    let mut samples = Vec::with_capacity(iterations);
    let mut hit_count = 0usize;
    for _ in 0..iterations {
        let start = Instant::now();
        let hits = db.query_owner_name(name);
        let elapsed = start.elapsed();
        hit_count = hits.len();
        samples.push(elapsed.as_nanos());
    }

    NameBenchReport {
        hit_count,
        iterations,
        name: name.to_string(),
        p50_ns: percentile_nanos(&samples, 50.0),
        p95_ns: percentile_nanos(&samples, 95.0),
    }
}

fn parse_bbox_values(values: &[i32]) -> Result<Rect32> {
    if values.len() != 4 {
        anyhow::bail!("--bbox requires exactly four coordinates");
    }
    Ok(Rect32 {
        lx: values[0],
        ly: values[1],
        hx: values[2],
        hy: values[3],
    })
}

fn percentile_nanos(samples: &[u128], percentile: f64) -> u128 {
    if samples.is_empty() {
        return 0;
    }
    let mut sorted = samples.to_vec();
    sorted.sort_unstable();
    let rank = ((percentile / 100.0) * sorted.len() as f64).ceil() as usize;
    sorted[rank.saturating_sub(1).min(sorted.len() - 1)]
}

fn print_memory_stats(stats: &ChipViewMemoryStats) {
    println!("mmap_bytes.total={}", stats.mapped_bytes.total());
    println!("mmap_bytes.meta={}", stats.mapped_bytes.meta);
    println!("mmap_bytes.shapes={}", stats.mapped_bytes.shapes);
    println!("mmap_bytes.owners={}", stats.mapped_bytes.owners);
    println!("mmap_bytes.payload={}", stats.mapped_bytes.payload);
    println!("mmap_bytes.names={}", stats.mapped_bytes.names);
    println!("mmap_bytes.name_index={}", stats.mapped_bytes.name_index);
    println!("mmap_bytes.sidmap={}", stats.mapped_bytes.sidmap);
    println!("mmap_bytes.delta={}", stats.mapped_bytes.delta);
    println!("mmap_bytes.view={}", stats.mapped_bytes.view);
    println!("index_bytes.total={}", stats.index_bytes.total_bytes);
    println!("index_bytes.layer={}", stats.index_bytes.layer_index_bytes);
    println!("index_bytes.shape={}", stats.index_bytes.shape_index_bytes);
    println!("index_bytes.view={}", stats.index_bytes.view_index_bytes);
    println!("index_bytes.name={}", stats.index_bytes.name_index_bytes);
    println!("mapped_plus_index_bytes={}", stats.mapped_plus_index_bytes);
}

fn print_delta_stats(stats: &DeltaStats) {
    println!("delta_count={}", stats.record_count);
    if let Some(sequence_id) = stats.latest_sequence_id {
        println!("delta_latest.sequence_id={sequence_id}");
    }
    if let Some(command_id) = stats.latest_command_id {
        println!("delta_latest.command_id={command_id}");
    }
    if let Some(shape_id) = stats.latest_shape_id {
        println!("delta_latest.shape_id={shape_id}");
    }
    if let Some(old_version) = stats.latest_old_version {
        println!("delta_latest.old_version={old_version}");
    }
    if let Some(new_version) = stats.latest_new_version {
        println!("delta_latest.new_version={new_version}");
    }
}

fn memory_stats_json(stats: &ChipViewMemoryStats) -> Value {
    json!({
        "mmap_bytes": {
            "total": stats.mapped_bytes.total(),
            "meta": stats.mapped_bytes.meta,
            "shapes": stats.mapped_bytes.shapes,
            "owners": stats.mapped_bytes.owners,
            "payload": stats.mapped_bytes.payload,
            "names": stats.mapped_bytes.names,
            "name_index": stats.mapped_bytes.name_index,
            "sidmap": stats.mapped_bytes.sidmap,
            "delta": stats.mapped_bytes.delta,
            "view": stats.mapped_bytes.view,
        },
        "index_bytes": {
            "total": stats.index_bytes.total_bytes,
            "layer": stats.index_bytes.layer_index_bytes,
            "shape": stats.index_bytes.shape_index_bytes,
            "view": stats.index_bytes.view_index_bytes,
            "name": stats.index_bytes.name_index_bytes,
        },
        "mapped_plus_index_bytes": stats.mapped_plus_index_bytes,
    })
}

fn delta_stats_json(stats: &DeltaStats) -> Value {
    json!({
        "count": stats.record_count,
        "latest": stats.latest_sequence_id.map(|sequence_id| json!({
            "sequence_id": sequence_id,
            "command_id": stats.latest_command_id,
            "shape_id": stats.latest_shape_id,
            "old_version": stats.latest_old_version,
            "new_version": stats.latest_new_version,
        })),
    })
}

fn bbox_json(bbox: Rect32) -> Value {
    json!({
        "lx": bbox.lx,
        "ly": bbox.ly,
        "hx": bbox.hx,
        "hy": bbox.hy,
    })
}

fn owner_json(owner: &OwnerRef) -> Value {
    json!({
        "type": ChipViewDb::owner_type_label(owner.owner_type),
        "owner_id": owner.owner_id,
        "path": [owner.path0, owner.path1, owner.path2, owner.path3],
    })
}

fn shape_query_json(
    shape_id: ShapeId,
    shape_and_owner: Option<(&ShapeRecord, Option<&OwnerRef>)>,
) -> Value {
    let Some((shape, owner)) = shape_and_owner else {
        return json!({
            "shape_id": shape_id,
            "missing": true,
        });
    };

    json!({
        "shape_id": shape_id,
        "missing": false,
        "version": shape.version,
        "layer": shape.layer_id,
        "kind": shape_kind_label(shape.kind),
        "state": shape_state_label(shape.state),
        "bbox": bbox_json(shape.bbox),
        "owner": owner.map(owner_json),
    })
}

fn layer_query_json(report: &LayerQueryReport) -> Value {
    json!({
        "layer": report.layer_id,
        "bbox": bbox_json(report.bbox),
        "hits": report.hit_count,
        "candidates": report.candidate_count,
        "shape_ids": report.shape_ids,
    })
}

fn typed_name_query_json(kind: &str, name: &str, shape_ids: Vec<ShapeId>) -> Value {
    json!({
        "kind": kind,
        "name": name,
        "hits": shape_ids.len(),
        "shape_ids": shape_ids,
    })
}

fn print_json(
    args: &Args,
    db: &ChipViewDb,
    stats: &SnapshotStats,
    layer_query_report: Option<&LayerQueryReport>,
    bench_report: Option<&BenchReport>,
) -> Result<()> {
    let name_report = args
        .name
        .as_deref()
        .map(|name| bench_name_query(db, name, args.iterations.max(1)));
    let owner_type_counts = stats
        .owner_type_counts
        .iter()
        .map(|(owner_type, count)| {
            (
                ChipViewDb::owner_type_label(*owner_type).to_string(),
                json!(count),
            )
        })
        .collect::<serde_json::Map<_, _>>();
    let value = json!({
        "manifest": args.manifest,
        "schema_version": db.snapshot().manifest().schema_version,
        "shape_count": stats.shape_count,
        "owner_count": stats.owner_count,
        "name_count": stats.name_count,
        "memory": memory_stats_json(&db.memory_stats()),
        "delta": delta_stats_json(&db.delta_stats()),
        "layer_count": db.layer_summaries().len(),
        "view_tile_count": db.view_tile_count(),
        "name_query": args.name.as_ref().map(|name| {
            let shape_ids = db.query_owner_name(name);
            json!({
                "name": name,
                "hits": shape_ids.len(),
                "shape_ids": shape_ids,
            })
        }),
        "net_query": args
            .net_name
            .as_ref()
            .map(|name| typed_name_query_json("net", name, query_net_name(db, name))),
        "instance_query": args
            .instance_name
            .as_ref()
            .map(|name| typed_name_query_json("instance", name, query_instance_name(db, name))),
        "shape_query": args.shape_id.map(|shape_id| {
            shape_query_json(
                shape_id,
                db.find_shape(shape_id)
                    .map(|shape| (shape, db.owner_for_shape(shape))),
            )
        }),
        "layer_query": layer_query_report.map(layer_query_json),
        "bench_name": name_report.as_ref().map(|report| json!({
            "name": report.name,
            "iterations": report.iterations,
            "hits": report.hit_count,
            "p50_ns": report.p50_ns,
            "p95_ns": report.p95_ns,
        })),
        "bbox": stats.bbox.map(bbox_json),
        "owner_type_counts": owner_type_counts,
        "bench_viewport": bench_report.map(|report| json!({
            "layer": report.layer_id,
            "bbox": {
                "lx": report.bbox.lx,
                "ly": report.bbox.ly,
                "hx": report.bbox.hx,
                "hy": report.bbox.hy,
            },
            "iterations": report.iterations,
            "hits": report.hit_count,
            "candidates": report.candidate_count,
            "p50_ns": report.p50_ns,
            "p95_ns": report.p95_ns,
        })),
    });
    println!("{}", serde_json::to_string_pretty(&value)?);
    Ok(())
}

fn shape_kind_label(kind: u8) -> &'static str {
    match kind {
        value if value == ShapeKind::Point as u8 => "point",
        value if value == ShapeKind::Line as u8 => "line",
        value if value == ShapeKind::Rect as u8 => "rect",
        _ => "unknown",
    }
}

fn shape_state_label(state: u8) -> &'static str {
    match state {
        value if value == ShapeState::Alive as u8 => "alive",
        value if value == ShapeState::Deleted as u8 => "deleted",
        _ => "unknown",
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parse_bbox_values_requires_exactly_four_coordinates() {
        assert_eq!(
            parse_bbox_values(&[1, 2, 3, 4]).unwrap(),
            chipgeom_format::Rect32 {
                lx: 1,
                ly: 2,
                hx: 3,
                hy: 4,
            }
        );
        assert!(parse_bbox_values(&[1, 2, 3]).is_err());
    }

    #[test]
    fn percentile_nanos_uses_nearest_rank() {
        assert_eq!(percentile_nanos(&[10, 20, 30, 40], 50.0), 20);
        assert_eq!(percentile_nanos(&[10, 20, 30, 40], 95.0), 40);
    }

    #[test]
    fn memory_stats_json_reports_mmap_and_index_totals() {
        let value = memory_stats_json(&chip_view_db::ChipViewMemoryStats {
            mapped_bytes: chip_view_db::GeometryMappedBytes {
                meta: 1,
                shapes: 2,
                owners: 3,
                payload: 4,
                names: 5,
                name_index: 6,
                sidmap: 7,
                delta: 8,
                view: 9,
            },
            index_bytes: chip_view_db::ChipViewIndexMemoryStats {
                layer_index_bytes: 10,
                shape_index_bytes: 20,
                view_index_bytes: 30,
                name_index_bytes: 40,
                total_bytes: 100,
            },
            mapped_plus_index_bytes: 145,
        });

        assert_eq!(value["mmap_bytes"]["total"], 45);
        assert_eq!(value["mmap_bytes"]["delta"], 8);
        assert_eq!(value["mmap_bytes"]["view"], 9);
        assert_eq!(value["index_bytes"]["total"], 100);
        assert_eq!(value["index_bytes"]["name"], 40);
        assert_eq!(value["mapped_plus_index_bytes"], 145);
    }

    #[test]
    fn delta_stats_json_reports_latest_delta_record() {
        let value = delta_stats_json(&chip_view_db::DeltaStats {
            latest_command_id: Some(77),
            latest_new_version: Some(4),
            latest_old_version: Some(3),
            latest_sequence_id: Some(12),
            latest_shape_id: Some(99),
            record_count: 2,
        });

        assert_eq!(value["count"], 2);
        assert_eq!(value["latest"]["sequence_id"], 12);
        assert_eq!(value["latest"]["command_id"], 77);
        assert_eq!(value["latest"]["shape_id"], 99);
        assert_eq!(value["latest"]["old_version"], 3);
        assert_eq!(value["latest"]["new_version"], 4);
    }

    #[test]
    fn shape_query_json_reports_shape_owner_and_missing_shapes() {
        let shape = chipgeom_format::ShapeRecord {
            id: 42,
            version: 3,
            layer_id: 7,
            kind: chipgeom_format::ShapeKind::Rect as u8,
            state: chipgeom_format::ShapeState::Alive as u8,
            bbox: chipgeom_format::Rect32 {
                lx: 1,
                ly: 2,
                hx: 3,
                hy: 4,
            },
            ..chipgeom_format::ShapeRecord::default()
        };
        let owner = chipgeom_format::OwnerRef {
            owner_type: chipgeom_format::OwnerType::InstanceBBox as u8,
            owner_id: 9001,
            path0: 5,
            path1: 6,
            path2: 7,
            path3: 8,
            ..chipgeom_format::OwnerRef::default()
        };

        let value = shape_query_json(42, Some((&shape, Some(&owner))));

        assert_eq!(value["shape_id"], 42);
        assert_eq!(value["missing"], false);
        assert_eq!(value["version"], 3);
        assert_eq!(value["layer"], 7);
        assert_eq!(value["kind"], "rect");
        assert_eq!(value["state"], "alive");
        assert_eq!(value["bbox"]["lx"], 1);
        assert_eq!(value["owner"]["type"], "instance_bbox");
        assert_eq!(value["owner"]["owner_id"], 9001);
        assert_eq!(value["owner"]["path"], json!([5, 6, 7, 8]));

        let missing = shape_query_json(99, None);

        assert_eq!(missing["shape_id"], 99);
        assert_eq!(missing["missing"], true);
    }

    #[test]
    fn layer_query_json_reports_bbox_hits_and_shape_ids() {
        let report = LayerQueryReport {
            bbox: chipgeom_format::Rect32 {
                lx: 10,
                ly: 20,
                hx: 30,
                hy: 40,
            },
            candidate_count: 5,
            hit_count: 2,
            layer_id: 9,
            shape_ids: vec![101, 202],
        };

        let value = layer_query_json(&report);

        assert_eq!(value["layer"], 9);
        assert_eq!(value["bbox"]["ly"], 20);
        assert_eq!(value["hits"], 2);
        assert_eq!(value["candidates"], 5);
        assert_eq!(value["shape_ids"], json!([101, 202]));
    }

    #[test]
    fn typed_name_query_json_reports_query_kind_name_and_shape_ids() {
        let value = typed_name_query_json("net", "clk", vec![7, 8, 9]);

        assert_eq!(value["kind"], "net");
        assert_eq!(value["name"], "clk");
        assert_eq!(value["hits"], 3);
        assert_eq!(value["shape_ids"], json!([7, 8, 9]));
    }
}
