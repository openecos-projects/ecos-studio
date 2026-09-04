from __future__ import annotations

import json
import os
from dataclasses import replace
from pathlib import Path

import pytest

from .support import (
    CURRENT_VALUES,
    HASH,
    _AuditedFakeCodex,
    _Clock,
    _FakeCodex,
    _FakeEcc,
    _budget,
    _controller,
    _eligible_terminal,
    _execution_context,
    _native_receipt,
    _objective,
    _observation,
    _proposal,
    _retrieval,
    _started,
)

from ecos_agent.codex.rpc import CodexProviderError
from ecos_agent.ecc_contracts import ECCStepName
from ecos_agent.optimization.contracts import (
    ObservationReference,
    OptimizationDecision,
    OptimizationEpisodeState,
    OptimizationKnob,
    ProposalReason,
    RequestedKnobValue,
    StrategyDirection,
)
from ecos_agent.optimization.controller import (
    CandidateExecutionReceipt,
    OptimizationEpisodeController,
)
from ecos_agent.optimization.decision_audit import OptimizationDecisionAudit
from ecos_agent.optimization.knowledge.cases import EmpiricalCaseAuditStore
from ecos_agent.optimization.ledger import (
    OptimizationOutcomeKind,
    OptimizationPlanningAudit,
)
from ecos_agent.optimization.parameters.semantics import load_parameter_cards


def test_budget_exhaustion_stops_without_calling_fake_codex(tmp_path: Path) -> None:
    codex = _FakeCodex(_proposal)
    controller = _controller(tmp_path, codex, _FakeEcc(), budget=_budget(candidates=20))

    stopped = controller.plan(_observation(), _retrieval(), CURRENT_VALUES)

    assert stopped.state == OptimizationEpisodeState.STOPPED
    assert codex.contexts == []


@pytest.mark.parametrize(
    ("decision", "expected_state"),
    [
        (OptimizationDecision.CONTINUE, OptimizationEpisodeState.PLANNING),
        (OptimizationDecision.STOP, OptimizationEpisodeState.PLANNING),
        (OptimizationDecision.ESCALATE, OptimizationEpisodeState.ESCALATED),
    ],
)
def test_non_action_decisions_never_reach_fake_ecc(
    tmp_path: Path,
    decision: OptimizationDecision,
    expected_state: OptimizationEpisodeState,
) -> None:
    def response(context: object) -> dict[str, object]:
        proposal = _proposal(context)
        proposal["decision"] = decision
        proposal.pop("action")
        return proposal

    ecc = _FakeEcc()
    controller = _controller(tmp_path, _FakeCodex(response), ecc)

    result = controller.plan(_observation(), _retrieval(), CURRENT_VALUES)

    assert result.state == expected_state
    assert result.proposal is not None
    assert ecc.start_calls == []


def test_controller_defers_early_stop_then_uses_local_fallback(tmp_path: Path) -> None:
    def stop(context: object) -> dict[str, object]:
        proposal = _proposal(context)
        proposal.update(
            decision=OptimizationDecision.STOP,
            reason_code=ProposalReason.NO_LEGAL_CANDIDATE,
            rationale_summary="No evidence-backed action remains.",
        )
        proposal.pop("action")
        return proposal

    controller = _controller(tmp_path, _FakeCodex(stop, stop), _FakeEcc(_started()))

    first = controller.plan(_observation(), _retrieval(), CURRENT_VALUES)
    second = controller.plan(_observation(), _retrieval(), CURRENT_VALUES)

    assert first.state == OptimizationEpisodeState.PLANNING
    assert first.rejection_reason == "minimum_candidates_not_met"
    assert second.state == OptimizationEpisodeState.AWAITING_EXECUTION
    assert second.requested is not None
    assert second.rejection_reason == "controlled_coordinate_fallback"


def test_controller_uses_local_fallback_after_codex_parse_error(tmp_path: Path) -> None:
    controller = _controller(
        tmp_path,
        _AuditedFakeCodex(
            lambda context: _proposal(
                context,
                observation_refs=[
                    context.observation_ref.model_dump(),
                    ObservationReference(
                        observation_id="terminal-Harden", sha256=HASH
                    ).model_dump(),
                ],
            ),
            CodexProviderError("schema validation", failure_class="parse_error"),
        ),
        _FakeEcc(_started()),
    )

    first = controller.plan(_observation(), _retrieval(), CURRENT_VALUES)
    second = controller.plan(_observation(), _retrieval(), CURRENT_VALUES)

    assert first.rejection_reason == "observation_reference"
    assert second.state == OptimizationEpisodeState.AWAITING_EXECUTION
    assert second.rejection_reason == "controlled_coordinate_fallback"


class _V2FakeCodex(_FakeCodex):
    @property
    def optimization_proposal_v2_enabled(self) -> bool:
        return os.environ.get("ECOS_ENABLE_OPTIMIZATION_PROPOSAL_V2", "1") == "1"

    def __init__(self, *responses: object) -> None:
        super().__init__()
        self.v2_responses = list(responses)
        self.v2_calls = []

    def propose(self, context: object) -> object:
        raise AssertionError("v1 planner must not be used when v2 is enabled")

    def propose_v2(self, context: object, domain: object) -> object:
        self.v2_calls.append((context, domain))
        response = self.v2_responses.pop(0)
        return response(context, domain) if callable(response) else response


def _v2_proposal(
    context: object, domain: object, *, value: object = None
) -> dict[str, object]:
    action = context.legal_actions[0]
    if isinstance(domain, tuple):
        domain = next(item for item in domain if item.knob_id == action.knob_id)
    current = context.current_values[action.knob_id.value]
    if value is None:
        candidates = (
            item
            for item in domain.allowed_requested_values
            if item > current
            if action.direction == StrategyDirection.INCREASE
        )
        value = next(candidates, None)
        if value is None:
            value = next(
                item for item in domain.allowed_requested_values if item < current
            )
    supported = next(
        item
        for item in context.supported_action_view.actions
        if item.knob_id == action.knob_id
        and item.direction == action.direction
        and item.effective_domain_sha256 == domain.snapshot_sha256
    )
    return {
        "schema_version": "ecos.optimization_proposal.v2",
        "context_ref": context.context_ref.model_dump(mode="json"),
        "decision": "propose",
        "reason_code": "observation",
        "rationale_summary": "Use one exact bounded value.",
        "observation_refs": [context.observation_ref.model_dump(mode="json")],
        "knowledge_refs": [
            item.model_dump(mode="json") for item in context.knowledge_refs
        ],
        "action": {
            "claim_id": supported.claim_ref.entity_id,
            "claim_sha256": supported.claim_sha256,
            "binding_id": supported.binding_id,
            "binding_sha256": supported.binding_sha256,
            "knob_id": action.knob_id.value,
            "direction": action.direction.value,
            "requested_value": value,
            "effective_domain_sha256": domain.snapshot_sha256,
            "expected_effects": [
                {"metric_id": "route_wirelength", "direction": "decrease"}
            ],
        },
    }


def test_full_agent_v2_rejects_mismatched_compiled_binding(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setenv("ECOS_ENABLE_OPTIMIZATION_PROPOSAL_V2", "1")

    def mismatched(context: object, domains: object) -> dict[str, object]:
        proposal = _v2_proposal(context, domains)
        proposal["action"]["binding_id"] = "binding.stale.v1"
        return proposal

    controller = _controller(
        tmp_path,
        _V2FakeCodex(mismatched, mismatched),
        _FakeEcc(),
    )

    result = controller.plan(_observation(), _retrieval(), CURRENT_VALUES)

    assert result.rejection_reason == "v2_repair_failed"


def test_controller_uses_exact_v2_value_by_default(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.delenv("ECOS_ENABLE_OPTIMIZATION_PROPOSAL_V2", raising=False)
    planner = _V2FakeCodex(_v2_proposal)
    executor = _FakeEcc(_started())
    controller = _controller(tmp_path, planner, executor)

    result = controller.plan(_observation(), _retrieval(), CURRENT_VALUES)

    context, domain = planner.v2_calls[0]
    assert result.requested is not None
    assert len(domain) > 1
    selected_domain = next(
        item for item in domain if item.knob_id == result.requested.knob_id
    )
    assert result.requested.value in selected_domain.allowed_requested_values
    assert result.requested.knob_id == context.legal_actions[0].knob_id
    assert result.planner_source == "llm"

    controller.execute()
    selected_domain = next(
        item
        for item in context.effective_domains
        if item.knob_id == result.requested.knob_id
    )
    assert executor.start_calls[0].context_sha256 == selected_domain.context_sha256
    assert executor.start_calls[0].seed == 0


def test_v2_terminal_case_is_persisted_and_injected_on_next_turn(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setenv("ECOS_ENABLE_OPTIMIZATION_PROPOSAL_V2", "1")
    planner = _V2FakeCodex(_v2_proposal, _v2_proposal)
    controller = _controller(
        tmp_path,
        planner,
        _FakeEcc(_started()),
        knowledge_case_shots=3,
    )
    retrieval = _retrieval()
    card = load_parameter_cards()[OptimizationKnob.TARGET_DENSITY]
    binding = retrieval.support_catalog.bindings[0].model_copy(
        update={"toolchain_ref": card.tool.source_sha256}
    )
    retrieval = replace(
        retrieval,
        support_catalog=retrieval.support_catalog.model_copy(
            update={"bindings": (binding,)}
        ),
    )
    planned = controller.plan(_observation(), retrieval, CURRENT_VALUES)
    assert planned.requested is not None
    controller.execute()
    native = _native_receipt(planned.requested)

    controller.complete_terminal(
        CandidateExecutionReceipt(
            execution_id="execution-1",
            started=True,
            outcome=OptimizationOutcomeKind.EXECUTION_SUCCEEDED,
            parameter_application_receipt=native,
        ),
        _eligible_terminal(),
        outcome=OptimizationOutcomeKind.IMPROVED,
    )
    replay = EmpiricalCaseAuditStore(tmp_path / "episode").verify()

    assert len(replay.cases) == 1
    assert replay.cases == controller._case_pool.verify().cases
    controller.plan(_observation(), retrieval, CURRENT_VALUES)
    assert planner.v2_calls[-1][0].empirical_cases == replay.cases
    assert planner.v2_calls[-1][0].empirical_case_audit is not None


def test_controller_v1_requires_explicit_compatibility_flag(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setenv("ECOS_ENABLE_OPTIMIZATION_PROPOSAL_V2", "0")
    controller = _controller(tmp_path, _V2FakeCodex(_v2_proposal), _FakeEcc())

    assert controller._v2_enabled() is False


def test_controller_fails_closed_when_default_v2_planner_lacks_interface(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.delenv("ECOS_ENABLE_OPTIMIZATION_PROPOSAL_V2", raising=False)

    class MissingV2Planner:
        def propose(self, context: object) -> object:
            raise AssertionError("v1 planner must not be used by default")

    controller = _controller(tmp_path, MissingV2Planner(), _FakeEcc())

    with pytest.raises(CodexProviderError, match="does not implement propose_v2"):
        controller.plan(_observation(), _retrieval(), CURRENT_VALUES)


def test_controller_accepts_llm_selected_non_first_knob(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setenv("ECOS_ENABLE_OPTIMIZATION_PROPOSAL_V2", "1")

    def choose_aspect_ratio(
        context: object, domains: tuple[object, ...]
    ) -> dict[str, object]:
        proposal = _v2_proposal(context, domains)
        domain = next(
            item for item in domains if item.knob_id.value == "floorplan.aspect_ratio"
        )
        proposal["action"] = {
            **proposal["action"],
            "knob_id": "floorplan.aspect_ratio",
            "direction": "decrease",
            "requested_value": 0.75,
            "effective_domain_sha256": domain.snapshot_sha256,
        }
        return proposal

    planner = _V2FakeCodex(choose_aspect_ratio)
    controller = _controller(tmp_path, planner, _FakeEcc())

    observation = _observation().model_copy(
        update={
            "observation_id": "observation-floorplan",
            "stage": ECCStepName.FLOORPLAN,
            "metrics": {"core_area": 2500.0, "die_area": 3000.0},
        }
    )
    retrieval = _retrieval()
    retrieval = replace(
        retrieval,
        request=retrieval.request.model_copy(
            update={
                "current_stage": ECCStepName.FLOORPLAN,
                "observed_metric_ids": ("core_area", "die_area"),
            }
        ),
        support_catalog=retrieval.support_catalog.model_copy(
            update={
                "claims": (
                    retrieval.support_catalog.claims[0].model_copy(
                        update={"stages": ("Floorplan",), "state_predicates": ()}
                    ),
                )
            }
        ),
    )

    result = controller.plan(observation, retrieval, CURRENT_VALUES)

    assert result.planner_source == "llm"
    assert result.requested == RequestedKnobValue(
        knob_id="floorplan.aspect_ratio", value=0.75
    )


def test_controller_repairs_one_invalid_v2_response_before_accepting_exact_value(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setenv("ECOS_ENABLE_OPTIMIZATION_PROPOSAL_V2", "1")

    def invalid(context: object, domain: object) -> dict[str, object]:
        return _v2_proposal(context, domain, value=999)

    planner = _V2FakeCodex(invalid, _v2_proposal)
    controller = _controller(tmp_path, planner, _FakeEcc())

    result = controller.plan(_observation(), _retrieval(), CURRENT_VALUES)

    assert len(planner.v2_calls) == 2
    assert controller.budget.consumed_planning_calls == 2
    assert result.requested is not None
    assert result.planner_source == "repair"
    planning = OptimizationPlanningAudit(tmp_path / "episode").replay().entries
    decisions = OptimizationDecisionAudit(tmp_path / "episode").replay().entries
    assert len(planning) == 2
    assert len(decisions) == 2
    assert decisions[0].validation_result == "rejected"
    assert decisions[0].planning_entry_sha256 == planning[0].entry_sha256
    assert decisions[-1].planner_source == "repair"
    assert decisions[-1].planning_entry_sha256 == planning[-1].entry_sha256


def test_v2_repair_refreshes_wall_time_and_planning_context(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setenv("ECOS_ENABLE_OPTIMIZATION_PROPOSAL_V2", "1")
    clock = _Clock()

    def invalid(context: object, domain: object) -> dict[str, object]:
        clock.now = 5.0
        return _v2_proposal(context, domain, value=999)

    planner = _V2FakeCodex(invalid, _v2_proposal)
    controller = _controller(tmp_path, planner, _FakeEcc(), clock=clock)

    controller.plan(_observation(), _retrieval(), CURRENT_VALUES)

    first_context, _ = planner.v2_calls[0]
    repair_context, _ = planner.v2_calls[1]
    assert first_context.budget.elapsed_wall_time_seconds == 0
    assert repair_context.budget.elapsed_wall_time_seconds == 5
    assert repair_context.budget.consumed_planning_calls == 2
    assert controller.budget.elapsed_wall_time_seconds == 5


def test_v2_repair_does_not_exceed_planning_call_budget(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setenv("ECOS_ENABLE_OPTIMIZATION_PROPOSAL_V2", "1")
    planner = _V2FakeCodex(
        lambda context, domain: _v2_proposal(context, domain, value=999)
    )
    controller = _controller(
        tmp_path,
        planner,
        _FakeEcc(),
        budget=_budget(planning=59),
    )

    result = controller.plan(_observation(), _retrieval(), CURRENT_VALUES)

    assert len(planner.v2_calls) == 1
    assert controller.budget.consumed_planning_calls == 60
    assert result.rejection_reason == "planning_budget_exhausted"
    assert len(OptimizationPlanningAudit(tmp_path / "episode").replay().entries) == 1


def test_controller_falls_back_immediately_after_v2_repair_failure(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setenv("ECOS_ENABLE_OPTIMIZATION_PROPOSAL_V2", "1")
    planner = _V2FakeCodex(
        lambda context, domain: _v2_proposal(context, domain, value=999),
        lambda context, domain: _v2_proposal(context, domain, value=999),
    )
    controller = _controller(tmp_path, planner, _FakeEcc())

    result = controller.plan(_observation(), _retrieval(), CURRENT_VALUES)

    assert result.state == OptimizationEpisodeState.AWAITING_EXECUTION
    assert result.rejection_reason == "v2_repair_failed"
    assert result.planner_source == "local_fallback"
    decision = OptimizationDecisionAudit(tmp_path / "episode").replay().entries[-1]
    assert decision.planner_source == "local_fallback"
    decisions = OptimizationDecisionAudit(tmp_path / "episode").replay().entries
    assert [entry.planner_source for entry in decisions] == [
        "llm",
        "repair",
        "local_fallback",
    ]
    assert [entry.validation_result for entry in decisions] == [
        "rejected",
        "rejected",
        "fallback",
    ]


def test_stop_is_deferred_until_fixed_candidate_budget_is_exhausted(
    tmp_path: Path,
) -> None:
    def stop(context: object) -> dict[str, object]:
        proposal = _proposal(context)
        proposal.update(
            decision=OptimizationDecision.STOP,
            reason_code=ProposalReason.OBSERVATION,
            rationale_summary="The bounded search is complete.",
        )
        proposal.pop("action")
        return proposal

    controller = _controller(
        tmp_path,
        _FakeCodex(stop),
        _FakeEcc(),
        budget=_budget(candidates=2),
    )

    result = controller.plan(_observation(), _retrieval(), CURRENT_VALUES)

    assert result.state == OptimizationEpisodeState.PLANNING
    assert result.rejection_reason == "minimum_candidates_not_met"


def test_planning_decisions_are_hash_bound_and_replayable(tmp_path: Path) -> None:
    controller = _controller(tmp_path, _FakeCodex(_proposal), _FakeEcc(_started()))

    result = controller.plan(_observation(), _retrieval(), CURRENT_VALUES)

    entries = OptimizationDecisionAudit(tmp_path / "episode").replay().entries
    assert len(entries) == 1
    assert entries[0].proposal == result.proposal
    assert entries[0].validation_result == "accepted"
    assert entries[0].requested == result.requested


def test_objective_is_bound_to_planning_state_decision_and_execution(
    tmp_path: Path,
) -> None:
    objective = _objective()
    codex = _FakeCodex(_proposal)
    controller = _controller(
        tmp_path,
        codex,
        _FakeEcc(_started()),
        objective=objective,
    )

    controller.plan(_observation(), _retrieval(), CURRENT_VALUES)
    controller.execute()

    assert codex.contexts[0].objective == objective
    state = json.loads(controller.state_path.read_text(encoding="utf-8"))
    assert state["objective"] == objective.model_dump(mode="json")
    start = controller.ledger.replay().entries[0].payload
    assert start.objective_contract_sha256 == objective.contract_sha256
    decision = OptimizationDecisionAudit(tmp_path / "episode").replay().entries[0]
    assert decision.objective_contract_sha256 == objective.contract_sha256


def test_recovery_preserves_the_frozen_objective(tmp_path: Path) -> None:
    objective = _objective()
    controller = _controller(
        tmp_path,
        _FakeCodex(_proposal),
        _FakeEcc(_started()),
        objective=objective,
    )

    recovered = OptimizationEpisodeController.recover(
        planner=_FakeCodex(_proposal),
        executor=_FakeEcc(),
        ledger=controller.ledger,
        clock=_Clock(),
        execution_context=_execution_context(),
    )

    assert recovered.objective == objective
