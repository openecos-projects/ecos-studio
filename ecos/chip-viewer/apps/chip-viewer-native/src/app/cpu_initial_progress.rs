use super::*;
use chip_render::geometry2d::{PaintCommand, PaintSink};

#[derive(Default)]
struct PrefixCommands(Vec<PaintCommand>);

impl PaintSink for PrefixCommands {
    fn paint(&mut self, command: PaintCommand) {
        self.0.push(command);
    }
}

impl SceneSink for PrefixCommands {}

pub(in crate::app::cpu_scene) fn build_initial_progress(
    request: &SceneRequest,
    pixels: &mut Vec<u8>,
) -> Option<usize> {
    let [width, height] = request.key.screen_size;
    if u64::from(width) * u64::from(height) > 4_194_304 {
        return None;
    }
    let started = Instant::now();
    for &layer in request.layer_ids.iter().take(64) {
        if started.elapsed() > Duration::from_millis(3) {
            return None;
        }
        let ids = request.db.try_query_layer_intersect_prefix(
            layer,
            request.key.viewport,
            chip_view_db::QueryPrefixLimits {
                max_results: 64,
                max_candidates: 65_536,
            },
        )?;
        if ids.is_empty() {
            continue;
        }
        let (_, commands) = build_chunk_sink(request, &ids, &|| true, PrefixCommands::default())?;
        let mut kernel = sparse_rects::SparseRects::new(request)?;
        kernel.append(&commands.0, request, &|| true)?;
        kernel.reset_pixels(pixels, request.key.background);
        if !kernel.render_since(0, pixels, &|| true) {
            return None;
        }
        kernel.prepare_partial(pixels, request.key.background, &|| true)?;
        return Some(commands.0.len());
    }
    None
}
