//! Build the Design card in memory from the same inputs and rules as ECC signoff.
//! No CLI subprocess, analysis refresh, report export, or workspace writes.
use super::{
    signoff_report::{Field, Section},
    DesignSummary,
};
use serde_json::Value;
use std::path::{Path, PathBuf};
#[path = "signoff_metrics.rs"]
mod metrics;
#[path = "signoff_sources.rs"]
mod sources;
use metrics::{array, lookup, number, Sources};

pub(super) struct DesignReport {
    pub sections: Vec<Section>,
    pub paths: Vec<PathBuf>,
    pub error: String,
}
fn formatted(value: Option<f64>, unit: &str) -> String {
    let Some(n) = value.filter(|n| n.is_finite()) else {
        return "—".into();
    };
    let text = if n.fract() == 0.0 {
        format!("{n:.0}")
    } else {
        format!("{n:.2}")
    };
    let (integer, fraction) = text
        .split_once('.')
        .map_or((text.as_str(), None), |(a, b)| (a, Some(b)));
    let mut grouped = String::new();
    for (i, c) in integer.chars().enumerate() {
        if i > 0 && (integer.len() - i) % 3 == 0 && c != '-' && !grouped.ends_with('-') {
            grouped.push(',');
        }
        grouped.push(c);
    }
    if let Some(fraction) = fraction {
        grouped.push('.');
        grouped.push_str(fraction);
    }
    if !unit.is_empty() {
        grouped.push(' ');
        grouped.push_str(unit);
    }
    grouped
}
fn field(label: &str, value: String) -> Field {
    Field {
        label: label.into(),
        value,
        note: String::new(),
    }
}
fn section(title: &str, fields: Vec<Field>) -> Section {
    Section {
        title: title.into(),
        fields,
        ..Default::default()
    }
}
fn ratio(n: Option<f64>) -> Option<f64> {
    n.map(|n| if n > 0.0 && n <= 1.0 { n * 100.0 } else { n })
}
fn area(n: Option<f64>) -> Option<f64> {
    n.map(|n| if n < 100.0 { n * 1e6 } else { n })
}
fn sum_optional(a: Option<f64>, b: Option<f64>) -> Option<f64> {
    (a.is_some() || b.is_some()).then(|| a.unwrap_or(0.0) + b.unwrap_or(0.0))
}
fn timing_status(slacks: impl IntoIterator<Item = Option<f64>>) -> &'static str {
    let measured: Vec<_> = slacks.into_iter().flatten().collect();
    if measured.iter().any(|n| *n < 0.0) {
        "FAIL"
    } else if measured.is_empty() {
        "UNKNOWN"
    } else {
        "PASS"
    }
}
fn runtime(v: &Value) -> Option<f64> {
    number(v)
        .or_else(|| {
            let parts: Vec<_> = v.as_str()?.split(':').collect();
            if parts.len() > 3 {
                return None;
            }
            parts.into_iter().try_fold(0.0, |total, p| {
                Some(total * 60.0 + p.trim().parse::<f64>().ok()?)
            })
        })
        .filter(|n| n.is_finite() && *n >= 0.0)
}
fn duration(n: Option<f64>) -> String {
    n.map_or_else(
        || "—".into(),
        |n| {
            let total = n.round() as u64;
            if total >= 3600 {
                format!("{}h {}m {}s", total / 3600, total % 3600 / 60, total % 60)
            } else if total >= 60 {
                format!("{}m {}s", total / 60, total % 60)
            } else {
                format!("{total}s")
            }
        },
    )
}

pub(super) fn load(
    root: &Path,
    flow: Option<&Value>,
    snapshot: Option<&Value>,
    identity: &mut DesignSummary,
) -> DesignReport {
    let flow = flow.cloned().unwrap_or_default();
    let mut source = Sources::new(
        root,
        snapshot
            .map(|s| s["parameters"].clone())
            .unwrap_or_default(),
    );
    source.collect(&flow);
    for (target, aliases) in [
        (&mut identity.name, ["design", "Design", "DESIGN_NAME"]),
        (
            &mut identity.top_module,
            ["top_module", "TOP_MODULE", "topModule"],
        ),
        (&mut identity.pdk, ["pdk", "PDK", "technology"]),
    ] {
        if target.is_empty() {
            *target = aliases
                .into_iter()
                .find_map(|key| source.parameters[key].as_str())
                .unwrap_or_default()
                .to_owned();
        }
    }
    let corners = sources::corners(&mut source);
    sources::power(&mut source);
    let q = |name: &str| source.query(name);
    let f = |name: &str, unit: &str| field(name, formatted(q(name), unit));
    let physical = section(
        "1. PHYSICAL & AREA METRICS",
        vec![
            field(
                "Die Area",
                area(q("Die Area")).map_or_else(
                    || "—".into(),
                    |n| format!("{} ({:.4} mm²)", formatted(Some(n), "µm²"), n / 1e6),
                ),
            ),
            field("Core Area", formatted(area(q("Core Area")), "µm²")),
            field(
                "Core Utilization",
                formatted(ratio(q("Core Utilization")), "%"),
            ),
            f("Standard Cell Area", "µm²"),
            field(
                "Macro Count / Area",
                format!(
                    "{} / {}",
                    formatted(q("Macro Count"), ""),
                    formatted(q("Macro Area"), "µm²")
                ),
            ),
            f("Total Instances", ""),
            field(
                "Sequential / Comb. Cells",
                format!(
                    "{} / {}",
                    formatted(q("Sequential Cell Count"), ""),
                    formatted(q("Combinational Cell Count"), "")
                ),
            ),
            field("IO Pins", formatted(q("IO Pin Count"), "")),
            f("Total Nets", ""),
        ],
    );
    let rollup = |label: &str, kind: &str, metric: &str| {
        q(label).or_else(|| {
            let values: Vec<_> = corners
                .values()
                .filter_map(|c| sources::corner_value(c, kind, metric))
                .collect();
            if metric == "nvp" {
                (!values.is_empty()).then(|| values.iter().sum())
            } else {
                values.into_iter().reduce(f64::min)
            }
        })
    };
    let setup = rollup("Setup WNS", "setup", "wns");
    let hold = rollup("Hold WNS", "hold", "wns");
    let period = q("Target Clock Period").filter(|n| *n > 0.0).or_else(|| {
        q("Target Frequency")
            .filter(|n| *n > 0.0)
            .map(|n| 1000.0 / n)
    });
    let min_period = period
        .map(|p| p - setup.unwrap_or(0.0))
        .filter(|p| *p > 0.0);
    let fmax = q("Achieved Fmax").or_else(|| min_period.map(|p| 1000.0 / p));
    let mut timing = section(
        "2. TIMING CLOSURE & PERFORMANCE",
        vec![
            Field {
                label: "Target Clock Period".into(),
                value: formatted(period, "ns"),
                note: format!(
                    "Target freq: {}",
                    formatted(period.map(|p| 1000.0 / p), "MHz")
                ),
            },
            field("Achieved Fmax", formatted(fmax, "MHz")),
        ],
    );
    for (kind, slack, label) in [("setup", setup, "Setup"), ("hold", hold, "Hold")] {
        timing.fields.push(Field {
            label: format!("{label} Slack (WNS / TNS)"),
            value: format!(
                "{} / {}",
                formatted(slack, "ns"),
                formatted(rollup(&format!("{label} TNS"), kind, "tns"), "ns")
            ),
            note: match timing_status([slack]) {
                "PASS" => "TIMING MET",
                "FAIL" => "VIOLATION",
                _ => "UNKNOWN",
            }
            .into(),
        });
    }
    timing.fields.extend([
        field(
            "Critical Path Delay",
            formatted(
                q("Critical Path Delay")
                    .or(min_period)
                    .or_else(|| fmax.filter(|n| *n > 0.0).map(|n| 1000.0 / n)),
                "ns",
            ),
        ),
        field(
            "Violating Endpoints (Setup/Hold)",
            format!(
                "{} / {}",
                formatted(rollup("Setup Violating Endpoints", "setup", "nvp"), ""),
                formatted(rollup("Hold Violating Endpoints", "hold", "nvp"), "")
            ),
        ),
        field(
            "DRC Violations (Slew/Cap/Fanout)",
            [
                "Max Slew Violations",
                "Max Cap Violations",
                "Max Fanout Violations",
            ]
            .map(|k| formatted(q(k), ""))
            .join(" / "),
        ),
    ]);
    let buffers = q("Clock Buffer Count")
        .or_else(|| q("Clock Cell Count"))
        .or_else(|| q("Clock Inverter Count"));
    let skew = q("Clock Skew").map(|n| {
        let explicit_ns = [
            "cts_worst_optimized_skew_ns",
            "worst_optimized_skew_ns",
            "cts_worst_skew_ns",
            "worst_skew_ns",
        ];
        let ns = ["CTS", "STA", "Route"]
            .into_iter()
            .find_map(|s| source.stages.get(s).and_then(|v| lookup(v, &explicit_ns)));
        if ns == Some(n) || (n > 0.0 && n < 10.0) {
            n * 1000.0
        } else {
            n
        }
    });
    let clock = section(
        "3. CLOCK TREE & QUALITY",
        vec![
            field(
                "Clock Tree Depth",
                formatted(q("Clock Tree Levels"), "levels"),
            ),
            field(
                "Clock Buffers",
                format!(
                    "{} ({})",
                    formatted(buffers, ""),
                    formatted(q("Clock Buffer Area"), "µm²")
                ),
            ),
            field(
                "Clock Path Buffers (Min/Max)",
                format!(
                    "{} / {}",
                    formatted(q("Clock Path Min Buffer"), ""),
                    formatted(q("Clock Path Max Buffer"), "")
                ),
            ),
            field(
                "Clock Wirelength",
                q("Max Clock Wirelength").map_or_else(
                    || formatted(q("Clock Wirelength"), "µm"),
                    |max| {
                        format!(
                            "{} (Max: {})",
                            formatted(q("Clock Wirelength"), "µm"),
                            formatted(Some(max), "µm")
                        )
                    },
                ),
            ),
            field("Clock Nets", formatted(q("Clock Nets Count"), "nets")),
            field("Clock Skew", formatted(skew, "ps")),
            f("Clock Insertion Latency", "ns"),
        ],
    );
    let multi = Section {
        title: "4. MULTI-CORNER TIMING".into(),
        columns: [
            "Corner",
            "Setup WNS",
            "Setup TNS",
            "Hold WNS",
            "Hold TNS",
            "Status",
        ]
        .map(str::to_owned)
        .into(),
        rows: corners
            .iter()
            .map(|(name, c)| {
                vec![
                    name.clone(),
                    formatted(sources::corner_value(c, "setup", "wns"), "ns"),
                    formatted(sources::corner_value(c, "setup", "tns"), "ns"),
                    formatted(sources::corner_value(c, "hold", "wns"), "ns"),
                    formatted(sources::corner_value(c, "hold", "tns"), "ns"),
                    timing_status([
                        sources::corner_value(c, "setup", "wns"),
                        sources::corner_value(c, "hold", "wns"),
                    ])
                    .into(),
                ]
            })
            .collect(),
        ..Default::default()
    };
    let routing = section(
        "5. ROUTING & CONGESTION",
        vec![
            field("HPWL", formatted(q("Half-Perimeter Wirelength"), "µm")),
            f("Routed Wirelength", "µm"),
            f("Via Count", ""),
            field(
                "Global Route Overflow",
                formatted(q("Global Overflow Total"), ""),
            ),
        ],
    );
    let power = section(
        "6. POWER ANALYSIS",
        vec![
            field(
                "Total Power",
                formatted(
                    q("Total Power")
                        .or_else(|| sum_optional(q("Dynamic Power"), q("Leakage Power"))),
                    "mW",
                ),
            ),
            f("Dynamic Power", "mW"),
            f("Leakage Power", "mW"),
        ],
    );
    let verification = section(
        "7. PHYSICAL VERIFICATION",
        [
            (
                "DRC Status",
                "DRC Violations",
                "CLEAN (0 violations)",
                "VIOLATIONS",
            ),
            (
                "LVS Status",
                "LVS Mismatches",
                "MATCHED (Clean)",
                "MISMATCHES",
            ),
        ]
        .map(|(label, key, pass, fail)| {
            let n = q(key);
            Field {
                label: label.into(),
                value: match n {
                    Some(0.0) => pass.into(),
                    Some(n) => format!("{fail} ({})", formatted(Some(n), "")),
                    None => "UNRUN".into(),
                },
                note: match n {
                    Some(0.0) => "PASS",
                    Some(_) => "FAIL",
                    None => "UNKNOWN",
                }
                .into(),
            }
        })
        .into(),
    );
    let mut execution = section("8. FLOW EXECUTION COST", vec![]);
    let mut total = None;
    let mut peak: Option<f64> = None;
    execution.columns = ["Stage", "Tool", "Runtime", "Peak Mem", "State"]
        .map(str::to_owned)
        .into();
    for step in array(&flow["steps"]) {
        let seconds = runtime(&step["runtime"]);
        total = sum_optional(total, seconds);
        let memory = lookup(
            step,
            &["peak memory (mb)", "peak_memory_mb", "peakMemoryMb"],
        );
        peak = match (peak, memory) {
            (Some(a), Some(b)) => Some(a.max(b)),
            (a, b) => a.or(b),
        };
        execution.rows.push(vec![
            metrics::stage(step["name"].as_str().unwrap_or("Unknown")),
            step["tool"].as_str().unwrap_or("—").into(),
            duration(seconds),
            formatted(memory, "MB"),
            step["state"].as_str().unwrap_or("Unknown").into(),
        ]);
    }
    execution.fields = vec![
        field("Total Runtime", duration(total)),
        field("Peak Memory Usage", formatted(peak, "MB")),
    ];
    let error = if source.stages.is_empty() && corners.is_empty() {
        "Design metrics are unavailable in this workspace".into()
    } else {
        source.errors.join("; ")
    };
    DesignReport {
        sections: vec![
            physical,
            timing,
            clock,
            multi,
            routing,
            power,
            verification,
            execution,
        ],
        paths: source.paths,
        error,
    }
}

#[cfg(test)]
#[path = "signoff_design_tests.rs"]
mod tests;
