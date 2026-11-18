use super::*;
use crate::replay::data::tests::Fixture;
use serde_json::json;

#[test]
fn final_score_is_authoritative_and_never_fabricated() {
    assert_eq!(
        final_score(&json!({"scalar_summary":{"score":93.58}})),
        Some(93.58)
    );
    for v in [
        json!({}),
        json!({"score":99}),
        json!({"scalar_summary":{"score":null}}),
        json!({"scalar_summary":{"score":101}}),
    ] {
        assert_eq!(final_score(&v), None);
    }
}
#[test]
fn custom_flow_groups_all_checks_without_revealing_future_results() {
    let f = Fixture::new();
    std::fs::create_dir_all(f.0.join("home")).unwrap();
    f.write(
        "home/flow.json",
        json!({"steps":[{"name":"route","state":"Success"},{"name":"custom","state":"Success"}]}),
    );
    f.write("home/qor_report.json",json!({"scalar_summary":{"score":92.5},"flow_steps":{"route":"Success","custom":"Success"}}));
    f.write(
        "home/checklist.json",
        json!({"checklist":[
            {"id":"r","step":"route","title":"Route","state":"attention"},
            {"id":"c","step":"custom","title":"Custom","state":"blocked","blocked":true},
            {"id":"w","step":"workspace","title":"Config","state":"pass"}
        ]}),
    );
    let mut d = Dashboard::load(&f.0, &[("route".into(), None), ("custom".into(), None)]);
    assert_eq!(d.score, Some(92.5));
    assert_eq!(
        d.groups.iter().map(|g| g.name.as_str()).collect::<Vec<_>>(),
        ["route", "custom", "Workspace"]
    );
    assert!(!d.groups[0].revealed(0, false, false));
    assert!(d.groups[0].revealed(0, true, false));
    assert!(!d.groups[1].revealed(0, true, false));
    assert!(d.groups[1].items[0].is_blocked());
    assert!(!d.groups[0].items[0].is_blocked());
    assert!(d.groups[2].revealed(1, true, true));
    assert!(!d.groups[2].revealed(0, true, false));
    assert_eq!(d.score, Some(92.5));
    f.write("home/checklist.json", json!({"checklist":[]}));
    d.check_current();
    assert!(d.stale);
}
#[test]
fn frozen_items_override_same_id_but_keep_workspace_only_flow_checks() {
    let parse = |v| serde_json::from_value::<Item>(v).unwrap();
    let mut items = BTreeMap::new();
    merge(
        &mut items,
        vec![
            parse(json!({"id":"check","step":"sta","state":"pass"})),
            parse(json!({"id":"flow","step":"sta","state":"pass"})),
        ],
        None,
    );
    merge(
        &mut items,
        vec![parse(json!({"id":"check","state":"blocked"}))],
        Some("sta"),
    );
    assert_eq!(items.len(), 2);
    assert!(items[&("sta".into(), "check".into())].is_blocked());
}
#[test]
fn stale_score_does_not_match_changed_flow() {
    let f = Fixture::new();
    std::fs::create_dir_all(f.0.join("home")).unwrap();
    f.write(
        "home/flow.json",
        json!({"steps":[{"name":"sta","state":"NotStarted"}]}),
    );
    f.write(
        "home/qor_report.json",
        json!({"scalar_summary":{"score":95},"flow_steps":{"sta":"Success"}}),
    );
    let d = Dashboard::load(&f.0, &[]);
    assert_eq!(d.score, None);
    assert_eq!(d.signoff.qor, QorSummary::default());
    assert!(!d.errors.is_empty());
}

#[test]
fn stale_score_does_not_match_added_or_removed_flow_steps() {
    let f = Fixture::new();
    std::fs::create_dir_all(f.0.join("home")).unwrap();
    f.write(
        "home/flow.json",
        json!({"steps":[{"name":"sta","state":"Success"},{"name":"custom","state":"Success"}]}),
    );
    f.write(
        "home/qor_report.json",
        json!({"scalar_summary":{"score":95},"flow_steps":{"sta":"Success"}}),
    );
    assert_eq!(Dashboard::load(&f.0, &[]).score, None);
}

#[test]
fn loads_signoff_card_summaries_from_ecc_report_artifacts() {
    let f = Fixture::new();
    std::fs::create_dir_all(f.0.join("home")).unwrap();
    f.write(
        "home/flow.json",
        json!({"steps":[{"name":"Harden","state":"Success"}]}),
    );
    f.write(
        "home/engineering-snapshot.json",
        json!({"parameters":{"design":"aes","top_module":"aes_cipher_top","pdk":"ics55"}}),
    );
    f.write(
        "home/qor_report.json",
        json!({
            "design":"aes",
            "scalar_summary":{"score":88.25,"status":"ORANGE"},
            "feasibility":{"status":"PASS","gates":[
                {"state":"passed"},{"state":"warning"},{"state":"failed"}
            ]}
        }),
    );
    f.write(
        "home/checklist.json",
        json!({"status":"attention","summary":{"passed":8,"attention":2,"blocked":1,"unavailable":0},"checklist":[]}),
    );

    let dashboard = Dashboard::load(&f.0, &[]);
    assert_eq!(
        dashboard.signoff.design,
        DesignSummary {
            name: "aes".into(),
            top_module: "aes_cipher_top".into(),
            pdk: "ics55".into(),
            harden_state: "Success".into(),
        }
    );
    assert_eq!(
        dashboard.signoff.qor,
        QorSummary {
            score: Some(88.25),
            scalar_status: "ORANGE".into(),
            feasibility_status: "PASS".into(),
            gate_summary: "1 pass · 1 attention · 1 blocked".into(),
        }
    );
    assert_eq!(
        dashboard.signoff.checklist,
        ChecklistSummary {
            status: "attention".into(),
            passed: Some(8),
            attention: Some(2),
            blocked: Some(1),
            unavailable: Some(0),
        }
    );
}

#[test]
fn missing_or_invalid_reports_do_not_fabricate_signoff_values() {
    let f = Fixture::new();
    let missing = Dashboard::load(&f.0, &[]).signoff;
    assert_eq!(missing.design, DesignSummary::default());
    assert_eq!(missing.qor, QorSummary::default());
    assert!(!missing.details.design_error.is_empty());
    std::fs::create_dir_all(f.0.join("home")).unwrap();
    std::fs::write(f.0.join("home/engineering-snapshot.json"), b"{invalid").unwrap();
    f.write(
        "home/qor_report.json",
        json!({"design":"aes","scalar_summary":{"score":101}}),
    );
    f.write(
        "home/checklist.json",
        json!({"summary":{"passed":-1,"attention":"two","blocked":null,"unavailable":0}}),
    );
    let dashboard = Dashboard::load(&f.0, &[]);
    assert_eq!(dashboard.signoff.design.name, "aes");
    assert_eq!(dashboard.signoff.qor, QorSummary::default());
    assert_eq!(
        dashboard.signoff.checklist,
        ChecklistSummary {
            unavailable: Some(0),
            ..Default::default()
        }
    );
    assert!(dashboard
        .errors
        .iter()
        .any(|error| error.starts_with("Design:")));
}

#[test]
fn unknown_feasibility_gates_remain_unavailable() {
    let qor = QorSummary::from_report(&json!({"feasibility":{"gates":[
        {"state":"passed"},{"state":"unavailable"},{}
    ]}}));
    assert_eq!(
        qor.gate_summary,
        "1 pass · 0 attention · 0 blocked · 2 unavailable"
    );
}

#[test]
fn signoff_card_inputs_are_watched_for_staleness() {
    let f = Fixture::new();
    std::fs::create_dir_all(f.0.join("home")).unwrap();
    for name in [
        "flow.json",
        "checklist.json",
        "qor_report.json",
        "engineering-snapshot.json",
    ] {
        f.write(&format!("home/{name}"), json!({}));
    }
    let mut dashboard = Dashboard::load(&f.0, &[]);
    assert!(!dashboard.stale);
    f.write("home/engineering-snapshot.json", json!({"changed":true}));
    dashboard.check_current();
    assert!(dashboard.stale);
}

#[test]
fn design_report_creation_invalidates_the_loaded_summary() {
    let f = Fixture::new();
    std::fs::create_dir_all(f.0.join("home")).unwrap();
    f.write("home/qor_report.json", json!({"design":"aes"}));
    let mut dashboard = Dashboard::load(&f.0, &[]);
    assert!(!dashboard.signoff.details.design_error.is_empty());
    std::fs::create_dir_all(f.0.join("signoff")).unwrap();
    std::fs::write(
        f.0.join("signoff/aes_design_summary.txt"),
        "DESIGN SUMMARY REPORT\n[ 1. PHYSICAL & AREA METRICS ]\n  Die Area      10 um²\n",
    )
    .unwrap();
    dashboard.check_current();
    assert!(dashboard.stale);
    let current = Dashboard::load(&f.0, &[]);
    assert!(current.signoff.details.design_error.is_empty());
    assert_eq!(current.signoff.details.design[0].fields[0].value, "10 µm²");
}
