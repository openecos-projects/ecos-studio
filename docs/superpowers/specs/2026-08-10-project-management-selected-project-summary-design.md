# Project Management Selected-Project Summary Loading

## Goal

Project Management must render the left navigation from Project manifests, but
only load workspace flow, QoR, and analysis data for the Project currently
selected in the UI. Switching Projects must load the newly selected Project
without allowing an older request to replace the right-hand QoR or Data
Analysis view.

## Scope

- Keep Project manifest reads bounded and independent of the active workspace.
- Do not prefetch workspace summaries for unselected Projects.
- Preserve the existing typed `desktopApi.projectManagement` IPC boundary,
  allowlist, file-size caps, and concurrency limits.
- Treat optional workspace artifact failures independently. A bad or oversized
  optional artifact must not erase other data from the same workspace.

## Data Flow

1. On entry, load and parse historical Project manifests with the existing
   concurrency cap. This supplies the Project and workspace navigation data.
2. Once a Project is selected, create a selection generation and set its
   summary state to loading. Request summaries only for workspaces declared by
   that selected Project manifest.
3. Electron reads each allowlisted artifact with the existing per-file bounds.
   It returns successfully read texts and identifies unavailable optional paths.
   Missing, unreadable, or oversized optional files are unavailable values;
   invalid roots, undeclared workspaces, and path-boundary violations remain
   request failures.
4. The renderer derives flow, QoR, and Data Analysis models from the available
   texts. It merges new values with the selected Project's last confirmed
   values, so an unavailable optional artifact cannot clear unrelated cards.
5. Before committing a response, the renderer verifies that both the selected
   Project and its selection generation still match. A response for a Project
   that was deselected is discarded.

## State And Errors

Each Project has an in-memory summary state: `idle`, `loading`, `ready`, or
`error`, keyed by canonical Project root and manifest generation.

- `idle`: no workspace summary I/O has occurred for this Project.
- `loading`: the selected Project has an active request; prior confirmed data
  may remain visible while it refreshes.
- `ready`: the latest request supplied a partial or complete workspace summary.
- `error`: a Project-level contract or transport error occurred. The UI keeps
  any previously confirmed data and presents a concise unavailable state.

Optional artifact failures are represented per path, not as a Project-level
error. They produce only the corresponding unavailable metric or analysis
section. Security and declaration failures do not become optional failures.

## Testing

- Opening Project Management reads manifests for navigation but does not call
  workspace-summary IPC for unselected Projects.
- Selecting a Project calls summary IPC only for that Project's declared
  workspaces; switching Projects calls it for the new selection only.
- A stale response from the prior selection cannot update right-hand QoR or
  Data Analysis state.
- One missing, unreadable, or oversized optional artifact leaves flow and all
  other QoR/analysis data visible.
- An invalid Project root, undeclared workspace, or path escape still rejects
  the summary request and cannot expose files outside the declared workspace.
