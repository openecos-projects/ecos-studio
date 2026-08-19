# ECC Config Filename Migration

## Goal

Use stable, lower-case ECC configuration filenames and migrate an existing
workspace from its legacy names when it is loaded. New workspaces must contain
only the new names.

## Canonical Names

| Workspace config key | Legacy filename | Canonical filename |
| --- | --- | --- |
| `flow` | `flow_config.json` | `flow_ecc.json` |
| `db` | `db_default_config.json` | `db_ecc.json` |
| `Floorplan` | `fp_default_config.json` | `floorplan_ecc.json` |
| `fixFanout` | `no_default_config_fixfanout.json` | `fixfanout_ecc.json` |
| `CTS` | `cts_default_config.json` | `cts_ecc.json` |
| `route` | `rt_default_config.json` | `route_ecc.json` |
| `drc` | `drc_default_config.json` | `drc_ecc.json` |
| `filler` | `pl_default_config.json` | `filler_ecc.json` |
| `RCX` | `rcx.json` | `rcx_ecc.json` |
| `sta` | `sta.json` | `sta_ecc.json` |
| `dreamplace` | `dreamplace.json` | `dreamplace_ecc.json` |

`place` and `legalization` both use the one `dreamplace_ecc.json` file.

## Implementation

The workspace data module owns both the canonical-name map and the legacy-name
map. Its canonical path builder remains the single source of truth for all ECC
tools, CLI commands, runtime APIs, and GUI resource resolution.

`init_workspace_config()` will copy canonical template files from the ECC and
DreamPlace config directories. The flow template will reference canonical ECC
configuration filenames.

`load_workspace()` will invoke a migration helper before building
`workspace.config`. The helper will rename each legacy config file in
`<workspace>/config` to its canonical filename, then rewrite the migrated flow
configuration's `ConfigPath` entries to those canonical names. The normal load
path then builds `workspace.config` from canonical filenames and continues
unchanged. A workspace already using canonical filenames is a no-op.

When both a legacy and a canonical file are present, the canonical file remains
authoritative and is never overwritten. The normal workspace load continues
with canonical paths.

## Affected Consumers

- ECC and DreamPlace templates and the ECC packaging manifest.
- Workspace construction, refresh, config editing, CLI inspection, and runtime
  APIs, through the centralized workspace configuration map.
- GUI static workspace reads and the desktop-agent parameter-write allowlist.
- Tests and fixtures that assert workspace config paths or seed config files.

## Verification

- Assert newly created workspaces contain the canonical filenames and the flow
  config points to canonical paths.
- Seed an old workspace with legacy filenames, load it, then assert files have
  been renamed, `workspace.config` resolves canonical paths, and migrated flow
  references are canonical.
- Assert both DreamPlace flow steps resolve to `dreamplace_ecc.json`.
- Update and run targeted workspace, runtime, CLI, packaging, ECC/DreamPlace,
  and GUI tests that reference these paths.
