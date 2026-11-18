use super::*;

#[test]
fn coalesced_target_rows_match_independent_pixel_copy_at_partial_tile_boundaries() {
    let fixture = crate::app::cpu_scene::tests::Fixture::new();
    for size in [[509, 503], [17, 19], [8, 8]] {
        let mut request = fixture.request(1.0, 1.0);
        request.key.screen_size = size;
        request.key.canvas =
            egui::Rect::from_min_size(egui::Pos2::ZERO, egui::vec2(size[0] as f32, size[1] as f32));
        let target = (0..size[0] as usize * size[1] as usize * 4)
            .map(|index| (index.wrapping_mul(137) ^ (index >> 5)) as u8)
            .collect::<Vec<_>>();
        for pan in [egui::vec2(3.0, -2.0), egui::vec2(-2.0, 3.0)] {
            let mut key = request.key.clone();
            key.pan += pan;
            let mut regions = Regions::new(&key);
            for index in 0..regions.invalid.len() {
                let tile = regions.tile(index);
                let source_tile = tile.translate(-pan);
                regions.invalid[index] = !request.key.canvas.contains_rect(source_tile)
                    || (index / regions.columns + index % regions.columns) % 5 == 0;
            }
            let mut expected = key
                .background
                .to_array()
                .repeat(size[0] as usize * size[1] as usize);
            let mut copied = 0;
            for row in 0..size[1] as usize {
                for column in 0..size[0] as usize {
                    if regions.invalid[row / TILE * regions.columns + column / TILE] {
                        continue;
                    }
                    let new = ((size[1] as usize - 1 - row) * size[0] as usize + column) * 4;
                    expected[new..new + 4].copy_from_slice(&target[new..new + 4]);
                    copied += 1;
                }
            }
            let mut actual = key
                .background
                .to_array()
                .repeat(size[0] as usize * size[1] as usize);
            copy_valid_tiles(&mut actual, &target, &regions);
            assert_eq!(actual, expected);
            if size[0] > 8 {
                assert!(copied > 0);
            }
        }
    }
}

#[test]
fn retained_target_proof_rejects_other_models_growth_and_changed_targets() {
    let fixture = crate::app::cpu_scene::tests::Fixture::new();
    let request = fixture.request(1.0, 1.0);
    let mut model = RegionModel::new(&request).unwrap();
    let other = RegionModel::new(&request).unwrap();
    let mut key = request.key.clone();
    key.pan += egui::vec2(4.0, 3.0);
    let regions = model.validate(&key, 1).unwrap();
    let source = vec![0x5a; key.screen_size[0] as usize * key.screen_size[1] as usize * 4];
    assert_eq!(
        model.compose(&key, &regions, &source).unwrap(),
        key.background
            .to_array()
            .repeat(key.screen_size[0] as usize * key.screen_size[1] as usize),
        "an empty target plan must ignore arbitrary source RGBA"
    );
    assert!(other.compose(&key, &regions, &source).is_none());
    assert!(model.compose(&key, &Regions::new(&key), &source).is_none());
    assert!(model.compose(&key, &regions, &source[4..]).is_none());
    let mut wrong = key.clone();
    wrong.pan.x += 1.0;
    assert!(model.compose(&wrong, &regions, &source).is_none());
    assert!(regions.repair_meshes(&wrong).is_none());
    for change in [
        |key: &mut SceneKey| key.selected = Some(1),
        |key: &mut SceneKey| {
            key.highlighted.insert(1);
        },
    ] {
        let mut wrong = key.clone();
        change(&mut wrong);
        assert!(model.validate(&wrong, 1).is_none());
    }
    let bbox = Rect32 {
        lx: 300,
        ly: 300,
        hx: 700,
        hy: 700,
    };
    assert!(model.push(
        bbox,
        ShapeGeometry::Rect(bbox),
        LayerStyle::default_for_layer(1, chip_display::ColorTheme::Vivid),
        &[]
    ));
    assert!(
        model.compose(&key, &regions, &source).is_none(),
        "a proof predating a new record must expire"
    );
}

#[test]
fn source_command_eligibility_does_not_decide_target_style() {
    let fixture = crate::app::cpu_scene::tests::Fixture::new();
    let request = fixture.request(1.0, 1.0);
    let bbox = Rect32 {
        lx: 300,
        ly: 300,
        hx: 700,
        hy: 700,
    };
    let mut style = LayerStyle::default_for_layer(1, chip_display::ColorTheme::Vivid);
    style.fill_pattern = chip_display::FillPattern::Solid;
    style.rgba = [173, 61, 237, 112];
    style.frame_rgba = [0; 4];
    let mut source_commands = Commands::default();
    GeometryPass::new(
        request.key.world,
        request.key.canvas,
        request.key.zoom,
        request.key.pan,
    )
    .draw(ShapeGeometry::Rect(bbox), &style, &mut source_commands);
    assert!(!source_commands.0.is_empty());
    let mut current = request.key.clone();
    current.pan += egui::vec2(4.0, 3.0);
    let source = vec![0x5a; current.screen_size[0] as usize * current.screen_size[1] as usize * 4];
    let mut outputs = Vec::new();
    for commands in [source_commands.0.as_slice(), &[]] {
        let mut model = RegionModel::new(&request).unwrap();
        assert!(model.push(bbox, ShapeGeometry::Rect(bbox), style, commands));
        let regions = model.validate(&current, 1).unwrap();
        outputs.push(model.compose(&current, &regions, &source).unwrap());
    }
    assert_eq!(outputs[0], outputs[1]);
    assert!(
        outputs[0]
            .chunks_exact(4)
            .filter(|pixel| *pixel != current.background.to_array())
            .count()
            > 1000,
        "supported foreground must be recomposed even without source commands"
    );
    assert!(!outputs[0].chunks_exact(4).any(|pixel| pixel == [0x5a; 4]));
}
