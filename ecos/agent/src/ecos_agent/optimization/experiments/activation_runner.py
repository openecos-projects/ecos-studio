"""Real-candidate execution path behind ``run_activation``.

``knowledge_activation.run_activation`` takes any ``candidate_runner`` callable;
until now only test stubs existed (计划书 §2.2-7).  This module binds that
contract to the native ECC candidate-rerun chain — the same adapter, receipt,
and terminal-observation machinery the closed-loop runner uses — so one
activation row executes as a single probe candidate from the parent checkpoint
(never promoted into an episode incumbent) and returns the evidence links the
mediation row requires: actual_value, receipt_status,
terminal_observation_hash, terminal_delta, promotion_decision.
"""

from __future__ import annotations

import threading
from pathlib import Path
from typing import Any, Callable, Mapping

from ecos_agent.hashing import canonical_sha256
from ecos_agent.optimization.contracts import (
    ROUTABILITY_OBJECTIVE_ORDER,
    TIMING_GUARDRAIL_ORDER,
    ExpectedEffect,
    ObjectiveMetric,
    ObservationReference,
    OptimizationDecision,
    OptimizationKnob,
    OptimizationProposal,
    ProposalAction,
    ProposalContextRef,
    ProposalReason,
    RequestedKnobValue,
    StrategyDirection,
    TerminalObservation,
)
from ecos_agent.optimization.execution import CandidateExecutionRequest
from ecos_agent.optimization.experiments.statistics import compare_observations
from ecos_agent.optimization.observations import (
    build_candidate_terminal_observation,
    build_terminal_observation,
)

_PROMOTION_COMPARISON_LABELS = frozenset(
    {"better", "worse", "noise_tie", "timing_regression", "candidate_ineligible"}
)


def parse_activation_action(
    row: Mapping[str, Any],
) -> tuple[OptimizationKnob, StrategyDirection, bool | int | float]:
    """Decode an offline bank row into the native knob action triple."""
    try:
        knob = OptimizationKnob(str(row["knob"]))
        direction = StrategyDirection(str(row["direction"]))
    except ValueError as exc:
        raise ValueError(f"activation row action is not executable: {exc}") from exc
    value = row.get("requested_value")
    if not isinstance(value, (bool, int, float)):
        raise ValueError("activation row requested_value is not a knob value")
    return knob, direction, value


def build_activation_request(
    row: Mapping[str, Any],
    *,
    episode_id: str,
    checkpoint_id: str,
    parent_checkpoint: str,
    objective_metric: ObjectiveMetric,
    seed: int,
    ecc_revision: str | None,
) -> CandidateExecutionRequest:
    """One probe candidate from the parent checkpoint, mirroring the
    seven-knob acceptance request contract (same proposal schema, receipt
    gate, and Harden endpoint as episode candidates)."""
    knob, direction, value = parse_activation_action(row)
    proposal_key = {"knob": knob.value, "direction": direction.value, "value": value}
    return CandidateExecutionRequest(
        intervention_id=f"activation-{canonical_sha256(proposal_key)[:12]}",
        episode_id=episode_id,
        checkpoint_id=checkpoint_id,
        proposal=OptimizationProposal(
            context_ref=ProposalContextRef(
                episode_id=episode_id,
                checkpoint_id=checkpoint_id,
                input_sha256=canonical_sha256(
                    {"parent_checkpoint": parent_checkpoint, **proposal_key}
                ),
            ),
            decision=OptimizationDecision.PROPOSE,
            reason_code=ProposalReason.OBSERVATION,
            rationale_summary=(
                f"knowledge activation probe: claim-bound {knob.value} "
                f"{direction.value}"
            ),
            observation_refs=(
                ObservationReference(
                    observation_id="observation-parent",
                    sha256=str(row.get("context_fingerprint")),
                ),
            ),
            action=ProposalAction(
                knob_id=knob,
                direction=direction,
                expected_effects=(
                    ExpectedEffect(
                        metric_id=objective_metric,
                        direction="unknown",
                    ),
                ),
            ),
        ),
        requested=RequestedKnobValue(knob_id=knob, value=value),
        context_sha256=canonical_sha256(
            {
                "activation": row.get("claim_id"),
                "binding": row.get("binding_sha256"),
                **proposal_key,
            }
        ),
        seed=seed,
        ecc_revision=ecc_revision,
        parent_candidate_root_ref=None,
    )


def _parent_reference_metrics(
    parent: TerminalObservation,
) -> dict[str, float]:
    return {
        **{
            metric.value: float(parent.metrics[metric])
            for metric in ROUTABILITY_OBJECTIVE_ORDER
        },
        **{
            metric.value: float(parent.timing_guardrail[metric])
            for metric in TIMING_GUARDRAIL_ORDER
        },
    }


def evaluate_activation_outcome(
    *,
    parent_observation: TerminalObservation,
    candidate_observation: TerminalObservation | None,
    native_receipt: Any,
    objective_metric: ObjectiveMetric,
    noise_epsilon: Mapping[str, float],
) -> dict[str, Any]:
    """Fill the ``run_activation`` result links from one executed probe.

    ``promotion_decision`` reuses the receipt-aware better-than-default rule:
    a probe is promotion-eligible only with an effective receipt and a
    non-regressing improvement beyond epsilon on some routability objective;
    otherwise the comparison label is recorded verbatim.
    """
    actual_value = getattr(native_receipt, "actual_value", None)
    receipt_status = getattr(native_receipt, "status", None)
    terminal_delta = None
    terminal_hash = None
    promotion_decision = None
    if candidate_observation is not None:
        terminal_hash = candidate_observation.evidence_manifest_sha256
        parent_value = float(parent_observation.metrics[objective_metric])
        candidate_value = float(candidate_observation.metrics[objective_metric])
        terminal_delta = candidate_value - parent_value
        comparison = compare_observations(
            _parent_reference_metrics(parent_observation),
            candidate_observation,
            dict(noise_epsilon),
        )
        if comparison == "better" and receipt_status == "effective":
            promotion_decision = "promote"
        elif comparison in _PROMOTION_COMPARISON_LABELS:
            promotion_decision = comparison
    return {
        "actual_value": actual_value,
        "receipt_status": receipt_status,
        "terminal_observation_hash": terminal_hash,
        "terminal_delta": terminal_delta,
        "promotion_decision": promotion_decision,
    }


def ecc_activation_candidate_runner(
    workspace: Path,
    *,
    objective_metric: ObjectiveMetric,
    noise_epsilon: Mapping[str, float],
    timeout_seconds: float = 1800.0,
    episode_id: str = "knowledge-activation",
    adapter_factory: Callable[..., Any] | None = None,
    rpc_factory: Callable[[], Any] | None = None,
) -> Callable[..., dict[str, Any]]:
    """Build the ``candidate_runner`` callable for ``run_activation``.

    The parent terminal observation is captured once at factory time: the
    parent checkpoint is never mutated by activation probes, so every probe
    shares one hash-bound reference.  ``adapter_factory``/``rpc_factory`` are
    injection seams for tests; production uses the native ECC client and
    adapter.
    """
    from ecos_agent.optimization.ecc.adapter import EccCandidateRerunAdapter
    from ecos_agent.optimization.ecc.rpc_client import EccContentLengthRpcClient
    from ecos_agent.optimization.runtime import _ecc_executable, _site_width_dbu
    from ecos_agent.optimization.runtime_waiting import _wait_for_terminal_receipt

    workspace = workspace.resolve()
    parent_observation = build_terminal_observation(workspace)
    if not noise_epsilon:
        raise ValueError("activation requires the frozen noise epsilon map")

    def run(
        *, design_id: str, parent_checkpoint: str, row: Mapping[str, Any]
    ) -> dict[str, Any]:
        del design_id  # the workspace binding already pins the design
        rpc = (
            rpc_factory()
            if rpc_factory is not None
            else EccContentLengthRpcClient(_ecc_executable())
        )
        try:
            if adapter_factory is not None:
                adapter = adapter_factory(
                    rpc,
                    workspace_root=workspace,
                )
            else:
                adapter = EccCandidateRerunAdapter(
                    rpc,
                    workspace_id=rpc.open_workspace(workspace),
                    site_width_dbu=_site_width_dbu(workspace),
                    workspace_root=workspace,
                )
            ecc_revision = adapter.ecc_revision()
            proposal_key = canonical_sha256(
                {"knob": row.get("knob"), "value": row.get("requested_value")}
            )
            request = build_activation_request(
                row,
                episode_id=episode_id,
                checkpoint_id=parent_checkpoint,
                parent_checkpoint=parent_checkpoint,
                objective_metric=objective_metric,
                seed=2900 + int(proposal_key[7:15], 16) % 100000,
                ecc_revision=ecc_revision,
            )
            started = adapter.start(request)
            receipt = _wait_for_terminal_receipt(
                adapter,
                started.execution_id,
                timeout_seconds=timeout_seconds,
                stop_event=threading.Event(),
            )
            native = receipt.parameter_application_receipt
            candidate_observation = None
            if receipt.evidence is not None:
                candidate_observation = build_candidate_terminal_observation(
                    workspace, receipt.evidence
                )
            return evaluate_activation_outcome(
                parent_observation=parent_observation,
                candidate_observation=candidate_observation,
                native_receipt=native,
                objective_metric=objective_metric,
                noise_epsilon=noise_epsilon,
            )
        finally:
            rpc.close()

    return run
