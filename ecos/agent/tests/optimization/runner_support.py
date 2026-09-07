from __future__ import annotations

import json
import threading
from pathlib import Path

import pytest
from tests.optimization.support import support_catalog

from ecos_agent.hashing import canonical_sha256
from ecos_agent.optimization.contracts import (
    BudgetSnapshot,
    EpisodeBudget,
    ExpectedEffectDirection,
    GateResult,
    KnowledgeReference,
    ObjectiveMetric,
    OptimizationDecision,
    OptimizationEpisodeState,
    OptimizationKnob,
    ProposalReason,
    SignoffGates,
    StageObservation,
    StrategyDirection,
    TerminalObservation,
    TimingMetric,
)
from ecos_agent.optimization.controller import (
    CandidateExecutionEvidence,
    CandidateExecutionReceipt,
    OptimizationAgentMode,
    OptimizationEpisodeController,
    OptimizationPlanningContext,
)
from ecos_agent.optimization.experiments.equal_budget import export_episode_traces
from ecos_agent.optimization.ledger import (
    OptimizationLedger,
    OptimizationOutcomeKind,
    OptimizationPlanningAudit,
    OptimizationPlanningAuditIntegrityError,
)
from ecos_agent.optimization.knowledge.cases import EmpiricalCaseAuditIntegrityError
from ecos_agent.optimization.metrics.contracts import (
    EvaluationMetricCategory,
    EvaluationMetricDirection,
    EvaluationMetricRole,
    TerminalEvaluationMetric,
)
from ecos_agent.optimization.knowledge.retrieval import (
    KnowledgeChannel,
    KnowledgeChannelResult,
    OptimizationRetrievalRequest,
    OptimizationRetrievalResult,
)
from ecos_agent.optimization.rules import (
    IncumbentDecision,
    coordinate_value_from_native_receipt,
    freeze_routability_objective,
    native_receipt_is_effective,
)
from ecos_agent.optimization.runner import OptimizationEpisodeRunner
from ecos_agent.optimization.parameters.contracts import (
    MaterializationRef,
    ParameterApplicationReceipt,
)
from ecos_agent.optimization.parameters.semantics import card_hash, load_parameter_cards

_HASH = "sha256:" + "a" * 64
_CHUNK_HASH = "b" * 64
_CURRENT_VALUES = {
    "place.target_density": 0.2,
    "place.target_overflow": 0.1,
    "place.cell_padding_x": 2,
    "place.routability_opt": True,
    "place.density_weight": 0.00085,
    "floorplan.core_util": 0.6,
    "floorplan.aspect_ratio": 1.0,
}
_TIMING_GUARDRAIL = {metric: 0.0 for metric in TimingMetric}


def _execution_context() -> dict[str, object]:
    return {
        "design_sha256": _HASH,
        "rtl_sha256": _HASH,
        "filelist_sha256": _HASH,
        "sdc_sha256": _HASH,
        "pdk_sha256": _HASH,
        "parent_lineage_sha256": _HASH,
        "parent_manifest_sha256": _HASH,
        "ecc_revision": "0.1.0-alpha.11",
        "site_width_dbu": 200,
        "seed": 0,
    }


def _objective():
    return freeze_routability_objective(_incumbent())


class _Clock:
    def __call__(self) -> float:
        return 0.0


class _FakePlanner:
    optimization_proposal_v2_enabled = False

    def __init__(self) -> None:
        self.contexts: list[OptimizationPlanningContext] = []

    def propose(self, context: OptimizationPlanningContext) -> object:
        self.contexts.append(context)
        if not context.history:
            return _proposal(
                context, "place.cell_padding_x", StrategyDirection.INCREASE
            )
        assert len(context.history) == 1
        assert context.history[0].outcome == OptimizationOutcomeKind.DEGRADED
        return _proposal(
            context,
            "place.target_density",
            StrategyDirection.DECREASE,
            history_refs=[context.history[0].reference.model_dump()],
        )


class _FakeExecutor:
    def __init__(self) -> None:
        self.requests: list[object] = []
        self.start_receipts = iter(
            (
                CandidateExecutionReceipt(execution_id="execution-1", started=True),
                CandidateExecutionReceipt(execution_id="execution-2", started=True),
            )
        )
        self.terminal_receipts = iter(
            (
                CandidateExecutionReceipt(
                    execution_id="execution-1",
                    started=True,
                    outcome=OptimizationOutcomeKind.DEGRADED,
                    evidence=_evidence("execution-1"),
                    parameter_application_receipt=_native_receipt(
                        "place.cell_padding_x", 3
                    ),
                ),
                CandidateExecutionReceipt(
                    execution_id="execution-2",
                    started=True,
                    outcome=OptimizationOutcomeKind.EXECUTION_SUCCEEDED,
                    evidence=_evidence("execution-2"),
                    parameter_application_receipt=_native_receipt(
                        "place.target_density", 0.15, effective_value=0.8
                    ),
                ),
            )
        )

    def start(self, request: object) -> CandidateExecutionReceipt:
        self.requests.append(request)
        return next(self.start_receipts)

    def wait_for_terminal(self, execution_id: str) -> CandidateExecutionReceipt:
        receipt = next(self.terminal_receipts)
        assert receipt.execution_id == execution_id
        return receipt

    def cancel(self, intervention_id: str) -> CandidateExecutionReceipt:
        raise AssertionError("the fake runner never cancels a terminal receipt")


class _MissingTerminalExecutor(_FakeExecutor):
    def __init__(self) -> None:
        super().__init__()
        self.start_receipts = iter(
            (CandidateExecutionReceipt(execution_id="execution-1", started=True),)
        )
        self.terminal_receipts = iter(
            (CandidateExecutionReceipt(execution_id="execution-1", started=True),)
        )


class _RaisingTerminalExecutor(_FakeExecutor):
    def wait_for_terminal(self, _execution_id: str) -> CandidateExecutionReceipt:
        raise RuntimeError("terminal wait failed")


class _SuccessfulExecutor(_FakeExecutor):
    def __init__(self) -> None:
        self.requests: list[object] = []
        self.start_receipts = iter(
            (CandidateExecutionReceipt(execution_id="execution-1", started=True),)
        )
        self.terminal_receipts = iter(
            (
                CandidateExecutionReceipt(
                    execution_id="execution-1",
                    started=True,
                    outcome=OptimizationOutcomeKind.EXECUTION_SUCCEEDED,
                    evidence=_evidence("execution-1"),
                    parameter_application_receipt=_native_receipt(
                        "place.cell_padding_x", 3
                    ),
                ),
            )
        )


class _ImmediateSuccessfulExecutor(_SuccessfulExecutor):
    def __init__(self) -> None:
        super().__init__()
        self.start_receipts = iter(
            (
                CandidateExecutionReceipt(
                    execution_id="execution-1",
                    started=True,
                    outcome=OptimizationOutcomeKind.EXECUTION_SUCCEEDED,
                ),
            )
        )


class _RoutabilityFalseExecutor(_SuccessfulExecutor):
    def __init__(self) -> None:
        super().__init__()
        self.terminal_receipts = iter(
            (
                CandidateExecutionReceipt(
                    execution_id="execution-1",
                    started=True,
                    outcome=OptimizationOutcomeKind.EXECUTION_SUCCEEDED,
                    evidence=_evidence("execution-1"),
                    parameter_application_receipt=_native_receipt(
                        "place.routability_opt",
                        False,
                        status="effective",
                    ),
                ),
            )
        )


def _evidence(execution_id: str) -> CandidateExecutionEvidence:
    return CandidateExecutionEvidence(
        candidate_root_ref=f".agent/candidates/{execution_id}",
        candidate_manifest_ref=(
            f".agent/candidates/{execution_id}/analysis/candidate_workspace.v1.json"
        ),
        candidate_manifest_sha256=_HASH,
    )


def _native_receipt(
    knob_id: str,
    value: object,
    *,
    effective_value: object | None = None,
    status: str = "effective",
) -> ParameterApplicationReceipt:
    effective_value = value if effective_value is None else effective_value
    card = load_parameter_cards()[OptimizationKnob(knob_id)]
    unit = card.surface.unit
    observation = {
        "place.target_density": {
            "target_density": effective_value,
            "density_tensor_value": effective_value,
            "density_operator_call_count": 1,
            "utilization_floor": None,
        },
        "place.target_overflow": {
            "stop_overflow": effective_value,
            "final_overflow": 0.08,
        },
        "place.cell_padding_x": {
            "padding_sites": effective_value,
            "geometry_apply_count": 1,
        },
        "place.routability_opt": {
            "configured_routability_opt": value,
            "branch_round_count": 1 if value is True and status == "effective" else 0,
            "placement_completed": True,
            "place_object_count": 1,
        },
        "place.density_weight": {
            "configured_density_weight": value,
            "initialization_count": 1,
        },
    }[knob_id]
    payload = {
        "receipt_id": f"parameter-receipt-{knob_id.replace('.', '-')}-{value}",
        "tool": card.tool,
        "context": {
            "stage": "place",
            "parameter_card_sha256": card_hash(
                load_parameter_cards()[OptimizationKnob(knob_id)]
            ),
        },
        "requested": {"knob_id": knob_id, "value": value, "unit": unit},
        "materialization": MaterializationRef(
            receipt_ref="analysis/candidate_materialization.v1.json",
            receipt_sha256=_HASH,
            registry_sha256=_HASH,
            patch_sha256=_HASH,
            candidate_ref="candidate-1",
            workspace_ref="candidate-1",
            config_before_sha256=_HASH,
            config_after_sha256="sha256:" + "b" * 64,
            written_value=value * 200 if unit == "site" else value,
            unit="dbu" if unit == "site" else unit,
        ),
        "actual_value": effective_value if status == "effective" else None,
        "status": status,
        "reason": None if status == "effective" else "Parameter did not take effect",
        "observation": observation,
    }
    draft = ParameterApplicationReceipt.model_construct(
        **payload, evidence_sha256=_HASH
    )
    return ParameterApplicationReceipt(
        **payload,
        evidence_sha256=canonical_sha256(
            draft.model_dump(mode="json", exclude={"evidence_sha256"})
        ),
    )


def _budget() -> BudgetSnapshot:
    return BudgetSnapshot(budget=EpisodeBudget.from_reference_rerun(11.0))


def _proposal(
    context: OptimizationPlanningContext,
    knob_id: str,
    direction: StrategyDirection,
    *,
    history_refs: list[dict[str, str]] | None = None,
) -> dict[str, object]:
    return {
        "context_ref": context.context_ref.model_dump(),
        "decision": OptimizationDecision.PROPOSE,
        "reason_code": ProposalReason.OBSERVATION,
        "rationale_summary": "Use the next bounded congestion strategy.",
        "observation_refs": [context.observation_ref.model_dump()],
        "history_refs": history_refs or [],
        "knowledge_refs": [
            reference.model_dump() for reference in context.knowledge_refs
        ],
        "action": {
            "knob_id": knob_id,
            "direction": direction,
            "expected_effects": [
                {
                    "metric_id": ObjectiveMetric.ROUTE_LA_TOTAL_OVERFLOW,
                    "direction": ExpectedEffectDirection.DECREASE,
                }
            ],
        },
    }


def _observation(budget: BudgetSnapshot) -> StageObservation:
    return StageObservation(
        observation_id=f"observation-{budget.consumed_candidates + 1}",
        stage="place",
        evidence_manifest_sha256=_HASH,
        metrics={"place_lutrudy_utilization_max": 0.88},
        budget=budget,
    )


def _retrieval(
    observation: StageObservation,
    previous_outcome: OptimizationOutcomeKind | None,
) -> OptimizationRetrievalResult:
    reference = KnowledgeReference(
        entity_id="strategy.congestion.padding.v1", chunk_sha256=_CHUNK_HASH
    )
    request = OptimizationRetrievalRequest(
        task_id="task-1",
        current_stage=observation.stage,
        observed_metric_ids=tuple(sorted(observation.metrics)),
        previous_intervention_outcome=previous_outcome,
    )
    channel = KnowledgeChannelResult(
        channel=KnowledgeChannel.GENERAL,
        enabled=True,
        query="fixed query",
        query_sha256="c" * 64,
        corpus_sha256="d" * 64,
        answer_text="Audited congestion strategy.",
        knowledge_refs=(reference,),
    )
    return OptimizationRetrievalResult(
        request, (channel,), (reference,), support_catalog(reference)
    )


def _terminal_observation(
    observation: StageObservation, receipt: CandidateExecutionReceipt
) -> TerminalObservation:
    assert observation.stage == "place"
    eligibility = tuple(
        TerminalEvaluationMetric(
            metric_id=metric_id,
            value=0.0
            if metric_id
            not in {
                "rcx_expected_corner_count",
                "rcx_spef_file_count",
                "sta_expected_corner_count",
                "sta_corner_count",
            }
            else 1.0,
            unit="count",
            category=EvaluationMetricCategory.ELIGIBILITY,
            role=EvaluationMetricRole.GATE,
            direction=EvaluationMetricDirection.EXACT,
            source_refs=("analysis/terminal.json",),
        )
        for metric_id in (
            "drc_count",
            "lvs_count",
            "rcx_expected_corner_count",
            "rcx_spef_file_count",
            "rcx_missing_corner_count",
            "rcx_spef_parse_failure_count",
            "sta_corner_count",
            "sta_expected_corner_count",
            "sta_missing_corner_count",
            "sta_setup_violation_count",
            "sta_hold_violation_count",
            "harden_artifact_missing_count",
        )
    )
    return TerminalObservation(
        schema_version="ecos.terminal_observation.v3",
        observation_id=f"terminal-{receipt.execution_id}",
        evidence_manifest_sha256="sha256:" + receipt.execution_id[-1] * 64,
        evidence_valid=True,
        harden_artifacts_complete=True,
        signoff_gates=SignoffGates.all(GateResult.PASS),
        metrics={
            ObjectiveMetric.ROUTE_DR_TOTAL_VIOLATION_COUNT: 2.0,
            ObjectiveMetric.ROUTE_LA_TOTAL_OVERFLOW: 3.0,
            ObjectiveMetric.ROUTE_WIRELENGTH: 4.0,
        },
        timing_guardrail=_TIMING_GUARDRAIL,
        evaluation_metrics=eligibility,
        evaluation_metrics_complete=True,
        sta_corner_ids=("analysis/sta/typical",),
        sta_corner_set_sha256=canonical_sha256({"corners": ["analysis/sta/typical"]}),
    )


def _incumbent() -> TerminalObservation:
    return TerminalObservation(
        observation_id="terminal-baseline",
        evidence_manifest_sha256=_HASH,
        evidence_valid=True,
        harden_artifacts_complete=True,
        signoff_gates=SignoffGates.all(GateResult.PASS),
        metrics={
            ObjectiveMetric.ROUTE_DR_TOTAL_VIOLATION_COUNT: 5.0,
            ObjectiveMetric.ROUTE_LA_TOTAL_OVERFLOW: 5.0,
            ObjectiveMetric.ROUTE_WIRELENGTH: 5.0,
        },
        timing_guardrail=_TIMING_GUARDRAIL,
    )


class _RoutabilityPlanner(_FakePlanner):
    def propose(self, context: OptimizationPlanningContext) -> object:
        self.contexts.append(context)
        return _proposal(context, "place.routability_opt", StrategyDirection.DISABLE)
