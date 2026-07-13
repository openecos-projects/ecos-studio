# QoR Trend Chart Layout Design

## Goal

Simplify the Project Management QoR Trend surface so its primary area focuses
on the workspace score chart and one compact, scrollable delta card.

## Scope

Only the renderer QoR Trend panel and its source-level test change. The QoR
model, project-scoped data source, baseline/export actions, and all file
loading behavior remain unchanged.

## Removed UI

Remove these display modules from `ProjectQorTrendPanel`:

- The `Missing Analysis` summary card.
- The `Selected Workspace` detail card.
- The `Missing Analysis` detail card, including its missing-step, missing-metric,
  and unsupported-module list.
- The vertical workspace list currently displayed beside the Overall Score SVG.

The underlying missing-analysis and unsupported-module data remains in the
prepared QoR model; it is simply not rendered in this revised panel.

Trend points are no longer buttons and do not emit workspace/step selection.
The parent keeps its existing selection handler for compatibility, but this
panel no longer invokes it.

## Layout

The summary row retains Overall Score, Best Score, and Largest Regression.
Below it, one two-column content row contains:

- A flexible `Overall Score` chart card on the left.
- A fixed-width delta card on the right with `Top Improvements` and `Top
  Regressions` tabs.

The active delta list occupies the remaining vertical space in its card and
uses `overflow: auto` so no rows are hidden or truncated. The content stacks
at narrow widths.

## Chart

Render the score chart as SVG without adding a chart dependency.

- Score range is 0 through 100.
- Render labels and horizontal grid lines at 0, 20, 40, 60, 80, and 100.
- The 60-point grid line uses a dark red stroke; the other grid lines use the
  normal muted border color.
- Draw the score polyline above the grid.
- Render every workspace score as a hollow circle (`fill` uses the panel
  background and `stroke` uses the accent color).
- Render the workspace name beneath each point on the x-axis. Use a compact
  readable font, a title tooltip with the complete name, and a horizontal
  scrolling chart viewport when labels exceed available width.
- Missing scores remain represented at the neutral chart position but retain
  their workspace label.

## Verification

Update `ProjectQorTrendPanel.test.ts` to assert the removed modules are absent,
the SVG score ticks/grid/60-point threshold/hollow-circle chart features are
present, and the delta tabs and scrollable list are present. Run the focused
component test and the Project Management view test, then rebuild the full
ECOS Studio AppImage using the repository release command.
