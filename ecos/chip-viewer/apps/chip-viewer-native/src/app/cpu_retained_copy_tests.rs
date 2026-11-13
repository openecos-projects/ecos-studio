use super::*;

#[test]
fn coalesced_retained_rows_match_independent_pixel_copy_at_partial_tile_boundaries() {
    let fixture = crate::app::cpu_scene::tests::Fixture::new();
    for size in [[509, 503], [17, 19], [8, 8]] {
        let mut request = fixture.request(1.0, 1.0);
        request.key.screen_size = size;
        request.key.canvas =
            egui::Rect::from_min_size(egui::Pos2::ZERO, egui::vec2(size[0] as f32, size[1] as f32));
        let model = RegionModel::new(&request).unwrap();
        let source = (0..size[0] as usize * size[1] as usize * 4)
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
            regions.proof = Some(CameraProof {
                source: request.key.clone(),
                current: key.clone(),
            });
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
                    let source_row = (row as i32 - pan.y as i32) as usize;
                    let source_column = (column as i32 - pan.x as i32) as usize;
                    let old = ((size[1] as usize - 1 - source_row) * size[0] as usize
                        + source_column)
                        * 4;
                    let new = ((size[1] as usize - 1 - row) * size[0] as usize + column) * 4;
                    expected[new..new + 4].copy_from_slice(&source[old..old + 4]);
                    copied += 1;
                }
            }
            assert_eq!(model.compose(&key, &regions, &source).unwrap(), expected);
            if size[0] > 8 {
                assert!(copied > 0);
            }
        }
    }
}
