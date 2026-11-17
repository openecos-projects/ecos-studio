//! Opt-in checks against real EDA output, independently of synthetic UI fixtures.
use crate::replay::data::{read, Catalog, Recording};
use crate::replay::index::SceneIndex;
use crate::replay::motion::Motion;
use chipgeom_format::replay::Scene;
use sha2::{Digest, Sha256};
use std::path::Path;
use std::time::Instant;

fn fingerprint(scene: &Scene) -> Vec<u8> {
    let bytes = serde_json::to_vec(&(
        &scene.objects,
        &scene.touched,
        &scene.deleted,
        &scene.restored,
        scene.revision,
    ))
    .unwrap();
    Sha256::digest(bytes).to_vec()
}

#[test]
#[ignore = "set ECOS_REPLAY_TEST_CATALOG to a real completed workspace catalog"]
fn real_workspace_random_seek_and_frozen_artifacts() {
    let path = std::env::var("ECOS_REPLAY_TEST_CATALOG").expect("catalog path");
    let catalog: Catalog = read(Path::new(&path)).unwrap();
    let mut recordings = 0;
    let mut seed = 0x78561432_u64;
    for step in &catalog.steps {
        let Some(path) = &step.manifest else {
            continue;
        };
        let mut recording = Recording::open(&catalog.workspace, path).unwrap();
        for asset in recording.manifest.files.keys() {
            recording.asset(asset).unwrap();
        }
        let mut hashes = Vec::new();
        for target in 0..recording.manifest.frames.len() {
            recording.seek_frame(target).unwrap();
            hashes.push(fingerprint(&recording.scene));
        }
        let mut times = Vec::new();
        let mut reconstruction = Vec::new();
        for _ in 0..100 {
            seed = seed.wrapping_mul(6364136223846793005).wrapping_add(1);
            let target = (seed >> 32) as usize % hashes.len();
            let start = Instant::now();
            recording.seek_frame(target).unwrap();
            reconstruction.push(start.elapsed().as_secs_f64() * 1000.0);
            let _index = SceneIndex::build(&recording.scene, &Motion::default());
            times.push(start.elapsed().as_secs_f64() * 1000.0);
            assert_eq!(
                fingerprint(&recording.scene),
                hashes[target],
                "{} frame {target}",
                step.name
            );
        }
        recording.seek_frame(hashes.len() - 1).unwrap();
        let tree = recording.clock_tree().unwrap();
        let mut analysis = crate::replay::analysis::ReplayAnalysis::open(&recording);
        assert!(
            analysis.error.is_empty(),
            "{}: {}",
            step.name,
            analysis.error
        );
        analysis.resolve(&recording.scene);
        times.sort_by(f64::total_cmp);
        reconstruction.sort_by(f64::total_cmp);
        println!(
            "{}: {} frames, {} objects, seek+index p95={:.1}ms, reconstruction p95={:.1}ms, tree={}, analysis={}",
            step.name,
            hashes.len(),
            recording.scene.objects.len(),
            times[94],
            reconstruction[94],
            tree.is_some(),
            analysis.len()
        );
        recordings += 1;
    }
    assert!(recordings > 0);
}

#[test]
#[ignore = "set ECOS_REPLAY_TEST_CATALOG to profile real frame decoding"]
fn real_workspace_decode_profile() {
    use std::io::Read;
    let path = std::env::var("ECOS_REPLAY_TEST_CATALOG").expect("catalog path");
    let catalog: Catalog = read(Path::new(&path)).unwrap();
    for step in &catalog.steps {
        let Some(path) = &step.manifest else { continue };
        let recording = Recording::open(&catalog.workspace, path).unwrap();
        let frame = recording
            .manifest
            .frames
            .iter()
            .max_by_key(|frame| {
                path.parent()
                    .unwrap()
                    .join(&frame.path)
                    .metadata()
                    .map_or(0, |m| m.len())
            })
            .unwrap();
        for _ in 0..3 {
            let start = Instant::now();
            let path = recording.asset(&frame.path).unwrap();
            let verified = start.elapsed();
            let mut bytes = Vec::new();
            let file = std::fs::File::open(path).unwrap();
            if frame
                .encoding
                .as_deref()
                .unwrap_or("json")
                .starts_with("gzip+")
            {
                flate2::read::GzDecoder::new(file)
                    .read_to_end(&mut bytes)
                    .unwrap();
            } else {
                std::io::BufReader::new(file)
                    .read_to_end(&mut bytes)
                    .unwrap();
            }
            let decoded = start.elapsed();
            let delta: chipgeom_format::replay::Delta = serde_json::from_slice(&bytes).unwrap();
            println!("{} frame {}: verify={verified:?}, inflate={:?}, deserialize={:?}, bytes={}, objects={}",
                step.name, frame.sequence, decoded - verified, start.elapsed() - decoded, bytes.len(), delta.upsert.len());
        }
    }
}
