//! Orientation algebra for manual macro placement.
//!
//! The eight DEF orientations are treated as 2D linear transforms in master
//! coordinates, matching `idb::IdbOrientTransform` in the ECC toolchain:
//!
//! | orient | master-local map |
//! |--------|------------------|
//! | R0     | `(x, y)`         |
//! | R90    | `(h - y, x)`     |
//! | R180   | `(w - x, h - y)` |
//! | R270   | `(y, w - x)`     |
//! | MY     | `(w - x, y)`     |
//! | MX     | `(x, h - y)`     |
//! | MX90   | `(y, x)`         |
//! | MY90   | `(h - y, w - x)` |
//!
//! `place_instance` derives the bounding box from the same rule, so the
//! viewer preview and the committed placement always agree.

use serde::{Deserialize, Serialize};

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub(crate) enum MacroOrientation {
    #[serde(rename = "R0")]
    R0,
    #[serde(rename = "R90")]
    R90,
    #[serde(rename = "R180")]
    R180,
    #[serde(rename = "R270")]
    R270,
    #[serde(rename = "MY")]
    My,
    #[serde(rename = "MX")]
    Mx,
    #[serde(rename = "MX90")]
    Mx90,
    #[serde(rename = "MY90")]
    My90,
}

impl MacroOrientation {
    pub(crate) const ALL: [MacroOrientation; 8] = [
        MacroOrientation::R0,
        MacroOrientation::R90,
        MacroOrientation::R180,
        MacroOrientation::R270,
        MacroOrientation::My,
        MacroOrientation::Mx,
        MacroOrientation::Mx90,
        MacroOrientation::My90,
    ];

    pub(crate) fn as_str(self) -> &'static str {
        match self {
            MacroOrientation::R0 => "R0",
            MacroOrientation::R90 => "R90",
            MacroOrientation::R180 => "R180",
            MacroOrientation::R270 => "R270",
            MacroOrientation::My => "MY",
            MacroOrientation::Mx => "MX",
            MacroOrientation::Mx90 => "MX90",
            MacroOrientation::My90 => "MY90",
        }
    }

    pub(crate) fn from_str(value: &str) -> Option<Self> {
        MacroOrientation::ALL
            .into_iter()
            .find(|orient| orient.as_str() == value)
    }

    /// Maps a DEF placement orientation token (N/W/S/E/FN/FE/FS/FW).
    pub(crate) fn from_def_alias(value: &str) -> Option<Self> {
        match value.to_ascii_uppercase().as_str() {
            "N" => Some(MacroOrientation::R0),
            "W" => Some(MacroOrientation::R90),
            "S" => Some(MacroOrientation::R180),
            "E" => Some(MacroOrientation::R270),
            "FN" => Some(MacroOrientation::My),
            "FE" => Some(MacroOrientation::My90),
            "FS" => Some(MacroOrientation::Mx),
            "FW" => Some(MacroOrientation::Mx90),
            _ => None,
        }
    }

    /// Linear part of the master-local transform as `[[xx, xy], [yx, yy]]`.
    fn linear(self) -> [[i64; 2]; 2] {
        match self {
            MacroOrientation::R0 => [[1, 0], [0, 1]],
            MacroOrientation::R90 => [[0, -1], [1, 0]],
            MacroOrientation::R180 => [[-1, 0], [0, -1]],
            MacroOrientation::R270 => [[0, 1], [-1, 0]],
            MacroOrientation::My => [[-1, 0], [0, 1]],
            MacroOrientation::Mx => [[1, 0], [0, -1]],
            MacroOrientation::Mx90 => [[0, 1], [1, 0]],
            MacroOrientation::My90 => [[0, -1], [-1, 0]],
        }
    }

    /// True when the placed bounding box swaps master width and height.
    pub(crate) fn swaps_bbox(self) -> bool {
        self.linear()[0][0] == 0
    }

    /// Placed bounding-box dimensions for a master of `width` x `height` DBU.
    pub(crate) fn bbox_size(self, width: i64, height: i64) -> (i64, i64) {
        if self.swaps_bbox() {
            (height, width)
        } else {
            (width, height)
        }
    }

    /// Result of rotating the placed instance by 90 degrees counter
    /// clockwise around its origin: `R90 · self`.
    pub(crate) fn rotated_90(self) -> Self {
        match self {
            MacroOrientation::R0 => MacroOrientation::R90,
            MacroOrientation::R90 => MacroOrientation::R180,
            MacroOrientation::R180 => MacroOrientation::R270,
            MacroOrientation::R270 => MacroOrientation::R0,
            MacroOrientation::My => MacroOrientation::My90,
            MacroOrientation::My90 => MacroOrientation::Mx,
            MacroOrientation::Mx => MacroOrientation::Mx90,
            MacroOrientation::Mx90 => MacroOrientation::My,
        }
    }

    /// Result of mirroring the placed instance about its vertical center
    /// axis (MY applied in placed space): `MY · self`.
    pub(crate) fn mirrored_y(self) -> Self {
        match self {
            MacroOrientation::R0 => MacroOrientation::My,
            MacroOrientation::My => MacroOrientation::R0,
            MacroOrientation::R90 => MacroOrientation::Mx90,
            MacroOrientation::Mx90 => MacroOrientation::R90,
            MacroOrientation::R180 => MacroOrientation::Mx,
            MacroOrientation::Mx => MacroOrientation::R180,
            MacroOrientation::R270 => MacroOrientation::My90,
            MacroOrientation::My90 => MacroOrientation::R270,
        }
    }

    /// Result of mirroring the placed instance about its horizontal center
    /// axis (MX applied in placed space): `MX · self`.
    pub(crate) fn mirrored_x(self) -> Self {
        match self {
            MacroOrientation::R0 => MacroOrientation::Mx,
            MacroOrientation::Mx => MacroOrientation::R0,
            MacroOrientation::R90 => MacroOrientation::My90,
            MacroOrientation::My90 => MacroOrientation::R90,
            MacroOrientation::R180 => MacroOrientation::My,
            MacroOrientation::My => MacroOrientation::R180,
            MacroOrientation::R270 => MacroOrientation::Mx90,
            MacroOrientation::Mx90 => MacroOrientation::R270,
        }
    }
}

/// Master symmetry flags parsed from the geometry master metadata, e.g.
/// `"X,Y"` or `"X,Y,R90"`. Empty values allow every operation so the UI
/// stays usable when metadata is missing; unknown non-empty flags remain
/// conservative and grant no additional symmetry.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) struct MasterSymmetry {
    pub x: bool,
    pub y: bool,
    pub r90: bool,
}

impl Default for MasterSymmetry {
    fn default() -> Self {
        Self {
            x: true,
            y: true,
            r90: true,
        }
    }
}

impl MasterSymmetry {
    pub(crate) fn parse(value: &str) -> Self {
        let tokens: Vec<&str> = value
            .split(',')
            .map(str::trim)
            .filter(|token| !token.is_empty())
            .collect();
        if tokens.is_empty() {
            return MasterSymmetry::default();
        }
        let mut symmetry = MasterSymmetry {
            x: false,
            y: false,
            r90: false,
        };
        for token in tokens {
            match token.to_ascii_uppercase().as_str() {
                "X" => symmetry.x = true,
                "Y" => symmetry.y = true,
                "R90" => symmetry.r90 = true,
                _ => {}
            }
        }
        symmetry
    }

    pub(crate) fn rotation_allowed(self) -> bool {
        self.r90
    }

    pub(crate) fn mirror_allowed(self) -> bool {
        self.x || self.y
    }

    /// Whether a concrete DEF orientation belongs to the symmetry group
    /// declared by the master.
    pub(crate) fn allows_orientation(self, orient: MacroOrientation) -> bool {
        match orient {
            MacroOrientation::R0 => true,
            MacroOrientation::R90 | MacroOrientation::R270 => self.r90,
            MacroOrientation::R180 => self.r90 || (self.x && self.y),
            MacroOrientation::Mx => self.x || (self.r90 && self.y),
            MacroOrientation::My => self.y || (self.r90 && self.x),
            MacroOrientation::Mx90 | MacroOrientation::My90 => self.r90 && (self.x || self.y),
        }
    }

    pub(crate) fn rotate_90_allowed(self, current: MacroOrientation) -> bool {
        self.allows_orientation(current.rotated_90())
    }

    pub(crate) fn mirror_horizontal_allowed(self, current: MacroOrientation) -> bool {
        self.allows_orientation(current.mirrored_y())
    }

    pub(crate) fn mirror_vertical_allowed(self, current: MacroOrientation) -> bool {
        self.allows_orientation(current.mirrored_x())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn compose_matrix(a: [[i64; 2]; 2], b: [[i64; 2]; 2]) -> [[i64; 2]; 2] {
        let mut result = [[0i64; 2]; 2];
        for (row, result_row) in a.iter().zip(result.iter_mut()) {
            for (column_index, result_cell) in result_row.iter_mut().enumerate() {
                *result_cell = row[0] * b[0][column_index] + row[1] * b[1][column_index];
            }
        }
        result
    }

    #[test]
    fn orientation_strings_round_trip() {
        for orient in MacroOrientation::ALL {
            assert_eq!(MacroOrientation::from_str(orient.as_str()), Some(orient));
        }
        assert_eq!(MacroOrientation::from_str("N"), None);
    }

    #[test]
    fn def_aliases_map_every_token() {
        let expected = [
            ("N", MacroOrientation::R0),
            ("W", MacroOrientation::R90),
            ("S", MacroOrientation::R180),
            ("E", MacroOrientation::R270),
            ("FN", MacroOrientation::My),
            ("FE", MacroOrientation::My90),
            ("FS", MacroOrientation::Mx),
            ("FW", MacroOrientation::Mx90),
        ];
        for (token, orient) in expected {
            assert_eq!(MacroOrientation::from_def_alias(token), Some(orient));
        }
        assert_eq!(
            MacroOrientation::from_def_alias("n"),
            Some(MacroOrientation::R0)
        );
        assert_eq!(MacroOrientation::from_def_alias("ZZ"), None);
    }

    #[test]
    fn rotated_90_matches_matrix_composition() {
        let rotation = MacroOrientation::R90.linear();
        for orient in MacroOrientation::ALL {
            let composed = compose_matrix(rotation, orient.linear());
            assert_eq!(
                orient.rotated_90().linear(),
                composed,
                "rotation composition mismatch for {}",
                orient.as_str()
            );
        }
    }

    #[test]
    fn mirrored_y_matches_matrix_composition() {
        let mirror = MacroOrientation::My.linear();
        for orient in MacroOrientation::ALL {
            let composed = compose_matrix(mirror, orient.linear());
            assert_eq!(
                orient.mirrored_y().linear(),
                composed,
                "mirror composition mismatch for {}",
                orient.as_str()
            );
        }
    }

    #[test]
    fn mirrored_x_matches_matrix_composition() {
        let mirror = MacroOrientation::Mx.linear();
        for orient in MacroOrientation::ALL {
            let composed = compose_matrix(mirror, orient.linear());
            assert_eq!(
                orient.mirrored_x().linear(),
                composed,
                "vertical mirror composition mismatch for {}",
                orient.as_str()
            );
        }
    }

    #[test]
    fn rotation_cycles_form_closed_groups() {
        assert_eq!(
            MacroOrientation::R0
                .rotated_90()
                .rotated_90()
                .rotated_90()
                .rotated_90(),
            MacroOrientation::R0
        );
        assert_eq!(MacroOrientation::My.rotated_90(), MacroOrientation::My90);
        assert_eq!(
            MacroOrientation::My.rotated_90().rotated_90(),
            MacroOrientation::Mx
        );
        assert_eq!(MacroOrientation::Mx.rotated_90(), MacroOrientation::Mx90);
        assert_eq!(MacroOrientation::Mx.mirrored_y(), MacroOrientation::R180);
    }

    #[test]
    fn bbox_swap_matches_place_instance_rule() {
        for orient in MacroOrientation::ALL {
            let (width, height) = orient.bbox_size(40, 20);
            match orient {
                MacroOrientation::R0
                | MacroOrientation::R180
                | MacroOrientation::My
                | MacroOrientation::Mx => {
                    assert_eq!((width, height), (40, 20));
                }
                MacroOrientation::R90
                | MacroOrientation::R270
                | MacroOrientation::Mx90
                | MacroOrientation::My90 => {
                    assert_eq!((width, height), (20, 40));
                }
            }
        }
    }

    #[test]
    fn symmetry_parsing_gates_operations() {
        assert!(MasterSymmetry::parse("X,Y").mirror_allowed());
        assert!(!MasterSymmetry::parse("X,Y").rotation_allowed());
        assert!(MasterSymmetry::parse("X,Y,R90").rotation_allowed());
        let x_only = MasterSymmetry::parse("X");
        assert!(x_only.x && !x_only.y && !x_only.r90);
        assert!(x_only.mirror_allowed());
        assert!(!x_only.rotation_allowed());
        let unknown = MasterSymmetry::parse("");
        assert!(unknown.rotation_allowed() && unknown.mirror_allowed());
        assert!(!MasterSymmetry::parse("R90").mirror_allowed());
    }

    #[test]
    fn symmetry_gates_each_transform_against_its_result_orientation() {
        let x_only = MasterSymmetry::parse("X");
        assert!(x_only.mirror_vertical_allowed(MacroOrientation::R0));
        assert!(!x_only.mirror_horizontal_allowed(MacroOrientation::R0));
        assert!(!x_only.rotate_90_allowed(MacroOrientation::R0));

        let y_only = MasterSymmetry::parse("Y");
        assert!(y_only.mirror_horizontal_allowed(MacroOrientation::R0));
        assert!(!y_only.mirror_vertical_allowed(MacroOrientation::R0));

        let all = MasterSymmetry::parse("X,Y,R90");
        for orient in MacroOrientation::ALL {
            assert!(all.rotate_90_allowed(orient));
            assert!(all.mirror_horizontal_allowed(orient));
            assert!(all.mirror_vertical_allowed(orient));
        }
    }
}
