# Documentation images

The desktop screenshots were captured on 2026-10-19 from ECOS Studio
0.1.0-alpha.9 (GUI source at `18ab2e9c`, identical to `80c46cde`), using
isolated application settings and the GCD RTL design. They show the real UI;
execution and checklist states have not been changed for the images.

- `overview-light.png` and `overview-dark.png`: the same backend workspace in
  both themes, with Agent hidden and the Flow zoom set to 55% so the full
  graph fits. Harden succeeded; EMIR is incomplete because its process
  technology file is unset. The checklist retains the advisory warnings.
- `home-light.png`, `project-management.png`, and `new-project.png`: application
  entry points and project management.
- `wizard-01-project.png` through `wizard-07-spec.png`: the seven backend
  workspace creation phases, using an existing project with imported RTL.
- `resource-manager.png` and `resource-pdks.png`: resource catalog and a real
  local ICS55 PDK registration. Development runtime status is expected in
  these source-build captures; installed release builds show their own state.
- `step-checklist.png`, `step-reports.png`, `step-log.png`,
  `timing-analysis.png`, and `flow-configuration.png`: the current result and
  parameter dialogs. Dialog captures exclude the surrounding desktop.
- `workspace-agent.png`: a configured Agent session bound to the GCD
  workspace, showing the available operation choices beside the dashboard.
  The setup card is closed and no credentials appear in the capture.
- `frontend-rtl-setup.png`: the General RTL profile’s source and clock setup.
- `chip-viewer.png`: the real native Viewer in fullscreen at 2560 × 1600,
  displaying the GCD route geometry with physical layers and drawing data
  enabled. This virtual-machine capture uses 2D software rendering.

To refresh screenshots, build the desktop app with `pnpm run desktop:build`
from `ecos/gui`, launch with a separate application profile, and navigate the
actual UI. Use a copy of a completed workspace for result dialogs. Keep
credentials out of the profile, retain the actual result states, wait for
loading and transitions to finish, and check images in both GitHub Markdown
and the application’s User Guide. Update captions when behavior changes.

`workspace-reuse-rtl.png` and `workspace-reuse-filelist.png` were captured on
2026-10-29 by the repeated-workspace desktop E2E using the snapshot-reader fix.
Each shows the third creation wizard after a second workspace was successfully
created from the corresponding import mode. The `gcd` top module remains
selected, both existing workspace source copies match the imported RTL, and
Create Workspace is enabled. These captures use isolated application settings
and the real GCD design; no UI state was altered for the images.

`ecos-studio-solution.png` is the conceptual diagram used by the repository
root README, rather than a screenshot of the application UI.
