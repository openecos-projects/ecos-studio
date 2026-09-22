# ECOS Studio User Guide

This guide walks you through using ECOS Studio to design and implement your chip
from RTL to GDS. It covers every screen and operation in the desktop
application: managing resources and PDKs, creating and organizing workspaces,
running the RTL-to-GDS flow, inspecting layouts in the Chip Viewer, using the
built-in Agent, and working with the experimental frontend (RTL verification)
environment.

## Table of Contents

- [Getting Started](#getting-started)
  - [Launching ECOS Studio](#launching-ecos-studio)
  - [Home Screen](#home-screen)
  - [Application Shell](#application-shell)
  - [Menus and Shortcuts](#menus-and-shortcuts)
- [Managing Resources](#managing-resources)
  - [Command Line Tools](#command-line-tools)
  - [Resource Manager](#resource-manager)
  - [MPC Resources](#mpc-resources)
- [Backend Design](#backend-design)
  - [Backend Design Landing Page](#backend-design-landing-page)
  - [Creating a New Workspace](#creating-a-new-workspace)
  - [Creating a Workspace From a Step Output](#creating-a-workspace-from-a-step-output)
  - [Updating a Workspace](#updating-a-workspace)
- [Project Management](#project-management)
  - [Projects and Workspace List](#projects-and-workspace-list)
  - [Creating a Project](#creating-a-project)
  - [Importing Projects and Workspaces](#importing-projects-and-workspaces)
  - [Removing and Deleting](#removing-and-deleting)
  - [Project Analysis](#project-analysis)
  - [Recovery and Background Operations](#recovery-and-background-operations)
- [Workspace Overview](#workspace-overview)
  - [Navigation Sidebar](#navigation-sidebar)
  - [Workbench Layout](#workbench-layout)
  - [Home Dashboard](#home-dashboard)
- [Running the RTL-to-GDS Flow](#running-the-rtl-to-gds-flow)
  - [Starting and Re-running](#starting-and-re-running)
  - [Monitoring Progress](#monitoring-progress)
  - [Cancelling a Flow](#cancelling-a-flow)
  - [Viewing Logs](#viewing-logs)
- [Step Pages](#step-pages)
  - [Overview and Checklist](#overview-and-checklist)
  - [Quality of Results](#quality-of-results)
  - [Layout](#layout)
  - [Data Insights](#data-insights)
  - [Data Reports](#data-reports)
- [Configuring the Flow](#configuring-the-flow)
- [Chip Viewer](#chip-viewer)
  - [Opening the Chip Viewer](#opening-the-chip-viewer)
  - [Canvas Navigation](#canvas-navigation)
  - [Sidebar Panels](#sidebar-panels)
  - [Analysis Tabs](#analysis-tabs)
  - [Macro Placement Editing](#macro-placement-editing)
  - [Keyboard Shortcuts](#keyboard-shortcuts)
- [ECOS Agent](#ecos-agent)
  - [Chat Panel](#chat-panel)
  - [Proposals and Confirmation](#proposals-and-confirmation)
  - [Agent Sessions](#agent-sessions)
  - [Agent Setup](#agent-setup)
- [Frontend Design (Experimental)](#frontend-design-experimental)
  - [Frontend Landing Page](#frontend-landing-page)
  - [Frontend Workspace Wizard](#frontend-workspace-wizard)
  - [Frontend Workspace Layout](#frontend-workspace-layout)
  - [Prepare](#prepare)
  - [RTL Review](#rtl-review)
  - [Elaboration (Elab)](#elaboration-elab)
  - [Lint](#lint)
  - [Simulation (Sim)](#simulation-sim)
  - [Cases and Waveforms](#cases-and-waveforms)
  - [Source Editor](#source-editor)
  - [Waveform Viewer](#waveform-viewer)
- [Tech Library](#tech-library)
- [Global UI](#global-ui)
  - [Notifications](#notifications)
  - [Background Tasks](#background-tasks)
  - [Terminal Panel](#terminal-panel)
  - [Theme, Zoom, and About](#theme-zoom-and-about)
  - [Exporting Results](#exporting-results)
- [Troubleshooting](#troubleshooting)
- [Next Steps](#next-steps)

---

## Getting Started

### Launching ECOS Studio

**Linux (AppImage):**

> [AppImage](https://en.wikipedia.org/wiki/AppImage) is a portable Linux
> application format — download a single file, make it executable, and run it
> without installation. ECOS Studio is a GUI application and requires a desktop
> environment (X11 or Wayland) to run — it cannot be launched from a headless
> environment.

```bash
chmod +x ./ECOS-Studio_*.AppImage
./ECOS-Studio_*.AppImage
```

**From Nix:**

```bash
nix shell .#ecos-studio
ecos-studio
```

### Home Screen

When you first launch ECOS Studio you'll see the home screen. It contains:

**Design Tools** — two entry cards:

- **Frontend Design** — RTL / Verilog / SystemVerilog verification environment
  (review, elaboration, lint, simulation, waveforms). This feature is
  **experimental**: it works, but is under rapid development and may change or
  break between releases.
- **Backend Design** — the main chip implementation tool covering
  **Synthesis → P&R → GDS**. Click this card to enter the backend design
  environment.

**Quick links:**

- **Resource Manager** — install and manage EDA tools, compilers, PDKs, and MPC
  templates.
- **MPC Resources** — browse installed MPC (template and core constraint)
  packages.
- **IP Catalog** / **Benchmarks** — placeholder entries; not yet available.

**Command line tools** — shows the install status of the `ecos-ecc` host CLI
with **Install / Reinstall** and **Uninstall** buttons (see
[Command Line Tools](#command-line-tools)).

**Project Management** — a dashed-outline button at the bottom that opens the
project manager (see [Project Management](#project-management)).

### Application Shell

The application window is organized as follows:

- **Top Bar** — application menu (File / Edit / View / Help), current project
  name, quick actions, notifications, theme toggle, and window controls.
- **Page Content** — the current screen (welcome pages, workspace pages, …).
- **Status Bar** — version text on the left; a **Terminal** toggle button on
  the right that shows or hides the built-in terminal panel.
- **Agent Drawer** — on non-workspace screens, the ✨ **ECOS Agent** button in
  the top bar opens a chat drawer on the right edge. Drag its left edge to
  resize (280–720 px).
- **Terminal Panel** — a bottom panel with one or more shell sessions (see
  [Terminal Panel](#terminal-panel)).

### Menus and Shortcuts

The application menu lives in the top-left of the top bar. Click a menu to open
it; while a menu is open, hovering another menu name switches to it. Press
`Esc` or click outside to close.

- **File**
  - **New Window** (`Ctrl+Shift+N`) — open a new application window.
  - **New Workspace** (`Ctrl+N`) — open the workspace creation wizard.
  - **Open Workspace** (`Ctrl+O`) — pick a directory and open that workspace.
  - **Update Workspace** — re-run the wizard on the current workspace to change
    its configuration. Disabled while a flow is running.
  - **Export Signoff Package** *(workspace screens only)* — review and export
    the sign-off package. Disabled while a flow is running.
  - **Export Design Summary** — export a design summary report.
- **Edit → Config** *(workspace screens only)* — open the
  [Step Configuration](#configuring-the-flow) dialog.
- **View**
  - **Zoom In** (`Ctrl+`+) / **Zoom Out** (`Ctrl+`-) / **Reset Zoom**
    (`Ctrl+0`) — scale the whole UI between 80% and 140%. The setting persists
    across launches.
- **Help**
  - **Documentation** — open this user guide in a browser.
  - **About** — show version information for all components, with a **Copy
    version info** button for pasting into bug reports.

Global shortcuts (Windows/Linux use `Ctrl`, macOS uses `Cmd`):

| Shortcut | Action |
|---|---|
| `Ctrl+N` | New Workspace (open wizard) |
| `Ctrl+Shift+N` | New Window |
| `Ctrl+O` | Open Workspace |
| `Ctrl+`+` / `-` / `0` | UI zoom in / out / reset |
| `Esc` | Close menus, dialogs, popovers, notifications |
| `Enter` | Confirm the default action in dialogs |

---

## Managing Resources

### Command Line Tools

The **Command line tools** card (on the home screen and in Resource Manager)
manages the `ecos-ecc` host command that exposes the packaged RTL-to-GDS
runtime on your shell.

- The status pill shows one of: *Unsupported*, *Development*, *Not installed*,
  *Installing*, *Ready*, *Self-check failed*, *Failed*.
- When installed, the card shows the version plus bundle and shim paths.
- **Install / Reinstall** downloads and verifies the bundle (a progress bar
  with percentage is shown); **Uninstall** removes it. Linux only.

### Resource Manager

Open it from the home screen's **Resource Manager** quick link (route
`/tools`). It manages frontend resources, EDA tools, compiler toolchains, PDKs,
and MPC projects.

**Layout:**

- **Close button** (top-left `×`) — return to the home screen.
- **Left navigation** — categories: *All Resources*, *Frontend Flow*, *EDA
  Tools*, *PDKs*, *MPC*, *Installed*, each with a count badge. Selecting
  *Frontend Flow* also shows a readiness bar (per stage: Review / Elab / Lint /
  Sim / Wave).
- **Need help?** card — links to the user guide.
- **Toolbar** — search box (matches name, description, version, dependencies),
  status tabs *All / Available / Installed / Updates*, and a **Refresh**
  button.

**Resource rows** show an icon, name, description, flow tags, dependency tags
("Installs n required: …"), version, size, and a status pill. Possible row
actions, depending on state:

- **Import Local** — point at a local directory to register a locally built
  tool, or **link a PDK** (files stay in place; the PDK is registered by
  reference).
- **Install** / **Update** / **Replace** (swap a local tool for the managed
  build without deleting the original directory).
- **Cancel** — abort an in-progress installation.
- **Retry** — retry after an error (download failed, verification failed,
  post-install failed, …).
- **Validate** *(PDKs)* — re-verify PDK integrity.
- **Uninstall / Remove** — uninstalling asks for confirmation because it cannot
  be undone; *Remove reference* only unlinks a PDK without touching its files.

**Batch install:** select multiple resources with the **Selected panel** on the
right. It lists the pending selections (with missing dependencies marked "+n
required"), an estimated total size, and a **Download** button that installs
everything (two at a time).

### MPC Resources

Open it from the home screen's **MPC Resources** quick link (route `/mpc`).

- **Manage** jumps to Resource Manager; **Refresh** reloads the list.
- **Left** — installed MPC resources (name + version); click to select.
- **Right** — details for the selected package: version, an *Update available*
  badge when applicable, a **Design** dropdown when the spec contains multiple
  designs, and a template preview showing design information (name, directory,
  DBU, IO pin count), die/core geometry, other resources, I/O metadata, and an
  I/O pins table.
- Empty state links directly to Resource Manager.

---

## Backend Design

### Backend Design Landing Page

Click the **Backend Design** card on the home screen. The landing page offers:

- **Back to ECOS** — return to the home screen.
- **Open Workspace** — pick a directory; the workspace is registered in the
  project-management context and opened.
- **New Workspace** — open the creation wizard (see below).
- **Recent Workspaces** — cards for your most recent workspaces with the PDK
  badge, a status badge (Success / Completed with warnings / Failed / Running /
  In Progress / Not Started), completed step count ("x/y steps"), path, and a
  relative timestamp (Today / Yesterday / N days ago). Workspaces whose state
  cannot be verified show a stale (*Stale · last verified*) badge in amber.
  Hover a card to reveal **×** (remove from the list — files are not deleted)
  and click the card to reopen it. Unrecognized workspaces are greyed out and
  cannot be opened. When there are more than three entries, **View All (N) /
  Collapse** toggles between the short and full list. This list is how you
  *resume where you left off*.

### Creating a New Workspace

Click **New Workspace** to open the wizard. The dialog can be maximized, and
its left step strip lets you jump back to any step you have already reached.
The six steps:

**Step 1 — Project Setup.** Choose how to anchor the workspace:

- **Select Project** mode — pick an existing **Project Root** (read-only field,
  click it or **Browse** to choose a directory), optionally pick from the
  **Recent Projects** list, and set the **Project Name**.
- **Create Project** mode — enter a **Project Name** and a **Project Parent
  Path** (click or **Browse** to choose).
- A preview card shows the resulting project path and the location of
  `project.json`.

Names must not contain spaces or Chinese characters.

**Step 2 — Basic Info.**

- **Workspace Name** (required; must not contain spaces or Chinese characters;
  defaults to the design name until you edit it).
- **Description** — optional free text, stored in `params.toml`.
- **Workspace Location** — read-only preview of where the workspace will be
  created (`<project root>/<workspace name>`).

**Step 3 — Flow Setup.** Define the step range of the harden flow:

- A summary strip shows the selected **Start Step**, **End Step**, and step
  count.
- Click a step card to set the range. Steps are marked *Reused from source*
  (locked, when deriving from another workspace), *Skipped by default*, and
  *Skippable*.

**Step 4 — Design Files.** The inputs depend on the start step (the left rail
lists what is required and what is complete):

- Start at **Synthesis** — **RTL** (required): drag & drop `.v` / `.sv` /
  `.vhd` / `.vhdl` files (`.gz` allowed) or a design folder, or use the
  **Browse** menu (**Select RTL files…** / **Select design folder…** — folder
  scans let you check a subset of discovered files). Alternatively provide a
  **Filelist** (mutually exclusive with the RTL list). **SDC** is optional.
- Start at **preFloorplan** — **Verilog** netlist (required) + optional SDC.
- Start later — **DEF** (required) + **Verilog** (required) + optional SDC.
  Each single-file input has an **Import …** button that opens a filtered file
  dialog.

**Step 5 — PDK Config.**

- Pick a **Process Design Kit** from the imported PDK cards (name, node,
  source, version, and a readiness badge: ready / unverified / missing /
  invalid; unqualified PDKs cannot be selected). Card actions: **Re-check
  PDK**, **Locate** (when files are missing), **Remove PDK** (hover, when not
  selected), and **Import PDK** at the top.
- **PDK Path** shows the PDK declared in the project `ecc.toml`; a mismatch
  raises an amber warning.
- **External PDK Paths** lets you add project-level extra macro LEF / liberty
  pools that take part in manual resource picking.
- **Config Mode** — **Default Config** (ECC's default layout; requires a ready
  PDK that supports ECC defaults) or **Manual Config** (pick your own Tech LEF,
  Cell LEF, and Liberty files via the resource picker). Three requirement
  indicators show whether PDK selection, PDK eligibility, and the chosen config
  mode are satisfied.

**Step 6 — Spec Setting.** Stored in the workspace `params.toml`:

- **Design Name** (required; read-only if the project already declares one),
  **Top Module** (auto-discovers candidate modules from your RTL/netlist and
  suggests them; a **Return to Design Files** shortcut appears when discovery
  finds nothing), **Clock Signal Name** (required), **Frequency max [MHz]**.
- **Max Fanout**, **Target Density**, **Target Overflow**, and any additional
  parameters declared by the ECC parameter catalog (rendered as dropdowns,
  checkboxes, or number fields; inapplicable parameters are disabled with an
  explanation).
- **Die Area** — either explicit **Width × Height**, or **Core Utilization**.
  With an MPC template, die-area limits are validated live.

Click **Create Workspace**. ECOS Studio creates the directory structure,
generates configuration files, initializes the workspace database, and
registers the workspace in the project `project.json`. The Step Configuration
dialog may open automatically afterwards so you can fine-tune parameters.

### Creating a Workspace From a Step Output

Project Management can fork a new workspace from an existing workspace's step
output (see [Create from output](#projects-and-workspace-list)). In that case
the wizard is prefilled:

- A **Created from** card on the left shows the source project, workspace, and
  step.
- **Flow Setup** starts at the next runnable step; earlier steps are shown as
  reused and cannot be selected, and the start step is pinned to the source
  output step.
- **Design Files** reuses the source: DEF comes from the selected step output;
  Verilog and SDC default to the source workspace configuration.
- **PDK Config** and **Spec Setting** default to the source workspace's
  selection and parameters.

### Updating a Workspace

**File → Update Workspace** re-opens the wizard for the *current* workspace so
you can change flow range, design files, PDK, or parameters. Before updating
you choose how to treat the existing data:

- **Cancel** — abort.
- **Do Not Backup** — replace directly.
- **Backup Original** — keep a full backup in Project Management before the
  update replaces flow state, results, artifacts, logs, and user files.

Update is disabled while a flow is running.

---

## Project Management

Click **Project Management** (home screen, or **Back to Project Management**
from the workspace shortcuts menu `⋯`). The manager is a maximizable overlay
with a project/workspace tree on the left and an analysis panel on the right.

### Projects and Workspace List

**Toolbar:**

- **Search** — matches project and workspace names, paths, top module, PDK,
  workspace IDs, steps, and statuses. Searching automatically expands matches.
- **Import** — pick a directory containing a `project.json` to register an
  existing project (a toast explains if the directory is not a valid project).
- **New project** — create a project (disabled while the app is shutting down).

**Project rows** (sorted by last opened, 20 shown by default with **Show all /
Show fewer**):

- Click the **▸/▾** arrow to expand/collapse the workspace tree.
- **New** — create a workspace under this project (opens the wizard with the
  directory locked to the project).
- **⋯** — **Import workspace** (register an on-disk workspace into the
  project's `project.json`; already-registered workspaces are reported) or
  **Remove project** (removes the project from the list only — files stay on
  disk and can be re-imported).

**Workspace rows** show the workspace ID, its step range
(`startStep -> endStep`), provenance (`from <workspace> / <step>` when derived),
and status: while executing, the current operation and a running/queued/
cancelling badge; otherwise the flow status plus the last verification time.

- **Open** — open the workspace.
- **⋯** — **Create from output** or **Delete workspace** (red).
- **Create from output** opens a popover listing all committed steps and their
  status. Steps that completed with a Verilog output can be clicked; a
  confirmation dialog shows the target path and the input artifacts (source
  output, DEF, Verilog, SDC). **Continue** opens the prefilled wizard (see
  [Creating a Workspace From a Step Output](#creating-a-workspace-from-a-step-output)).

### Creating a Project

The **New project** dialog asks for:

- **Project Name** and **Design Name**.
- **Project Storage Location** — read-only field; click it or **Browse** to
  choose a directory.
- **Managed MPC** — optionally bind an installed MPC template (*No MPC* or a
  template from the dropdown). Templates with multiple designs show an **MPC
  Design** selector and a preview card.

The dialog previews the manifest path (`<location>/project.json`) and validates
the inputs inline (missing directory, unloaded MPC spec, …). **Create** writes
`project.json` and registers the project.

### Importing Projects and Workspaces

- **Import project** (toolbar) — register an existing project directory.
- **Import workspace** (project row `⋯`) — register a workspace directory into
  a project.

### Removing and Deleting

- **Remove project** — unregister from the list; nothing is deleted from disk.
- **Delete workspace** — permanently deletes the workspace (asked to confirm).

### Project Analysis

The right panel analyzes the selected project or workspace. It has two tabs
(**Dashboard** / **Step Analysis**; `←`/`→` and `Home`/`End` switch tabs).

**Dashboard tab:**

- **Project health** — flow progress bar with per-status counts, sign-off
  readiness cards, and a **Set baseline** button that marks the selected
  workspace as the QoR baseline (two-click Confirm/Cancel because it writes
  `project.json`).
- **Recommended workspace** — the best candidate with its QoR score, sign-off
  label, rationale, and PPA metrics; click its ID to select it or **Open in
  Step Analysis** to drill down.
- **QoR record breakdown** — per-dimension scores with expandable diagnostics
  (status, confidence, severity, evidence, suggested intervention, validation
  requirement) and record details (evidence completeness, feasibility gates,
  power).
- **QoR trend chart** — a lollipop chart of QoR scores across workspaces with
  the baseline highlighted; click a point to select that workspace.
- **Workspace comparison** — a sortable table (click any column header to
  toggle ascending/descending) with a search box, an **Attention only** filter,
  and **Reset**. Columns include workspace (with best/baseline badges),
  progress, QoR score, blocking issue counts, sign-off readiness, and per-metric
  columns. **Debug** jumps to Step Analysis.
- **Needs attention** — project-level risks and regressions (severity tags such
  as CRIT/WARN, workspace/step, title, details). Click a row to drill into the
  corresponding step/metric. Shows 6 by default with **Show all / Show fewer**.

**Step Analysis tab** — step-level comparison across workspaces: step
comparison charts, per-workspace summaries, QoR trends, and selectable issue
metrics.

### Recovery and Background Operations

Conditional panels above the analysis view:

- **ProjectComparisonRefreshStatus** — when automatic refresh is unavailable, a
  warning with a manual **Refresh** button.
- **Unfinished Workspace Creation** — lists interrupted workspace creations
  (target directory, issue, stage, timestamp). **Continue Initialization**
  resumes; **Abandon Registration** (red, confirmed) unregisters the attempt
  while leaving files on disk.
- **Project Background Operation** — when the selected workspace has a queued,
  running, or cancelling background operation (step run or full flow), with
  **Cancel**, **Retry Snapshot** (on snapshot failure), and **Open Workspace**
  actions.

---

## Workspace Overview

Open a workspace to land on its **Home** page. The workspace UI is a workbench:
a narrow navigation rail on the far left, a dashboard area, and a right-hand
column with flow status and logs.

### Navigation Sidebar

The 64 px rail lists **Dashboard** plus every flow step (Synthesis, Floorplan,
Pre Floorplan, Macro Placement, Post Floorplan, Place, CTS, Timing Opt, Route,
DRC, LVS, Filler, Post-Route LEC, LEC, STA, GDS, Signoff, Harden). Each entry
shows a status badge: green check (success), skipped, spinning (running),
clock (pending), red (failed), amber (incomplete). The current page is
highlighted; clicking an entry navigates to that step's page.

### Workbench Layout

The main area is a draggable splitter:

- **Left (≈60%)** — the dashboard of the current page.
- **Right (≈40%)** — the **Flow Status Strip** (see below), the **Run**
  button, the **Flow Log** panel, and the **Agent** inspector panel.

### Home Dashboard

The Home page aggregates the whole flow:

- **Stale/drift warning bar** *(conditional)* — appears when flow results are
  stale or layout artifacts changed outside the tool; such artifacts are
  viewable but not valid sign-off evidence.
- **Chip Basic Info** — project, SoC template, baseline workspace, workspace,
  PDK, design, top module, target die area, target frequency, clock. Long
  values are truncated with a hover tooltip.
- **Constraints** — minimum/maximum area, maximum cell count (over-limit values
  highlighted), max fanout. **Port Definition →** opens the port table
  (port/direction/type/width/description).
- **Checklist** — a status pie chart (pass rate in the center) with
  passing/blocked/warning/unavailable counts and a headline (ready, blocked,
  needs attention, …). **Sign-off details →** lists every checklist entry with
  its step, summary, and source path.
- **Quality of Results** — baseline QoR score vs. current QoR score out of 100
  (PASS/FAIL against the threshold), an improved/regressed summary with a pie
  chart, per-step rows (click a row to open that step's QoR analysis), and
  **QoR details →** for the full comparison.
- **LayoutView** — a thumbnail per step layout; the header shows the layout
  count. Click a thumbnail to open that layout in the Chip Viewer. Unavailable
  layouts show the reason (too large, invalid, changed, stale, missing).
- **Key Metrics** — area, instances, timing, and other headline metrics.
- **Flow Insights** — a tile grid (click a tile to open its full-size dialog):
  step resources (runtime and peak memory, with a **Log scale** toggle), DB
  trends (metric×step heat matrix, trend lines, instance composition with a
  Count/Area toggle), congestion (overflow trends and per-step heat maps), DRC
  (bars/pie toggle, per-type list, layer×type matrix with a *Non-zero only*
  filter), and STA (timing analysis plus cross-run convergence).

---

## Running the RTL-to-GDS Flow

### Starting and Re-running

The **▶ Run** button lives in the right-hand column:

- On the **Home** page it runs the full flow.
- On a **step** page it runs just that step (dependencies included).

While running, the button shows a spinner and is disabled. If the flow (or the
current step) already has results, clicking Run asks for confirmation —
*Running it again will replace its current execution results* — because re-run
resets the dependent downstream steps. If the Chip Viewer is saving layout
edits, Run is disabled; re-running a step whose Chip Viewer window is still
open is blocked with a toast asking you to close it first.

### Monitoring Progress

- The **Flow Status Strip** (top of the right column) renders every step as a
  node (icon + name) with status colors: green succeeded, blue pulsing running,
  amber warning, red failed, grey queued/skipped. Click a node to select it and
  show its logs; the running node is selected automatically.
- Step nodes on sidebar and status strip update live; dashboards refresh as
  each step completes.

### Cancelling a Flow

There is no pause. To stop a running flow, open **Background Tasks** in the top
bar, find the flow task, and click **Cancel Flow**. A confirmation explains
that the runtime stops at the next supported cancellation boundary.

### Viewing Logs

The **Flow Log** panel (below the status strip) shows logs segmented by step
and tool:

- **Copy log** — copy everything to the clipboard (icon turns ✓ briefly).
- **Open log** — full-screen/maximizable dialog with the same content.
- **Collapse/expand** — shrink the panel to just its title bar.
- **Auto-follow** — the view follows the running step. Clicking a step node in
  the status strip pins the panel to that step; re-running that step unpins it.
- **Tail-following scroll** — auto-scroll only happens while you are near the
  bottom, so scrolling up to read is never interrupted.
- **Coloring** — lines are colored by level (errors red, warnings amber,
  success green, phase headers, plain).
- **Right-click** — a context menu offers Copy (the built-in editor find
  shortcuts also work).

---

## Step Pages

Each flow step page shows a **Step Dashboard** with cards tailored to the step:

### Overview and Checklist

- **Overview** — basic info (design, paths, run state) and a configuration
  summary. **Details** opens the Step Configuration dialog for this step.
- **Checklist** — the same status pie as Home plus **Checklist details →**.
- When the configuration changed since the last run, an amber banner marks the
  page read-only until you re-run ("configuration changed since the last run").

### Quality of Results

QoR status badge, pie chart, per-metric comparison bars (baseline vs. current
with deltas), and **QoR details →**. Clicking a metric row on Home also lands
here via `?panel=analysis`.

### Layout

- A layout preview thumbnail; click to enlarge.
- **Open Chip Viewer** — opens the native viewer in view mode.
- **Place Macros** — *(macro placement steps only)* opens the viewer in edit
  mode to place macros (see [Macro Placement Editing](#macro-placement-editing)).

### Data Insights

Step-dependent analysis, for example:

- **Synthesis** — metric grid plus Timing Analysis (WNS/TNS/NVP KPIs, per-corner
  tables with a path-group filter and *Negative first* sorting, critical-path
  waterfall, and **Timing details →**).
- **Floorplan / Place / …** — distribution charts with switchable metric tabs,
  highlight values, and an **Open map snapshot** button for heat-map images.
- **DRC** — violation statistics, snapshot tiles, and a congestion dialog.
- **LVS** — entity comparison (netlist vs. DEF, diff column), connectivity,
  unmatched devices, STA corners, **Corner details →**.
- **RCX** — electrical summary (cap/res per corner) and sign-off metric tables.
- **STA** — corner summary with **Corner details →** and timing analysis.
- **LEC** — equivalence result with failure/staleness notices.
- **Harden** — output artifact tables (LEF/lib/GDS).

### Data Reports

Lists the report files the step produced. Each row's **↗** button opens the
report in a viewer dialog (text reports, tables, HTML).

---

## Configuring the Flow

Two entry points:

- **Edit → Config** (menu) — the Step Configuration dialog.
- **Details** on a step's Overview card — the same dialog focused on that step.

The dialog has a **Flow steps** list on the left (every step that has tunable
parameters, with its parameter count) and a parameter editor on the right:

- Parameters render as text fields, number fields, checkboxes, arrays (add /
  remove rows), object tables, or nested sub-cards, mirroring the underlying
  JSON (maximum nesting depth 6).
- **Baseline** toggle — adds a read-only baseline column from the baseline
  workspace, with a "N differ" badge and per-parameter highlighting.
- **Reload** — re-fetch current file and baseline. **Reset** — roll the draft
  back to what is on disk. **Save** — persist (blocked while the flow is
  running). An `*` marks unsaved changes; switching steps with unsaved changes
  asks for confirmation.
- Saving uses optimistic concurrency (an expected workspace revision), so a
  conflicting edit from elsewhere is detected instead of silently overwritten.
- If a config file is not valid JSON, the editor falls back to a raw text area
  until the content parses again.

---

## Chip Viewer

The Chip Viewer is a native (GPU-accelerated) window for viewing and editing
layouts — large layout data stays out of the Electron renderer.

### Opening the Chip Viewer

- **Open Chip Viewer** on a step's Layout card (view mode).
- **Place Macros** on macro-placement steps (edit mode).
- Clicking a layout thumbnail on the Home dashboard (view mode).

The viewer opens the saved geometry snapshot for that step.

### Canvas Navigation

- **Mouse wheel / trackpad pinch** — zoom at the cursor.
- **`+` / `-`** — zoom around the viewport center.
- **Left-drag** — pan. **Arrow keys** — pan by 10%.
- **`F` / `Home`** — fit the whole layout.
- **`Q`** — toggle 2D / 3D. In 3D: `1`/`T` top, `2`/`I` isometric, `3` front,
  `G` grid, wheel dollies the camera. 3D presets (Iso / Top / Front), shading,
  lighting, and theme (Engineering / EDA Classic / Diorama / Cyber, …) are in
  the sidebar. Without a GPU, 3D falls back to CPU rendering.
- **Click** — select a shape; its properties appear in the sidebar.
- **`Z`** — zoom to the selection, map bbox, DRC violation, or highlight set.
- **`Esc`** — clear progressively (help → ruler → selection/highlight).
- **`K` / `R`** — ruler tool. Coordinates display in DBU or microns
  (toggle in the sidebar).

### Sidebar Panels

- **VIEW** — Save / Discard (edit mode), diagnostics and selection panels,
  2D/3D toggle, **Fit layout to view**, **Reload geometry snapshot**, ruler,
  unit toggle, and `?` shortcut help.
- **PHYSICAL LAYERS** — per-layer visibility checkboxes.
- **DRAWING DATA** — a tri-state tree of object categories (instances: macro /
  standard cell / filler; nets: signal / clock / other) to show or hide.
- **QUERY / SELECTION / DIAGNOSTICS** — search (`Ctrl+F` or `/`), selected
  object properties, and diagnostics. Search hits are highlighted with a
  two-color outline.

### Analysis Tabs

When data exists, tabs appear at the top:

- **DRC** — violation list; jump between violations.
- **ANTENNA** — antenna violations.
- **MAP** — heat-map data with transparency slider, `H` to hide, `N` /
  `Shift+N` to jump to the next / previous hotspot, `Space` to cycle.

### Macro Placement Editing

In edit mode (opened via **Place Macros**):

- The toolbar shows *N unplaced · M selected*.
- Align (top / left / right / bottom, needs ≥ 2 placed selected), **Center on
  DIE**, horizontal / vertical distribute (≥ 3), rotate 90°, and mirror
  horizontally / vertically (respecting master symmetry).
- Every macro must be placed before saving to postFloorplan; the queue state is
  shown below the toolbar.
- **Save** writes the placement; **Discard** reverts. Closing the window with
  unsaved changes asks *Keep editing / Discard / Save*.

### Keyboard Shortcuts

Press **`?` or `F1`** inside the viewer for the full shortcut overlay.

---

## ECOS Agent

The built-in Agent assists with workspace tasks. It proposes bounded actions;
ECOS Studio keeps validation, confirmation, and execution in your hands.

### Chat Panel

The Agent panel sits in the right column of workspace pages (collapse it to a
bottom bar showing the Agent status) and as a drawer on home screens.

- Type a message and press **Enter** to send (**Shift+Enter** for a new line).
- **Stop** (■) interrupts a running agent.
- While the agent is working you can queue another message; a queue bar with
  **× Cancel queued message** appears.
- The empty state offers suggestion buttons (e.g. *Update workspace
  parameters*, *Rerun a completed stage*, *Continue unfinished flow*), each of
  which sends that prompt.
- Replies render Markdown. Specialized message cards:
  - **Choices** — button/list options; clicking one answers the agent's
    question.
  - **Maps** — heat-map cards with statistics and a **↙** full-screen view.
  - **Reports / info** — JSON tables, CSV tables, or embedded HTML/text with a
    **↙** full-screen view.
  - **Tool progress** — a flow timeline per step; click a step header to expand
    its detail lines.

### Proposals and Confirmation

When the agent wants to act on the workspace (set up or create a workspace,
rerun a step, continue an unfinished flow, update parameters), a contract panel
shows the full key/value details and asks you to **Confirm** or **Cancel**.
Confirmed actions execute immediately (parameter updates, flow runs); committed
panels collapse into receipts that you can expand (**Details / Hide details**).

### Agent Sessions

The tab strip above the chat supports multiple concurrent conversations:
switch tabs, close a tab (`×`), or start a **+ New Agent chat**. The panel menu
also offers **Clear reports and layouts** (reset this session's GUI artifacts)
and **Full screen**.

### Agent Setup

If the agent runtime (Codex) is not ready, a setup card occupies the panel:
status (not installed / installing / login required / ready / error), version
and paths, an install progress bar, and buttons: **Install**, **Open login**,
**I have completed login / re-detect**, **Choose local codex**, and
**Continue with Agent**.

---

## Frontend Design (Experimental)

The frontend environment verifies RTL designs: source review, elaboration,
lint, and simulation with waveforms and difftest. It is **experimental** — a
yellow banner on every frontend screen warns that behavior may change between
releases.

### Frontend Landing Page

Reaches via the **Frontend Design** card. Mirrors the backend landing page:

- **Back to ECOS**, **Open Workspace**, **New Workspace** (opens the frontend
  wizard), and a **Recent Workspaces** list filtered to frontend projects —
  same badges, *View All / Collapse*, remove-from-list, and
  unrecognized-state behavior as the backend page.

### Frontend Workspace Wizard

Three steps (the left step strip allows going back):

1. **Project Basics** — project name (letters/digits/underscore only), an
   optional description, and the save location (click or **Browse**).
2. **Verification Setup** —
   - **CPU** — pick a CPU core (card selector); choosing a custom filelist
     reveals a **CPU Top Module** field.
   - **CPU Design Files** — either **Use filelist** (single file) or **Select
     RTL files** (multi-select with add/remove/clear and a **Confirm
     selection** step). Accepts `.v` / `.sv` / headers.
   - **SoC Harness** (card selector, required), **Toolchain** and **Test
     Suite** row selectors, each with a status pill.
   - **CPU Top IO Contract** — the required top module name, IO counts, reset
     PC, program link base, boot payload base, and a full interface example.
   - A **Validation** panel lists errors and warnings live.
3. **Review & Create** — two review blocks (with **Edit** jump-back links) and
   **Create Workspace**.

### Frontend Workspace Layout

- **Left icon rail** — Home, Prepare, Src, Review, Elab, Lint, Sim, Wave (Src
  and Wave are fullscreen views; the others are flow steps). Status badges as in
  the backend rail.
- **Flow panel** (240 px) — Done / Run / Fail / Wait counters, a total progress
  bar, the step list with per-step peak memory and runtime, and (on Home) the
  run-mode dropdown (**Run Frontend Flow** / **ReRun Frontend Flow**) plus the
  **▶ Run** button.
- **Step header** — status, runtime, tool, case counts (sim), **Log** button,
  **Run / Cancel** (not on sim; running shows a timer), and **Refresh**.
- **Bottom console** — a draggable height panel with **Problems** (issues in
  the current log; click to open) and **Log** (log-file selector + viewer)
  tabs.
- **Home view** — summary tiles (workspace name, step count, completed x/y,
  next step), the read-only **Frontend Configuration** card, a **Workspace
  Home** status card, and a **Workspace Guide**.

### Prepare

Overview tiles, a configuration card with prepare-readiness, an inputs card
(CPU RTL vs. total RTL, includes, defines, ownership bars, per-source file
lists), contracts status, and the runtime plan.

### RTL Review

A left rail switches review modes:

- **Source Scan** — RTL rule violations (severity-colored, waived markers);
  click an issue to jump to source.
- **Yosys Precheck** — diagnostics on the left, fanout/fanin/depth hotspot
  cards on the right (click to open).
- **Modules** — Yosys module risk-ranking cards (risk level plus
  cells/mux/arith/mem/fanout/fanin/depth/score).

The Summary tab shows the review delta (new / existing / resolved / waived),
precheck metrics, top problems, and the next-step shortcut.

### Elaboration (Elab)

- **Authoritative** — Slang elaboration diagnostics (click to jump to source),
  unresolved modules, and heuristic candidates.
- **Module Inventory** — module cards (path:line, instance count, ports,
  params, refs, TOP marker); click to open a module.
- Summary tab: readiness, hierarchy inventory, compiler result, largest
  modules.

### Lint

- Scope switch: **CPU n** (actionable) / **All n** (every Verilator
  diagnostic).
- Diagnostics list (click to jump to source), **Rule Breakdown** (rules with
  E/W counts and examples), and **File Hotspots** (files with the most
  diagnostics).

### Simulation (Sim)

- **Suite** dropdown; choosing `cpu_tests` reveals a **Mode** dropdown
  (Selected / All) and a **Cases** multi-select (run Prepare first to load CPU
  tests).
- **Run {Suite} / Cancel** button with a run timer.
- **CoreMark panel** (for the CoreMark suite) — preset (Balanced / Speed /
  Size / Debug / Custom), optimization level, ISA, ABI, iterations, data size,
  extra CFLAGS, and a float-reporting checkbox, plus a build summary.
- A run-context card shows the current selection, displayed result, and result
  freshness.

### Cases and Waveforms

The **Cases** tab lists regression results:

- **Run Regression** — baseline run, comparison tiles, and per-case cycle
  changes (faster/slower colored).
- **Run History** — the last five runs with pass/fail counts.
- **Cases table** — case name, PASS/FAIL badge, cycles, outcome, **Difftest**
  status (click to jump the disassembly to the mismatch PC), **Code** (expand
  an inline disassembly pane: address jump, reload, close), RC, **Image**, and
  a **Wave** button per case.

### Source Editor

The **Src** view is a fullscreen source workspace:

- Left — file list with per-file diagnostic badges (red errors, amber
  warnings).
- Right — a Monaco editor toolbar with status (Saved / Unsaved / Saving /
  Loading), **Reload**, **Save** (only with unsaved changes; files over 4 MB
  are truncated and cannot be saved), and **Lint** (runs Verilator on the
  current file; results list with click-to-jump, plus the raw lint log).
- Right-click inside the editor for the standard editing menu.

### Waveform Viewer

The **Wave** view lists waveform files per case on the left and embeds the
**Surfer** waveform viewer on the right (loading and error overlays included).
**Open** launches the waveform in an external Surfer application.

---

## Tech Library

Route: sidebar **Tech** (inside a workspace). It inspects the technology data
of the current workspace's view package — it is not the PDK installer (that is
the Resource Manager).

- Header shows the package root and a **Reload** button.
- Left navigation — Overview / Layers / Sites / Via Masters / Cell Masters with
  count badges, plus a summary bar (PDK, design, counts).
- Each section is a searchable table (e.g. layers: ID/name/type/direction) with
  an inspector on the right; vias and cells additionally render a geometric
  **Preview** canvas.
- Without a workspace or view package, the page shows guidance on what to open.

---

## Global UI

### Notifications

The bell icon in the top bar carries an unread badge (99+ past 99). The panel
lists notifications colored by severity (error / warning / info) with
timestamps; each can be expanded (**View details**, including log file paths),
marked read, or dismissed. **Mark all as read** and **Clear all** act on the
whole list. `Esc` closes the panel.

### Background Tasks

The progress icon shows a badge with the running task count (or `!` on
failure). The panel lists:

- Running flows — workspace name, current step, status (Queued / Running /
  Cancelling), elapsed time; click a row to **Inspect**, and **Cancel Flow**
  where permitted.
- In-progress workspace creations, including a *Creation needs recovery* hint.
- Final snapshot saves, with a **Retry** button on failure.

### Terminal Panel

Toggle from the status bar (bottom-left). Features:

- Drag the top edge to resize; **New Terminal** (`+`) for more sessions;
  **Terminal Profiles** (default shell); **More Actions** (maximize/restore,
  close panel).
- A right-hand session list switches between terminals and can be resized by
  dragging its separator.
- Follows the application theme.

### Theme, Zoom, and About

- **Theme toggle** (sun/moon) in the top bar switches light/dark; the choice
  persists and editor colors follow.
- **View menu** zoom (80–140%, persisted).
- **Help → About** shows component versions with **Copy version info**.

### Exporting Results

- **File → Export Signoff Package** — a review dialog lets you inspect the
  sign-off package before exporting (disabled while a flow runs).
- **File → Export Design Summary** — export a design summary.

---

## Troubleshooting

**A flow step failed**

1. Open the step page and check the Flow Log panel (errors are red).
2. Click the step node in the Flow Status Strip to pin its log.
3. Verify inputs (design files, PDK, constraints) on the step's Overview card.
4. Fix configuration via **Edit → Config**, then re-run the step.

**The Run button is disabled**

- A flow is already running, or
- the Chip Viewer is saving layout edits (tooltip explains), or
- the app is finalizing a background operation.

**"Stale" badges and warning bars**

- Results were produced by an older configuration or files changed on disk.
  Re-run the affected step; treat stale artifacts as non-sign-off evidence.

**Layout thumbnail cannot be opened**

- The tooltip on Home's LayoutView names the reason: too large, invalid,
  changed externally, stale, or missing.

**Performance**

- Close unused Chip Viewer windows and unused layouts.
- Reduce visible layers in the Chip Viewer sidebar.
- Check RAM/CPU; 8 cores and 32 GB RAM are recommended.

**Getting help**

- **Help → Documentation** opens this guide.
- Report bugs or request features: [GitHub Issues](https://github.com/openecos-projects/ecos-studio/issues).
- Ask questions: [GitHub Discussions](https://github.com/openecos-projects/ecos-studio/discussions).
- **Help → About → Copy version info** pastes versions into your report.

---

## Next Steps

- **Try the bundled example** — create a workspace from the GCD example RTL
  and run the full RTL-to-GDS flow.
- **Explore the frontend environment** — run Prepare → Review → Elab → Lint →
  Sim on a CPU design and inspect waves.
- **Automate** — install the `ecos-ecc` CLI from Resource Manager and script
  flows on the command line.
- **Join the community** — participate in [GitHub Discussions](https://github.com/openecos-projects/ecos-studio/discussions).
