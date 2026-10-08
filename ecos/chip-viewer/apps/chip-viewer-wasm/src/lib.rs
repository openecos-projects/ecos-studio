//! Browser entry point for the chip viewer.
//!
//! `chip-viewer-native` cannot be reused as-is: its `main.rs` parses CLI
//! arguments and `chip-view-db` memory-maps its input, neither of which exists
//! on `wasm32`. This crate keeps the parts that are portable — the layer
//! styling in `chip-display` — behind an `eframe` app the host page mounts on a
//! canvas.

use chip_display::{ColorTheme, LayerRole, LayerStyle};
use chipgeom_format::LayerId;

pub struct ChipViewerApp {
    theme: ColorTheme,
    layers: Vec<(LayerId, LayerRole)>,
}

impl Default for ChipViewerApp {
    fn default() -> Self {
        Self {
            theme: ColorTheme::default(),
            layers: (0..6)
                .map(|level| (level as LayerId, LayerRole::Metal { level }))
                .collect(),
        }
    }
}

impl eframe::App for ChipViewerApp {
    fn update(&mut self, ctx: &egui::Context, _frame: &mut eframe::Frame) {
        egui::CentralPanel::default().show(ctx, |ui| {
            for (layer_id, role) in &self.layers {
                let style = LayerStyle::default_for_layer(*layer_id, self.theme);
                let [r, g, b, a] = style.rgba;
                let (rect, _) =
                    ui.allocate_exact_size(egui::vec2(24.0, 12.0), egui::Sense::hover());
                ui.painter().rect_filled(
                    rect,
                    2.0,
                    egui::Color32::from_rgba_unmultiplied(r, g, b, a),
                );
                ui.label(format!("{role:?}"));
            }
        });
    }
}

#[cfg(target_arch = "wasm32")]
#[wasm_bindgen::prelude::wasm_bindgen]
pub struct ChipViewerHandle {
    runner: eframe::WebRunner,
}

#[cfg(target_arch = "wasm32")]
#[wasm_bindgen::prelude::wasm_bindgen]
impl ChipViewerHandle {
    #[wasm_bindgen::prelude::wasm_bindgen(constructor)]
    pub fn new() -> Self {
        Self {
            runner: eframe::WebRunner::new(),
        }
    }

    /// Mounts the viewer on `canvas`; the host page owns the element's lifetime.
    pub async fn start(
        &self,
        canvas: web_sys::HtmlCanvasElement,
    ) -> Result<(), wasm_bindgen::JsValue> {
        self.runner
            .start(
                canvas,
                eframe::WebOptions::default(),
                Box::new(|_cc| Ok(Box::<ChipViewerApp>::default())),
            )
            .await
    }
}
