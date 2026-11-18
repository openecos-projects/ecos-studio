//! Concise descriptions of what is actually visible at the current sample.
use super::ReplayApp;
use egui::{Color32, FontId, Rect};

#[path = "caption_metrics.rs"]
mod metrics;

impl ReplayApp {
    pub(super) fn current_phase(&self) -> String {
        if let Some(scan) = self
            .analysis
            .drc_scan()
            .filter(|_| self.complete && self.pending.is_none())
        {
            return self.analysis.drc.caption(scan);
        }
        if let Some(label) = self.maps.selected_label() {
            return format!("Map · {label}");
        }
        if let Some(label) = self.analysis.selected_label() {
            return label.to_owned();
        }
        if self.complete {
            return "Completed result".into();
        }
        self.recording
            .as_ref()
            .and_then(|r| r.scene.revision.map(|i| &r.manifest.frames[i]))
            .map(|f| {
                if f.subflow.is_empty() {
                    f.phase.replace('_', " ")
                } else {
                    format!(
                        "{} · {}",
                        f.subflow.replace('_', " "),
                        f.phase.replace('_', " ")
                    )
                }
            })
            .unwrap_or_else(|| "Recorded progress".into())
    }
    pub(super) fn paint_caption(&self, ui: &egui::Ui, rect: Rect) {
        let text = self.caption_text();
        let width = (rect.width() - 32.0).clamp(80.0, 470.0);
        let painter = ui.painter().with_clip_rect(rect);
        let title = painter.layout(
            format!(
                "{} / {}",
                self.catalog.steps[self.step].name,
                if self.complete { "RESULT" } else { "REPLAY" }
            ),
            FontId::proportional(13.0),
            Color32::from_rgb(180, 198, 215),
            width - 20.0,
        );
        let phase = painter.layout(
            self.current_phase(),
            FontId::proportional(17.0),
            Color32::from_rgb(229, 236, 244),
            width - 20.0,
        );
        let detail = painter.layout(
            text,
            FontId::proportional(12.0),
            Color32::from_rgb(111, 223, 209),
            width - 20.0,
        );
        let origin = rect.left_top() + egui::vec2(12.0, 12.0);
        let height = title.size().y + phase.size().y + detail.size().y + 24.0;
        let show_metrics = self.complete
            && self.pending.is_none()
            && self.error.is_empty()
            && self
                .recording
                .as_ref()
                .is_some_and(|r| !r.manifest.diagnostic_only);
        let extra = if show_metrics {
            metrics::height(&self.completion_results.metrics) + 8.0
        } else {
            0.0
        };
        painter.rect_filled(
            Rect::from_min_size(origin, egui::vec2(width, height + extra)),
            6.0,
            Color32::from_black_alpha(155),
        );
        let mut at = origin + egui::vec2(10.0, 6.0);
        for galley in [title, phase, detail] {
            let h = galley.size().y;
            painter.galley(at, galley, Color32::WHITE);
            at.y += h + 4.0;
        }
        if show_metrics {
            let metric_rect = Rect::from_min_size(
                origin + egui::vec2(10.0, height),
                egui::vec2(width - 20.0, extra),
            );
            metrics::paint(
                ui,
                metric_rect.intersect(rect),
                &self.completion_results.metrics,
            );
        }
    }
    fn caption_text(&self) -> String {
        if !self.error.is_empty() {
            return self.error.clone();
        }
        if self.pending.is_some() {
            return "Loading this sample's recorded geometry…".into();
        }
        if self.complete && !self.analysis.error.is_empty() {
            return self.analysis.error.clone();
        }
        if self.maps.selected.is_some() {
            return "Spatial heatmap aligned to the completed layout".into();
        }
        if let Some((kind, label)) = self.analysis.selected_description() {
            return match kind {
                "timing" => format!("{label} · parallel paths along routed wires and vias"),
                "power" => "Per-instance power mapped to physical layout positions".into(),
                "ir" => {
                    format!("{label} · static result · spatial reveal · brighter = larger drop")
                }
                "rcx" => {
                    "SPEF extraction result replay · native nets · color = net capacitance".into()
                }
                _ => "Recorded analysis results at their physical locations".into(),
            };
        }
        if self.complete && self.clock_overlay.len() > 0 {
            return if self.catalog.steps[self.step]
                .name
                .eq_ignore_ascii_case("filler")
            {
                "Cyan: clock network along routed wires and vias"
            } else {
                "Cyan: clock connectivity from root to sinks"
            }
            .into();
        }
        if self.motion.active() {
            return "Recorded cell positions · interpolated movement and trails".into();
        }
        if self.reveal.active() {
            return format!(
                "{} · staged reveal of captured changes",
                self.reveal.label()
            );
        }
        let frame = self
            .recording
            .as_ref()
            .and_then(|r| r.scene.revision.map(|i| &r.manifest.frames[i]));
        describe(
            &self.catalog.steps[self.step].name,
            frame.map_or("", |f| f.phase.as_str()),
            self.complete,
        )
        .into()
    }
}
fn describe(step: &str, phase: &str, complete: bool) -> &'static str {
    if complete {
        return "Completed layout · highlighted objects changed in this step";
    }
    let phase = phase.to_ascii_lowercase();
    if phase.contains("pdn") || phase.contains("power_grid") {
        return "Power network geometry revealed by metal layer";
    }
    if phase.contains("tap") {
        return "Tap cells revealed in captured spatial batches";
    }
    if phase.contains("io") && phase.contains("place") {
        return "IO pins positioned around the design boundary";
    }
    if phase.contains("core") || phase.contains("die") {
        return "Die and core boundaries establish the physical floorplan";
    }
    match step.to_ascii_lowercase().as_str() {
        "synthesis" => "Recorded logical structure and synthesis results",
        "prefloorplan" | "postfloorplan" | "macroplacement" => {
            "Floorplan boundaries, cells and physical infrastructure"
        }
        "preplace" | "place" | "legalization" => "Captured placement changes and cell positions",
        "diff_sizing" | "timing optimization" => {
            "Cell sizing and buffering changes committed by the tool"
        }
        "cts" => "Clock cell insertion and placement changes",
        "route" => "Routing regions, metal wires and vias at captured algorithm nodes",
        "filler" => "Filler insertion revealed in spatial batches",
        "rcx" => "Recorded parasitic extraction observations",
        "sta" => "Timing analysis observations; paths appear with completed results",
        "poweranalysis" => "Power analysis observations; heatmaps appear with completed results",
        "drc" | "lvs" | "antennacheck" | "postroutelec" | "emir" => {
            "Recorded checks and physical analysis results"
        }
        "harden" => "Final design geometry and delivery results",
        _ => "Recorded geometry changes for this workspace step",
    }
}
