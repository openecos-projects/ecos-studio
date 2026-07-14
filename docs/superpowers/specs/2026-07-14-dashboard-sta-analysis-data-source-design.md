# Dashboard STA Analysis Data Source Design

## Goal

Make Project Management Dashboard timing data use only the STA step's
`analysis/` artifacts. The Key Metric Snapshot must agree with the timing
metrics already shown by STA Step Analysis and must not parse corner reports
under `sta_ecc/output/`.

## Data Contract

The desktop application reads the existing STA analysis input already loaded
for the `STA` step:

1. Prefer `sta_ecc/analysis/qor_metrics.json`.
2. Fall back only to `sta_ecc/analysis/sta_metrics.json` when the normalized
   artifact is unavailable.
3. Do not read `qor_summary.json` in individual output corners, legacy
   `*.rpt.json`, or text timing reports.

Both accepted files are produced from the same ECC STA metric builder. The
consumer recognizes these equivalent fields:

| Dashboard metric | Normalized QoR field | Legacy STA analysis field |
| --- | --- | --- |
| Frequency [MHz] | `sta_frequency_mhz` | `Frequency [MHz]` |
| Setup WNS | `sta_setup_wns` | `max_WNS` |
| Setup TNS | `sta_setup_tns` | `max_TNS` |
| Hold WNS | `sta_hold_wns` | `min_WNS` |
| Hold TNS | `sta_hold_tns` | `min_TNS` |

Missing or malformed values remain pending. The Dashboard never substitutes a
value from report files or a zero value.

## Dashboard Presentation

Keep the existing physical, DRC, runtime, and memory columns. Replace the
ambiguous `WNS` and `TNS` labels with `Setup WNS` and `Setup TNS`, and add
`Hold WNS` and `Hold TNS` adjacent to them. The final Key Metric Snapshot order
is: Die Area, Core Util, Frequency, Setup WNS, Setup TNS, Hold WNS, Hold TNS,
DRC, Runtime, Memory. Its existing horizontal scrolling handles the two new
columns.

The Best workspace PPA summary uses the same five timing values so it cannot
disagree with the comparison table. Signoff readiness semantics stay unchanged:
they continue to use setup timing and DRC only.

## Implementation Boundary

`ProjectsView` stops requesting the fixed list of STA corner report files and
the project-management utility stops aggregating `staReports`. A focused STA
analysis parser in that utility resolves the five values from the already
loaded STA step metric text. Existing ECC metric production is unchanged,
because it already writes all required canonical and legacy fields.

## Verification

Add utility tests for normalized and legacy STA analysis inputs, source tests
that reject STA output reads, and Dashboard tests for the five timing columns.
Run focused tests, the full renderer suite, type checking, and `make build`.
