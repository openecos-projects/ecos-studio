# ECC Project and Workspace Contract Alignment

Status: proposed

## Problem Statement

ECC origin now provides Project Manifest discovery, canonical parameter handling and TOML Workspace configuration, while the current ECOS Studio backend refactor independently introduced Workspace Spec persistence, Workspace metadata and Studio-owned Manifest mutations. Merging the two histories unchanged would create competing sources of truth, creator-dependent Projects, duplicated configuration files and conflicting runtime ownership.

An engineer must be able to create a Project or Workspace with either ECC CLI or ECOS Studio and then open, inspect, update and run it with the other tool. The integration must retain ECC origin behavior, preserve the current headless engine and Runtime Adapter architecture, and avoid moving Electron or GUI concerns into ECC.

## Solution

Use ECC origin as the implementation baseline and define one shared headless Project and Workspace domain. The Project Manifest remains the portable Project contract. A transient Workspace Spec expresses a requested create or update, while one ECC-written Workspace Descriptor records the committed runnable configuration and portable provenance of an existing Workspace.

ECC CLI calls the headless domain directly. ECOS Studio calls the same domain through its Runtime Adapter and retains only product interaction, authorization and application-state orchestration. Project Configuration remains an optional CLI authoring template and never becomes an existing Workspace's source of truth.

## User Stories

1. As an ECC CLI user, I want Studio to open a Project I created, so that choosing the CLI does not exclude the desktop workflow.
2. As a Studio user, I want ECC CLI to discover and run a Project I created, so that automation does not require recreating the Project.
3. As an engineer, I want either tool to open an existing Workspace, so that Workspace ownership is not inferred from its creator.
4. As an engineer, I want one Project Manifest contract, so that CLI and Studio do not interpret Project membership differently.
5. As an engineer, I want Project paths to remain portable, so that moving a Project does not invalidate its Manifest.
6. As an engineer, I want Workspace paths in the Manifest to be relative to the Project, so that machine-specific roots are not persisted.
7. As an engineer, I want the Manifest to record Workspace lineage and lifecycle, so that branching and archiving remain stable product concepts.
8. As an engineer, I want QoR baseline and best-Workspace selections preserved as explicit Project choices, so that comparisons remain reproducible.
9. As an engineer, I want Workspace execution state excluded from the Manifest, so that stale Project metadata cannot override current engineering facts.
10. As an engineer, I want metrics excluded from the Manifest, so that Engineering Snapshots remain the committed engineering source of truth.
11. As an engineer, I want one Workspace Descriptor, so that configuration and provenance are not duplicated across several files.
12. As an engineer, I want the Workspace Descriptor to be human-readable, so that I can inspect the committed setup without internal tooling.
13. As an engineer, I want ECC to be the only Descriptor writer, so that direct edits cannot leave existing Flow results inconsistent with configuration.
14. As a CLI user, I want an optional editable Project Configuration template, so that repeated create or update commands do not require many flags.
15. As a Studio user, I want Projects to work without Project Configuration, so that Studio does not create CLI-only files unnecessarily.
16. As an engineer, I want changes to Project Configuration applied only by an explicit create or update, so that opening a Workspace never mutates it silently.
17. As an engineer, I want Workspace Spec to remain a transient command, so that an RPC request is not mistaken for persisted Workspace state.
18. As an engineer, I want one canonical flat snake_case parameter vocabulary, so that CLI, Studio and persisted Workspace configuration use the same meanings.
19. As an engineer, I want display labels to remain presentation-only, so that UI wording changes do not alter persisted parameters.
20. As an engineer, I want legacy long and dotted parameter aliases accepted only while reading old data, so that new files do not continue schema drift.
21. As an engineer, I want the Descriptor to retain origin's design, PDK, Flow and parameter structure, so that the merge evolves origin instead of replacing it wholesale.
22. As an engineer, I want the Descriptor to record materialized input roles and content hashes, so that input provenance can be validated after creation.
23. As an engineer, I want portable MPC identity and source integrity recorded, so that a Workspace can be rebound without embedding local resource content.
24. As an engineer, I want PDK requirements stored without absolute installation paths, so that a Workspace can move between machines.
25. As an engineer, I want CLI and Studio to resolve local PDK installations when opening, so that each environment can provide its own binding.
26. As an engineer, I want ECC to validate a supplied Workspace Binding, so that execution cannot silently use a mismatched PDK.
27. As an engineer, I want historical inspection to remain available when the local PDK is missing, so that unavailable execution does not hide completed results.
28. As an ECC maintainer, I want the existing backend parameter JSON retained as derived data, so that current tool consumers need no simultaneous rewrite.
29. As an engineer, I want derived backend configuration regenerated from the Descriptor, so that it can never override committed configuration.
30. As an engineer with an origin-format Workspace, I want its existing TOML configuration recognized, so that the new descriptor name does not break it.
31. As an engineer with an older JSON Workspace, I want existing loading behavior preserved, so that migration does not block productive work.
32. As an engineer, I want migration to write only a completely validated Descriptor, so that no partial canonical file shadows valid legacy data.
33. As an engineer, I want branch-only Workspace Spec and metadata files removed without migration, so that unpublished refactor artifacts do not become permanent contracts.
34. As a CLI user, I want Project Manifest validation and mutation to use the same implementation as Studio, so that one creator cannot produce an incompatible Project.
35. As a Studio user, I want window authorization, shutdown coordination, recovery presentation and recent-project registration preserved, so that backend unification does not regress desktop behavior.
36. As an engineer, I want a managed Workspace reported as created only after its directory, Descriptor, initial Engineering Snapshot and Manifest registration are durable, so that success has one meaning in both tools.
37. As an engineer, I want failed creation to publish no partial Workspace, so that retrying cannot consume incomplete data.
38. As an engineer, I want explicit idempotent retries, so that a repeated command does not duplicate a completed Workspace.
39. As an engineer, I do not want automatic crash repair to delete or complete Workspaces after restart, so that recovery never makes an unrequested destructive choice.
40. As an ECC maintainer, I want GUI concepts excluded from ECC interfaces, so that the engineering runtime remains headless and independently testable.
41. As a Studio maintainer, I want the Runtime Adapter to translate product commands without parsing Workspace files, so that file-format knowledge remains local to ECC.
42. As a maintainer, I want unrelated ECC origin capabilities retained during the merge, so that LEC, Timing Optimization, PDK validation and tool fixes are not lost.

## Implementation Decisions

- ECC origin is the source of truth for the merge. Origin commits and behavior are retained unless they conflict with an accepted Project or Workspace contract below.
- ECC remains headless. Its domain interfaces contain Project and Workspace identities, Workspace Specs and Bindings, expected revisions, command identities and domain outcomes, but no Electron, window, Renderer, dialog, Activity or recent-project state.
- ECC CLI is an adapter that calls the headless domain directly. ECOS Studio reaches the same domain through the Runtime Adapter.
- The Project Manifest is creator-independent. Its parsing, validation and atomic read-modify-write mutations have one implementation in the ECC Project module.
- Studio owns product interaction, filesystem authorization at the IPC trust boundary, window ownership, shutdown coordination, recovery presentation and application registration. It does not maintain another Manifest parser or writer.
- The Project Manifest stores Project identity and timestamps; Workspace identity, name, relative location, lineage and active or archived lifecycle; objectives; portable MPC identity; QoR baseline; and best-Workspace selection.
- The Project Manifest does not store an absolute Project root, base design configuration, Workspace parameter patches, Flow boundaries, execution outcomes, metric summaries, Step metrics, local MPC paths or embedded templates.
- Legacy Manifests are normalized in memory on read. They are rewritten to the reduced shape only on the first successful Manifest mutation and only after every referenced Workspace is readable with a valid Descriptor.
- Project Configuration is the optional, human-editable CLI template named `ecc.toml` at Project scope. It supplies defaults only for explicit Workspace create or update commands.
- Existing Workspace open and run operations never silently reapply Project Configuration.
- Workspace Spec is the transient creator-independent create or update command validated by ECC. It is not persisted as a separate file.
- Workspace Binding is a transient mapping from portable input and PDK requirements to the current machine. Absolute binding paths are never persisted in the Workspace Descriptor.
- The Workspace Descriptor is the single committed description named `workspace.toml` under Workspace home data. It contains resolved runnable configuration and portable input, PDK and MPC provenance, but no execution state or engineering results.
- The Descriptor evolves origin's TOML structure: retain design, PDK, Flow and parameter sections; add only input, MPC and integrity information required by the current architecture.
- The Descriptor never embeds a serialized resolved Workspace Spec wrapper.
- ECC owns Descriptor writes. Successful updates validate and atomically replace the Descriptor, advance Workspace Revision and invalidate affected results.
- The Workspace Descriptor module exposes only normalized load and commit operations. Format detection, legacy normalization, validation, atomic persistence and derived backend configuration generation remain internal.
- ECC Workspace loading is the shared entry point for Descriptor recognition and migration. CLI, Runtime Adapter and Studio do not add their own pre-open migrations.
- Origin-format `params.toml` and older `parameters.json` inputs remain readable. A canonical Descriptor is installed only after the complete candidate validates; otherwise existing origin loading behavior is retained without writing a partial Descriptor.
- Branch-only `workspace-spec.json` and `workspace-metadata.json` are removed with their readers, writers and tests. They receive no compatibility path because they were not part of ECC origin.
- `parameters.json` remains Derived Backend Configuration for existing backend consumers. It is generated from the Descriptor, never user-edited and never applied back over the Descriptor.
- Parameters use one stable flat snake_case vocabulary. Friendly labels are presentation only; legacy long and dotted aliases are migration inputs and are never written by new code.
- A managed create succeeds only after the Workspace directory, Descriptor, initial Engineering Snapshot and Manifest registration are durable. Studio application registration occurs afterward and is recoverable independently.
- Creation uses staging, atomic publication and explicit idempotent retry. No new automatic background crash-repair system is introduced.
- Studio's Creation Journal remains an application-level module. It no longer reimplements engineering-file transactions but retains current user-visible recovery and application registration behavior.
- ECC's removed JSON-RPC server is not restored. Origin runtime changes are ported to the headless engine or Runtime Adapter seams.
- Code identifiers and fixtures use role-based names rather than product version labels. Persisted schema compatibility fields may retain explicit numeric versions where required by a real file or protocol contract.

## Testing Decisions

- Tests assert external behavior through module interfaces and persisted contracts, not private helpers or intermediate representations.
- The primary acceptance seam is the ECC Project and Workspace interface. A cross-creator matrix creates with CLI and opens/runs through Runtime Adapter, then creates through Runtime Adapter and discovers/opens/runs with CLI.
- The Workspace Descriptor module interface is tested directly for normalized load and commit, origin TOML compatibility, older JSON compatibility, complete-candidate migration, atomic write failure, malformed input, symlink refusal, machine-local path exclusion and Derived Backend Configuration regeneration.
- The Studio Product Command interface is tested with its existing runtime adapter stand-in. Tests retain window authorization, shutdown blocking, Creation Journal projection, explicit recovery and recent-project registration while proving Studio does not directly write Manifest or Descriptor files.
- Existing ECC CLI command tests provide prior art for Project discovery, configuration layering, overwrite protection, migration safety and run continuation.
- Existing ECC Workspace lifecycle tests provide prior art for staged creation, atomic replacement, revision conflicts, idempotent commands and PDK binding readiness.
- Existing Runtime Adapter tests provide prior art for typed request translation, Workspace sessions, operation isolation, layout editing and Engineering Snapshot publication.
- Existing Studio Product Command and Creation Journal tests provide prior art for renderer ownership, shutdown behavior, registration recovery and application-state consistency.
- Tests cover a Studio-created Project with no `ecc.toml` and a CLI-created Project with `ecc.toml` to prove Project Configuration is optional.
- Tests cover Project relocation and verify that Manifest and Descriptor contracts contain no machine-local Project or PDK root.
- Tests cover missing and mismatched PDK bindings: inspection remains available, execution readiness fails explicitly and no persisted portable contract is mutated.
- Tests cover conflicting Descriptor and Derived Backend Configuration values and verify that the Descriptor wins and the derived file is regenerated.
- Tests cover legacy Manifest normalization without write-on-open and atomic conversion on the first successful mutation.
- Tests cover creation failure before publication, failure after the domain commit but before Studio application registration, and explicit same-command retry.
- Relevant existing ECC, Runtime Adapter and Studio suites must pass. The final change report lists exact commands, skipped packaging checks and residual risk.

## Out of Scope

- Publishing an issue, opening a pull request or pushing any branch.
- Restoring the ECC JSON-RPC server removed by the current architecture.
- Moving GUI, Electron, window, Activity or recent-project responsibilities into ECC.
- Combining Flow ledgers, Operation journals, Engineering Snapshots, checklists, metrics or signoff artifacts into `workspace.toml`.
- Adding automatic background crash repair for interrupted Workspace creation.
- Removing `parameters.json` before existing backend consumers have migrated away from it.
- Changing visible Studio workflows, Project Comparison semantics, Flow execution behavior or Signoff Package contents beyond the contract integration required here.
- Treating branch-only Workspace Spec or metadata JSON files as released legacy formats.
- Broad documentation renaming unrelated to the Project and Workspace contracts.

## Further Notes

- The ECC merge was started locally and paused with unresolved conflicts so this specification could be confirmed first. No merge result has been committed or pushed.
- The accepted domain decisions are also recorded in the adjacent Project comparison, canonical parameter, Workspace Descriptor, Manifest IO and Manifest content ADRs.
- The implementation should prefer deletion of duplicate parsers, writers and migration paths over compatibility layers for unpublished branch-only formats.
