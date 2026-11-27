//! Additional CLI inputs: configured STA corners and the existing iPW report.
use super::metrics::{array, lookup, number, Sources};
use serde_json::{json, Value};
use std::collections::BTreeMap;

pub(super) fn corners(source: &mut Sources<'_>) -> BTreeMap<String, Value> {
    let mut corners = BTreeMap::new();
    for stage in ["STA", "Synth"] {
        if let Some(values) = source
            .stages
            .get(stage)
            .and_then(|v| v["corners"].as_object())
        {
            corners.extend(values.iter().map(|(k, v)| (k.clone(), v.clone())));
        }
    }
    let config = source.json("config/sta_ecc.json").unwrap_or_default();
    let mut labels = vec![];
    for group in array(&config["signoff"]) {
        for (name, rcs) in group.as_object().into_iter().flatten() {
            let Some(liberty) = array(&config["liberty"])
                .iter()
                .find(|lib| lib["corner"] == *name)
            else {
                continue;
            };
            let temperature = liberty["temperature"]
                .as_str()
                .map(str::to_owned)
                .unwrap_or_else(|| liberty["temperature"].to_string());
            let temperature = temperature
                .trim_end_matches(".0")
                .replace('-', "m")
                .replace('.', "p");
            let rcs = rcs
                .as_str()
                .map(|s| vec![s])
                .unwrap_or_else(|| array(rcs).iter().filter_map(Value::as_str).collect());
            for rc in rcs {
                labels.push(format!(
                    "{}_{}/{}",
                    safe(name),
                    safe(&temperature),
                    safe(rc)
                ));
            }
        }
    }
    // Older snapshots record the configured matrix in the STA step artifact.
    if labels.is_empty() {
        if let Some(sta) = source.stages.get("STA") {
            labels.extend(
                array(&sta["sta"]["signoff_metrics"]["corners"])
                    .iter()
                    .filter_map(|c| c["sta_corner"].as_str().map(str::to_owned)),
            );
        }
    }
    let sta = source.directory("STA", "sta_ecc");
    let synth = source.directory("Synth", "Synthesis_yosys");
    for label in labels {
        if label
            .split('/')
            .any(|p| p.is_empty() || matches!(p, "." | "..") || p.contains('\\'))
        {
            continue;
        }
        let mut payload = source
            .json(&format!("{sta}/feature/{label}/qor_summary.json"))
            .unwrap_or_else(|| json!({}));
        if let Some(text) = source.text(&format!("{sta}/report/{label}/qor_summary.rpt")) {
            add_timing_report(&mut payload, &text);
        }
        if payload.as_object().is_some_and(|v| !v.is_empty()) {
            corners.insert(label, payload);
        }
    }
    if corners.is_empty() {
        let mut payload = source
            .json(&format!("{synth}/feature/post_synthesis/qor_summary.json"))
            .unwrap_or_else(|| json!({}));
        if let Some(text) = source
            .text(&format!("{synth}/report/post_synthesis/qor_summary.rpt"))
            .or_else(|| source.text(&format!("{synth}/report/qor_summary.rpt")))
        {
            add_timing_report(&mut payload, &text);
        }
        if payload.as_object().is_some_and(|v| !v.is_empty()) {
            corners.insert("POST_SYNTHESIS".into(), payload);
        }
    }
    corners
}
fn safe(s: &str) -> String {
    s.trim()
        .chars()
        .map(|c| {
            if c.is_alphanumeric() || matches!(c, '-' | '_' | '.') {
                c
            } else {
                '_'
            }
        })
        .collect()
}
fn add_timing_report(payload: &mut Value, text: &str) {
    let Some(object) = payload.as_object_mut() else {
        return;
    };
    for line in text.lines() {
        let parts: Vec<_> = line.split_whitespace().collect();
        if parts.len() < 8 || !(parts[0].starts_with("Summary") || parts[0].starts_with("clk")) {
            continue;
        }
        let values: Option<Vec<f64>> = parts[1..8]
            .iter()
            .map(|s| {
                s.to_ascii_lowercase()
                    .replace("mhz", "")
                    .parse::<f64>()
                    .ok()
                    .filter(|n| n.is_finite())
            })
            .collect();
        if let Some(values) = values {
            for (name, value) in [
                "setup_wns",
                "setup_tns",
                "violating_endpoints_setup",
                "frequency_mhz",
                "hold_wns",
                "hold_tns",
                "violating_endpoints_hold",
            ]
            .into_iter()
            .zip(values)
            {
                object.entry(name).or_insert(json!(value));
            }
            break;
        }
    }
}
pub(super) fn corner_value(corner: &Value, kind: &str, metric: &str) -> Option<f64> {
    let direct = if metric == "nvp" {
        format!("violating_endpoints_{kind}")
    } else {
        format!("{kind}_{metric}")
    };
    let nested = format!("{kind}.{metric}");
    let summary = format!("summary.{kind}.{metric}");
    lookup(corner, &[&direct, &nested, &summary]).or_else(|| {
        if kind == "setup" {
            corner.get(metric).and_then(number)
        } else {
            None
        }
    })
}
pub(super) fn power(source: &mut Sources<'_>) {
    let power = source.directory("Power", "powerAnalysis_ecc");
    let synth = source.directory("Synth", "Synthesis_yosys");
    let text = source
        .text(&format!("{power}/report/power_analysis.rpt"))
        .or_else(|| source.text(&format!("{power}/report/powerAnalysis.rpt")))
        .or_else(|| source.text(&format!("{power}/data/pw/power_reporter/power.rpt")))
        .or_else(|| source.text(&format!("{synth}/report/power.rpt")));
    let Some(text) = text else {
        return;
    };
    let mut values = serde_json::Map::new();
    for (name, pattern) in [
        (
            "dynamic_power_mw",
            r"Total Dynamic Power\s*=\s*([\d.e+-]+)\s*([unpµm]?W)",
        ),
        (
            "leakage_power_mw",
            r"Cell Leakage Power\s*=\s*([\d.e+-]+)\s*([unpµm]?W)",
        ),
        (
            "total_power_mw",
            r"Total\s+[\d.e+-]+\s*[a-z]+\s+[\d.e+-]+\s*[a-z]+\s+[\d.e+-]+\s*[a-z]+\s+([\d.e+-]+)\s*([unpµm]?W)",
        ),
    ] {
        let pattern = regex::Regex::new(&format!("(?i){pattern}")).expect("power pattern");
        if let Some(c) = pattern.captures(&text) {
            if let Ok(n) = c[1].parse::<f64>() {
                let scale = match c[2].to_ascii_lowercase().as_str() {
                    "w" => 1000.0,
                    "uw" | "µw" => 0.001,
                    "nw" => 1e-6,
                    "pw" => 1e-9,
                    _ => 1.0,
                };
                if n.is_finite() {
                    values.insert(name.into(), json!(n * scale));
                }
            }
        }
    }
    // Same rounded fallback as the signoff CLI's power report parser.
    if !values.contains_key("total_power_mw") && !values.is_empty() {
        let total = values.values().filter_map(number).sum::<f64>();
        values.insert(
            "total_power_mw".into(),
            json!((total * 10000.0).round() / 10000.0),
        );
    }
    if values.is_empty() {
        return;
    }
    source
        .stages
        .entry("Power".into())
        .or_insert_with(|| json!({}))
        .as_object_mut()
        .unwrap()
        .extend(values);
}
