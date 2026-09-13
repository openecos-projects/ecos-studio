# ECOS Agent

These instructions apply to `ecos/agent/` and supplement the parent instruction
files.

## Execution Boundaries

- Codex produces read-only, schema-constrained proposals; it does not execute
  shell commands, mutate workspaces, or run ECC directly.
- ECOS Studio validates proposals, obtains user confirmation, performs workspace
  mutations, invokes ECC, and records terminal results.
- Source workspaces are preserved during isolated reruns, and execution success
  is reported only from terminal ECC evidence.
- The subprocess protocol keeps the Python provider replaceable while Electron
  owns process lifecycle and GUI delivery.

## Setup And Development

```bash
cd ecos/agent
uv sync --locked
uv run python -m ecos_agent.provider
```

## Validation

- Focused test: `uv run pytest -q tests/<test_file>.py`
- Full Agent suite: `uv run pytest -q`

Run the focused test while iterating, then the full suite for provider, protocol,
state-machine, permission, or shared-contract changes.

## When Changing Agent Contracts

- Keep Python provider payloads and
  `ecos/gui/packages/shared/src/contracts/desktopAgent.ts` behaviorally aligned.
- Update Electron provider/IPC tests and renderer contract tests when the
  transport-visible shape changes.
- Keep protocol version and development/packaged manifests aligned with the
  runtime that consumes them.

## Ledger Schema Evolution

The optimization ledger and audit chains must replay across code revisions.
Entry hashes are computed over the key set actually stored in each record
(`exclude_unset`), so:

- Adding an optional field (default `None` or empty) to a persisted chain
  model or its nested models is backward compatible by construction. Give new
  fields defaults; never make an existing optional field required, and never
  rename or delete fields without bumping the record `schema_version`.
- Keep writes and verification paired: rows are serialized with
  `exclude_unset`, and entry-hash validators recompute over the same dump.
  Changing one side alone corrupts new records.
- Object-level self-referential hashes (`state_sha256`, `contract_sha256`,
  `envelope_sha256`, `alignment_contract_sha256`) re-serialize the whole
  model: a new optional field there needs an excluding default, for example
  `exclude_if=lambda value: value is None`, otherwise older persisted objects
  fail their hash check.
- Cover new persisted fields with a cross-generation test in
  `tests/optimization/test_ledger_hash_evolution.py`: drop or inject the new
  field in a stored record, re-hash the remaining content, and verification
  must not break.

## When Changing Workspace Actions

- Preserve local validation and explicit user confirmation before execution.
- Do not grant Codex a direct write or ECC execution path.
- Do not overwrite a source workspace when the operation requires an isolated
  rerun target.
- Do not report success without terminal execution evidence.
- Read `PERMISSION_MODEL.md` before changing permission, path, network, parameter
  authorization, or audit behavior.

## Dependencies And Packaging

- Use uv and commit the corresponding `uv.lock` update.
- The release build packages the provider with PyInstaller through
  `.github/scripts/build-binaries.sh`; do not edit `build/` or `dist/` outputs by
  hand.
