use chipgeom_format::LayerId;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum FillPattern {
    Hollow,
    Solid,
    SparseDots,
    DenseDots,
    DiagonalHatch,
    CrossHatch,
    HorizontalHatch,
    VerticalHatch,
    Grid,
    XMark,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum LayerRole {
    Overlap,
    Metal { level: u8 },
    Routing,
    Via { level: u8 },
    Cut,
    TopMetal { level: u8 },
    TopVia { level: u8 },
    RedistributionVia,
    Rdl,
    Fill,
    Row,
    Blockage,
    Implant,
    MasterSlice,
    Unknown,
}

impl LayerRole {
    pub fn label(self) -> &'static str {
        match self {
            Self::Overlap => "overlap",
            Self::Metal { .. } => "metal",
            Self::Routing => "routing",
            Self::Via { .. } => "via",
            Self::Cut => "cut",
            Self::TopMetal { .. } => "top-metal",
            Self::TopVia { .. } => "top-via",
            Self::RedistributionVia => "redistribution-via",
            Self::Rdl => "rdl",
            Self::Fill => "fill",
            Self::Row => "row",
            Self::Blockage => "blockage",
            Self::Implant => "implant",
            Self::MasterSlice => "master-slice",
            Self::Unknown => "unknown",
        }
    }

    pub fn from_metadata(name: &str, layer_type: &str) -> Self {
        let named_role = Self::from_layer_name(name);
        if named_role != Self::Unknown {
            return named_role;
        }

        match compact_layer_name(layer_type).as_str() {
            "ROUTING" => Self::Routing,
            "CUT" => Self::Cut,
            "IMPLANT" => Self::Implant,
            "MASTERSLICE" => Self::MasterSlice,
            "OVERLAP" => Self::Overlap,
            _ => Self::Unknown,
        }
    }

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
        if compact == "OVERLAP" {
            return Self::Overlap;
        }
        if compact == "RDL" {
            return Self::Rdl;
        }
        if compact == "RV" {
            return Self::RedistributionVia;
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

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct LayerStyle {
    pub layer_id: LayerId,
    pub visible: bool,
    pub rgba: [u8; 4],
    pub frame_rgba: [u8; 4],
    pub fill_alpha: u8,
    pub frame_alpha: u8,
    pub fill_pattern: FillPattern,
    pub line_width_px: u8,
}

impl LayerStyle {
    pub fn default_for_layer(layer_id: LayerId) -> Self {
        Self::default_for_metadata(layer_id, "", layer_id as usize)
    }

    pub fn default_for_metadata(layer_id: LayerId, name: &str, index: usize) -> Self {
        Self::default_for_metadata_with_type(layer_id, name, "", index)
    }

    pub fn default_for_metadata_with_type(
        layer_id: LayerId,
        name: &str,
        layer_type: &str,
        index: usize,
    ) -> Self {
        Self::default_for_role(layer_id, LayerRole::from_metadata(name, layer_type), index)
    }

    pub fn default_for_role(layer_id: LayerId, role: LayerRole, index: usize) -> Self {
        match role {
            LayerRole::Overlap => style(layer_id, [132, 146, 156], 0, 178, FillPattern::Hollow, 2),
            LayerRole::Metal { level } => style(
                layer_id,
                metal_color(level),
                44,
                190,
                routing_pattern(level),
                1,
            ),
            LayerRole::Routing => style(
                layer_id,
                fallback_color(index),
                44,
                190,
                routing_pattern(index.saturating_add(1) as u8),
                1,
            ),
            LayerRole::Via { level } => style(
                layer_id,
                via_color(level),
                46,
                150,
                FillPattern::SparseDots,
                1,
            ),
            LayerRole::Cut => style(
                layer_id,
                via_color(index.saturating_add(1) as u8),
                46,
                150,
                FillPattern::SparseDots,
                1,
            ),
            LayerRole::TopMetal { level } => style(
                layer_id,
                top_metal_color(level),
                52,
                210,
                FillPattern::CrossHatch,
                2,
            ),
            LayerRole::TopVia { level } => style(
                layer_id,
                top_via_color(level),
                52,
                160,
                FillPattern::SparseDots,
                2,
            ),
            LayerRole::RedistributionVia => style(
                layer_id,
                [255, 240, 166],
                52,
                160,
                FillPattern::SparseDots,
                2,
            ),
            LayerRole::Rdl => style(
                layer_id,
                [255, 214, 118],
                52,
                210,
                FillPattern::DiagonalHatch,
                2,
            ),
            LayerRole::Fill => style(
                layer_id,
                darken(fallback_color(index), 0.25),
                48,
                170,
                FillPattern::SparseDots,
                1,
            ),
            LayerRole::Row => style(layer_id, [100, 118, 128], 0, 150, FillPattern::Hollow, 1),
            LayerRole::Blockage => style(
                layer_id,
                [184, 92, 112],
                58,
                205,
                FillPattern::CrossHatch,
                1,
            ),
            LayerRole::Implant => style(
                layer_id,
                [116, 185, 131],
                34,
                150,
                FillPattern::SparseDots,
                1,
            ),
            LayerRole::MasterSlice => {
                style(layer_id, [100, 118, 128], 26, 140, FillPattern::Hollow, 1)
            }
            LayerRole::Unknown => style(
                layer_id,
                fallback_color(index),
                64,
                225,
                FillPattern::Hollow,
                1,
            ),
        }
    }
}

fn style(
    layer_id: LayerId,
    rgb: [u8; 3],
    fill_alpha: u8,
    frame_alpha: u8,
    fill_pattern: FillPattern,
    line_width_px: u8,
) -> LayerStyle {
    LayerStyle {
        layer_id,
        visible: true,
        rgba: [rgb[0], rgb[1], rgb[2], fill_alpha],
        frame_rgba: [
            brighten(rgb[0], 0.42),
            brighten(rgb[1], 0.42),
            brighten(rgb[2], 0.42),
            frame_alpha,
        ],
        fill_alpha,
        frame_alpha,
        fill_pattern,
        line_width_px,
    }
}

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
    (!digits.is_empty()).then(|| digits.parse().ok()).flatten()
}

fn brighten(channel: u8, amount: f32) -> u8 {
    (channel as f32 + (255.0 - channel as f32) * amount)
        .round()
        .clamp(0.0, 255.0) as u8
}

fn darken(rgb: [u8; 3], amount: f32) -> [u8; 3] {
    rgb.map(|channel| (channel as f32 * (1.0 - amount)).round() as u8)
}

fn fallback_color(index: usize) -> [u8; 3] {
    const COLORS: [[u8; 3]; 12] = [
        [84, 168, 255],
        [255, 198, 88],
        [87, 211, 154],
        [255, 127, 157],
        [166, 137, 255],
        [72, 217, 223],
        [255, 154, 92],
        [152, 210, 83],
        [230, 123, 214],
        [116, 185, 131],
        [105, 151, 255],
        [222, 176, 124],
    ];
    COLORS[index % COLORS.len()]
}

fn metal_color(level: u8) -> [u8; 3] {
    const COLORS: [[u8; 3]; 5] = [
        [126, 204, 255],
        [255, 211, 111],
        [119, 225, 175],
        [255, 150, 185],
        [176, 155, 255],
    ];
    COLORS[level.saturating_sub(1) as usize % COLORS.len()]
}

fn via_color(level: u8) -> [u8; 3] {
    const COLORS: [[u8; 3]; 4] = [
        [255, 236, 150],
        [255, 218, 112],
        [255, 244, 186],
        [242, 224, 255],
    ];
    COLORS[level.saturating_sub(1) as usize % COLORS.len()]
}

fn top_metal_color(level: u8) -> [u8; 3] {
    match level {
        1 => [108, 222, 236],
        2 => [255, 216, 120],
        _ => [255, 224, 142],
    }
}

fn top_via_color(level: u8) -> [u8; 3] {
    match level {
        1 => [160, 242, 255],
        2 => [255, 240, 166],
        _ => [255, 244, 186],
    }
}

fn routing_pattern(level: u8) -> FillPattern {
    if level % 2 == 0 {
        FillPattern::CrossHatch
    } else {
        FillPattern::DiagonalHatch
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn routing_layers_use_distinct_layout_viewer_patterns() {
        assert_eq!(
            LayerRole::from_layer_name("MET1"),
            LayerRole::Metal { level: 1 }
        );
        assert_eq!(
            LayerRole::from_layer_name("MET2"),
            LayerRole::Metal { level: 2 }
        );
        assert_eq!(
            LayerStyle::default_for_metadata(1, "MET1", 0).fill_pattern,
            FillPattern::DiagonalHatch
        );
        assert_eq!(
            LayerStyle::default_for_metadata(2, "MET2", 1).fill_pattern,
            FillPattern::CrossHatch
        );
    }

    #[test]
    fn layer_type_metadata_styles_layers_without_canonical_names() {
        assert_eq!(
            LayerRole::from_metadata("routing_foo", "routing"),
            LayerRole::Routing
        );
        assert_eq!(LayerRole::from_metadata("", "CUT"), LayerRole::Cut);
        assert_eq!(
            LayerRole::from_metadata("", "MASTERSLICE"),
            LayerRole::MasterSlice
        );

        let routing = LayerStyle::default_for_metadata_with_type(10, "routing_foo", "routing", 1);
        let cut = LayerStyle::default_for_metadata_with_type(11, "", "cut", 2);

        assert_eq!(routing.fill_pattern, FillPattern::CrossHatch);
        assert_eq!(cut.fill_pattern, FillPattern::SparseDots);
    }

    #[test]
    fn layer_roles_have_stable_display_labels() {
        assert_eq!(LayerRole::Metal { level: 4 }.label(), "metal");
        assert_eq!(LayerRole::Cut.label(), "cut");
        assert_eq!(LayerRole::Blockage.label(), "blockage");
        assert_eq!(LayerRole::Unknown.label(), "unknown");
    }

    #[test]
    fn overlap_is_an_unfilled_boundary_layer() {
        let style = LayerStyle::default_for_metadata(0, "OVERLAP", 0);

        assert_eq!(style.fill_pattern, FillPattern::Hollow);
        assert_eq!(style.fill_alpha, 0);
        assert_eq!(style.line_width_px, 2);
    }
}
