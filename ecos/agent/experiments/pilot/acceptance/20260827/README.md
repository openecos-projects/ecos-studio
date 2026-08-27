# Parameter Acceptance 2026-08-27

The generated JSON manifest records native receipts, terminal observations,
materialization snapshots, and independent replay hashes without copying the
ignored flow outputs into Git.

Current classification: **Engineering Complete** for the seven target knobs.
`place.routability_opt` is explicitly excluded from this acceptance gate as a
non-target; its incomplete native branch remains recorded but does not block
engineering completion. No QoR or research claim is made from this artifact.

Regenerate with:

```bash
PYTHONPATH=src uv run python scripts/build_parameter_acceptance.py \
  --workspace experiments/pilot/results/gate0-20260824-d/gcd/workspace \
  --output experiments/pilot/acceptance/20260827
```
