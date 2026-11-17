use super::*;
use chipgeom_format::{ClockEdgeRecord, ClockNodeRecord};

#[test]
fn branches_expand_in_parallel_without_cell_or_disconnected_lines() {
    let tree = ClockTreeSnapshot {
        nodes: (0..7)
            .map(|node_id| ClockNodeRecord {
                node_id,
                ..Default::default()
            })
            .collect(),
        roots: vec![0],
        edges: [
            (0, 1, 1),
            (0, 2, 1),
            (1, 3, 2),
            (3, 4, 1),
            (5, 6, 1),
            (4, 0, 2),
        ]
        .into_iter()
        .map(|(from_node, to_node, kind)| ClockEdgeRecord {
            from_node,
            to_node,
            kind,
            ..Default::default()
        })
        .collect(),
        ..Default::default()
    };
    let overlay = ClockOverlay::from_tree(&tree, |_, _| Some(Path::Flyline([0, 0], [100, 100])));
    assert_eq!((overlay.len(), overlay.missing), (3, 1));
    let fractions = |p| {
        overlay
            .branches
            .iter()
            .map(|b| b.fraction(p))
            .collect::<Vec<_>>()
    };
    assert_eq!(fractions(0.0), [0.0, 0.0, 0.0]);
    assert_eq!(fractions(0.25), [0.5, 0.5, 0.0]);
    assert_eq!(fractions(0.75), [1.0, 1.0, 0.5]);
    assert_eq!(fractions(1.0), [1.0, 1.0, 1.0]);
    assert_eq!(fractions(0.25), [0.5, 0.5, 0.0]);
}

#[test]
fn pin_identity_handles_local_and_qualified_names() {
    assert_eq!(full_pin("u1", "CK"), "u1/CK");
    assert_eq!(full_pin("u1", "u1/CK"), "u1/CK");
    assert_eq!(full_pin("u1", "u1:CK"), "u1:CK");
    assert_eq!(full_pin("", "clk"), "clk");
}

#[test]
fn routed_projection_keeps_via_layers() {
    use timing_route::{Point, Route, Stroke};
    let a = Point {
        x: 10,
        y: 20,
        layer: 2,
    };
    let b = Point {
        x: 10,
        y: 20,
        layer: 4,
    };
    let overlay = ClockOverlay {
        branches: vec![Branch {
            path: Path::Routed(Arc::new(Route {
                strokes: vec![Stroke { a, b }],
                length: 1.0,
            })),
            clock: 0,
            level: 0,
            levels: 1,
        }],
        ..Default::default()
    };
    let projected = std::cell::RefCell::new(Vec::new());
    let ctx = egui::Context::default();
    let _ = ctx.run(Default::default(), |ctx| {
        let painter = ctx.layer_painter(egui::LayerId::background());
        overlay.paint(
            &painter,
            |x, y, layer| {
                projected.borrow_mut().push((x, y, layer));
                Pos2::new(x as f32, y as f32)
            },
            1.0,
        );
    });
    assert_eq!(*projected.borrow(), [(10, 20, Some(2)), (10, 20, Some(4))]);
}

#[test]
#[ignore = "set ECOS_REPLAY_TEST_CATALOG to real clock-bearing steps"]
fn real_clock_networks_resolve() {
    let path = std::env::var("ECOS_REPLAY_TEST_CATALOG").unwrap();
    let catalog: serde_json::Value = serde_json::from_slice(&std::fs::read(path).unwrap()).unwrap();
    let workspace = std::path::Path::new(catalog["workspace"].as_str().unwrap());
    for step in catalog["steps"].as_array().unwrap() {
        let record = Recording::open(
            workspace,
            std::path::Path::new(step["manifest"].as_str().unwrap()),
        )
        .unwrap();
        let tree = record.clock_tree().unwrap().expect("clock tree");
        let started = std::time::Instant::now();
        let overlay = ClockOverlay::load(&record, &tree);
        println!(
            "{}: {} branches, {} missing, {:?}, error={}",
            step["name"],
            overlay.len(),
            overlay.missing,
            started.elapsed(),
            overlay.error
        );
        assert!(overlay.error.is_empty(), "{}", overlay.error);
        assert!(overlay.len() > 0);
        assert_eq!(overlay.missing, 0);
        if tree.stage() == Some(ClockTreeStage::Filler) {
            for branch in &overlay.branches {
                let Path::Routed(route) = &branch.path else {
                    panic!("filler flyline");
                };
                assert!(!route.strokes.is_empty());
                for stroke in &route.strokes {
                    assert!(stroke.a.x == stroke.b.x || stroke.a.y == stroke.b.y);
                    if stroke.a.layer != stroke.b.layer {
                        assert_eq!((stroke.a.x, stroke.a.y), (stroke.b.x, stroke.b.y));
                    }
                }
            }
        }
    }
}
