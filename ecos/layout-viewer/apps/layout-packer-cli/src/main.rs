use std::path::PathBuf;

use anyhow::{bail, Result};
use clap::Parser;
use layoutpkg_packer::{
    pack_viewjson_to_layoutpkg, viewjson_source_metadata, PackLayoutPackageOptions,
};

#[derive(Debug, Parser)]
#[command(name = "ecos-layout-packer")]
struct Args {
    #[arg(long)]
    fingerprint: bool,

    #[arg(long)]
    json: bool,

    #[arg(long, default_value_t = 128)]
    detail_grid_columns: usize,

    #[arg(long, default_value_t = 128)]
    detail_grid_rows: usize,

    #[arg(long, default_value_t = 16)]
    max_tiles_per_object: usize,

    #[arg(long, default_value_t = 6000)]
    target_primitives_per_tile: usize,

    #[arg(long, default_value_t = 6)]
    max_subdivision_depth: usize,

    input_root: PathBuf,
    output_root: Option<PathBuf>,
}

fn main() -> Result<()> {
    let args = Args::parse();
    if args.fingerprint {
        let metadata = viewjson_source_metadata(&args.input_root)?;
        if args.json {
            println!("{}", serde_json::to_string(&metadata)?);
        } else {
            println!("{}", metadata.source.fingerprint);
        }
        return Ok(());
    }

    let Some(output_root) = args.output_root else {
        bail!("output_root is required unless --fingerprint is set");
    };

    let result = pack_viewjson_to_layoutpkg(PackLayoutPackageOptions {
        input_root: args.input_root,
        output_root,
        detail_grid_columns: args.detail_grid_columns,
        detail_grid_rows: args.detail_grid_rows,
        max_tiles_per_object: args.max_tiles_per_object,
        target_primitives_per_tile: args.target_primitives_per_tile,
        max_subdivision_depth: args.max_subdivision_depth,
    })?;
    println!(
        "Wrote {} primitive(s), {} detail tile(s), and {} overview tile(s) to {}",
        result.primitive_count,
        result.detail_tile_count,
        result.overview_tile_count,
        result.output_root.display(),
    );
    Ok(())
}
