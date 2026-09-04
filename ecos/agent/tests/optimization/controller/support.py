from __future__ import annotations

from pathlib import Path

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
    OptimizationObjectiveContract,
    OptimizationObjectiveProposal,
    PlanningProviderEnvelope,
    PlanningProviderEvidence,
    ProposalReason,
    RequestedKnobValue,
    SignoffGates,
    StageObservation,
    StrategyDirection,
    TerminalObservation,
    TimingMetric,
)
from ecos_agent.optimization.controller import (
    CandidateExecutionReceipt,
    OptimizationAgentMode,
    OptimizationEpisodeController,
    planning_context_payload,
)
from ecos_agent.optimization.parameters.effective_domain import build_context_fingerprint
from ecos_agent.optimization.ledger import (
    OptimizationLedger,
    OptimizationOutcomeKind,
)
from ecos_agent.optimization.memory import (
    OptimizationTaskMemoryStore,
    build_task_memory_scope,
)
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
from ecos_agent.optimization.rules import freeze_optimization_objective
from ecos_agent.optimization.parameters.contracts import (
    ActivationEvidence,
    EffectiveValue,
    MaterializationRef,
    ParameterApplicationReceipt,
    RuntimeTransition,
)
from ecos_agent.optimization.parameters.semantics import card_hash, load_parameter_cards

HASH = "sha256:" + "a" * 64
CHUNK_HASH = "b" * 64
CURRENT_VALUES = {
    "place.target_density": 0.2,
    "place.target_overflow": 0.1,
    "place.cell_padding_x": 2,
    "place.routability_opt": True,
    "place.density_weight": 0.00085,
    "floorplan.core_util": 0.6,
    "floorplan.aspect_ratio": 1.0,
    "cts.max_fanout": 32,
}


def _execution_context() -> dict[str, object]:
    return {
        "design_sha256": HASH,
        "rtl_sha256": HASH,
        "filelist_sha256": HASH,
        "sdc_sha256": HASH,
        "pdk_sha256": HASH,
        "parent_lineage_sha256": HASH,
        "parent_manifest_sha256": HASH,
        "ecc_revision": "0.1.0-alpha.11",
        "site_width_dbu": 200,
        "seed": 0,
    }


class _Clock:
    def __init__(self) -> None:
        self.now = 0.0

    def __call__(self) -> float:
        return self.now


class _FakeCodex:
    optimization_proposal_v2_enabled = False

    def __init__(self, *responses: object) -> None:
        self.responses = list(responses)
        self.contexts = []

    def propose(self, context: object) -> object:
        self.contexts.append(context)
        response = self.responses.pop(0)
        if isinstance(response, BaseException):
            raise response
        if callable(response):
            return response(context)
        return response


class _AuditedFakeCodex(_FakeCodex):
    def consume_planning_evidence(self) -> PlanningProviderEvidence | None:
        payload = {
            "schema_version": "ecos.optimization_planning_provider_envelope.v1",
            "provider_id": "codex_app_server",
            "requested_model": "test-model",
            "prompt": "bounded test prompt",
            "output_schema": {"type": "object"},
            "planner_payload_sha256": canonical_sha256(
                planning_context_payload(self.contexts[-1])
            ),
        }
        return PlanningProviderEvidence(
            provider_id="codex_app_server",
            thread_id="thread-1",
            turn_id=f"turn-{len(self.contexts)}",
            response_sha256=HASH,
            diagnostics_sha256=HASH,
            envelope=PlanningProviderEnvelope(
                **payload, envelope_sha256=canonical_sha256(payload)
            ),
        )


class _FakeEcc:
    def __init__(
        self,
        *start_receipts: CandidateExecutionReceipt,
        cancel_receipt: CandidateExecutionReceipt | None = None,
    ) -> None:
        self.start_receipts = list(start_receipts)
        self.cancel_receipt = cancel_receipt
        self.start_calls = []
        self.cancel_calls = []

    def start(self, request: object) -> CandidateExecutionReceipt:
        self.start_calls.append(request)
        return self.start_receipts.pop(0)

    def cancel(self, intervention_id: str) -> CandidateExecutionReceipt:
        self.cancel_calls.append(intervention_id)
        assert self.cancel_receipt is not None
        return self.cancel_receipt


def _budget(*, candidates: int = 0, planning: int = 0) -> BudgetSnapshot:
    return BudgetSnapshot(
        budget=EpisodeBudget.from_reference_rerun(11.0),
        consumed_candidates=candidates,
        consumed_planning_calls=planning,
    )


def _objective() -> OptimizationObjectiveContract:
    return freeze_optimization_objective(
        "Minimize route wirelength while preserving DRC and congestion.",
        OptimizationObjectiveProposal(
            primary_metric=ObjectiveMetric.ROUTE_WIRELENGTH,
            preserve_metrics=(
                ObjectiveMetric.ROUTE_DR_TOTAL_VIOLATION_COUNT,
                ObjectiveMetric.ROUTE_LA_TOTAL_OVERFLOW,
            ),
            rationale_summary="Wirelength is primary; routing quality remains constrained.",
        ),
    )


def _observation() -> StageObservation:
    return StageObservation(
        observation_id="observation-place",
        stage="place",
        evidence_manifest_sha256=HASH,
        metrics={"place_lutrudy_utilization_max": 0.88},
        budget=_budget(),
    )


def _retrieval() -> OptimizationRetrievalResult:
    reference = KnowledgeReference(
        entity_id="strategy.congestion.padding.v1", chunk_sha256=CHUNK_HASH
    )
    request = OptimizationRetrievalRequest(
        task_id="task-1",
        current_stage="place",
        observed_metric_ids=("place_lutrudy_utilization_max",),
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
        request=request,
        channels=(channel,),
        knowledge_refs=(reference,),
        support_catalog=support_catalog(reference),
    )


def _proposal(
    context: object,
    *,
    knowledge_refs: list[dict[str, str]] | None = None,
    context_ref: dict[str, str] | None = None,
    observation_refs: list[dict[str, str]] | None = None,
    task_memory_refs: list[dict[str, str]] | None = None,
    knob_id: str = "place.cell_padding_x",
    direction: StrategyDirection = StrategyDirection.INCREASE,
) -> dict[str, object]:
    expected_context = getattr(context, "context_ref")
    expected_observation = getattr(context, "observation_ref")
    expected_knowledge = getattr(context, "knowledge_refs")
    return {
        "context_ref": context_ref or expected_context.model_dump(),
        "decision": OptimizationDecision.PROPOSE,
        "reason_code": ProposalReason.OBSERVATION,
        "rationale_summary": "Placement congestion remains high.",
        "observation_refs": observation_refs or [expected_observation.model_dump()],
        "history_refs": [],
        "knowledge_refs": (
            knowledge_refs
            if knowledge_refs is not None
            else [reference.model_dump() for reference in expected_knowledge]
        ),
        "task_memory_refs": task_memory_refs or [],
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


def _controller(
    tmp_path: Path,
    codex: _FakeCodex,
    ecc: _FakeEcc,
    *,
    mode: OptimizationAgentMode = OptimizationAgentMode.FULL_AGENT,
    budget: BudgetSnapshot | None = None,
    clock: _Clock | None = None,
    incumbent: TerminalObservation | None = None,
    objective: OptimizationObjectiveContract | None = None,
    objective_alignment=None,
    task_memory=None,
    receipt_aware_planning: bool = True,
    knowledge_case_shots: int = 0,
    knowledge_case_pool_root: Path | None = None,
) -> OptimizationEpisodeController:
    return OptimizationEpisodeController(
        episode_id="episode-1",
        checkpoint_id="checkpoint-1",
        mode=mode,
        budget=budget or _budget(),
        planner=codex,
        executor=ecc,
        ledger=OptimizationLedger(tmp_path / "episode"),
        clock=clock or _Clock(),
        incumbent=incumbent,
        objective=objective,
        objective_alignment=objective_alignment,
        task_memory_scope_sha256=(
            task_memory.scope.scope_sha256 if task_memory is not None else None
        ),
        task_memory_supplier=(lambda: task_memory) if task_memory is not None else None,
        execution_context=_execution_context(),
        receipt_aware_planning=receipt_aware_planning,
        knowledge_case_shots=knowledge_case_shots,
        knowledge_case_pool_root=knowledge_case_pool_root,
    )


def _started(execution_id: str = "execution-1") -> CandidateExecutionReceipt:
    return CandidateExecutionReceipt(execution_id=execution_id, started=True)


def _terminal(
    outcome: OptimizationOutcomeKind,
    execution_id: str = "execution-1",
) -> CandidateExecutionReceipt:
    return CandidateExecutionReceipt(
        execution_id=execution_id, started=True, outcome=outcome
    )


def _native_receipt(
    requested: RequestedKnobValue, *, effective_value: object | None = None
) -> ParameterApplicationReceipt:
    card = load_parameter_cards()[requested.knob_id]
    effective_value = requested.value if effective_value is None else effective_value
    is_padding = requested.knob_id.value == "place.cell_padding_x"
    unit = "site" if is_padding else "ratio"
    consumer_id = (
        "dreamplace.cell_size_expansion"
        if is_padding
        else "dreamplace.density_objective"
    )
    consumer_observation = (
        {
            "requested_padding_site": requested.value,
            "effective_padding_dbu": effective_value,
            "movable_node_count": 12,
            "placement_iteration_count": 4,
            "evidence_complete": True,
        }
        if is_padding
        else {
            "requested_target_density": requested.value,
            "effective_target_density": effective_value,
            "density_tensor_value": effective_value,
            "placement_iteration_count": 4,
            "evidence_complete": True,
        }
    )
    transitions = ()
    if (
        requested.knob_id.value == "place.target_density"
        and effective_value != requested.value
    ):
        transitions = (
            RuntimeTransition(
                sequence=0,
                **{"from": "materialized"},
                to="clamped",
                value=effective_value,
                reason="utilization floor",
                rule_id="dreamplace.target_density.utilization_floor",
                evidence_ref="analysis/parameter_runtime_report.v1.json",
                evidence_sha256=HASH,
            ),
        )
    domain_context = {
        **_execution_context(),
        "incumbent_state_sha256": canonical_sha256(None),
        "stage": card.stage,
        "backend": "ecc",
        "ecc_revision": "0.1.0-alpha.11",
        "tool_revision": card.tool.revision,
        "parameter_card_sha256": card_hash(card),
        "lattice_version": "ecos.optimization_lattice.v1",
        "unit": unit,
        "current_values": dict(sorted(CURRENT_VALUES.items())),
        "terminal_execution_contract_sha256": canonical_sha256(
            {
                "target_step": card.stage,
                "end_step": "Harden",
                "execution_scope": "full_flow",
            }
        ),
        "tool_source_sha256": card.tool.source_sha256,
    }
    payload = {
        "receipt_id": f"parameter-{requested.knob_id.value.replace('.', '-')}",
        "tool": card.tool,
        "context": {
            **_execution_context(),
            "stage": card.stage,
            "backend": "ecc",
            "tool_revision": card.tool.revision,
            "parameter_card_sha256": card_hash(card),
            "lattice_version": "ecos.optimization_lattice.v1",
            "unit": unit,
            "context_sha256": build_context_fingerprint(domain_context),
        },
        "requested": {
            "knob_id": requested.knob_id.value,
            "value": requested.value,
            "unit": unit,
        },
        "materialization": MaterializationRef(
            receipt_ref="analysis/candidate_materialization.v1.json",
            receipt_sha256=HASH,
            registry_sha256=HASH,
            patch_sha256=HASH,
            candidate_ref="candidate-1",
            workspace_ref="candidate-1",
            config_before_sha256=HASH,
            config_after_sha256=HASH,
            written_value=requested.value,
            unit=unit,
        ),
        "effective_initial": EffectiveValue(value=effective_value, unit=unit),
        "transitions": transitions,
        "application_status": "applied",
        "activation": ActivationEvidence(
            status="used",
            consumers=(
                {
                    "consumer_id": consumer_id,
                    "outcome": "entered",
                    "evidence_ref": "analysis/parameter_runtime_report.v1.json",
                    "evidence_sha256": HASH,
                },
            ),
        ),
        "consumer_observation": consumer_observation,
        "effective_final": EffectiveValue(value=effective_value, unit=unit),
    }
    draft = ParameterApplicationReceipt.model_construct(**payload, evidence_sha256=HASH)
    return ParameterApplicationReceipt(
        **payload,
        evidence_sha256=canonical_sha256(
            draft.model_dump(mode="json", exclude={"evidence_sha256"})
        ),
    )


def _density_proposal(context: object) -> dict[str, object]:
    return _proposal(
        context,
        knob_id="place.target_density",
        direction=StrategyDirection.INCREASE,
    )


def _eligible_terminal(
    observation_id: str = "terminal-eligible",
) -> TerminalObservation:
    one = {
        "rcx_expected_corner_count",
        "rcx_spef_file_count",
        "sta_corner_count",
        "sta_expected_corner_count",
    }
    return TerminalObservation(
        schema_version="ecos.terminal_observation.v3",
        observation_id=observation_id,
        evidence_manifest_sha256=HASH,
        evidence_valid=True,
        harden_artifacts_complete=True,
        signoff_gates=SignoffGates.all(GateResult.PASS),
        metrics={
            ObjectiveMetric.ROUTE_DR_TOTAL_VIOLATION_COUNT: 0,
            ObjectiveMetric.ROUTE_LA_TOTAL_OVERFLOW: 0,
            ObjectiveMetric.ROUTE_WIRELENGTH: 100,
        },
        timing_guardrail={metric: 0 for metric in TimingMetric},
        evaluation_metrics=tuple(
            TerminalEvaluationMetric(
                metric_id=metric_id,
                value=1 if metric_id in one else 0,
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
        ),
        evaluation_metrics_complete=True,
        sta_corner_ids=("typical",),
        sta_corner_set_sha256=canonical_sha256({"corners": ["typical"]}),
    )


def _task_memory_snapshot(tmp_path: Path):
    objective = _objective()
    scope = build_task_memory_scope(
        workspace_manifest_sha256=HASH,
        design_id="design-a",
        checkpoint_id="checkpoint-1",
        episode_id="episode-1",
        objective_contract_sha256=objective.contract_sha256,
    )
    return OptimizationTaskMemoryStore(tmp_path / "task-memory", scope).snapshot()
