# iSTA QoR Summary JSON Design

## Goal

Generate `qor_summary.json` next to the existing `qor_summary.rpt` whenever
iSTA produces its QoR summary. The JSON is a structured representation of the
same data, not a new QoR calculation or an ECC-side post-processing step.

## Scope

Only the iSTA timing reporter changes:

- `TimingReporter::outputQorSummaryReport()` continues to calculate the QoR
  maps and totals exactly once.
- It writes the existing text report unchanged.
- It also writes `qor_summary.json` under `tr_temp_directory_path`.
- No ECC Python, report collection, analysis, or UI code changes.

## JSON Contract

The document uses numeric JSON values for available QoR data and `null` for
values rendered as `~` in the text report.

```json
{
  "path_groups": [
    {
      "name": "clk",
      "setup": {
        "wns": -0.012,
        "tns": -0.120,
        "nvp": 3,
        "frequency_mhz": 501.2
      },
      "hold": {
        "wns": 0.003,
        "tns": 0.0,
        "nvp": 0
      }
    }
  ],
  "summary": {
    "setup": {
      "wns": -0.012,
      "tns": -0.120,
      "nvp": 3,
      "frequency_mhz": 501.2
    },
    "hold": {
      "wns": 0.003,
      "tns": 0.0,
      "nvp": 0
    }
  },
  "design_statistics": {
    "cap": 0,
    "fanout": 0,
    "tran": 0,
    "tdrc": 0,
    "cella": 1234,
    "bufs": null,
    "leafs_k": 12,
    "tnets_k": null,
    "ctbuf": null,
    "regs": null
  }
}
```

`path_groups` uses the same setup-first, then hold-only ordering as the text
report. Group names are JSON-escaped. A group with no setup or hold value has
the corresponding object set to `null`, matching the text report's `~` cells.

When there are no path groups, iSTA retains the current empty
`qor_summary.rpt` behavior and creates valid JSON with an empty
`path_groups` array, `summary` fields set to `null`, and the same design
statistics values available to the text report.

## Implementation

Add a JSON output helper and a sibling path helper in `TimingReporter`.
The helper consumes the maps and aggregate values already computed by
`outputQorSummaryReport()`; it does not read or parse `qor_summary.rpt`.
Use the existing iSTA output stream utilities and manual JSON serialization to
avoid adding a new third-party JSON dependency for this narrow report change.

## Error Handling

Both report files use iSTA's existing output stream utility. A failure to open
the JSON path follows the same utility behavior as the existing report path;
the text report generation logic is not altered.

## Verification

Run an available iSTA STA flow and verify that every report directory
containing `qor_summary.rpt` also contains parseable `qor_summary.json`.
Compare one path group's setup/hold values, the aggregate summary, and `CELLA`
against the text report. Also verify a no-constrained-path case creates valid
empty JSON without changing the existing text-report behavior.
