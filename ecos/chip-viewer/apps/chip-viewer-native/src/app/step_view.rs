use super::*;

/// Initial filters for a read-only workspace step. Standalone snapshots can
/// still open with all layers, and subsequent sidebar changes are user-owned.
pub(super) struct StepView {
    pub(super) show_clock_tree: bool,
    pub(super) objects: ObjectVisibility,
    pub(super) physical_layers: BTreeSet<LayerId>,
}

fn normalize_step(step: &str) -> String {
    let step = step.to_ascii_lowercase();
    let step = step
        .trim()
        .trim_start_matches(|c: char| c.is_ascii_digit() || c == '_');
    let step = ["_ecc", "_sizer", "_dreamplace", "_kepler_formal"]
        .iter()
        .find_map(|suffix| step.strip_suffix(suffix))
        .unwrap_or(step);
    step.chars().filter(char::is_ascii_alphanumeric).collect()
}

fn categories(step: &str) -> Option<&'static [DrawingCategory]> {
    use DrawingCategory::*;
    Some(match step {
        "prefloorplan" | "floorplan" => {
            &[Boundaries, Placement, IoPins, InstanceMacro, Halo, Regions]
        }
        "macroplacement" => &[Boundaries, InstanceMacro, Halo, Regions, Obstructions],
        "postfloorplan" => &[Boundaries, InstanceMacro, IoPins, PdnPower, PdnGround],
        "preplace" | "place" | "placement" | "diffopt" | "diffsizing" | "legalization"
        | "timingoptimization" => &[
            Boundaries,
            Placement,
            InstanceMacro,
            InstanceStdCell,
            Halo,
            Obstructions,
            IoPins,
            Regions,
        ],
        "cts" => &[
            Boundaries,
            InstanceMacro,
            InstanceStdCell,
            NetClock,
            Placement,
            Obstructions,
        ],
        "filler" => &[
            Boundaries,
            Placement,
            InstanceMacro,
            InstanceStdCell,
            InstanceFiller,
        ],
        "drc" => &[Boundaries, NetSignal, NetClock, Vias],
        "route" | "routing" | "lvs" | "antennacheck" | "postroutelec" | "rcx" | "sta"
        | "harden" => &[
            Boundaries,
            InstanceMacro,
            InstanceStdCell,
            InstanceFiller,
            IoPins,
            NetSignal,
            NetClock,
            Vias,
        ],
        "poweranalysis" | "emir" => &[
            Boundaries,
            InstanceMacro,
            InstanceStdCell,
            InstanceFiller,
            IoPins,
            PdnPower,
            PdnGround,
            Vias,
        ],
        _ => return None,
    })
}

impl StepView {
    pub(super) fn prepare(db: &ChipViewDb, step: &str) -> Option<Self> {
        let step = normalize_step(step);
        let selected = categories(&step)?;
        let mut objects = ObjectVisibility::default();
        objects.set_all_visible(false);
        for &category in selected {
            objects.set_category_visible(category, true);
        }
        // Layout objects (rows, cell outlines, etc.) live on the implicit
        // layout layer. Enable physical layers only for matching geometry.
        let mut physical_layers = BTreeSet::new();
        let mut candidates = [false; 256];
        for (raw, candidate) in candidates.iter_mut().enumerate() {
            if let Some(owner) = OwnerType::from_raw(raw as u8) {
                *candidate = owner_uses_layer_visibility(Some(owner))
                    && selected
                        .iter()
                        .any(|category| category.includes_owner_type(owner));
            }
        }
        if candidates.iter().any(|&candidate| candidate) {
            for shape in db.snapshot().shapes() {
                if shape.layer_id == LAYOUT_GEOMETRY_LAYER
                    || physical_layers.contains(&shape.layer_id)
                {
                    continue;
                }
                let Some(owner) = db.owner_for_shape(shape) else {
                    continue;
                };
                if candidates[usize::from(owner.owner_type)]
                    && drawing_category_for_owner(db, owner)
                        .is_some_and(|c| objects.is_category_visible(c))
                {
                    physical_layers.insert(shape.layer_id);
                }
            }
        }
        Some(Self {
            show_clock_tree: step == "cts",
            objects,
            physical_layers,
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn power_steps_keep_vias_and_supply_wires_and_hide_regular_nets() {
        use DrawingCategory::*;
        for step in ["power_analysis", "EMIR"] {
            assert_eq!(
                categories(&normalize_step(step)).unwrap(),
                &[
                    Boundaries,
                    InstanceMacro,
                    InstanceStdCell,
                    InstanceFiller,
                    IoPins,
                    PdnPower,
                    PdnGround,
                    Vias
                ]
            );
        }
    }

    #[test]
    fn placement_aliases_share_rows_and_routing_checks_share_the_route_view() {
        for step in [
            "preplace",
            "diff_opt",
            "diff_sizing",
            "legalization",
            "Timing optimization",
        ] {
            assert_eq!(categories(&normalize_step(step)), categories("placement"));
        }
        assert!(categories("placement")
            .unwrap()
            .contains(&DrawingCategory::Placement));
        for step in [
            "lvs",
            "antenna_check",
            "postRouteLec",
            "rcx",
            "sta",
            "Harden",
        ] {
            assert_eq!(categories(&normalize_step(step)), categories("routing"));
        }
        assert!(categories("unknown").is_none());
    }
}
