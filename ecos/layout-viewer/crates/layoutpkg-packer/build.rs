use sha2::{Digest, Sha256};
use std::fs;
use std::path::Path;

fn hash_path(path: &Path, hasher: &mut Sha256) {
    let bytes = fs::read(path)
        .unwrap_or_else(|error| panic!("failed to read {} for build id: {error}", path.display()));
    hasher.update(path.to_string_lossy().as_bytes());
    hasher.update(&bytes);
}

fn main() {
    let manifest_dir = Path::new(env!("CARGO_MANIFEST_DIR"));
    let mut hasher = Sha256::new();
    hash_path(&manifest_dir.join("build.rs"), &mut hasher);

    let src_dir = manifest_dir.join("src");
    let mut paths = fs::read_dir(&src_dir)
        .unwrap_or_else(|error| panic!("failed to read {}: {error}", src_dir.display()))
        .filter_map(|entry| entry.ok())
        .map(|entry| entry.path())
        .filter(|path| path.extension().is_some_and(|ext| ext == "rs"))
        .collect::<Vec<_>>();
    paths.sort();

    for path in paths {
        hash_path(&path, &mut hasher);
    }

    let digest = format!("{:x}", hasher.finalize());
    let build_id = &digest[..16.min(digest.len())];
    println!("cargo:rerun-if-changed=build.rs");
    println!("cargo:rerun-if-changed=src");
    println!("cargo:rustc-env=LAYOUTPKG_GENERATOR_BUILD_ID={build_id}");
}
