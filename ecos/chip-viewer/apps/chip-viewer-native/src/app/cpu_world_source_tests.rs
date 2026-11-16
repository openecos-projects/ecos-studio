use super::*;
use crate::app::cpu_scene::{builder, tests::Fixture};
use crate::app::{screen_to_world_rect, OwnerCategoryCache, OwnerType};
use std::cell::Cell;

fn request(fixture: &Fixture) -> SceneRequest {
    let mut request = fixture.request(1.0, 1.0);
    request.data_bounds = Some(request.key.world);
    request.key.viewport = request.key.world;
    request
}

fn rect(index: usize) -> Rect32 {
    Rect32 {
        lx: (index % 43) as i32 * 19 - 80,
        ly: (index % 29) as i32 * 23 - 40,
        hx: (index % 43) as i32 * 19 + 60,
        hy: (index % 29) as i32 * 23 + 90,
    }
}

fn styles() -> [LayerStyle; 3] {
    let mut solid = LayerStyle::default_for_layer(1, chip_display::ColorTheme::Foundry);
    solid.fill_pattern = chip_display::FillPattern::Solid;
    solid.rgba = [213, 47, 89, 121];
    solid.frame_rgba = [17, 193, 211, 173];
    let mut pattern = solid;
    pattern.layer_id = 2;
    pattern.fill_pattern = chip_display::FillPattern::CrossHatch;
    pattern.rgba = [23, 181, 79, 191];
    let mut x = solid;
    x.fill_pattern = chip_display::FillPattern::XMark;
    x.rgba = [113, 31, 227, 97];
    [solid, pattern, x]
}

#[test]
fn world_source_records_pages_palette_and_packet_commands_are_exact() {
    assert_eq!(size_of::<Record>(), 20);
    let fixture = Fixture::new();
    let source_request = request(&fixture);
    let mut capture = Builder::new(&source_request).unwrap();
    let styles = styles();
    let count = PAGE_RECORDS * 2 + 17;
    for index in 0..count {
        assert!(capture.push(
            rect(index),
            ShapeGeometry::Rect(rect(index)),
            styles[index % 3]
        ));
    }
    let source = capture.finish();
    assert_eq!(
        source.chunks().map(<[Record]>::len).collect::<Vec<_>>(),
        [4096, 4096, 17]
    );
    assert_eq!(source.palette, styles);
    assert_eq!(source.record_bytes, 3 * PAGE_RECORDS * 20);
    assert!(source.byte_len() >= source.record_bytes + size_of::<WorldSource>());
    assert!(source.byte_len() <= MAX_BYTES);
    for (zoom, pan) in [
        (1.0, egui::vec2(0.0, 0.0)),
        (1.25, egui::vec2(43.375, -79.125)),
        (0.51, egui::vec2(-17.75, 4.25)),
    ] {
        let mut target = source_request.clone();
        target.key.zoom = zoom;
        target.key.pan = pan;
        target.key.viewport = screen_to_world_rect(
            target.key.canvas,
            target.key.world,
            target.key.canvas,
            zoom,
            pan,
        );
        let pass = GeometryPass::new(target.key.world, target.key.canvas, zoom, pan);
        let mut offset = 0;
        let mut total_drawn = 0;
        for page in source.chunks() {
            for packet in page.chunks(73) {
                let mut expected = Commands(Vec::new());
                let mut drawn = 0;
                let mut primitives = 0;
                for index in offset..offset + packet.len() {
                    let bbox = rect(index);
                    if bbox.intersects(target.key.viewport) {
                        let count =
                            pass.draw(ShapeGeometry::Rect(bbox), &styles[index % 3], &mut expected);
                        drawn += usize::from(count > 0);
                        primitives += count;
                    }
                }
                assert_eq!(
                    source.commands(packet, &target, &|| true),
                    Some((expected.0, drawn, primitives))
                );
                total_drawn += drawn;
                offset += packet.len();
            }
        }
        assert_eq!(offset, count);
        assert!(
            total_drawn > 1000,
            "camera must exercise actual overlapping geometry"
        );
    }
}

#[test]
fn world_source_compatibility_checks_all_source_proofs_and_retains_bucket_misses() {
    let fixture = Fixture::new();
    let base = request(&fixture);
    let source = Builder::new(&base).unwrap().finish();
    assert!(source.compatible(&base));
    let mut camera = base.clone();
    camera.key.zoom = 1.25;
    camera.key.pan = egui::vec2(123.125, -73.75);
    camera.key.viewport = rect(7);
    camera.key.canvas = egui::Rect::from_min_max(egui::pos2(1.0, 2.0), egui::pos2(901.0, 502.0));
    camera.key.screen_size = [1000, 600];
    camera.key.font_texture_size = [17, 23];
    camera.key.selected = Some(42);
    camera.key.highlighted.insert(43);
    assert!(source.compatible(&camera));
    camera.key.zoom = f32::from_bits(1.25_f32.to_bits() + 1);
    assert!(source.same_content(&camera));
    assert!(!source.compatible(&camera));
    let context_source = Builder::new(&SceneRequest {
        key: crate::app::cpu_scene::SceneKey {
            viewport: base.key.world,
            ..camera.key.clone()
        },
        ..camera.clone()
    })
    .unwrap()
    .finish();
    camera.key.zoom = 121.713936;
    assert!(context_source.compatible(&camera));
    for variant in 0..17 {
        let mut changed = base.clone();
        match variant {
            0 => changed.key.epoch += 1,
            1 => changed.key.layers += 1,
            2 => changed.key.visibility.set_all_visible(false),
            3 => changed.key.world.lx -= 1,
            4 => changed.key.pixels_per_point = 1.25,
            5 => changed.key.tessellation.feathering = false,
            6 => changed.key.background = egui::Color32::WHITE,
            7 => changed.key.grid_bounds.hx += 1,
            8 => changed.key.cache_overlays = !changed.key.cache_overlays,
            9 => changed.layers.style_map.get_mut(&1).unwrap().rgba[3] ^= 1,
            10 => {
                changed.layers.style_map.remove(&1);
            }
            11 => {
                changed.layers.visible_layer_map.insert(1, false);
            }
            12 => changed.layer_ids.reverse(),
            13 => changed.layer_ids.push(1),
            14 => {
                changed.zoom_rules.track_grid_suppressed = !changed.zoom_rules.track_grid_suppressed
            }
            15 => changed.data_bounds.as_mut().unwrap().hx += 1,
            16 => changed.db = Fixture::new().request(1.0, 1.0).db,
            _ => unreachable!(),
        }
        let reusable = (3..=8).contains(&variant);
        assert_eq!(
            source.same_content(&changed),
            reusable,
            "source proof variant {variant}"
        );
        assert_eq!(source.compatible(&changed), reusable);
        assert_eq!(
            source.commands(&[], &changed, &|| true).is_none(),
            !reusable,
            "source command compatibility variant {variant}"
        );
    }
}

#[test]
fn world_source_retains_fit_context_when_high_zoom_source_completes() {
    let fixture = Fixture::new();
    let fit_request = request(&fixture);
    let fit = Builder::new(&fit_request).unwrap().finish();
    let mut high_request = fit_request.clone();
    high_request.key.zoom = 2.0;
    let high = Builder::new(&high_request).unwrap().finish();

    assert!(fit.same_content(&high_request));
    assert!(!fit.compatible(&high_request));
    assert!(fit.should_replace(&high));
    assert!(!high.should_replace(&fit));
    assert!(fit.compatible(&fit_request));
    assert!(!high.compatible(&fit_request));
}

#[test]
fn world_source_capture_requires_complete_bounds_and_rejects_partial_or_surrogate_geometry() {
    let fixture = Fixture::new();
    let base = request(&fixture);
    for variant in 0..5 {
        let mut incomplete = base.clone();
        match variant {
            0 => incomplete.data_bounds = None,
            1 => incomplete.key.viewport.lx += 1,
            2 => incomplete.key.viewport.ly += 1,
            3 => incomplete.key.viewport.hx -= 1,
            4 => incomplete.key.viewport.hy -= 1,
            _ => unreachable!(),
        }
        assert!(Builder::new(&incomplete).is_none());
    }
    for geometry in [
        ShapeGeometry::Rect(rect(2)),
        ShapeGeometry::Line(chipgeom_format::LinePayload::default()),
        ShapeGeometry::Point(chipgeom_format::PointPayload::default()),
    ] {
        let mut capture = Builder::new(&base).unwrap();
        assert!(capture.push(rect(0), ShapeGeometry::Rect(rect(0)), styles()[0]));
        assert!(!capture.push(rect(0), geometry, styles()[0]));
        assert!(!capture.push(rect(0), ShapeGeometry::Rect(rect(0)), styles()[0]));
        let invalid = capture.finish();
        assert!(!invalid.same_content(&base));
        assert!(!invalid.compatible(&base));
        assert!(invalid.chunks().next().is_none());
        assert!(invalid.commands(&[], &base, &|| true).is_none());
    }
}

#[test]
fn world_source_budget_accounts_for_pages_palette_and_key_and_never_keeps_a_prefix() {
    let fixture = Fixture::new();
    let base = request(&fixture);
    let builder = Builder::new(&base).unwrap();
    let overhead = builder.source.byte_len() + size_of::<Builder>() - size_of::<WorldSource>();
    assert!(Builder::with_limit(&base, overhead - 1).is_none());
    let limit = overhead
        + size_of::<LayerStyle>()
        + size_of::<Vec<Record>>()
        + PAGE_RECORDS * size_of::<Record>();
    let mut builder = Builder::with_limit(&base, limit).unwrap();
    for index in 0..PAGE_RECORDS {
        assert!(builder.push(rect(index), ShapeGeometry::Rect(rect(index)), styles()[0]));
        assert!(builder.source.byte_len() <= limit);
    }
    assert!(!builder.push(rect(0), ShapeGeometry::Rect(rect(0)), styles()[0]));
    let invalid = builder.finish();
    assert!(!invalid.compatible(&base));
    assert_eq!(invalid.record_bytes, 0);
    assert!(invalid.chunks().next().is_none());
    // A second style also consumes budget even if a partially filled page has room.
    let mut builder = Builder::with_limit(&base, limit).unwrap();
    assert!(builder.push(rect(0), ShapeGeometry::Rect(rect(0)), styles()[0]));
    assert!(!builder.push(rect(1), ShapeGeometry::Rect(rect(1)), styles()[1]));
    assert!(!builder.finish().compatible(&base));
}

#[test]
fn world_source_replay_checks_cancellation_and_record_page_ownership() {
    let fixture = Fixture::new();
    let base = request(&fixture);
    let mut capture = Builder::new(&base).unwrap();
    for index in 0..PAGE_RECORDS + 1 {
        assert!(capture.push(rect(index), ShapeGeometry::Rect(rect(index)), styles()[0]));
    }
    let source = capture.finish();
    let page = source.chunks().next().unwrap();
    assert!(source.commands(&page[13..71], &base, &|| true).is_some());
    assert!(source.commands(&page.to_vec(), &base, &|| true).is_none());
    assert!(source.commands(page, &base, &|| false).is_none());
    let calls = Cell::new(0);
    assert!(source
        .commands(page, &base, &|| {
            calls.set(calls.get() + 1);
            calls.get() < 4
        })
        .is_none());
    assert_eq!(calls.get(), 4);
    let calls = Cell::new(0);
    assert!(source
        .commands(&page[..1], &base, &|| {
            calls.set(calls.get() + 1);
            calls.get() < 3
        })
        .is_none());
    assert_eq!(
        calls.get(),
        3,
        "final cancellation must reject a completed local batch"
    );
}

#[test]
#[cfg(target_os = "linux")]
fn world_source_full_commands_and_counts_match_production_ordered_stream() {
    use crate::app::{is_renderable_shape, shape_is_visible_fast, visible_style_for_shape_fast};
    let fixture = Fixture::new();
    let mut base = request(&fixture);
    base.key.zoom = 1.251;
    // Layer 2 contains only real rectangles. Repeat it to prove layer multiplicity
    // is preserved, rather than deduplicated or sorted by style during capture.
    base.layer_ids = vec![2, 2];
    let mut capture = Builder::new(&base).unwrap();
    let mut source_records = Vec::new();
    let mut owners = OwnerCategoryCache::default();
    for layer in &base.layer_ids {
        for id in base
            .db
            .query_cached_layer_intersect(*layer, base.key.viewport)
        {
            let shape = base.db.find_shape(id).unwrap();
            let owner = base.db.owner_for_shape(shape);
            let kind = owner.and_then(|owner| OwnerType::from_raw(owner.owner_type));
            let category = owner.and_then(|owner| owners.get(base.key.epoch, &base.db, owner));
            if !is_renderable_shape(shape)
                || !base.zoom_rules.is_drawn_at_zoom(kind, base.key.zoom)
                || !shape_is_visible_fast(shape, kind, category, &base.layers, &base.key.visibility)
            {
                continue;
            }
            let Some(style) = visible_style_for_shape_fast(shape, owner, kind, &base.layers) else {
                continue;
            };
            let geometry = base.db.shape_geometry(shape);
            assert!(capture.push(shape.bbox, geometry, style));
            source_records.push((shape.bbox, geometry, style));
        }
    }
    assert!(source_records.len() >= 4);
    let source = capture.finish();
    let captured = builder::build_command_stream(&base, &|| true, |_| true).unwrap();
    let cold_source = captured
        .world_source
        .as_ref()
        .expect("complete rectangle stream must be admitted");
    assert_eq!(
        cold_source.chunks().map(<[Record]>::len).sum::<usize>(),
        source_records.len()
    );
    for (zoom, pan) in [
        (1.251, egui::Vec2::ZERO),
        (1.7, egui::vec2(-93.375, 17.125)),
        (3.5, egui::vec2(41.25, -33.5)),
    ] {
        let mut target = base.clone();
        target.key.zoom = zoom;
        target.key.pan = pan;
        target.key.viewport = screen_to_world_rect(
            target.key.canvas,
            target.key.world,
            target.key.canvas,
            zoom,
            pan,
        );
        let mut expected = Vec::new();
        let fresh = builder::build_command_stream(&target, &|| true, |packet| {
            if let builder::PaintPacket::Commands(commands) = packet {
                expected.extend(commands);
            }
            true
        })
        .unwrap();
        let mut actual = Vec::new();
        let mut counts = (0, 0);
        for packet in source.chunks() {
            let (commands, drawn, primitives) = source.commands(packet, &target, &|| true).unwrap();
            actual.extend(commands);
            counts.0 += drawn;
            counts.1 += primitives;
        }
        assert!(!expected.is_empty());
        assert_eq!(actual, expected, "full ordered commands at zoom {zoom}");
        assert_eq!(counts, (fresh.drawn, fresh.primitives));
        target.world_source = Some(Arc::clone(cold_source));
        let mut warm_commands = Vec::new();
        let warm = builder::build_command_stream(&target, &|| true, |packet| {
            if let builder::PaintPacket::Commands(commands) = packet {
                warm_commands.extend(commands);
            }
            true
        })
        .unwrap();
        assert_eq!(
            warm_commands, expected,
            "cold-captured production warm stream at zoom {zoom}"
        );
        assert_eq!((warm.drawn, warm.primitives), counts);
    }
}

#[test]
fn world_source_process_disable_gate() {
    let fixture = Fixture::new();
    let base = request(&fixture);
    if std::env::var_os("ECOS_DISABLE_WORLD_SOURCE").is_some() {
        assert!(Builder::new(&base).is_none());
        let source = Builder::with_limit(&base, MAX_BYTES).unwrap().finish();
        assert!(!source.same_content(&base));
        assert!(!source.compatible(&base));
        return;
    }
    let status = std::process::Command::new(std::env::current_exe().unwrap())
        .args([
            "--exact",
            "app::cpu_scene::world_source::tests::world_source_process_disable_gate",
            "--test-threads=1",
        ])
        .env("ECOS_DISABLE_WORLD_SOURCE", "1")
        .output()
        .unwrap();
    assert!(
        status.status.success(),
        "{}",
        String::from_utf8_lossy(&status.stdout)
    );
    assert!(String::from_utf8_lossy(&status.stdout).contains("1 passed"));
    assert!(Builder::new(&base).is_some());
}
