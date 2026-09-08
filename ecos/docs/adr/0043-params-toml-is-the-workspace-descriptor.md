---
status: accepted
---

# Keep params.toml as the Workspace Descriptor

To minimize changes to the upstream ECC CLI, the canonical Workspace Descriptor keeps the upstream path `<workspace>/home/params.toml`. The file must satisfy the complete current Descriptor contract; opening a Workspace never infers missing fields, fills defaults, rewrites the configuration or creates a second `workspace.toml`. Data outside the contract requires an explicit migration or recreation decision. This preserves one authoritative Workspace configuration while retaining the upstream CLI's existing file name and Project-level `ecc.toml` behavior.

Compatibility with upstream means preserving CLI commands, public dotted parameter names, validation behavior and the `home/params.toml` path; it does not preserve the former internal contents of that Workspace file. The Descriptor replaces persisted backend keys, nested `config_overrides` and absolute PDK roots with canonical catalog parameters and portable provenance. ECC derives backend parameters and tool configuration patches in memory when materializing a Workspace.

The Descriptor's `[params]` tables store every user-configurable value with a backend semantic target or tool configuration target, using the Parameter Catalog's upstream dotted names. For example, `cts.max_fanout` is stored as `max_fanout` under `[params.cts]`. Workspace Parameters and Step Options share these tables; Step Option remains an invalidation concept rather than a separate Descriptor section. Backend parameter keys and tool configuration paths are derived ECC implementation details and are never alternate Descriptor keys.

Workspace creation resolves Project Configuration, command overrides and catalog defaults, then persists the complete set of catalog parameters applicable to the selected Flow, including values equal to their defaults. Project `ecc.toml` remains a sparse authoring template. Opening an existing Workspace validates that its Descriptor contains the complete applicable set and never fills a missing value from the installed ECC version, so changing catalog defaults cannot silently change an existing Workspace's runnable configuration.

The Descriptor also persists the Flow identity and its resolved ordered canonical Step list. A preset selects that list when a Workspace is created or replaced; opening or executing an existing Workspace never resolves the preset again against the installed ECC version. The Flow ledger records execution state for the committed list and is not a configuration source. CLI `--preset` therefore applies only to a fresh run, a new run ID or an explicit overwrite, and is rejected for an existing Workspace. New preset Steps such as the upstream synthesis `lec` affect only newly created or replaced Workspaces.

Catalog entries with a `pdk_target` remain Project Configuration resource overrides and are not stored under Workspace `[params]`. The Descriptor's `[pdk]` section records portable requirements and provenance, while the Workspace Binding supplies machine-resolved paths.

This decision supersedes the `workspace.toml` filename, separate `step_options` storage and automatic legacy-Descriptor migration portions of ADR 0032 and the related proposed integration specifications. Revision checks, Step Option invalidation semantics, Workspace Binding and Engineering Snapshot semantics remain unchanged.

This is an intentional breaking Workspace-format transition. A Workspace created with the upstream CLI branch's former `params.toml` contents, including one created after that branch reaches main but before this contract reaches main, is incompatible and must be recreated. ECC does not add a fallback reader, infer missing catalog values or migrate that file. The two merges should be released close together and the recreation requirement must be stated in release and PR notes.
