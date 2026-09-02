# Project Comparison Slimming Baseline

Baseline commit: `7e453775`

Validation date: 2026-09-03. The completed implementation was measured after
parent commit `7e20bcd7` and ECC commits `ff9bd5c` and `c54de4b`, before this
final validation commit.

The representative service fixture fixes the observable baseline at two Project
Workspaces, two distinct Engineering Workspace identities, 13 successful Flow
Steps per Workspace, 181 normalized metrics per Workspace, one selected baseline,
Signoff readiness, recommendation, risk, timing triage, Step Compare, and Findings.

The focused service test records deterministic query measurements. Wall-clock
time remains diagnostic and is not asserted.

## Completed Query Measurements

| Measurement | Baseline | Completed implementation |
| --- | ---: | ---: |
| Initial committed-fact files | 40 per Workspace, 80 total | 1 Snapshot per Workspace, 2 total |
| Initial bytes read | approximately 448 KiB | 510,988 bytes |
| Serialized comparison IPC payload | approximately 712 KiB | 826,229 bytes |
| Concurrent duplicate requests coalesced | 1 | 1 |
| Runtime Snapshot provider opens | 1 per Workspace | 0 |
| Same-revision repeat Snapshot reads | not cached across the old query path | 0 additional reads |
| Selected Route Findings reads | included in the initial bulk query | 3 declared and verified references on demand |

The larger completed Snapshot and IPC byte counts carry the full normalized
metric records required by Step Compare. The important ownership change is that
initial file count falls from 80 to 2, repeated same-revision queries reuse the
verified cache, and Findings reads are deferred until selection. Tests also
prove that one changed Snapshot rereads only that Workspace, unchanged watcher
events do not invalidate the result, and comparison reads create no Runtime
Session or self-invalidating lifecycle event.

## Production Surface Measurements

Production source counts include TypeScript, Vue, and Python under Renderer,
Electron main/preload, Shared, Runtime Adapter, and `ecc/chipcompiler/engine`.
Tests, fixtures, generated output, dependencies, and caches are excluded. Built
size is the sum of regular files in a clean
`apps/desktop-electron/dist` produced by the same lockfile and `pnpm run build`.
Preload surface counts typed invoke and subscription leaf methods exposed by
`desktopApi`.

| Measurement | Baseline | Completed | Delta |
| --- | ---: | ---: | ---: |
| Production modules | 353 | 359 | +6 |
| Production lines | 133,189 | 133,938 | +749 |
| Preload leaf methods | 133 | 132 | -1 |
| Clean built assets | 35,823,816 bytes | 35,855,862 bytes | +32,046 bytes |

No deletion target was imposed. The added Snapshot reader, watcher, Findings,
and execution-overlay modules replace self-invalidating and duplicated fact
paths while keeping the measured product behavior intact.

## Production Reachability

| Candidate | Live production reachability at baseline | Non-production/export residue |
| --- | --- | --- |
| Legacy Backend Runtime Event aliases | Backend Flow projections and Workspace orchestration | Renderer Runtime Event adapter tests and Frontend compatibility |
| Renderer Project Manifest parser and mutations | Project CRUD, registration, replacement, archive, delete, and baseline selection | Shared canonical implementation and both test suites |
| Renderer engineering DTO producers | Project Management assembly, QoR projection, recommendation, risk, timing triage, and Step Compare | Presentation fixtures and transformation tests |
| Generic ECC Artifact content API | No Renderer product consumer | Shared types, preload, Electron forwarding, Adapter registration, and transport tests |
| Public Project file watch API | Backend Flow log recovery | Shared types, preload, handlers, mocks, and watch tests |
| Public Project log-tail API | Backend Flow logs | Shared types, preload, handlers, mocks, and log tests |
| Optional project text update API | No production consumer | Shared type and preload/handler plumbing |
| Runtime Adapter management RPCs | Startup handshake and shutdown cleanup use `rpc.hello` and `rpc.shutdown`; `rpc.ping` has no product consumer | Shared types, Adapter registration, and protocol tests |
| Optional/polling Desktop Bridge helpers | Resource, Terminal, Frontend, report, application shell, Project, and utility consumers | Late-injection and browser-mode tests |

Reachability is rechecked after each deletion slice; similarly named bounded
Project text reads, log recovery reads, Frontend compatibility, Workspace
Resources, Chip Viewer, Terminal, and Design Report capabilities are retained.

The final production scan has no Backend legacy Runtime Event envelope, local
Renderer Project Manifest implementation, Renderer engineering-fact producer,
generic Artifact content API, public Project watch/log-tail/text-update API,
Backend Adapter management method, or polling Desktop Bridge helper. Renderer
Manifest call sites import the Shared parser. Remaining `rpc.hello` and
`rpc.shutdown` strings are guarded by `adapterManagementRpc` and are enabled
only for `frontendRpcCore`, which this migration explicitly freezes.

## Validation Record

| Check | Result |
| --- | --- |
| `cd ecos/gui && pnpm run check` | passed: infra 7, Shared 87, Renderer 781, Electron 700 tests; typecheck, lint, and format passed |
| `cd ecos/gui && pnpm run build` | passed from a clean `dist` |
| sandbox-disabled Electron smoke | passed with `ELECTRON_DISABLE_SANDBOX=1 ECOS_ELECTRON_DISABLE_GPU=1 LIBGL_ALWAYS_SOFTWARE=1 pnpm run desktop:smoke` |
| Runtime Adapter `pytest -q` | 226 passed |
| Runtime Adapter `ruff check` | passed |
| ECC full non-packaging pytest | 1,277 passed, 8 skipped, 1 deselected, 4 expected failures |
| ECC `ruff format --check` and `ruff check` | passed across `chipcompiler` and `test` |
| Parent and ECC version checks | passed (`0.1.0-alpha.9` and `0.1.0-alpha.11`) |
| Production reachability and `git diff --check` | passed |

The Runtime Adapter has no local formatter configuration; an ad hoc Ruff format
check using ECC defaults would reformat 21 existing Adapter files, so it is not
treated as a component gate. Its full tests and lint pass.

The final two-axis Standards and Spec review found and corrected cancellation
request projection, active Operation revision advancement after each committed
Step, unsafe whole-Snapshot type assertions, unstable Findings reason codes,
duplicate concurrency loops, and an oversized Project Comparison service. The
orchestration service is now 721 lines with its pure projection in a focused
204-line module. ADR 0012, 0029, and 0030 are tracked under `ecos/docs/adr` and
record the implemented state.

Release/AppImage packaging was not run because no packaging input, staged
Runtime resource, dependency, lockfile, or release configuration changed. The
remaining packaging risk is limited to the unexecuted final AppImage assembly;
the production GUI build and critical Electron smoke both pass.

The parent gitlink currently references local ECC commit `c54de4b`, which is not
present on `origin`. This is the one publication blocker: publish the ECC commit
before preparing or pushing a parent-repository PR. No remote publication was
performed because this task requested local per-ticket commits only.
