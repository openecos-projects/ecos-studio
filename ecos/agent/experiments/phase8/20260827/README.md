# Phase 8 Equal-Budget Harness

The frozen design manifest contains exactly ten design IDs from the authoritative
benchmark catalog. The generated reports are `not_run` until real terminal traces
are supplied; empty reports are infrastructure artifacts, not optimization evidence.

Run with:

```bash
PYTHONPATH=src uv run python scripts/run_equal_budget_harness.py \
  --design-manifest experiments/phase8/20260827/frozen-design-manifest.v1.json \
  --requested-only-traces <requested-only-terminal-trace.jsonl> \
  --receipt-aware-traces <receipt-aware-terminal-trace.jsonl> \
  --requested-only-planning-calls <count> \
  --receipt-aware-planning-calls <count> \
  --reference-runtime-seconds <T_d> \
  --seed <seed> \
  --tool-revision <revision> \
  --input-manifest-sha256 <sha256:...> \
  --output experiments/phase8/20260827
```

The two trace inputs must come from independent candidate executions. A run is
`completed` only when each mode has 20 started candidates and covers all ten
frozen designs; partial evidence is reported as `incomplete`.
