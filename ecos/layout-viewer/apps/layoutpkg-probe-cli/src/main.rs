use std::path::PathBuf;

use anyhow::Result;
use clap::Parser;
use layoutpkg_reader::{LayoutPackage, Rect};

#[derive(Debug, Parser)]
#[command(name = "layoutpkg-probe")]
struct Args {
    package_root: PathBuf,

    #[arg(long, value_names = ["X1", "Y1", "X2", "Y2"], num_args = 4)]
    viewport: Vec<i32>,

    #[arg(long, default_value_t = 64)]
    cache_capacity: usize,
}

fn main() -> Result<()> {
    let args = Args::parse();
    let viewport = Rect::new(
        args.viewport[0],
        args.viewport[1],
        args.viewport[2],
        args.viewport[3],
    );
    let mut package = LayoutPackage::open(&args.package_root)?;
    let batch = package.load_detail_viewport(viewport, args.cache_capacity)?;
    let records = batch
        .tiles
        .iter()
        .map(|tile| tile.records.len())
        .sum::<usize>();
    println!(
        "tiles={} records={} large={} disk_reads={} hits={} misses={} evictions={} cache_len={} detail_index={}",
        batch.tiles.len(),
        records,
        batch.large_objects.records.len(),
        batch.stats.disk_reads,
        batch.stats.cache_hits,
        batch.stats.cache_misses,
        batch.stats.evictions,
        package.cache_len(),
        package.detail_tileset_path(),
    );
    Ok(())
}
