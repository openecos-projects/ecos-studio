# Parameter Acceptance 2026-08-27

The generated JSON manifest records native receipts, terminal observations,
materialization snapshots, and independent replay hashes without copying the
ignored flow outputs into Git.

Current classification: **Engineering Incomplete**. Seven knobs have complete
L0-L3 and replay evidence. `place.routability_opt` remains fail-closed because
the native true branch has not produced a changed materialization with
`activation.status=used`. No QoR or research claim is made from this artifact.

Regenerate with:

```bash
PYTHONPATH=src uv run python scripts/build_parameter_acceptance.py \
  --workspace experiments/pilot/results/gate0-20260824-d/gcd/workspace \
  --output experiments/pilot/acceptance/20260827
```
