# MPC Design Selection and Core Template Snapshot

## Goal

Allow the New Project wizard to read the installed MPC resource's
`spec/spec.json.in`, let a user select one entry from `designs`, show the
selected `core_template` as structured information, and persist an immutable
copy in `project.json`. A new workspace created beneath that project uses
the snapshot to validate explicit Die area and saves the same MPC data into
its `home/parameters.json`.

MPC is optional. A generic project has `mpc: null` and stores no design or
core-template data.

## Scope

Included:

- Reading `spec/spec.json.in` from an installed, managed MPC resource.
- Switching among every valid entry in `designs`.
- Modular preview of the selected design's `core_template`.
- Saving the selected design identity and complete `core_template` JSON value
  in the project manifest at creation time.
- Applying an MPC project's Die-area bounds in the New Workspace wizard when
  the user enters explicit width and height.
- Persisting the full MPC snapshot in the newly created workspace's
  `home/parameters.json`.
- Validation and tests across the Electron, shared-manifest, and renderer
  layers.

Excluded:

- Applying template values to physical-design tools.
- Running the deferred MPC area validation for Utilitization / Margin mode;
  the flow implementation will report that error later.
- Editing or synthesizing MPC specifications.
- Compatibility handling for project manifests created before this MPC feature.

## Alternatives Considered

### Recommended: Resource-scoped local IPC

Add `resources.readMpcSpec(resourceId)` to the existing resource API. Electron
resolves the installed MPC from its resource manifest, verifies that it is a
healthy managed `mpc:` resource, then reads only
`<installed-path>/spec/spec.json.in`.

This uses the exact resource version chosen in Resource Download Manager and
does not grant renderer code arbitrary filesystem access.

### Remote GitHub content API

Rejected. The remote content service fetches configured GitHub sources, which
can be unavailable or ahead of the downloaded MPC version. It would make the
preview and project snapshot inconsistent with the resource actually used.

### General local-file read API

Rejected. Passing `spec_path` from the renderer to an unrestricted file reader
would expose an unnecessarily broad filesystem capability and would permit a
stale or forged path.

## Architecture and Data Flow

1. The wizard loads installed MPC resources using the existing resource list.
2. When a resource is selected, the renderer invokes
   `resources.readMpcSpec(resourceId)`.
3. `ResourceManagerService` resolves the resource itself, validates its type,
   installation state, managed root, and canonical path, and reads only
   `spec/spec.json.in`. It parses JSON and returns the resource metadata,
   canonical spec path, and parsed JSON value.
4. A renderer-side MPC-spec parser validates that `designs` is an array. A
   usable design has a record-valued `core_template`; its label uses
   `design_name`, falling back to a stable ordinal label if absent.
5. The wizard selects the first usable design by default. Selecting another
   design changes the preview and the pending project snapshot together.
6. Project creation submits the selected resource association, design identity,
   and exact parsed `core_template`. The shared manifest layer validates and
   serializes the data into `project.json`.
7. When a new or branch workspace is opened from Project Management, the
   existing New Workspace wizard reads that project's manifest and retains the
   MPC snapshot as workspace-creation context. It never rereads the installed
   MPC resource.
8. In Spec Setting, explicit Die width and height are multiplied and compared
   with the selected template's area limits. On successful creation, the
   complete manifest `mpc` record is added to the parameters sent to ECC, which
   writes it to `home/parameters.json`.

The renderer receives a resource identifier, never a caller-controlled source
path. The desktop service alone constructs the path under the managed MPC
directory.

## Manifest Contract

For a project created with an MPC, `mpc` is required and has this shape:

```json
{
  "resource_id": "mpc:mpc-frame",
  "display_name": "MPC Frame",
  "installed_version": "0.1.0",
  "path": "/managed/mpcs/mpc-frame/0.1.0",
  "spec_path": "/managed/mpcs/mpc-frame/0.1.0/spec/spec.json.in",
  "design": {
    "index": 0,
    "design_name": "example-design",
    "directory": "example-design"
  },
  "core_template": {
    "name": "@MODULE@"
  }
}
```

`design.index` and `design.design_name` are required. `directory` is included
only when supplied by the selected spec entry. `core_template` is a non-array
JSON record and is copied without selecting, renaming, or normalizing its
fields. This preserves both current constraints and future fields.

For a project without MPC, the manifest remains `"mpc": null`; no `design` or
`core_template` keys are written anywhere else in the manifest.

Since MPC association is new functionality, old non-null `mpc` manifest data
without `design` and `core_template` is invalid rather than being upgraded or
silently accepted.

## Workspace Die Constraints and Parameters

The current New Workspace wizard already loads `project.json` to apply project
defaults. It will additionally derive a read-only MPC constraint context from
`manifest.mpc`. The context is present only for a project with a valid
non-null MPC snapshot and is cleared whenever the selected project changes.

### Width / Height mode

For `Width / Height`, the wizard computes:

```
die_area = die_width * die_height
```

Each finite positive constraint in `core_template.minimum_area` and
`core_template.maximum_area` is applied independently. The UI displays the
current area and every applicable bound immediately below the Die inputs. A
value below the minimum or above the maximum produces an inline error that
states the current value and permitted range. The wizard cannot advance from
Spec Setting or create the workspace until the user supplies an in-range area.

If both constraints exist but the minimum is greater than the maximum, the
template is invalid for explicit Die sizing. The wizard reports this as an MPC
configuration error and blocks creation in this mode. Missing or non-numeric
area fields simply do not impose that bound.

### Utilitization / Margin mode

This mode remains available. Its final Die area depends on layout information
that does not exist at workspace-creation time, so it receives no pre-create
area comparison and does not block creation. The Spec Setting panel states
that MPC area limits will be checked during the later flow run.

### Workspace Parameters Contract

Before invoking `workspace.create`, the renderer extends the existing backend
parameters with the project manifest's exact MPC snapshot:

```json
{
  "MPC": {
    "resource_id": "mpc:mpc-frame",
    "display_name": "MPC Frame",
    "installed_version": "0.1.0",
    "path": "/managed/mpcs/mpc-frame/0.1.0",
    "spec_path": "/managed/mpcs/mpc-frame/0.1.0/spec/spec.json.in",
    "design": {
      "index": 0,
      "design_name": "example-design",
      "directory": "example-design"
    },
    "core_template": {}
  }
}
```

ECC already writes the `parameters` supplied to `workspace.create` into
`home/parameters.json`; passing the snapshot in this request avoids a second,
post-create file write and ensures only successful workspace creation produces
the workspace copy. Future Home functionality reads `parameters.MPC` directly,
without following a project path or downloading an MPC resource.

Projects without MPC do not include an `MPC` key in workspace parameters.
Existing-workspace reconfiguration is also outside this behavior: this applies
when creating a new or branch workspace beneath a project.

If a project manifest declares a non-null MPC but cannot be parsed as the
required snapshot contract, the New Workspace wizard reports a blocking MPC
configuration error rather than treating the project as unconstrained.

## Wizard Behavior

The existing MPC selector keeps its explicit no-selection option. Choosing it
clears pending spec data and hides the design selector and all preview modules.

After a valid MPC is selected:

- The wizard shows a loading state while its spec is read.
- A design selector is shown when more than one usable design exists.
- The selected `core_template` is displayed in small, labeled modules: template
  identity, design limits, parameters, ports, frame I/O, template behavior,
  and other fields not covered by those modules.
- Parameters and ports render as rows with their actual object keys and values,
  so later additions to the spec remain visible without UI schema changes.
- Unknown primitive, list, or record properties remain visible under Other
  constraints instead of being discarded.

Changing the MPC clears the prior design and template before the next spec
loads, preventing a snapshot from one resource being saved with another.

If a selected MPC cannot be read, contains invalid JSON, lacks `designs`, or
has no design with a record-valued `core_template`, the wizard displays an
actionable error and does not allow creation with that MPC. The user may clear
the MPC choice and create a generic project normally.

## Validation and Tests

- Resource manager tests prove that the reader accepts only healthy managed MPC
  resources, resolves the fixed spec location, and rejects missing or malformed
  specs.
- IPC/preload/shared contract tests cover the new `readMpcSpec` API.
- Shared manifest tests require a design and object-valued `core_template` for
  any non-null MPC create mutation; they also prove generic projects store no
  template data.
- Renderer parser tests cover multiple designs, selection labels, and fields
  outside the currently known template groups.
- New Project view tests cover loading, design switching, state reset on MPC
  change, invalid-spec errors, and the exact snapshot submitted to project
  creation.
- New Workspace wizard tests cover in-range, below-minimum, above-maximum, and
  invalid-range Width / Height inputs, plus the non-blocking Utilitization /
  Margin branch and generic projects.
- Workspace creation tests prove the full `MPC` record is included in ECC
  parameters for an MPC project and omitted otherwise.

## Acceptance Criteria

1. An installed `mpc-frame` resource with `spec/spec.json.in` exposes every
   usable `designs` entry in New Project.
2. Switching designs updates the modular preview and the saved template
   snapshot.
3. A project created with a selected MPC contains the selected design identity,
   canonical spec path, and complete `core_template` in `project.json`.
4. A project created without MPC has `mpc: null` and no saved core-template
   data.
5. A corrupt, missing, or structurally invalid MPC spec cannot create a project
   with that MPC, while generic project creation remains available.
6. A new or branch workspace from an MPC project cannot proceed with explicit
   Die width and height outside its template's area bounds.
7. The Utilitization / Margin option remains usable and defers MPC area
   validation to a later flow execution.
8. A successfully created MPC workspace stores the full selected MPC snapshot
   at `home/parameters.json` under the `MPC` key; a generic workspace omits it.
