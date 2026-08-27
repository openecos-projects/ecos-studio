# Phase 8 Equal-Budget Harness

The frozen design manifest contains exactly ten design IDs from the authoritative
benchmark catalog. The generated reports are `not_run` until real terminal traces
are supplied; empty reports are infrastructure artifacts, not optimization evidence.

Run with:

```bash
PYTHONPATH=src uv run python scripts/run_equal_budget_harness.py \
  --design-manifest experiments/phase8/20260827/frozen-design-manifest.v1.json \
  --traces <terminal-trace.jsonl> \
  --output experiments/phase8/20260827
```
