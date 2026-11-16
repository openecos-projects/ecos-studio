# Selecting and configuring PDKs

PDK repositories may provide a versioned `ecc-pdk.json` describing process facts.
ECC separately owns tool adaptations and manages both documents locally. ICS55
v1/v2 and other processes use the same formats. See
[the ECC package authoring guide](../ecc/docs/multi-pdk.md) for the schema, CLI,
resource roles, tool settings and backend limits.

Import a local PDK from Studio's PDK manager. If its description is missing, the
configuration dialog invokes ECC to create it in ECC management, outside the PDK
root. Read-only PDKs are supported. If a vendor description is present, import
copies it into ECC management; legacy combined files are split without rewriting
the source. Discover resources, select their
roles, edit the cells/views/tool settings, then validate. An ICS55 directory
without a description follows exactly the same authoring path. The editor calls
ECC's compare-and-swap commands and displays each section's ownership and source
path. Tool settings are saved in the ECC adaptation, never back into the PDK.
Studio does not maintain a second PDK parser. CLI `configure export-description`
prints the tool-independent document a PDK maintainer can publish; the separate
`export-adaptation` output belongs to ECC configuration management.

Use **Studio Default** to choose a default for new Studio projects. ECC's CLI
default is independent. An explicit project selection overrides a client default.
A project fixes its package contents and adaptation for all workspaces. Editing
an ECC adaptation affects newly created projects; existing projects keep their
locked snapshot. To use different
technology or changed resources, create a separate package directory and project;
`ecc pdk clone-with-pdk` can copy RTL and constraints without copying results.
The old workspace-level LEF/Liberty override mechanism cannot bypass this lock.

Readiness means the requested files are present and valid; it does not certify a
foundry process or a backend. Partial packages may support synthesis only.
Capabilities blocked by missing physical resources remain unavailable. Current
real-flow qualification covers ICS55 v2; Sizer has an explicit maximum of three
VT groups and extraction still needs a supported, explicitly selected backend.
Authentic EM data is required for EMIR signoff. Test-only synthetic models are
never injected into ordinary projects.

## Isolated development and tests

Use `ECOS_ECC_BIN_DIR=/absolute/path/to/ecc-bin` to select the source/test runtime
for Studio, and `ECC_PDK_INVENTORY=/absolute/path/to/test-inventory.json` to isolate
its library from the user's installed tools. Pass `--pdk-root` to ECC project
creation and select tool paths through the documented `CHIPCOMPILER_*` variables.
Building a package does not require installing it.

Desktop integration tests accept `ECOS_E2E_ECC_BIN_DIR`, `ECOS_E2E_PDK_ROOT` and
`ECOS_E2E_OUT`. They create a separate PDK fixture with explicit synthetic EM data
when the source package lacks an EM model. They never change the input package.
The native test, real backend flow and signoff qualifications are separate checks;
a successful flow using synthetic data is not foundry signoff.
