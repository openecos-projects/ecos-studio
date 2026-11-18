use super::*;
use serde_json::json;

#[test]
fn report_parser_preserves_units_notes_corners_and_long_stage_names() {
    let text = "ECOS STUDIO — DESIGN SUMMARY REPORT\n\
        [ 1. PHYSICAL & AREA METRICS ]\n\
          Die Area                             55743.12 um² (0.0557 mm²) Physical boundary\n\
        [ 4. MULTI-CORNER TIMING ]\n\
          Corner                     Setup WNS   Setup TNS    Hold WNS    Hold TNS  Status\n\
          TYP_25/TYPICAL               2.90 ns        0 ns     0.13 ns        0 ns  PASS\n\
        [ 8. FLOW EXECUTION COST ]\n\
          Total Runtime                        35m 21s              Wall clock time\n\
          Stage              Tool                  Runtime     Peak Mem  State\n\
          Timing optimization sizer                  1m 19s   1500.58 MB  Success\n";
    // Preserve indentation like the CLI's fixed-width text formatter.
    let text = text
        .lines()
        .map(|l| {
            if l.starts_with('[') || l.starts_with("ECOS") {
                l.to_owned()
            } else {
                format!("  {l}")
            }
        })
        .collect::<Vec<_>>()
        .join("\n");
    let sections = parse_design(&text).unwrap();
    assert_eq!(
        sections[0].fields,
        vec![Field {
            label: "Die Area".into(),
            value: "55743.12 µm² (0.0557 mm²)".into(),
            note: "Physical boundary".into()
        }]
    );
    assert_eq!(
        sections[1].rows[0],
        [
            "TYP_25/TYPICAL",
            "2.90 ns",
            "0 ns",
            "0.13 ns",
            "0 ns",
            "PASS"
        ]
    );
    assert_eq!(
        sections[2].rows[0],
        [
            "Timing optimization",
            "sizer",
            "1m 19s",
            "1500.58 MB",
            "Success"
        ]
    );
    assert!(parse_design("garbage").is_err());
    assert!(parse_design("DESIGN SUMMARY REPORT\n[ 1. EMPTY ]").is_err());
}
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
#[test]
fn design_paths_reject_traversal_and_escaping_symlinks() {
    let f = crate::replay::data::tests::Fixture::new();
    assert!(design_path(&f.0, "../secret").is_none());
    assert!(design_path(&f.0, "..\\secret").is_none());
    #[cfg(unix)]
    {
        std::fs::create_dir_all(f.0.join("signoff")).unwrap();
        let path = design_path(&f.0, "aes").unwrap();
        std::os::unix::fs::symlink("/etc/passwd", &path).unwrap();
        assert!(read_design(&f.0, &path).is_err());
    }
}
