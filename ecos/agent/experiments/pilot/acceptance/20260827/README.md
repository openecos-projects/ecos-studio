# Parameter Acceptance 2026-08-27

The generated JSON manifest records native receipts, terminal observations,
materialization snapshots, and independent replay hashes without copying the
ignored flow outputs into Git.

Historical generated classification: **Engineering Complete** for all eight
target knobs in the 2026-08-27 artifact revision. This directory is retained
as historical acceptance evidence and must not be cited as current
final-revision Engineering Complete without regenerating the report with the
current validator and current candidate artifacts.
`place.routability_opt=false` is recorded as an effective negative arm when its
native receipt is `applied/not_activated`; this preserves the branch diagnostic
without rejecting the candidate. No QoR or research claim is made from this
artifact.

Regenerate with:

```bash
PYTHONPATH=src uv run python scripts/build_parameter_acceptance.py \
  --workspace experiments/pilot/results/gate0-20260824-d/gcd/workspace \
  --output experiments/pilot/acceptance/20260827
```
