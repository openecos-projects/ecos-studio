use super::*;

#[path = "cpu_label_candidates.rs"]
mod candidates;
pub(super) use candidates::Candidates;

#[path = "cpu_label_worker.rs"]
mod worker;
pub(super) use worker::LabelWorker;

struct LabelInput {
    canvas: egui::Rect,
    pixels_per_point: f32,
    texture_side: usize,
    fonts: egui::FontDefinitions,
    overlay_labels: ShapeLabelCollector,
}

impl LabelInput {
    fn from_request(request: &SceneRequest) -> Self {
        Self {
            canvas: request.key.canvas,
            pixels_per_point: request.key.pixels_per_point,
            texture_side: request.label_texture_side,
            fonts: request.label_fonts.clone(),
            overlay_labels: request.overlay_labels.clone(),
        }
    }
}

#[derive(Default)]
pub(super) struct LabelResolver {
    fonts: Vec<egui::epaint::Fonts>,
}

impl LabelResolver {
    pub(super) fn resolve(
        &mut self,
        request: &SceneRequest,
        labels: &ShapeLabelCollector,
        is_current: impl Fn() -> bool + Sync,
    ) -> Option<ResolvedLabels> {
        self.resolve_input(&LabelInput::from_request(request), labels, is_current)
    }

    fn resolve_input(
        &mut self,
        input: &LabelInput,
        labels: &ShapeLabelCollector,
        is_current: impl Fn() -> bool + Sync,
    ) -> Option<ResolvedLabels> {
        if !is_current() {
            return None;
        }
        let mut combined;
        let labels = if input.overlay_labels.is_empty() {
            labels
        } else {
            combined = labels.clone();
            combined.append(input.overlay_labels.clone());
            &combined
        };
        let plan = labels.plan(input.canvas);
        let maximum = thread::available_parallelism()
            .map_or(1, usize::from)
            .div_ceil(2)
            .clamp(1, 8);
        let workers = plan.worker_count(maximum);
        self.fonts.resize_with(workers.max(self.fonts.len()), || {
            egui::epaint::Fonts::new(
                input.pixels_per_point,
                input.texture_side,
                input.fonts.clone(),
            )
        });
        for fonts in &mut self.fonts[..workers] {
            if fonts.lock().fonts.definitions() != &input.fonts {
                *fonts = egui::epaint::Fonts::new(
                    input.pixels_per_point,
                    input.texture_side,
                    input.fonts.clone(),
                );
            }
            fonts.begin_pass(input.pixels_per_point, input.texture_side);
        }
        plan.resolve(
            workers,
            |worker, text, size| {
                self.fonts[worker]
                    .layout_no_wrap(
                        text.to_owned(),
                        egui::FontId::proportional(size),
                        egui::Color32::WHITE,
                    )
                    .size()
            },
            is_current,
        )
    }
}
