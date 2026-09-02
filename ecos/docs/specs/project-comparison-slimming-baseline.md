# Project Comparison Slimming Baseline

Baseline commit: `7e453775`

The representative service fixture fixes the observable baseline at two Project
Workspaces, two distinct Engineering Workspace identities, 13 successful Flow
Steps per Workspace, 181 normalized metrics per Workspace, one selected baseline,
Signoff readiness, recommendation, risk, timing triage, Step Compare, and Findings.

The focused service test records deterministic query measurements. The current
path coalesces two concurrent requests into one query, reads 40 files per
Workspace (80 total), records bytes read and serialized IPC payload bytes, and
opens each Workspace through the Runtime Snapshot provider once. Wall-clock time
is logged for diagnostics but is not asserted.

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
