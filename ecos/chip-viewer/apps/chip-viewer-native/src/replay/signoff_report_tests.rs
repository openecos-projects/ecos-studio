use super::*;
use serde_json::json;

#[test]
fn details_keep_unknown_scores_and_advisory_checks_distinct_from_failure() {
    let qor = json!({"qor_record":{"interconnect":{"value":0,"state":"FAIL"},"power":{"value":null,"state":"UNKNOWN"}},"evidence":{"coverage":2.0},"diagnoses":[{"diagnosis_id":"diag.place.congestion","state":"WATCH","interventions":[{"hypothesis":"Try a lower density","validation_procedure":"Recheck routing"}]}]});
    let checks = json!({"checklist":[{"step":"emir","state":"warning","blocked":false,"title":"Review report","summary":"Execution success is not a signoff verdict.","source":{"path":"home/flow.json"}}]});
    let result = ReportDetails::load(Some(&qor), Some(&checks));
    assert_eq!(result.quality[1].score, Some(0.0));
    assert_eq!(result.quality[3].score, None);
    assert_eq!(result.evidence[2].value, "N/A");
    assert_eq!(result.checks[0].state, "warning");
    assert!(!result.checks[0].blocked);
    assert_eq!(result.checks[0].evidence, ["home/flow.json"]);
    assert!(result.diagnoses[0].actions[0]
        .note
        .contains("Recheck routing"));
}
