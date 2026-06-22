use layoutdb::ShapeKind;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Color {
    pub r: u8,
    pub g: u8,
    pub b: u8,
}

impl Color {
    pub const fn rgb(r: u8, g: u8, b: u8) -> Self {
        Self { r, g, b }
    }

    pub fn luma(self) -> u16 {
        (u16::from(self.r) * 30 + u16::from(self.g) * 59 + u16::from(self.b) * 11) / 100
    }

    pub fn shift_brightness(self, amount: f32) -> Self {
        let amount = amount.clamp(-1.0, 1.0);
        if amount >= 0.0 {
            Self {
                r: shift_channel_toward(self.r, 255, amount),
                g: shift_channel_toward(self.g, 255, amount),
                b: shift_channel_toward(self.b, 255, amount),
            }
        } else {
            let amount = amount.abs();
            Self {
                r: shift_channel_toward(self.r, 0, amount),
                g: shift_channel_toward(self.g, 0, amount),
                b: shift_channel_toward(self.b, 0, amount),
            }
        }
    }
}

fn shift_channel_toward(channel: u8, target: u8, amount: f32) -> u8 {
    let channel = channel as f32;
    let target = target as f32;
    (channel + (target - channel) * amount)
        .round()
        .clamp(0.0, 255.0) as u8
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Pattern {
    Solid,
    Hollow,
    SparseDots,
    DiagonalHatch,
    CrossHatch,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum LineStyle {
    Solid,
    Dashed,
    Dotted,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum CompositionMode {
    Copy,
    AdditiveOr,
    SubtractiveAnd,
    Alpha,
    MaskPattern,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum LayerRole {
    Overlap,
    Active,
    ImplantN,
    ImplantP,
    Well,
    Poly,
    Contact,
    Metal { level: u8 },
    Via { level: u8 },
    TopMetal { level: u8 },
    TopVia { level: u8 },
    RedistributionVia,
    Rdl,
    Fill,
    Row,
    Blockage,
    Unknown,
}

impl LayerRole {
    pub fn from_layer_name(name: &str) -> Self {
        let compact = compact_layer_name(name);
        if compact.is_empty() {
            return Self::Unknown;
        }

        if compact.contains("FILL") || compact.contains("DUMMY") {
            return Self::Fill;
        }
        if compact.contains("BLOCKAGE") || compact.contains("OBS") {
            return Self::Blockage;
        }
        if compact.contains("ROW") {
            return Self::Row;
        }

        match compact.as_str() {
            "OVERLAP" => return Self::Overlap,
            "ACT" | "ACTIVE" | "DIFF" | "DIFFUSION" => return Self::Active,
            "NP" | "NIMP" | "NPLUS" => return Self::ImplantN,
            "PP" | "PIMP" | "PPLUS" => return Self::ImplantP,
            "POLY" | "PO" => return Self::Poly,
            "CT" | "CONT" | "CONTACT" => return Self::Contact,
            "RDL" => return Self::Rdl,
            "RV" => return Self::RedistributionVia,
            _ => {}
        }

        if compact.starts_with("NW") || compact.starts_with("PW") || compact.contains("WELL") {
            return Self::Well;
        }

        if let Some(level) = parse_number_after_prefix(&compact, "T4M") {
            return Self::TopMetal { level };
        }
        if let Some(level) = parse_number_after_prefix(&compact, "T4V") {
            return Self::TopVia { level };
        }
        if let Some(level) = parse_number_after_prefix(&compact, "METAL") {
            return Self::Metal { level };
        }
        if let Some(level) = parse_number_after_prefix(&compact, "MET") {
            return Self::Metal { level };
        }
        if let Some(level) = parse_number_after_prefix(&compact, "M") {
            return Self::Metal { level };
        }
        if let Some(level) = parse_number_after_prefix(&compact, "VIA") {
            return Self::Via { level };
        }

        Self::Unknown
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct LayerStyle {
    pub fill_color: Color,
    pub frame_color: Color,
    pub text_color: Color,
    pub marker_color: Color,
    pub fill_alpha: u8,
    pub frame_alpha: u8,
    pub marker_alpha: u8,
    pub fill_pattern: Pattern,
    pub line_style: LineStyle,
    pub line_width_px: u8,
    pub brightness_shift_steps: i8,
    pub composition_mode: CompositionMode,
    pub marked: bool,
}

impl LayerStyle {
    pub fn new(fill_color: Color, frame_color: Color) -> Self {
        Self {
            fill_color,
            frame_color,
            text_color: frame_color,
            marker_color: frame_color,
            fill_alpha: 72,
            frame_alpha: 235,
            marker_alpha: 245,
            fill_pattern: Pattern::Solid,
            line_style: LineStyle::Solid,
            line_width_px: 1,
            brightness_shift_steps: 0,
            composition_mode: CompositionMode::Copy,
            marked: false,
        }
    }

    pub fn default_for_index(index: usize) -> Self {
        Self::default_for_layer(index as u16, "", index)
    }

    pub fn default_for_layer(_layer_id: u16, name: &str, index: usize) -> Self {
        Self::default_for_role(LayerRole::from_layer_name(name), index)
    }

    pub fn default_for_role(role: LayerRole, index: usize) -> Self {
        match role {
            LayerRole::Overlap => {
                layer_style(Color::rgb(132, 146, 156), 22, 150, 170, Pattern::Hollow)
            }
            LayerRole::Active => {
                layer_style(Color::rgb(84, 211, 154), 56, 218, 235, Pattern::SparseDots)
            }
            LayerRole::ImplantN => {
                layer_style(Color::rgb(116, 154, 255), 44, 205, 225, Pattern::SparseDots)
            }
            LayerRole::ImplantP => {
                layer_style(Color::rgb(255, 132, 182), 44, 205, 225, Pattern::SparseDots)
            }
            LayerRole::Well => {
                layer_style(Color::rgb(80, 188, 177), 38, 178, 205, Pattern::SparseDots)
            }
            LayerRole::Poly => layer_style(
                Color::rgb(255, 132, 92),
                42,
                245,
                252,
                Pattern::DiagonalHatch,
            ),
            LayerRole::Contact => {
                layer_style(Color::rgb(255, 228, 138), 84, 248, 255, Pattern::SparseDots)
            }
            LayerRole::Metal { level } => {
                layer_style(metal_color(level), 76, 242, 250, routing_pattern(level))
            }
            LayerRole::Via { level } => {
                layer_style(via_color(level), 86, 248, 255, Pattern::SparseDots)
            }
            LayerRole::TopMetal { level } => {
                let mut style =
                    layer_style(top_metal_color(level), 84, 255, 255, Pattern::CrossHatch);
                style.line_width_px = 2;
                style
            }
            LayerRole::TopVia { level } => {
                let mut style =
                    layer_style(top_via_color(level), 90, 255, 255, Pattern::SparseDots);
                style.line_width_px = 2;
                style
            }
            LayerRole::RedistributionVia => {
                let mut style =
                    layer_style(Color::rgb(255, 240, 166), 90, 255, 255, Pattern::SparseDots);
                style.line_width_px = 2;
                style
            }
            LayerRole::Rdl => {
                let mut style = layer_style(
                    Color::rgb(255, 214, 118),
                    76,
                    255,
                    255,
                    Pattern::DiagonalHatch,
                );
                style.line_width_px = 2;
                style
            }
            LayerRole::Fill => fill_style(index),
            LayerRole::Row => row_style(),
            LayerRole::Blockage => blockage_style(),
            LayerRole::Unknown => fallback_style(index),
        }
    }

    pub fn with_context_brightness(&self, amount: f32) -> Self {
        let mut style = self.clone();
        style.fill_color = style.fill_color.shift_brightness(amount);
        style.frame_color = style.frame_color.shift_brightness(amount);
        style.text_color = style.text_color.shift_brightness(amount);
        style.marker_color = style.marker_color.shift_brightness(amount);
        style
    }

    pub fn fill_luma(&self) -> u16 {
        self.fill_color.luma()
    }

    pub fn frame_luma(&self) -> u16 {
        self.frame_color.luma()
    }
}

const ECOS_PALETTE: [Color; 12] = [
    Color::rgb(84, 168, 255),
    Color::rgb(255, 198, 88),
    Color::rgb(87, 211, 154),
    Color::rgb(255, 127, 157),
    Color::rgb(166, 137, 255),
    Color::rgb(72, 217, 223),
    Color::rgb(255, 154, 92),
    Color::rgb(152, 210, 83),
    Color::rgb(230, 123, 214),
    Color::rgb(116, 185, 131),
    Color::rgb(105, 151, 255),
    Color::rgb(222, 176, 124),
];

const METAL_COLORS: [Color; 5] = [
    Color::rgb(126, 204, 255),
    Color::rgb(255, 211, 111),
    Color::rgb(119, 225, 175),
    Color::rgb(255, 150, 185),
    Color::rgb(176, 155, 255),
];

const VIA_COLORS: [Color; 4] = [
    Color::rgb(255, 236, 150),
    Color::rgb(255, 218, 112),
    Color::rgb(255, 244, 186),
    Color::rgb(242, 224, 255),
];

fn compact_layer_name(name: &str) -> String {
    name.chars()
        .filter(|ch| ch.is_ascii_alphanumeric())
        .flat_map(char::to_uppercase)
        .collect()
}

fn parse_number_after_prefix(text: &str, prefix: &str) -> Option<u8> {
    let suffix = text.strip_prefix(prefix)?;
    let digits = suffix
        .chars()
        .take_while(|ch| ch.is_ascii_digit())
        .collect::<String>();
    if digits.is_empty() {
        return None;
    }
    digits.parse().ok()
}

fn layer_style(
    fill_color: Color,
    fill_alpha: u8,
    frame_alpha: u8,
    marker_alpha: u8,
    fill_pattern: Pattern,
) -> LayerStyle {
    let frame_color = fill_color.shift_brightness(0.42);
    let mut style = LayerStyle::new(fill_color, frame_color);
    style.text_color = frame_color;
    style.marker_color = frame_color.shift_brightness(0.16);
    style.fill_alpha = fill_alpha;
    style.frame_alpha = frame_alpha;
    style.marker_alpha = marker_alpha;
    style.fill_pattern = fill_pattern;
    style.composition_mode = CompositionMode::MaskPattern;
    style
}

fn metal_color(level: u8) -> Color {
    color_from_level(level, &METAL_COLORS)
}

fn via_color(level: u8) -> Color {
    color_from_level(level, &VIA_COLORS)
}

fn top_metal_color(level: u8) -> Color {
    match level {
        1 => Color::rgb(108, 222, 236),
        2 => Color::rgb(255, 216, 120),
        _ => Color::rgb(255, 224, 142),
    }
}

fn top_via_color(level: u8) -> Color {
    match level {
        1 => Color::rgb(160, 242, 255),
        2 => Color::rgb(255, 240, 166),
        _ => Color::rgb(255, 244, 186),
    }
}

fn color_from_level(level: u8, colors: &[Color]) -> Color {
    let index = level.saturating_sub(1) as usize % colors.len();
    colors[index]
}

fn routing_pattern(level: u8) -> Pattern {
    if level % 2 == 0 {
        Pattern::CrossHatch
    } else {
        Pattern::DiagonalHatch
    }
}

fn fill_style(index: usize) -> LayerStyle {
    let fill = ECOS_PALETTE[index % ECOS_PALETTE.len()].shift_brightness(-0.25);
    let mut style = layer_style(fill, 48, 170, 205, Pattern::SparseDots);
    style.frame_color = style.frame_color.shift_brightness(-0.12);
    style.marker_color = style.frame_color.shift_brightness(0.12);
    style
}

fn row_style() -> LayerStyle {
    layer_style(Color::rgb(100, 118, 128), 36, 130, 160, Pattern::Hollow)
}

fn blockage_style() -> LayerStyle {
    layer_style(Color::rgb(184, 92, 112), 58, 205, 220, Pattern::CrossHatch)
}

fn die_style() -> LayerStyle {
    let mut style = layer_style(Color::rgb(132, 168, 190), 0, 190, 205, Pattern::Hollow);
    style.line_width_px = 2;
    style
}

fn core_style() -> LayerStyle {
    let mut style = layer_style(Color::rgb(180, 214, 218), 0, 215, 225, Pattern::Hollow);
    style.line_width_px = 1;
    style
}

fn instance_style() -> LayerStyle {
    let mut style = layer_style(
        Color::rgb(176, 155, 255),
        34,
        205,
        220,
        Pattern::DiagonalHatch,
    );
    style.line_width_px = 1;
    style
}

fn fallback_style(index: usize) -> LayerStyle {
    layer_style(
        ECOS_PALETTE[index % ECOS_PALETTE.len()],
        64,
        225,
        240,
        Pattern::Hollow,
    )
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SourceSelector {
    PhysicalLayer(u16),
    ShapeKind(ShapeKind),
    CellFrame,
    SelectionOverlay,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DisplayLayer {
    pub id: String,
    pub name: String,
    pub source: SourceSelector,
    pub visible: bool,
    pub draw_order: i32,
    pub style: LayerStyle,
    pub pickable: bool,
}

impl DisplayLayer {
    pub fn physical_layer(layer_id: u16, name: impl Into<String>, style: LayerStyle) -> Self {
        Self {
            id: format!("layer:{layer_id}"),
            name: name.into(),
            source: SourceSelector::PhysicalLayer(layer_id),
            visible: true,
            draw_order: i32::from(layer_id),
            style,
            pickable: true,
        }
    }

    pub fn shape_kind(kind: ShapeKind, name: impl Into<String>, style: LayerStyle) -> Self {
        Self {
            id: format!("kind:{kind:?}"),
            name: name.into(),
            source: SourceSelector::ShapeKind(kind),
            visible: true,
            draw_order: 10_000,
            style,
            pickable: kind.is_queryable(),
        }
    }

    pub fn hidden(mut self) -> Self {
        self.visible = false;
        self
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ResolvedDisplayLayer {
    pub id: String,
    pub name: String,
    pub source: SourceSelector,
    pub draw_order: i32,
    pub style: LayerStyle,
    pub pickable: bool,
}

#[derive(Debug, Clone, Default)]
pub struct DisplayModel {
    layers: Vec<DisplayLayer>,
}

impl DisplayModel {
    pub fn new() -> Self {
        Self { layers: Vec::new() }
    }

    pub fn from_layout_layers(layers: &[layoutdb::LayerInfo]) -> Self {
        let mut model = Self::new();
        for (index, layer) in layers.iter().enumerate() {
            model.add_layer(DisplayLayer::physical_layer(
                layer.id,
                layer.name.clone(),
                LayerStyle::default_for_layer(layer.id, &layer.name, index),
            ));
        }
        model.add_layer(DisplayLayer::shape_kind(ShapeKind::Die, "Die", die_style()));
        model.add_layer(DisplayLayer::shape_kind(
            ShapeKind::Core,
            "Core",
            core_style(),
        ));
        model.add_layer(DisplayLayer::shape_kind(
            ShapeKind::Instance,
            "Instance",
            instance_style(),
        ));
        model
    }

    pub fn add_layer(&mut self, layer: DisplayLayer) {
        self.layers.push(layer);
    }

    pub fn layers(&self) -> &[DisplayLayer] {
        &self.layers
    }

    pub fn layers_mut(&mut self) -> &mut [DisplayLayer] {
        &mut self.layers
    }

    pub fn resolved_layers(&self) -> Vec<ResolvedDisplayLayer> {
        let mut layers = self
            .layers
            .iter()
            .filter(|layer| layer.visible)
            .map(|layer| ResolvedDisplayLayer {
                id: layer.id.clone(),
                name: layer.name.clone(),
                source: layer.source,
                draw_order: layer.draw_order,
                style: layer.style.clone(),
                pickable: layer.pickable,
            })
            .collect::<Vec<_>>();
        layers.sort_by_key(|layer| layer.draw_order);
        layers
    }
}

#[cfg(test)]
mod tests {
    use layoutdb::{LayerInfo, ShapeKind};

    use crate::{
        Color, DisplayLayer, DisplayModel, LayerRole, LayerStyle, Pattern, SourceSelector,
    };

    #[test]
    fn style_keeps_fill_and_frame_colors_separate() {
        let style = LayerStyle::new(Color::rgb(20, 40, 60), Color::rgb(220, 230, 240));

        assert_eq!(style.fill_color, Color::rgb(20, 40, 60));
        assert_eq!(style.frame_color, Color::rgb(220, 230, 240));
        assert_eq!(style.text_color, Color::rgb(220, 230, 240));
    }

    #[test]
    fn brightness_shift_preserves_channel_order() {
        let color = Color::rgb(40, 100, 180);
        let brighter = color.shift_brightness(0.5);
        let darker = color.shift_brightness(-0.5);

        assert!(brighter.r > color.r && brighter.g > color.g && brighter.b > color.b);
        assert!(darker.r < color.r && darker.g < color.g && darker.b < color.b);
        assert!(brighter.b >= brighter.g && brighter.g >= brighter.r);
        assert!(darker.b >= darker.g && darker.g >= darker.r);
    }

    #[test]
    fn resolved_display_model_skips_hidden_layers() {
        let mut model = DisplayModel::new();
        model.add_layer(DisplayLayer::physical_layer(
            1,
            "M1",
            LayerStyle::default_for_index(0),
        ));
        model.add_layer(
            DisplayLayer::physical_layer(2, "M2", LayerStyle::default_for_index(1)).hidden(),
        );

        let resolved = model.resolved_layers();

        assert_eq!(resolved.len(), 1);
        assert_eq!(resolved[0].source, SourceSelector::PhysicalLayer(1));
    }

    #[test]
    fn default_dark_styles_use_crisp_frames_and_restrained_fills() {
        let style = LayerStyle::default_for_layer(1, "M1", 0);

        assert!(style.frame_luma() > style.fill_luma());
        assert!(style.fill_alpha < style.frame_alpha);
        assert!(style.marker_alpha >= style.frame_alpha);
        assert_eq!(style.fill_pattern, Pattern::DiagonalHatch);
    }

    #[test]
    fn auxiliary_layers_are_restrained_by_default() {
        let fill = LayerStyle::default_for_layer(90, "metal fill", 4);
        let row = LayerStyle::default_for_layer(91, "row", 5);

        assert!(fill.fill_alpha <= 55);
        assert!(row.fill_alpha <= 45);
        assert_eq!(row.fill_pattern, Pattern::Hollow);
    }

    #[test]
    fn display_model_assigns_layer_styles_from_layer_identity() {
        let model = DisplayModel::from_layout_layers(&[
            LayerInfo::new(1, "M1"),
            LayerInfo::new(2, "M2"),
            LayerInfo::new(90, "fill"),
        ]);

        let layers = model.layers();

        assert_eq!(layers[0].style.fill_pattern, Pattern::DiagonalHatch);
        assert_eq!(layers[1].style.fill_pattern, Pattern::CrossHatch);
        assert!(layers[2].style.fill_alpha < layers[0].style.fill_alpha);
        assert_eq!(layers[2].style.fill_pattern, Pattern::SparseDots);
    }

    #[test]
    fn routing_layers_use_klayout_like_hatch_patterns() {
        let metal1 = LayerStyle::default_for_layer(8, "MET1", 0);
        let metal2 = LayerStyle::default_for_layer(9, "MET2", 1);
        let poly = LayerStyle::default_for_layer(6, "POLY", 2);
        let via = LayerStyle::default_for_layer(10, "VIA2", 3);

        assert_eq!(metal1.fill_pattern, Pattern::DiagonalHatch);
        assert_eq!(metal2.fill_pattern, Pattern::CrossHatch);
        assert_eq!(poly.fill_pattern, Pattern::DiagonalHatch);
        assert_eq!(via.fill_pattern, Pattern::SparseDots);
        assert!(via.fill_alpha <= 90);
    }

    #[test]
    fn display_model_includes_semantic_context_layers() {
        let model = DisplayModel::from_layout_layers(&[LayerInfo::new(1, "M1")]);
        let layers = model.layers();

        assert!(layers.iter().any(|layer| layer.source
            == SourceSelector::ShapeKind(ShapeKind::Die)
            && layer.visible
            && layer.name == "Die"));
        assert!(layers.iter().any(|layer| layer.source
            == SourceSelector::ShapeKind(ShapeKind::Core)
            && layer.visible
            && layer.name == "Core"));
        assert!(layers.iter().any(|layer| layer.source
            == SourceSelector::ShapeKind(ShapeKind::Instance)
            && layer.visible
            && layer.name == "Instance"
            && layer.style.fill_pattern != Pattern::Hollow
            && layer.style.fill_alpha > 0));
    }

    #[test]
    fn icsprout55_layer_names_map_to_stable_roles() {
        assert_eq!(LayerRole::from_layer_name("OVERLAP"), LayerRole::Overlap);
        assert_eq!(LayerRole::from_layer_name("ACT"), LayerRole::Active);
        assert_eq!(LayerRole::from_layer_name("NP"), LayerRole::ImplantN);
        assert_eq!(LayerRole::from_layer_name("PP"), LayerRole::ImplantP);
        assert_eq!(LayerRole::from_layer_name("NW1"), LayerRole::Well);
        assert_eq!(LayerRole::from_layer_name("POLY"), LayerRole::Poly);
        assert_eq!(LayerRole::from_layer_name("CT"), LayerRole::Contact);
        assert_eq!(
            LayerRole::from_layer_name("MET4"),
            LayerRole::Metal { level: 4 }
        );
        assert_eq!(
            LayerRole::from_layer_name("VIA3"),
            LayerRole::Via { level: 3 }
        );
        assert_eq!(
            LayerRole::from_layer_name("T4M2"),
            LayerRole::TopMetal { level: 2 }
        );
        assert_eq!(
            LayerRole::from_layer_name("T4V2"),
            LayerRole::TopVia { level: 2 }
        );
        assert_eq!(LayerRole::from_layer_name("RDL"), LayerRole::Rdl);
        assert_eq!(
            LayerRole::from_layer_name("RV"),
            LayerRole::RedistributionVia
        );
    }

    #[test]
    fn icsprout55_role_styles_keep_routing_textured_and_vias_sparse() {
        let metal = LayerStyle::default_for_layer(8, "MET2", 7);
        let via = LayerStyle::default_for_layer(9, "VIA2", 8);
        let active = LayerStyle::default_for_layer(2, "ACT", 1);

        assert_eq!(metal.fill_pattern, Pattern::CrossHatch);
        assert!(metal.frame_alpha >= 235);
        assert_eq!(via.fill_pattern, Pattern::SparseDots);
        assert!(via.fill_alpha <= 90);
        assert!(via.marker_alpha >= 250);
        assert_eq!(active.fill_pattern, Pattern::SparseDots);
        assert!(active.fill_alpha < metal.frame_alpha);
    }
}
