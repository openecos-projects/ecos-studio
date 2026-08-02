# MPC Design Selection and Core Template Snapshot

## Goal

Allow the New Project wizard to read the installed MPC resource's
`spec/spec.json.in`, let a user select one entry from `designs`, show the
selected `core_template` as structured information, and persist an immutable
copy in `project.json`. The saved template will be consumed by a later
workspace-creation feature; that feature is outside this change.

MPC is optional. A generic project has `mpc: null` and stores no design or
core-template data.

## Scope

Included:

- Reading `spec/spec.json.in` from an installed, managed MPC resource.
- Switching among every valid entry in `designs`.
- Modular preview of the selected design's `core_template`.
- Saving the selected design identity and complete `core_template` JSON value
  in the project manifest at creation time.
- Validation and tests across the Electron, shared-manifest, and renderer
  layers.

Excluded:

- Copying the template into workspace `parameters`.
- Applying template values to physical-design tools.
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
