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
