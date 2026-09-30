#!/usr/bin/env python3
"""Shared-rerun cell entry: prepare the workspace if needed, then run the driver.

The cache-only driver requires an already prepared workspace (successful
canonical flow) before it can reuse a calibration donor. This wrapper makes
that preparation an idempotent, explicitly recorded prebuild step of the
cell itself: an existing successful workspace is verified and reused, an
absent one is created through the ECC RPC exactly once, and the prebuild
cost lands in its own receipt next to the episode evidence.

Environment (ECOS_AGENT_ECC_RPC_BIN, ECOS_AGENT_ECC_TERMINAL_TIMEOUT_SECONDS,
audit variables) is inherited unchanged from the frozen scheduler process.
"""

from __future__ import annotations

import argparse
import json
import os
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

from ecos_agent.codex.provider import CodexAppServerProposalProvider
from ecos_agent.hashing import canonical_sha256
from ecos_agent.optimization.experiments.closed_loop_driver import (
    BASELINE,
    load_design,
    main as driver_main,
)
from ecos_agent.optimization.experiments.knowledge_treatment_execution import (
    ExperimentManifest,
    _ensure_workspace,
    _verify_workspace_binding,
)
from ecos_agent.optimization.experiments.runner_environment import (
    apply_runner_environment,
    runner_model_from_argv,
)


def _prepare_workspace(
    designs_root: Path, pdk_root: Path, design_id: str, workspace: Path, timeout: float
) -> dict[str, object]:
    design = load_design(designs_root.resolve(), design_id)
    manifest = ExperimentManifest(
        manifest_sha256=canonical_sha256(
            {"baseline": BASELINE, "design": design_id, "pdk": "ics55"}
        ),
        designs=(design,),
        baseline=dict(BASELINE),
        pdk_name="ics55",
        pdk_root=pdk_root.resolve(),
    )
    receipt: dict[str, object] = {
        "schema_version": "ecos.rerun_prebuild_receipt.v1",
        "design_id": design_id,
        "workspace": str(workspace),
        "started_at": datetime.now(timezone.utc).isoformat(),
        "mode": "reuse" if (workspace / "home/flow.json").is_file() else "create",
    }
    started = time.monotonic()
    _ensure_workspace(manifest, design, workspace, timeout)
    _verify_workspace_binding(manifest, design, workspace)
    receipt["elapsed_seconds"] = round(time.monotonic() - started, 3)
    receipt["finished_at"] = datetime.now(timezone.utc).isoformat()
    return receipt


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--prebuild-receipt", type=Path, required=True)
    parser.add_argument(
        "--prebuild-timeout-seconds", type=float, default=3600.0,
        help="ECC flow timeout for the one-time workspace creation",
    )
    parser.add_argument("--design", required=True)
    parser.add_argument("--run-root", type=Path, required=True)
    parser.add_argument("--designs-root", type=Path, required=True)
    parser.add_argument("--pdk-root", type=Path, required=True)
    known, rest = parser.parse_known_args(argv)
    if any(arg == "--dry-run" for arg in rest):
        print(json.dumps({
            "dispatch": "disabled", "provider": "disabled", "native": "disabled",
            "prebuild": "skipped-in-dry-run",
            "workspace": str(known.run_root.resolve() / "workspaces" / known.design),
        }, sort_keys=True))
        return 0
    workspace = known.run_root.resolve() / "workspaces" / known.design
    # Attempt-private scratch: every cell gets its own NFS temp tree so no
    # two attempts ever share writable transient paths.
    scratch = known.run_root.resolve() / "runtime" / "tmp"
    scratch.mkdir(parents=True, exist_ok=True)
    for variable in ("TMPDIR", "TMP", "TEMP"):
        os.environ[variable] = str(scratch)
    receipt = _prepare_workspace(
        known.designs_root, known.pdk_root, known.design, workspace,
        known.prebuild_timeout_seconds,
    )
    known.prebuild_receipt.parent.mkdir(parents=True, exist_ok=True)
    known.prebuild_receipt.write_text(
        json.dumps(receipt, indent=2, sort_keys=True) + "\n", encoding="utf-8"
    )
    print(f"[prebuild] mode={receipt['mode']} elapsed={receipt['elapsed_seconds']}s", flush=True)
    # Mirror scripts/run_closed_loop_episode.py: model-routed environment,
    # then the driver with the real app-server provider.
    _model = runner_model_from_argv(rest)
    print("[runner-env]", apply_runner_environment(model=_model), flush=True)
    return driver_main(CodexAppServerProposalProvider, rest)


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
