use chipgeom_format::LayerId;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct LayerStyle {
    pub layer_id: LayerId,
    pub visible: bool,
    pub rgba: [u8; 4],
}

impl LayerStyle {
    pub fn default_for_layer(layer_id: LayerId) -> Self {
        const COLORS: [[u8; 4]; 6] = [
            [67, 118, 182, 180],
            [220, 126, 73, 180],
            [79, 157, 105, 180],
            [184, 76, 94, 180],
            [138, 111, 178, 180],
            [92, 155, 167, 180],
        ];
        Self {
            layer_id,
            visible: true,
            rgba: COLORS[layer_id as usize % COLORS.len()],
        }
    }
}
