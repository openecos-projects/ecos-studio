"""Run the seven-knob joint acceptance as seven independent single candidates.

Each target knob is dispatched exactly once from the current workspace
checkpoint (never promoted), so every candidate's parent state equals the
shared checkpoint and the acceptance replay anchors stay valid.  This is the
execution half of ``seven-parameter-acceptance-plan.md``; pair it with
``scripts/build_parameter_acceptance.py`` for the hash-bound index.

Requires the ECC runtime environment (CHIPCOMPILER_ECC_SIZER_ROOT,
ECOS_AGENT_ECC_RPC_BIN).
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path

from ecos_agent.hashing import canonical_sha256
from ecos_agent.optimization.contracts import (
    ExpectedEffect,
    ObjectiveMetric,
    ObservationReference,
    OptimizationDecision,
    OptimizationKnob,
    ProposalAction,
    ProposalContextRef,
    ProposalReason,
    RequestedKnobValue,
    StrategyDirection,
    OptimizationProposal,
)
from ecos_agent.optimization.execution import CandidateExecutionRequest
from ecos_agent.optimization.ecc.adapter import EccCandidateRerunAdapter
from ecos_agent.optimization.ecc.rpc_client import EccContentLengthRpcClient
from ecos_agent.optimization.runtime import (
    _ecc_executable,
    _site_width_dbu,
)
from ecos_agent.optimization.runtime_waiting import _wait_for_terminal_receipt
import threading

# One representative direction per knob from the coordinate lattice.
_SEVEN_KNOBS: tuple[tuple[str, StrategyDirection, bool | int | float], ...] = (
    ("floorplan.core_util", StrategyDirection.DECREASE, 0.25),
    ("floorplan.aspect_ratio", StrategyDirection.DECREASE, 0.67),
    ("place.target_density", StrategyDirection.DECREASE, 0.3),
    ("place.target_overflow", StrategyDirection.DECREASE, 0.06),
    ("place.cell_padding_x", StrategyDirection.DECREASE, 1),
    ("place.routability_opt", StrategyDirection.DISABLE, False),
    ("place.density_weight", StrategyDirection.DECREASE, 0.0005),
)


def run_seven_knob_acceptance(
    workspace: Path,
    *,
    episode_id: str = "accept-seven-knob",
    timeout_seconds: float = 1800.0,
) -> dict[str, object]:
    site_width_dbu = _site_width_dbu(workspace)
    rpc = EccContentLengthRpcClient(_ecc_executable())
    try:
        adapter = EccCandidateRerunAdapter(
            rpc,
            workspace_id=rpc.open_workspace(workspace),
            site_width_dbu=site_width_dbu,
            workspace_root=workspace,
        )
        ecc_revision = adapter.ecc_revision()
        stop_event = threading.Event()
        results: dict[str, object] = {}
        for index, (knob_id, direction, value) in enumerate(_SEVEN_KNOBS, 1):
            intervention_id = f"accept-{index}"
            knob = OptimizationKnob(knob_id)
            request = CandidateExecutionRequest(
                intervention_id=intervention_id,
                episode_id=episode_id,
                checkpoint_id="place",
                proposal=OptimizationProposal(
                    context_ref=ProposalContextRef(
                        episode_id=episode_id,
                        checkpoint_id="place",
                        input_sha256=canonical_sha256(
                            {"knob": knob_id, "value": value}
                        ),
                    ),
                    decision=OptimizationDecision.PROPOSE,
                    reason_code=ProposalReason.OBSERVATION,
                    rationale_summary=f"seven-knob acceptance probe: {knob_id}",
                    observation_refs=(
                        ObservationReference(
                            observation_id="observation-place",
                            sha256=canonical_sha256({"knob": knob_id}),
                        ),
                    ),
                    action=ProposalAction(
                        knob_id=knob,
                        direction=direction,
                        expected_effects=(
                            ExpectedEffect(
                                metric_id=ObjectiveMetric.ROUTE_WIRELENGTH,
                                direction="unknown",
                            ),
                        ),
                    ),
                ),
                requested=RequestedKnobValue(knob_id=knob, value=value),
                context_sha256=canonical_sha256(
                    {"acceptance": knob_id, "value": value}
                ),
                seed=3000 + index,
                ecc_revision=ecc_revision,
                parent_candidate_root_ref=None,
            )
            started = adapter.start(request)
            receipt = _wait_for_terminal_receipt(
                adapter,
                started.execution_id,
                timeout_seconds=timeout_seconds,
                stop_event=stop_event,
            )
            native = receipt.parameter_application_receipt
            results[knob_id] = {
                "intervention_id": intervention_id,
                "candidate_root_ref": (
                    receipt.evidence.candidate_root_ref
                    if receipt.evidence is not None
                    else None
                ),
                "outcome": (
                    receipt.outcome.value if receipt.outcome is not None else None
                ),
                "receipt_status": (
                    native.status if native is not None else None
                ),
                "actual_value": native.actual_value if native is not None else None,
            }
        return results
    finally:
        rpc.close()


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--workspace", type=Path, required=True)
    parser.add_argument("--episode-id", default="accept-seven-knob")
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    results = run_seven_knob_acceptance(args.workspace.resolve())
    args.output.write_text(
        json.dumps(results, indent=2, sort_keys=True) + "\n", encoding="utf-8"
    )
    for knob_id, item in sorted(results.items()):
        print(knob_id, item["receipt_status"], item["outcome"])
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
