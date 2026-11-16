# Flow checker layout artifacts

Flow cards discover layout capability from the current workspace's published
`layout_geometry` artifacts. A fixed list of step names and a 16-preview limit
must not hide valid snapshots. A PNG is optional: a saved geometry snapshot
without a preview displays an **Open layout** icon. Missing/stale geometry does
not become a usable native view. Step identities, rather than card positions,
associate previews and native snapshots.

Each native view opens its own `<step>_<tool>/output/geometry/geometry.manifest`.
ECC's ordinary save-data path now exports snapshots for antennaCheck,
powerAnalysis, EMIR and Harden as well as LVS, DRC, RCX and STA. Harden saves
its DEF and preview after exporting the signoff deliverables. These are ordinary
view artifacts and are generated independently of Replay. Algorithm process
capture and the extra Power spatial reports remain gated by the Replay flag.

Post-route LEC is a netlist proof. Its view represents the physical input being
checked, not a new layout transformation. All three LEC builders retain the
resolved input DEF. After a successful proof, the shared runner exports that
input through the existing ECC native geometry exporter into the selected
LEC step's own output directory, including an independent DEF and preview.
It does not expose these outputs as a new physical-chain producer or change
FlowInputResolver. A netlist-only entry has no physical view. Failure to export
this optional visualization is reported without changing the proof verdict.
An existing engine is reused without taking ownership or closing it; a newly
created export engine is closed after use.

The Electron resource resolver recognizes postRouteLec outputs for the selected
tool. It opens those files directly, with the existing manifest/path validation.
It does not redirect checker cards to Filler, Harden, another workspace, or
Replay's frozen geometry.

For old workspaces, adding a GUI button alone cannot create missing artifacts.
A repair can load the step's saved DEF (or its flow-resolved physical input for
LEC/Harden), invoke the same native exporter into that step's output directory,
and commit a refreshed engineering snapshot. Existing reports, flow state and
Replay recordings must remain intact; this does not rerun the analysis tools.
The GCD ws_0008 repair generated antennaCheck, postRouteLec, EMIR and Harden
snapshots and verified hashes of all 60 protected configuration/report/Replay
files remained unchanged. The example is not a hard-coded workspace default.

Regression checks cover more than 16 geometry-bearing cards, geometry without
PNG, independent post-route LEC resource resolution for native launch, all LEC
builders retaining their physical input while remaining checkers, export
failure and native-engine ownership, and physical checker save-data snapshots.
