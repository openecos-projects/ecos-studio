# Project Management Dashboard QoR Merge Design

## Goal

Merge the standalone Project Management QoR Trend view into Dashboard while
retaining the QoR chart, comparison lists, baseline, and export workflows.

## Navigation And Layout

- Keep only `Dashboard` and `Step Analysis` in the dialog control bar; remove
  the `QoR Trend` tab and its selected-tab state.
- Render Dashboard as a two-row grid with a `1fr 5fr` height ratio.
- The first row contains two equal-width cards: `Workspace Run State` and
  `Best QoR Score`.
- The second row has top tabs: `QoR Overview` and `Key Metric Snapshot`.

## Dashboard Content

`Workspace Run State` continues to show the workspace run-state distribution,
workspace count, DRC-clean count, timing-clean count, and signoff-ready count.

`Best QoR Score` shows the highest-scoring workspace, its score, workspace name,
and hard-gate status. Its `Score Details` action opens a detail view that shows:

- The weighted-score calculation.
- Available dimension scores, effective weights, and contributing raw metrics.
- The DRC/blocking-issue cap that limits the final score to 60 when triggered.

The score continues to use the existing calculation: timing 35%,
routability/physical 20%, area 10%, and clock/DFM 10%. Dimensions without data,
including currently unsupported power/IR/EM, are omitted and the remaining
weights are normalized to 100%.

`QoR Overview` reuses the existing chart and the Improvements, Regressions, and
Risks lists. Baseline selection and report export remain available in its local
header. `Key Metric Snapshot` reuses the existing workspace comparison table.

## Implementation

Keep `ProjectQorTrendPanel` as the embedded QoR Overview implementation rather
than copying its chart/list logic into `ProjectsView`. Remove its standalone
QoR Trend heading and summary-card presentation. Add a pure score-detail helper
to `projectQorTrend.ts` so the Dashboard score detail view derives its formula,
dimension contributions, and source metric values from the same scoring logic.

Update source-level tests for the removed tab, the 1:5 Dashboard layout, QoR
overview/page tabs, and score-detail data. Existing QoR score behavior and
project data sources remain unchanged.

## Verification

Run focused tests for Project Management, QoR overview, and QoR scoring; run
renderer type checking. No desktop package is required for this UI-only change
unless separately requested.
