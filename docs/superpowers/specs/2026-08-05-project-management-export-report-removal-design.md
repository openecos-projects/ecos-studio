# Project Management Export Report Removal

## Scope

Remove the `Export report` control from the Project Management dashboard's project-health action area. Keep the baseline display and baseline-setting workflow unchanged.

## Considered Approaches

1. Hide the button with CSS. This preserves obsolete UI and its event path, so it is not selected.
2. Remove only the panel button. This leaves a dead `export-report` component event and parent handler, so it is not selected.
3. Remove the UI control and its dedicated event chain. This keeps the component contract and parent view free of unused export behavior. This is the selected approach.

## Design

`ProjectAnalysisPanel` will retain the baseline chip and `Set baseline` button. Its existing flex action row will then size itself to the remaining controls, preserving the six-pixel inter-control gap and right alignment at desktop widths. The existing responsive rule will continue to left-align the same compact group on narrower widths.

The `export-report` emit declaration, button click handler, parent listener, and now-invalid unit test will be removed. The parent export helper will also be removed when it has no remaining caller.

## Verification

Update the panel test to assert that `Export report` is absent while retaining baseline interaction coverage. Run the focused component test and renderer typecheck.
