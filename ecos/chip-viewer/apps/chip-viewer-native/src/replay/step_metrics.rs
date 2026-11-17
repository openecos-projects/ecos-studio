//! Select step-specific metrics and supplement missing values from feature reports.
use crate::replay::data::{read, within, Recording};
use serde_json::{json, Value};
use std::{path::Path, sync::mpsc};

pub fn prepare(workspace: &Path, manifest: &Path, step: &str) -> mpsc::Receiver<Vec<Value>> {
    let (sender, receiver) = mpsc::channel();
    let workspace = workspace.to_owned();
    let manifest = manifest.to_owned();
    let step = step.to_owned();
    std::thread::spawn(move || {
        let result = (|| -> anyhow::Result<Vec<Value>> {
            let record = Recording::open(&workspace, &manifest)?;
            let mut metrics = record.manifest.result_metrics.clone();
            let files = if record.manifest.result_feature_files.is_empty() {
                let owner = record
                    .current_pointer()
                    .ancestors()
                    .nth(4)
                    .ok_or_else(|| anyhow::anyhow!("No feature owner"))?;
                [format!("{step}.db.json"), format!("{step}.step.json")]
                    .iter()
                    .filter_map(|name| within(&workspace, &owner.join("feature").join(name)).ok())
                    .collect::<Vec<_>>()
            } else {
                record
                    .manifest
                    .result_feature_files
                    .iter()
                    .map(|path| record.asset(path))
                    .collect::<anyhow::Result<Vec<_>>>()?
            };
            for path in files {
                if record.manifest.result_feature_files.is_empty() {
                    let started = record
                        .manifest
                        .capture_started_fs_ns
                        .or(record.manifest.started_at_unix_ns);
                    let modified = path
                        .metadata()?
                        .modified()?
                        .duration_since(std::time::UNIX_EPOCH)?
                        .as_nanos();
                    if started.is_none_or(|start| modified < u128::from(start)) {
                        continue;
                    }
                }
                let feature: Value = read(&path)?;
                supplement(&mut metrics, &feature, &path.to_string_lossy());
            }
            record.check_current()?;
            Ok(select(&step, &metrics))
        })();
        let _ = sender.send(result.unwrap_or_default());
    });
    receiver
}
fn supplement(metrics: &mut Vec<Value>, feature: &Value, source: &str) {
    for (id, name, pointer, unit) in [
        ("die_area", "Die area", "/Design Layout/die_area", "um²"),
        ("core_area", "Core area", "/Design Layout/core_area", "um²"),
        (
            "core_utilization",
            "Core utilization",
            "/Design Layout/core_usage",
            "ratio",
        ),
        (
            "instance_count",
            "Instances",
            "/Design Statis/num_instances",
            "count",
        ),
        (
            "io_pin_count",
            "IO pins",
            "/Design Statis/num_iopins",
            "count",
        ),
        (
            "pdn_net_count",
            "Power nets",
            "/Design Statis/num_pdn",
            "count",
        ),
        ("macro_count", "Macros", "/Instances/macros/num", "count"),
        ("macro_area", "Macro area", "/Instances/macros/area", "um²"),
        (
            "filler_count",
            "Filler cells",
            "/Instances/fillers/num",
            "count",
        ),
        (
            "filler_area",
            "Filler area",
            "/Instances/fillers/area",
            "um²",
        ),
        (
            "instance_area",
            "Instance area",
            "/Instances/total/area",
            "um²",
        ),
        (
            "execution_seconds",
            "Execution time",
            "/run/runtime_seconds",
            "s",
        ),
        ("peak_memory_mb", "Peak memory", "/run/peak_memory_mb", "MB"),
    ] {
        if metrics.iter().any(|m| m["id"] == id) {
            continue;
        }
        if let Some(value) = feature
            .pointer(pointer)
            .and_then(Value::as_f64)
            .filter(|v| v.is_finite())
        {
            metrics.push(json!({"id":id,"display_name":name,"value":value,"unit":unit,"source":{"kind":"feature","path":source,"selector":pointer}}));
        }
    }
}
pub fn select(step: &str, metrics: &[Value]) -> Vec<Value> {
    let ids: &[&str] = match step.to_ascii_lowercase().as_str() {
        "synthesis" => &[
            "synthesis_cell_area",
            "synthesis_cell_count",
            "synthesis_port_count",
            "synthesis_wire_count",
        ],
        "prefloorplan" => &["die_area", "core_area", "core_utilization", "io_pin_count"],
        "macroplacement" => &["macro_count", "macro_area", "core_utilization", "core_area"],
        "postfloorplan" => &[
            "die_area",
            "core_area",
            "io_pin_count",
            "pdn_net_count",
            "core_utilization",
        ],
        "place" => &[
            "place_hpwl",
            "place_grwl",
            "place_congestion_egr_overflow_total",
            "place_congestion_egr_overflow_max",
            "place_rudy_utilization_max",
            "core_utilization",
        ],
        "preplace" | "diff_sizing" | "diff_opt" | "diff_buffering" | "timing optimization" => &[
            "sta_setup_wns",
            "sta_setup_tns",
            "instance_area",
            "instance_count",
            "core_utilization",
        ],
        "legalization" => &["instance_count", "instance_area", "core_utilization"],
        "cts" => &[
            "cts_skew",
            "cts_insertion_delay",
            "cts_buffer_count",
            "cts_buffer_area",
            "clock_wirelength",
            "cts_clock_tree_max_level",
        ],
        "route" => &[
            "route_dr_total_wirelength",
            "route_dr_total_via_count",
            "route_dr_total_violation_count",
            "route_dr_total_patch_count",
            "route_la_total_overflow",
        ],
        "filler" => &[
            "filler_count",
            "filler_area",
            "instance_count",
            "core_utilization",
        ],
        "sta" => &[
            "sta_setup_wns",
            "sta_setup_tns",
            "sta_hold_wns",
            "sta_hold_tns",
            "sta_frequency_mhz",
            "sta_corner_count",
        ],
        "poweranalysis" => &[
            "power_analysis_total_uw",
            "power_analysis_dynamic_uw",
            "power_analysis_internal_uw",
            "power_analysis_switching_uw",
            "power_analysis_leakage_uw",
        ],
        "rcx" => &[
            "rcx_spef_file_count",
            "rcx_missing_corner_count",
            "rcx_spef_parse_failure_count",
            "rcx_worst_total_capacitance_ff",
            "rcx_worst_total_resistance_ohm",
        ],
        "drc" => &["drc_count"],
        "lvs" => &["lvs_count"],
        "antennacheck" => &["antenna_violation_count", "antenna_count"],
        "lec" | "postroutelec" => &["equivalence"],
        "emir" => &["emir_max_ir_drop", "emir_violation_count"],
        "harden" => &[
            "harden_gds_exists",
            "harden_lef_exists",
            "harden_lib_exists",
            "harden_artifact_missing_count",
        ],
        _ => &[],
    };
    let valid = |m: &&Value| {
        m["value"].as_f64().is_some_and(f64::is_finite)
            || m["value"].as_str().is_some_and(|s| !s.is_empty())
            || m["value"].is_boolean()
    };
    let mut selected = Vec::new();
    if step.eq_ignore_ascii_case("powerAnalysis")
        && !metrics.iter().any(|m| m["id"] == "power_analysis_total_uw")
    {
        let value = |id: &str| {
            metrics
                .iter()
                .find(|m| m["id"] == id && m["unit"] == "uW")
                .and_then(|m| m["value"].as_f64())
                .filter(|v| v.is_finite())
        };
        if let (Some(dynamic), Some(leakage)) = (
            value("power_analysis_dynamic_uw"),
            value("power_analysis_leakage_uw"),
        ) {
            selected.push(json!({"id":"power_analysis_total_uw","display_name":"Total power","value":dynamic+leakage,"unit":"uW","source":{"kind":"derived","formula":"dynamic_uw + leakage_uw"}}));
        }
    }
    for id in ids {
        if let Some(metric) = metrics.iter().find(|m| m["id"] == *id).filter(valid) {
            selected.push(metric.clone());
        }
    }
    if ids.is_empty() {
        selected.extend(
            metrics
                .iter()
                .filter(|m| m["step_role"] == "primary")
                .filter(valid)
                .take(6)
                .cloned(),
        );
    }
    if selected.is_empty() {
        for id in ["execution_seconds", "peak_memory_mb"] {
            if let Some(m) = metrics.iter().find(|m| m["id"] == id).filter(valid) {
                selected.push(m.clone());
            }
        }
    }
    selected.truncate(6);
    selected
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn sta_and_route_do_not_pick_generic_primary_clock_area() {
        let metrics = vec![
            json!({"id":"clock_area","value":7,"step_role":"primary"}),
            json!({"id":"sta_setup_wns","value":-0.2}),
            json!({"id":"route_dr_total_via_count","value":12}),
        ];
        assert_eq!(select("sta", &metrics), vec![metrics[1].clone()]);
        assert_eq!(select("route", &metrics), vec![metrics[2].clone()]);
    }
    #[test]
    fn missing_features_are_not_zero_and_canonical_metrics_win() {
        let mut metrics = vec![json!({"id":"core_area","value":99})];
        supplement(
            &mut metrics,
            &json!({"Design Layout":{"core_area":20,"die_area":30}}),
            "fixture",
        );
        assert_eq!(
            select("preFloorplan", &metrics)
                .iter()
                .map(|m| m["value"].as_f64().unwrap())
                .collect::<Vec<_>>(),
            [30.0, 99.0]
        );
    }
}
