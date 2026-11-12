use super::*;

pub(super) fn build(
    request: &SceneRequest,
    is_current: impl Fn() -> bool,
) -> Option<(Vec<egui::ClippedPrimitive>, usize)> {
    if !is_current() {
        return None;
    }
    let key = &request.key;
    let ctx = egui::Context::default();
    let mut drawn = 0;
    let output = ctx.run(
        egui::RawInput {
            screen_rect: Some(key.canvas),
            time: Some(0.0),
            ..Default::default()
        },
        |ctx| {
            let painter = ctx
                .layer_painter(egui::LayerId::background())
                .with_clip_rect(key.canvas);
            drawn += paint_parameterized_grid_overlay(
                &painter,
                request.db.grid_metadata(),
                &request.grid_layers,
                key.visibility,
                key.viewport,
                key.grid_bounds,
                key.world,
                key.canvas,
                key.zoom,
                key.pan,
            );
            drawn += paint_unrouted_net_guides(
                &painter,
                request.db.unrouted_net_guides(),
                key.visibility,
                key.viewport,
                key.world,
                key.canvas,
                key.zoom,
                key.pan,
            );
        },
    );
    if !is_current() {
        return None;
    }
    let meshes =
        builder::prepare_meshes(request.tessellator.clone().tessellate_shapes(output.shapes));
    is_current().then_some((meshes, drawn))
}
