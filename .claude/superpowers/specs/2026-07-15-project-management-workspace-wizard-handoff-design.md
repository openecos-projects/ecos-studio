# Project Management Workspace Wizard Handoff Design

## Goal

Ensure that a workspace created from an existing Project Management workspace
always opens the ECOS Studio Workspace Wizard after the user confirms the
branch draft.

## Problem

`ECCView` loads source-workspace parameters, PDK configuration, and database
configuration before setting its wizard-visible state. A desktop file-access or
read failure aborts that async prefill path, leaving the wizard hidden even
though Project Management routed to `/ecc` with valid branch parameters.

## Design

- Keep the current flow: choose an available source step, review the Create
  Workspace confirmation, then select Continue.
- Make source-workspace configuration loading best effort. A failed optional
  read returns no reusable source configuration instead of rejecting the
  handoff.
- Always build the wizard initial configuration from the route query and show
  the Workspace Wizard. Existing source configuration continues to enrich the
  PDK, SDC, and parameter defaults when it is readable.
- Log the prefill failure for diagnostics without exposing technical errors in
  the wizard flow.

## Verification

- Add a focused ECCView source-level test for the fallback behavior.
- Run Project Management and ECCView focused tests plus renderer type checking.
- Rebuild the desktop AppImage and verify the new artifact exists.
