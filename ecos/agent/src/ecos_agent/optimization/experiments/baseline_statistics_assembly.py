"""Assemble per design x method baseline episodes into design-block statistics.

Read-only: consumes the episode summaries, noise epsilons, calibration
references, and episode ledgers that ``closed_loop_driver`` already persisted,
feeds ``statistics.baseline_design_statistics``, and adds assembly provenance
(which episode backed each design x method cell).  No ECC or LLM is involved.

``scripts/build_baseline_design_statistics.py`` is the thin CLI entry point.
"""

from __future__ import annotations

import json
from collections.abc import Callable, Sequence
from pathlib import Path

from ecos_agent.optimization.contracts import (
    ROUTABILITY_OBJECTIVE_ORDER,
    TIMING_GUARDRAIL_ORDER,
    TerminalObservation,
)
from ecos_agent.optimization.experiments.baselines import (
    ONLINE_BASELINE_METHODS,
    BaselineMethod,
)
from ecos_agent.optimization.experiments.equal_budget import (
    CandidateTrace,
    summarize_candidate_metrics,
)
from ecos_agent.optimization.experiments.statistics import (
    baseline_design_statistics,
    success_curve_auc,
)

_SUCCESS_BUDGET = 20
_STATISTICS_KEYS = tuple(
    metric.value for metric in (*ROUTABILITY_OBJECTIVE_ORDER, *TIMING_GUARDRAIL_ORDER)
)
_SUMMARY_NAME = "episode-summary.v1.json"


def _load_episode_outcomes(episode_root: Path) -> Sequence:
    from ecos_agent.optimization.ledger import OptimizationLedger

    return OptimizationLedger(episode_root).replay().terminal_outcomes


def _calibration_dir(run_root: Path, design_id: str) -> Path:
    candidates = (
        run_root / "reports" / design_id / "calibration",
        run_root / "workspaces" / design_id / ".agent" / "optimization"
        / "noise-calibration",
    )
    for path in candidates:
        if (path / "noise-epsilon.v1.json").is_file():
            return path
    raise ValueError(
        f"no noise-epsilon.v1.json under any known calibration location for "
        f"design {design_id}: {[str(path) for path in candidates]}"
    )


def _success_curve_at_20(metrics: dict[str, object]) -> dict[int, bool]:
    """Pad the episode's cumulative success curve out to the frozen budget.

    A short episode (wall-budget stop) pads with its last cumulative value:
    once feasible stays feasible, and never-feasible stays infeasible.
    """
    observed = {
        int(key): bool(value)
        for key, value in dict(metrics["success_at_k"]).items()
    }
    if not observed:
        return {k: False for k in range(1, _SUCCESS_BUDGET + 1)}
    if max(observed) > _SUCCESS_BUDGET:
        raise ValueError("episode started more candidates than the frozen budget")
    last = observed[max(observed)]
    return {
        k: observed.get(k, last) if k <= max(observed) else last
        for k in range(1, _SUCCESS_BUDGET + 1)
    }


def _method_episode_inputs(
    *,
    run_root: Path,
    design_id: str,
    method: BaselineMethod,
    outcome_loader: Callable[[Path], Sequence],
) -> tuple[dict[str, object], str]:
    reports_root = run_root / "reports" / design_id
    expected_policy = f"baseline:{method.value}"
    selections = {}
    for summary_path in sorted(reports_root.glob(f"*/{_SUMMARY_NAME}")):
        summary = json.loads(summary_path.read_text(encoding="utf-8"))
        if summary.get("planner_policy") == expected_policy:
            selections[summary_path.parent.name] = (summary_path, summary)
    if not selections:
        raise ValueError(
            f"no baseline episode summary with planner_policy="
            f"{expected_policy!r} under {reports_root}"
        )
    episode_id, (summary_path, summary) = sorted(selections.items())[-1]
    traces = tuple(CandidateTrace(**row) for row in summary["traces"])
    mode = summary.get("planning_evidence") or "receipt-aware"
    metrics = summarize_candidate_metrics(traces, mode=mode)
    curve = _success_curve_at_20(metrics)
    best_id = metrics["best_feasible_candidate_id"]
    if best_id is None:
        raise ValueError(
            f"baseline episode {episode_id} of design {design_id} has no "
            f"feasible candidate; design-block statistics need a terminal"
        )
    episode_root = (
        run_root / "workspaces" / design_id / ".agent" / "optimization" / episode_id
    )
    prefix = f"{episode_id}."
    if not best_id.startswith(prefix):
        raise ValueError(f"best candidate id does not match episode: {best_id}")
    intervention_id = best_id[len(prefix):]
    outcomes = outcome_loader(episode_root)
    observation = next(
        (
            outcome.terminal_observation
            for outcome in outcomes
            if outcome.intervention_id == intervention_id
            and outcome.terminal_observation is not None
        ),
        None,
    )
    if observation is None:
        raise ValueError(
            f"episode {episode_id} has no terminal observation for candidate "
            f"{best_id}"
        )
    return {
        "auc_success_at_20": success_curve_auc(curve),
        "lex_success_at_20": curve[_SUCCESS_BUDGET],
        "best_terminal_observation": TerminalObservation.model_validate(
            observation
        ).model_dump(mode="json"),
    }, episode_id


def assemble_baseline_design_statistics(
    run_root: Path,
    designs: Sequence[str],
    outcome_loader: Callable[[Path], Sequence] = _load_episode_outcomes,
) -> dict[str, object]:
    """Build the design-block baseline statistics from persisted episodes."""
    run_root = run_root.resolve()
    selection: dict[str, dict[str, str]] = {}
    design_inputs: dict[str, dict[str, object]] = {}
    for design_id in designs:
        calibration = _calibration_dir(run_root, design_id)
        epsilon_payload = json.loads(
            (calibration / "noise-epsilon.v1.json").read_text(encoding="utf-8")
        )
        full_epsilon = epsilon_payload.get("epsilon")
        if not isinstance(full_epsilon, dict):
            raise ValueError(f"noise epsilon payload is invalid: {calibration}")
        missing = [key for key in _STATISTICS_KEYS if key not in full_epsilon]
        if missing:
            raise ValueError(
                f"noise epsilon for {design_id} lacks comparison keys: {missing}"
            )
        reference_path = (
            calibration / "default-replay-1" / "terminal-observation.v1.json"
        )
        if not reference_path.is_file():
            raise ValueError(f"default reference observation missing: {reference_path}")
        reference = TerminalObservation.model_validate_json(
            reference_path.read_bytes()
        )
        methods_input: dict[str, object] = {
            BaselineMethod.DEFAULT.value: {
                "terminal_observation": reference.model_dump(mode="json")
            }
        }
        design_selection: dict[str, str] = {}
        for method in ONLINE_BASELINE_METHODS:
            payload, episode_id = _method_episode_inputs(
                run_root=run_root,
                design_id=design_id,
                method=method,
                outcome_loader=outcome_loader,
            )
            methods_input[method.value] = payload
            design_selection[method.value] = episode_id
        selection[design_id] = design_selection
        design_inputs[design_id] = {
            "noise_profile": {
                "epsilon": {key: full_epsilon[key] for key in _STATISTICS_KEYS}
            },
            "methods": methods_input,
        }
    return {
        "schema_version": "ecos.baseline_design_statistics_assembly.v1",
        "run_root": str(run_root),
        "episode_selection": selection,
        "statistics": baseline_design_statistics(design_inputs),
    }


def main() -> int:
    import argparse

    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--run-root", type=Path, required=True)
    parser.add_argument("--designs", nargs="+", required=True)
    args = parser.parse_args()
    report = assemble_baseline_design_statistics(args.run_root, args.designs)
    out_path = args.run_root.resolve() / "baseline-design-statistics.v1.json"
    out_path.write_text(
        json.dumps(report, indent=2, sort_keys=True, default=str) + "\n",
        encoding="utf-8",
    )
    methods = report["statistics"]["methods"]
    print(
        f"[baseline-statistics] {len(args.designs)} designs x "
        f"{len(methods)} methods -> {out_path.name}"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
