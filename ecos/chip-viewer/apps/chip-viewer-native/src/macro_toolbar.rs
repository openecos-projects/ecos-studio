//! ECOS-native macro toolbox UI.
//!
//! The panel is deliberately organized by operator intent rather than by a
//! legacy icon matrix: move, spacing, alignment, transforms, arrangement, and
//! preferences/status. All actions are emitted as [`MacroOp`] values so the
//! planner remains independent from egui.

use std::fs;
use std::path::PathBuf;

use eframe::egui;
use serde::{Deserialize, Serialize};

use crate::macro_ops::{
    AlignAxis, AlignEdge, AlignReference, BoundaryEdge, BoundaryTarget, Corner, MacroOp,
    MacroTransform, PackDirection, PlacementStatus, ShiftDirection,
};

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub(crate) struct MacroToolboxPreferences {
    pub shift_um: f64,
    pub space_um: f64,
    pub x_space_um: f64,
    pub y_space_um: f64,
    pub pack_gap_um: f64,
    pub array_rows: usize,
    pub array_columns: usize,
    pub array_x_gap_um: f64,
    pub array_y_gap_um: f64,
    pub snap_enabled: bool,
    pub snap_x_um: f64,
    pub snap_y_um: f64,
    pub keep_relative: bool,
    pub one_by_one: bool,
    pub shift_target: BoundaryTarget,
    pub space_target: BoundaryTarget,
    pub align_reference: AlignReference,
    pub pack_direction: PackDirection,
    pub placement_status: PlacementStatus,
}

impl MacroToolboxPreferences {
    pub(crate) fn load_persisted() -> Self {
        #[cfg(test)]
        {
            return Self::default();
        }
        #[cfg(not(test))]
        {
            preference_path()
                .and_then(|path| fs::read_to_string(path).ok())
                .and_then(|content| serde_json::from_str(&content).ok())
                .unwrap_or_default()
        }
    }

    pub(crate) fn persist(&self) -> Result<(), String> {
        let path =
            preference_path().ok_or_else(|| "user config directory is unavailable".to_string())?;
        let parent = path
            .parent()
            .ok_or_else(|| "macro toolbox preference path has no parent".to_string())?;
        fs::create_dir_all(parent)
            .map_err(|error| format!("failed to create {}: {error}", parent.display()))?;
        let content = serde_json::to_string_pretty(self)
            .map_err(|error| format!("failed to serialize macro toolbox preferences: {error}"))?;
        fs::write(&path, format!("{content}\n"))
            .map_err(|error| format!("failed to write {}: {error}", path.display()))
    }
}

fn preference_path() -> Option<PathBuf> {
    if cfg!(target_os = "windows") {
        return std::env::var_os("APPDATA")
            .map(PathBuf::from)
            .map(|root| root.join("ECOS Studio").join("macro-toolbox.json"));
    }
    if cfg!(target_os = "macos") {
        return std::env::var_os("HOME").map(PathBuf::from).map(|root| {
            root.join("Library")
                .join("Application Support")
                .join("ECOS Studio")
                .join("macro-toolbox.json")
        });
    }
    let root = std::env::var_os("XDG_CONFIG_HOME")
        .map(PathBuf::from)
        .or_else(|| std::env::var_os("HOME").map(|home| PathBuf::from(home).join(".config")))?;
    Some(root.join("ecos-studio").join("macro-toolbox.json"))
}

impl Default for MacroToolboxPreferences {
    fn default() -> Self {
        Self {
            shift_um: 1.0,
            space_um: 1.0,
            x_space_um: 1.0,
            y_space_um: 1.0,
            pack_gap_um: 1.0,
            array_rows: 1,
            array_columns: 2,
            array_x_gap_um: 1.0,
            array_y_gap_um: 1.0,
            snap_enabled: false,
            snap_x_um: 1.0,
            snap_y_um: 1.0,
            keep_relative: true,
            one_by_one: false,
            shift_target: BoundaryTarget::Core,
            space_target: BoundaryTarget::Core,
            align_reference: AlignReference::SelectionBounds,
            pack_direction: PackDirection::Left,
            placement_status: PlacementStatus::Placed,
        }
    }
}

/// Selection summary the toolbar is enabled against. Kept as a plain value
/// so the egui code stays free of database borrows.
pub(crate) struct MacroToolbarState {
    pub unplaced_count: usize,
    pub selected_count: usize,
    pub placed_selected_count: usize,
    pub unplaced_stdcell_count: u64,
    pub first_selected_name: Option<String>,
    pub common_selected_status: Option<PlacementStatus>,
    pub die_available: bool,
    /// Whether boundary actions can target DIE without leaving the Core.
    pub die_target_available: bool,
    pub core_available: bool,
    pub dbu_per_micron: u32,
    pub queue_busy: bool,
    pub queue_status: String,
    pub feedback: Option<String>,
    pub feedback_warning: bool,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum ToolboxTab {
    Move,
    Space,
    Align,
    Transform,
    Arrange,
    More,
}

impl ToolboxTab {
    const ALL: [Self; 6] = [
        Self::Move,
        Self::Space,
        Self::Align,
        Self::Transform,
        Self::Arrange,
        Self::More,
    ];

    fn label(self) -> &'static str {
        match self {
            Self::Move => "Move",
            Self::Space => "Space",
            Self::Align => "Align",
            Self::Transform => "Transform",
            Self::Arrange => "Arrange",
            Self::More => "More",
        }
    }

    fn icon(self) -> ToolIcon {
        match self {
            Self::Move => ToolIcon::Move,
            Self::Space => ToolIcon::GapX,
            Self::Align => ToolIcon::AlignLeft,
            Self::Transform => ToolIcon::RotateCcw,
            Self::Arrange => ToolIcon::Array,
            Self::More => ToolIcon::Sliders,
        }
    }

    fn shortcut(self) -> &'static str {
        match self {
            Self::Move => "Alt+1",
            Self::Space => "Alt+2",
            Self::Align => "Alt+3",
            Self::Transform => "Alt+4",
            Self::Arrange => "Alt+5",
            Self::More => "Alt+6",
        }
    }

    fn shortcut_key(self) -> egui::Key {
        match self {
            Self::Move => egui::Key::Num1,
            Self::Space => egui::Key::Num2,
            Self::Align => egui::Key::Num3,
            Self::Transform => egui::Key::Num4,
            Self::Arrange => egui::Key::Num5,
            Self::More => egui::Key::Num6,
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum ToolIcon {
    Move,
    MoveLeft,
    MoveUp,
    MoveDown,
    MoveRight,
    PushTop,
    PushRight,
    PushBottom,
    PushLeft,
    Center,
    GapTop,
    GapRight,
    GapBottom,
    GapLeft,
    GapX,
    GapY,
    SpreadX,
    SpreadY,
    AlignLeft,
    AlignCenterX,
    AlignRight,
    AlignTop,
    AlignCenterY,
    AlignBottom,
    CornerTopLeft,
    CornerTopRight,
    CornerBottomLeft,
    CornerBottomRight,
    RotateCcw,
    RotateCw,
    Rotate180,
    FlipX,
    FlipY,
    Swap,
    PackLeft,
    PackRight,
    PackTop,
    PackBottom,
    Refine,
    Array,
    StatusPlaced,
    StatusFixed,
    StatusUnplaced,
    Reset,
    Sliders,
}

/// Draws the macro toolbox and reports requested operations.
pub(crate) fn show_macro_toolbar(
    ui: &mut egui::Ui,
    state: &MacroToolbarState,
    preferences: &mut MacroToolboxPreferences,
    mut request_op: impl FnMut(MacroOp),
) {
    if let Some(status) = state.common_selected_status {
        preferences.placement_status = status;
    }

    let has_selection = state.selected_count > 0 && !state.queue_busy;
    let multiple = state.placed_selected_count >= 2 && !state.queue_busy;
    let triple = state.placed_selected_count >= 3 && !state.queue_busy;
    let dbu_per_micron = state.dbu_per_micron.max(1);

    ui.set_width(ui.available_width());
    ui.add_space(8.0);
    toolbox_header(ui, state);
    ui.add_space(8.0);
    selection_context(ui, state);
    ui.add_space(6.0);
    // Keep the latest operation result next to the selection context instead
    // of burying it below a long command list.
    toolbox_feedback(ui, state);
    ui.add_space(8.0);
    ui.separator();
    ui.add_space(6.0);

    let mut active = keyboard_toolbox_tab(ui).unwrap_or_else(|| current_toolbox_tab(ui));
    toolbox_tool_picker(ui, &mut active);
    store_toolbox_tab(ui, active);

    ui.add_space(6.0);
    let tool_height = ui.available_height().max(1.0);
    egui::ScrollArea::vertical()
        .id_salt("ecos_macro_toolbox_commands")
        .auto_shrink([false, false])
        .max_height(tool_height)
        .show(ui, |ui| {
            ui.set_width(ui.available_width());
            match active {
                ToolboxTab::Move => move_tools(
                    ui,
                    state,
                    preferences,
                    has_selection,
                    dbu_per_micron,
                    &mut request_op,
                ),
                ToolboxTab::Space => space_tools(
                    ui,
                    state,
                    preferences,
                    has_selection,
                    triple,
                    dbu_per_micron,
                    &mut request_op,
                ),
                ToolboxTab::Align => align_tools(
                    ui,
                    state,
                    preferences,
                    has_selection,
                    multiple,
                    dbu_per_micron,
                    &mut request_op,
                ),
                ToolboxTab::Transform => {
                    transform_tools(ui, state, preferences, has_selection, &mut request_op)
                }
                ToolboxTab::Arrange => arrange_tools(
                    ui,
                    state,
                    preferences,
                    has_selection,
                    multiple,
                    dbu_per_micron,
                    &mut request_op,
                ),
                ToolboxTab::More => {
                    more_tools(ui, state, preferences, has_selection, &mut request_op)
                }
            }
            ui.add_space(12.0);
        });
}

fn toolbox_tool_picker(ui: &mut egui::Ui, active: &mut ToolboxTab) {
    ui.horizontal(|ui| {
        icon_badge(ui, active.icon(), crate::app::ecos_accent());
        let combo_width = (ui.available_width() - 8.0).max(80.0);
        egui::ComboBox::from_id_salt("ecos_macro_toolbox_tool")
            .selected_text(egui::RichText::new(active.label()).size(12.0).strong())
            .width(combo_width)
            .show_ui(ui, |ui| {
                for tab in ToolboxTab::ALL {
                    let label = format!("{}    {}", tab.label(), tab.shortcut());
                    if ui.selectable_label(*active == tab, label).clicked() {
                        *active = tab;
                        ui.close_menu();
                    }
                }
            });
    });
}

fn keyboard_toolbox_tab(ui: &egui::Ui) -> Option<ToolboxTab> {
    if ui.ctx().wants_keyboard_input() {
        return None;
    }
    ToolboxTab::ALL
        .into_iter()
        .find(|tab| ui.input(|input| input.modifiers.alt && input.key_pressed(tab.shortcut_key())))
}

fn current_toolbox_tab(ui: &egui::Ui) -> ToolboxTab {
    let id = ui.make_persistent_id("ecos_macro_toolbox_active_tab");
    let index = ui
        .data_mut(|data| data.get_persisted::<usize>(id).unwrap_or_default())
        .min(ToolboxTab::ALL.len() - 1);
    ToolboxTab::ALL[index]
}

fn store_toolbox_tab(ui: &egui::Ui, tab: ToolboxTab) {
    let id = ui.make_persistent_id("ecos_macro_toolbox_active_tab");
    let index = ToolboxTab::ALL
        .iter()
        .position(|candidate| *candidate == tab)
        .unwrap_or_default();
    ui.data_mut(|data| data.insert_persisted(id, index));
}

fn move_tools(
    ui: &mut egui::Ui,
    state: &MacroToolbarState,
    preferences: &mut MacroToolboxPreferences,
    has_selection: bool,
    dbu_per_micron: u32,
    request_op: &mut impl FnMut(MacroOp),
) {
    tool_group_heading(ui, "By distance");
    shortcut_hint(ui, "Ctrl+Arrow nudges the selection");
    settings_panel(ui, |ui| {
        ui.horizontal(|ui| {
            ui.label("Distance");
            ui.add(
                egui::DragValue::new(&mut preferences.shift_um)
                    .range(0.0..=1_000_000.0)
                    .speed(0.1)
                    .suffix(" µm"),
            );
            ui.checkbox(&mut preferences.one_by_one, "Per item");
        });
    });
    ui.add_space(6.0);
    let distance = microns_to_dbu(preferences.shift_um, dbu_per_micron);
    icon_row(
        ui,
        [
            IconSpec::with_tooltip(
                has_selection,
                ToolIcon::MoveLeft,
                "Left",
                "Shift selection left by the current distance (Ctrl+Left)",
            ),
            IconSpec::with_tooltip(
                has_selection,
                ToolIcon::MoveRight,
                "Right",
                "Shift selection right by the current distance (Ctrl+Right)",
            ),
            IconSpec::with_tooltip(
                has_selection,
                ToolIcon::MoveUp,
                "Up",
                "Shift selection up by the current distance (Ctrl+Up)",
            ),
            IconSpec::with_tooltip(
                has_selection,
                ToolIcon::MoveDown,
                "Down",
                "Shift selection down by the current distance (Ctrl+Down)",
            ),
        ],
        |[left, right, up, down]| {
            for (clicked, direction) in [
                (left, ShiftDirection::Left),
                (right, ShiftDirection::Right),
                (up, ShiftDirection::Up),
                (down, ShiftDirection::Down),
            ] {
                if clicked {
                    request_op(MacroOp::Shift {
                        direction,
                        distance_dbu: distance,
                        per_item: preferences.one_by_one,
                    });
                }
            }
        },
    );

    ui.add_space(4.0);
    egui::CollapsingHeader::new(
        egui::RichText::new("Push to boundary and center")
            .size(11.0)
            .strong(),
    )
    .id_salt("ecos_macro_push_boundary")
    .default_open(false)
    .show(ui, |ui| {
        ensure_available_boundary_target(state, &mut preferences.shift_target);
        settings_panel(ui, |ui| {
            ui.horizontal(|ui| {
                ui.label("Target");
                boundary_target_segments(ui, &mut preferences.shift_target, state);
            });
        });
        ui.add_space(6.0);
        let target_available = boundary_target_available(state, preferences.shift_target);
        let boundary_requirement =
            "Select at least 1 macro and choose an available Core or DIE boundary.";
        icon_pair(
            ui,
            (
                IconSpec::with_requirement(
                    has_selection && target_available,
                    ToolIcon::PushTop,
                    "To top",
                    "Push selection to the top boundary",
                    boundary_requirement,
                ),
                IconSpec::with_requirement(
                    has_selection && target_available,
                    ToolIcon::PushRight,
                    "To right",
                    "Push selection to the right boundary",
                    boundary_requirement,
                ),
            ),
            |left, right| {
                if left {
                    request_op(MacroOp::ShiftToBoundary {
                        edge: BoundaryEdge::Top,
                        target: preferences.shift_target,
                        per_item: preferences.one_by_one,
                    });
                }
                if right {
                    request_op(MacroOp::ShiftToBoundary {
                        edge: BoundaryEdge::Right,
                        target: preferences.shift_target,
                        per_item: preferences.one_by_one,
                    });
                }
            },
        );
        icon_pair(
            ui,
            (
                IconSpec::with_requirement(
                    has_selection && target_available,
                    ToolIcon::PushBottom,
                    "To bottom",
                    "Push selection to the bottom boundary",
                    boundary_requirement,
                ),
                IconSpec::with_requirement(
                    has_selection && target_available,
                    ToolIcon::PushLeft,
                    "To left",
                    "Push selection to the left boundary",
                    boundary_requirement,
                ),
            ),
            |left, right| {
                if left {
                    request_op(MacroOp::ShiftToBoundary {
                        edge: BoundaryEdge::Bottom,
                        target: preferences.shift_target,
                        per_item: preferences.one_by_one,
                    });
                }
                if right {
                    request_op(MacroOp::ShiftToBoundary {
                        edge: BoundaryEdge::Left,
                        target: preferences.shift_target,
                        per_item: preferences.one_by_one,
                    });
                }
            },
        );
        ui.add_space(2.0);
        if wide_icon_action(
            ui,
            has_selection && state.core_available && state.die_available,
            ToolIcon::Center,
            "Center selection in DIE",
            "Keep the relative layout and center the selected macros in the DIE",
            "Select at least 1 macro and make sure both Core and DIE bounds are available.",
            true,
        ) {
            request_op(MacroOp::CenterOnDie);
        }
    });
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
struct SpaceBoundaryAction {
    edge: BoundaryEdge,
    icon: ToolIcon,
    label: &'static str,
    tooltip: &'static str,
}

const SPACE_BOUNDARY_ACTIONS: [SpaceBoundaryAction; 4] = [
    SpaceBoundaryAction {
        edge: BoundaryEdge::Top,
        icon: ToolIcon::GapTop,
        label: "Space from top",
        tooltip: "Place selection at the current gap from the top boundary",
    },
    SpaceBoundaryAction {
        edge: BoundaryEdge::Bottom,
        icon: ToolIcon::GapBottom,
        label: "Space from bottom",
        tooltip: "Place selection at the current gap from the bottom boundary",
    },
    SpaceBoundaryAction {
        edge: BoundaryEdge::Left,
        icon: ToolIcon::GapLeft,
        label: "Space from left",
        tooltip: "Place selection at the current gap from the left boundary",
    },
    SpaceBoundaryAction {
        edge: BoundaryEdge::Right,
        icon: ToolIcon::GapRight,
        label: "Space from right",
        tooltip: "Place selection at the current gap from the right boundary",
    },
];

fn space_tools(
    ui: &mut egui::Ui,
    state: &MacroToolbarState,
    preferences: &mut MacroToolboxPreferences,
    has_selection: bool,
    triple: bool,
    dbu_per_micron: u32,
    request_op: &mut impl FnMut(MacroOp),
) {
    tool_group_heading(ui, "From boundary");
    ensure_available_boundary_target(state, &mut preferences.space_target);
    settings_panel(ui, |ui| {
        ui.horizontal(|ui| {
            ui.label("Gap");
            ui.add(
                egui::DragValue::new(&mut preferences.space_um)
                    .range(0.0..=1_000_000.0)
                    .speed(0.1)
                    .suffix(" µm"),
            );
            boundary_target_segments(ui, &mut preferences.space_target, state);
        });
    });
    ui.add_space(6.0);
    let gap = microns_to_dbu(preferences.space_um, dbu_per_micron);
    let target_available = boundary_target_available(state, preferences.space_target);
    let pair = state.placed_selected_count == 2 && !state.queue_busy;
    let boundary_requirement =
        "Select at least 1 macro and choose an available Core or DIE boundary.";
    for actions in SPACE_BOUNDARY_ACTIONS.chunks_exact(2) {
        let left_action = actions[0];
        let right_action = actions[1];
        icon_pair(
            ui,
            (
                IconSpec::with_requirement(
                    has_selection && target_available,
                    left_action.icon,
                    left_action.label,
                    left_action.tooltip,
                    boundary_requirement,
                ),
                IconSpec::with_requirement(
                    has_selection && target_available,
                    right_action.icon,
                    right_action.label,
                    right_action.tooltip,
                    boundary_requirement,
                ),
            ),
            |left, right| {
                for (clicked, action) in [(left, left_action), (right, right_action)] {
                    if clicked {
                        request_op(MacroOp::SpaceToBoundary {
                            edge: action.edge,
                            target: preferences.space_target,
                            gap_dbu: gap,
                            per_item: preferences.one_by_one,
                        });
                    }
                }
            },
        );
    }

    ui.add_space(10.0);
    tool_group_heading(ui, "Between macros");
    ui.add_space(6.0);
    icon_pair(
        ui,
        (
            IconSpec::with_requirement(
                pair,
                ToolIcon::GapX,
                "Space from center",
                "Space two selected macros symmetrically around the X center",
                "Select exactly 2 placed macros.",
            ),
            IconSpec::with_requirement(
                pair,
                ToolIcon::GapY,
                "Space from middle",
                "Space two selected macros symmetrically around the Y center",
                "Select exactly 2 placed macros.",
            ),
        ),
        |left, right| {
            if left {
                request_op(MacroOp::SpaceFromCenter {
                    axis: AlignAxis::X,
                    target: preferences.space_target,
                    gap_dbu: gap,
                });
            }
            if right {
                request_op(MacroOp::SpaceFromCenter {
                    axis: AlignAxis::Y,
                    target: preferences.space_target,
                    gap_dbu: gap,
                });
            }
        },
    );
    icon_pair(
        ui,
        (
            IconSpec::with_requirement(
                triple,
                ToolIcon::SpreadY,
                "Distribute Y",
                "Distribute 3 or more selected macros vertically",
                "Select 3 or more placed macros.",
            ),
            IconSpec::with_requirement(
                triple,
                ToolIcon::SpreadX,
                "Distribute X",
                "Distribute 3 or more selected macros horizontally",
                "Select 3 or more placed macros.",
            ),
        ),
        |left, right| {
            if left {
                request_op(MacroOp::Distribute {
                    axis: AlignAxis::Y,
                    gap_dbu: None,
                });
            }
            if right {
                request_op(MacroOp::Distribute {
                    axis: AlignAxis::X,
                    gap_dbu: None,
                });
            }
        },
    );
}

fn align_tools(
    ui: &mut egui::Ui,
    _state: &MacroToolbarState,
    preferences: &mut MacroToolboxPreferences,
    has_selection: bool,
    multiple: bool,
    dbu_per_micron: u32,
    request_op: &mut impl FnMut(MacroOp),
) {
    tool_group_heading(ui, "Reference");
    settings_panel(ui, |ui| {
        ui.horizontal(|ui| {
            ui.label("Use");
            align_reference_segments(ui, &mut preferences.align_reference);
        });
    });
    ui.add_space(6.0);
    shortcut_hint(ui, "Ctrl+Shift+Arrow aligns edges · C/M centers X/Y");
    icon_pair(
        ui,
        (
            IconSpec::with_requirement(
                multiple,
                ToolIcon::AlignLeft,
                "Align left",
                "Align selected macros to their left edge (Ctrl+Shift+Left)",
                "Select 2 or more placed macros.",
            ),
            IconSpec::with_requirement(
                multiple,
                ToolIcon::AlignCenterX,
                "Center X",
                "Align selected macros to their X center (Ctrl+Shift+C)",
                "Select 2 or more placed macros.",
            ),
        ),
        |left, right| {
            if left {
                request_op(MacroOp::Align {
                    axis: AlignAxis::X,
                    edge: AlignEdge::Min,
                    reference: preferences.align_reference,
                });
            }
            if right {
                request_op(MacroOp::Align {
                    axis: AlignAxis::X,
                    edge: AlignEdge::Center,
                    reference: preferences.align_reference,
                });
            }
        },
    );
    icon_pair(
        ui,
        (
            IconSpec::with_requirement(
                multiple,
                ToolIcon::AlignRight,
                "Align right",
                "Align selected macros to their right edge (Ctrl+Shift+Right)",
                "Select 2 or more placed macros.",
            ),
            IconSpec::with_requirement(
                multiple,
                ToolIcon::AlignTop,
                "Align top",
                "Align selected macros to their top edge (Ctrl+Shift+Up)",
                "Select 2 or more placed macros.",
            ),
        ),
        |left, right| {
            if left {
                request_op(MacroOp::Align {
                    axis: AlignAxis::X,
                    edge: AlignEdge::Max,
                    reference: preferences.align_reference,
                });
            }
            if right {
                request_op(MacroOp::Align {
                    axis: AlignAxis::Y,
                    edge: AlignEdge::Max,
                    reference: preferences.align_reference,
                });
            }
        },
    );
    icon_pair(
        ui,
        (
            IconSpec::with_requirement(
                multiple,
                ToolIcon::AlignCenterY,
                "Center Y",
                "Align selected macros to their Y center (Ctrl+Shift+M)",
                "Select 2 or more placed macros.",
            ),
            IconSpec::with_requirement(
                multiple,
                ToolIcon::AlignBottom,
                "Align bottom",
                "Align selected macros to their bottom edge (Ctrl+Shift+Down)",
                "Select 2 or more placed macros.",
            ),
        ),
        |left, right| {
            if left {
                request_op(MacroOp::Align {
                    axis: AlignAxis::Y,
                    edge: AlignEdge::Center,
                    reference: preferences.align_reference,
                });
            }
            if right {
                request_op(MacroOp::Align {
                    axis: AlignAxis::Y,
                    edge: AlignEdge::Min,
                    reference: preferences.align_reference,
                });
            }
        },
    );

    ui.add_space(10.0);
    tool_group_heading(ui, "Core corners");
    settings_panel(ui, |ui| {
        ui.horizontal(|ui| {
            ui.label("X inset");
            ui.add(
                egui::DragValue::new(&mut preferences.x_space_um)
                    .range(0.0..=1_000_000.0)
                    .speed(0.1)
                    .suffix(" µm"),
            );
            ui.label("Y");
            ui.add(
                egui::DragValue::new(&mut preferences.y_space_um)
                    .range(0.0..=1_000_000.0)
                    .speed(0.1)
                    .suffix(" µm"),
            );
        });
    });
    ui.add_space(6.0);
    icon_pair(
        ui,
        (
            IconSpec::with_tooltip(
                has_selection,
                ToolIcon::CornerTopLeft,
                "Top left",
                "Move selection to the top-left core corner with the current inset",
            ),
            IconSpec::with_tooltip(
                has_selection,
                ToolIcon::CornerTopRight,
                "Top right",
                "Move selection to the top-right core corner with the current inset",
            ),
        ),
        |left, right| {
            for (clicked, corner) in [(left, Corner::TopLeft), (right, Corner::TopRight)] {
                if clicked {
                    request_op(MacroOp::AlignCorner {
                        corner,
                        gap_x_dbu: microns_to_dbu(preferences.x_space_um, dbu_per_micron),
                        gap_y_dbu: microns_to_dbu(preferences.y_space_um, dbu_per_micron),
                    });
                }
            }
        },
    );
    icon_pair(
        ui,
        (
            IconSpec::with_tooltip(
                has_selection,
                ToolIcon::CornerBottomLeft,
                "Bottom left",
                "Move selection to the bottom-left core corner with the current inset",
            ),
            IconSpec::with_tooltip(
                has_selection,
                ToolIcon::CornerBottomRight,
                "Bottom right",
                "Move selection to the bottom-right core corner with the current inset",
            ),
        ),
        |left, right| {
            for (clicked, corner) in [(left, Corner::BottomLeft), (right, Corner::BottomRight)] {
                if clicked {
                    request_op(MacroOp::AlignCorner {
                        corner,
                        gap_x_dbu: microns_to_dbu(preferences.x_space_um, dbu_per_micron),
                        gap_y_dbu: microns_to_dbu(preferences.y_space_um, dbu_per_micron),
                    });
                }
            }
        },
    );
}

fn transform_tools(
    ui: &mut egui::Ui,
    _state: &MacroToolbarState,
    preferences: &mut MacroToolboxPreferences,
    has_selection: bool,
    request_op: &mut impl FnMut(MacroOp),
) {
    tool_group_heading(ui, "Options");
    settings_panel(ui, |ui| {
        ui.horizontal(|ui| {
            if ui
                .checkbox(&mut preferences.keep_relative, "Keep relative")
                .changed()
                && preferences.keep_relative
            {
                preferences.one_by_one = false;
            }
            if ui
                .checkbox(&mut preferences.one_by_one, "Per item")
                .changed()
                && preferences.one_by_one
            {
                preferences.keep_relative = false;
            }
        });
    });
    ui.add_space(6.0);
    shortcut_hint(ui, "Ctrl+[ / ] rotates the selection");
    icon_grid(
        ui,
        3,
        [
            IconSpec::with_tooltip(
                has_selection,
                ToolIcon::RotateCcw,
                "Rotate CCW",
                "Rotate selection counter-clockwise (Ctrl+[)",
            ),
            IconSpec::with_tooltip(
                has_selection,
                ToolIcon::RotateCw,
                "Rotate CW",
                "Rotate selection clockwise (Ctrl+])",
            ),
            IconSpec::with_tooltip(
                has_selection,
                ToolIcon::Rotate180,
                "Rotate 180",
                "Rotate selection 180 degrees",
            ),
            IconSpec::with_tooltip(
                has_selection,
                ToolIcon::FlipX,
                "Flip X",
                "Mirror selected macros horizontally",
            ),
            IconSpec::with_tooltip(
                has_selection,
                ToolIcon::FlipY,
                "Flip Y",
                "Mirror selected macros vertically",
            ),
        ],
        |[ccw, cw, rotate_180, flip_x, flip_y]| {
            for (clicked, transform) in [
                (ccw, MacroTransform::RotateCounterClockwise),
                (cw, MacroTransform::RotateClockwise),
                (rotate_180, MacroTransform::Rotate180),
                (flip_x, MacroTransform::FlipHorizontal),
                (flip_y, MacroTransform::FlipVertical),
            ] {
                if clicked {
                    request_op(MacroOp::Transform {
                        transform,
                        keep_relative: preferences.keep_relative,
                    });
                }
            }
        },
    );
}

fn arrange_tools(
    ui: &mut egui::Ui,
    state: &MacroToolbarState,
    preferences: &mut MacroToolboxPreferences,
    has_selection: bool,
    multiple: bool,
    dbu_per_micron: u32,
    request_op: &mut impl FnMut(MacroOp),
) {
    tool_group_heading(ui, "Selection");
    if state.selected_count != 2 {
        ui.label(
            egui::RichText::new(
                "Swap needs exactly 2 selected macros. Refine and Pack need 2 or more.",
            )
            .small()
            .color(crate::app::ecos_text_secondary()),
        );
        ui.add_space(4.0);
    }
    icon_pair(
        ui,
        (
            IconSpec::with_tooltip(
                state.selected_count == 2 && !state.queue_busy,
                ToolIcon::Swap,
                "Swap instances",
                "Exchange two selected macros (requires exactly 2 selected)",
            ),
            IconSpec::with_tooltip(
                multiple,
                ToolIcon::Refine,
                "Refine",
                "Resolve macro overlaps (requires 2 or more placed macros)",
            ),
        ),
        |left, right| {
            if left {
                request_op(MacroOp::Swap);
            }
            if right {
                request_op(MacroOp::Refine {
                    gap_dbu: microns_to_dbu(preferences.pack_gap_um, dbu_per_micron),
                });
            }
        },
    );

    ui.add_space(10.0);
    tool_group_heading(ui, "Pack");
    settings_panel(ui, |ui| {
        ui.horizontal(|ui| {
            ui.label("Gap");
            ui.add(
                egui::DragValue::new(&mut preferences.pack_gap_um)
                    .range(0.0..=1_000_000.0)
                    .speed(0.1)
                    .suffix(" µm"),
            );
        });
    });
    ui.add_space(6.0);
    let pack_gap = microns_to_dbu(preferences.pack_gap_um, dbu_per_micron);
    icon_pair(
        ui,
        (
            IconSpec::with_tooltip(
                multiple,
                ToolIcon::PackLeft,
                "Pack left",
                "Pack selected macros left (requires 2 or more placed macros)",
            ),
            IconSpec::with_tooltip(
                multiple,
                ToolIcon::PackRight,
                "Pack right",
                "Pack selected macros right (requires 2 or more placed macros)",
            ),
        ),
        |left, right| {
            if left {
                request_op(MacroOp::Pack {
                    direction: PackDirection::Left,
                    gap_dbu: pack_gap,
                });
            }
            if right {
                request_op(MacroOp::Pack {
                    direction: PackDirection::Right,
                    gap_dbu: pack_gap,
                });
            }
        },
    );
    icon_pair(
        ui,
        (
            IconSpec::with_tooltip(
                multiple,
                ToolIcon::PackBottom,
                "Pack bottom",
                "Pack selected macros bottom (requires 2 or more placed macros)",
            ),
            IconSpec::with_tooltip(
                multiple,
                ToolIcon::PackTop,
                "Pack top",
                "Pack selected macros top (requires 2 or more placed macros)",
            ),
        ),
        |left, right| {
            if left {
                request_op(MacroOp::Pack {
                    direction: PackDirection::Bottom,
                    gap_dbu: pack_gap,
                });
            }
            if right {
                request_op(MacroOp::Pack {
                    direction: PackDirection::Top,
                    gap_dbu: pack_gap,
                });
            }
        },
    );

    ui.add_space(10.0);
    tool_group_heading(ui, "Array placement");
    settings_panel(ui, |ui| {
        ui.horizontal(|ui| {
            ui.label("Rows");
            ui.add(
                egui::DragValue::new(&mut preferences.array_rows)
                    .range(1..=64)
                    .speed(0.1),
            );
            ui.label("Cols");
            ui.add(
                egui::DragValue::new(&mut preferences.array_columns)
                    .range(1..=64)
                    .speed(0.1),
            );
        });
        ui.horizontal(|ui| {
            ui.label("X gap");
            ui.add(
                egui::DragValue::new(&mut preferences.array_x_gap_um)
                    .range(0.0..=1_000_000.0)
                    .speed(0.1)
                    .suffix(" µm"),
            );
            ui.label("Y");
            ui.add(
                egui::DragValue::new(&mut preferences.array_y_gap_um)
                    .range(0.0..=1_000_000.0)
                    .speed(0.1)
                    .suffix(" µm"),
            );
        });
    });
    ui.add_space(6.0);
    let capacity = preferences
        .array_rows
        .saturating_mul(preferences.array_columns);
    let array_available = has_selection && capacity > 0 && state.selected_count >= capacity;
    if !array_available {
        ui.label(
            egui::RichText::new(format!(
                "Array needs {capacity} selected macros; current selection is {}.",
                state.selected_count
            ))
            .small()
            .color(crate::app::ecos_warning()),
        );
        ui.add_space(4.0);
    }
    let array_tooltip = format!(
        "Arrange selected macros into a {} x {} row-major array",
        preferences.array_rows, preferences.array_columns
    );
    let array_requirement = format!(
        "Select at least {capacity} macros to create this {} x {} array.",
        preferences.array_rows, preferences.array_columns
    );
    if wide_icon_action(
        ui,
        array_available,
        ToolIcon::Array,
        "Create array",
        &array_tooltip,
        &array_requirement,
        true,
    ) {
        request_op(MacroOp::Array {
            rows: preferences.array_rows,
            columns: preferences.array_columns,
            gap_x_dbu: microns_to_dbu(preferences.array_x_gap_um, dbu_per_micron),
            gap_y_dbu: microns_to_dbu(preferences.array_y_gap_um, dbu_per_micron),
        });
    }
}

fn more_tools(
    ui: &mut egui::Ui,
    state: &MacroToolbarState,
    preferences: &mut MacroToolboxPreferences,
    has_selection: bool,
    request_op: &mut impl FnMut(MacroOp),
) {
    tool_group_heading(ui, "Placement status");
    let gap = 4.0;
    let item_width = ((ui.available_width() - gap * 2.0) / 3.0).max(74.0);
    ui.horizontal(|ui| {
        ui.spacing_mut().item_spacing.x = gap;
        for status in [
            PlacementStatus::Placed,
            PlacementStatus::Fixed,
            PlacementStatus::Unplaced,
        ] {
            let selected = state.common_selected_status == Some(status);
            let icon = match status {
                PlacementStatus::Placed => ToolIcon::StatusPlaced,
                PlacementStatus::Fixed => ToolIcon::StatusFixed,
                PlacementStatus::Unplaced => ToolIcon::StatusUnplaced,
            };
            let tooltip = match status {
                PlacementStatus::Placed => "Set selected macros to Placed",
                PlacementStatus::Fixed => "Set selected macros to Fixed",
                PlacementStatus::Unplaced => "Set selected macros to Unplaced",
            };
            let spec = IconSpec {
                accent: selected,
                ..IconSpec::with_requirement(
                    has_selection,
                    icon,
                    status.label(),
                    tooltip,
                    "Select at least 1 macro.",
                )
            };
            if icon_button(ui, item_width, spec) {
                preferences.placement_status = status;
                request_op(MacroOp::SetPlacementStatus { status });
            }
        }
    });
    if state.selected_count > 1 && state.common_selected_status.is_none() {
        ui.add_space(4.0);
        ui.label(
            egui::RichText::new("Selection contains mixed placement statuses")
                .small()
                .color(crate::app::ecos_text_secondary()),
        );
    }

    ui.add_space(10.0);
    tool_group_heading(ui, "Grid snap");
    settings_panel(ui, |ui| {
        ui.checkbox(&mut preferences.snap_enabled, "Snap dragging and placement");
        ui.horizontal(|ui| {
            ui.label("X step");
            ui.add(
                egui::DragValue::new(&mut preferences.snap_x_um)
                    .range(0.001..=1_000_000.0)
                    .speed(0.1)
                    .suffix(" µm"),
            );
            ui.label("Y");
            ui.add(
                egui::DragValue::new(&mut preferences.snap_y_um)
                    .range(0.001..=1_000_000.0)
                    .speed(0.1)
                    .suffix(" µm"),
            );
        });
    });

    ui.add_space(10.0);
    tool_group_heading(ui, "Toolbox defaults");
    settings_panel(ui, |ui| {
        ui.label(
            egui::RichText::new("Operation defaults are saved automatically for this user.")
                .small()
                .color(crate::app::ecos_text_secondary()),
        );
    });
    ui.add_space(6.0);
    if wide_icon_action(
        ui,
        true,
        ToolIcon::Reset,
        "Reset toolbox defaults",
        "Restore all toolbox values to their defaults",
        "Toolbox defaults cannot be reset right now.",
        false,
    ) {
        *preferences = MacroToolboxPreferences::default();
    }
}

fn toolbox_header(ui: &mut egui::Ui, state: &MacroToolbarState) {
    ui.horizontal(|ui| {
        icon_badge(ui, ToolIcon::Move, crate::app::ecos_accent());
        ui.vertical(|ui| {
            ui.label(egui::RichText::new("Macro Toolbox").size(16.0).strong());
            ui.label(
                egui::RichText::new("Placement commands")
                    .small()
                    .color(crate::app::ecos_text_secondary()),
            );
        });
        ui.with_layout(egui::Layout::right_to_left(egui::Align::Center), |ui| {
            let (label, color) = toolbox_workflow_status(state);
            status_indicator(ui, &label, color);
        });
    });
}

fn toolbox_workflow_status(state: &MacroToolbarState) -> (String, egui::Color32) {
    if state.queue_busy || toolbox_feedback_is_busy(state) {
        return ("Applying".to_string(), crate::app::ecos_accent());
    }
    if state.feedback_warning {
        return ("Review".to_string(), crate::app::ecos_warning());
    }
    if state.unplaced_count > 0 {
        let label = if state.unplaced_count == 1 {
            "1 to place".to_string()
        } else {
            format!("{} to place", state.unplaced_count)
        };
        return (label, crate::app::ecos_warning());
    }
    if state.selected_count == 0 {
        return (
            "Select macro".to_string(),
            crate::app::ecos_text_secondary(),
        );
    }
    ("Ready".to_string(), crate::app::ecos_accent())
}

fn selection_context(ui: &mut egui::Ui, state: &MacroToolbarState) {
    egui::Frame::NONE
        .fill(egui::Color32::from_rgba_unmultiplied(0, 0, 0, 26))
        .stroke(egui::Stroke::new(1.0, crate::app::ecos_border()))
        .corner_radius(7)
        .inner_margin(egui::Margin::symmetric(8, 6))
        .show(ui, |ui| {
            ui.set_width(ui.available_width());
            ui.horizontal(|ui| {
                let status = state.common_selected_status;
                let status_color =
                    status.map_or(crate::app::ecos_text_secondary(), placement_status_color);
                let selected = state.selected_count > 0;
                ui.painter().circle_filled(
                    ui.cursor().left_center() + egui::vec2(4.0, 0.0),
                    3.5,
                    status_color,
                );
                ui.add_space(11.0);
                let name = if selected {
                    state.first_selected_name.as_deref().unwrap_or("Selection")
                } else {
                    "No macro selected"
                };
                let detail_width = ui.available_width();
                ui.vertical(|ui| {
                    ui.set_max_width(detail_width);
                    if selected {
                        let copy_clicked = ui
                            .with_layout(egui::Layout::right_to_left(egui::Align::Center), |ui| {
                                let copy_clicked = ui
                                    .small_button("Copy")
                                    .on_hover_text("Copy the full macro name")
                                    .clicked();
                                let name_width = ui.available_width();
                                ui.add_sized(
                                    [name_width, 16.0],
                                    egui::Label::new(egui::RichText::new(name).size(12.0).strong())
                                        .truncate(),
                                )
                                .on_hover_text(name);
                                copy_clicked
                            })
                            .inner;
                        if copy_clicked {
                            ui.ctx().copy_text(name.to_owned());
                        }
                        let status_label = status.map_or("Mixed", PlacementStatus::label);
                        ui.add(
                            egui::Label::new(
                                egui::RichText::new(format!(
                                    "{} selected · {} · {} ready",
                                    state.selected_count, status_label, state.placed_selected_count
                                ))
                                .size(11.5)
                                .color(
                                    if state.unplaced_count > 0 {
                                        crate::app::ecos_warning()
                                    } else {
                                        crate::app::ecos_text_secondary()
                                    },
                                ),
                            )
                            .truncate(),
                        );
                    } else {
                        ui.add(
                            egui::Label::new(egui::RichText::new(name).size(12.0).strong())
                                .truncate(),
                        )
                        .on_hover_text(name);
                    }
                });
            });
        });
}

fn tool_group_heading(ui: &mut egui::Ui, label: &str) {
    ui.label(
        egui::RichText::new(label.to_uppercase())
            .size(11.0)
            .strong()
            .color(crate::app::ecos_text_secondary()),
    );
    ui.add_space(4.0);
}

fn settings_panel(ui: &mut egui::Ui, add_contents: impl FnOnce(&mut egui::Ui)) {
    egui::Frame::NONE
        .fill(egui::Color32::from_rgba_unmultiplied(255, 255, 255, 4))
        .stroke(egui::Stroke::new(
            1.0,
            crate::app::ecos_border().gamma_multiply(0.9),
        ))
        .corner_radius(6)
        .inner_margin(egui::Margin::symmetric(8, 5))
        .show(ui, |ui| {
            ui.set_width(ui.available_width());
            add_contents(ui);
        });
}

fn shortcut_hint(ui: &mut egui::Ui, text: &str) {
    ui.label(
        egui::RichText::new(text)
            .size(11.0)
            .color(crate::app::ecos_text_secondary()),
    );
    ui.add_space(4.0);
}

fn icon_pair(ui: &mut egui::Ui, specs: (IconSpec, IconSpec), mut on_click: impl FnMut(bool, bool)) {
    let gap = 6.0;
    let width = ((ui.available_width() - gap) / 2.0).max(96.0);
    let (left, right) = ui
        .horizontal(|ui| {
            ui.spacing_mut().item_spacing.x = gap;
            let left = icon_button(ui, width, specs.0);
            let right = icon_button(ui, width, specs.1);
            (left, right)
        })
        .inner;
    on_click(left, right);
    ui.add_space(6.0);
}

fn icon_row<const N: usize>(
    ui: &mut egui::Ui,
    specs: [IconSpec; N],
    mut on_click: impl FnMut([bool; N]),
) {
    let gap = 6.0;
    let width = ((ui.available_width() - gap * (N.saturating_sub(1) as f32)) / N as f32).max(52.0);
    let clicked = ui
        .horizontal(|ui| {
            ui.spacing_mut().item_spacing.x = gap;
            let mut clicked = [false; N];
            for (index, spec) in specs.into_iter().enumerate() {
                clicked[index] = icon_button(ui, width, spec);
            }
            clicked
        })
        .inner;
    on_click(clicked);
    ui.add_space(6.0);
}

fn icon_grid<const N: usize>(
    ui: &mut egui::Ui,
    columns: usize,
    specs: [IconSpec; N],
    mut on_click: impl FnMut([bool; N]),
) {
    let gap = 6.0;
    let columns = columns.max(1);
    let width = ((ui.available_width() - gap * (columns.saturating_sub(1) as f32))
        / columns as f32)
        .max(52.0);
    let mut clicked = [false; N];
    for row_start in (0..N).step_by(columns) {
        let row_len = (N - row_start).min(columns);
        let missing = columns - row_len;
        ui.horizontal(|ui| {
            ui.spacing_mut().item_spacing.x = gap;
            if missing > 0 {
                ui.add_space((width + gap) * missing as f32 * 0.5);
            }
            for index in row_start..row_start + row_len {
                clicked[index] = icon_button(ui, width, specs[index]);
            }
        });
        ui.add_space(6.0);
    }
    on_click(clicked);
}

#[derive(Clone, Copy)]
struct IconSpec {
    enabled: bool,
    icon: ToolIcon,
    label: &'static str,
    tooltip: &'static str,
    requirement: &'static str,
    accent: bool,
}

impl IconSpec {
    fn with_tooltip(
        enabled: bool,
        icon: ToolIcon,
        label: &'static str,
        tooltip: &'static str,
    ) -> Self {
        Self {
            enabled,
            icon,
            label,
            tooltip,
            requirement: "Select at least 1 macro.",
            accent: false,
        }
    }

    fn with_requirement(
        enabled: bool,
        icon: ToolIcon,
        label: &'static str,
        tooltip: &'static str,
        requirement: &'static str,
    ) -> Self {
        Self {
            enabled,
            icon,
            label,
            tooltip,
            requirement,
            accent: false,
        }
    }
}

fn icon_button(ui: &mut egui::Ui, width: f32, spec: IconSpec) -> bool {
    let IconSpec {
        enabled,
        icon,
        label,
        tooltip,
        requirement,
        accent,
    } = spec;
    let sense = if enabled {
        egui::Sense::click()
    } else {
        egui::Sense::focusable_noninteractive()
    };
    let (rect, response) = ui.allocate_exact_size(egui::vec2(width, 48.0), sense);
    let hovered = response.hovered() && enabled;
    let pressed = response.is_pointer_button_down_on() && enabled;
    let focused = response.has_focus();
    let accessible_label = if enabled {
        format!("{label}. {tooltip}")
    } else {
        format!("{label}. {requirement}")
    };
    response.widget_info(|| {
        egui::WidgetInfo::labeled(egui::WidgetType::Button, enabled, &accessible_label)
    });
    let emphasized = enabled && accent;
    let fill = if emphasized || hovered || pressed {
        crate::app::ecos_accent().gamma_multiply(if pressed { 0.20 } else { 0.12 })
    } else {
        egui::Color32::from_rgba_unmultiplied(255, 255, 255, 4)
    };
    let focus_color = ui.visuals().selection.stroke.color;
    let stroke = if focused {
        egui::Stroke::new(1.5, focus_color)
    } else if emphasized || hovered || pressed {
        egui::Stroke::new(1.0, crate::app::ecos_accent().gamma_multiply(0.52))
    } else {
        egui::Stroke::new(1.0, crate::app::ecos_border())
    };
    let painter = ui.painter();
    painter.rect_filled(rect, 7.0, fill);
    painter.rect_stroke(rect, 7.0, stroke, egui::StrokeKind::Inside);
    let icon_color = if !enabled {
        crate::app::ecos_text_secondary().gamma_multiply(0.82)
    } else if emphasized || hovered || pressed || focused {
        crate::app::ecos_accent()
    } else {
        ui.visuals().text_color()
    };
    let icon_rect = egui::Rect::from_center_size(
        egui::pos2(rect.center().x, rect.top() + 15.5),
        egui::Vec2::splat(22.0),
    );
    paint_tool_icon(painter, icon_rect, icon, icon_color);
    painter.text(
        egui::pos2(rect.center().x, rect.top() + 35.0),
        egui::Align2::CENTER_CENTER,
        label,
        egui::FontId::proportional(12.0),
        if enabled {
            ui.visuals().text_color()
        } else {
            crate::app::ecos_text_secondary()
        },
    );
    if enabled {
        response.on_hover_text(tooltip).clicked()
    } else {
        response.on_hover_text(requirement).clicked()
    }
}

fn wide_icon_action(
    ui: &mut egui::Ui,
    enabled: bool,
    icon: ToolIcon,
    label: &str,
    tooltip: &str,
    requirement: &str,
    accent: bool,
) -> bool {
    let sense = if enabled {
        egui::Sense::click()
    } else {
        egui::Sense::focusable_noninteractive()
    };
    let (rect, response) = ui.allocate_exact_size(egui::vec2(ui.available_width(), 44.0), sense);
    let hovered = response.hovered() && enabled;
    let focused = response.has_focus();
    let accessible_label = if enabled {
        format!("{label}. {tooltip}")
    } else {
        format!("{label}. {requirement}")
    };
    response.widget_info(|| {
        egui::WidgetInfo::labeled(egui::WidgetType::Button, enabled, &accessible_label)
    });
    let emphasized = enabled && accent;
    let fill = if emphasized || hovered {
        crate::app::ecos_accent().gamma_multiply(0.11)
    } else {
        egui::Color32::from_rgba_unmultiplied(255, 255, 255, 4)
    };
    let focus_color = ui.visuals().selection.stroke.color;
    let stroke = if focused {
        egui::Stroke::new(1.5, focus_color)
    } else if emphasized || hovered {
        egui::Stroke::new(1.0, crate::app::ecos_accent().gamma_multiply(0.50))
    } else {
        egui::Stroke::new(1.0, crate::app::ecos_border())
    };
    let painter = ui.painter();
    painter.rect_filled(rect, 7.0, fill);
    painter.rect_stroke(rect, 7.0, stroke, egui::StrokeKind::Inside);
    let color = if enabled {
        if emphasized || hovered || focused {
            crate::app::ecos_accent()
        } else {
            ui.visuals().text_color()
        }
    } else {
        crate::app::ecos_text_secondary()
    };
    paint_tool_icon(
        painter,
        egui::Rect::from_center_size(
            egui::pos2(rect.left() + 22.0, rect.center().y),
            egui::Vec2::splat(20.0),
        ),
        icon,
        color,
    );
    painter.text(
        egui::pos2(rect.left() + 42.0, rect.center().y),
        egui::Align2::LEFT_CENTER,
        label,
        egui::FontId::proportional(12.0),
        color,
    );
    if enabled {
        response.on_hover_text(tooltip).clicked()
    } else {
        response.on_hover_text(requirement).clicked()
    }
}

fn icon_badge(ui: &mut egui::Ui, icon: ToolIcon, color: egui::Color32) {
    let (rect, _) = ui.allocate_exact_size(egui::vec2(28.0, 28.0), egui::Sense::hover());
    ui.painter()
        .rect_filled(rect, 7.0, color.gamma_multiply(0.12));
    ui.painter().rect_stroke(
        rect,
        7.0,
        egui::Stroke::new(1.0, color.gamma_multiply(0.4)),
        egui::StrokeKind::Inside,
    );
    paint_tool_icon(
        ui.painter(),
        egui::Rect::from_center_size(rect.center(), egui::Vec2::splat(17.0)),
        icon,
        color,
    );
}

fn status_indicator(ui: &mut egui::Ui, label: &str, color: egui::Color32) {
    let galley =
        ui.painter()
            .layout_no_wrap(label.to_owned(), egui::FontId::proportional(10.5), color);
    let size = egui::vec2(galley.size().x + 10.0, 16.0);
    let (rect, _) = ui.allocate_exact_size(size, egui::Sense::hover());
    ui.painter()
        .circle_filled(egui::pos2(rect.left() + 2.5, rect.center().y), 2.5, color);
    ui.painter().galley(
        egui::pos2(rect.left() + 9.0, rect.center().y - galley.size().y * 0.5),
        galley,
        color,
    );
}

fn placement_status_color(status: PlacementStatus) -> egui::Color32 {
    match status {
        PlacementStatus::Placed => crate::app::ecos_accent(),
        PlacementStatus::Fixed => egui::Color32::from_rgb(96, 165, 250),
        PlacementStatus::Unplaced => crate::app::ecos_warning(),
    }
}

fn boundary_target_available(state: &MacroToolbarState, target: BoundaryTarget) -> bool {
    match target {
        BoundaryTarget::Core => state.core_available,
        BoundaryTarget::Die => state.die_target_available,
    }
}

fn ensure_available_boundary_target(state: &MacroToolbarState, target: &mut BoundaryTarget) {
    if boundary_target_available(state, *target) {
        return;
    }
    *target = if state.core_available {
        BoundaryTarget::Core
    } else {
        BoundaryTarget::Die
    };
}

fn boundary_target_segments(
    ui: &mut egui::Ui,
    target: &mut BoundaryTarget,
    state: &MacroToolbarState,
) {
    egui::Frame::NONE
        .fill(egui::Color32::from_rgba_unmultiplied(0, 0, 0, 24))
        .corner_radius(5)
        .inner_margin(egui::Margin::same(2))
        .show(ui, |ui| {
            ui.spacing_mut().item_spacing.x = 2.0;
            ui.horizontal(|ui| {
                for (value, label) in [(BoundaryTarget::Core, "Core"), (BoundaryTarget::Die, "Die")]
                {
                    let available = match value {
                        BoundaryTarget::Core => state.core_available,
                        BoundaryTarget::Die => state.die_target_available,
                    };
                    if segment_button(ui, label, *target == value, available) {
                        *target = value;
                    }
                }
            });
        });
}

fn align_reference_segments(ui: &mut egui::Ui, reference: &mut AlignReference) {
    egui::Frame::NONE
        .fill(egui::Color32::from_rgba_unmultiplied(0, 0, 0, 24))
        .corner_radius(5)
        .inner_margin(egui::Margin::same(2))
        .show(ui, |ui| {
            ui.spacing_mut().item_spacing.x = 2.0;
            ui.horizontal(|ui| {
                for (value, label) in [
                    (AlignReference::SelectionBounds, "Bounds"),
                    (AlignReference::FirstSelected, "First"),
                ] {
                    if segment_button(ui, label, *reference == value, true) {
                        *reference = value;
                    }
                }
            });
        });
}

fn segment_button(ui: &mut egui::Ui, label: &str, selected: bool, enabled: bool) -> bool {
    let response = ui.add_enabled(
        enabled,
        egui::Button::new(
            egui::RichText::new(label)
                .small()
                .strong()
                .color(if selected {
                    crate::app::ecos_accent()
                } else {
                    crate::app::ecos_text_secondary()
                }),
        )
        .fill(if selected {
            crate::app::ecos_accent().gamma_multiply(0.15)
        } else {
            egui::Color32::TRANSPARENT
        })
        .stroke(egui::Stroke::NONE)
        .corner_radius(4)
        .min_size(egui::vec2(44.0, 22.0)),
    );
    if enabled {
        response.clicked()
    } else {
        response
            .on_hover_text("This boundary target is unavailable for the current layout.")
            .clicked()
    }
}

fn toolbox_feedback(ui: &mut egui::Ui, state: &MacroToolbarState) {
    let details_id = ui.make_persistent_id("macro_toolbox_feedback_details");
    let mut details_open =
        ui.data_mut(|data| data.get_persisted::<bool>(details_id).unwrap_or(false));
    let primary = concise_toolbox_feedback(
        state.feedback.as_deref(),
        state.feedback_warning,
        state.queue_busy,
        &state.queue_status,
    )
    .unwrap_or_else(|| "Toolbox ready".to_string());
    let busy = state.queue_busy || primary == "Applying placement";
    let has_details = state.feedback.is_some()
        || !state.queue_status.is_empty()
        || state.unplaced_stdcell_count > 0;
    let idle = primary == "Toolbox ready";
    let color = if busy {
        crate::app::ecos_accent()
    } else if state.feedback_warning || state.unplaced_count > 0 {
        crate::app::ecos_warning()
    } else if idle {
        crate::app::ecos_text_secondary()
    } else {
        crate::app::ecos_accent()
    };

    egui::Frame::NONE
        .fill(egui::Color32::from_rgba_unmultiplied(0, 0, 0, 20))
        .stroke(egui::Stroke::new(
            1.0,
            crate::app::ecos_border().gamma_multiply(0.9),
        ))
        .corner_radius(6)
        .inner_margin(egui::Margin::symmetric(8, 6))
        .show(ui, |ui| {
            ui.set_width(ui.available_width());
            ui.horizontal(|ui| {
                let (indicator_rect, _) =
                    ui.allocate_exact_size(egui::vec2(8.0, 12.0), egui::Sense::hover());
                if busy {
                    ui.put(
                        indicator_rect.shrink(0.5),
                        egui::Spinner::new().size(8.0).color(color),
                    );
                } else {
                    ui.painter()
                        .circle_filled(indicator_rect.center(), 3.0, color);
                }
                ui.add_space(9.0);
                ui.with_layout(egui::Layout::right_to_left(egui::Align::Center), |ui| {
                    if has_details {
                        let label = if details_open {
                            "Hide details"
                        } else {
                            "Details"
                        };
                        let response = ui.add(
                            egui::Button::new(
                                egui::RichText::new(label)
                                    .size(10.5)
                                    .color(crate::app::ecos_text_secondary()),
                            )
                            .frame(false),
                        );
                        if response
                            .on_hover_text("Show queue, backend, and staging diagnostics")
                            .clicked()
                        {
                            details_open = !details_open;
                        }
                    }
                    let message_width = ui.available_width();
                    ui.add_sized(
                        [message_width, 18.0],
                        egui::Label::new(egui::RichText::new(&primary).size(11.5).color(color))
                            .truncate(),
                    )
                    .on_hover_text(&primary);
                });
            });
            if state.unplaced_count > 0 {
                ui.add_space(3.0);
                ui.label(
                    egui::RichText::new("Save requires every macro to be placed")
                        .size(11.5)
                        .color(crate::app::ecos_warning()),
                );
            }
            if details_open {
                ui.add_space(5.0);
                ui.separator();
                ui.add_space(3.0);
                ui.label(
                    egui::RichText::new(format!("Queue: {}", state.queue_status))
                        .size(10.5)
                        .color(crate::app::ecos_text_secondary()),
                );
                if let Some(feedback) = &state.feedback {
                    ui.label(
                        egui::RichText::new(format!("Backend: {feedback}"))
                            .size(11.0)
                            .color(crate::app::ecos_text_secondary()),
                    );
                }
                if state.unplaced_stdcell_count > 0 {
                    ui.label(
                        egui::RichText::new(format!(
                            "Std cells pending: {}",
                            state.unplaced_stdcell_count
                        ))
                        .size(11.0)
                        .color(crate::app::ecos_text_secondary()),
                    );
                }
            }
        });
    ui.data_mut(|data| data.insert_persisted(details_id, details_open));
}

fn concise_toolbox_feedback(
    feedback: Option<&str>,
    feedback_warning: bool,
    queue_busy: bool,
    queue_status: &str,
) -> Option<String> {
    if feedback_warning {
        if let Some(feedback) = feedback {
            let lower = feedback.to_ascii_lowercase();
            if lower.starts_with("queued ") || lower.contains("pending") {
                return Some("Applying placement".to_string());
            }
            if lower.contains("would leave the core area") {
                return Some("Rotation rejected: move macro inward first".to_string());
            }
            if lower.contains("would leave the die area") {
                return Some("Placement rejected: outside die area".to_string());
            }
            return Some(feedback.to_string());
        }
        return Some("Operation failed".to_string());
    }
    if queue_busy {
        return Some("Applying placement".to_string());
    }
    if let Some(feedback) = feedback {
        let lower = feedback.to_ascii_lowercase();
        if lower.starts_with("queued ") {
            return Some("Applying placement".to_string());
        }
        if lower.contains("staged locally") || lower.contains("macro placement staged") {
            return Some("Placement staged locally".to_string());
        }
        if lower.contains("macro placements saved") || lower.contains("layout edit saved") {
            return Some("Layout saved".to_string());
        }
        if lower.contains("discarded") {
            return Some("Edits discarded".to_string());
        }
        if lower.contains("pending") {
            return Some("Applying placement".to_string());
        }
        if lower.contains("applied") || lower.contains("accepted") {
            return Some("Placement updated".to_string());
        }
        return Some(feedback.to_string());
    }
    if queue_status.to_ascii_lowercase().contains("applied") {
        return Some("Placement updated".to_string());
    }
    None
}

fn toolbox_feedback_is_busy(state: &MacroToolbarState) -> bool {
    concise_toolbox_feedback(
        state.feedback.as_deref(),
        state.feedback_warning,
        state.queue_busy,
        &state.queue_status,
    )
    .is_some_and(|message| message == "Applying placement")
}

fn paint_tool_icon(
    painter: &egui::Painter,
    rect: egui::Rect,
    icon: ToolIcon,
    color: egui::Color32,
) {
    let stroke = egui::Stroke::new(1.45, color);
    let thin = egui::Stroke::new(1.0, color.gamma_multiply(0.8));
    let size = rect.width().min(rect.height());
    let center = rect.center();
    let p = |x: f32, y: f32| center + egui::vec2(x * size, y * size);
    let bar = |x0: f32, y0: f32, x1: f32, y1: f32| {
        painter.line_segment([p(x0, y0), p(x1, y1)], stroke);
    };
    let rect_outline = |x0: f32, y0: f32, x1: f32, y1: f32| {
        painter.rect_stroke(
            egui::Rect::from_min_max(p(x0, y0), p(x1, y1)),
            1.5,
            stroke,
            egui::StrokeKind::Inside,
        );
    };
    let rect_filled = |x0: f32, y0: f32, x1: f32, y1: f32, fill: egui::Color32| {
        painter.rect_filled(egui::Rect::from_min_max(p(x0, y0), p(x1, y1)), 1.5, fill);
    };
    let arrow = |from: egui::Pos2, to: egui::Pos2| draw_arrow(painter, from, to, color);
    let double_arrow = |from: egui::Pos2, to: egui::Pos2| {
        draw_arrow(painter, from, to, color);
        draw_arrow(painter, to, from, color);
    };
    let guide = |x0: f32, y0: f32, x1: f32, y1: f32| {
        painter.line_segment([p(x0, y0), p(x1, y1)], thin);
    };

    match icon {
        ToolIcon::Move => {
            double_arrow(p(-0.31, 0.0), p(0.31, 0.0));
            double_arrow(p(0.0, -0.31), p(0.0, 0.31));
        }
        ToolIcon::MoveLeft => arrow(p(0.27, 0.0), p(-0.29, 0.0)),
        ToolIcon::MoveUp => arrow(p(0.0, 0.27), p(0.0, -0.29)),
        ToolIcon::MoveDown => arrow(p(0.0, -0.27), p(0.0, 0.29)),
        ToolIcon::MoveRight => arrow(p(-0.27, 0.0), p(0.29, 0.0)),
        ToolIcon::PushTop | ToolIcon::GapTop => {
            guide(-0.38, -0.33, 0.38, -0.33);
            rect_outline(-0.2, 0.08, 0.2, 0.34);
            if matches!(icon, ToolIcon::GapTop) {
                double_arrow(p(0.0, 0.0), p(0.0, -0.28));
            } else {
                arrow(p(0.0, 0.02), p(0.0, -0.27));
            }
        }
        ToolIcon::PushRight | ToolIcon::GapRight => {
            guide(0.33, -0.38, 0.33, 0.38);
            rect_outline(-0.34, -0.2, -0.08, 0.2);
            if matches!(icon, ToolIcon::GapRight) {
                double_arrow(p(0.0, 0.0), p(0.27, 0.0));
            } else {
                arrow(p(-0.03, 0.0), p(0.27, 0.0));
            }
        }
        ToolIcon::PushBottom | ToolIcon::GapBottom => {
            guide(-0.38, 0.33, 0.38, 0.33);
            rect_outline(-0.2, -0.34, 0.2, -0.08);
            if matches!(icon, ToolIcon::GapBottom) {
                double_arrow(p(0.0, 0.0), p(0.0, 0.28));
            } else {
                arrow(p(0.0, -0.03), p(0.0, 0.27));
            }
        }
        ToolIcon::PushLeft | ToolIcon::GapLeft => {
            guide(-0.33, -0.38, -0.33, 0.38);
            rect_outline(0.08, -0.2, 0.34, 0.2);
            if matches!(icon, ToolIcon::GapLeft) {
                double_arrow(p(0.0, 0.0), p(-0.27, 0.0));
            } else {
                arrow(p(0.03, 0.0), p(-0.27, 0.0));
            }
        }
        ToolIcon::Center => {
            rect_outline(-0.37, -0.30, 0.37, 0.30);
            rect_filled(-0.13, -0.11, 0.13, 0.11, color);
            guide(-0.26, 0.0, -0.16, 0.0);
            guide(0.16, 0.0, 0.26, 0.0);
            guide(0.0, -0.2, 0.0, -0.14);
            guide(0.0, 0.14, 0.0, 0.2);
        }
        ToolIcon::GapX => {
            rect_filled(-0.38, -0.22, -0.12, 0.22, color.gamma_multiply(0.55));
            rect_filled(0.12, -0.22, 0.38, 0.22, color.gamma_multiply(0.55));
            double_arrow(p(-0.09, 0.0), p(0.09, 0.0));
        }
        ToolIcon::GapY => {
            rect_filled(-0.22, -0.38, 0.22, -0.12, color.gamma_multiply(0.55));
            rect_filled(-0.22, 0.12, 0.22, 0.38, color.gamma_multiply(0.55));
            double_arrow(p(0.0, -0.08), p(0.0, 0.08));
        }
        ToolIcon::SpreadX => {
            rect_filled(-0.4, -0.18, -0.27, 0.18, color.gamma_multiply(0.55));
            rect_filled(-0.06, -0.18, 0.06, 0.18, color.gamma_multiply(0.55));
            rect_filled(0.27, -0.18, 0.4, 0.18, color.gamma_multiply(0.55));
            double_arrow(p(-0.24, 0.0), p(-0.09, 0.0));
            double_arrow(p(0.09, 0.0), p(0.24, 0.0));
        }
        ToolIcon::SpreadY => {
            rect_filled(-0.18, -0.4, 0.18, -0.27, color.gamma_multiply(0.55));
            rect_filled(-0.18, -0.06, 0.18, 0.06, color.gamma_multiply(0.55));
            rect_filled(-0.18, 0.27, 0.18, 0.4, color.gamma_multiply(0.55));
            double_arrow(p(0.0, -0.24), p(0.0, -0.09));
            double_arrow(p(0.0, 0.09), p(0.0, 0.24));
        }
        ToolIcon::AlignLeft => {
            guide(-0.33, -0.4, -0.33, 0.4);
            rect_filled(-0.27, -0.25, 0.30, -0.12, color);
            rect_filled(-0.27, -0.04, 0.12, 0.09, color);
            rect_filled(-0.27, 0.17, 0.23, 0.30, color);
        }
        ToolIcon::AlignRight => {
            guide(0.33, -0.4, 0.33, 0.4);
            rect_filled(-0.30, -0.25, 0.27, -0.12, color);
            rect_filled(-0.12, -0.04, 0.27, 0.09, color);
            rect_filled(-0.23, 0.17, 0.27, 0.30, color);
        }
        ToolIcon::AlignCenterX => {
            guide(0.0, -0.4, 0.0, 0.4);
            rect_filled(-0.3, -0.25, 0.3, -0.12, color);
            rect_filled(-0.18, -0.04, 0.18, 0.09, color);
            rect_filled(-0.24, 0.17, 0.24, 0.30, color);
        }
        ToolIcon::AlignTop => {
            guide(-0.4, -0.33, 0.4, -0.33);
            rect_filled(-0.25, -0.27, -0.12, 0.30, color);
            rect_filled(-0.04, -0.27, 0.09, 0.12, color);
            rect_filled(0.17, -0.27, 0.30, 0.23, color);
        }
        ToolIcon::AlignBottom => {
            guide(-0.4, 0.33, 0.4, 0.33);
            rect_filled(-0.25, -0.30, -0.12, 0.27, color);
            rect_filled(-0.04, -0.12, 0.09, 0.27, color);
            rect_filled(0.17, -0.23, 0.30, 0.27, color);
        }
        ToolIcon::AlignCenterY => {
            guide(-0.4, 0.0, 0.4, 0.0);
            rect_filled(-0.25, -0.3, -0.12, 0.3, color);
            rect_filled(-0.04, -0.18, 0.09, 0.18, color);
            rect_filled(0.17, -0.24, 0.30, 0.24, color);
        }
        ToolIcon::CornerTopLeft
        | ToolIcon::CornerTopRight
        | ToolIcon::CornerBottomLeft
        | ToolIcon::CornerBottomRight => {
            rect_outline(-0.36, -0.36, 0.36, 0.36);
            let (x0, y0, x1, y1) = match icon {
                ToolIcon::CornerTopLeft => (-0.33, -0.33, -0.03, -0.03),
                ToolIcon::CornerTopRight => (0.03, -0.33, 0.33, -0.03),
                ToolIcon::CornerBottomLeft => (-0.33, 0.03, -0.03, 0.33),
                _ => (0.03, 0.03, 0.33, 0.33),
            };
            rect_filled(x0, y0, x1, y1, color);
        }
        ToolIcon::RotateCcw => draw_arc(painter, center, size * 0.32, -1.15, -5.2, color),
        ToolIcon::RotateCw => draw_arc(painter, center, size * 0.32, 1.15, 5.2, color),
        ToolIcon::Rotate180 => {
            draw_arc(painter, p(0.0, -0.01), size * 0.3, 0.4, 5.8, color);
            painter.text(
                center,
                egui::Align2::CENTER_CENTER,
                "180",
                egui::FontId::proportional(size * 0.34),
                color,
            );
        }
        ToolIcon::FlipX => {
            guide(0.0, -0.38, 0.0, 0.38);
            painter.add(egui::Shape::convex_polygon(
                vec![p(-0.34, -0.28), p(-0.08, 0.0), p(-0.34, 0.28)],
                color.gamma_multiply(0.65),
                egui::Stroke::NONE,
            ));
            painter.add(egui::Shape::convex_polygon(
                vec![p(0.34, -0.28), p(0.08, 0.0), p(0.34, 0.28)],
                color,
                egui::Stroke::NONE,
            ));
        }
        ToolIcon::FlipY => {
            guide(-0.38, 0.0, 0.38, 0.0);
            painter.add(egui::Shape::convex_polygon(
                vec![p(-0.28, -0.34), p(0.0, -0.08), p(0.28, -0.34)],
                color.gamma_multiply(0.65),
                egui::Stroke::NONE,
            ));
            painter.add(egui::Shape::convex_polygon(
                vec![p(-0.28, 0.34), p(0.0, 0.08), p(0.28, 0.34)],
                color,
                egui::Stroke::NONE,
            ));
        }
        ToolIcon::Swap => {
            arrow(p(-0.27, -0.17), p(0.27, -0.17));
            arrow(p(0.27, 0.17), p(-0.27, 0.17));
        }
        ToolIcon::PackLeft => {
            guide(-0.35, -0.38, -0.35, 0.38);
            rect_filled(-0.29, -0.24, -0.10, -0.06, color.gamma_multiply(0.7));
            rect_filled(-0.29, 0.02, -0.10, 0.20, color.gamma_multiply(0.7));
            arrow(p(0.33, 0.0), p(-0.12, 0.0));
        }
        ToolIcon::PackRight => {
            guide(0.35, -0.38, 0.35, 0.38);
            rect_filled(0.10, -0.24, 0.29, -0.06, color.gamma_multiply(0.7));
            rect_filled(0.10, 0.02, 0.29, 0.20, color.gamma_multiply(0.7));
            arrow(p(-0.33, 0.0), p(0.12, 0.0));
        }
        ToolIcon::PackTop => {
            guide(-0.38, -0.35, 0.38, -0.35);
            rect_filled(-0.24, -0.29, -0.06, -0.10, color.gamma_multiply(0.7));
            rect_filled(0.02, -0.29, 0.20, -0.10, color.gamma_multiply(0.7));
            arrow(p(0.0, 0.33), p(0.0, -0.12));
        }
        ToolIcon::PackBottom => {
            guide(-0.38, 0.35, 0.38, 0.35);
            rect_filled(-0.24, 0.10, -0.06, 0.29, color.gamma_multiply(0.7));
            rect_filled(0.02, 0.10, 0.20, 0.29, color.gamma_multiply(0.7));
            arrow(p(0.0, -0.33), p(0.0, 0.12));
        }
        ToolIcon::Refine => {
            for (x, y) in [(-0.26, -0.24), (0.18, -0.22), (-0.22, 0.18), (0.22, 0.22)] {
                rect_filled(x - 0.07, y - 0.07, x + 0.07, y + 0.07, color);
            }
            arrow(p(-0.16, -0.14), p(-0.06, -0.05));
            arrow(p(0.13, -0.13), p(0.05, -0.05));
            arrow(p(-0.13, 0.13), p(-0.05, 0.05));
            arrow(p(0.16, 0.14), p(0.06, 0.05));
        }
        ToolIcon::Array => {
            for y in [-0.3, 0.0, 0.3] {
                for x in [-0.27, 0.0, 0.27] {
                    rect_filled(
                        x - 0.08,
                        y - 0.07,
                        x + 0.08,
                        y + 0.07,
                        color.gamma_multiply(0.78),
                    );
                }
            }
        }
        ToolIcon::StatusPlaced => {
            painter.circle_stroke(center, size * 0.32, stroke);
            painter.line_segment([p(-0.16, 0.0), p(-0.03, 0.14)], stroke);
            painter.line_segment([p(-0.03, 0.14), p(0.20, -0.16)], stroke);
        }
        ToolIcon::StatusFixed => {
            rect_filled(-0.25, -0.04, 0.25, 0.31, color.gamma_multiply(0.8));
            draw_arc(painter, p(0.0, -0.08), size * 0.18, 3.4, 6.0, color);
            guide(-0.18, -0.08, -0.18, -0.01);
            guide(0.18, -0.08, 0.18, -0.01);
        }
        ToolIcon::StatusUnplaced => {
            painter.circle_stroke(center, size * 0.32, stroke);
            bar(-0.19, 0.19, 0.19, -0.19);
        }
        ToolIcon::Reset => {
            draw_arc(painter, center, size * 0.3, -1.0, 4.8, color);
        }
        ToolIcon::Sliders => {
            for (y, x) in [(-0.23, -0.08), (0.0, 0.13), (0.23, -0.16)] {
                guide(-0.33, y, 0.33, y);
                painter.circle_filled(p(x, y), size * 0.075, color);
            }
        }
    }
}

fn draw_arrow(painter: &egui::Painter, from: egui::Pos2, to: egui::Pos2, color: egui::Color32) {
    let stroke = egui::Stroke::new(1.45, color);
    painter.line_segment([from, to], stroke);
    let delta = to - from;
    if delta.length_sq() <= f32::EPSILON {
        return;
    }
    let direction = delta.normalized();
    let perpendicular = egui::vec2(-direction.y, direction.x);
    let base = to - direction * 4.0;
    painter.add(egui::Shape::convex_polygon(
        vec![to, base + perpendicular * 2.8, base - perpendicular * 2.8],
        color,
        egui::Stroke::NONE,
    ));
}

fn draw_arc(
    painter: &egui::Painter,
    center: egui::Pos2,
    radius: f32,
    start: f32,
    end: f32,
    color: egui::Color32,
) {
    let points = (0..=20)
        .map(|step| {
            let t = step as f32 / 20.0;
            let angle = start + (end - start) * t;
            center + egui::vec2(angle.cos() * radius, angle.sin() * radius)
        })
        .collect::<Vec<_>>();
    painter.add(egui::Shape::line(
        points.clone(),
        egui::Stroke::new(1.45, color),
    ));
    if points.len() >= 2 {
        draw_arrow(
            painter,
            points[points.len() - 2],
            points[points.len() - 1],
            color,
        );
    }
}

pub(crate) fn microns_to_dbu(value: f64, dbu_per_micron: u32) -> i64 {
    (value.max(0.0) * f64::from(dbu_per_micron.max(1)))
        .round()
        .clamp(0.0, i64::MAX as f64) as i64
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn micron_conversion_rounds_to_dbu() {
        assert_eq!(microns_to_dbu(1.234, 1000), 1234);
        assert_eq!(microns_to_dbu(-2.0, 1000), 0);
    }

    #[test]
    fn space_boundary_actions_match_their_labels() {
        let edge_for = |label: &str| {
            SPACE_BOUNDARY_ACTIONS
                .iter()
                .find(|action| action.label == label)
                .map(|action| action.edge)
                .expect("space boundary action")
        };
        assert_eq!(edge_for("Space from top"), BoundaryEdge::Top);
        assert_eq!(edge_for("Space from bottom"), BoundaryEdge::Bottom);
        assert_eq!(edge_for("Space from left"), BoundaryEdge::Left);
        assert_eq!(edge_for("Space from right"), BoundaryEdge::Right);
    }

    #[test]
    fn every_toolbox_tab_has_a_label_and_keyboard_shortcut() {
        assert_eq!(
            ToolboxTab::ALL.map(ToolboxTab::label),
            ["Move", "Space", "Align", "Transform", "Arrange", "More"]
        );
        assert_eq!(
            ToolboxTab::ALL.map(ToolboxTab::shortcut),
            ["Alt+1", "Alt+2", "Alt+3", "Alt+4", "Alt+5", "Alt+6"]
        );
    }

    #[test]
    fn die_boundary_target_requires_a_matching_core_boundary() {
        let mut state = MacroToolbarState {
            unplaced_count: 0,
            selected_count: 1,
            placed_selected_count: 1,
            unplaced_stdcell_count: 0,
            first_selected_name: Some("macro_a".to_string()),
            common_selected_status: Some(PlacementStatus::Placed),
            die_available: true,
            die_target_available: false,
            core_available: true,
            dbu_per_micron: 1000,
            queue_busy: false,
            queue_status: String::new(),
            feedback: None,
            feedback_warning: false,
        };
        assert!(boundary_target_available(&state, BoundaryTarget::Core));
        assert!(!boundary_target_available(&state, BoundaryTarget::Die));
        state.die_target_available = true;
        assert!(boundary_target_available(&state, BoundaryTarget::Die));
    }

    #[test]
    fn workflow_status_prioritizes_the_next_action() {
        let state = MacroToolbarState {
            unplaced_count: 0,
            selected_count: 0,
            placed_selected_count: 0,
            unplaced_stdcell_count: 0,
            first_selected_name: None,
            common_selected_status: None,
            die_available: true,
            die_target_available: true,
            core_available: true,
            dbu_per_micron: 1000,
            queue_busy: false,
            queue_status: String::new(),
            feedback: None,
            feedback_warning: false,
        };
        assert_eq!(toolbox_workflow_status(&state).0, "Select macro");

        let selected = MacroToolbarState {
            selected_count: 1,
            placed_selected_count: 1,
            ..state
        };
        assert_eq!(toolbox_workflow_status(&selected).0, "Ready");
        assert!(!toolbox_feedback_is_busy(&selected));

        let applying = MacroToolbarState {
            feedback: Some("queued rotate clockwise".to_string()),
            feedback_warning: true,
            ..selected
        };
        assert_eq!(toolbox_workflow_status(&applying).0, "Applying");
    }

    #[test]
    fn default_preferences_are_safe_for_macro_placement() {
        let prefs = MacroToolboxPreferences::default();
        assert!(prefs.keep_relative);
        assert!(!prefs.one_by_one);
        assert!(!prefs.snap_enabled);
        assert_eq!(prefs.shift_target, BoundaryTarget::Core);
        assert_eq!(prefs.space_target, BoundaryTarget::Core);
    }

    #[test]
    fn accepted_staging_feedback_is_reduced_to_a_short_summary() {
        assert_eq!(
            concise_toolbox_feedback(
                Some(
                    "edit accepted: staged macro source version 0 staging revision 2:                      macro placement staged locally"
                ),
                false,
                false,
                "macro ops: 1 applied",
            ),
            Some("Placement staged locally".to_string())
        );
        assert_eq!(
            concise_toolbox_feedback(None, false, false, "macro ops: 1 applied"),
            Some("Placement updated".to_string())
        );
    }

    #[test]
    fn queued_feedback_is_short_enough_for_the_toolbox_header() {
        assert_eq!(
            concise_toolbox_feedback(
                Some("queued shift right by 22000 DBU"),
                false,
                false,
                "macro ops: 1 applied",
            ),
            Some("Applying placement".to_string())
        );
        assert_eq!(
            concise_toolbox_feedback(
                Some("queued shift right by 22000 DBU"),
                true,
                true,
                "macro ops: 1 applied",
            ),
            Some("Applying placement".to_string())
        );
        assert!(toolbox_feedback_is_busy(&MacroToolbarState {
            unplaced_count: 0,
            selected_count: 1,
            placed_selected_count: 1,
            unplaced_stdcell_count: 0,
            first_selected_name: Some("macro_a".to_string()),
            common_selected_status: Some(PlacementStatus::Placed),
            die_available: true,
            die_target_available: true,
            core_available: true,
            dbu_per_micron: 1000,
            queue_busy: false,
            queue_status: "macro ops: 1 applied".to_string(),
            feedback: Some("queued rotate clockwise".to_string()),
            feedback_warning: true,
        }));
    }

    #[test]
    fn actionable_feedback_remains_visible() {
        assert_eq!(
            concise_toolbox_feedback(
                Some("operation rejected: toolbox/d overlaps toolbox/b"),
                true,
                false,
                "macro ops: rejected",
            ),
            Some("operation rejected: toolbox/d overlaps toolbox/b".to_string())
        );
    }

    #[test]
    fn core_boundary_rejection_has_a_compact_primary_message() {
        assert_eq!(
            concise_toolbox_feedback(
                Some(
                    "operation rejected: gen_rom_scramble_enabled.u_rom.gen_ics55_rom_8192x39.u_rom would leave the core area"
                ),
                true,
                false,
                "macro ops: rejected",
            ),
            Some("Rotation rejected: move macro inward first".to_string())
        );
    }

    #[test]
    fn preferences_round_trip_through_the_persisted_json_shape() {
        let mut prefs = MacroToolboxPreferences::default();
        prefs.snap_enabled = true;
        prefs.snap_x_um = 0.25;
        prefs.snap_y_um = 0.5;
        prefs.shift_target = BoundaryTarget::Die;
        prefs.align_reference = AlignReference::FirstSelected;
        prefs.placement_status = PlacementStatus::Fixed;

        let encoded = serde_json::to_string(&prefs).expect("serialize preferences");
        let decoded: MacroToolboxPreferences =
            serde_json::from_str(&encoded).expect("deserialize preferences");
        assert_eq!(decoded, prefs);
    }

    #[test]
    fn long_feedback_message_does_not_expand_toolbox_width() {
        let ctx = egui::Context::default();
        let rendered_width = std::cell::Cell::new(0.0);
        let raw_input = egui::RawInput {
            screen_rect: Some(egui::Rect::from_min_size(
                egui::Pos2::ZERO,
                egui::vec2(800.0, 600.0),
            )),
            ..Default::default()
        };
        let _ = ctx.run(raw_input, |ctx| {
            egui::CentralPanel::default().show(ctx, |ui| {
                let max_rect = egui::Rect::from_min_size(
                    ui.cursor().min,
                    egui::vec2(276.0, ui.available_height()),
                );
                ui.scope_builder(egui::UiBuilder::new().max_rect(max_rect), |ui| {
                    ui.set_width(276.0);
                    let state = MacroToolbarState {
                        unplaced_count: 0,
                        selected_count: 1,
                        placed_selected_count: 1,
                        unplaced_stdcell_count: 0,
                        first_selected_name: Some("macro_a".to_string()),
                        common_selected_status: Some(PlacementStatus::Placed),
                        die_available: true,
                        die_target_available: true,
                        core_available: true,
                        dbu_per_micron: 1000,
                        queue_busy: false,
                        queue_status: "macro ops: idle".to_string(),
                        feedback: Some(
                            "selection: macros overlap; distribution needs a positive span across the selected macros"
                                .to_string(),
                        ),
                        feedback_warning: true,
                    };
                    toolbox_feedback(ui, &state);
                    rendered_width.set(ui.min_rect().width());
                });
            });
        });

        assert!(
            rendered_width.get() <= 276.5,
            "feedback expanded the toolbox to {} points",
            rendered_width.get()
        );
    }

    #[test]
    fn long_selected_macro_name_does_not_expand_toolbox_width() {
        let ctx = egui::Context::default();
        let rendered_width = std::cell::Cell::new(0.0);
        let raw_input = egui::RawInput {
            screen_rect: Some(egui::Rect::from_min_size(
                egui::Pos2::ZERO,
                egui::vec2(800.0, 600.0),
            )),
            ..Default::default()
        };
        let _ = ctx.run(raw_input, |ctx| {
            egui::CentralPanel::default().show(ctx, |ui| {
                let max_rect = egui::Rect::from_min_size(
                    ui.cursor().min,
                    egui::vec2(276.0, ui.available_height()),
                );
                ui.scope_builder(egui::UiBuilder::new().max_rect(max_rect), |ui| {
                    ui.set_width(276.0);
                    let state = MacroToolbarState {
                        unplaced_count: 0,
                        selected_count: 1,
                        placed_selected_count: 1,
                        unplaced_stdcell_count: 0,
                        first_selected_name: Some(
                            "gen_rom_scramble_enabled.u_rom.gen_ics55_rom_8192x39.u_rom"
                                .to_string(),
                        ),
                        common_selected_status: Some(PlacementStatus::Placed),
                        die_available: true,
                        die_target_available: true,
                        core_available: true,
                        dbu_per_micron: 1000,
                        queue_busy: false,
                        queue_status: String::new(),
                        feedback: None,
                        feedback_warning: false,
                    };
                    selection_context(ui, &state);
                    rendered_width.set(ui.min_rect().width());
                });
            });
        });

        assert!(
            rendered_width.get() <= 276.5,
            "selection context expanded the toolbox to {} points",
            rendered_width.get()
        );
    }
}
