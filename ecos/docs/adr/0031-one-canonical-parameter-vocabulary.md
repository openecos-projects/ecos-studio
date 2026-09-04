---
status: accepted
---

# ECC and ECOS Studio share one canonical parameter vocabulary

ECC CLI and ECOS Studio use the same flat snake_case parameter identifiers in Project Configuration, Workspace Specs, Workspace Descriptors, in-memory Parameters and Engineering Snapshots. Friendly labels remain presentation concerns, while legacy long-form and dotted keys are normalized only when old input is read and are never written back. This prevents creator-dependent Projects, duplicate values and precedence rules from becoming part of the integration contract.

Project defaults and invocation input use `<project>/ecc.toml`; the resolved runnable configuration of an existing Workspace is part of `<workspace>/home/workspace.toml`. The two files share the canonical vocabulary but have different scopes and authority.

Project Configuration is an optional, human-editable CLI template. CLI arguments may override it to construct an explicit Workspace Spec, while Studio may construct the same command without creating `ecc.toml`. Opening or running an existing Workspace depends on its Workspace Descriptor and never silently reapplies changed Project Configuration; those changes take effect only through an explicit create or update command.
