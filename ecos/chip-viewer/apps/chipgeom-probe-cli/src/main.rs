#![recursion_limit = "256"]

use std::path::PathBuf;
use std::time::Instant;

use anyhow::Result;
use chip_display::LayerRole;
use chip_view_db::{
    ChipViewDb, ChipViewMemoryStats, DeltaStats, NearestShape, OwnerLocalInfo, ShapeGeometry,
    SnapshotStats,
};
use chipgeom_format::{
    OwnerRef, OwnerType, Point32, Rect32, ShapeId, ShapeKind, ShapeRecord, ShapeState,
};
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
    pin_name: Option<String>,
    #[arg(long)]
    bus_name: Option<String>,
    #[arg(long)]
    group_name: Option<String>,
    #[arg(long)]
    owner_type: Option<String>,
    #[arg(long)]
    owner_id: Option<u64>,
    #[arg(long)]
    shape_id: Option<u64>,
    #[arg(long)]
    bench_viewport: bool,
    #[arg(long)]
    bench_point: bool,
    #[arg(long)]
    layer: Option<u16>,
    #[arg(long, num_args = 4, value_names = ["LX", "LY", "HX", "HY"])]
    bbox: Option<Vec<i32>>,
    #[arg(long, num_args = 2, value_names = ["X", "Y"])]
    point: Option<Vec<i32>>,
    #[arg(long, default_value_t = 0)]
    radius: i32,
    #[arg(long)]
    nearest: bool,
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
    let point = args.point.as_deref().map(parse_point_values).transpose()?;
    let layer_query_report = match (args.layer, bbox) {
        (Some(layer_id), Some(viewport)) => Some(query_layer(&db, layer_id, viewport)),
        _ => None,
    };
    let point_query_report =
        point.map(|point| query_point(&db, args.layer, point, args.radius, args.nearest));
    let point_bench_report = if args.bench_point {
        let point = point.ok_or_else(|| anyhow::anyhow!("--bench-point requires --point"))?;
        Some(bench_point_query(
            &db,
            args.layer,
            point,
            args.radius,
            args.nearest,
            args.iterations.max(1),
        ))
    } else {
        None
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
            point_query_report.as_ref(),
            point_bench_report.as_ref(),
            bench_report.as_ref(),
        )?;
        return Ok(());
    }
    let name_reports = bench_name_reports(&args, &db);

    println!("manifest={}", args.manifest.display());
    println!("schema_version={}", db.snapshot().manifest().schema_version);
    if let Some(name) = db.snapshot().manifest().design_name.as_deref() {
        println!("design.name={name}");
    }
    if let Some(version) = db.snapshot().manifest().design_version.as_deref() {
        println!("design.version={version}");
    }
    if let Some(dbu_per_micron) = db.snapshot().manifest().dbu_per_micron {
        println!("design.dbu_per_micron={dbu_per_micron}");
    }
    if let Some(manufacture_grid) = db.snapshot().manifest().manufacture_grid {
        println!("design.manufacture_grid={manufacture_grid}");
    }
    if let Some(dirty_lod_tile_count) = db.snapshot().manifest().dirty_lod_tile_count {
        println!("dirty_lod_tile_count={dirty_lod_tile_count}");
    }
    if let Some(dirty_lod_rebuild_candidate_count) =
        db.snapshot().manifest().dirty_lod_rebuild_candidate_count
    {
        println!("dirty_lod_rebuild_candidate_count={dirty_lod_rebuild_candidate_count}");
    }
    if let Some(written_side_file_count) = db.snapshot().manifest().written_side_file_count {
        println!("written_side_file_count={written_side_file_count}");
    }
    if let Some(reused_side_file_count) = db.snapshot().manifest().reused_side_file_count {
        println!("reused_side_file_count={reused_side_file_count}");
    }
    println!("shape_count={}", stats.shape_count);
    println!("owner_count={}", stats.owner_count);
    println!("name_count={}", stats.name_count);
    println!("site_count={}", stats.site_count);
    println!("master_count={}", stats.master_count);
    println!("via_count={}", stats.via_count);
    println!("grid_count={}", stats.grid_count);
    println!("connectivity_count={}", stats.connectivity_count);
    println!("net_count={}", stats.net_count);
    println!("bus_count={}", stats.bus_count);
    println!("group_count={}", stats.group_count);
    let layer_summaries = db.layer_summaries();
    println!("layer_count={}", layer_summaries.len());
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
    for layer in layer_summaries {
        println!("layer.{}.name={}", layer.layer_id, layer.name);
        println!("layer.{}.type={}", layer.layer_id, layer.layer_type);
        println!(
            "layer.{}.display_role={}",
            layer.layer_id,
            layer_display_role(&layer.name, &layer.layer_type)
        );
        println!("layer.{}.direction={}", layer.layer_id, layer.direction);
        println!("layer.{}.width={}", layer.layer_id, layer.width);
        println!("layer.{}.pitch_x={}", layer.layer_id, layer.pitch_x);
        println!("layer.{}.pitch_y={}", layer.layer_id, layer.pitch_y);
        println!("layer.{}.min_spacing={}", layer.layer_id, layer.min_spacing);
        println!("layer.{}.min_area={}", layer.layer_id, layer.min_area);
        println!("layer.{}.min_step={}", layer.layer_id, layer.min_step);
        println!("layer.{}.cut_spacing={}", layer.layer_id, layer.cut_spacing);
        println!(
            "layer.{}.enclosure_below={}",
            layer.layer_id, layer.enclosure_below
        );
        println!(
            "layer.{}.enclosure_above={}",
            layer.layer_id, layer.enclosure_above
        );
        println!(
            "layer.{}.lef58_rule_count={}",
            layer.layer_id, layer.lef58_rule_count
        );
        println!("layer.{}.shape_count={}", layer.layer_id, layer.shape_count);
    }
    for site in db.site_metadata() {
        println!("site.{}.class={}", site.name, site.site_class);
        println!("site.{}.symmetry={}", site.name, site.symmetry);
        println!("site.{}.orient={}", site.name, site.orient);
        println!("site.{}.width={}", site.name, site.width);
        println!("site.{}.height={}", site.name, site.height);
        println!("site.{}.is_overlap={}", site.name, site.is_overlap);
    }
    for master in db.master_metadata() {
        println!("master.{}.type={}", master.name, master.master_type);
        println!("master.{}.site={}", master.name, master.site);
        println!("master.{}.symmetry={}", master.name, master.symmetry);
        println!("master.{}.origin_x={}", master.name, master.origin_x);
        println!("master.{}.origin_y={}", master.name, master.origin_y);
        println!("master.{}.width={}", master.name, master.width);
        println!("master.{}.height={}", master.name, master.height);
        println!("master.{}.term_count={}", master.name, master.term_count);
        println!("master.{}.obs_count={}", master.name, master.obs_count);
    }
    for grid in db.grid_metadata() {
        println!(
            "grid.{}.{}.direction={}",
            grid.grid_type, grid.index, grid.direction
        );
        println!(
            "grid.{}.{}.start={}",
            grid.grid_type, grid.index, grid.start
        );
        println!("grid.{}.{}.step={}", grid.grid_type, grid.index, grid.step);
        println!(
            "grid.{}.{}.count={}",
            grid.grid_type, grid.index, grid.count
        );
        println!(
            "grid.{}.{}.width={}",
            grid.grid_type, grid.index, grid.width
        );
        println!(
            "grid.{}.{}.layers={}",
            grid.grid_type,
            grid.index,
            format_names(&grid.layer_names)
        );
    }
    for endpoint in db.connectivity_metadata() {
        println!(
            "connectivity.{}.{}.{}.instance={}",
            endpoint.net_name, endpoint.endpoint_type, endpoint.pin_name, endpoint.instance_name
        );
        println!(
            "connectivity.{}.{}.{}.master={}",
            endpoint.net_name, endpoint.endpoint_type, endpoint.pin_name, endpoint.master_name
        );
    }
    for bus in db.bus_metadata() {
        println!("bus.{}.type={}", bus.name, bus.bus_type);
        println!("bus.{}.range={} {}", bus.name, bus.left, bus.right);
        println!("bus.{}.net_count={}", bus.name, bus.net_count);
        println!("bus.{}.pin_count={}", bus.name, bus.pin_count);
        println!("bus.{}.nets={}", bus.name, format_names(&bus.net_names));
        println!("bus.{}.pins={}", bus.name, format_names(&bus.pin_names));
    }
    for group in db.group_metadata() {
        println!("group.{}.region={}", group.name, group.region_name);
        println!(
            "group.{}.instance_count={}",
            group.name, group.instance_count
        );
        println!(
            "group.{}.instances={}",
            group.name,
            format_names(&group.instance_names)
        );
    }
    if let Some(name) = args.name {
        println!("name.{}={}", name, db.query_owner_name(&name).len());
    }
    if let Some(name) = args.net_name {
        let shape_ids = query_net_name(&db, &name);
        let endpoints = db.connectivity_for_net(&name);
        println!("net_name.{}={}", name, shape_ids.len());
        println!(
            "net_name.{}.shape_ids={}",
            name,
            format_shape_ids(&shape_ids)
        );
        println!("net_name.{}.endpoints={}", name, endpoints.len());
        for endpoint in endpoints {
            println!(
                "net_name.{}.endpoint={}:{}:{}:{}",
                name,
                endpoint.endpoint_type,
                endpoint.instance_name,
                endpoint.pin_name,
                endpoint.master_name
            );
        }
    }
    if let Some(name) = args.instance_name {
        let shape_ids = query_instance_name(&db, &name);
        let endpoints = db.connectivity_for_instance(&name);
        println!("instance_name.{}={}", name, shape_ids.len());
        println!(
            "instance_name.{}.shape_ids={}",
            name,
            format_shape_ids(&shape_ids)
        );
        println!("instance_name.{}.endpoints={}", name, endpoints.len());
        for endpoint in endpoints {
            println!(
                "instance_name.{}.endpoint={}:{}:{}:{}",
                name,
                endpoint.net_name,
                endpoint.endpoint_type,
                endpoint.pin_name,
                endpoint.master_name
            );
        }
    }
    if let Some(name) = args.pin_name {
        let shape_ids = db.query_pin_name(&name);
        let endpoints = db.connectivity_for_pin(&name);
        println!("pin_name.{}={}", name, shape_ids.len());
        println!(
            "pin_name.{}.shape_ids={}",
            name,
            format_shape_ids(&shape_ids)
        );
        println!("pin_name.{}.endpoints={}", name, endpoints.len());
        for endpoint in endpoints {
            println!(
                "pin_name.{}.endpoint={}:{}:{}:{}",
                name,
                endpoint.endpoint_type,
                endpoint.instance_name,
                endpoint.pin_name,
                endpoint.master_name
            );
        }
    }
    if let Some(name) = args.bus_name {
        let shape_ids = db.query_bus_name(&name);
        println!("bus_name.{}={}", name, shape_ids.len());
        println!(
            "bus_name.{}.shape_ids={}",
            name,
            format_shape_ids(&shape_ids)
        );
    }
    if let Some(name) = args.group_name {
        let shape_ids = db.query_group_name(&name);
        println!("group_name.{}={}", name, shape_ids.len());
        println!(
            "group_name.{}.shape_ids={}",
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
    if let Some(report) = &point_query_report {
        println!("point_query.x={}", report.point.x);
        println!("point_query.y={}", report.point.y);
        println!("point_query.radius={}", report.radius);
        println!("point_query.hits={}", report.hit_count);
        println!(
            "point_query.shape_ids={}",
            format_shape_ids(&report.shape_ids)
        );
        if let Some(nearest) = report.nearest {
            println!("point_query.nearest_shape_id={}", nearest.shape_id);
            println!(
                "point_query.nearest_distance_squared={}",
                nearest.distance_squared
            );
        }
    }
    if let Some(owner_type) = args.owner_type {
        if let Some(owner_id) = args.owner_id {
            let shape_ids = owner_type_from_label(&owner_type)
                .map(|owner_type| db.query_owner_shapes(owner_type, owner_id))
                .unwrap_or_default();
            println!(
                "owner_query.{}.{}.shape_ids={}",
                owner_type,
                owner_id,
                format_shape_ids(&shape_ids)
            );
            println!(
                "owner_query.{}.{}={}",
                owner_type,
                owner_id,
                shape_ids.len()
            );
        } else {
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
                if let Some(local_name) = db.owner_local_name(owner) {
                    println!("shape.{}.owner_local_name={}", shape_id, local_name);
                    print_owner_local_info_text(shape_id, local_name);
                }
            }
            print_shape_geometry_text(shape_id, db.shape_geometry(shape));
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
    if let Some(report) = point_bench_report {
        println!("bench_point.mode={}", report.mode);
        println!("bench_point.x={}", report.point.x);
        println!("bench_point.y={}", report.point.y);
        println!("bench_point.radius={}", report.radius);
        println!("bench_point.layers={}", format_layer_ids(&report.layer_ids));
        println!("bench_point.iterations={}", report.iterations);
        println!("bench_point.hits={}", report.hit_count);
        if let Some(nearest) = report.nearest {
            println!("bench_point.nearest_shape_id={}", nearest.shape_id);
            println!(
                "bench_point.nearest_distance_squared={}",
                nearest.distance_squared
            );
        }
        println!("bench_point.p50_ns={}", report.p50_ns);
        println!("bench_point.p95_ns={}", report.p95_ns);
    }
    for report in &name_reports {
        print_name_bench_report(report);
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
struct PointQueryReport {
    hit_count: usize,
    layer_ids: Vec<u16>,
    nearest: Option<NearestShape>,
    point: Point32,
    radius: i32,
    shape_ids: Vec<ShapeId>,
}

#[derive(Clone, Debug)]
struct PointBenchReport {
    hit_count: usize,
    iterations: usize,
    layer_ids: Vec<u16>,
    mode: &'static str,
    nearest: Option<NearestShape>,
    p50_ns: u128,
    p95_ns: u128,
    point: Point32,
    radius: i32,
}

#[derive(Clone, Debug)]
struct NameBenchReport {
    hit_count: usize,
    iterations: usize,
    kind: NameQueryKind,
    name: String,
    p50_ns: u128,
    p95_ns: u128,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum NameQueryKind {
    Name,
    Net,
    Instance,
    Pin,
    Bus,
    Group,
}

impl NameQueryKind {
    fn label(self) -> &'static str {
        match self {
            Self::Name => "name",
            Self::Net => "net",
            Self::Instance => "instance",
            Self::Pin => "pin",
            Self::Bus => "bus",
            Self::Group => "group",
        }
    }

    fn bench_prefix(self) -> &'static str {
        match self {
            Self::Name => "bench_name",
            Self::Net => "bench_net_name",
            Self::Instance => "bench_instance_name",
            Self::Pin => "bench_pin_name",
            Self::Bus => "bench_bus_name",
            Self::Group => "bench_group_name",
        }
    }

    fn query(self, db: &ChipViewDb, name: &str) -> Vec<ShapeId> {
        match self {
            Self::Name => db.query_owner_name(name),
            Self::Net => query_net_name(db, name),
            Self::Instance => query_instance_name(db, name),
            Self::Pin => db.query_pin_name(name),
            Self::Bus => db.query_bus_name(name),
            Self::Group => db.query_group_name(name),
        }
    }
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

fn query_point(
    db: &ChipViewDb,
    layer_id: Option<u16>,
    point: Point32,
    radius: i32,
    include_nearest: bool,
) -> PointQueryReport {
    let layer_ids = layer_id.map(|layer_id| vec![layer_id]).unwrap_or_else(|| {
        db.layer_summaries()
            .into_iter()
            .map(|layer| layer.layer_id)
            .collect()
    });
    let shape_ids = if radius > 0 {
        db.query_layers_near_point(&layer_ids, point, radius)
    } else {
        db.query_layers_at_point(&layer_ids, point)
    };
    let nearest = include_nearest
        .then(|| db.nearest_shape(&layer_ids, point, (radius > 0).then_some(radius)))
        .flatten();
    PointQueryReport {
        hit_count: shape_ids.len(),
        layer_ids,
        nearest,
        point,
        radius: radius.max(0),
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

fn format_names(names: &[String]) -> String {
    names.join(",")
}

fn format_layer_ids(layer_ids: &[u16]) -> String {
    layer_ids
        .iter()
        .map(|layer_id| layer_id.to_string())
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

fn bench_point_query(
    db: &ChipViewDb,
    layer_id: Option<u16>,
    point: Point32,
    radius: i32,
    include_nearest: bool,
    iterations: usize,
) -> PointBenchReport {
    let layer_ids = layer_id.map(|layer_id| vec![layer_id]).unwrap_or_else(|| {
        db.layer_summaries()
            .into_iter()
            .map(|layer| layer.layer_id)
            .collect()
    });
    let radius = radius.max(0);
    let mut samples = Vec::with_capacity(iterations);
    let mut hit_count = 0usize;
    let mut nearest = None;
    for _ in 0..iterations {
        let start = Instant::now();
        if include_nearest {
            nearest = db.nearest_shape(&layer_ids, point, (radius > 0).then_some(radius));
            hit_count = usize::from(nearest.is_some());
        } else {
            let hits = if radius > 0 {
                db.query_layers_near_point(&layer_ids, point, radius)
            } else {
                db.query_layers_at_point(&layer_ids, point)
            };
            hit_count = hits.len();
        }
        let elapsed = start.elapsed();
        samples.push(elapsed.as_nanos());
    }

    PointBenchReport {
        hit_count,
        iterations,
        layer_ids,
        mode: if include_nearest { "nearest" } else { "point" },
        nearest,
        p50_ns: percentile_nanos(&samples, 50.0),
        p95_ns: percentile_nanos(&samples, 95.0),
        point,
        radius,
    }
}

fn bench_name_reports(args: &Args, db: &ChipViewDb) -> Vec<NameBenchReport> {
    let iterations = args.iterations.max(1);
    let mut reports = Vec::new();
    if let Some(name) = args.name.as_deref() {
        reports.push(bench_name_query(db, NameQueryKind::Name, name, iterations));
    }
    if let Some(name) = args.net_name.as_deref() {
        reports.push(bench_name_query(db, NameQueryKind::Net, name, iterations));
    }
    if let Some(name) = args.instance_name.as_deref() {
        reports.push(bench_name_query(
            db,
            NameQueryKind::Instance,
            name,
            iterations,
        ));
    }
    if let Some(name) = args.pin_name.as_deref() {
        reports.push(bench_name_query(db, NameQueryKind::Pin, name, iterations));
    }
    if let Some(name) = args.bus_name.as_deref() {
        reports.push(bench_name_query(db, NameQueryKind::Bus, name, iterations));
    }
    if let Some(name) = args.group_name.as_deref() {
        reports.push(bench_name_query(db, NameQueryKind::Group, name, iterations));
    }
    reports
}

fn bench_name_query(
    db: &ChipViewDb,
    kind: NameQueryKind,
    name: &str,
    iterations: usize,
) -> NameBenchReport {
    let mut samples = Vec::with_capacity(iterations);
    let mut hit_count = 0usize;
    for _ in 0..iterations {
        let start = Instant::now();
        let hits = kind.query(db, name);
        let elapsed = start.elapsed();
        hit_count = hits.len();
        samples.push(elapsed.as_nanos());
    }

    NameBenchReport {
        hit_count,
        iterations,
        kind,
        name: name.to_string(),
        p50_ns: percentile_nanos(&samples, 50.0),
        p95_ns: percentile_nanos(&samples, 95.0),
    }
}

fn print_name_bench_report(report: &NameBenchReport) {
    let prefix = report.kind.bench_prefix();
    println!("{prefix}.kind={}", report.kind.label());
    println!("{prefix}.name={}", report.name);
    println!("{prefix}.iterations={}", report.iterations);
    println!("{prefix}.hits={}", report.hit_count);
    println!("{prefix}.p50_ns={}", report.p50_ns);
    println!("{prefix}.p95_ns={}", report.p95_ns);
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

fn parse_point_values(values: &[i32]) -> Result<Point32> {
    if values.len() != 2 {
        anyhow::bail!("--point requires exactly two coordinates");
    }
    Ok(Point32 {
        x: values[0],
        y: values[1],
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
    println!("index_bytes.net={}", stats.index_bytes.net_index_bytes);
    println!(
        "index_bytes.connectivity={}",
        stats.index_bytes.connectivity_index_bytes
    );
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
            "net": stats.index_bytes.net_index_bytes,
            "connectivity": stats.index_bytes.connectivity_index_bytes,
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

fn design_metadata_json(manifest: &chip_view_db::GeometryManifest) -> Value {
    json!({
        "name": manifest.design_name.as_deref(),
        "version": manifest.design_version.as_deref(),
        "dbu_per_micron": manifest.dbu_per_micron,
        "manufacture_grid": manifest.manufacture_grid,
    })
}

fn snapshot_write_metadata_json(manifest: &chip_view_db::GeometryManifest) -> Value {
    json!({
        "dirty_lod_tile_count": manifest.dirty_lod_tile_count,
        "dirty_lod_rebuild_candidate_count": manifest.dirty_lod_rebuild_candidate_count,
        "written_side_file_count": manifest.written_side_file_count,
        "reused_side_file_count": manifest.reused_side_file_count,
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

fn point_json(point: chipgeom_format::Point32) -> Value {
    json!({
        "x": point.x,
        "y": point.y,
    })
}

fn shape_geometry_json(geometry: ShapeGeometry) -> Value {
    match geometry {
        ShapeGeometry::Rect(rect) => json!({
            "kind": "rect",
            "rect": bbox_json(rect),
        }),
        ShapeGeometry::Line(line) => json!({
            "kind": "line",
            "begin": point_json(line.begin),
            "end": point_json(line.end),
            "width": line.width,
            "flags": line.flags,
        }),
        ShapeGeometry::Point(point) => json!({
            "kind": "point",
            "point": point_json(point.point),
            "symbol_id": point.symbol_id,
            "flags": point.flags,
        }),
    }
}

fn print_shape_geometry_text(shape_id: ShapeId, geometry: ShapeGeometry) {
    match geometry {
        ShapeGeometry::Rect(rect) => println!(
            "shape.{}.geometry=rect {} {} {} {}",
            shape_id, rect.lx, rect.ly, rect.hx, rect.hy
        ),
        ShapeGeometry::Line(line) => println!(
            "shape.{}.geometry=line {} {} {} {} {} {}",
            shape_id, line.begin.x, line.begin.y, line.end.x, line.end.y, line.width, line.flags
        ),
        ShapeGeometry::Point(point) => println!(
            "shape.{}.geometry=point {} {} {} {}",
            shape_id, point.point.x, point.point.y, point.symbol_id, point.flags
        ),
    }
}

fn owner_json(owner: &OwnerRef) -> Value {
    json!({
        "type": ChipViewDb::owner_type_label(owner.owner_type),
        "owner_id": owner.owner_id,
        "path": [owner.path0, owner.path1, owner.path2, owner.path3],
        "name_id": owner.name_id,
    })
}

fn owner_local_info_json(local_name: &str) -> Option<Value> {
    let local_info = OwnerLocalInfo::parse(local_name)?;
    Some(json!({
        "kind": local_info.kind,
        "fields": local_info.fields,
    }))
}

fn print_owner_local_info_text(shape_id: ShapeId, local_name: &str) {
    let Some(local_info) = OwnerLocalInfo::parse(local_name) else {
        return;
    };
    println!("shape.{}.owner_local.kind={}", shape_id, local_info.kind);
    for (key, value) in local_info.fields {
        println!("shape.{}.owner_local.{}={}", shape_id, key, value);
    }
}

fn shape_query_json(
    shape_id: ShapeId,
    shape_and_owner: Option<(&ShapeRecord, Option<&OwnerRef>, Option<&str>, ShapeGeometry)>,
) -> Value {
    let Some((shape, owner, owner_local_name, geometry)) = shape_and_owner else {
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
        "geometry": shape_geometry_json(geometry),
        "owner": owner.map(owner_json),
        "owner_local_name": owner_local_name,
        "owner_local_info": owner_local_name.and_then(owner_local_info_json),
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

fn point_query_json(report: &PointQueryReport) -> Value {
    json!({
        "point": point_json(report.point),
        "radius": report.radius,
        "layers": report.layer_ids,
        "hits": report.hit_count,
        "shape_ids": report.shape_ids,
        "nearest": report.nearest.map(nearest_shape_json),
    })
}

fn nearest_shape_json(nearest: NearestShape) -> Value {
    json!({
        "shape_id": nearest.shape_id,
        "distance_squared": nearest.distance_squared,
    })
}

fn point_bench_json(report: &PointBenchReport) -> Value {
    json!({
        "mode": report.mode,
        "point": point_json(report.point),
        "radius": report.radius,
        "layers": report.layer_ids,
        "iterations": report.iterations,
        "hits": report.hit_count,
        "nearest": report.nearest.map(nearest_shape_json),
        "p50_ns": report.p50_ns,
        "p95_ns": report.p95_ns,
    })
}

fn name_bench_json(report: &NameBenchReport) -> Value {
    json!({
        "kind": report.kind.label(),
        "name": report.name.as_str(),
        "iterations": report.iterations,
        "hits": report.hit_count,
        "p50_ns": report.p50_ns,
        "p95_ns": report.p95_ns,
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

fn owner_type_from_label(label: &str) -> Option<OwnerType> {
    (0..=u8::MAX).find_map(|raw| {
        let owner_type = OwnerType::from_raw(raw)?;
        (ChipViewDb::owner_type_label(raw) == label).then_some(owner_type)
    })
}

fn owner_query_json(owner_type: &str, owner_id: u64, shape_ids: Vec<ShapeId>) -> Value {
    json!({
        "owner_type": owner_type,
        "owner_id": owner_id,
        "hits": shape_ids.len(),
        "shape_ids": shape_ids,
    })
}

fn print_json(
    args: &Args,
    db: &ChipViewDb,
    stats: &SnapshotStats,
    layer_query_report: Option<&LayerQueryReport>,
    point_query_report: Option<&PointQueryReport>,
    point_bench_report: Option<&PointBenchReport>,
    bench_report: Option<&BenchReport>,
) -> Result<()> {
    let name_reports = bench_name_reports(args, db);
    let plain_name_report = name_reports
        .iter()
        .find(|report| report.kind == NameQueryKind::Name);
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
        "design": design_metadata_json(db.snapshot().manifest()),
        "snapshot_write": snapshot_write_metadata_json(db.snapshot().manifest()),
        "shape_count": stats.shape_count,
        "owner_count": stats.owner_count,
        "name_count": stats.name_count,
        "site_count": stats.site_count,
        "master_count": stats.master_count,
        "via_count": stats.via_count,
        "grid_count": stats.grid_count,
        "connectivity_count": stats.connectivity_count,
        "net_count": stats.net_count,
        "bus_count": stats.bus_count,
        "group_count": stats.group_count,
        "memory": memory_stats_json(&db.memory_stats()),
        "delta": delta_stats_json(&db.delta_stats()),
        "layer_count": db.layer_summaries().len(),
        "layers": db.layer_summaries().into_iter().map(|layer| {
            let display_role = layer_display_role(&layer.name, &layer.layer_type);
            json!({
                "layer_id": layer.layer_id,
                "name": layer.name,
                "type": layer.layer_type,
                "display_role": display_role,
                "direction": layer.direction,
                "order": layer.order,
                "width": layer.width,
                "pitch_x": layer.pitch_x,
                "pitch_y": layer.pitch_y,
                "min_spacing": layer.min_spacing,
                "min_area": layer.min_area,
                "min_step": layer.min_step,
                "cut_spacing": layer.cut_spacing,
                "enclosure_below": layer.enclosure_below,
                "enclosure_above": layer.enclosure_above,
                "lef58_rule_count": layer.lef58_rule_count,
                "shape_count": layer.shape_count,
            })
        }).collect::<Vec<_>>(),
        "sites": db.site_metadata().iter().map(|site| json!({
            "name": site.name.as_str(),
            "class": site.site_class.as_str(),
            "symmetry": site.symmetry.as_str(),
            "orient": site.orient.as_str(),
            "width": site.width,
            "height": site.height,
            "is_overlap": site.is_overlap,
        })).collect::<Vec<_>>(),
        "masters": db.master_metadata().iter().map(|master| json!({
            "name": master.name.as_str(),
            "type": master.master_type.as_str(),
            "site": master.site.as_str(),
            "symmetry": master.symmetry.as_str(),
            "origin_x": master.origin_x,
            "origin_y": master.origin_y,
            "width": master.width,
            "height": master.height,
            "term_count": master.term_count,
            "obs_count": master.obs_count,
        })).collect::<Vec<_>>(),
        "vias": db.via_metadata().iter().map(|via| json!({
            "name": via.name.as_str(),
            "master": via.master_name.as_str(),
            "type": via.via_type.as_str(),
            "rule": via.rule_name.as_str(),
            "bottom": via.bottom_layer.as_str(),
            "cut": via.cut_layer.as_str(),
            "top": via.top_layer.as_str(),
            "cut_width": via.cut_width,
            "cut_height": via.cut_height,
            "cut_spacing_x": via.cut_spacing_x,
            "cut_spacing_y": via.cut_spacing_y,
            "enclosure_bottom_x": via.enclosure_bottom_x,
            "enclosure_bottom_y": via.enclosure_bottom_y,
            "enclosure_top_x": via.enclosure_top_x,
            "enclosure_top_y": via.enclosure_top_y,
            "rows": via.rows,
            "cols": via.cols,
            "is_default": via.is_default,
        })).collect::<Vec<_>>(),
        "grids": db.grid_metadata().iter().map(|grid| json!({
            "type": grid.grid_type.as_str(),
            "index": grid.index,
            "direction": grid.direction.as_str(),
            "start": grid.start,
            "step": grid.step,
            "count": grid.count,
            "width": grid.width,
            "layers": grid.layer_names.iter().map(String::as_str).collect::<Vec<_>>(),
        })).collect::<Vec<_>>(),
        "connectivity": db.connectivity_metadata().iter().map(|endpoint| json!({
            "net": endpoint.net_name.as_str(),
            "kind": endpoint.net_kind.as_str(),
            "endpoint_type": endpoint.endpoint_type.as_str(),
            "instance": endpoint.instance_name.as_str(),
            "pin": endpoint.pin_name.as_str(),
            "master": endpoint.master_name.as_str(),
        })).collect::<Vec<_>>(),
        "buses": db.bus_metadata().iter().map(|bus| json!({
            "name": bus.name.as_str(),
            "type": bus.bus_type.as_str(),
            "left": bus.left,
            "right": bus.right,
            "net_count": bus.net_count,
            "pin_count": bus.pin_count,
            "nets": bus.net_names.iter().map(String::as_str).collect::<Vec<_>>(),
            "pins": bus.pin_names.iter().map(String::as_str).collect::<Vec<_>>(),
        })).collect::<Vec<_>>(),
        "groups": db.group_metadata().iter().map(|group| json!({
            "name": group.name.as_str(),
            "region": group.region_name.as_str(),
            "instance_count": group.instance_count,
            "instances": group.instance_names.iter().map(String::as_str).collect::<Vec<_>>(),
        })).collect::<Vec<_>>(),
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
            .map(|name| {
                let endpoints = db.connectivity_for_net(name);
                let mut value = typed_name_query_json("net", name, query_net_name(db, name));
                if let Some(object) = value.as_object_mut() {
                    object.insert(
                        "endpoints".to_string(),
                        json!(endpoints
                            .into_iter()
                            .map(|endpoint| json!({
                                "type": endpoint.endpoint_type.as_str(),
                                "instance": endpoint.instance_name.as_str(),
                                "pin": endpoint.pin_name.as_str(),
                                "master": endpoint.master_name.as_str(),
                            }))
                            .collect::<Vec<_>>()),
                    );
                }
                value
            }),
        "instance_query": args
            .instance_name
            .as_ref()
            .map(|name| {
                let endpoints = db.connectivity_for_instance(name);
                let mut value =
                    typed_name_query_json("instance", name, query_instance_name(db, name));
                if let Some(object) = value.as_object_mut() {
                    object.insert(
                        "endpoints".to_string(),
                        json!(endpoints
                            .into_iter()
                            .map(|endpoint| json!({
                                "net": endpoint.net_name.as_str(),
                                "type": endpoint.endpoint_type.as_str(),
                                "pin": endpoint.pin_name.as_str(),
                                "master": endpoint.master_name.as_str(),
                            }))
                            .collect::<Vec<_>>()),
                    );
                }
                value
            }),
        "pin_query": args
            .pin_name
            .as_ref()
            .map(|name| {
                let endpoints = db.connectivity_for_pin(name);
                let mut value = typed_name_query_json("pin", name, db.query_pin_name(name));
                if let Some(object) = value.as_object_mut() {
                    object.insert(
                        "endpoints".to_string(),
                        json!(endpoints
                            .into_iter()
                            .map(|endpoint| json!({
                                "net": endpoint.net_name.as_str(),
                                "type": endpoint.endpoint_type.as_str(),
                                "instance": endpoint.instance_name.as_str(),
                                "pin": endpoint.pin_name.as_str(),
                                "master": endpoint.master_name.as_str(),
                            }))
                            .collect::<Vec<_>>()),
                    );
                }
                value
            }),
        "bus_query": args
            .bus_name
            .as_ref()
            .map(|name| typed_name_query_json("bus", name, db.query_bus_name(name))),
        "group_query": args
            .group_name
            .as_ref()
            .map(|name| typed_name_query_json("group", name, db.query_group_name(name))),
        "owner_query": args.owner_type.as_ref().and_then(|owner_type| {
            args.owner_id.map(|owner_id| {
                let shape_ids = owner_type_from_label(owner_type)
                    .map(|owner_type| db.query_owner_shapes(owner_type, owner_id))
                    .unwrap_or_default();
                owner_query_json(owner_type, owner_id, shape_ids)
            })
        }),
        "shape_query": args.shape_id.map(|shape_id| {
            shape_query_json(
                shape_id,
                db.find_shape(shape_id).map(|shape| {
                    let owner = db.owner_for_shape(shape);
                    let owner_local_name = owner.and_then(|owner| db.owner_local_name(owner));
                    (shape, owner, owner_local_name, db.shape_geometry(shape))
                }),
            )
        }),
        "layer_query": layer_query_report.map(layer_query_json),
        "point_query": point_query_report.map(point_query_json),
        "bench_point": point_bench_report.map(point_bench_json),
        "bench_name": plain_name_report.map(name_bench_json),
        "bench_queries": name_reports.iter().map(name_bench_json).collect::<Vec<_>>(),
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

fn layer_display_role(name: &str, layer_type: &str) -> &'static str {
    LayerRole::from_metadata(name, layer_type).label()
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
    fn parse_point_values_requires_exactly_two_coordinates() {
        assert_eq!(
            parse_point_values(&[10, 20]).unwrap(),
            chipgeom_format::Point32 { x: 10, y: 20 }
        );
        assert!(parse_point_values(&[1]).is_err());
    }

    #[test]
    fn layer_display_role_uses_layer_name_before_type_fallback() {
        assert_eq!(layer_display_role("M4", "routing"), "metal");
        assert_eq!(layer_display_role("", "cut"), "cut");
        assert_eq!(layer_display_role("ROW", "unknown"), "row");
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
                net_index_bytes: 0,
                connectivity_index_bytes: 50,
                total_bytes: 150,
            },
            mapped_plus_index_bytes: 195,
        });

        assert_eq!(value["mmap_bytes"]["total"], 45);
        assert_eq!(value["mmap_bytes"]["delta"], 8);
        assert_eq!(value["mmap_bytes"]["view"], 9);
        assert_eq!(value["index_bytes"]["total"], 150);
        assert_eq!(value["index_bytes"]["name"], 40);
        assert_eq!(value["index_bytes"]["net"], 0);
        assert_eq!(value["index_bytes"]["connectivity"], 50);
        assert_eq!(value["mapped_plus_index_bytes"], 195);
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
    fn design_metadata_json_reports_optional_manifest_fields() {
        let manifest = chip_view_db::GeometryManifest {
            design_name: Some("uart_top".to_string()),
            design_version: Some("5.8".to_string()),
            dbu_per_micron: Some(2000),
            manufacture_grid: Some(5),
            ..chip_view_db::GeometryManifest::default()
        };

        let value = design_metadata_json(&manifest);

        assert_eq!(value["name"], "uart_top");
        assert_eq!(value["version"], "5.8");
        assert_eq!(value["dbu_per_micron"], 2000);
        assert_eq!(value["manufacture_grid"], 5);
    }

    #[test]
    fn snapshot_write_metadata_json_reports_optional_manifest_fields() {
        let manifest = chip_view_db::GeometryManifest {
            dirty_lod_tile_count: Some(7),
            dirty_lod_rebuild_candidate_count: Some(11),
            written_side_file_count: Some(13),
            reused_side_file_count: Some(5),
            ..chip_view_db::GeometryManifest::default()
        };

        let value = snapshot_write_metadata_json(&manifest);

        assert_eq!(value["dirty_lod_tile_count"], 7);
        assert_eq!(value["dirty_lod_rebuild_candidate_count"], 11);
        assert_eq!(value["written_side_file_count"], 13);
        assert_eq!(value["reused_side_file_count"], 5);
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
            name_id: 11,
            ..chipgeom_format::OwnerRef::default()
        };

        let value = shape_query_json(
            42,
            Some((
                &shape,
                Some(&owner),
                Some("via:VIA1 master:VIA12 type:fixed bottom:M1 cut:VIA12 top:M2"),
                ShapeGeometry::Rect(shape.bbox),
            )),
        );

        assert_eq!(value["shape_id"], 42);
        assert_eq!(value["missing"], false);
        assert_eq!(value["version"], 3);
        assert_eq!(value["layer"], 7);
        assert_eq!(value["kind"], "rect");
        assert_eq!(value["state"], "alive");
        assert_eq!(value["bbox"]["lx"], 1);
        assert_eq!(value["geometry"]["kind"], "rect");
        assert_eq!(value["geometry"]["rect"]["hx"], 3);
        assert_eq!(value["owner"]["type"], "instance_bbox");
        assert_eq!(value["owner"]["owner_id"], 9001);
        assert_eq!(value["owner"]["path"], json!([5, 6, 7, 8]));
        assert_eq!(value["owner"]["name_id"], 11);
        assert_eq!(
            value["owner_local_name"],
            "via:VIA1 master:VIA12 type:fixed bottom:M1 cut:VIA12 top:M2"
        );
        assert_eq!(value["owner_local_info"]["kind"], "via");
        assert_eq!(value["owner_local_info"]["fields"]["via"], "VIA1");
        assert_eq!(value["owner_local_info"]["fields"]["master"], "VIA12");
        assert_eq!(value["owner_local_info"]["fields"]["type"], "fixed");
        assert_eq!(value["owner_local_info"]["fields"]["bottom"], "M1");
        assert_eq!(value["owner_local_info"]["fields"]["cut"], "VIA12");
        assert_eq!(value["owner_local_info"]["fields"]["top"], "M2");

        let missing = shape_query_json(99, None);

        assert_eq!(missing["shape_id"], 99);
        assert_eq!(missing["missing"], true);
    }

    #[test]
    fn shape_query_json_reports_line_geometry_payload() {
        let shape = chipgeom_format::ShapeRecord {
            id: 42,
            version: 3,
            layer_id: 7,
            kind: chipgeom_format::ShapeKind::Line as u8,
            state: chipgeom_format::ShapeState::Alive as u8,
            bbox: chipgeom_format::Rect32 {
                lx: 1,
                ly: 2,
                hx: 30,
                hy: 40,
            },
            ..chipgeom_format::ShapeRecord::default()
        };
        let geometry = chip_view_db::ShapeGeometry::Line(chipgeom_format::LinePayload {
            begin: chipgeom_format::Point32 { x: 10, y: 20 },
            end: chipgeom_format::Point32 { x: 30, y: 40 },
            width: 5,
            flags: 7,
        });

        let value = shape_query_json(42, Some((&shape, None, None, geometry)));

        assert_eq!(value["geometry"]["kind"], "line");
        assert_eq!(value["geometry"]["begin"], json!({"x": 10, "y": 20}));
        assert_eq!(value["geometry"]["end"], json!({"x": 30, "y": 40}));
        assert_eq!(value["geometry"]["width"], 5);
        assert_eq!(value["geometry"]["flags"], 7);
    }

    #[test]
    fn shape_query_json_reports_point_geometry_payload() {
        let shape = chipgeom_format::ShapeRecord {
            id: 43,
            version: 1,
            layer_id: 8,
            kind: chipgeom_format::ShapeKind::Point as u8,
            state: chipgeom_format::ShapeState::Alive as u8,
            ..chipgeom_format::ShapeRecord::default()
        };
        let geometry = chip_view_db::ShapeGeometry::Point(chipgeom_format::PointPayload {
            point: chipgeom_format::Point32 { x: 11, y: 22 },
            symbol_id: 3,
            flags: 4,
        });

        let value = shape_query_json(43, Some((&shape, None, None, geometry)));

        assert_eq!(value["geometry"]["kind"], "point");
        assert_eq!(value["geometry"]["point"], json!({"x": 11, "y": 22}));
        assert_eq!(value["geometry"]["symbol_id"], 3);
        assert_eq!(value["geometry"]["flags"], 4);
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
    fn point_query_json_reports_point_radius_layers_and_shape_ids() {
        let value = point_query_json(&PointQueryReport {
            hit_count: 2,
            layer_ids: vec![1, 3],
            nearest: Some(chip_view_db::NearestShape {
                shape_id: 9,
                distance_squared: 25,
            }),
            point: chipgeom_format::Point32 { x: 10, y: 20 },
            radius: 5,
            shape_ids: vec![7, 9],
        });

        assert_eq!(value["point"]["x"], 10);
        assert_eq!(value["radius"], 5);
        assert_eq!(value["layers"], json!([1, 3]));
        assert_eq!(value["hits"], 2);
        assert_eq!(value["shape_ids"], json!([7, 9]));
        assert_eq!(value["nearest"]["shape_id"], 9);
        assert_eq!(value["nearest"]["distance_squared"], 25);
    }

    #[test]
    fn point_bench_json_reports_mode_layers_nearest_and_percentiles() {
        let value = point_bench_json(&PointBenchReport {
            hit_count: 1,
            iterations: 25,
            layer_ids: vec![2, 4],
            mode: "nearest",
            nearest: Some(chip_view_db::NearestShape {
                shape_id: 99,
                distance_squared: 16,
            }),
            p50_ns: 100,
            p95_ns: 250,
            point: chipgeom_format::Point32 { x: 30, y: 40 },
            radius: 10,
        });

        assert_eq!(value["mode"], "nearest");
        assert_eq!(value["point"], json!({"x": 30, "y": 40}));
        assert_eq!(value["radius"], 10);
        assert_eq!(value["layers"], json!([2, 4]));
        assert_eq!(value["iterations"], 25);
        assert_eq!(value["hits"], 1);
        assert_eq!(value["nearest"]["shape_id"], 99);
        assert_eq!(value["nearest"]["distance_squared"], 16);
        assert_eq!(value["p50_ns"], 100);
        assert_eq!(value["p95_ns"], 250);
    }

    #[test]
    fn name_bench_json_reports_kind_name_and_percentiles() {
        let value = name_bench_json(&NameBenchReport {
            hit_count: 3,
            iterations: 25,
            kind: NameQueryKind::Pin,
            name: "u0/A".to_string(),
            p50_ns: 100,
            p95_ns: 250,
        });

        assert_eq!(value["kind"], "pin");
        assert_eq!(value["name"], "u0/A");
        assert_eq!(value["iterations"], 25);
        assert_eq!(value["hits"], 3);
        assert_eq!(value["p50_ns"], 100);
        assert_eq!(value["p95_ns"], 250);
    }

    #[test]
    fn name_query_kind_reports_stable_labels_and_bench_prefixes() {
        assert_eq!(NameQueryKind::Name.label(), "name");
        assert_eq!(NameQueryKind::Net.label(), "net");
        assert_eq!(NameQueryKind::Instance.label(), "instance");
        assert_eq!(NameQueryKind::Pin.label(), "pin");
        assert_eq!(NameQueryKind::Bus.label(), "bus");
        assert_eq!(NameQueryKind::Group.label(), "group");
        assert_eq!(NameQueryKind::Name.bench_prefix(), "bench_name");
        assert_eq!(NameQueryKind::Net.bench_prefix(), "bench_net_name");
        assert_eq!(
            NameQueryKind::Instance.bench_prefix(),
            "bench_instance_name"
        );
        assert_eq!(NameQueryKind::Pin.bench_prefix(), "bench_pin_name");
        assert_eq!(NameQueryKind::Bus.bench_prefix(), "bench_bus_name");
        assert_eq!(NameQueryKind::Group.bench_prefix(), "bench_group_name");
    }

    #[test]
    fn typed_name_query_json_reports_query_kind_name_and_shape_ids() {
        let value = typed_name_query_json("net", "clk", vec![7, 8, 9]);

        assert_eq!(value["kind"], "net");
        assert_eq!(value["name"], "clk");
        assert_eq!(value["hits"], 3);
        assert_eq!(value["shape_ids"], json!([7, 8, 9]));
    }

    #[test]
    fn owner_type_from_label_accepts_known_owner_labels() {
        assert_eq!(
            owner_type_from_label("net_wire_segment"),
            Some(OwnerType::NetWireSegment)
        );
        assert_eq!(
            owner_type_from_label("instance_bbox"),
            Some(OwnerType::InstanceBBox)
        );
        assert_eq!(owner_type_from_label("missing"), None);
    }

    #[test]
    fn owner_query_json_reports_owner_type_id_and_shape_ids() {
        let value = owner_query_json("region", 7, vec![10, 20]);

        assert_eq!(value["owner_type"], "region");
        assert_eq!(value["owner_id"], 7);
        assert_eq!(value["hits"], 2);
        assert_eq!(value["shape_ids"], json!([10, 20]));
    }
}
