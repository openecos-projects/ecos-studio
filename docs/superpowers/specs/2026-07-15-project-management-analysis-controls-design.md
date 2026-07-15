# Project Management Analysis Controls Design

## Goal

Simplify the Project Management analysis area by removing its redundant heading
and moving its page selection controls into the dialog's existing window-control
area.

## Scope

- Remove the `Project Analysis` heading and the workspace/step comparison
  subtitle from the analysis panel.
- Place `Dashboard`, `QoR Trend`, and `Step Analysis` before the dialog
  maximize control in the top-right window-control bar.
- Keep the window controls right aligned in the order: analysis tabs, maximize,
  close.
- Allow the analysis body to start directly below the panel's existing padding,
  reclaiming the removed heading row's vertical space.
- Preserve the current selected-tab state, click handlers, ARIA tab semantics,
  and all analysis content.

## Implementation

`ProjectsView.vue` will render the existing `analysis-tabs` component markup in
`manager-window-controls`, before the maximize button. The former
`panel-title-row analysis-heading` block will be removed. Styling will make the
control bar a right-aligned flex row and retain readable, stable tab/button
sizes. No new state, routes, or API calls are needed.

The focused source-level test will be updated to assert that the removed labels
are absent and that the tab group occurs before the maximize action. Existing
tests continue to cover tab switching and the maximize toggle.

## Verification

Run the focused ProjectsView test, renderer type checking, and the desktop
package command. Electron Builder will create the refreshed AppImage in
`ecos/gui/apps/desktop-electron/release/`.
