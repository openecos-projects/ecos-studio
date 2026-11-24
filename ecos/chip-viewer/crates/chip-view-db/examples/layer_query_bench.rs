use std::hint::black_box;
use std::path::PathBuf;
use std::time::Instant;

use anyhow::{bail, Context, Result};
use chip_view_db::ChipViewDb;
use chipgeom_format::Rect32;

fn main() -> Result<()> {
    let mut arguments = std::env::args_os().skip(1);
    let manifest = PathBuf::from(
        arguments
            .next()
            .context("expected a geometry manifest path")?,
    );
    let iterations = arguments
        .next()
        .map(|argument| argument.to_string_lossy().parse::<usize>())
        .transpose()?
        .unwrap_or(30);
    if iterations == 0 || arguments.next().is_some() {
        bail!("usage: layer_query_bench MANIFEST [positive iteration count]");
    }
    let db = ChipViewDb::open(&manifest)?;
    let bounds = db.stats().bbox.context("snapshot has no shape bounds")?;
    let layers: Vec<_> = db
        .layer_catalog()
        .into_iter()
        .map(|layer| layer.layer_id)
        .collect();
    for zoom in [1.0, 2.612572, 6.825528, 17.831001, 121.713936] {
        let center_x = (f64::from(bounds.lx) + f64::from(bounds.hx)) * 0.5;
        let center_y = (f64::from(bounds.ly) + f64::from(bounds.hy)) * 0.5;
        let half_width = (f64::from(bounds.hx) - f64::from(bounds.lx)) * 0.5 / zoom;
        let half_height = (f64::from(bounds.hy) - f64::from(bounds.ly)) * 0.5 / zoom;
        let viewport = Rect32 {
            lx: (center_x - half_width).floor() as i32,
            ly: (center_y - half_height).floor() as i32,
            hx: (center_x + half_width).ceil() as i32,
            hy: (center_y + half_height).ceil() as i32,
        };
        let reference: Vec<_> = layers
            .iter()
            .flat_map(|layer| {
                let mut ids = db.query_layer_intersect(*layer, viewport);
                ids.sort_unstable();
                ids
            })
            .collect();
        let prefix_started = Instant::now();
        let first_layer = layers.iter().find_map(|layer| {
            let ids = db.query_layers_intersect(&[*layer], viewport);
            (!ids.is_empty()).then_some((*layer, ids.len()))
        });
        let prefix_query_ms = prefix_started.elapsed().as_secs_f64() * 1000.0;
        let query = || {
            layers
                .iter()
                .flat_map(|layer| db.query_layers_intersect(&[*layer], black_box(viewport)))
                .collect::<Vec<_>>()
        };
        assert_eq!(query(), reference, "query order at zoom {zoom}");
        let mut durations = Vec::with_capacity(iterations);
        for _ in 0..iterations {
            let started = Instant::now();
            let ids = query();
            durations.push(started.elapsed().as_secs_f64() * 1000.0);
            assert_eq!(ids, reference, "query changed at zoom {zoom}");
            black_box(ids);
        }
        durations.sort_unstable_by(f64::total_cmp);
        let p50_ms = durations[(iterations - 1) / 2];
        let p95_ms = durations[(iterations * 95).div_ceil(100) - 1];
        let checksum = reference.iter().fold(0u64, |checksum, id| {
            checksum.rotate_left(7).wrapping_add(*id)
        });
        println!(
            "{{\"zoom\":{zoom},\"iterations\":{iterations},\"layers\":{},\"hits\":{},\"checksum\":{checksum},\"p50_ms\":{p50_ms},\"p95_ms\":{p95_ms},\"first_layer\":{},\"first_layer_hits\":{},\"prefix_query_ms\":{prefix_query_ms}}}",
            layers.len(), reference.len()
            , first_layer.map_or(0, |entry| entry.0), first_layer.map_or(0, |entry| entry.1)
        );
    }
    Ok(())
}
