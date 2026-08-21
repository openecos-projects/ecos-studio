#[derive(Clone, Copy, PartialEq, Eq, Debug, Default, Hash)]
pub enum ColorTheme {
    #[default]
    Foundry,
    Classic,
    Vivid,
    DieShot,
    Playful,
    Cyber,
}

impl ColorTheme {
    pub const ALL: &'static [ColorTheme] = &[
        ColorTheme::Foundry,
        ColorTheme::Classic,
        ColorTheme::Vivid,
        ColorTheme::DieShot,
        ColorTheme::Playful,
        ColorTheme::Cyber,
    ];

    pub fn label(self) -> &'static str {
        match self {
            Self::Foundry => "Foundry",
            Self::Classic => "Classic",
            Self::Vivid => "Vivid",
            Self::DieShot => "Die Shot",
            Self::Playful => "Playful",
            Self::Cyber => "Cyber",
        }
    }

    pub fn background_rgba(self) -> [f32; 4] {
        match self {
            Self::Classic => [0.05, 0.06, 0.08, 1.0],
            Self::Foundry => [0.063, 0.071, 0.086, 1.0],
            Self::Vivid => [0.04, 0.04, 0.05, 1.0],
            Self::DieShot => [0.02, 0.02, 0.03, 1.0],
            Self::Playful => [0.11, 0.09, 0.13, 1.0],
            Self::Cyber => [0.02, 0.03, 0.06, 1.0],
        }
    }
}

#[derive(Clone, Copy, PartialEq, Eq, Debug, Default, Hash)]
pub enum LightingPreset {
    #[default]
    Studio,
    Laboratory,
    Dramatic,
    Blueprint,
    Softbox,
}

impl LightingPreset {
    pub const ALL: &'static [LightingPreset] = &[
        LightingPreset::Studio,
        LightingPreset::Laboratory,
        LightingPreset::Dramatic,
        LightingPreset::Blueprint,
        LightingPreset::Softbox,
    ];

    pub fn label(self) -> &'static str {
        match self {
            Self::Studio => "3-Point",
            Self::Laboratory => "Neutral",
            Self::Dramatic => "Contrast",
            Self::Blueprint => "Emissive",
            Self::Softbox => "Broad",
        }
    }
}

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
    pub fn role_code(self) -> u8 {
        match self {
            Self::Overlap => 0,
            Self::Metal { level } => 10 + level.min(30),
            Self::Routing => 1,
            Self::Via { level } => 50 + level.min(30),
            Self::Cut => 2,
            Self::TopMetal { level } => 90 + level.min(9),
            Self::TopVia { level } => 100 + level.min(9),
            Self::RedistributionVia => 110,
            Self::Rdl => 111,
            Self::Fill => 3,
            Self::Row => 4,
            Self::Blockage => 5,
            Self::Implant => 6,
            Self::MasterSlice => 7,
            Self::Unknown => 255,
        }
    }

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
        if let Some(level) = parse_number_after_prefix(&compact, "VIA") {
            return Self::Via { level };
        }
        if let Some(level) = parse_number_after_prefix(&compact, "M") {
            return Self::Metal { level };
        }
        if let Some(level) = parse_number_after_prefix(&compact, "V") {
            return Self::Via { level };
        }
        if compact.contains("POLY") || compact == "PO" {
            return Self::MasterSlice;
        }
        if compact.contains("CONT") || compact.contains("CONTACT") || compact == "CO" {
            return Self::Cut;
        }
        Self::Unknown
    }
}

#[derive(Clone, Copy, PartialEq, Eq, Debug, Hash)]
#[repr(u8)]
pub enum MaterialKind {
    Silicon = 0,
    Dielectric = 1,
    Copper = 2,
    Aluminum = 3,
    Tungsten = 4,
    Poly = 5,
    Via = 6,
    Passivation = 7,
    Blockage = 8,
    Implant = 9,
    Fill = 10,
    Rdl = 11,
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct MaterialParams {
    pub metalness: f32,
    pub roughness: f32,
    pub specular: f32,
    pub emission: f32,
    pub alpha: f32,
}

impl MaterialKind {
    pub fn from_role(role: LayerRole) -> Self {
        match role {
            LayerRole::Metal { level } => {
                if level >= 5 {
                    Self::Copper
                } else {
                    Self::Aluminum
                }
            }
            LayerRole::TopMetal { .. } => Self::Aluminum,
            LayerRole::Rdl => Self::Rdl,
            LayerRole::Via { .. }
            | LayerRole::TopVia { .. }
            | LayerRole::Cut
            | LayerRole::RedistributionVia => Self::Via,
            LayerRole::MasterSlice => Self::Poly,
            LayerRole::Implant => Self::Implant,
            LayerRole::Blockage => Self::Blockage,
            LayerRole::Fill => Self::Fill,
            LayerRole::Overlap => Self::Passivation,
            LayerRole::Routing => Self::Copper,
            _ => Self::Silicon,
        }
    }

    pub fn default_params(self) -> MaterialParams {
        match self {
            Self::Copper => MaterialParams {
                metalness: 0.95,
                roughness: 0.18,
                specular: 0.85,
                emission: 0.0,
                alpha: 1.0,
            },
            Self::Aluminum => MaterialParams {
                metalness: 0.90,
                roughness: 0.25,
                specular: 0.80,
                emission: 0.0,
                alpha: 1.0,
            },
            Self::Tungsten | Self::Via => MaterialParams {
                metalness: 0.85,
                roughness: 0.32,
                specular: 0.65,
                emission: 0.0,
                alpha: 1.0,
            },
            Self::Silicon => MaterialParams {
                metalness: 0.05,
                roughness: 0.70,
                specular: 0.20,
                emission: 0.0,
                alpha: 1.0,
            },
            Self::Poly => MaterialParams {
                metalness: 0.10,
                roughness: 0.60,
                specular: 0.35,
                emission: 0.0,
                alpha: 1.0,
            },
            Self::Dielectric | Self::Passivation => MaterialParams {
                metalness: 0.0,
                roughness: 0.35,
                specular: 0.40,
                emission: 0.0,
                alpha: 0.40,
            },
            Self::Implant => MaterialParams {
                metalness: 0.0,
                roughness: 0.95,
                specular: 0.05,
                emission: 0.0,
                alpha: 0.55,
            },
            Self::Blockage => MaterialParams {
                metalness: 0.0,
                roughness: 1.0,
                specular: 0.0,
                emission: 0.05,
                alpha: 0.30,
            },
            Self::Fill => MaterialParams {
                metalness: 0.30,
                roughness: 0.80,
                specular: 0.10,
                emission: 0.0,
                alpha: 0.15,
            },
            Self::Rdl => MaterialParams {
                metalness: 0.98,
                roughness: 0.12,
                specular: 0.95,
                emission: 0.0,
                alpha: 1.0,
            },
        }
    }

    pub fn pack_params(params: MaterialParams) -> u32 {
        let m = (params.metalness.clamp(0.0, 1.0) * 255.0).round() as u32;
        let r = (params.roughness.clamp(0.0, 1.0) * 255.0).round() as u32;
        let s = (params.specular.clamp(0.0, 1.0) * 255.0).round() as u32;
        let e = (params.emission.clamp(0.0, 1.0) * 255.0).round() as u32;
        m | (r << 8) | (s << 16) | (e << 24)
    }

    pub fn pack_semantic_info(
        role: LayerRole,
        material: MaterialKind,
        layer_level: u8,
        layer_id: u16,
    ) -> u32 {
        let role_byte = role.role_code();
        let mat_byte = material as u8;
        let level_byte = layer_level;
        let lid_byte = (layer_id & 0xFF) as u8;
        (role_byte as u32)
            | ((mat_byte as u32) << 8)
            | ((level_byte as u32) << 16)
            | ((lid_byte as u32) << 24)
    }
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct IridescenceParams {
    pub strength: f32,
    pub speed: f32,
    pub phase_offset: f32,
}

pub type ShimmerParams = IridescenceParams;

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct RenderStyle {
    pub base: LayerStyle,
    pub metalness: f32,
    pub roughness: f32,
    pub specular: f32,
    pub emissive: Option<[f32; 3]>,
    pub iridescence: Option<IridescenceParams>,
}

impl RenderStyle {
    pub fn for_layer(
        layer_id: LayerId,
        role: LayerRole,
        index: usize,
        theme: ColorTheme,
        style_mode: u32,
    ) -> Self {
        let base = LayerStyle::default_for_role(layer_id, role, index, theme);
        let mat = MaterialKind::from_role(role);
        let params = mat.default_params();
        match style_mode {
            0 => Self {
                base,
                metalness: params.metalness,
                roughness: params.roughness,
                specular: params.specular,
                emissive: None,
                iridescence: None,
            },
            1 => {
                let mut cartoon_base = base;
                let dark_edge = [
                    (base.rgba[0] as f32 * 0.25).round() as u8,
                    (base.rgba[1] as f32 * 0.25).round() as u8,
                    (base.rgba[2] as f32 * 0.25).round() as u8,
                    255,
                ];
                cartoon_base.frame_rgba = dark_edge;
                cartoon_base.line_width_px = 2;
                Self {
                    base: cartoon_base,
                    metalness: 0.0,
                    roughness: 0.95,
                    specular: 0.40,
                    emissive: None,
                    iridescence: None,
                }
            }
            2 => {
                let emissive_color = match role {
                    LayerRole::TopMetal { .. } | LayerRole::Rdl => [1.0, 0.70, 0.0],
                    LayerRole::Via { .. }
                    | LayerRole::TopVia { .. }
                    | LayerRole::Cut
                    | LayerRole::RedistributionVia => [0.15, 0.50, 1.0],
                    LayerRole::Implant => [0.0, 0.90, 0.45],
                    LayerRole::Blockage => [1.0, 0.10, 0.25],
                    _ => [0.0, 0.90, 1.0],
                };
                Self {
                    base,
                    metalness: 0.20,
                    roughness: 0.40,
                    specular: 0.70,
                    emissive: Some(emissive_color),
                    iridescence: None,
                }
            }
            3 => {
                let level = match role {
                    LayerRole::Metal { level } | LayerRole::Via { level } => level as f32,
                    LayerRole::TopMetal { level } | LayerRole::TopVia { level } => {
                        6.0 + level as f32
                    }
                    _ => index as f32,
                };
                Self {
                    base,
                    metalness: 0.95,
                    roughness: 0.15,
                    specular: 0.90,
                    emissive: None,
                    iridescence: Some(IridescenceParams {
                        strength: 0.35,
                        speed: 0.02,
                        phase_offset: level * 0.5,
                    }),
                }
            }
            _ => {
                let glow = [
                    (base.rgba[0] as f32 / 255.0) * 1.5,
                    (base.rgba[1] as f32 / 255.0) * 1.5,
                    (base.rgba[2] as f32 / 255.0) * 1.5,
                ];
                Self {
                    base,
                    metalness: 0.10,
                    roughness: 0.20,
                    specular: 0.95,
                    emissive: Some(glow),
                    iridescence: None,
                }
            }
        }
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
    pub fn default_for_layer(layer_id: LayerId, theme: ColorTheme) -> Self {
        Self::default_for_metadata(layer_id, "", layer_id as usize, theme)
    }

    pub fn default_for_metadata(
        layer_id: LayerId,
        name: &str,
        index: usize,
        theme: ColorTheme,
    ) -> Self {
        Self::default_for_metadata_with_type(layer_id, name, "", index, theme)
    }

    pub fn default_for_metadata_with_type(
        layer_id: LayerId,
        name: &str,
        layer_type: &str,
        index: usize,
        theme: ColorTheme,
    ) -> Self {
        Self::default_for_role(
            layer_id,
            LayerRole::from_metadata(name, layer_type),
            index,
            theme,
        )
    }

    pub fn default_for_role(
        layer_id: LayerId,
        role: LayerRole,
        index: usize,
        theme: ColorTheme,
    ) -> Self {
        match role {
            LayerRole::Overlap => style(layer_id, [132, 146, 156], 0, 178, FillPattern::Hollow, 2),
            LayerRole::Metal { level } => style(
                layer_id,
                metal_color(level, theme),
                44,
                190,
                routing_pattern(level, theme),
                1,
            ),
            LayerRole::Routing => style(
                layer_id,
                fallback_color(index, theme),
                44,
                190,
                routing_pattern(index.saturating_add(1) as u8, theme),
                1,
            ),
            LayerRole::Via { level } => style(
                layer_id,
                via_color(level, theme),
                46,
                150,
                FillPattern::SparseDots,
                1,
            ),
            LayerRole::Cut => style(
                layer_id,
                via_color(index.saturating_add(1) as u8, theme),
                46,
                150,
                FillPattern::SparseDots,
                1,
            ),
            LayerRole::TopMetal { level } => style(
                layer_id,
                top_metal_color(level, theme),
                52,
                210,
                FillPattern::CrossHatch,
                2,
            ),
            LayerRole::TopVia { level } => style(
                layer_id,
                top_via_color(level, theme),
                52,
                160,
                FillPattern::SparseDots,
                2,
            ),
            LayerRole::RedistributionVia => style(
                layer_id,
                top_via_color(8, theme),
                52,
                160,
                FillPattern::SparseDots,
                2,
            ),
            LayerRole::Rdl => style(
                layer_id,
                top_metal_color(8, theme),
                52,
                210,
                FillPattern::DiagonalHatch,
                2,
            ),
            LayerRole::Fill => style(
                layer_id,
                darken(fallback_color(index, theme), 0.25),
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
                fallback_color(index, theme),
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

fn fallback_color(index: usize, theme: ColorTheme) -> [u8; 3] {
    match theme {
        ColorTheme::Foundry => {
            const COLORS: [[u8; 3]; 7] = [
                [78, 131, 181],  // M1 Steel-blue #4E83B5
                [85, 156, 168],  // M2 Blue-teal #559CA8
                [121, 175, 160], // M3 Sage #79AFA0
                [194, 155, 99],  // M4 Gold #C29B63
                [199, 122, 75],  // M5 Warm Copper #C77A4B
                [181, 107, 85],  // M6 Copper #B56B55
                [167, 173, 181], // M7 Silver #A7ADB5
            ];
            COLORS[index % COLORS.len()]
        }
        ColorTheme::Classic => {
            const COLORS: [[u8; 3]; 7] = [
                [65, 130, 240], // M1 Blue
                [240, 140, 40], // M2 Orange
                [50, 180, 80],  // M3 Green
                [235, 205, 50], // M4 Yellow
                [195, 70, 215], // M5 Magenta
                [40, 200, 220], // M6 Cyan
                [215, 80, 110], // M7 Coral
            ];
            COLORS[index % COLORS.len()]
        }
        ColorTheme::Playful => {
            const COLORS: [[u8; 3]; 8] = [
                [255, 89, 94],
                [255, 202, 58],
                [138, 201, 38],
                [25, 130, 196],
                [106, 76, 175],
                [255, 158, 157],
                [56, 193, 182],
                [255, 146, 43],
            ];
            COLORS[index % COLORS.len()]
        }
        ColorTheme::DieShot => {
            const COLORS: [[u8; 3]; 6] = [
                [184, 115, 51],
                [212, 160, 23],
                [194, 120, 100],
                [220, 145, 45],
                [205, 105, 50],
                [230, 180, 70],
            ];
            COLORS[index % COLORS.len()]
        }
        ColorTheme::Vivid => {
            const COLORS: [[u8; 3]; 7] = [
                [0, 210, 255],   // M1 Cyan
                [255, 90, 130],  // M2 Hot Pink
                [190, 255, 90],  // M3 Acid Lime
                [190, 110, 255], // M4 Violet
                [255, 200, 40],  // M5 Amber
                [80, 140, 255],  // M6 Cobalt
                [255, 140, 60],  // M7 Tangerine
            ];
            COLORS[index % COLORS.len()]
        }
        ColorTheme::Cyber => {
            const COLORS: [[u8; 3]; 6] = [
                [0, 229, 255],  // Cyan
                [213, 0, 249],  // Magenta
                [0, 230, 118],  // Neon Green
                [255, 214, 0],  // Neon Amber
                [255, 23, 68],  // Neon Red
                [101, 31, 255], // Deep Violet
            ];
            COLORS[index % COLORS.len()]
        }
    }
}

fn metal_color(level: u8, theme: ColorTheme) -> [u8; 3] {
    match theme {
        ColorTheme::Foundry => {
            const COLORS: [[u8; 3]; 7] = [
                [78, 131, 181],  // M1 Steel-blue #4E83B5
                [85, 156, 168],  // M2 Blue-teal #559CA8
                [121, 175, 160], // M3 Sage #79AFA0
                [194, 155, 99],  // M4 Gold #C29B63
                [199, 122, 75],  // M5 Warm Copper #C77A4B
                [181, 107, 85],  // M6 Copper #B56B55
                [167, 173, 181], // M7 Silver #A7ADB5
            ];
            COLORS[level.saturating_sub(1) as usize % COLORS.len()]
        }
        ColorTheme::Classic => {
            const COLORS: [[u8; 3]; 7] = [
                [65, 130, 240], // M1 Blue
                [240, 140, 40], // M2 Orange
                [50, 180, 80],  // M3 Green
                [235, 205, 50], // M4 Yellow
                [195, 70, 215], // M5 Magenta
                [40, 200, 220], // M6 Cyan
                [215, 80, 110], // M7 Coral
            ];
            COLORS[level.saturating_sub(1) as usize % COLORS.len()]
        }
        ColorTheme::Vivid => {
            const COLORS: [[u8; 3]; 7] = [
                [0, 210, 255],   // M1 Electric Cyan
                [255, 90, 130],  // M2 Hot Pink
                [190, 255, 90],  // M3 Acid Lime
                [190, 110, 255], // M4 Violet
                [255, 200, 40],  // M5 Amber
                [80, 140, 255],  // M6 Cobalt
                [255, 140, 60],  // M7 Tangerine
            ];
            COLORS[level.saturating_sub(1) as usize % COLORS.len()]
        }
        ColorTheme::Playful => {
            const COLORS: [[u8; 3]; 5] = [
                [255, 110, 199], // bubblegum pink
                [255, 209, 71],  // sunshine yellow
                [79, 195, 247],  // sky blue
                [139, 195, 74],  // grass green
                [179, 136, 255], // grape purple
            ];
            COLORS[level.saturating_sub(1) as usize % COLORS.len()]
        }
        // 4. DieShot — Monochrome Material Realism
        ColorTheme::DieShot => {
            const COLORS: [[u8; 3]; 6] = [
                [184, 115, 51],  // Copper
                [212, 160, 23],  // Gold
                [194, 120, 100], // Rosy Bronze
                [220, 145, 45],  // Amber Gold
                [205, 105, 50],  // Deep Copper
                [230, 180, 70],  // Bright Gold
            ];
            COLORS[level.saturating_sub(1) as usize % COLORS.len()]
        }
        ColorTheme::Cyber => {
            const COLORS: [[u8; 3]; 7] = [
                [0, 229, 255],   // M1 Cyan
                [213, 0, 249],   // M2 Magenta
                [0, 230, 118],   // M3 Neon Green
                [255, 214, 0],   // M4 Neon Amber
                [255, 23, 68],   // M5 Neon Red
                [101, 31, 255],  // M6 Deep Violet
                [255, 255, 255], // M7 White
            ];
            COLORS[level.saturating_sub(1) as usize % COLORS.len()]
        }
    }
}

fn via_color(_level: u8, theme: ColorTheme) -> [u8; 3] {
    match theme {
        ColorTheme::Foundry => [197, 200, 204], // Neutral metallic #C5C8CC
        ColorTheme::Classic => [245, 240, 220],
        ColorTheme::Vivid => [255, 255, 255], // Pure white high-contrast
        ColorTheme::Playful => [255, 152, 0], // Tangerine candy
        ColorTheme::DieShot => [235, 235, 240], // Tungsten
        ColorTheme::Cyber => [118, 255, 3],   // Lime
    }
}

fn top_metal_color(level: u8, theme: ColorTheme) -> [u8; 3] {
    match theme {
        ColorTheme::Foundry => [167, 173, 181], // Top silver/aluminum #A7ADB5
        ColorTheme::Classic => match level {
            1..=7 => [215, 70, 95],
            _ => [210, 145, 55],
        },
        ColorTheme::Vivid => [255, 220, 50],  // Electric gold
        ColorTheme::Playful => [255, 87, 87], // Candy-apple red
        ColorTheme::DieShot => [255, 204, 51],
        ColorTheme::Cyber => [255, 145, 0], // Orange
    }
}

fn top_via_color(_level: u8, theme: ColorTheme) -> [u8; 3] {
    match theme {
        ColorTheme::Foundry => [200, 200, 205], // Passivation opening
        ColorTheme::Classic => [250, 245, 230],
        ColorTheme::Vivid => [0, 255, 220], // cyan
        ColorTheme::Playful => [255, 183, 77],
        ColorTheme::DieShot => [250, 235, 190],
        ColorTheme::Cyber => [255, 255, 255],
    }
}

fn routing_pattern(level: u8, theme: ColorTheme) -> FillPattern {
    match theme {
        ColorTheme::Playful => {
            if level % 2 == 0 {
                FillPattern::DenseDots
            } else {
                FillPattern::SparseDots
            }
        }
        _ => {
            if level % 2 == 0 {
                FillPattern::CrossHatch
            } else {
                FillPattern::DiagonalHatch
            }
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct LayerStackBand {
    pub layer_id: LayerId,
    pub z0: f32,
    pub z1: f32,
}

impl LayerStackBand {
    pub fn mid(self) -> f32 {
        (self.z0 + self.z1) * 0.5
    }

    pub fn thickness(self) -> f32 {
        (self.z1 - self.z0).max(0.0)
    }
}

#[derive(Clone, Debug, Default, PartialEq)]
pub struct LayerStack {
    pub bands: Vec<LayerStackBand>,
}

impl LayerStack {
    pub fn height(&self) -> f32 {
        self.bands
            .iter()
            .map(|band| band.z1)
            .fold(0.0_f32, f32::max)
    }

    pub fn band(&self, layer_id: LayerId) -> Option<LayerStackBand> {
        self.bands
            .iter()
            .copied()
            .find(|band| band.layer_id == layer_id)
    }

    pub fn auto_z_scale(&self, world_width: f32, world_height: f32) -> f32 {
        let stack_height = self.height().max(1.0);
        let diagonal = (world_width.hypot(world_height)).max(1.0);
        (diagonal * 0.02 / stack_height).clamp(0.1, 4.0)
    }
}

pub fn heuristic_layer_stack(
    layers: impl IntoIterator<Item = (LayerId, LayerRole, u32)>,
) -> LayerStack {
    let mut entries: Vec<(u32, u32, LayerId, LayerRole)> = layers
        .into_iter()
        .map(|(layer_id, role, order)| {
            let (major, minor) = stack_sort_key(role, order);
            (major, minor, layer_id, role)
        })
        .collect();
    entries.sort_by_key(|(major, minor, layer_id, _)| (*major, *minor, *layer_id));

    let mut bands = Vec::with_capacity(entries.len());
    let mut cursor = 0.0_f32;
    for (_, _, layer_id, role) in entries {
        let thickness = heuristic_layer_thickness(role);
        let z0 = cursor;
        let z1 = cursor + thickness;
        bands.push(LayerStackBand { layer_id, z0, z1 });
        cursor = z1;
    }
    LayerStack { bands }
}

fn stack_sort_key(role: LayerRole, order: u32) -> (u32, u32) {
    match role {
        LayerRole::Row => (5, order),
        LayerRole::Implant | LayerRole::MasterSlice => (10, order),
        LayerRole::Blockage => (15, order),
        LayerRole::Overlap => (20, order),
        LayerRole::Fill => (25, order),
        LayerRole::Unknown => (30 + order, 0),
        LayerRole::Metal { level } => (100 + u32::from(level) * 2, 0),
        LayerRole::Routing => (100 + order.saturating_mul(2), 1),
        LayerRole::Via { level } => (101 + u32::from(level) * 2, 0),
        LayerRole::Cut => (101 + order.saturating_mul(2), 1),
        LayerRole::TopMetal { level } => (300 + u32::from(level) * 2, 0),
        LayerRole::TopVia { level } => (301 + u32::from(level) * 2, 0),
        LayerRole::RedistributionVia => (398, order),
        LayerRole::Rdl => (400, order),
    }
}

fn heuristic_layer_thickness(role: LayerRole) -> f32 {
    match role {
        LayerRole::Row | LayerRole::Blockage | LayerRole::Implant | LayerRole::MasterSlice => 200.0,
        LayerRole::Overlap | LayerRole::Fill => 100.0,
        LayerRole::Metal { .. } | LayerRole::Routing => 1000.0,
        LayerRole::Via { .. } | LayerRole::Cut => 600.0,
        LayerRole::TopMetal { .. } => 1200.0,
        LayerRole::TopVia { .. } => 800.0,
        LayerRole::RedistributionVia => 800.0,
        LayerRole::Rdl => 1400.0,
        LayerRole::Unknown => 300.0,
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
            LayerStyle::default_for_metadata(1, "MET1", 0, ColorTheme::Vivid).fill_pattern,
            FillPattern::DiagonalHatch
        );
        assert_eq!(
            LayerStyle::default_for_metadata(2, "MET2", 1, ColorTheme::Vivid).fill_pattern,
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

        let routing = LayerStyle::default_for_metadata_with_type(
            10,
            "routing_foo",
            "routing",
            1,
            ColorTheme::Vivid,
        );
        let cut = LayerStyle::default_for_metadata_with_type(11, "", "cut", 2, ColorTheme::Vivid);

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
        let style = LayerStyle::default_for_metadata(0, "OVERLAP", 0, ColorTheme::Vivid);

        assert_eq!(style.fill_pattern, FillPattern::Hollow);
        assert_eq!(style.fill_alpha, 0);
        assert_eq!(style.line_width_px, 2);
    }

    #[test]
    fn heuristic_stack_orders_metal_via_metal() {
        let stack = heuristic_layer_stack([
            (2, LayerRole::Metal { level: 2 }, 20),
            (3, LayerRole::Via { level: 1 }, 15),
            (1, LayerRole::Metal { level: 1 }, 10),
        ]);

        assert_eq!(
            stack
                .bands
                .iter()
                .map(|band| band.layer_id)
                .collect::<Vec<_>>(),
            vec![1, 3, 2]
        );
        assert!(stack.band(1).unwrap().z1 <= stack.band(3).unwrap().z0 + 0.01);
        assert!(stack.band(3).unwrap().z1 <= stack.band(2).unwrap().z0 + 0.01);
        assert!(stack.height() > 2500.0);
        assert!(stack.band(3).unwrap().thickness() < stack.band(1).unwrap().thickness() * 0.7);
    }
}
