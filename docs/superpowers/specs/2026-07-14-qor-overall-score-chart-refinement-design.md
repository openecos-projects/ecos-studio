# QoR Overall Score Chart Refinement Design

## Goal

Make the Project Management `Overall Score` chart read as an engineering score
chart rather than a decorative trend line. The score scale, workspace sequence,
and 60-point quality threshold must remain immediately scannable.

## Scope

Only the SVG chart in `ProjectQorTrendPanel` and its source-level test change.
The QoR model, score calculation, workspace ordering, baseline/export actions,
data sources, and non-clickable point behavior remain unchanged.

## Coordinate System

The chart retains the 0--100 range and its existing six score ticks. It gains
two explicit axes:

- The y-axis is a solid muted rule at the left edge of the plotting area.
- The x-axis is a solid muted rule at the bottom edge of the plotting area.
- Grid lines start at the y-axis and end at the plot's right boundary; they do
  not replace either axis.
- Tick labels are placed just outside the y-axis without clipping. Workspace
  labels remain below the x-axis and retain horizontal scrolling for long
  workspace sets.

The chart margins reserve stable space for the y labels and x labels. Points
remain centered within the plot interval; a single workspace remains centered.

## Visual Hierarchy

- Use compact SVG text: score ticks use `4.2px` and workspace labels `3.9px`
  in the 100-unit-high SVG viewBox (approximately 10--11 and 9--10 CSS pixels
  at the chart's minimum 250px height). The 60 label uses the same muted red
  family as its threshold line.
- Keep normal grid lines quiet and thin. The 60-point line remains a dark red
  quality threshold.
- Draw the score connection as a thin gray-blue dashed line. It indicates the
  workspace sequence but deliberately differs from the blue workspace circles.
- Draw normal scores as hollow blue circles against the panel background.
- Mark every tied maximum non-null score with an emerald double-ring and solid
  center. The highest score remains recognizable without adding a text label
  that could collide with neighboring points.
- Keep the existing SVG title tooltips. Points remain display-only and do not
  navigate to Step Analysis.

## Data and Edge Cases

- A missing score continues to render at the neutral position and is not
  eligible for best-score highlighting.
- If all scores are missing, no point receives the best-score treatment.
- Tied highest scores all receive the same highlight.
- The chart continues to derive positions only from the prepared
  `qorTrendSummary.trendPoints` data.

## Verification

Update the component source test to assert the presence of explicit x/y axes,
the compact score/workspace label styles, the dashed distinct trend line, and
best-score point styling. Run focused component and Project Management tests,
the renderer test suite, then rebuild and validate the Linux AppImage.
