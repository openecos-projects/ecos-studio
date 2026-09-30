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
import hashlib
import json
import os
import shutil
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


def _seed_workspace_calibration(
    workspace: Path, source: Path, receipt: dict[str, object]
) -> None:
    """Copy the design's canonical replay calibration into this workspace.

    The source is the batch's per-design canonical workspace calibrated by
    ``ecos_agent.optimization.calibrate_workspace`` (two default replays with
    replay-cache manifests plus the frozen noise epsilon). Each replay cache
    manifest is re-validated against THIS workspace's environment fingerprint,
    so any toolchain, PDK, origin-input or parameter drift fails closed
    instead of seeding with stale calibration. Seeding is idempotent: an
    already seeded workspace is only re-verified, never overwritten.
    """
    from ecos_agent.optimization.calibrate_workspace import (
        _environment_fingerprint,
        _load_replay_manifest,
        _require_same_inputs,
    )

    optimization_root = workspace / ".agent" / "optimization"
    epsilon_target = optimization_root / "noise-epsilon.v1.json"
    calibration_target = optimization_root / "noise-calibration"
    fingerprint = _environment_fingerprint(workspace)
    if epsilon_target.is_file():
        seeded = "already-seeded"
    else:
        epsilon_source = source / ".agent" / "optimization" / "noise-epsilon.v1.json"
        calibration_source = source / ".agent" / "optimization" / "noise-calibration"
        replays = sorted(calibration_source.glob("default-replay-*"))
        runtime_source = source / ".agent" / "optimization" / "reference-runtime.v1.json"
        if not epsilon_source.is_file() or not runtime_source.is_file() or len(replays) < 2:
            raise SystemExit(
                f"calibration source lacks the canonical seed (epsilon + "
                f"reference runtime + >=2 replays): {source}"
            )
        for replay in replays:
            manifest = _load_replay_manifest(replay)
            if manifest is None:
                raise SystemExit(f"replay cache manifest missing: {replay}")
            _require_same_inputs(manifest, fingerprint, replay.name)
        optimization_root.mkdir(parents=True, exist_ok=True)
        shutil.copy2(epsilon_source, epsilon_target)
        shutil.copy2(
            runtime_source, optimization_root / "reference-runtime.v1.json"
        )
        shutil.copytree(calibration_source, calibration_target)
        seeded = "seeded"
    replay_dirs = sorted(calibration_target.glob("default-replay-*"))
    receipt["calibration"] = {
        "status": seeded,
        "source": str(source),
        "seeded_replays": [path.name for path in replay_dirs],
        "epsilon_sha256": "sha256:" + hashlib.sha256(epsilon_target.read_bytes()).hexdigest(),
        "environment_fingerprint": dict(fingerprint),
    }


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--prebuild-receipt", type=Path, required=True)
    parser.add_argument(
        "--prebuild-timeout-seconds", type=float, default=3600.0,
        help="ECC flow timeout for the one-time workspace creation",
    )
    parser.add_argument(
        "--calibration-source", type=Path, required=True,
        help="design's canonical workspace holding the seeded default-replay "
        "calibration copied into this attempt workspace",
    )
    parser.add_argument("--design", required=True)
    parser.add_argument("--run-root", type=Path, required=True)
    parser.add_argument("--designs-root", type=Path, required=True)
    parser.add_argument("--pdk-root", type=Path, required=True)
    known, _ = parser.parse_known_args(argv)
    if argv is None:
        argv = sys.argv[1:]
    # The driver owns every remaining flag; only strip this wrapper's own two.
    own = ("--prebuild-receipt", "--prebuild-timeout-seconds", "--calibration-source")
    rest, skip, index = [], 0, 0
    while index < len(argv):
        arg = argv[index]
        if skip:
            skip -= 1
        elif arg in own or arg.split("=", 1)[0] in own:
            skip = "=" not in arg
        else:
            rest.append(arg)
        index += 1
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
    _seed_workspace_calibration(workspace, known.calibration_source.resolve(), receipt)
    known.prebuild_receipt.parent.mkdir(parents=True, exist_ok=True)
    known.prebuild_receipt.write_text(
        json.dumps(receipt, indent=2, sort_keys=True) + "\n", encoding="utf-8"
    )
    print(f"[prebuild] mode={receipt['mode']} elapsed={receipt['elapsed_seconds']}s", flush=True)

    def _episode_id() -> str:
        for index, arg in enumerate(rest):
            if arg == "--episode-id":
                return rest[index + 1]
        return "unknown"

    exit_code, error_class = 1, None
    try:
        # Mirror scripts/run_closed_loop_episode.py: model-routed environment,
        # then the driver with the real app-server provider.
        _model = runner_model_from_argv(rest)
        print("[runner-env]", apply_runner_environment(model=_model), flush=True)
        exit_code = driver_main(CodexAppServerProposalProvider, rest)
    except Exception as exc:  # typed failure record; the scheduler never sees a naked exit
        error_class = type(exc).__name__
        print(f"[cell] failed: {error_class}: {exc}", flush=True)
        raise
    finally:
        if not isinstance(exit_code, int):
            exit_code = 1
        known.prebuild_receipt.parent.mkdir(parents=True, exist_ok=True)
        (known.prebuild_receipt.parent / "cell-exit.json").write_text(
            json.dumps(
                {
                    "schema_version": "ecos.rerun_cell_exit.v1",
                    "episode_id": _episode_id(),
                    "design_id": known.design,
                    "exit_code": exit_code,
                    "error_class": error_class,
                    "finished_at": datetime.now(timezone.utc).isoformat(),
                },
                indent=2,
                sort_keys=True,
            )
            + "\n",
            encoding="utf-8",
        )
    return exit_code


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
