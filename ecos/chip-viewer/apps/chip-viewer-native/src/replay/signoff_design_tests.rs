use super::*;
use crate::replay::data::tests::Fixture;
use serde_json::json;
fn put(f: &Fixture, path: &str, v: Value) {
    std::fs::create_dir_all(f.0.join(path).parent().unwrap()).unwrap();
    f.write(path, v);
}
fn value<'a>(report: &'a DesignReport, label: &str) -> &'a str {
    &report
        .sections
        .iter()
        .flat_map(|s| &s.fields)
        .find(|f| f.label == label)
        .unwrap()
        .value
}
#[test]
fn builds_cli_sections_without_text_reports_and_preserves_unknowns() {
    let f = Fixture::new();
    put(
        &f,
        "21_harden_ecc/analysis/qor_metrics.json",
        json!({"metrics":[{"id":"die_area","value":1234.5}]}),
    );
    put(
        &f,
        "21_harden_ecc/feature/Harden.db.json",
        json!({"die_area":9999,"Design Layout":{"core_area":1000,"core_usage":0.4},"Instances":{"total":{"num":42}}}),
    );
    put(
        &f,
        "place_dreamplace/feature/place.json",
        json!({"die_area":5555}),
    );
    let flow = json!({"steps":[{"name":"harden","tool":"ecc","directory":"21_harden_ecc","runtime":"0:2:3","peak memory (mb)":256,"state":"Success"},{"name":"place","tool":"dreamplace"}]});
    let snapshot =
        json!({"parameters":{"design":"gcd","top_module":"gcd","pdk":"ics55","clock_period":10}});
    let mut identity = DesignSummary::default();
    let report = load(&f.0, Some(&flow), Some(&snapshot), &mut identity);
    assert_eq!(
        (&identity.name, report.sections.len(), report.error.as_str()),
        (&"gcd".to_owned(), 8, "")
    );
    assert_eq!(value(&report, "Die Area"), "1,234.50 µm² (0.0012 mm²)");
    assert_eq!(value(&report, "Core Utilization"), "40 %");
    assert_eq!(value(&report, "Total Instances"), "42");
    assert_eq!(value(&report, "Target Clock Period"), "10 ns");
    assert_eq!(value(&report, "Hold Slack (WNS / TNS)"), "— / —");
    assert_eq!(value(&report, "DRC Status"), "UNRUN");
    assert_eq!(value(&report, "Total Runtime"), "2m 3s");
    assert!(!f.0.join("signoff").exists());
}
#[test]
fn configured_corners_roll_up_and_ipw_units_match_cli() {
    let f = Fixture::new();
    put(
        &f,
        "config/sta_ecc.json",
        json!({"liberty":[{"corner":"MIN","temperature":-40}],"signoff":[{"MIN":["Cbest","RCbest"]}]}),
    );
    put(
        &f,
        "18_sta_ecc/feature/MIN_m40/Cbest/qor_summary.json",
        json!({"summary":{"setup":{"wns":2,"tns":0,"nvp":0},"hold":{"wns":-0.1,"tns":-0.2,"nvp":2}}}),
    );
    put(
        &f,
        "18_sta_ecc/feature/MIN_m40/RCbest/qor_summary.json",
        json!({"summary":{"setup":{"wns":1,"tns":0,"nvp":0}}}),
    );
    put(
        &f,
        "18_sta_ecc/feature/STALE/qor_summary.json",
        json!({"setup_wns":-999}),
    );
    put(&f, "19_power_analysis_ecc/report/unused.json", json!({}));
    std::fs::write(
        f.0.join("19_power_analysis_ecc/report/power_analysis.rpt"),
        "Total Dynamic Power = 500 uW\nCell Leakage Power = 20 nW\n",
    )
    .unwrap();
    let report = load(
        &f.0,
        Some(
            &json!({"steps":[{"name":"sta","tool":"ecc","directory":"18_sta_ecc"},{"name":"power_analysis","tool":"ecc","directory":"19_power_analysis_ecc"}]}),
        ),
        Some(&json!({"parameters":{"clock_period":10}})),
        &mut DesignSummary::default(),
    );
    assert_eq!(report.sections[3].rows.len(), 2);
    assert_eq!(report.sections[3].rows[0].last().unwrap(), "FAIL");
    assert_eq!(value(&report, "Setup Slack (WNS / TNS)"), "1 ns / 0 ns");
    assert_eq!(
        value(&report, "Hold Slack (WNS / TNS)"),
        "-0.10 ns / -0.20 ns"
    );
    assert_eq!(value(&report, "Violating Endpoints (Setup/Hold)"), "0 / 2");
    assert_eq!(value(&report, "Dynamic Power"), "0.50 mW");
    assert_eq!(value(&report, "Total Power"), "0.50 mW");
}
#[test]
fn malformed_metrics_do_not_hide_available_sections() {
    let f = Fixture::new();
    put(&f, "Harden_ecc/analysis/qor_metrics.json", json!({}));
    std::fs::write(f.0.join("Harden_ecc/analysis/qor_metrics.json"), "broken").unwrap();
    put(
        &f,
        "Harden_ecc/feature/Harden.db.json",
        json!({"die_area":2000}),
    );
    let flow = json!({"steps":[{"name":"Harden","tool":"ecc"}]});
    let report = load(&f.0, Some(&flow), None, &mut DesignSummary::default());
    assert!(report.error.contains("Invalid signoff JSON"));
    assert_eq!(value(&report, "Die Area"), "2,000 µm² (0.0020 mm²)");
}
#[cfg(unix)]
#[test]
fn rejects_artifact_symlinks_outside_workspace() {
    let f = Fixture::new();
    let outside = Fixture::new();
    put(&outside, "metric.json", json!({"die_area":9999}));
    std::fs::create_dir_all(f.0.join("Harden_ecc/analysis")).unwrap();
    std::os::unix::fs::symlink(
        outside.0.join("metric.json"),
        f.0.join("Harden_ecc/analysis/qor_metrics.json"),
    )
    .unwrap();
    let flow = json!({"steps":[{"name":"Harden","tool":"ecc"}]});
    let report = load(&f.0, Some(&flow), None, &mut DesignSummary::default());
    assert_eq!(value(&report, "Die Area"), "—");
}
#[test]
#[ignore = "requires ECOS_SIGNOFF_TEST_WORKSPACE; reads existing workspace without writes"]
fn existing_workspace_design_is_complete_and_read_only() {
    fn inventory(
        root: &Path,
    ) -> std::collections::BTreeMap<PathBuf, (u64, Option<std::time::SystemTime>)> {
        let mut result = std::collections::BTreeMap::new();
        let mut pending = vec![root.to_path_buf()];
        while let Some(path) = pending.pop() {
            let meta = std::fs::symlink_metadata(&path).unwrap();
            if meta.is_dir() {
                pending.extend(std::fs::read_dir(path).unwrap().map(|e| e.unwrap().path()));
            } else {
                result.insert(path, (meta.len(), meta.modified().ok()));
            }
        }
        result
    }
    let root = PathBuf::from(std::env::var("ECOS_SIGNOFF_TEST_WORKSPACE").unwrap());
    let before = inventory(&root);
    let dashboard = crate::replay::dashboard::Dashboard::load(&root, &[]);
    assert_eq!(
        before,
        inventory(&root),
        "reading cards must not write workspace files"
    );
    assert!(
        dashboard.signoff.details.design_error.is_empty(),
        "{}",
        dashboard.signoff.details.design_error
    );
    let report = DesignReport {
        sections: dashboard.signoff.details.design,
        paths: vec![],
        error: String::new(),
    };
    assert_eq!(report.sections.len(), 8);
    assert!(!report.sections[3].rows.is_empty());
    for label in [
        "Die Area",
        "Core Area",
        "Total Instances",
        "Total Power",
        "Target Clock Period",
        "Routed Wirelength",
    ] {
        assert_ne!(value(&report, label), "—", "{label}");
    }
    for section in report.sections {
        for f in section.fields {
            println!("{} = {}", f.label, f.value);
        }
    }
}
