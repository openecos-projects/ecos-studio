# Phase 8 Functional Equal-Budget Smoke

The engineering evaluation is complete for the six frozen smoke designs:
`gcd`, `i2c`, `cia`, `zipdiv`, `cordic`, and `xtea`. Requested-only and
receipt-aware planning each executed two independent terminal candidates per
design, for 12 started candidates and 12 planning calls per mode.

The optimizer implementation now accepts all eight frozen knobs, including
`place.routability_opt`. A `false` routability request is an effective negative
arm when the native receipt records `application_status: applied` and
`activation.status: not_activated`; the branch diagnostic remains separately
counted. A `true` request requires the routability branch to enter.

The compact run recorded in this directory predates that change and remains a
seven-knob historical artifact (`ignored_knobs` is intentionally preserved in
its generated manifests). A new Phase 8 rerun will emit `ignored_knobs: []` and
include routability candidates in the traces and equal-budget statistics.

`aggregate-report.v1.json` records:

- `engineering_classification: Engineering Complete`;
- `research_classification: Research Claim Not Assessed`;
- the six observed and four deferred designs;
- independent candidate IDs and raw-trace hashes for both modes;
- per-design `T_d`, real episode elapsed wall time, runtime, memory, terminal
  metrics, and the `22*T_d` checks.

The frozen ten-design manifest remains the contract for a future research
comparison. The current report keeps `status: incomplete` and
`research_evaluation_status: incomplete` because the four deferred designs were
not run. This does not change the Engineering classification.

Rebuild the reports from the existing audited episodes without starting EDA:

```bash
BENCHMARK_ROOT=/path/to/benchmarks/designs
ECOS_AGENT_ECC_BIN=../../ecc/.venv/bin/ecc \
PYTHONPATH=src uv run --frozen python scripts/finalize_equal_budget_functional_smoke.py \
  --design-manifest experiments/phase8/20260827/frozen-design-manifest.v1.json \
  --benchmark-root "$BENCHMARK_ROOT" \
  --pdk-root ../../pdk/icsprout55-pdk \
  --workspace-root experiments/phase8/20260827/workspaces \
  --output experiments/phase8/20260827 \
  --run-id phase8-20260828-7knob \
  --tool-revision eae7564014d9d4b6f7d6a3e22fedfb933cd31472
```

The finalizer verifies the frozen inputs, three calibration replays, episode
state hashes, ledger/audit heads, per-design summaries, independent trace IDs,
and elapsed wall-time limits before rewriting the compact reports.
