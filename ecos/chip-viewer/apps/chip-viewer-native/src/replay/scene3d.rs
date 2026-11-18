//! Recorded bounds adapted to the existing 3D renderer. No final shapes are read.
use crate::canvas_gpu3d::{slab_instance, GpuShapeInstance3d, FLAG_REPLAY_CHANGED};
use crate::replay::data::Recording;
use crate::replay::motion::Motion;
use crate::replay::reveal::Reveal;
use anyhow::{ensure, Result};
use chip_display::{ColorTheme, LayerRole, LayerStack, LayerStyle, MaterialKind};
use chipgeom_format::{
    replay::{Object, Scene},
    Rect32,
};
use std::{collections::BTreeMap, sync::Arc};

pub struct Metadata {
    pub layers: BTreeMap<String, (u16, LayerRole, u32)>,
    pub stack: LayerStack,
    pub origin: [i64; 2],
    pub divisor: f64,
    pub units: Option<u32>,
}
impl Metadata {
    pub fn open(record: &Recording, alive: &impl Fn() -> bool) -> Result<Self> {
        let mut layers = BTreeMap::new();
        let mut units = None;
        if let Some(file) = record.final_geometry_path()? {
            let manifest = chipgeom_reader::read_manifest(&file)?;
            units = manifest.dbu_per_micron;
            if let Some(layer_path) = manifest.layers {
                let verified = crate::replay::data::within(file.parent().unwrap(), &layer_path)?;
                for layer in chipgeom_reader::read_layer_metadata(Some(&verified))? {
                    layers.insert(
                        layer.name.clone(),
                        (
                            layer.layer_id,
                            LayerRole::from_metadata(&layer.name, &layer.layer_type),
                            layer.order,
                        ),
                    );
                }
            }
        }
        let mut die = None;
        // For legacy captures collect the complete layer vocabulary, not the
        // layers visible in one frame. Heights must not jump as routing appears.
        let legacy = layers.is_empty();
        let mut names = std::collections::BTreeSet::new();
        for i in 0..record.manifest.frames.len() {
            ensure!(alive(), "Seek superseded");
            let delta = record.delta(i)?;
            if die.is_none() {
                die = delta.upsert.get("die").map(|o| o.bbox);
            }
            if legacy {
                names.extend(
                    delta
                        .upsert
                        .values()
                        .filter(|o| !o.layer.is_empty())
                        .map(|o| o.layer.clone()),
                );
            } else if die.is_some() {
                break;
            }
        }
        for (i, name) in names.into_iter().enumerate() {
            let id = u16::try_from(i + 1)?;
            layers.insert(
                name.clone(),
                (id, LayerRole::from_layer_name(&name), i as u32),
            );
        }
        let stack = chip_display::heuristic_layer_stack(layers.values().copied());
        let [lx, ly, hx, hy] = die.unwrap_or([0, 0, 1000, 1000]);
        let extent = ((hx as i128 - lx as i128).max(hy as i128 - ly as i128)) as f64;
        Ok(Self {
            layers,
            stack,
            origin: [lx, ly],
            divisor: (extent / 1_000_000.0).max(1.0),
            units,
        })
    }
    pub fn rect(&self, b: [i64; 4]) -> Result<Rect32> {
        let mut out = [0; 4];
        for i in 0..4 {
            let x = ((b[i] as i128 - self.origin[i % 2] as i128) as f64 / self.divisor).round();
            ensure!(
                x.is_finite() && x >= i32::MIN as f64 && x <= i32::MAX as f64,
                "3D coordinates exceed the local display range"
            );
            out[i] = x as i32;
        }
        Ok(Rect32 {
            lx: out[0],
            ly: out[1],
            hx: out[2],
            hy: out[3],
        })
    }
    pub fn height(&self) -> f32 {
        self.stack.height().max(1000.0) + 400.0
    }
    pub fn band(&self, object: &Object) -> (f32, f32, LayerRole, u16) {
        if matches!(object.kind.as_str(), "instance" | "macro") {
            return (20.0, 220.0, LayerRole::Overlap, 0);
        }
        // Early captures recorded the native layer ID as text. Match it to the
        // frozen layer catalog so the base mesh and routed overlays share Z.
        let layer = self.layers.get(&object.layer).or_else(|| {
            let id = object.layer.parse::<u16>().ok()?;
            self.layers.values().find(|(layer, _, _)| *layer == id)
        });
        if let Some(&(id, role, _)) = layer {
            if let Some(band) = self.stack.band(id) {
                return (band.z0 + 300.0, band.z1 + 300.0, role, id);
            }
        }
        (5.0, 15.0, LayerRole::Unknown, 0)
    }
}

pub struct Scene3d {
    pub active_band: Option<[f32; 2]>,
    pub instances: Arc<Vec<GpuShapeInstance3d>>,
    pub ids: Vec<Option<String>>,
    pub metadata: Arc<Metadata>,
    pub world: Rect32,
    pub simplified: bool,
    pub boundaries: Vec<(String, Arc<Object>)>,
}
impl Scene3d {
    pub fn build(
        scene: &Scene,
        motion: &Motion,
        reveal: &Reveal,
        metadata: Arc<Metadata>,
        budget: usize,
        alive: &impl Fn() -> bool,
    ) -> Result<Self> {
        let world = metadata.rect(
            scene
                .objects
                .get("die")
                .map_or([0, 0, 1000, 1000], |o| o.bbox),
        )?;
        let mut instances = Vec::new();
        let mut active_band: Option<[f32; 2]> = None;
        let mut ids = Vec::new();
        let mut overflow: BTreeMap<(String, String, i32, i32), Object> = BTreeMap::new();
        let cell = ((world.hx as i64 - world.lx as i64).max(world.hy as i64 - world.ly as i64)
            / 24)
            .max(1);
        let mut simplified = false;
        // Reserve aggregation space; changed objects receive the first slots.
        let direct = budget.saturating_sub(budget / 3).max(1);
        for important in [true, false] {
            for (id, object) in scene.objects.iter() {
                ensure!(alive(), "Seek superseded");
                if !supported(object)
                    || (scene.touched.contains(id) || motion.contains(id) || reveal.contains(id))
                        != important
                {
                    continue;
                }
                if instances.len() < direct {
                    if important && matches!(super::layer_focus::class(object), 2 | 3) {
                        let (lo, hi, _, _) = metadata.band(object);
                        active_band =
                            Some(active_band.map_or([lo, hi], |b| [b[0].min(lo), b[1].max(hi)]));
                    }
                    instances.push(instance(
                        id,
                        object,
                        scene.touched.contains(id),
                        motion,
                        reveal,
                        &metadata,
                    )?);
                    ids.push(Some(id.clone()));
                } else {
                    ensure!(
                        !important,
                        "Too many animated objects for 3D GPU budget; use 2D for this sample"
                    );
                    simplified = true;
                    let b = metadata.rect(object.bbox)?;
                    let key = (
                        object.kind.clone(),
                        object.layer.clone(),
                        (i64::from(b.lx) / cell) as i32,
                        (i64::from(b.ly) / cell) as i32,
                    );
                    if let Some(previous) = overflow.get_mut(&key) {
                        previous.bbox = union(previous.bbox, object.bbox);
                    } else {
                        ensure!(
                            overflow.len() < budget.saturating_sub(direct),
                            "3D overview exceeds GPU budget; use 2D for this sample"
                        );
                        overflow.insert(key, (**object).clone());
                    }
                }
            }
        }
        for object in overflow.values() {
            instances.push(instance(
                "",
                object,
                false,
                &Motion::default(),
                &Reveal::default(),
                &metadata,
            )?);
            ids.push(None);
        }
        Ok(Self {
            instances: Arc::new(instances),
            active_band,
            ids,
            metadata,
            world,
            simplified,
            boundaries: scene
                .objects
                .iter()
                .filter(|(_, o)| matches!(o.kind.as_str(), "die" | "core" | "row" | "halo"))
                .map(|(id, o)| (id.clone(), o.clone()))
                .collect(),
        })
    }
}
fn supported(object: &Object) -> bool {
    object.attributes.get("placed").and_then(|v| v.as_bool()) != Some(false)
        && matches!(
            object.kind.as_str(),
            "instance"
                | "macro"
                | "wire"
                | "via"
                | "pdn"
                | "route"
                | "route_patch"
                | "guide"
                | "pin"
                | "access_point"
                | "access_candidate"
        )
}
fn union(a: [i64; 4], b: [i64; 4]) -> [i64; 4] {
    [
        a[0].min(b[0]),
        a[1].min(b[1]),
        a[2].max(b[2]),
        a[3].max(b[3]),
    ]
}
fn instance(
    id: &str,
    object: &Object,
    touched: bool,
    motion: &Motion,
    reveal: &Reveal,
    meta: &Metadata,
) -> Result<GpuShapeInstance3d> {
    let (z0, z1, role, layer) = meta.band(object);
    let material = MaterialKind::from_role(role);
    let style = LayerStyle::default_for_metadata(
        layer,
        &object.layer,
        usize::from(layer),
        ColorTheme::Vivid,
    );
    let mut color = style.rgba;
    if matches!(object.kind.as_str(), "instance" | "macro") {
        color = [70, 147, 129, 255];
    }
    if touched && matches!(object.kind.as_str(), "instance" | "macro") {
        color = [237, 179, 198, 255];
    }
    if object.kind == "guide" {
        color = [100, 155, 225, 160];
    }
    let mut rect = meta.rect(object.bbox)?;
    // Points need visible marker geometry; keep their captured center.
    if matches!(object.kind.as_str(), "access_point" | "access_candidate") {
        let radius = 35;
        rect = Rect32 {
            lx: rect.lx.saturating_sub(radius),
            ly: rect.ly.saturating_sub(radius),
            hx: rect.hx.saturating_add(radius),
            hy: rect.hy.saturating_add(radius),
        };
    }
    let mut out = slab_instance(
        rect,
        z0,
        z1,
        color,
        MaterialKind::pack_params(material.default_params()),
        MaterialKind::pack_semantic_info(role, material, 0, layer),
        if touched { FLAG_REPLAY_CHANGED } else { 0 },
    );
    out._pad[0] = u32::from(layer);
    out._pad[1] = super::layer_focus::class(object);
    if let Some(start) = motion.start_bounds(id) {
        out.from_rect = rect_array(meta.rect(start)?);
        out.animation = [0.0, 1.0, 2.0, 0.0];
    } else if let Some((start, duration)) = reveal.interval(id) {
        out.from_rect = rect_array(meta.rect(Reveal::bounds_at(object, 0.0))?);
        out.animation = [start, duration, 1.0, 0.0];
    }
    Ok(out)
}
pub fn rect_array(b: Rect32) -> [f32; 4] {
    [b.lx as f32, b.ly as f32, b.hx as f32, b.hy as f32]
}
pub fn bounds_at(instance: &GpuShapeInstance3d, progress: f32) -> [f32; 4] {
    let target = instance.rect_dbu.map(|x| x as f32);
    let [start, duration, _, _] = instance.animation;
    if duration <= 0.0 {
        return target;
    }
    let t = ((progress - start) / duration).clamp(0.0, 1.0);
    let t = t * t * (3.0 - 2.0 * t);
    std::array::from_fn(|i| instance.from_rect[i] + (target[i] - instance.from_rect[i]) * t)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::replay::data::tests::Fixture;
    use serde_json::json;
    #[test]
    fn animation_uses_the_same_world_bounds_as_2d_and_never_moves_static_context() {
        let fixture = Fixture::new();
        let mut record = fixture.open();
        record.seek_frame(0).unwrap();
        let before = record.scene.clone();
        record.seek_frame(1).unwrap();
        let mut frames = record.manifest.frames.clone();
        for f in &mut frames {
            f.phase = "pre_optimizer_step".into();
        }
        let mut motion = Motion::default();
        motion.begin(&before, &record.scene, &frames);
        let metadata = Arc::new(Metadata::open(&record, &|| true).unwrap());
        let scene = Scene3d::build(
            &record.scene,
            &motion,
            &Reveal::default(),
            metadata,
            100,
            &|| true,
        )
        .unwrap();
        for progress in [0.0, 0.25, 0.5, 0.75, 1.0] {
            motion.set_progress(progress);
            let gpu = bounds_at(&scene.instances[0], progress as f32);
            let cpu = motion.bounds("inst:a", record.scene.objects["inst:a"].bbox);
            for axis in 0..4 {
                assert!((gpu[axis] - cpu[axis] as f32).abs() <= 0.5);
            }
        }
        assert!(Scene3d::build(
            &record.scene,
            &motion,
            &Reveal::default(),
            scene.metadata.clone(),
            100,
            &|| false
        )
        .is_err());
    }
    #[test]
    fn legacy_layer_heights_do_not_depend_on_current_revision_and_large_origins_are_safe() {
        let fixture = Fixture::new();
        let mut record = fixture.open();
        fixture.write("attempts/a/frames/2.json",json!({"sequence":2,"base_revision":1,"checkpoint":false,
            "upsert":{"wire":{"kind":"wire","layer":"M8","bbox":[0,0,20,2]}},"remove":[],"touched":[]}));
        let meta = Metadata::open(&record, &|| true).unwrap();
        assert!(meta.layers.contains_key("M8"));
        record.seek_frame(2).unwrap();
        let later = Metadata::open(&record, &|| true).unwrap();
        assert_eq!(meta.stack, later.stack);
        let huge = Metadata {
            origin: [i64::MAX - 100, i64::MIN + 100],
            ..meta
        };
        assert_eq!(
            huge.rect([
                i64::MAX - 100,
                i64::MIN + 100,
                i64::MAX - 90,
                i64::MIN + 110
            ])
            .unwrap(),
            Rect32 {
                lx: 0,
                ly: 0,
                hx: 10,
                hy: 10
            }
        );
        assert!(huge.rect([i64::MIN, 0, i64::MAX, 0]).is_err());
    }
    #[test]
    fn numeric_capture_layers_match_named_snapshot_layers_and_overlay_height() {
        let fixture = Fixture::new();
        let mut meta = Metadata::open(&fixture.open(), &|| true).unwrap();
        meta.layers = BTreeMap::from([("MET2".into(), (10, LayerRole::Metal { level: 2 }, 9))]);
        meta.stack = chip_display::heuristic_layer_stack(meta.layers.values().copied());
        let mut object: Object =
            serde_json::from_value(json!({"kind":"wire","layer":"10","bbox":[0,0,20,2]})).unwrap();
        let numeric = meta.band(&object);
        object.layer = "MET2".into();
        assert_eq!(numeric, meta.band(&object));
        assert_eq!(numeric.1, meta.stack.band(10).unwrap().z1 + 300.0);
    }

    #[test]
    fn reveal_keeps_filler_batch_hidden_at_start_and_preserves_each_instance() {
        let fixture = Fixture::new();
        let mut record = fixture.open();
        record.seek_frame(0).unwrap();
        let before = record.scene.clone();
        record.seek_frame(2).unwrap();
        let mut frames = record.manifest.frames.clone();
        for frame in &mut frames[1..] {
            frame.phase = "filler_row".into();
        }
        let mut reveal = Reveal::default();
        reveal.begin_filler(&before, &record.scene, &frames);
        let metadata = Arc::new(Metadata::open(&record, &|| true).unwrap());
        let scene = Scene3d::build(
            &record.scene,
            &Motion::default(),
            &reveal,
            metadata,
            100,
            &|| true,
        )
        .unwrap();
        assert_eq!(scene.ids, vec![Some("inst:a".into())]);
        let instance = &scene.instances[0];
        assert_eq!(instance.animation[2], 1.0);
        for progress in [0.0, 0.25, 0.5, 0.75, 1.0] {
            reveal.set_progress(progress);
            let expected = reveal.bounds("inst:a", &record.scene.objects["inst:a"]);
            let actual = bounds_at(instance, progress as f32);
            for axis in 0..4 {
                assert!((actual[axis] - expected[axis] as f32).abs() <= 1.0);
            }
        }
    }
}

#[cfg(test)]
mod metadata_tests {
    use super::*;
    use crate::replay::data::{read, tests::Fixture};
    use serde_json::json;
    #[test]
    fn frozen_metadata_must_be_indexed_and_cannot_read_outside_attempt() {
        let fixture = Fixture::new();
        let mut manifest: serde_json::Value =
            read(&fixture.0.join("attempts/a/manifest.json")).unwrap();
        manifest["final_geometry"] = json!("../../manifest.json");
        fixture.write("attempts/a/manifest.json", manifest);
        let record = fixture.open();
        assert!(Metadata::open(&record, &|| true).is_err());
    }
}
