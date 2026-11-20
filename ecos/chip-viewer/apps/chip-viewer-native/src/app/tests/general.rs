use super::*;
use crate::app::session_close::{session_action_recovery_actions, SessionActionRecoveryActions};
use crate::instance_visibility::is_filler_instance;
use std::io::Write;

#[test]
fn gpu_tile_counts_follow_visibility_without_rebuilding() {
    let mut visibility = ObjectVisibility::default();
    visibility.set_all_visible(true);
    let mut counts = [[0; 32]; 2];
    counts[0][DrawingCategory::NetSignal as usize] = 2;
    counts[0][DrawingCategory::InstanceStdCell as usize] = 3;
    counts[1][DrawingCategory::NetSignal as usize] = 4;
    counts[0][crate::canvas_gpu::UNCATEGORIZED_DRAWING_CATEGORY as usize] = 1;
    let tile = GpuTileData {
        instances: std::sync::Arc::new(Vec::new()),
        labels: Vec::new(),
        category_counts: counts,
        byte_size: 0,
    };

    assert_eq!(
        tile.visible_count(visibility.gpu_visibility_mask(), true),
        10
    );
    visibility.set_category_visible(DrawingCategory::NetSignal, false);
    assert_eq!(
        tile.visible_count(visibility.gpu_visibility_mask(), true),
        4
    );
    assert_eq!(
        tile.visible_count(visibility.gpu_visibility_mask(), false),
        4
    );
    visibility.set_category_visible(DrawingCategory::NetSignal, true);
    assert_eq!(
        tile.visible_count(visibility.gpu_visibility_mask(), false),
        6
    );
}

#[test]
fn gpu_tile_worker_returns_current_geometry_without_blocking_ui() {
    let dir = temp_snapshot_dir("gpu-tile-worker");
    write_empty_snapshot(&dir, false);
    let db = std::sync::Arc::new(ChipViewDb::open(dir.join("geometry.manifest")).unwrap());
    let mut worker = GpuTileWorker::new(db);
    let key = crate::canvas_gpu::GpuBufferKey {
        geometry_epoch: 1,
        tile_x: 0,
        tile_y: 0,
        zoom_tier: 0,
        layer_visibility_hash: 3,
        object_visibility_bits: 0,
    };
    worker.set_view_state(1, 3);
    worker.set_active_tiles(std::collections::HashSet::from([key]));
    worker
        .request(
            key,
            Rect32 {
                lx: 0,
                ly: 0,
                hx: 600_000,
                hy: 600_000,
            },
            &[],
            &LayerRenderIndex::default(),
        )
        .unwrap();
    let deadline = Instant::now() + Duration::from_secs(2);
    let result = loop {
        if let Some(result) = worker.poll().pop() {
            break result;
        }
        assert!(
            Instant::now() < deadline,
            "tile worker did not return a result"
        );
        thread::sleep(Duration::from_millis(5));
    };
    assert_eq!(result.0, key);
    assert!(result.1.instances.is_empty());
    drop(worker);
    let _ = fs::remove_dir_all(dir);
}

#[test]
fn world_to_screen_rect_flips_y_and_fits_canvas() {
    let world = chipgeom_format::Rect32 {
        lx: 0,
        ly: 0,
        hx: 100,
        hy: 50,
    };
    let shape = chipgeom_format::Rect32 {
        lx: 10,
        ly: 10,
        hx: 30,
        hy: 20,
    };
    let canvas = egui::Rect::from_min_size(egui::pos2(0.0, 0.0), egui::vec2(200.0, 100.0));

    let screen = world_to_screen_rect(shape, world, canvas, 1.0, egui::Vec2::ZERO);

    assert_eq!(screen.left(), 20.0);
    assert_eq!(screen.right(), 60.0);
    assert_eq!(screen.top(), 60.0);
    assert_eq!(screen.bottom(), 80.0);
}

#[test]
fn shape_screen_primitive_for_line_uses_payload_endpoints_not_bbox() {
    let world = chipgeom_format::Rect32 {
        lx: 0,
        ly: 0,
        hx: 100,
        hy: 100,
    };
    let canvas = egui::Rect::from_min_size(egui::pos2(0.0, 0.0), egui::vec2(200.0, 200.0));
    let line = chipgeom_format::LinePayload {
        begin: Point32 { x: 10, y: 20 },
        end: Point32 { x: 80, y: 90 },
        width: 3,
        flags: 0,
    };

    let primitive = shape_screen_primitive(
        ShapeGeometry::Line(line),
        world,
        canvas,
        1.0,
        egui::Vec2::ZERO,
    );

    let ScreenShapePrimitive::Line { begin, end, width } = primitive else {
        panic!("expected line primitive");
    };
    assert_eq!(
        begin,
        world_to_screen_point(line.begin, world, canvas, 1.0, egui::Vec2::ZERO)
    );
    assert_eq!(
        end,
        world_to_screen_point(line.end, world, canvas, 1.0, egui::Vec2::ZERO)
    );
    assert_eq!(width, 6.0);
}

#[test]
fn drc_json_parser_extracts_violations_and_counts() {
    let json = r#"
        {
          "drc": {
            "number": 2,
            "distribution": {
              "MetalShort": {
                "number": 2,
                "layers": {
                  "MET1": {
                    "number": 2,
                    "list": [
                      {
                        "llx": 10,
                        "lly": 20,
                        "urx": 30,
                        "ury": 40,
                        "required_size": 12,
                        "net": ["clk"],
                        "inst": ["u0"]
                      },
                      {
                        "llx": 50,
                        "lly": 60,
                        "urx": 70,
                        "ury": 80,
                        "required_size": 4,
                        "net": ["rst"],
                        "inst": []
                      }
                    ]
                  }
                }
              }
            }
          }
        }
        "#;

    let (violations, counts) = parse_drc_json_text(json).unwrap();

    assert_eq!(violations.len(), 2);
    assert_eq!(violations[0].drc_type, "MetalShort");
    assert_eq!(violations[0].layer, "met1");
    assert_eq!(
        violations[0].bbox,
        Rect32 {
            lx: 10,
            ly: 20,
            hx: 30,
            hy: 40,
        }
    );
    assert_eq!(violations[0].required_size, Some(12));
    assert_eq!(violations[0].nets, vec!["clk"]);
    assert_eq!(violations[0].insts, vec!["u0"]);
    assert_eq!(counts["MetalShort"].total_count, 2);
    assert_eq!(counts["MetalShort"].layer_counts["MET1"], 2);
}

#[test]
fn drc_json_parser_rejects_missing_or_malformed_distribution() {
    assert!(parse_drc_json_text(r#"{"drc":{}}"#).is_err());
    assert!(parse_drc_json_text(r#"{"drc":{"distribution":[]}}"#).is_err());
}

#[test]
fn drc_json_parser_accepts_empty_distribution() {
    let (violations, counts) =
        parse_drc_json_text(r#"{"drc":{"number":0,"distribution":{}}}"#).unwrap();

    assert!(violations.is_empty());
    assert!(counts.is_empty());
}

#[test]
fn drc_statis_csv_parser_extracts_type_layer_counts() {
    let counts = parse_drc_statis_csv(
        "Type,MET1,VIA1,MET2,total\nMetalShort,2,0,3,5\nSpacing,0,1,0,1\ntotal,2,1,3,6\n",
    );

    assert_eq!(counts["MetalShort"].total_count, 5);
    assert_eq!(counts["MetalShort"].layer_counts["MET1"], 2);
    assert_eq!(counts["MetalShort"].layer_counts["MET2"], 3);
    assert_eq!(counts["Spacing"].total_count, 1);
    assert_eq!(counts["Spacing"].layer_counts["VIA1"], 1);
    assert!(!counts.contains_key("total"));
}

#[test]
fn antenna_json_parser_accepts_ecc_step_json() {
    let json = r#"
        {
          "schema_version": 1,
          "step": "antennaCheck",
          "antenna_check": {
            "violation_count": 2
          },
          "violations": [
            {
              "net": "clk",
              "layer": "MET1",
              "type": "GateAntenna",
              "instance": "u0",
              "location": {"lx": 10, "ly": 20, "hx": 30, "hy": 40}
            },
            {
              "net": "rst",
              "layer": "MET2",
              "type": "MetalAntenna",
              "location": {"lx": 50, "ly": 60, "hx": 70, "hy": 80}
            }
          ]
        }
        "#;

    let (violations, counts) = parse_antenna_json_text(json).unwrap();

    assert_eq!(violations.len(), 2);
    assert_eq!(violations[0].antenna_type, "GateAntenna");
    assert_eq!(violations[0].layer, "met1");
    assert_eq!(
        violations[0].bbox,
        Rect32 {
            lx: 10,
            ly: 20,
            hx: 30,
            hy: 40,
        }
    );
    assert_eq!(violations[0].nets, vec!["clk"]);
    assert_eq!(violations[0].insts, vec!["u0"]);
    assert_eq!(counts["GateAntenna"].total_count, 1);
    assert_eq!(counts["GateAntenna"].layer_counts["met1"], 1);
    assert_eq!(counts["MetalAntenna"].total_count, 1);
}

#[test]
fn antenna_json_parser_rejects_missing_or_malformed_distribution() {
    assert!(parse_antenna_json_text(r#"{"antenna":{}}"#).is_err());
    assert!(parse_antenna_json_text(r#"{"antenna":{"distribution":[]}}"#).is_err());
}

#[test]
fn antenna_json_parser_accepts_empty_supported_reports() {
    let distribution_report = r#"{"antenna":{"distribution":{}}}"#;
    let ecc_report =
        r#"{"step":"antennaCheck","antenna_check":{"violation_count":0},"violations":[]}"#;

    for report in [distribution_report, ecc_report] {
        let (violations, counts) = parse_antenna_json_text(report).unwrap();
        assert!(violations.is_empty(), "report {report}");
        assert!(counts.is_empty(), "report {report}");
    }
}

#[test]
fn drc_layer_visibility_uses_matching_physical_layer() {
    let mut met1 = layer_state(1, false);
    met1.name = "MET1".to_string();
    let mut met2 = layer_state(2, true);
    met2.name = "MET2".to_string();
    let layers = vec![met1, met2];

    assert!(!drc_layer_is_visible(&layers, "met1"));
    assert!(drc_layer_is_visible(&layers, "MET2"));
    assert!(drc_layer_is_visible(&layers, "UNKNOWN"));
}

#[test]
fn drc_detail_lines_include_core_violation_context() {
    let violation = DrcViolation {
        id: 0,
        drc_type: "Spacing".to_string(),
        layer: "MET2".to_string(),
        bbox: Rect32 {
            lx: 1,
            ly: 2,
            hx: 3,
            hy: 4,
        },
        required_size: Some(7),
        nets: vec!["net0".to_string(), "VDD".to_string()],
        insts: vec!["u0".to_string()],
    };

    let lines = drc_detail_lines(&violation);

    assert!(lines.contains(&"type: Spacing".to_string()));
    assert!(lines.contains(&"layer: MET2".to_string()));
    assert!(lines.contains(&"bbox: (1, 2) - (3, 4)".to_string()));
    assert!(lines.contains(&"required size: 7".to_string()));
    assert!(lines.contains(&"nets: net0, VDD".to_string()));
    assert!(lines.contains(&"instances: u0".to_string()));
}

#[test]
fn shape_screen_primitive_for_point_uses_payload_point() {
    let world = chipgeom_format::Rect32 {
        lx: 0,
        ly: 0,
        hx: 100,
        hy: 100,
    };
    let canvas = egui::Rect::from_min_size(egui::pos2(0.0, 0.0), egui::vec2(200.0, 200.0));
    let point = chipgeom_format::PointPayload {
        point: Point32 { x: 25, y: 75 },
        symbol_id: 0,
        flags: 0,
    };

    let primitive = shape_screen_primitive(
        ShapeGeometry::Point(point),
        world,
        canvas,
        1.0,
        egui::Vec2::ZERO,
    );

    let ScreenShapePrimitive::Point { center, radius } = primitive else {
        panic!("expected point primitive");
    };
    assert_eq!(
        center,
        world_to_screen_point(point.point, world, canvas, 1.0, egui::Vec2::ZERO)
    );
    assert_eq!(radius, MIN_SHAPE_SCREEN_SIZE);
}

#[test]
fn shape_overlay_primitive_uses_line_payload_geometry() {
    let world = chipgeom_format::Rect32 {
        lx: 0,
        ly: 0,
        hx: 100,
        hy: 100,
    };
    let canvas = egui::Rect::from_min_size(egui::pos2(0.0, 0.0), egui::vec2(200.0, 200.0));
    let line = chipgeom_format::LinePayload {
        begin: Point32 { x: 10, y: 20 },
        end: Point32 { x: 80, y: 90 },
        width: 1,
        flags: 0,
    };

    let primitive = shape_overlay_primitive(
        ShapeGeometry::Line(line),
        world,
        canvas,
        1.0,
        egui::Vec2::ZERO,
    );

    assert!(matches!(primitive, ScreenShapePrimitive::Line { .. }));
}

#[test]
fn screen_to_world_delta_flips_y() {
    let world = chipgeom_format::Rect32 {
        lx: 0,
        ly: 0,
        hx: 100,
        hy: 50,
    };
    let canvas = egui::Rect::from_min_size(egui::pos2(0.0, 0.0), egui::vec2(200.0, 100.0));

    assert_eq!(
        screen_to_world_delta(egui::vec2(20.0, -10.0), world, canvas, 1.0),
        (10, 5)
    );
}

#[test]
fn orthogonal_ruler_commits_points_and_calculates_distances() {
    let mut ruler = OrthogonalRuler::default();
    ruler.start(Point32 { x: 100, y: 200 });
    ruler.commit(Point32 { x: 400, y: 200 });
    ruler.finish();

    let (dx, dy) = ruler_distances(&ruler.points, None);
    assert_eq!(dx, 300);
    assert_eq!(dy, 0);
}

#[test]
fn format_distance_i64_handles_dbu_and_microns() {
    assert_eq!(
        format_distance_i64(2500, CoordinateUnit::Dbu, Some(2000)),
        "2500 DBU"
    );
    assert_eq!(
        format_distance_i64(2500, CoordinateUnit::Micron, Some(2000)),
        "1.250 um"
    );
}

#[test]
fn screen_to_world_rect_inverts_canvas_transform() {
    let world = chipgeom_format::Rect32 {
        lx: 0,
        ly: 0,
        hx: 100,
        hy: 50,
    };
    let canvas = egui::Rect::from_min_size(egui::pos2(0.0, 0.0), egui::vec2(200.0, 100.0));

    assert_eq!(
        screen_to_world_rect(canvas, world, canvas, 1.0, egui::Vec2::ZERO),
        world
    );
}

#[test]
fn screen_to_world_point_inverts_canvas_transform() {
    let world = chipgeom_format::Rect32 {
        lx: 0,
        ly: 0,
        hx: 100,
        hy: 100,
    };
    let canvas = egui::Rect::from_min_size(egui::pos2(0.0, 0.0), egui::vec2(200.0, 200.0));

    assert_eq!(
        screen_to_world_point(
            egui::pos2(150.0, 50.0),
            world,
            canvas,
            1.0,
            egui::Vec2::ZERO
        ),
        Point32 { x: 75, y: 75 }
    );
}

#[test]
fn cursor_status_line_uses_selected_coordinate_unit() {
    let point = Point32 { x: 3000, y: -500 };

    assert_eq!(
        cursor_status_line(point, CoordinateUnit::Dbu, Some(2000)),
        "cursor: 3000 -500 DBU"
    );
    assert_eq!(
        cursor_status_line(point, CoordinateUnit::Micron, Some(2000)),
        "cursor: 1.500 -0.250 um"
    );
}

#[test]
fn hover_status_line_appends_nearest_shape_when_available() {
    let point = Point32 { x: 3000, y: -500 };

    assert_eq!(
        hover_status_line(
            point,
            CoordinateUnit::Dbu,
            Some(2000),
            Some(NearestShape {
                shape_id: 42,
                distance_squared: 25,
            }),
        ),
        "cursor: 3000 -500 DBU, nearest: shape 42 d2 25"
    );
    assert_eq!(
        hover_status_line(point, CoordinateUnit::Micron, Some(2000), None),
        "cursor: 1.500 -0.250 um"
    );
}

#[test]
fn hover_nearest_radius_uses_screen_pixel_distance() {
    let world = chipgeom_format::Rect32 {
        lx: 0,
        ly: 0,
        hx: 1000,
        hy: 1000,
    };
    let canvas = egui::Rect::from_min_size(egui::pos2(0.0, 0.0), egui::vec2(100.0, 100.0));

    assert_eq!(hover_nearest_radius_dbu(world, canvas, 1.0), 80);
    assert_eq!(hover_nearest_radius_dbu(world, canvas, 2.0), 40);
}

#[test]
fn micron_coordinate_unit_falls_back_to_dbu_without_manifest_scale() {
    assert_eq!(
        effective_coordinate_unit(CoordinateUnit::Micron, None),
        CoordinateUnit::Dbu
    );
    assert_eq!(
        format_distance(2000, CoordinateUnit::Micron, None),
        "2000 DBU"
    );
}

#[test]
fn nice_ruler_distance_uses_one_two_five_steps() {
    assert_eq!(nice_ruler_distance_dbu(0.2), 1);
    assert_eq!(nice_ruler_distance_dbu(1.2), 2);
    assert_eq!(nice_ruler_distance_dbu(3.1), 5);
    assert_eq!(nice_ruler_distance_dbu(7.0), 10);
    assert_eq!(nice_ruler_distance_dbu(1200.0), 2000);
}

#[test]
fn scroll_zoom_factor_keeps_directional_zoom() {
    assert_eq!(scroll_zoom_factor(0.0), 1.0);
    assert!((scroll_zoom_factor(1.0) - 1.35).abs() < 1e-4);
    assert!((scroll_zoom_factor(-1.0) - (1.0 / 1.35)).abs() < 1e-4);
    assert!(scroll_zoom_factor(2.0) > scroll_zoom_factor(1.0));
    assert!(scroll_zoom_factor(-2.0) < scroll_zoom_factor(-1.0));
    assert!(scroll_zoom_factor(50.0) > scroll_zoom_factor(25.0));
    assert!(scroll_zoom_factor(-50.0) < scroll_zoom_factor(-25.0));
}

#[test]
fn zoom_at_screen_pos_keeps_cursor_world_position_fixed() {
    let world = chipgeom_format::Rect32 {
        lx: 0,
        ly: 0,
        hx: 100,
        hy: 100,
    };
    let canvas = egui::Rect::from_min_size(egui::pos2(0.0, 0.0), egui::vec2(200.0, 200.0));
    let cursor = egui::pos2(150.0, 50.0);
    let marker = chipgeom_format::Rect32 {
        lx: 75,
        ly: 75,
        hx: 75,
        hy: 75,
    };
    let (zoom, pan) = zoom_at_screen_pos(world, canvas, 1.0, egui::Vec2::ZERO, 2.0, cursor);

    let screen = world_to_screen_rect(marker, world, canvas, zoom, pan);

    assert!((screen.center().x - cursor.x).abs() <= 0.5);
    assert!((screen.center().y - cursor.y).abs() <= 0.5);
}

#[test]
fn translate_rect_moves_all_edges() {
    let rect = chipgeom_format::Rect32 {
        lx: 1,
        ly: 2,
        hx: 3,
        hy: 4,
    };

    assert_eq!(
        translate_rect(rect, 10, -2),
        chipgeom_format::Rect32 {
            lx: 11,
            ly: 0,
            hx: 13,
            hy: 2,
        }
    );
}

#[test]
fn small_fitted_view_uses_exact_shapes() {
    let canvas = egui::Rect::from_min_max(egui::Pos2::ZERO, egui::pos2(1000.0, 800.0));
    let world = chipgeom_format::Rect32 {
        lx: 0,
        ly: 0,
        hx: 1000,
        hy: 1000,
    };
    assert!(!gpu_overview::should_use_view_tiles_for_state(
        16,
        false,
        false,
        1.0,
        0,
        world,
        world,
        canvas,
        1.0,
        gpu_overview::CameraActivity::Settled,
    ));
}

#[test]
fn canvas_status_line_reports_exact_draw_count_zoom_and_viewport() {
    assert_eq!(
        canvas_status_line(
            42,
            0,
            false,
            2,
            3.25,
            Rect32 {
                lx: 10,
                ly: 20,
                hx: 30,
                hy: 40,
            },
        ),
        "drawn: 42 exact, zoom: 3.25x, viewport: 10 20 30 40"
    );
}

#[test]
fn canvas_status_line_reports_tile_lod_when_using_view_tiles() {
    assert_eq!(
        canvas_status_line(
            7,
            0,
            true,
            3,
            0.5,
            Rect32 {
                lx: -10,
                ly: -20,
                hx: 30,
                hy: 40,
            },
        ),
        "drawn: 7 view tiles, lod: 3, zoom: 0.50x, viewport: -10 -20 30 40"
    );
}

#[test]
fn canvas_status_line_reports_exact_overlay_count() {
    assert_eq!(
        canvas_status_line(
            7,
            3,
            true,
            3,
            0.5,
            Rect32 {
                lx: -10,
                ly: -20,
                hx: 30,
                hy: 40,
            },
        ),
        "drawn: 7 view tiles, lod: 3, zoom: 0.50x, viewport: -10 -20 30 40, overlays: 3"
    );
}

#[test]
fn canvas_cursor_icon_uses_hand_at_rest_and_move_while_panning() {
    assert_eq!(canvas_cursor_icon(false, false), None);
    assert_eq!(
        canvas_cursor_icon(true, false),
        Some(egui::CursorIcon::Grab)
    );
    assert_eq!(canvas_cursor_icon(true, true), Some(egui::CursorIcon::Move));
    assert_eq!(
        canvas_cursor_icon(false, true),
        Some(egui::CursorIcon::Move)
    );
}

#[test]
fn edit_mode_keeps_precise_shapes_at_far_zoom() {
    let canvas = egui::Rect::from_min_max(egui::Pos2::ZERO, egui::pos2(1000.0, 800.0));
    let world = chipgeom_format::Rect32 {
        lx: 0,
        ly: 0,
        hx: 1000,
        hy: 1000,
    };
    let overview_viewport = chipgeom_format::Rect32 {
        lx: -1000,
        ly: -1000,
        hx: 2000,
        hy: 2000,
    };
    assert!(!gpu_overview::should_use_view_tiles_for_state(
        16,
        false,
        true,
        0.25,
        0,
        overview_viewport,
        world,
        canvas,
        1.0,
        gpu_overview::CameraActivity::Settled,
    ));
    assert!(!gpu_overview::should_use_view_tiles_for_state(
        16,
        true,
        false,
        0.25,
        0,
        overview_viewport,
        world,
        canvas,
        1.0,
        gpu_overview::CameraActivity::Settled,
    ));
}

#[test]
fn overview_uses_view_tiles_when_far_even_with_exact_overlay() {
    let canvas = egui::Rect::from_min_max(egui::Pos2::ZERO, egui::pos2(1000.0, 800.0));
    let world = chipgeom_format::Rect32 {
        lx: 0,
        ly: 0,
        hx: 1000,
        hy: 1000,
    };
    let overview_viewport = chipgeom_format::Rect32 {
        lx: -1000,
        ly: -1000,
        hx: 2000,
        hy: 2000,
    };
    // Highlights and selection render as exact overlays on top of the
    // tile summary, so they never block the overview path.
    assert!(gpu_overview::should_use_view_tiles_for_state(
        16,
        false,
        false,
        0.25,
        0,
        overview_viewport,
        world,
        canvas,
        1.0,
        gpu_overview::CameraActivity::Settled,
    ));
}

#[test]
fn overview_tile_query_falls_back_when_preferred_lod_is_missing() {
    let dir = temp_snapshot_dir("3d-overview-lod-fallback");
    write_empty_snapshot(&dir, false);
    let tile = chipgeom_format::GeometryViewTileRecord {
        lod_level: 2,
        layer_id: 4,
        shape_count: 12,
        bbox: Rect32 {
            lx: 10,
            ly: 20,
            hx: 110,
            hy: 220,
        },
        ..chipgeom_format::GeometryViewTileRecord::default()
    };
    write_empty_geometry_file(
        &dir.join("geometry.view.bin"),
        chipgeom_format::GeometryFileKind::View,
        core::mem::size_of::<chipgeom_format::GeometryViewTileRecord>() as u32,
        any_as_bytes(&tile),
    );
    let db = ChipViewDb::open(dir.join("geometry.manifest")).unwrap();
    let viewport = Rect32 {
        lx: 0,
        ly: 0,
        hx: 1_000,
        hy: 1_000,
    };
    let tiles = overview_tiles_for_layer(&db, 3, 4, viewport, viewport);
    assert_eq!(tiles.len(), 1);
    assert_eq!(tiles[0].lod_level, 2);
    assert_eq!(tiles[0].bbox.lx, 10);
    let _ = fs::remove_dir_all(&dir);
}

#[test]
fn three_d_overview_extrudes_snapshot_tiles_instead_of_full_die_slabs() {
    let dir = temp_snapshot_dir("3d-overview-tiles");
    write_empty_snapshot(&dir, false);
    let tile = chipgeom_format::GeometryViewTileRecord {
        lod_level: 3,
        layer_id: 1,
        shape_count: 32,
        bbox: Rect32 {
            lx: 100,
            ly: 200,
            hx: 1_400,
            hy: 1_800,
        },
        ..chipgeom_format::GeometryViewTileRecord::default()
    };
    write_empty_geometry_file(
        &dir.join("geometry.view.bin"),
        chipgeom_format::GeometryFileKind::View,
        core::mem::size_of::<chipgeom_format::GeometryViewTileRecord>() as u32,
        any_as_bytes(&tile),
    );
    let db = ChipViewDb::open(dir.join("geometry.manifest")).unwrap();
    let mut loaded = LoadedViewer::new(
        chip_display::ColorTheme::Vivid,
        db,
        false,
        false,
        None,
        None,
        None,
        analysis_loader::AnalysisPaths::default(),
        wgpu::TextureFormat::Bgra8Unorm,
        crate::RenderMode::Gpu,
    );
    loaded.layers = vec![layer_state(1, true)];
    loaded.rebuild_layer_stack();
    let world = Rect32 {
        lx: 0,
        ly: 0,
        hx: 10_000,
        hy: 8_000,
    };
    loaded.camera_ctrl_3d.fit_world(
        crate::camera3d::Vec3::new(world.lx as f32, world.ly as f32, 0.0),
        crate::camera3d::Vec3::new(world.hx as f32, world.hy as f32, 0.0),
        loaded.layer_stack.height(),
    );
    loaded.camera_ctrl_3d.snap_to_target();
    let instances = loaded.build_3d_instances(world, world, &[1], true);
    let tile_inst = instances
        .iter()
        .find(|i| (i.flags & crate::canvas_gpu3d::FLAG_GROUND_GRID) == 0)
        .unwrap();
    assert_eq!(
        tile_inst.rect_dbu,
        [tile.bbox.lx, tile.bbox.ly, tile.bbox.hx, tile.bbox.hy]
    );
    assert_ne!(tile_inst.rect_dbu, [world.lx, world.ly, world.hx, world.hy]);
    let _ = fs::remove_dir_all(&dir);
}

#[test]
fn three_d_fit_prefers_detailed_tiles_over_full_die_panels() {
    let dir = temp_snapshot_dir("3d-fit-detailed-tiles");
    write_empty_snapshot(&dir, false);
    let world = Rect32 {
        lx: 0,
        ly: 0,
        hx: 10_000,
        hy: 8_000,
    };
    let coarse = chipgeom_format::GeometryViewTileRecord {
        lod_level: 3,
        layer_id: 1,
        shape_count: 80,
        bbox: world,
        ..chipgeom_format::GeometryViewTileRecord::default()
    };
    let fine = chipgeom_format::GeometryViewTileRecord {
        lod_level: 0,
        layer_id: 1,
        shape_count: 6,
        bbox: Rect32 {
            lx: 200,
            ly: 300,
            hx: 900,
            hy: 1_100,
        },
        ..chipgeom_format::GeometryViewTileRecord::default()
    };
    let mut payload = Vec::new();
    payload.extend_from_slice(any_as_bytes(&coarse));
    payload.extend_from_slice(any_as_bytes(&fine));
    write_empty_geometry_file(
        &dir.join("geometry.view.bin"),
        chipgeom_format::GeometryFileKind::View,
        core::mem::size_of::<chipgeom_format::GeometryViewTileRecord>() as u32,
        &payload,
    );
    let db = ChipViewDb::open(dir.join("geometry.manifest")).unwrap();
    let mut loaded = LoadedViewer::new(
        chip_display::ColorTheme::Vivid,
        db,
        false,
        false,
        None,
        None,
        None,
        analysis_loader::AnalysisPaths::default(),
        wgpu::TextureFormat::Bgra8Unorm,
        crate::RenderMode::Gpu,
    );
    loaded.layers = vec![layer_state(1, true)];
    loaded.rebuild_layer_stack();
    loaded.camera_ctrl_3d.fit_world_with_aspect(
        crate::camera3d::Vec3::new(world.lx as f32, world.ly as f32, 0.0),
        crate::camera3d::Vec3::new(world.hx as f32, world.hy as f32, 0.0),
        loaded.layer_stack.height(),
        1.2,
    );
    loaded.camera_ctrl_3d.snap_to_target();
    let instances = loaded.build_3d_instances(world, world, &[1], true);
    let tile_inst = instances
        .iter()
        .find(|i| (i.flags & crate::canvas_gpu3d::FLAG_GROUND_GRID) == 0)
        .unwrap();
    assert_eq!(tile_inst.rect_dbu, [200, 300, 900, 1_100]);
    let _ = fs::remove_dir_all(&dir);
}

#[test]
fn overlay_shape_ids_include_highlight_and_selection() {
    let highlighted = BTreeSet::from([10, 20]);

    assert_eq!(
        overlay_shape_ids(Some(30), &highlighted),
        BTreeSet::from([10, 20, 30])
    );
}

#[test]
fn search_highlight_uses_distinct_double_border() {
    let outer = search_highlight_outer_stroke();
    let inner = search_highlight_inner_stroke();

    assert!(outer.width > inner.width);
    assert_eq!(outer.color, egui::Color32::from_rgb(255, 64, 192));
    assert_eq!(inner.color, egui::Color32::from_rgb(255, 248, 210));
    assert_ne!(outer.color, ecos_warning());
    assert_ne!(outer.color, ecos_accent());
}

#[test]
fn clock_tree_highlights_use_distinct_parent_and_child_colors() {
    let (parent_outer, parent_inner) =
        clock_tree_highlight_strokes(clock_tree::ClockTreeHighlightRole::Parent);
    let (child_outer, child_inner) =
        clock_tree_highlight_strokes(clock_tree::ClockTreeHighlightRole::Child);

    assert_ne!(parent_outer.color, child_outer.color);
    assert_ne!(parent_inner.color, child_inner.color);
    assert_ne!(parent_outer.color, search_highlight_outer_stroke().color);
    assert_ne!(child_outer.color, search_highlight_outer_stroke().color);
}

#[test]
fn clock_tree_markers_point_toward_parent_and_child_semantics() {
    let center = egui::pos2(100.0, 100.0);
    let upward = clock_tree_node_marker_vertices(center, 8.0, true);
    let downward = clock_tree_node_marker_vertices(center, 8.0, false);

    assert!(upward[0].y < center.y);
    assert!(upward[1].y > center.y);
    assert!(upward[2].y > center.y);
    assert!(downward[0].y < center.y);
    assert!(downward[1].y < center.y);
    assert!(downward[2].y > center.y);
}

#[test]
fn viewer_installs_analysis_after_geometry_loads() {
    let dir = temp_snapshot_dir("background-analysis");
    write_empty_snapshot(&dir, false);
    let report = dir.join("drc.json");
    fs::write(&report, r#"{"drc":{"number":0,"distribution":{}}}"#).unwrap();
    let mut app = ChipViewerApp::open(
        dir.join("geometry.manifest"),
        "view".into(),
        None,
        None,
        false,
        None,
        Some(report),
        None,
        None,
        None,
        None,
        None,
        None,
        wgpu::TextureFormat::Bgra8Unorm,
        crate::RenderMode::EguiOnly,
    );
    let deadline = Instant::now() + Duration::from_secs(5);
    while matches!(app.state, ViewerState::Loading(_)) {
        app.poll_loading();
        assert!(Instant::now() < deadline, "geometry load timed out");
        thread::sleep(Duration::from_millis(1));
    }
    let ViewerState::Loaded(loaded) = &mut app.state else {
        panic!("expected a loaded viewer");
    };
    assert!(loaded.drc_overlay.is_none());
    assert!(loaded.analysis_loader.is_some());
    let ctx = egui::Context::default();
    while loaded.analysis_loader.is_some() {
        loaded.poll_analysis(&ctx);
        assert!(Instant::now() < deadline, "analysis load timed out");
        thread::sleep(Duration::from_millis(1));
    }
    assert!(loaded
        .drc_overlay
        .as_ref()
        .is_some_and(|overlay| { overlay.load_error.is_none() && overlay.total_count() == 0 }));
    assert!(matches!(loaded.analysis_tab, AnalysisTab::Drc));
    drop(app);
    let _ = fs::remove_dir_all(dir);
}

#[test]
fn selection_detail_lines_include_shape_bbox_and_owner_context() {
    let shape = chipgeom_format::ShapeRecord {
        id: 42,
        version: 3,
        layer_id: 7,
        kind: ShapeKind::Line as u8,
        state: ShapeState::Alive as u8,
        flags: 0x0010,
        reserved_padding0: 0,
        owner_index: 1,
        payload_offset: 99,
        payload_size: 12,
        style_class: 2,
        bbox: Rect32 {
            lx: 10,
            ly: 20,
            hx: 30,
            hy: 40,
        },
    };
    let owner = chipgeom_format::OwnerRef {
        owner_type: OwnerType::NetWireSegment as u8,
        flags: 0x0020,
        owner_id: 123,
        path0: 1,
        path1: 2,
        path2: 3,
        path3: 4,
        name_id: 8,
        ..chipgeom_format::OwnerRef::default()
    };

    assert_eq!(
        selection_detail_lines(&shape, Some(&owner), Some("clk"), Some("via:VIA1")),
        vec![
            "shape: 42",
            "kind: line",
            "state: alive",
            "version: 3",
            "layer: 7",
            "flags: 0x0010",
            "bbox: 10 20 30 40",
            "owner: net_wire_segment 123",
            "owner flags: 0x0020",
            "name: clk",
            "local name: via:VIA1",
            "via: VIA1",
            "path: 1 2 3 4",
        ]
    );
}

#[test]
fn selection_detail_lines_expand_rich_via_local_info() {
    let shape = chipgeom_format::ShapeRecord {
        id: 42,
        version: 3,
        layer_id: 7,
        kind: chipgeom_format::ShapeKind::Rect as u8,
        state: chipgeom_format::ShapeState::Alive as u8,
        flags: 0x0010,
        bbox: chipgeom_format::Rect32 {
            lx: 10,
            ly: 20,
            hx: 30,
            hy: 40,
        },
        ..chipgeom_format::ShapeRecord::default()
    };
    let owner = chipgeom_format::OwnerRef {
        owner_type: OwnerType::Via as u8,
        flags: 0x0020,
        owner_id: 123,
        path0: 1,
        path1: 2,
        path2: 3,
        path3: 4,
        name_id: 8,
        ..chipgeom_format::OwnerRef::default()
    };
    let lines = selection_detail_lines(
            &shape,
            Some(&owner),
            Some("clk"),
            Some(
                "via:VIA12 master:VIA12 type:generated rule:VIA12RULE bottom:M1 cut:VIA12 top:M2 cut_size:4x4 \
                 cut_spacing:8,8 enclosure_bottom:1,2 enclosure_top:3,4 rowcol:1x2 default:true",
            ),
        );

    assert!(lines.contains(&"via: VIA12".to_string()));
    assert!(lines.contains(&"via master: VIA12".to_string()));
    assert!(lines.contains(&"via type: generated".to_string()));
    assert!(lines.contains(&"via rule: VIA12RULE".to_string()));
    assert!(lines.contains(&"via layers: M1 / VIA12 / M2".to_string()));
    assert!(lines.contains(&"via cut: size 4x4 spacing 8,8".to_string()));
    assert!(lines.contains(&"via enclosure: bottom 1,2 top 3,4".to_string()));
    assert!(lines.contains(&"via row/col: 1x2".to_string()));
    assert!(lines.contains(&"via default: true".to_string()));
}

#[test]
fn diagnostics_lines_include_memory_cache_tile_and_delta_context() {
    let memory = chip_view_db::ChipViewMemoryStats {
        mapped_bytes: chip_view_db::GeometryMappedBytes {
            meta: 10,
            shapes: 20,
            owners: 30,
            payload: 40,
            names: 50,
            name_index: 60,
            sidmap: 70,
            delta: 80,
            view: 90,
        },
        index_bytes: chip_view_db::ChipViewIndexMemoryStats {
            layer_index_bytes: 100,
            shape_index_bytes: 200,
            view_index_bytes: 300,
            name_index_bytes: 400,
            net_index_bytes: 0,
            connectivity_index_bytes: 0,
            total_bytes: 1000,
        },
        mapped_plus_index_bytes: 1450,
    };
    let delta = chip_view_db::DeltaStats {
        record_count: 3,
        latest_sequence_id: Some(11),
        latest_command_id: Some(22),
        latest_shape_id: Some(33),
        latest_old_version: Some(4),
        latest_new_version: Some(5),
    };
    let exact_cache = chip_render::RenderCacheStats {
        entries: 2,
        hits: 7,
        misses: 8,
    };
    let tile_cache = chip_render::RenderCacheStats {
        entries: 4,
        hits: 9,
        misses: 10,
    };

    assert_eq!(
        diagnostics_lines(&memory, &delta, 12, exact_cache, tile_cache),
        vec![
            "mmap bytes: 450",
            "index bytes: 1000",
            "total memory: 1450",
            "view tiles: 12",
            "exact cache: 2 entries, 7 hits, 8 misses",
            "tile cache: 4 entries, 9 hits, 10 misses",
            "delta records: 3",
            "latest delta: seq 11 cmd 22 shape 33 v4->5",
        ]
    );
}

#[test]
fn diagnostics_lines_report_empty_delta_log_without_latest_record() {
    let memory = chip_view_db::ChipViewMemoryStats::default();
    let delta = chip_view_db::DeltaStats::default();

    assert_eq!(
        diagnostics_lines(
            &memory,
            &delta,
            0,
            chip_render::RenderCacheStats::default(),
            chip_render::RenderCacheStats::default(),
        ),
        vec![
            "mmap bytes: 0",
            "index bytes: 0",
            "total memory: 0",
            "view tiles: 0",
            "exact cache: 0 entries, 0 hits, 0 misses",
            "tile cache: 0 entries, 0 hits, 0 misses",
            "delta records: 0",
            "latest delta: none",
        ]
    );
}

#[test]
fn design_metadata_lines_report_manifest_context_when_available() {
    let manifest = chip_view_db::GeometryManifest {
        design_name: Some("uart_top".to_string()),
        design_version: Some("5.8".to_string()),
        dbu_per_micron: Some(2000),
        manufacture_grid: Some(5),
        dirty_lod_tile_count: Some(7),
        dirty_lod_rebuild_candidate_count: Some(11),
        written_side_file_count: Some(13),
        reused_side_file_count: Some(5),
        ..chip_view_db::GeometryManifest::default()
    };

    assert_eq!(
        design_metadata_lines(&manifest),
        vec![
            "design: uart_top",
            "design version: 5.8",
            "dbu per micron: 2000",
            "manufacture grid: 5",
            "dirty LOD tiles: 7",
            "dirty LOD candidates: 11",
            "written side files: 13",
            "reused side files: 5",
        ]
    );
    assert!(design_metadata_lines(&chip_view_db::GeometryManifest::default()).is_empty());
}

#[test]
fn semantic_metadata_lines_report_site_and_master_counts() {
    assert_eq!(
        semantic_metadata_lines(2, 3, 4, 5, 6, 7, 8, 9),
        vec![
            "sites: 2".to_string(),
            "masters: 3".to_string(),
            "via definitions: 4".to_string(),
            "grid definitions: 5".to_string(),
            "connectivity endpoints: 6".to_string(),
            "net definitions: 7".to_string(),
            "buses: 8".to_string(),
            "groups: 9".to_string(),
        ]
    );
}

#[test]
fn selection_connectivity_lines_report_endpoint_context() {
    let endpoints = [
        chip_view_db::ConnectivityMetadata {
            net_name: "clk".to_string(),
            net_kind: "clock".to_string(),
            endpoint_type: "instance".to_string(),
            instance_name: "u0".to_string(),
            pin_name: "A".to_string(),
            master_name: "INVX1".to_string(),
        },
        chip_view_db::ConnectivityMetadata {
            net_name: "clk".to_string(),
            net_kind: "clock".to_string(),
            endpoint_type: "io".to_string(),
            pin_name: "CLK".to_string(),
            ..chip_view_db::ConnectivityMetadata::default()
        },
    ];
    let endpoint_refs = endpoints.iter().collect::<Vec<_>>();

    assert_eq!(
        selection_connectivity_lines(&endpoint_refs),
        vec![
            "connectivity endpoints: 2".to_string(),
            "endpoint: instance u0 A master:INVX1".to_string(),
            "endpoint: io - CLK master:-".to_string(),
        ]
    );
    assert!(selection_connectivity_lines(&[]).is_empty());
}

#[test]
fn selection_connectivity_lines_limit_verbose_endpoint_lists() {
    let endpoints = (0..8)
        .map(|index| chip_view_db::ConnectivityMetadata {
            net_name: "data".to_string(),
            net_kind: "signal".to_string(),
            endpoint_type: "instance".to_string(),
            instance_name: format!("u{index}"),
            pin_name: "A".to_string(),
            master_name: "INVX1".to_string(),
        })
        .collect::<Vec<_>>();
    let endpoint_refs = endpoints.iter().collect::<Vec<_>>();
    let lines = selection_connectivity_lines(&endpoint_refs);

    assert_eq!(lines.len(), 8);
    assert_eq!(lines[0], "connectivity endpoints: 8");
    assert_eq!(lines[7], "endpoints omitted: 2");
}

#[test]
fn shape_kind_rendering_includes_bbox_safe_line_and_point_shapes() {
    assert!(is_renderable_shape_kind(ShapeKind::Rect as u8));
    assert!(is_renderable_shape_kind(ShapeKind::Line as u8));
    assert!(is_renderable_shape_kind(ShapeKind::Point as u8));
    assert!(!is_renderable_shape_kind(0));
}

#[test]
fn shape_screen_rect_expands_zero_extent_bbox() {
    let world = Rect32 {
        lx: 0,
        ly: 0,
        hx: 100,
        hy: 100,
    };
    let point_bbox = Rect32 {
        lx: 50,
        ly: 50,
        hx: 50,
        hy: 50,
    };
    let canvas = egui::Rect::from_min_size(egui::pos2(0.0, 0.0), egui::vec2(100.0, 100.0));

    let screen = shape_screen_rect(point_bbox, world, canvas, 1.0, egui::Vec2::ZERO);

    assert!(screen.is_positive());
    assert!(screen.width() >= MIN_SHAPE_SCREEN_SIZE);
    assert!(screen.height() >= MIN_SHAPE_SCREEN_SIZE);
    assert!((screen.center().x - canvas.center().x).abs() <= 0.5);
    assert!((screen.center().y - canvas.center().y).abs() <= 0.5);
}

#[test]
fn first_existing_shape_id_returns_lowest_live_highlight() {
    let highlighted = BTreeSet::from([30, 10, 20]);

    assert_eq!(
        first_existing_shape_id(&highlighted, |shape_id| shape_id != 10),
        Some(20)
    );
    assert_eq!(first_existing_shape_id(&highlighted, |_| false), None);
}

#[test]
fn focus_target_for_shape_ids_uses_union_bbox_and_lowest_live_shape() {
    let highlighted = BTreeSet::from([30, 10, 20]);

    let focus = focus_target_for_shape_ids(&highlighted, |shape_id| match shape_id {
        20 => Some(Rect32 {
            lx: 100,
            ly: 100,
            hx: 120,
            hy: 130,
        }),
        30 => Some(Rect32 {
            lx: -10,
            ly: 5,
            hx: 15,
            hy: 25,
        }),
        _ => None,
    })
    .unwrap();

    assert_eq!(focus.select_shape_id, Some(20));
    assert_eq!(
        focus.bbox,
        Rect32 {
            lx: -10,
            ly: 5,
            hx: 120,
            hy: 130,
        }
    );
}

#[test]
fn shape_id_lookup_action_focuses_existing_shape() {
    let action = shape_id_lookup_action(" 42 ", |shape_id| {
        (shape_id == 42).then_some(Rect32 {
            lx: 10,
            ly: 20,
            hx: 30,
            hy: 40,
        })
    });

    assert_eq!(
        action.pending_focus,
        Some(PendingFocus {
            bbox: Rect32 {
                lx: 10,
                ly: 20,
                hx: 30,
                hy: 40,
            },
            select_shape_id: Some(42),
            transition: FocusTransition::Immediate,
        })
    );
    assert_eq!(action.message, "shape 42 selected");
}

#[test]
fn shape_id_lookup_action_reports_invalid_or_missing_shape() {
    let invalid = shape_id_lookup_action("shape-42", |_| None);
    assert_eq!(invalid.pending_focus, None);
    assert_eq!(invalid.message, "invalid ShapeId: shape-42");

    let missing = shape_id_lookup_action("99", |_| None);
    assert_eq!(missing.pending_focus, None);
    assert_eq!(missing.message, "shape 99 not found");
}

#[test]
fn focus_view_on_bbox_centers_target_bbox() {
    let world = Rect32 {
        lx: 0,
        ly: 0,
        hx: 100,
        hy: 100,
    };
    let target = Rect32 {
        lx: 70,
        ly: 10,
        hx: 80,
        hy: 20,
    };
    let canvas = egui::Rect::from_min_size(egui::pos2(0.0, 0.0), egui::vec2(200.0, 100.0));

    let (zoom, pan) = focus_view_on_bbox(world, target, canvas);
    let screen = world_to_screen_rect(target, world, canvas, zoom, pan);

    assert!((screen.center().x - canvas.center().x).abs() <= 0.5);
    assert!((screen.center().y - canvas.center().y).abs() <= 0.5);
    assert!(zoom >= 1.0);
}

#[test]
fn focus_animation_eases_out_and_finishes_on_the_exact_target() {
    let animation = FocusAnimation::new(10.0, 1.0, egui::Vec2::ZERO, 16.0, egui::vec2(80.0, -40.0));

    let start = animation.sample(10.0);
    let middle = animation.sample(10.0 + MAP_FOCUS_ANIMATION_DURATION_SECONDS * 0.5);
    let end = animation.sample(10.0 + MAP_FOCUS_ANIMATION_DURATION_SECONDS);

    assert_eq!(start.zoom, 1.0);
    assert_eq!(start.pan, egui::Vec2::ZERO);
    assert!(!start.complete);
    assert!(middle.zoom > 4.0 && middle.zoom < 16.0);
    assert!(middle.pan.x > 40.0 && middle.pan.x < 80.0);
    assert!(middle.pan.y < -20.0 && middle.pan.y > -40.0);
    assert!(!middle.complete);
    assert_eq!(end.zoom, 16.0);
    assert_eq!(end.pan, egui::vec2(80.0, -40.0));
    assert!(end.complete);
}

#[test]
fn focus_animation_moves_target_monotonically_to_viewport_center() {
    let target_from_world_center = egui::vec2(10.0, -5.0);
    let animation = FocusAnimation::new(
        10.0,
        1.0,
        egui::Vec2::ZERO,
        16.0,
        -target_from_world_center * 16.0,
    );
    let mut previous_distance = f32::INFINITY;

    for progress in [0.0, 0.1, 0.25, 0.5, 0.75, 1.0] {
        let frame = animation.sample(10.0 + MAP_FOCUS_ANIMATION_DURATION_SECONDS * progress);
        let target_offset = target_from_world_center * frame.zoom + frame.pan;
        let distance = target_offset.length();
        assert!(
                distance <= previous_distance + f32::EPSILON,
                "target moved away from center at progress {progress}: {distance} > {previous_distance}"
            );
        assert!(target_offset.x >= -f32::EPSILON);
        assert!(target_offset.y <= f32::EPSILON);
        previous_distance = distance;
    }
    assert!(previous_distance <= f32::EPSILON);
}

#[test]
fn reduced_motion_environment_values_disable_focus_animation() {
    for value in ["1", "true", "TRUE", "yes", "on"] {
        assert!(reduced_motion_requested(Some(value)));
    }
    for value in ["0", "false", "off", ""] {
        assert!(!reduced_motion_requested(Some(value)));
    }
    assert!(!reduced_motion_requested(None));
}

#[test]
fn render_stats_environment_values_enable_stats_overlay() {
    for value in ["1", "true", "TRUE", "yes", "on"] {
        assert!(env_flag_requested(Some(value)));
    }
    for value in ["0", "false", "off", ""] {
        assert!(!env_flag_requested(Some(value)));
    }
    assert!(!env_flag_requested(None));
    assert_eq!(RENDER_STATS_ENV, "ECOS_RENDER_STATS");
}

#[test]
fn map_focus_keeps_context_around_the_selected_cell() {
    let target = contextual_map_focus_bbox(Rect32 {
        lx: 0,
        ly: 0,
        hx: 100,
        hy: 20,
    });

    assert_eq!(
        target,
        Rect32 {
            lx: -50,
            ly: -90,
            hx: 150,
            hy: 110,
        }
    );
}

#[test]
fn heatmap_pointer_maps_to_matrix_coordinates() {
    let rect = egui::Rect::from_min_size(egui::pos2(10.0, 20.0), egui::vec2(100.0, 80.0));

    assert_eq!(
        heatmap_cell_at(egui::pos2(10.0, 20.0), rect, 4, 5),
        Some((0, 0))
    );
    assert_eq!(
        heatmap_cell_at(egui::pos2(109.9, 99.9), rect, 4, 5),
        Some((3, 4))
    );
    assert_eq!(heatmap_cell_at(egui::pos2(110.1, 100.1), rect, 4, 5), None);
}

#[test]
fn heatmap_pointer_ignores_cells_without_finite_data() {
    let directory = temp_snapshot_dir("heatmap-interactive-cells");
    let values_path = directory.join("values.csv");
    let layout_path = directory.join("layout.csv");
    fs::write(&values_path, "1,NaN\n3,4\n").unwrap();
    fs::write(
        &layout_path,
        "pixel_row,pixel_col,lx,ly,ux,uy\n0,0,0,0,10,10\n0,1,10,0,20,10\n",
    )
    .unwrap();
    let data = HeatmapData::load(&values_path, &layout_path).unwrap();
    let rect = egui::Rect::from_min_size(egui::Pos2::ZERO, egui::vec2(100.0, 100.0));

    assert_eq!(
        interactive_heatmap_cell_at(egui::pos2(25.0, 25.0), rect, &data),
        Some((0, 0))
    );
    assert_eq!(
        interactive_heatmap_cell_at(egui::pos2(75.0, 25.0), rect, &data),
        None
    );

    fs::remove_dir_all(directory).unwrap();
}

#[test]
fn heatmap_preview_reuses_colored_cells_across_resizing_and_selection() {
    let directory = temp_snapshot_dir("heatmap-preview-redraw");
    let values_path = directory.join("values.csv");
    let layout_path = directory.join("layout.csv");
    fs::write(&values_path, "0,1,2\n3,NaN,5\n").unwrap();
    fs::write(
        &layout_path,
        "pixel_row,pixel_col,lx,ly,ux,uy\n0,0,0,0,1,1\n",
    )
    .unwrap();
    let data = HeatmapData::load(&values_path, &layout_path).unwrap();
    fs::remove_dir_all(directory).unwrap();

    let ctx = egui::Context::default();
    let mut heatmap = ActiveHeatmap::new("Preview".into(), data);
    let draw = |heatmap: &ActiveHeatmap, size| {
        ctx.run(egui::RawInput::default(), |ctx| {
            let rect = egui::Rect::from_min_size(egui::Pos2::ZERO, size);
            let painter = ctx.layer_painter(egui::LayerId::background());
            paint_heatmap_grid(&painter, rect, heatmap);
        })
    };
    let first = draw(&heatmap, egui::vec2(15.0, 10.0));
    heatmap.selected_cell = Some((0, 2));
    heatmap.opacity = 0.1;
    let next = draw(&heatmap, egui::vec2(18.0, 12.0));
    let preview_id = |output: &egui::FullOutput| {
        output.shapes.iter().find_map(|shape| match &shape.shape {
            egui::Shape::Mesh(mesh) => Some(mesh.texture_id),
            _ => None,
        })
    };
    let id = preview_id(&first).expect("preview cells should be drawn as one image");
    assert_eq!(preview_id(&next), Some(id));
    let (_, upload) = first
        .textures_delta
        .set
        .iter()
        .find(|(uploaded, _)| *uploaded == id)
        .unwrap();
    let egui::ImageData::Color(image) = &upload.image else {
        panic!("expected a color image")
    };
    assert_eq!(image.size, [3, 2]);
    assert_eq!(
        image.pixels,
        [Some(0.0), Some(0.2), Some(0.4), Some(0.6), None, Some(1.0)].map(|norm| {
            norm.map_or(egui::Color32::TRANSPARENT, |norm| {
                color32(heatmap.colormap_mode.sample(norm))
            })
        })
    );
    assert!(next.textures_delta.set.is_empty());

    heatmap.set_threshold(0.5);
    let filtered = draw(&heatmap, egui::vec2(18.0, 12.0));
    let filtered_id = preview_id(&filtered).unwrap();
    assert_ne!(filtered_id, id);
    assert!(filtered.textures_delta.free.contains(&id));
    let (_, upload) = filtered
        .textures_delta
        .set
        .iter()
        .find(|(uploaded, _)| *uploaded == filtered_id)
        .unwrap();
    let egui::ImageData::Color(image) = &upload.image else {
        panic!("expected a color image")
    };
    assert_eq!(&image.pixels[..3], &[egui::Color32::TRANSPARENT; 3]);
}

#[test]
fn heatmap_preview_splits_at_texture_limit_and_preserves_last_column() {
    let ctx = egui::Context::default();
    let limit = ctx.input(|i| i.max_texture_side);
    let directory = temp_snapshot_dir("heatmap-preview-tiled");
    let values_path = directory.join("values.csv");
    let layout_path = directory.join("layout.csv");
    fs::write(&values_path, format!("{}1\n", "0,".repeat(limit))).unwrap();
    fs::write(
        &layout_path,
        "pixel_row,pixel_col,lx,ly,ux,uy\n0,0,0,0,1,1\n",
    )
    .unwrap();
    let data = HeatmapData::load(&values_path, &layout_path).unwrap();
    fs::remove_dir_all(directory).unwrap();
    let heatmap = ActiveHeatmap::new("Wide".into(), data);

    let output = ctx.run(egui::RawInput::default(), |ctx| {
        let rect =
            egui::Rect::from_min_size(egui::pos2(2.0, 4.0), egui::vec2((limit + 1) as f32, 5.0));
        paint_heatmap_grid(
            &ctx.layer_painter(egui::LayerId::background()),
            rect,
            &heatmap,
        );
    });
    let meshes: Vec<_> = output
        .shapes
        .iter()
        .filter_map(|s| match &s.shape {
            egui::Shape::Mesh(mesh) => Some(mesh),
            _ => None,
        })
        .collect();
    assert_eq!(meshes.len(), 2);
    assert_eq!(
        meshes[0].calc_bounds().right(),
        meshes[1].calc_bounds().left()
    );
    assert_eq!(meshes[1].calc_bounds().width(), 1.0);
    for (mesh, width, norm) in [(meshes[0], limit, 0.0), (meshes[1], 1, 1.0)] {
        let (_, upload) = output
            .textures_delta
            .set
            .iter()
            .find(|(id, _)| *id == mesh.texture_id)
            .unwrap();
        let egui::ImageData::Color(image) = &upload.image else {
            panic!("expected a color tile")
        };
        assert_eq!(image.size, [width, 1]);
        assert!(image
            .pixels
            .iter()
            .all(|pixel| *pixel == color32(heatmap.colormap_mode.sample(norm))));
    }
}

#[test]
fn heatmap_threshold_omits_sub_threshold_cells_for_transparency() {
    let directory = temp_snapshot_dir("heatmap-threshold-instances");
    let values_path = directory.join("values.csv");
    let layout_path = directory.join("layout.csv");
    fs::write(&values_path, "0.0,0.5\n0.8,1.0\n").unwrap();
    fs::write(
            &layout_path,
            "pixel_row,pixel_col,lx,ly,ux,uy\n0,0,0,10,10,20\n0,1,10,10,20,20\n1,0,0,0,10,10\n1,1,10,0,20,10\n",
        )
        .unwrap();
    let data = HeatmapData::load(&values_path, &layout_path).unwrap();

    let all_instances = build_heatmap_instances(&data, ColormapMode::Turbo, 0.0, false);
    assert_eq!(all_instances.len(), 4);

    let half_instances = build_heatmap_instances(&data, ColormapMode::Turbo, 0.6, false);
    assert_eq!(half_instances.len(), 2);

    // Inverted: norm <= 0.6 => keeps 0.0 and 0.5 (2 instances)
    let inverted_instances = build_heatmap_instances(&data, ColormapMode::Turbo, 0.6, true);
    assert_eq!(inverted_instances.len(), 2);

    assert_eq!(data.peak_cell(false), Some((1, 1)));
    assert_eq!(data.peak_cell(true), Some((0, 0)));

    let mut active = ActiveHeatmap::new("Test".to_string(), data);
    let original = Arc::clone(active.instances());
    active.opacity = 0.2;
    active.selected_cell = Some((0, 0));
    assert!(Arc::ptr_eq(active.instances(), &original));
    active.set_threshold(0.7);
    let filtered = Arc::clone(active.instances());
    assert!(!Arc::ptr_eq(&filtered, &original));
    assert_eq!(filtered.len(), 2);
    active.set_invert_threshold(true);
    assert!(!Arc::ptr_eq(active.instances(), &filtered));
    assert_eq!(active.instances().len(), 2);

    fs::remove_dir_all(directory).unwrap();
}

#[test]
fn map_catalog_find_item_by_csv_locates_matching_item_and_layout() {
    let catalog = MapCatalog {
        categories: vec![crate::map_data::MapCategory {
            id: "cat1".to_string(),
            label: "Category 1".to_string(),
            layout_path: Some(PathBuf::from("/tmp/layout.csv")),
            items: vec![crate::map_data::MapItem {
                label: "Item 1".to_string(),
                csv_path: PathBuf::from("/tmp/item1.csv"),
            }],
        }],
        warnings: Vec::new(),
    };

    let found = catalog.find_item_by_csv(Path::new("/tmp/item1.csv"));
    assert!(found.is_some());
    let (item, layout) = found.unwrap();
    assert_eq!(item.label, "Item 1");
    assert_eq!(layout, Some(Path::new("/tmp/layout.csv")));

    assert!(catalog
        .find_item_by_csv(Path::new("/tmp/missing.csv"))
        .is_none());
}

#[test]
fn heatmap_layout_uses_a_larger_contextual_grid() {
    let canvas = egui::Rect::from_min_size(egui::pos2(0.0, 0.0), egui::vec2(674.0, 650.0));

    let (popup, grid) = map_heatmap_layout(canvas, 43, 43);

    assert!((popup.x - 310.04).abs() < 0.1);
    assert!((grid.x - 290.04).abs() < 0.1);
    assert_eq!(grid.x, grid.y);
    assert!((popup.y - (grid.y + MAP_HEATMAP_VERTICAL_OVERHEAD)).abs() < 0.1);
}

#[test]
fn heatmap_layout_stays_inside_a_small_canvas() {
    let canvas = egui::Rect::from_min_size(egui::pos2(0.0, 0.0), egui::vec2(220.0, 180.0));

    let (popup, grid) = map_heatmap_layout(canvas, 43, 43);

    assert!(popup.x <= canvas.width() - 24.0);
    assert!(popup.y <= canvas.height() - 24.0);
    assert!(grid.x <= popup.x - 20.0);
    assert!(grid.y <= canvas.height() - 118.0);
}

#[test]
fn retain_existing_shape_id_clears_stale_selection() {
    assert_eq!(
        retain_existing_shape_id(Some(10), |shape_id| shape_id == 10),
        Some(10)
    );
    assert_eq!(
        retain_existing_shape_id(Some(20), |shape_id| shape_id == 10),
        None
    );
    assert_eq!(
        retain_existing_shape_id(None, |shape_id| shape_id == 10),
        None
    );
}

#[test]
fn search_mode_filters_net_and_instance_owner_types() {
    assert_eq!(SearchMode::All.owner_types(), None);
    assert_eq!(
        SearchMode::Net.owner_types(),
        Some(
            &[
                chipgeom_format::OwnerType::NetWireSegment,
                chipgeom_format::OwnerType::SpecialWireSegment,
            ][..]
        )
    );
    assert_eq!(
        SearchMode::Instance.owner_types(),
        Some(
            &[
                chipgeom_format::OwnerType::InstanceBBox,
                chipgeom_format::OwnerType::InstanceHalo,
            ][..]
        )
    );
    assert_eq!(SearchMode::Bus.owner_types(), None);
    assert_eq!(SearchMode::Group.owner_types(), None);
    assert_eq!(SearchMode::Pin.owner_types(), None);
    assert_eq!(SearchMode::Pin.label(), "Pin");
    assert_eq!(SearchMode::Bus.label(), "Bus");
    assert_eq!(SearchMode::Group.label(), "Group");
}

#[test]
fn search_pattern_uses_standard_regex_syntax() {
    let pattern = search_pattern("Tile_X[01]_Y0_.*").unwrap();
    assert!(pattern.is_match("Tile_X0_Y0_ALU_out"));
    assert!(pattern.is_match("Tile_X1_Y0_ALU_out"));
    assert!(!pattern.is_match("Tile_X2_Y0_ALU_out"));
    assert!(!search_pattern("^Tile_X[01]_Y0_*$")
        .unwrap()
        .is_match("Tile_X0_Y0_ALU_out"));
}

#[test]
fn search_pattern_reports_invalid_regex() {
    assert!(search_pattern("[").is_err());
}

#[test]
fn object_visibility_default_matches_startup_drawing_data() {
    let visibility = ObjectVisibility::default();
    let enabled = DrawingCategory::ALL
        .into_iter()
        .filter(|category| visibility.is_category_visible(*category))
        .collect::<Vec<_>>();

    assert_eq!(
        enabled,
        vec![
            DrawingCategory::InstanceMacro,
            DrawingCategory::InstanceStdCell,
            DrawingCategory::InstanceFiller,
            DrawingCategory::Halo,
            DrawingCategory::Placement,
            DrawingCategory::Boundaries,
            DrawingCategory::Fill,
        ]
    );
    assert!(!visibility.is_all_visible());
}

#[test]
fn object_visibility_hides_only_the_requested_owner_categories() {
    let visibility = ObjectVisibility {
        instances: crate::instance_visibility::InstanceClassVisibility {
            macro_: false,
            stdcell: false,
            filler: false,
        },
        fill: false,
        io_pin: true,
        net_signal: false,
        net_clock: false,
        net_other: false,
        pdn_power: true,
        pdn_ground: true,
        tracks: true,
        halo: false,
        ..ObjectVisibility::default()
    };

    assert!(!visibility.includes_owner_type(OwnerType::InstanceBBox as u8));
    assert!(!visibility.includes_owner_type(OwnerType::InstanceHalo as u8));
    assert!(!visibility.includes_owner_type(OwnerType::NetWireSegment as u8));
    assert!(visibility.includes_owner_type(OwnerType::SpecialWireSegment as u8));
    assert!(visibility.includes_owner_type(OwnerType::PinPortShape as u8));
    assert!(visibility.includes_owner_type(OwnerType::InstancePinPortShape as u8));
    assert!(visibility.includes_owner_type(OwnerType::IoPinPortShape as u8));
    assert!(visibility.includes_owner_type(OwnerType::TrackGrid as u8));
    assert!(!visibility.is_all_visible());
}

#[test]
fn halo_category_toggles_independently_of_instance_classes() {
    let mut visibility = ObjectVisibility::default();
    assert!(visibility.is_category_visible(DrawingCategory::Halo));
    assert!(visibility.includes_owner_type(OwnerType::InstanceHalo as u8));

    visibility.set_category_visible(DrawingCategory::Halo, false);
    assert!(!visibility.is_category_visible(DrawingCategory::Halo));
    assert!(!visibility.includes_owner_type(OwnerType::InstanceHalo as u8));
    assert!(visibility.includes_owner_type(OwnerType::InstanceBBox as u8));

    visibility.set_category_visible(DrawingCategory::Halo, true);
    assert!(visibility.includes_owner_type(OwnerType::InstanceHalo as u8));
}

#[test]
fn instance_class_categories_toggle_independently() {
    let mut visibility = ObjectVisibility::default();
    assert_eq!(
        visibility.instances.tri_state(),
        crate::instance_visibility::TriState::All
    );

    visibility.set_category_visible(DrawingCategory::InstanceStdCell, false);
    assert!(!visibility.is_category_visible(DrawingCategory::InstanceStdCell));
    assert!(visibility.is_category_visible(DrawingCategory::InstanceMacro));
    assert!(visibility.is_category_visible(DrawingCategory::InstanceFiller));
    assert_eq!(
        visibility.instances.tri_state(),
        crate::instance_visibility::TriState::Partial
    );
    assert!(visibility.includes_owner_type(OwnerType::InstanceBBox as u8));

    visibility.set_category_visible(DrawingCategory::InstanceMacro, false);
    visibility.set_category_visible(DrawingCategory::InstanceFiller, false);
    assert!(!visibility.includes_owner_type(OwnerType::InstanceBBox as u8));
    assert_eq!(
        visibility.instances.tri_state(),
        crate::instance_visibility::TriState::None
    );
}

#[test]
fn net_kind_maps_to_drawing_net_categories() {
    assert_eq!(
        net_kind_drawing_category(Some("signal")),
        DrawingCategory::NetSignal
    );
    assert_eq!(
        net_kind_drawing_category(Some("CLOCK")),
        DrawingCategory::NetClock
    );
    assert_eq!(
        net_kind_drawing_category(Some("power")),
        DrawingCategory::NetOther
    );
    assert_eq!(net_kind_drawing_category(None), DrawingCategory::NetOther);
}

#[test]
fn pdn_net_names_split_into_power_and_ground_categories() {
    assert_eq!(
        pdn_category_for_name(Some("VSS")),
        DrawingCategory::PdnGround
    );
    assert_eq!(
        pdn_category_for_name(Some("vss_dig")),
        DrawingCategory::PdnGround
    );
    assert_eq!(
        pdn_category_for_name(Some("GND")),
        DrawingCategory::PdnGround
    );
    assert_eq!(
        pdn_category_for_name(Some("VDD")),
        DrawingCategory::PdnPower
    );
    assert_eq!(
        pdn_category_for_name(Some("VCC_CORE")),
        DrawingCategory::PdnPower
    );
    assert_eq!(pdn_category_for_name(None), DrawingCategory::PdnPower);
}

#[test]
fn extended_drawing_categories_control_vias_and_context_geometry() {
    let mut visibility = ObjectVisibility::default();
    visibility.set_all_visible(true);
    visibility.set_category_visible(DrawingCategory::Vias, false);
    visibility.set_category_visible(DrawingCategory::Tracks, false);
    visibility.set_category_visible(DrawingCategory::GCells, false);
    visibility.set_category_visible(DrawingCategory::Obstructions, false);

    assert!(!visibility.includes_owner_type(OwnerType::Via as u8));
    assert!(!visibility.includes_owner_type(OwnerType::TrackGrid as u8));
    assert!(!visibility.includes_owner_type(OwnerType::GCellGrid as u8));
    assert!(!visibility.includes_owner_type(OwnerType::Blockage as u8));
    assert!(!visibility.includes_owner_type(OwnerType::Obs as u8));
    assert!(visibility.includes_owner_type(OwnerType::Fill as u8));
}

#[test]
fn drawing_categories_cover_every_mapped_owner_type() {
    for owner_type in [
        OwnerType::InstanceBBox,
        OwnerType::InstanceHalo,
        OwnerType::NetWireSegment,
        OwnerType::SpecialWireSegment,
        OwnerType::Via,
        OwnerType::PinPortShape,
        OwnerType::InstancePinPortShape,
        OwnerType::IoPinPortShape,
        OwnerType::Row,
        OwnerType::TrackGrid,
        OwnerType::GCellGrid,
        OwnerType::Blockage,
        OwnerType::Obs,
        OwnerType::Die,
        OwnerType::Core,
        OwnerType::Fill,
        OwnerType::Region,
        OwnerType::Slot,
    ] {
        assert!(DrawingCategory::ALL
            .into_iter()
            .any(|category| category.includes_owner_type(owner_type)));
    }
}

#[test]
fn owner_styles_preserve_layer_color_and_use_distinct_textures() {
    let base = LayerStyle::default_for_metadata(7, "MET1", 0, chip_display::ColorTheme::Vivid);
    let assert_layer_color = |style: LayerStyle| {
        assert_eq!(&style.rgba[..3], &base.rgba[..3]);
        assert_eq!(&style.frame_rgba[..3], &base.rgba[..3]);
    };
    let track = OwnerRef {
        owner_type: OwnerType::TrackGrid as u8,
        ..OwnerRef::default()
    };
    let gcell = OwnerRef {
        owner_type: OwnerType::GCellGrid as u8,
        ..OwnerRef::default()
    };
    let instance = OwnerRef {
        owner_type: OwnerType::InstanceBBox as u8,
        ..OwnerRef::default()
    };
    let net = OwnerRef {
        owner_type: OwnerType::NetWireSegment as u8,
        ..OwnerRef::default()
    };
    let pdn = OwnerRef {
        owner_type: OwnerType::SpecialWireSegment as u8,
        ..OwnerRef::default()
    };
    let pin = OwnerRef {
        owner_type: OwnerType::PinPortShape as u8,
        ..OwnerRef::default()
    };
    let instance_pin = OwnerRef {
        owner_type: OwnerType::InstancePinPortShape as u8,
        ..OwnerRef::default()
    };
    let io_pin = OwnerRef {
        owner_type: OwnerType::IoPinPortShape as u8,
        ..OwnerRef::default()
    };

    let track_style = style_for_shape(base, Some(&track));
    assert_layer_color(track_style);
    assert_eq!(track_style.fill_pattern, FillPattern::Hollow);
    assert_eq!(track_style.fill_alpha, 0);
    assert_eq!(track_style.frame_alpha, 82);
    assert_eq!(track_style.line_width_px, 1);

    let gcell_style = style_for_shape(base, Some(&gcell));
    assert_layer_color(gcell_style);
    assert_eq!(gcell_style.fill_pattern, FillPattern::Hollow);
    assert_eq!(gcell_style.line_width_px, 2);

    let instance_style = style_for_shape(base, Some(&instance));
    assert_layer_color(instance_style);
    assert_eq!(instance_style.fill_pattern, FillPattern::Solid);
    assert_eq!(instance_style.fill_alpha, 64);
    assert_eq!(instance_style.frame_alpha, 172);
    assert_eq!(instance_style.line_width_px, 1);

    let net_style = style_for_shape(base, Some(&net));
    assert_layer_color(net_style);
    assert_eq!(net_style.fill_pattern, FillPattern::DiagonalHatch);
    assert!(net_style.fill_alpha >= 56);

    let pdn_style = style_for_shape(base, Some(&pdn));
    assert_layer_color(pdn_style);
    assert_eq!(pdn_style.fill_pattern, FillPattern::Grid);
    assert_eq!(pdn_style.line_width_px, 2);

    let pin_style = style_for_shape(base, Some(&pin));
    assert_layer_color(pin_style);
    assert_eq!(pin_style.fill_pattern, FillPattern::Grid);
    assert_eq!(pin_style.line_width_px, 2);

    let instance_pin_style = style_for_shape(base, Some(&instance_pin));
    assert_layer_color(instance_pin_style);
    assert_eq!(instance_pin_style.fill_pattern, FillPattern::Grid);
    assert_eq!(instance_pin_style.line_width_px, 2);

    let io_pin_style = style_for_shape(base, Some(&io_pin));
    assert_eq!(&io_pin_style.rgba[..3], &[245, 190, 32]);
    assert_eq!(&io_pin_style.frame_rgba[..3], &[255, 222, 89]);
    assert_eq!(io_pin_style.fill_pattern, FillPattern::CrossHatch);
    assert_eq!(io_pin_style.line_width_px, 2);

    let halo = OwnerRef {
        owner_type: OwnerType::InstanceHalo as u8,
        ..OwnerRef::default()
    };
    let halo_style = style_for_shape(base, Some(&halo));
    assert_eq!(&halo_style.rgba[..3], &[255, 140, 0]);
    assert_eq!(&halo_style.frame_rgba[..3], &[255, 140, 0]);
    assert_eq!(halo_style.fill_pattern, FillPattern::HorizontalHatch);
    assert_eq!(halo_style.line_width_px, 1);
    // The fixed orange must not follow the owning layer's color.
    let other_base =
        LayerStyle::default_for_metadata(9, "MET3", 0, chip_display::ColorTheme::Vivid);
    let other_halo_style = style_for_shape(other_base, Some(&halo));
    assert_eq!(&other_halo_style.rgba[..3], &[255, 140, 0]);
    assert_eq!(&other_halo_style.frame_rgba[..3], &[255, 140, 0]);
    // Real halo shapes live on the layout-geometry layer; the fixed orange
    // must survive that layer's transparent-gray conversion.
    let layout_halo_style = style_for_shape(layout_geometry_layer_style(), Some(&halo));
    assert_eq!(&layout_halo_style.rgba, &[255, 140, 0, 38]);
    assert_eq!(&layout_halo_style.frame_rgba, &[255, 140, 0, 156]);

    let via = OwnerRef {
        owner_type: OwnerType::Via as u8,
        ..OwnerRef::default()
    };
    let via_style = style_for_shape(base, Some(&via));
    assert_layer_color(via_style);
    assert_eq!(via_style.fill_pattern, FillPattern::XMark);
    assert_eq!(via_style.line_width_px, 1);
}

#[test]
fn layout_geometry_layer_uses_transparent_gray_styles() {
    let layout = layout_geometry_layer_style();
    assert_eq!(layout.rgba, [148, 148, 148, 48]);
    assert_eq!(layout.frame_rgba, [148, 148, 148, 128]);

    let instance = OwnerRef {
        owner_type: OwnerType::InstanceBBox as u8,
        ..OwnerRef::default()
    };
    let instance_style = style_for_shape(layout, Some(&instance));
    assert_eq!(instance_style.rgba, [148, 148, 148, 48]);
    assert_eq!(instance_style.frame_rgba, [148, 148, 148, 128]);
    assert_eq!(instance_style.fill_pattern, FillPattern::Solid);

    let die = OwnerRef {
        owner_type: OwnerType::Die as u8,
        ..OwnerRef::default()
    };
    let die_style = style_for_shape(layout, Some(&die));
    assert_eq!(die_style.rgba, [148, 148, 148, 0]);
    assert_eq!(die_style.frame_rgba, [148, 148, 148, 128]);
    assert_eq!(die_style.fill_pattern, FillPattern::Hollow);
}

#[test]
fn shape_label_kind_maps_supported_owners() {
    for (owner_type, path0, expected) in [
        (OwnerType::IoPinPortShape, 0, ShapeLabelKind::IoPin),
        (OwnerType::PinPortShape, 0, ShapeLabelKind::IoPin),
        (OwnerType::PinPortShape, 1, ShapeLabelKind::Pin),
        (OwnerType::InstancePinPortShape, 1, ShapeLabelKind::Pin),
        (OwnerType::NetWireSegment, 0, ShapeLabelKind::Net),
        (OwnerType::SpecialWireSegment, 0, ShapeLabelKind::Pdn),
        (OwnerType::InstanceBBox, 0, ShapeLabelKind::Instance),
    ] {
        let owner = OwnerRef {
            owner_type: owner_type as u8,
            path0,
            ..OwnerRef::default()
        };
        assert_eq!(shape_label_kind(owner_type, &owner), Some(expected));
    }
    assert_eq!(shape_label_kind(OwnerType::Via, &OwnerRef::default()), None);
}

#[test]
fn cpu_and_gpu_pin_candidates_share_kind_name_and_key() {
    let world = Rect32 {
        lx: 0,
        ly: 0,
        hx: 1000,
        hy: 1000,
    };
    let canvas = egui::Rect::from_min_size(egui::pos2(0.0, 0.0), egui::vec2(1000.0, 1000.0));
    let geometry = ShapeGeometry::Rect(Rect32 {
        lx: 100,
        ly: 100,
        hx: 300,
        hy: 220,
    });
    let owner = OwnerRef {
        owner_type: OwnerType::InstancePinPortShape as u8,
        owner_id: 31,
        path0: 7,
        ..OwnerRef::default()
    };

    let gpu = shape_label_info(&geometry, Some(&owner), Some("BNDRY_CAP_143/VSS"), 42)
        .expect("gpu pin candidate");
    let cpu = shape_label_candidate(
        geometry,
        Some(&owner),
        Some("BNDRY_CAP_143/VSS"),
        false,
        false,
        world,
        canvas,
        1.0,
        egui::Vec2::ZERO,
    )
    .expect("cpu pin candidate");

    assert_eq!(gpu.shape_id, 42);
    assert_eq!(gpu.kind, ShapeLabelKind::Pin);
    assert_eq!(cpu.kind, gpu.kind);
    assert_eq!(cpu.text, "VSS");
    assert_eq!(cpu.text, gpu.text);
    assert_eq!(cpu.key, gpu.key);
}

#[test]
fn context_owner_types_are_deferred_until_zoomed_in() {
    assert!(is_context_owner_type(OwnerType::TrackGrid as u8));
    assert!(is_context_owner_type(OwnerType::GCellGrid as u8));
    assert!(is_context_owner_type(OwnerType::Row as u8));
    assert!(is_context_owner_type(OwnerType::Obs as u8));
    assert!(!is_context_owner_type(OwnerType::NetWireSegment as u8));
    assert!(!is_context_owner_type(OwnerType::InstanceBBox as u8));
}

#[test]
fn layout_level_owner_styles_do_not_require_layer_visibility() {
    assert!(!owner_uses_layer_visibility(Some(OwnerType::InstanceBBox)));
    assert!(!owner_uses_layer_visibility(Some(OwnerType::InstanceHalo)));
    assert!(!owner_uses_layer_visibility(Some(OwnerType::Die)));
    assert!(!owner_uses_layer_visibility(Some(OwnerType::Core)));
    assert!(!owner_uses_layer_visibility(Some(OwnerType::Row)));
    assert!(!owner_uses_layer_visibility(Some(OwnerType::Region)));

    assert!(owner_uses_layer_visibility(Some(OwnerType::NetWireSegment)));
    assert!(owner_uses_layer_visibility(Some(
        OwnerType::SpecialWireSegment
    )));
    assert!(owner_uses_layer_visibility(Some(OwnerType::PinPortShape)));
    assert!(owner_uses_layer_visibility(Some(
        OwnerType::InstancePinPortShape
    )));
    assert!(owner_uses_layer_visibility(Some(OwnerType::IoPinPortShape)));
    assert!(owner_uses_layer_visibility(Some(OwnerType::Via)));
    assert!(owner_uses_layer_visibility(None));

    let layout_shape = ShapeRecord {
        layer_id: LAYOUT_GEOMETRY_LAYER,
        ..ShapeRecord::default()
    };
    assert!(!shape_uses_layer_visibility(
        &layout_shape,
        Some(OwnerType::GCellGrid)
    ));
    assert!(!shape_uses_layer_visibility(
        &layout_shape,
        Some(OwnerType::TrackGrid)
    ));
    assert!(!shape_uses_layer_visibility(
        &layout_shape,
        Some(OwnerType::Blockage)
    ));

    let physical_shape = ShapeRecord {
        layer_id: 7,
        ..ShapeRecord::default()
    };
    assert!(shape_uses_layer_visibility(
        &physical_shape,
        Some(OwnerType::TrackGrid)
    ));
}

#[test]
fn parameterized_grid_visible_indices_clip_to_viewport_by_direction() {
    let grid = GridMetadata {
        grid_type: "track".to_string(),
        direction: "x".to_string(),
        start: 100,
        step: 200,
        count: 4,
        ..GridMetadata::default()
    };
    assert_eq!(
        grid_visible_indices(
            &grid,
            Rect32 {
                lx: 50,
                ly: -1000,
                hx: 550,
                hy: 1000,
            },
        ),
        vec![0, 1, 2]
    );
    assert_eq!(
        grid_visible_indices(
            &grid,
            Rect32 {
                lx: 101,
                ly: -1000,
                hx: 499,
                hy: 1000,
            },
        ),
        vec![1]
    );

    let y_grid = GridMetadata {
        direction: "y".to_string(),
        ..grid
    };
    assert_eq!(
        grid_visible_indices(
            &y_grid,
            Rect32 {
                lx: -1000,
                ly: 50,
                hx: 1000,
                hy: 550,
            },
        ),
        vec![0, 1, 2]
    );
}

#[test]
fn parameterized_grid_lines_clip_to_design_bounds() {
    let viewport = Rect32 {
        lx: -40,
        ly: 20,
        hx: 60,
        hy: 140,
    };
    let design_bounds = Rect32 {
        lx: 0,
        ly: 0,
        hx: 100,
        hy: 100,
    };
    let x_grid = GridMetadata {
        direction: "x".to_string(),
        ..GridMetadata::default()
    };
    assert_eq!(
        parameterized_grid_line_endpoints(&x_grid, 50, viewport, design_bounds),
        Some((Point32 { x: 50, y: 20 }, Point32 { x: 50, y: 100 }))
    );

    let y_grid = GridMetadata {
        direction: "y".to_string(),
        ..GridMetadata::default()
    };
    assert_eq!(
        parameterized_grid_line_endpoints(&y_grid, 40, viewport, design_bounds),
        Some((Point32 { x: 0, y: 40 }, Point32 { x: 60, y: 40 }))
    );
    assert_eq!(
        parameterized_grid_line_endpoints(
            &x_grid,
            50,
            Rect32 {
                lx: 120,
                ly: 120,
                hx: 160,
                hy: 160,
            },
            design_bounds,
        ),
        None
    );

    let drc_viewport = Rect32 {
        lx: -20_405,
        ly: 23_796,
        hx: 35_574,
        hy: 68_467,
    };
    let drc_die = Rect32 {
        lx: 0,
        ly: 0,
        hx: 59_076,
        hy: 59_076,
    };
    assert_eq!(
        parameterized_grid_line_endpoints(&x_grid, 20_300, drc_viewport, drc_die),
        Some((
            Point32 {
                x: 20_300,
                y: 23_796,
            },
            Point32 {
                x: 20_300,
                y: 59_076,
            },
        ))
    );
    assert_eq!(
        parameterized_grid_line_endpoints(&y_grid, 23_900, drc_viewport, drc_die),
        Some((
            Point32 { x: 0, y: 23_900 },
            Point32 {
                x: 35_574,
                y: 23_900,
            },
        ))
    );
}

#[test]
fn grid_reference_bounds_use_only_alive_die_shapes() {
    let owners = [
        OwnerRef {
            owner_type: OwnerType::Die as u8,
            ..OwnerRef::default()
        },
        OwnerRef {
            owner_type: OwnerType::InstanceBBox as u8,
            ..OwnerRef::default()
        },
    ];
    let shapes = [
        ShapeRecord {
            owner_index: 0,
            state: ShapeState::Alive as u8,
            bbox: Rect32 {
                lx: 0,
                ly: 0,
                hx: 100,
                hy: 100,
            },
            ..ShapeRecord::default()
        },
        ShapeRecord {
            owner_index: 1,
            state: ShapeState::Alive as u8,
            bbox: Rect32 {
                lx: -50,
                ly: -50,
                hx: 150,
                hy: 150,
            },
            ..ShapeRecord::default()
        },
        ShapeRecord {
            owner_index: 0,
            state: ShapeState::Deleted as u8,
            bbox: Rect32 {
                lx: -100,
                ly: -100,
                hx: 200,
                hy: 200,
            },
            ..ShapeRecord::default()
        },
    ];

    assert_eq!(
        grid_reference_bounds_from_records(&shapes, &owners),
        Some(Rect32 {
            lx: 0,
            ly: 0,
            hx: 100,
            hy: 100,
        })
    );
}

#[test]
fn parameterized_grid_indices_are_sampled_when_viewport_contains_many_lines() {
    let grid = GridMetadata {
        grid_type: "gcell".to_string(),
        direction: "x".to_string(),
        start: 0,
        step: 1,
        count: 10000,
        ..GridMetadata::default()
    };
    let indices = grid_visible_indices(
        &grid,
        Rect32 {
            lx: 0,
            ly: 0,
            hx: 9999,
            hy: 10,
        },
    );

    assert!(indices.len() <= MAX_PARAMETERIZED_GRID_LINES_PER_GRID);
    assert_eq!(indices.first(), Some(&0));
    assert!(indices.last().is_some_and(|index| *index <= 9999));
}

#[test]
fn parameterized_grid_visibility_respects_zoom_category_and_layers() {
    let mut layers = vec![layer_state(1, false), layer_state(2, true)];
    layers[0].name = "M1".to_string();
    layers[1].name = "M2".to_string();
    let mut grid_visibility = ObjectVisibility::default();
    grid_visibility.set_category_visible(DrawingCategory::Tracks, true);
    let grid = GridMetadata {
        grid_type: "track".to_string(),
        direction: "x".to_string(),
        start: 0,
        step: 100,
        count: 4,
        layer_names: vec!["M1".to_string()],
        ..GridMetadata::default()
    };

    assert!(!parameterized_grid_is_visible(
        &grid,
        &layers,
        grid_visibility,
        2.0
    ));
    layers[0].visible = true;
    assert!(parameterized_grid_is_visible(
        &grid,
        &layers,
        grid_visibility,
        2.0
    ));
    assert!(!parameterized_grid_is_visible(
        &grid,
        &layers,
        grid_visibility,
        1.0
    ));

    let mut hidden_guides = grid_visibility;
    hidden_guides.set_category_visible(DrawingCategory::Tracks, false);
    assert!(!parameterized_grid_is_visible(
        &grid,
        &layers,
        hidden_guides,
        2.0
    ));
}

#[test]
fn unrouted_net_guides_reuse_net_category_visibility_without_layer_filters() {
    let guide = UnroutedNetGuide {
        net_name: "clk".to_string(),
        net_kind: "clock".to_string(),
        hub: Point32 { x: 50, y: 50 },
        pin_centers: vec![Point32 { x: 10, y: 10 }, Point32 { x: 90, y: 90 }],
        bbox: Rect32 {
            lx: 10,
            ly: 10,
            hx: 90,
            hy: 90,
        },
    };
    let viewport = Rect32 {
        lx: 0,
        ly: 0,
        hx: 100,
        hy: 100,
    };
    let mut visibility = ObjectVisibility::default();

    assert!(!unrouted_net_guide_is_visible(&guide, visibility, viewport));

    visibility.set_category_visible(DrawingCategory::NetClock, true);

    assert!(unrouted_net_guide_is_visible(&guide, visibility, viewport));
}

#[test]
fn dashed_line_segment_count_matches_segment_iterator() {
    for length in [
        0.0, 0.4, 0.5, 0.6, 1.0, 7.0, 8.0, 13.0, 13.1, 100.0, 10_000.0,
    ] {
        let begin = egui::pos2(10.0, 20.0);
        let end = egui::pos2(10.0 + length, 20.0);
        assert_eq!(
            dashed_line_segment_count(begin, end, 8.0, 5.0),
            dashed_line_segments(begin, end, 8.0, 5.0).len(),
            "length {length}"
        );
    }
}

fn flyline_test_guide(hub: Point32, pin_offsets: &[Point32], bbox: Rect32) -> UnroutedNetGuide {
    UnroutedNetGuide {
        net_name: "n".to_string(),
        net_kind: "signal".to_string(),
        hub,
        pin_centers: pin_offsets
            .iter()
            .map(|offset| Point32 {
                x: hub.x + offset.x,
                y: hub.y + offset.y,
            })
            .collect(),
        bbox,
    }
}

fn flyline_test_world() -> (Rect32, egui::Rect) {
    (
        Rect32 {
            lx: 0,
            ly: 0,
            hx: 1_000_000,
            hy: 1_000_000,
        },
        egui::Rect::from_min_max(egui::pos2(0.0, 0.0), egui::pos2(1000.0, 800.0)),
    )
}

fn flyline_selection(
    guides: &[UnroutedNetGuide],
    viewport: Rect32,
    world: Rect32,
    canvas: egui::Rect,
) -> Vec<(usize, usize)> {
    let mut visibility = ObjectVisibility::default();
    visibility.net_signal = true;
    select_unrouted_net_guide_lines(
        guides,
        visibility,
        viewport,
        world,
        canvas,
        1.0,
        egui::Vec2::ZERO,
    )
}

#[test]
fn flyline_selection_skips_guides_below_min_screen_span() {
    let (world, canvas) = flyline_test_world();
    let viewport = world;
    let hub = Point32 {
        x: 500_000,
        y: 500_000,
    };
    // A 200 dbu bounding box is far below 6 px on a 1000 px canvas.
    let tiny = flyline_test_guide(
        hub,
        &[Point32 { x: 100, y: 100 }],
        Rect32 {
            lx: hub.x - 100,
            ly: hub.y - 100,
            hx: hub.x + 100,
            hy: hub.y + 100,
        },
    );
    assert!(flyline_selection(&[tiny], viewport, world, canvas).is_empty());
}

#[test]
fn flyline_selection_strides_lines_over_budget() {
    let (world, canvas) = flyline_test_world();
    let viewport = world;
    let mut guides = Vec::new();
    for g in 0..60 {
        let hub = Point32 {
            x: 50_000 + g * 10_000,
            y: 500_000,
        };
        // Pins a few dbu from the hub: lines are visible on canvas but
        // produce zero-length segments, keeping the segment budget out of
        // play so the line stride is what gets exercised.
        let offsets: Vec<Point32> = (0..1000).map(|i| Point32 { x: i % 7, y: i % 5 }).collect();
        guides.push(flyline_test_guide(
            hub,
            &offsets,
            Rect32 {
                lx: hub.x - 5_000,
                ly: hub.y - 5_000,
                hx: hub.x + 5_000,
                hy: hub.y + 5_000,
            },
        ));
    }
    let selected = flyline_selection(&guides, viewport, world, canvas);
    assert_eq!(selected.len(), 30_000);
    assert!(selected.len() <= FLYLINE_MAX_LINES_PER_FRAME);
}

#[test]
fn flyline_selection_caps_total_segments() {
    let (world, canvas) = flyline_test_world();
    let viewport = world;
    let hub = Point32 {
        x: 500_000,
        y: 500_000,
    };
    // 10000 pins spread across the full die: lines average hundreds of
    // screen pixels (~25+ segments each, ~250K total), so the segment
    // budget binds even though the line count is far below the line cap.
    let offsets: Vec<Point32> = (0..10_000)
        .map(|i| Point32 {
            x: -500_000 + i * 100,
            y: -500_000 + i * 100,
        })
        .collect();
    let guides = [flyline_test_guide(
        hub,
        &offsets,
        Rect32 {
            lx: 0,
            ly: 0,
            hx: 1_000_000,
            hy: 1_000_000,
        },
    )];
    let selected = flyline_selection(&guides, viewport, world, canvas);
    assert!(selected.len() < 10_000);
    let mut segment_total = 0usize;
    for (guide_index, pin_index) in &selected {
        let guide = &guides[*guide_index];
        let begin = world_to_screen_point(guide.hub, world, canvas, 1.0, egui::Vec2::ZERO);
        let end = world_to_screen_point(
            guide.pin_centers[*pin_index],
            world,
            canvas,
            1.0,
            egui::Vec2::ZERO,
        );
        segment_total += dashed_line_segment_count(begin, end, 8.0, 5.0);
    }
    assert!(segment_total <= FLYLINE_MAX_SEGMENTS_PER_FRAME);
}

#[test]
fn drawing_category_counts_includes_unrouted_net_guides() {
    let dir = temp_snapshot_dir("drawing-counts-unrouted");
    write_empty_snapshot(&dir, false);
    let db = ChipViewDb::open(dir.join("geometry.manifest")).unwrap();
    let guides = db.unrouted_net_guides();
    let counts = drawing_category_counts(&db, guides);
    assert_eq!(
        counts
            .get(&DrawingCategory::NetSignal)
            .copied()
            .unwrap_or(0),
        0
    );
    let _ = fs::remove_dir_all(&dir);
}

#[test]
fn filler_instance_detection_matches_standard_asic_filler_cells() {
    // icsprout55-pdk standard cell fillers & caps
    assert!(is_filler_instance(Some("inst_fill"), Some("FILLER1H7H")));
    assert!(is_filler_instance(Some("inst_fill"), Some("FILLER2H7H")));
    assert!(is_filler_instance(Some("inst_fill"), Some("FILLER4H7H")));
    assert!(is_filler_instance(Some("inst_fill"), Some("FILLER8H7H")));
    assert!(is_filler_instance(Some("inst_fill"), Some("FILLER16H7H")));
    assert!(is_filler_instance(Some("inst_fill"), Some("FILLER32H7H")));
    assert!(is_filler_instance(Some("inst_fill"), Some("FILLER64H7H")));
    assert!(is_filler_instance(Some("inst_fill"), Some("FILLER1H7L")));
    assert!(is_filler_instance(Some("inst_fill"), Some("FILLER16H7R")));
    assert!(is_filler_instance(Some("inst_cap"), Some("FILLCAP4H7H")));
    assert!(is_filler_instance(Some("inst_cap"), Some("FILLCAP8H7H")));
    assert!(is_filler_instance(Some("inst_cap"), Some("FILLCAP16H7H")));
    assert!(is_filler_instance(Some("inst_cap"), Some("FILLCAP32H7H")));
    assert!(is_filler_instance(Some("inst_tap"), Some("FILLTAPH7H")));
    assert!(is_filler_instance(Some("inst_tap"), Some("FILLTAPH7L")));
    assert!(is_filler_instance(Some("inst_tap"), Some("FILLTAPH7R")));

    // icsprout55-pdk IO fillers
    assert!(is_filler_instance(
        Some("io_fill"),
        Some("P65_1233_FILLER0005")
    ));
    assert!(is_filler_instance(
        Some("io_fill"),
        Some("P65_1233_FILLER001")
    ));
    assert!(is_filler_instance(
        Some("io_fill"),
        Some("P65_1233_FILLER01")
    ));
    assert!(is_filler_instance(
        Some("io_fill"),
        Some("P65_1233_FILLER1")
    ));
    assert!(is_filler_instance(
        Some("io_fill"),
        Some("P65_1233_FILLER10")
    ));
    assert!(is_filler_instance(
        Some("io_fill"),
        Some("P65_1233_FILLER50")
    ));

    // Instance name matches
    assert!(is_filler_instance(Some("FILLER_0_0"), None));
    assert!(is_filler_instance(Some("fill_123"), None));
    assert!(is_filler_instance(Some("PHY_EDGE_0"), None));
    assert!(is_filler_instance(Some("PHY_TAP_1"), None));

    // Logic instances should NOT match
    assert!(!is_filler_instance(Some("_042_"), Some("AND2X1H7H")));
    assert!(!is_filler_instance(Some("u_dff"), Some("SDFFQX1H7H")));
    assert!(!is_filler_instance(Some("clk_buf"), Some("BUFX4H7H")));
    assert!(!is_filler_instance(Some("inv_1"), Some("INVX1H7H")));
    assert!(!is_filler_instance(Some("core_inst"), Some("alu_top")));
}

#[test]
fn dashed_line_segments_split_screen_line_into_dashes() {
    let segments = dashed_line_segments(egui::pos2(0.0, 0.0), egui::pos2(30.0, 0.0), 8.0, 4.0);

    assert_eq!(segments.len(), 3);
    assert_eq!(segments[0], (egui::pos2(0.0, 0.0), egui::pos2(8.0, 0.0)));
    assert_eq!(segments[2], (egui::pos2(24.0, 0.0), egui::pos2(30.0, 0.0)));
    assert!(dashed_line_segments(egui::pos2(1.0, 1.0), egui::pos2(1.0, 1.0), 8.0, 4.0).is_empty());
}

#[test]
fn parameterized_grid_stroke_uses_linked_layer_color() {
    let mut layers = vec![layer_state(1, true), layer_state(2, true)];
    layers[0].name = "M1".to_string();
    layers[0].style.rgba = [17, 34, 51, 44];
    layers[1].name = "M2".to_string();
    layers[1].style.rgba = [90, 80, 70, 44];
    let grid = GridMetadata {
        grid_type: "track".to_string(),
        layer_names: vec!["M2".to_string()],
        ..GridMetadata::default()
    };

    let track_stroke = parameterized_grid_stroke(&grid, &layers, OwnerType::TrackGrid);
    assert_eq!(track_stroke.width, 1.0);
    assert_eq!(
        track_stroke.color,
        egui::Color32::from_rgba_unmultiplied(90, 80, 70, 82)
    );

    let gcell_stroke = parameterized_grid_stroke(&grid, &layers, OwnerType::GCellGrid);
    assert_eq!(gcell_stroke.width, 2.0);
    assert_eq!(
        gcell_stroke.color,
        egui::Color32::from_rgba_unmultiplied(90, 80, 70, 104)
    );
}

#[test]
fn unbound_parameterized_grids_use_transparent_gray_layout_color() {
    let grid = GridMetadata::default();

    let track_stroke = parameterized_grid_stroke(&grid, &[], OwnerType::TrackGrid);
    assert_eq!(track_stroke.width, 1.0);
    assert_eq!(
        track_stroke.color,
        egui::Color32::from_rgba_unmultiplied(148, 148, 148, 82)
    );

    let gcell_stroke = parameterized_grid_stroke(&grid, &[], OwnerType::GCellGrid);
    assert_eq!(gcell_stroke.width, 2.0);
    assert_eq!(
        gcell_stroke.color,
        egui::Color32::from_rgba_unmultiplied(148, 148, 148, 104)
    );
}

#[test]
fn layer_visibility_helpers_show_hide_and_invert_layers() {
    let mut layers = vec![
        layer_state(1, true),
        layer_state(2, false),
        layer_state(3, true),
    ];

    set_layer_visibility(&mut layers, false);
    assert_eq!(layer_visibility(&layers), vec![false, false, false]);

    set_layer_visibility(&mut layers, true);
    assert_eq!(layer_visibility(&layers), vec![true, true, true]);

    invert_layer_visibility(&mut layers);
    assert_eq!(layer_visibility(&layers), vec![false, false, false]);
}

#[test]
fn visible_layer_count_counts_only_enabled_layers() {
    let layers = vec![
        layer_state(1, true),
        layer_state(2, false),
        layer_state(3, true),
    ];

    assert_eq!(visible_layer_count(&layers), 2);
}

#[test]
fn layer_hover_text_includes_rule_metadata_when_available() {
    let mut layer = layer_state(4, true);
    layer.name = "M4".to_string();
    layer.layer_type = "routing".to_string();
    layer.display_role = "metal".to_string();
    layer.direction = "vertical".to_string();
    layer.width = 100;
    layer.pitch_x = 200;
    layer.pitch_y = 300;
    layer.min_spacing = 70;
    layer.min_area = 400;
    layer.min_step = 50;
    layer.cut_spacing = 80;
    layer.enclosure_below = "1,2".to_string();
    layer.enclosure_above = "3,4".to_string();
    layer.lef58_rule_count = 5;

    assert_eq!(
            layer_hover_text(&layer),
            "id: 4\norder: 4\ntype: routing\nstyle role: metal\ndirection: vertical\nwidth: 100\npitch: 200 300\nmin spacing: 70\nmin area: 400\nmin step: 50\ncut spacing: 80\nenclosure below: 1,2\nenclosure above: 3,4\nLEF58 rules: 5"
        );
}

#[test]
fn visible_layer_ids_for_render_query_are_sorted_from_visible_layer_map() {
    let visible_layers = BTreeMap::from([
        (
            7,
            LayerStyle::default_for_layer(7, chip_display::ColorTheme::Vivid),
        ),
        (
            3,
            LayerStyle::default_for_layer(3, chip_display::ColorTheme::Vivid),
        ),
    ]);

    assert_eq!(visible_layer_ids(&visible_layers), vec![3, 7]);
}

#[test]
fn visible_style_for_shape_skips_shapes_from_invisible_layers() {
    let visible_layers = BTreeMap::from([(
        3,
        LayerStyle::default_for_layer(3, chip_display::ColorTheme::Vivid),
    )]);
    let all_layers = BTreeMap::from([
        (
            3,
            LayerStyle::default_for_layer(3, chip_display::ColorTheme::Vivid),
        ),
        (
            4,
            LayerStyle::default_for_layer(4, chip_display::ColorTheme::Vivid),
        ),
    ]);
    let visible_shape = chipgeom_format::ShapeRecord {
        layer_id: 3,
        ..chipgeom_format::ShapeRecord::default()
    };
    let hidden_shape = chipgeom_format::ShapeRecord {
        layer_id: 4,
        ..chipgeom_format::ShapeRecord::default()
    };
    let hidden_instance = OwnerRef {
        owner_type: OwnerType::InstanceBBox as u8,
        ..OwnerRef::default()
    };

    assert!(visible_style_for_shape(&visible_shape, None, &visible_layers, &all_layers).is_some());
    assert!(visible_style_for_shape(&hidden_shape, None, &visible_layers, &all_layers).is_none());
    assert!(visible_style_for_shape(
        &hidden_shape,
        Some(&hidden_instance),
        &visible_layers,
        &all_layers
    )
    .is_some());
}

#[test]
fn render_query_layers_keep_layout_layer_for_layout_level_owner_categories() {
    let mut layers = vec![
        layer_state(0, false),
        layer_state(7, true),
        layer_state(8, false),
    ];

    assert_eq!(
        render_query_layer_ids(&layers, ObjectVisibility::default()),
        vec![0, 7]
    );

    let mut visibility = ObjectVisibility::default();
    visibility.instances.set_all(false);
    visibility.set_category_visible(DrawingCategory::Boundaries, false);
    visibility.set_category_visible(DrawingCategory::Placement, false);
    visibility.set_category_visible(DrawingCategory::Regions, false);
    visibility.set_category_visible(DrawingCategory::Fill, false);
    assert_eq!(render_query_layer_ids(&layers, visibility), vec![7]);

    layers[0].visible = true;
    assert_eq!(render_query_layer_ids(&layers, visibility), vec![0, 7]);

    let idb_only_layers = vec![layer_state(7, true), layer_state(8, false)];
    assert_eq!(
        render_query_layer_ids(&idb_only_layers, ObjectVisibility::default()),
        vec![0, 7]
    );

    for category in [
        DrawingCategory::Tracks,
        DrawingCategory::GCells,
        DrawingCategory::Obstructions,
        DrawingCategory::Regions,
    ] {
        let mut visibility = ObjectVisibility::default();
        visibility.set_all_visible(false);
        visibility.set_category_visible(category, true);
        assert_eq!(
            render_query_layer_ids(&idb_only_layers, visibility),
            vec![0, 7]
        );
    }
}

#[test]
fn pan_drag_applies_frame_delta() {
    let mut drag = PanDragState::default();
    drag.start(CanvasDragMode::Pan);
    let pan = drag.apply_pan_frame(egui::Vec2::ZERO, egui::vec2(10.0, 2.0));
    assert_eq!(pan, egui::vec2(10.0, 2.0));

    let pan = drag.apply_pan_frame(pan, egui::vec2(8.0, -3.0));

    assert_eq!(pan, egui::vec2(18.0, -1.0));
}

#[test]
fn edit_drag_accumulates_frame_deltas() {
    let mut drag = PanDragState::default();
    drag.start(CanvasDragMode::Edit);

    assert_eq!(
        drag.accumulate(egui::vec2(10.0, 2.0)),
        egui::vec2(10.0, 2.0)
    );
    assert_eq!(
        drag.accumulate(egui::vec2(8.0, -3.0)),
        egui::vec2(18.0, -1.0)
    );
}

#[test]
fn pan_drag_state_resets_between_gestures() {
    let mut drag = PanDragState::default();
    drag.start(CanvasDragMode::Edit);
    assert_eq!(
        drag.accumulate(egui::vec2(10.0, 0.0)),
        egui::vec2(10.0, 0.0)
    );
    drag.reset();

    assert_eq!(drag.mode(), None);
    drag.start(CanvasDragMode::Edit);
    assert_eq!(drag.accumulate(egui::vec2(4.0, 0.0)), egui::vec2(4.0, 0.0));
}

#[test]
fn pending_edit_polling_requests_periodic_repaint() {
    assert_eq!(
        edit_poll_repaint_interval(true),
        Some(std::time::Duration::from_millis(100))
    );
    assert_eq!(edit_poll_repaint_interval(false), None);
}

#[test]
fn pending_edit_or_session_action_blocks_a_new_edit_command() {
    assert!(can_start_edit_command(false, false, false));
    assert!(!can_start_edit_command(true, false, false));
    assert!(!can_start_edit_command(false, true, false));
    assert!(!can_start_edit_command(false, false, true));
}

#[test]
fn snapshot_file_signature_does_not_change_for_identical_file_state() {
    let dir = std::env::temp_dir().join(format!(
        "chip-viewer-native-signature-same-{}",
        std::process::id()
    ));
    let _ = fs::remove_dir_all(&dir);
    fs::create_dir_all(&dir).unwrap();
    let path = dir.join("geometry.manifest");

    fs::write(&path, b"manifest").unwrap();
    let previous = snapshot_file_signature(vec![path.clone()]);
    let current = snapshot_file_signature(vec![path.clone()]);

    assert!(!snapshot_file_signature_changed(&previous, &current));

    let _ = fs::remove_dir_all(&dir);
}

#[test]
fn snapshot_file_signature_detects_binary_file_size_changes() {
    let dir = std::env::temp_dir().join(format!(
        "chip-viewer-native-signature-size-{}",
        std::process::id()
    ));
    let _ = fs::remove_dir_all(&dir);
    fs::create_dir_all(&dir).unwrap();
    let path = dir.join("geometry.shapes.bin");

    fs::write(&path, b"a").unwrap();
    let previous = snapshot_file_signature(vec![path.clone()]);
    fs::write(&path, b"abcdef").unwrap();
    let current = snapshot_file_signature(vec![path.clone()]);

    assert!(snapshot_file_signature_changed(&previous, &current));

    let _ = fs::remove_dir_all(&dir);
}

#[test]
fn snapshot_file_signature_detects_missing_file_becoming_available() {
    let dir = std::env::temp_dir().join(format!(
        "chip-viewer-native-signature-missing-{}",
        std::process::id()
    ));
    let _ = fs::remove_dir_all(&dir);
    fs::create_dir_all(&dir).unwrap();
    let path = dir.join("geometry.delta.bin");

    let previous = snapshot_file_signature(vec![path.clone()]);
    fs::write(&path, b"delta").unwrap();
    let current = snapshot_file_signature(vec![path.clone()]);

    assert!(snapshot_file_signature_changed(&previous, &current));

    let _ = fs::remove_dir_all(&dir);
}

#[test]
fn external_snapshot_refresh_records_reopened_manifest_file_set() {
    let dir = temp_snapshot_dir("external-refresh-new-delta");
    write_empty_snapshot(&dir, false);
    let db = ChipViewDb::open(dir.join("geometry.manifest")).unwrap();
    let mut loaded = LoadedViewer::new(
        chip_display::ColorTheme::Vivid,
        db,
        false,
        false,
        None,
        None,
        None,
        analysis_loader::AnalysisPaths::default(),
        wgpu::TextureFormat::Bgra8Unorm,
        crate::RenderMode::Gpu,
    );
    let delta_path = dir.join("geometry.delta.bin");

    assert!(!loaded.snapshot_signature.files.contains_key(&delta_path));

    write_empty_geometry_file(
        &delta_path,
        chipgeom_format::GeometryFileKind::Delta,
        core::mem::size_of::<chipgeom_format::GeometryDeltaRecord>() as u32,
        &[],
    );
    write_manifest(&dir, true);
    loaded.next_snapshot_refresh_check = Instant::now() - Duration::from_secs(1);

    loaded.poll_external_snapshot_refresh();
    assert!(loaded.pending_reload.is_some());
    while loaded.pending_reload.is_some() {
        loaded.poll_reload();
        std::thread::sleep(Duration::from_millis(10));
    }

    assert!(loaded.db.snapshot().manifest().delta.is_some());
    assert!(loaded.snapshot_signature.files.contains_key(&delta_path));

    let _ = fs::remove_dir_all(&dir);
}

#[test]
fn reload_while_reload_in_flight_is_rejected() {
    let dir = temp_snapshot_dir("reload-in-flight-rejected");
    write_empty_snapshot(&dir, false);
    let db = ChipViewDb::open(dir.join("geometry.manifest")).unwrap();
    let mut loaded = LoadedViewer::new(
        chip_display::ColorTheme::Vivid,
        db,
        false,
        false,
        None,
        None,
        None,
        analysis_loader::AnalysisPaths::default(),
        wgpu::TextureFormat::Bgra8Unorm,
        crate::RenderMode::Gpu,
    );

    let first = loaded.reload_snapshot(ReloadCompletion::notify("reloaded", "failed"));
    assert!(first.is_ok());
    let second = loaded.reload_snapshot(ReloadCompletion::notify("reloaded", "failed"));
    assert!(second.is_err());
    assert_eq!(
        second.unwrap_err(),
        "geometry reload already in progress".to_string()
    );
    while loaded.pending_reload.is_some() {
        loaded.poll_reload();
        std::thread::sleep(Duration::from_millis(10));
    }

    let _ = fs::remove_dir_all(&dir);
}

#[test]
fn failed_reload_keeps_existing_database() {
    let dir = temp_snapshot_dir("failed-reload-keeps-db");
    write_empty_snapshot(&dir, false);
    let db = ChipViewDb::open(dir.join("geometry.manifest")).unwrap();
    let mut loaded = LoadedViewer::new(
        chip_display::ColorTheme::Vivid,
        db,
        false,
        false,
        None,
        None,
        None,
        analysis_loader::AnalysisPaths::default(),
        wgpu::TextureFormat::Bgra8Unorm,
        crate::RenderMode::Gpu,
    );
    let original_manifest = loaded.db.snapshot().manifest().path.clone();
    fs::remove_file(&original_manifest).unwrap();

    loaded
        .reload_snapshot(ReloadCompletion::notify(
            "geometry snapshot reloaded",
            "failed to reload geometry",
        ))
        .unwrap();
    while loaded.pending_reload.is_some() {
        loaded.poll_reload();
        std::thread::sleep(Duration::from_millis(10));
    }

    assert!(loaded.pending_reload.is_none());
    assert!(loaded
        .last_edit_result
        .as_deref()
        .is_some_and(|message| message.starts_with("failed to reload geometry")));
    assert_eq!(loaded.db.snapshot().manifest().path, original_manifest);

    let _ = fs::remove_dir_all(&dir);
}

#[test]
fn restored_edit_session_starts_dirty() {
    let dir = temp_snapshot_dir("restored-edit-session-dirty");
    write_empty_snapshot(&dir, false);
    let db = ChipViewDb::open(dir.join("geometry.manifest")).unwrap();
    let loaded = LoadedViewer::new(
        chip_display::ColorTheme::Vivid,
        db,
        true,
        true,
        None,
        None,
        None,
        analysis_loader::AnalysisPaths::default(),
        wgpu::TextureFormat::Bgra8Unorm,
        crate::RenderMode::Gpu,
    );

    assert!(loaded.session_dirty);

    let _ = fs::remove_dir_all(&dir);
}

#[test]
fn stopping_a_session_action_wait_restores_the_close_dialog() {
    let (dir, mut loaded) = close_test_loaded_viewer("stop-session-action-wait");
    loaded.pending_session_action = Some(PendingSessionAction {
        action: SessionActionKind::Discard,
        command_id: 41,
        queued_at: Instant::now(),
        progress_path: dir.join("control-progress-discard-41.json"),
        result_path: dir.join("control-result-discard-41.json"),
    });
    loaded.session_action_progress = Some(SessionActionProgress::new(
        SessionActionKind::Discard,
        41,
        SessionActionProgressPhase::Queued,
        0,
        "Waiting for ECOS Studio",
    ));
    loaded.close_confirmation_visible = true;
    loaded.close_after_session_action = true;

    loaded.stop_waiting_for_session_action();

    assert!(loaded.pending_session_action.is_none());
    assert!(loaded.session_action_progress.is_none());
    assert!(loaded.close_confirmation_visible);
    assert!(!loaded.close_after_session_action);
    assert!(!loaded.close_without_session_action);
    assert!(loaded.session_dirty);
    assert!(loaded.should_intercept_unsaved_close());
    assert!(loaded
        .last_edit_result
        .as_deref()
        .is_some_and(|message| message.contains("Stopped waiting")));

    let _ = fs::remove_dir_all(dir);
}

#[test]
fn closing_without_session_action_bypasses_an_unavailable_host() {
    let (dir, mut loaded) = close_test_loaded_viewer("close-without-session-action");
    loaded.pending_session_action = Some(PendingSessionAction {
        action: SessionActionKind::Discard,
        command_id: 42,
        queued_at: Instant::now(),
        progress_path: dir.join("control-progress-discard-42.json"),
        result_path: dir.join("control-result-discard-42.json"),
    });
    loaded.session_action_progress = Some(SessionActionProgress::new(
        SessionActionKind::Discard,
        42,
        SessionActionProgressPhase::Failed,
        100,
        "ECOS Studio did not respond",
    ));
    loaded.close_confirmation_visible = true;
    loaded.close_after_session_action = true;

    loaded.prepare_close_without_session_action();

    assert!(loaded.pending_session_action.is_none());
    assert!(loaded.session_action_progress.is_none());
    assert!(!loaded.close_confirmation_visible);
    assert!(!loaded.close_after_session_action);
    assert!(loaded.close_without_session_action);
    assert!(loaded.session_dirty);
    assert!(!loaded.should_intercept_unsaved_close());

    let _ = fs::remove_dir_all(dir);
}

#[test]
fn session_action_recovery_actions_match_wait_and_failure_states() {
    assert_eq!(
        session_action_recovery_actions(SessionActionProgressPhase::Queued, true),
        SessionActionRecoveryActions {
            can_stop_waiting: true,
            can_close_without_saving: false,
        }
    );
    assert_eq!(
        session_action_recovery_actions(SessionActionProgressPhase::Failed, true),
        SessionActionRecoveryActions {
            can_stop_waiting: false,
            can_close_without_saving: true,
        }
    );
    assert_eq!(
        session_action_recovery_actions(SessionActionProgressPhase::Completed, true),
        SessionActionRecoveryActions {
            can_stop_waiting: false,
            can_close_without_saving: false,
        }
    );
    assert_eq!(
        session_action_recovery_actions(SessionActionProgressPhase::Failed, false),
        SessionActionRecoveryActions {
            can_stop_waiting: false,
            can_close_without_saving: false,
        }
    );
}

#[test]
fn loaded_viewer_falls_back_to_cpu_when_wgpu_unavailable() {
    let dir = temp_snapshot_dir("cpu-fallback-test");
    write_empty_snapshot(&dir, false);
    let db = ChipViewDb::open(dir.join("geometry.manifest")).unwrap();
    let loaded = LoadedViewer::new(
        chip_display::ColorTheme::Vivid,
        db,
        false,
        false,
        None,
        None,
        None,
        analysis_loader::AnalysisPaths::default(),
        wgpu::TextureFormat::Bgra8Unorm,
        crate::RenderMode::EguiOnly,
    );

    assert!(loaded.gpu_canvas.is_none());
    assert!(!loaded.is_gpu_active());

    let _ = fs::remove_dir_all(&dir);
}

#[test]
fn instance_move_allows_only_instance_bounding_boxes() {
    assert!(instance_move_is_allowed(
        chipgeom_format::OwnerType::InstanceBBox as u8
    ));
    assert!(!instance_move_is_allowed(
        chipgeom_format::OwnerType::NetWireSegment as u8
    ));
    assert!(!instance_move_is_allowed(
        chipgeom_format::OwnerType::PinPortShape as u8
    ));
}

#[test]
fn editable_instance_hit_ignores_overlapping_non_instance_shapes() {
    let point = Point32 { x: 15, y: 15 };
    let instance = ShapeRecord {
        id: 10,
        kind: ShapeKind::Rect as u8,
        state: ShapeState::Alive as u8,
        bbox: Rect32 {
            lx: 0,
            ly: 0,
            hx: 30,
            hy: 30,
        },
        ..ShapeRecord::default()
    };
    let wire = ShapeRecord {
        id: 99,
        kind: ShapeKind::Rect as u8,
        state: ShapeState::Alive as u8,
        bbox: instance.bbox,
        ..ShapeRecord::default()
    };
    let instance_owner = OwnerRef {
        owner_type: OwnerType::InstanceBBox as u8,
        ..OwnerRef::default()
    };
    let wire_owner = OwnerRef {
        owner_type: OwnerType::NetWireSegment as u8,
        ..OwnerRef::default()
    };

    assert_eq!(
        pick_top_editable_instance_bbox(
            [(&instance, &instance_owner), (&wire, &wire_owner)],
            point,
            0,
        ),
        Some(instance.id)
    );
}

#[test]
fn editable_instance_hit_uses_topmost_overlapping_instance_bbox() {
    let point = Point32 { x: 15, y: 15 };
    let lower_instance = ShapeRecord {
        id: 20,
        kind: ShapeKind::Rect as u8,
        state: ShapeState::Alive as u8,
        bbox: Rect32 {
            lx: 0,
            ly: 0,
            hx: 30,
            hy: 30,
        },
        ..ShapeRecord::default()
    };
    let upper_instance = ShapeRecord {
        id: 10,
        bbox: lower_instance.bbox,
        ..lower_instance
    };
    let instance_owner = OwnerRef {
        owner_type: OwnerType::InstanceBBox as u8,
        ..OwnerRef::default()
    };

    assert_eq!(
        pick_top_editable_instance_bbox(
            [
                (&lower_instance, &instance_owner),
                (&upper_instance, &instance_owner)
            ],
            point,
            0,
        ),
        Some(upper_instance.id)
    );
}

#[test]
fn editable_instance_hit_accepts_near_miss_within_tolerance() {
    let instance = ShapeRecord {
        id: 7,
        kind: ShapeKind::Rect as u8,
        state: ShapeState::Alive as u8,
        bbox: Rect32 {
            lx: 0,
            ly: 0,
            hx: 30,
            hy: 30,
        },
        ..ShapeRecord::default()
    };
    let instance_owner = OwnerRef {
        owner_type: OwnerType::InstanceBBox as u8,
        ..OwnerRef::default()
    };
    // A click just outside the bbox selects the macro only when the
    // zoom-derived tolerance reaches it, and stays a miss otherwise.
    let near_point = Point32 { x: 35, y: 15 };
    assert_eq!(
        pick_top_editable_instance_bbox([(&instance, &instance_owner)], near_point, 4),
        None
    );
    assert_eq!(
        pick_top_editable_instance_bbox([(&instance, &instance_owner)], near_point, 5),
        Some(instance.id)
    );
    // Exact containment still wins over a nearer near-miss.
    let other = ShapeRecord {
        id: 8,
        bbox: Rect32 {
            lx: 32,
            ly: 0,
            hx: 60,
            hy: 30,
        },
        ..instance
    };
    let inside_point = Point32 { x: 15, y: 15 };
    assert_eq!(
        pick_top_editable_instance_bbox(
            [(&other, &instance_owner), (&instance, &instance_owner)],
            inside_point,
            20,
        ),
        Some(instance.id)
    );
}

#[test]
fn edit_capability_lines_report_supported_tools_and_read_only_reasons() {
    let shape = chipgeom_format::ShapeRecord {
        kind: ShapeKind::Rect as u8,
        state: ShapeState::Alive as u8,
        ..chipgeom_format::ShapeRecord::default()
    };
    let instance_owner = OwnerRef {
        owner_type: OwnerType::InstanceBBox as u8,
        ..OwnerRef::default()
    };
    let net_owner = OwnerRef {
        owner_type: OwnerType::NetWireSegment as u8,
        ..OwnerRef::default()
    };
    let pin_owner = OwnerRef {
        owner_type: OwnerType::PinPortShape as u8,
        ..OwnerRef::default()
    };

    assert_eq!(
        edit_capability_lines(&shape, Some(&instance_owner), false),
        vec!["edit: view-only session".to_string()]
    );
    assert_eq!(
        edit_capability_lines(&shape, Some(&instance_owner), true),
        vec![
            "edit: move".to_string(),
            "edit note: instance resize is rejected; move preserves master size".to_string(),
        ]
    );
    assert_eq!(
        edit_capability_lines(&shape, Some(&net_owner), true),
        vec!["edit: read-only, net_wire_segment is not editable".to_string()]
    );
    assert_eq!(
        edit_capability_lines(&shape, Some(&pin_owner), true),
        vec!["edit: read-only, pin_port_shape is not editable".to_string()]
    );
}

#[test]
fn edit_result_action_reloads_for_accepted_adjusted_and_conflict() {
    let accepted = edit_result_action(&edit_result(GeometryEditStatus::Accepted));
    let adjusted = edit_result_action(&edit_result(GeometryEditStatus::AdjustedAccepted));
    let conflict = edit_result_action(&edit_result(GeometryEditStatus::Conflict));

    assert!(accepted.reload_snapshot);
    assert!(adjusted.reload_snapshot);
    assert!(conflict.reload_snapshot);
    assert!(conflict.message.contains("retry"));
    assert_eq!(conflict.selected_shape_id, Some(7));
}

#[test]
fn edit_result_action_does_not_reload_for_rejected() {
    let rejected = edit_result_action(&edit_result(GeometryEditStatus::Rejected));

    assert!(!rejected.reload_snapshot);
    assert!(rejected.message.contains("rejected"));
    assert!(rejected.message.contains("restored"));
    assert_eq!(rejected.selected_shape_id, Some(7));
}

#[test]
fn edit_result_action_includes_diagnostic_message() {
    let mut result = edit_result(GeometryEditStatus::Rejected);
    result.message = Some("apply-edit failed".to_string());

    let rejected = edit_result_action(&result);

    assert!(rejected.message.contains("apply-edit failed"));
}

#[test]
fn edit_result_action_distinguishes_source_version_from_staging_revision() {
    let mut result = edit_result(GeometryEditStatus::Accepted);
    result.source_version = Some(2);
    result.staging_revision = Some(9);

    let accepted = edit_result_action(&result);

    assert_eq!(
        accepted.message,
        "edit accepted: shape 7 source version 2 staging revision 9"
    );

    result.shape_id = 0;
    let staged = edit_result_action(&result);
    assert_eq!(
        staged.message,
        "edit accepted: staged macro source version 2 staging revision 9"
    );
}

#[test]
fn geometry_edit_result_deserializes_staging_metadata() {
    let result: GeometryEditResult = serde_json::from_str(
        r#"{
                "command_id": 11,
                "shape_id": 7,
                "new_version": 3,
                "source_version": 3,
                "staging_revision": 5,
                "status": "accepted",
                "committed_bbox": {"lx": 0, "ly": 0, "hx": 10, "hy": 10}
            }"#,
    )
    .expect("geometry edit result with staging metadata");

    assert_eq!(result.source_version, Some(3));
    assert_eq!(result.staging_revision, Some(5));

    let legacy: GeometryEditResult = serde_json::from_str(
        r#"{
                "command_id": 11,
                "shape_id": 7,
                "new_version": 3,
                "status": "accepted",
                "committed_bbox": {"lx": 0, "ly": 0, "hx": 10, "hy": 10}
            }"#,
    )
    .expect("geometry edit result without staging metadata");

    assert_eq!(legacy.source_version, None);
    assert_eq!(legacy.staging_revision, None);
}

fn edit_result(status: GeometryEditStatus) -> GeometryEditResult {
    GeometryEditResult {
        command_id: 1,
        shape_id: 7,
        new_version: 3,
        status,
        committed_bbox: chipgeom_format::Rect32 {
            lx: 0,
            ly: 0,
            hx: 10,
            hy: 10,
        },
        source_version: None,
        staging_revision: None,
        message: None,
        geometry_manifest_path: None,
    }
}

pub(super) fn layer_state(layer_id: LayerId, visible: bool) -> LayerUiState {
    LayerUiState {
        layer_id,
        shape_count: 1,
        order: u32::from(layer_id),
        name: format!("L{layer_id}"),
        layer_type: "unknown".to_string(),
        display_role: "unknown".to_string(),
        direction: "unknown".to_string(),
        width: 0,
        pitch_x: 0,
        pitch_y: 0,
        min_spacing: 0,
        min_area: 0,
        min_step: 0,
        cut_spacing: 0,
        enclosure_below: String::new(),
        enclosure_above: String::new(),
        lef58_rule_count: 0,
        visible,
        style: LayerStyle::default_for_layer(layer_id, chip_display::ColorTheme::Vivid),
    }
}

pub(super) fn temp_snapshot_dir(test_name: &str) -> PathBuf {
    let unique = SystemTime::now()
        .duration_since(SystemTime::UNIX_EPOCH)
        .unwrap()
        .as_nanos();
    let path = std::env::temp_dir().join(format!(
        "chip-viewer-native-{test_name}-{}-{unique}",
        std::process::id()
    ));
    fs::create_dir_all(&path).unwrap();
    path
}

pub(super) fn write_empty_snapshot(path: &Path, include_delta: bool) {
    let meta = chipgeom_format::GeometryMetaRecord {
        next_shape_id: 1,
        ..chipgeom_format::GeometryMetaRecord::default()
    };
    write_empty_geometry_file(
        &path.join("geometry.meta.bin"),
        chipgeom_format::GeometryFileKind::Meta,
        core::mem::size_of::<chipgeom_format::GeometryMetaRecord>() as u32,
        any_as_bytes(&meta),
    );
    write_empty_geometry_file(
        &path.join("geometry.shapes.bin"),
        chipgeom_format::GeometryFileKind::Shapes,
        core::mem::size_of::<ShapeRecord>() as u32,
        &[],
    );
    write_empty_geometry_file(
        &path.join("geometry.owners.bin"),
        chipgeom_format::GeometryFileKind::Owners,
        core::mem::size_of::<OwnerRef>() as u32,
        &[],
    );
    write_empty_geometry_file(
        &path.join("geometry.payload.bin"),
        chipgeom_format::GeometryFileKind::Payload,
        1,
        &[],
    );
    write_empty_geometry_file(
        &path.join("geometry.names.bin"),
        chipgeom_format::GeometryFileKind::Names,
        1,
        &[],
    );
    write_empty_geometry_file(
        &path.join("geometry.name_index.bin"),
        chipgeom_format::GeometryFileKind::NameIndex,
        core::mem::size_of::<chipgeom_format::GeometryNameRecord>() as u32,
        &[],
    );
    write_empty_geometry_file(
        &path.join("geometry.sidmap.bin"),
        chipgeom_format::GeometryFileKind::SidMap,
        core::mem::size_of::<chipgeom_format::GeometrySidMapRecord>() as u32,
        &[],
    );
    write_empty_geometry_file(
        &path.join("geometry.view.bin"),
        chipgeom_format::GeometryFileKind::View,
        core::mem::size_of::<chipgeom_format::GeometryViewTileRecord>() as u32,
        &[],
    );
    fs::write(
        path.join("geometry.sites.txt"),
        "name\tclass\tsymmetry\torient\twidth\theight\tis_overlap\n",
    )
    .unwrap();
    fs::write(
        path.join("geometry.masters.txt"),
        "name\ttype\tsite\tsymmetry\torigin_x\torigin_y\twidth\theight\tterm_count\tobs_count\n",
    )
    .unwrap();
    fs::write(
            path.join("geometry.vias.txt"),
            "name\tmaster\ttype\trule\tbottom\tcut\ttop\tcut_width\tcut_height\tcut_spacing_x\tcut_spacing_y\tenclosure_bottom_x\tenclosure_bottom_y\tenclosure_top_x\tenclosure_top_y\trows\tcols\tdefault\n",
        )
        .unwrap();
    fs::write(
        path.join("geometry.grids.txt"),
        "type\tindex\tdirection\tstart\tstep\tcount\twidth\tlayers\n",
    )
    .unwrap();
    fs::write(
        path.join("geometry.connectivity.txt"),
        "net\tkind\tendpoint_type\tinstance\tpin\tmaster\n",
    )
    .unwrap();
    fs::write(
        path.join("geometry.buses.txt"),
        "name\ttype\tleft\tright\tnet_count\tpin_count\n",
    )
    .unwrap();
    fs::write(
        path.join("geometry.groups.txt"),
        "name\tregion\tinstance_count\n",
    )
    .unwrap();
    if include_delta {
        write_empty_geometry_file(
            &path.join("geometry.delta.bin"),
            chipgeom_format::GeometryFileKind::Delta,
            core::mem::size_of::<chipgeom_format::GeometryDeltaRecord>() as u32,
            &[],
        );
    }
    write_manifest(path, include_delta);
}

fn close_test_loaded_viewer(test_name: &str) -> (PathBuf, LoadedViewer) {
    let dir = temp_snapshot_dir(test_name);
    write_empty_snapshot(&dir, false);
    let db = ChipViewDb::open(dir.join("geometry.manifest")).unwrap();
    let loaded = LoadedViewer::new(
        chip_display::ColorTheme::Vivid,
        db,
        true,
        true,
        None,
        None,
        None,
        analysis_loader::AnalysisPaths::default(),
        wgpu::TextureFormat::Bgra8Unorm,
        crate::RenderMode::EguiOnly,
    );
    (dir, loaded)
}

fn write_manifest(path: &Path, include_delta: bool) {
    let delta = if include_delta {
        "delta=geometry.delta.bin\n"
    } else {
        ""
    };
    fs::write(
        path.join("geometry.manifest"),
        format!(
            "schema_version=1\n\
                 shape_count=0\n\
                 owner_count=0\n\
                 payload_size=0\n\
                 meta=geometry.meta.bin\n\
                 shapes=geometry.shapes.bin\n\
                 owners=geometry.owners.bin\n\
                 payload=geometry.payload.bin\n\
                 names=geometry.names.bin\n\
                 name_index=geometry.name_index.bin\n\
                 sidmap=geometry.sidmap.bin\n\
                 {delta}\
                 view=geometry.view.bin\n\
                 sites=geometry.sites.txt\n\
                 masters=geometry.masters.txt\n\
                 vias=geometry.vias.txt\n\
                 grids=geometry.grids.txt\n\
                 connectivity=geometry.connectivity.txt\n\
                 buses=geometry.buses.txt\n\
                 groups=geometry.groups.txt\n"
        ),
    )
    .unwrap();
}

pub(super) fn write_empty_geometry_file(
    path: &Path,
    file_kind: chipgeom_format::GeometryFileKind,
    record_size: u32,
    payload: &[u8],
) {
    let record_count = if record_size == 0 {
        0
    } else {
        payload.len() as u64 / record_size as u64
    };
    let header = chipgeom_format::GeometryFileHeader {
        magic: chipgeom_format::GEOMETRY_FILE_MAGIC,
        schema_version: chipgeom_format::GEOMETRY_SCHEMA_VERSION,
        header_size: chipgeom_format::GEOMETRY_FILE_HEADER_SIZE as u32,
        file_kind: file_kind as u16,
        record_size,
        record_count,
        payload_size: payload.len() as u64,
        ..chipgeom_format::GeometryFileHeader::default()
    };
    let mut file = fs::File::create(path).unwrap();
    file.write_all(any_as_bytes(&header)).unwrap();
    file.write_all(payload).unwrap();
}

fn any_as_bytes<T: Sized>(value: &T) -> &[u8] {
    unsafe {
        std::slice::from_raw_parts(
            std::ptr::from_ref(value).cast::<u8>(),
            core::mem::size_of::<T>(),
        )
    }
}

#[test]
fn session_action_command_is_written_atomically_with_action_and_id() {
    let directory = temp_snapshot_dir("session-action-command");
    let path = directory.join("control-save-42.json");
    let command = SessionActionCommand {
        action: SessionActionKind::Save,
        command_id: 42,
    };

    write_session_action_command(&path, &command).unwrap();

    let content: serde_json::Value =
        serde_json::from_str(&fs::read_to_string(&path).unwrap()).unwrap();
    assert_eq!(content["action"], "save");
    assert_eq!(content["command_id"], 42);
    assert!(!path.with_extension("json.tmp").exists());
    fs::remove_dir_all(directory).unwrap();
}

#[test]
fn native_command_ids_are_javascript_safe_and_monotonic() {
    let mut counter = 1;
    assert_eq!(next_native_command_id(&mut counter), 1);
    assert_eq!(next_native_command_id(&mut counter), 2);

    let mut last_counter = u32::MAX;
    let last_id = next_native_command_id(&mut last_counter);
    assert_eq!(last_id, u64::from(u32::MAX));
    assert!(last_id <= MAX_JAVASCRIPT_SAFE_INTEGER);
}

#[test]
fn sidebar_keeps_query_section_at_the_original_bottom_height() {
    let heights = sidebar_section_heights(640.0);
    let used_height = heights.view
        + heights.interaction
        + heights.physical_layers
        + heights.drawing_data
        + SIDEBAR_SECTION_RESERVE_HEIGHT;

    assert!((136.0..=180.0).contains(&heights.interaction));
    assert!(used_height <= 640.0);
}

#[test]
fn viewer_edit_command_preserves_geometry_fields_and_instance_name() {
    let directory = temp_snapshot_dir("viewer-edit-command");
    let path = directory.join("command-42.json");
    let command = GeometryEditCommand {
        command_id: 42,
        shape_id: 11,
        expected_version: 3,
        op: GeometryEditOp::MoveShape,
        requested_bbox: Rect32 {
            lx: 100,
            ly: 200,
            hx: 120,
            hy: 240,
        },
    };

    write_edit_command(&path, &command, Some("u_sram_0"), None, None).unwrap();

    let content: serde_json::Value =
        serde_json::from_str(&fs::read_to_string(&path).unwrap()).unwrap();
    assert_eq!(content["command_id"], 42);
    assert_eq!(content["shape_id"], 11);
    assert_eq!(content["instance_name"], "u_sram_0");
    assert_eq!(content["requested_bbox"]["lx"], 100);
    // Legacy move commands stay byte-compatible: orientation and
    // placement status are only serialized for macro placements.
    assert!(content.get("orient").is_none());
    assert!(content.get("placement_status").is_none());

    let macro_path = directory.join("command-43.json");
    write_edit_command(
        &macro_path,
        &command,
        Some("u_sram_0"),
        Some("R90"),
        Some("fixed"),
    )
    .unwrap();
    let macro_content: serde_json::Value =
        serde_json::from_str(&fs::read_to_string(&macro_path).unwrap()).unwrap();
    assert_eq!(macro_content["orient"], "R90");
    assert_eq!(macro_content["placement_status"], "fixed");
    fs::remove_dir_all(directory).unwrap();
}

#[test]
fn macro_staging_load_parses_manifest_and_reconciles_against_snapshot() {
    let dir = temp_snapshot_dir("macro-staging-load");
    write_empty_snapshot(&dir, true);
    fs::write(
        dir.join("geometry.masters.txt"),
        "name\ttype\tsite\tsymmetry\torigin_x\torigin_y\twidth\theight\tterm_count\tobs_count\n\
             SRAM_64x32\tBLOCK\tsite9\tX,Y\t0\t0\t40000\t30000\t120\t0\n",
    )
    .unwrap();
    let staging_path = dir.join("macro-staging.json");
    fs::write(
        &staging_path,
        r#"{
                "schema": 1,
                "dbuPerMicron": 1000,
                "dieArea": {"lx": 0, "ly": 0, "hx": 52000, "hy": 53000},
                "macros": [
                    {"name": "u_sram01", "master": "SRAM_64x32", "widthDbu": 40000,
                     "heightDbu": 30000, "orient": "R0", "placed": false},
                    {"name": "u_core_cell", "master": "BUFX1", "widthDbu": 4800,
                     "heightDbu": 1400, "orient": "R0", "placed": false},
                    {"name": "u_sram02", "master": "SRAM_64x32", "widthDbu": 40000,
                     "heightDbu": 30000, "orient": "R90", "placed": true}
                ],
                "futureField": {"unknown": true}
            }"#,
    )
    .unwrap();
    let db = ChipViewDb::open(dir.join("geometry.manifest")).unwrap();

    let mut state = crate::macro_staging::MacroStagingState::load(&staging_path, &db)
        .expect("staging manifest loads");

    // Unplaced macros stage in manifest order; placed macros only carry
    // their orientation into the tracking map.
    assert_eq!(
        state
            .staged
            .iter()
            .map(|staged| staged.name.as_str())
            .collect::<Vec<_>>(),
        vec!["u_sram01", "u_core_cell"]
    );
    assert_eq!(
        state.orient_by_name.get("u_sram02").copied(),
        Some(crate::macro_orient::MacroOrientation::R90)
    );
    // The synthetic snapshot has no boundary shapes, so the manifest DIE
    // is also the placement boundary fallback.
    assert_eq!(
        state.die_rect,
        Some(Rect32 {
            lx: 0,
            ly: 0,
            hx: 52000,
            hy: 53000,
        })
    );
    assert_eq!(state.core_rect, state.die_rect);

    state.staged[0].rect = Rect32 {
        lx: -5000,
        ly: 0,
        hx: -1000,
        hy: 4000,
    };
    let world = state.expanded_world(Rect32 {
        lx: 0,
        ly: 0,
        hx: 1000,
        hy: 1000,
    });
    let staged_left = state
        .staged
        .iter()
        .map(|staged| staged.rect.lx)
        .min()
        .expect("staged macros");
    assert_eq!(
        world,
        Rect32 {
            lx: staged_left,
            ly: 0,
            hx: 1000,
            hy: 4000
        }
    );

    state
        .selection
        .insert(MacroTarget::Staged("u_core_cell".to_string()));
    state.staged.reverse();
    state.reconcile(&db);
    assert_eq!(state.staged.len(), 2);
    assert!(state
        .selection
        .contains(&MacroTarget::Staged("u_core_cell".to_string())));
    let _ = fs::remove_dir_all(&dir);
}

#[test]
fn macro_staging_load_rejects_unknown_schema() {
    let dir = temp_snapshot_dir("macro-staging-schema");
    write_empty_snapshot(&dir, false);
    let staging_path = dir.join("macro-staging.json");
    fs::write(&staging_path, r#"{"schema": 2, "macros": []}"#).unwrap();
    let db = ChipViewDb::open(dir.join("geometry.manifest")).unwrap();

    assert!(crate::macro_staging::MacroStagingState::load(&staging_path, &db).is_none());
    let _ = fs::remove_dir_all(&dir);
}

#[test]
fn accepted_staged_macro_edit_updates_local_staging_rect() {
    let dir = temp_snapshot_dir("accepted-staged-macro-move");
    write_empty_snapshot(&dir, true);
    fs::write(
        dir.join("geometry.masters.txt"),
        "name\ttype\tsite\tsymmetry\torigin_x\torigin_y\twidth\theight\tterm_count\tobs_count\n\
             SRAM_64x32\tBLOCK\tsite9\tX,Y\t0\t0\t40000\t30000\t120\t0\n",
    )
    .unwrap();
    let staging_path = dir.join("macro-staging.json");
    fs::write(
        &staging_path,
        r#"{
                "schema": 1,
                "dbuPerMicron": 1000,
                "dieArea": {"lx": 0, "ly": 0, "hx": 52000, "hy": 53000},
                "macros": [
                    {"name": "u_sram01", "master": "SRAM_64x32", "widthDbu": 40000,
                     "heightDbu": 30000, "orient": "R0", "placed": false}
                ]
            }"#,
    )
    .unwrap();
    let db = ChipViewDb::open(dir.join("geometry.manifest")).unwrap();
    let command_dir = dir.join("commands");
    let result_dir = dir.join("results");
    fs::create_dir_all(&command_dir).unwrap();
    fs::create_dir_all(&result_dir).unwrap();
    let mut loaded = LoadedViewer::new(
        chip_display::ColorTheme::Vivid,
        db,
        true,
        false,
        Some(command_dir.clone()),
        Some(result_dir),
        Some(staging_path),
        analysis_loader::AnalysisPaths::default(),
        wgpu::TextureFormat::Bgra8Unorm,
        crate::RenderMode::Gpu,
    );
    let moved = Rect32 {
        lx: 15_000,
        ly: 20_000,
        hx: 50_000,
        hy: 50_000,
    };
    assert_eq!(
        loaded
            .macro_staging
            .as_ref()
            .map(|staging| staging.staged.len()),
        Some(1)
    );
    loaded.apply_macro_moves(
        vec![PlannedMacroMove {
            name: "u_sram01".to_string(),
            orient: MacroOrientation::R90,
            rect: moved,
            staged: false,
            placement_status: None,
        }],
        Some("queued rotate clockwise".to_string()),
    );
    assert!(loaded
        .macro_staging
        .as_ref()
        .is_some_and(|staging| staging.message.is_none()));
    assert_eq!(
        loaded
            .pending_edit
            .as_ref()
            .and_then(|pending| pending.staged_macro.as_ref())
            .map(|pending| pending.name.as_str()),
        Some("u_sram01")
    );
    let command_json: serde_json::Value =
        serde_json::from_str(&fs::read_to_string(command_dir.join("command-1.json")).unwrap())
            .unwrap();
    let command: GeometryEditCommand = serde_json::from_value(command_json.clone()).unwrap();
    assert_eq!(command.shape_id, 0);
    assert_eq!(command.requested_bbox, moved);
    assert_eq!(command_json["placement_status"], "placed");

    loaded.finish_macro_edit_result(&GeometryEditResult {
        command_id: 1,
        shape_id: 0,
        new_version: 0,
        source_version: Some(0),
        staging_revision: Some(1),
        status: GeometryEditStatus::Accepted,
        committed_bbox: moved,
        message: None,
        geometry_manifest_path: None,
    });

    let staging = loaded.macro_staging.as_ref().expect("macro staging");
    let staged = &staging.staged[0];
    assert_eq!(staged.rect, moved);
    assert_eq!(staged.orient, MacroOrientation::R90);
    assert_eq!(staging.status_of(&staged.name), PlacementStatus::Placed);
    assert!(!staging.queue.is_busy());
    assert!(staging.message.is_none());
    let _ = fs::remove_dir_all(&dir);
}

#[test]
fn session_action_result_message_includes_status_and_diagnostic() {
    let result = SessionActionResult {
        action: SessionActionKind::Discard,
        accepted: false,
        command_id: 17,
        geometry_manifest_path: None,
        message: Some("source changed".to_string()),
    };

    assert_eq!(
        session_action_result_message(&result),
        "discard rejected: source changed"
    );
}

#[test]
fn macro_save_blocker_rejects_only_macros_still_outside_the_core() {
    assert!(macro_save_blocker(None).is_none());
    let mut state = crate::macro_staging::MacroStagingState {
        staged: Vec::new(),
        selection: crate::macro_staging::MacroSelection::default(),
        orient_by_name: BTreeMap::new(),
        status_by_name: BTreeMap::new(),
        die_rect: None,
        core_rect: None,
        queue: Default::default(),
        message: None,
        stdcell_blob: None,
    };
    assert!(macro_save_blocker(Some(&state)).is_none());

    state.staged.push(crate::macro_staging::StagedMacro {
        name: "u_sram01".to_string(),
        master: "SRAM_64x32".to_string(),
        width: 40000,
        height: 30000,
        orient: crate::macro_orient::MacroOrientation::R0,
        rect: Rect32::default(),
    });
    assert_eq!(
        macro_save_blocker(Some(&state)).as_deref(),
        Some("1 macro(s) are still unplaced; place every macro before saving: u_sram01")
    );

    state.core_rect = Some(Rect32 {
        lx: 0,
        ly: 0,
        hx: 52_000,
        hy: 53_000,
    });
    state.staged[0].rect = Rect32 {
        lx: 1_000,
        ly: 2_000,
        hx: 41_000,
        hy: 32_000,
    };
    assert!(macro_save_blocker(Some(&state)).is_none());
}

#[test]
fn session_action_progress_deserializes_the_macro_params_phase() {
    let progress: SessionActionProgress = serde_json::from_str(
        r#"{
                "action": "save",
                "command_id": 43,
                "phase": "recording_macro_placements",
                "percent": 65,
                "message": "Recording macro placements in workspace parameters"
            }"#,
    )
    .unwrap();

    assert_eq!(
        progress.phase,
        SessionActionProgressPhase::RecordingMacroPlacements
    );
    assert_eq!(progress.phase.label(), "Recording macro placements");
    assert_eq!(progress.percent, 65);
    assert!(!progress.phase.is_terminal());
}

#[test]
fn session_action_progress_deserializes_the_cross_process_save_protocol() {
    let progress: SessionActionProgress = serde_json::from_str(
        r#"{
                "action": "save",
                "command_id": 42,
                "phase": "verifying_artifacts",
                "percent": 50,
                "message": "Verifying published artifacts"
            }"#,
    )
    .unwrap();

    assert_eq!(progress.action, SessionActionKind::Save);
    assert_eq!(progress.command_id, 42);
    assert_eq!(
        progress.phase,
        SessionActionProgressPhase::VerifyingArtifacts
    );
    assert_eq!(progress.percent, 50);
    assert_eq!(progress.fraction(), 0.5);
    assert!(!progress.phase.is_terminal());
}

#[test]
fn missing_session_action_progress_times_out_instead_of_waiting_forever() {
    let directory = temp_snapshot_dir("session-action-progress-timeout");
    let progress_path = directory.join("control-progress-save-57.json");

    assert!(matches!(
        read_session_action_progress(
            SessionActionKind::Save,
            57,
            &progress_path,
            Duration::from_secs(14),
        ),
        SessionActionProgressPoll::Waiting
    ));
    assert!(matches!(
        read_session_action_progress(
            SessionActionKind::Save,
            57,
            &progress_path,
            Duration::from_secs(15),
        ),
        SessionActionProgressPoll::TimedOut
    ));
}

#[test]
fn matching_session_action_progress_is_polled_before_the_timeout() {
    let directory = temp_snapshot_dir("session-action-progress-update");
    let progress_path = directory.join("control-progress-save-57.json");
    fs::write(
        &progress_path,
        r#"{
                "action": "save",
                "command_id": 57,
                "phase": "saving",
                "percent": 15,
                "message": "Saving layout edits in ECC"
            }"#,
    )
    .unwrap();

    let poll = read_session_action_progress(
        SessionActionKind::Save,
        57,
        &progress_path,
        Duration::from_secs(30),
    );
    let SessionActionProgressPoll::Updated(progress) = poll else {
        panic!("expected progress update");
    };
    assert_eq!(progress.phase, SessionActionProgressPhase::Saving);
    assert_eq!(progress.percent, 15);
}

#[test]
fn session_action_progress_title_reflects_terminal_outcome() {
    assert_eq!(
        session_action_progress_title(SessionActionKind::Save, SessionActionProgressPhase::Saving,),
        "Saving layout"
    );
    assert_eq!(
        session_action_progress_title(
            SessionActionKind::Save,
            SessionActionProgressPhase::Completed,
        ),
        "Layout saved"
    );
    assert_eq!(
        session_action_progress_title(
            SessionActionKind::Discard,
            SessionActionProgressPhase::Completed,
        ),
        "Edits discarded"
    );
    assert_eq!(
        session_action_progress_title(SessionActionKind::Save, SessionActionProgressPhase::Failed,),
        "Save failed"
    );
}

#[test]
fn macro_feedback_warning_recognizes_actionable_failures() {
    assert!(macro_feedback_is_warning(
        "macro move rejected: overlaps u_macro"
    ));
    assert!(macro_feedback_is_warning(
        "1 macro(s) are still unplaced; place every macro before saving: u_macro"
    ));
    assert!(macro_feedback_is_warning(
        "edit command directory is missing"
    ));
    assert!(!macro_feedback_is_warning(
        "save completed: macro placements saved (1 macros)"
    ));
    assert!(!macro_feedback_is_warning(
        "edit accepted: shape 0 source version 0 staging revision 1"
    ));
    assert!(!macro_feedback_is_warning("queued rotate clockwise"));
    assert!(macro_feedback_is_warning(
        "rotate clockwise is unavailable for the current selection"
    ));
}

fn layer_visibility(layers: &[LayerUiState]) -> Vec<bool> {
    layers.iter().map(|layer| layer.visible).collect()
}
