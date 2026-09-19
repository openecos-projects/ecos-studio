"""Strategy declaration and typed-reflection behavior across planning turns."""

from __future__ import annotations

import json
from dataclasses import replace
from pathlib import Path
from types import SimpleNamespace

import pytest

from .support import (
    CURRENT_VALUES,
    HASH,
    _Clock,
    _FakeCodex,
    _FakeEcc,
    _controller,
    _eligible_terminal,
    _execution_context,
    _observation,
    _proposal,
    _retrieval,
    _started,
)

from ecos_agent.optimization.contracts import (
    ObservationReference,
    OptimizationDecision,
    OptimizationEpisodeState,
    ProposalContextRef,
    ProposalReason,
)
from ecos_agent.optimization.controller import (
    CandidateExecutionReceipt,
    OptimizationEpisodeController,
)
from ecos_agent.optimization.knowledge.compiler import KnowledgeApplicability
from ecos_agent.optimization.ledger import OptimizationOutcomeKind
from ecos_agent.optimization.planning import OptimizationPlanningContext

_STRATEGY = {
    "schema_version": "ecos.optimization_strategy.v1",
    "goal": "Raise padding to relieve congestion, then confirm overflow relief.",
    "steps": [
        {
            "step_id": "step-1",
            "knob_id": "place.cell_padding_x",
            "direction": "increase",
            "requested_value": 4,
            "intent": "probe",
        },
        {
            "step_id": "step-2",
            "knob_id": "place.target_density",
            "direction": "increase",
            "condition": {
                "metric_id": "route_la_total_overflow",
                "expects": "improved",
            },
            "depends_on": ["step-1"],
        },
    ],
}


def test_continue_with_a_viable_declared_strategy_never_escalates(
    tmp_path: Path,
) -> None:
    def continue_with_strategy(context: object) -> dict[str, object]:
        proposal = _proposal(context)
        proposal.update(
            decision=OptimizationDecision.CONTINUE,
            reason_code=ProposalReason.INSUFFICIENT_EVIDENCE,
            rationale_summary="Waiting for the declared strategy to play out.",
        )
        proposal.pop("action")
        proposal["strategy"] = _STRATEGY
        return proposal

    controller = _controller(
        tmp_path,
        _FakeCodex(*[continue_with_strategy] * 5),
        _FakeEcc(_started()),
    )

    results = [
        controller.plan(_observation(), _retrieval(), CURRENT_VALUES)
        for _ in range(5)
    ]

    assert all(
        result.state == OptimizationEpisodeState.PLANNING for result in results
    )
    assert controller.state == OptimizationEpisodeState.PLANNING
    exposed = controller.planner.contexts[-1].active_strategy
    assert exposed is not None
    assert exposed["viable_step_count"] >= 1
    assert exposed["goal"] == _STRATEGY["goal"]


def test_declared_strategy_is_persisted_exposed_and_recovered(
    tmp_path: Path,
) -> None:
    planner = _FakeCodex(
        lambda context: {**_proposal(context), "strategy": _STRATEGY}
    )
    controller = _controller(tmp_path, planner, _FakeEcc(_started()))

    result = controller.plan(_observation(), _retrieval(), CURRENT_VALUES)

    assert result.state == OptimizationEpisodeState.AWAITING_EXECUTION
    assert controller.active_strategy is not None
    assert controller.active_strategy.goal == _STRATEGY["goal"]
    state = json.loads(controller.state_path.read_text(encoding="utf-8"))
    assert state["active_strategy"]["steps"][0]["step_id"] == "step-1"
    assert state["strategy_parent_config_sha256"]

    recovered = OptimizationEpisodeController.recover(
        planner=_FakeCodex(_proposal),
        executor=_FakeEcc(),
        ledger=controller.ledger,
        clock=_Clock(),
        execution_context=_execution_context(),
    )
    assert recovered.active_strategy == controller.active_strategy


def test_exhausted_strategy_still_escalates_at_the_stall_limit(
    tmp_path: Path,
) -> None:
    stale = {
        "schema_version": "ecos.optimization_strategy.v1",
        "goal": "One probe, already dispatched.",
        "steps": [
            {
                "step_id": "step-1",
                "knob_id": "place.cell_padding_x",
                "direction": "increase",
                "requested_value": 3,
            }
        ],
    }

    def propose_then_stale_continue(context: object) -> dict[str, object]:
        proposal = _proposal(context, requested_value=3)
        proposal["strategy"] = stale
        return proposal

    def stale_continue(context: object) -> dict[str, object]:
        proposal = _proposal(context)
        proposal.update(
            decision=OptimizationDecision.CONTINUE,
            reason_code=ProposalReason.INSUFFICIENT_EVIDENCE,
            rationale_summary="Nothing new to declare.",
        )
        proposal.pop("action")
        proposal["strategy"] = stale
        return proposal

    controller = _controller(
        tmp_path,
        _FakeCodex(propose_then_stale_continue, *([stale_continue] * 4)),
        _FakeEcc(_started()),
    )

    planned = controller.plan(_observation(), _retrieval(), CURRENT_VALUES)
    assert planned.state == OptimizationEpisodeState.AWAITING_EXECUTION
    assert controller.active_strategy is not None
    controller.execute()
    controller.complete_terminal(
        CandidateExecutionReceipt(
            execution_id="execution-1",
            started=True,
            outcome=OptimizationOutcomeKind.EXECUTION_SUCCEEDED,
        ),
        _eligible_terminal(),
        outcome=OptimizationOutcomeKind.IMPROVED,
    )

    results = [
        controller.plan(_observation(), _retrieval(), CURRENT_VALUES)
        for _ in range(4)
    ]

    # padding 3 was dispatched under this parent config, so the declared step
    # is attempted and the continue turns are non-productive again.
    assert [result.state for result in results[:3]] == [
        OptimizationEpisodeState.PLANNING
    ] * 3
    assert results[3].state == OptimizationEpisodeState.ESCALATED


def test_outcome_attribution_reaches_the_next_planning_turn(
    tmp_path: Path,
) -> None:
    planner = _FakeCodex(
        lambda context: _proposal(context, requested_value=3),
        lambda context: _proposal(context, requested_value=4),
    )
    controller = _controller(tmp_path, planner, _FakeEcc(_started()))

    planned = controller.plan(_observation(), _retrieval(), CURRENT_VALUES)
    controller.execute()
    controller.complete_terminal(
        CandidateExecutionReceipt(
            execution_id="execution-1",
            started=True,
            outcome=OptimizationOutcomeKind.EXECUTION_SUCCEEDED,
        ),
        _eligible_terminal(),
        outcome=OptimizationOutcomeKind.IMPROVED,
    )
    assert planned.requested is not None

    controller.plan(_observation(), _retrieval(), CURRENT_VALUES)

    feedback = planner.contexts[-1].planning_feedback
    attribution = [
        entry
        for entry in feedback
        if entry.source.value == "outcome_attribution"
    ]
    assert attribution
    assert attribution[0].intervention_id is not None
    assert attribution[0].outcome == "improved"
    assert attribution[0].expected_effect_verdicts


def _bare_context(**overrides: object) -> OptimizationPlanningContext:
    context = OptimizationPlanningContext(
        ProposalContextRef(
            episode_id="episode-1",
            checkpoint_id="checkpoint-1",
            input_sha256=HASH,
        ),
        ObservationReference(observation_id="observation-place", sha256=HASH),
        None,
        (),
        (),
        (),
    )
    return replace(context, **overrides)


@pytest.mark.parametrize(
    "applicability",
    [
        KnowledgeApplicability.BLOCKED,
        KnowledgeApplicability.UNKNOWN,
    ],
)
def test_continue_justified_by_inactionable_knowledge_is_productive(
    tmp_path: Path, applicability: KnowledgeApplicability
) -> None:
    controller = _controller(
        tmp_path, _FakeCodex(_proposal), _FakeEcc(_started())
    )
    view = SimpleNamespace(
        matches=[SimpleNamespace(applicability=applicability)]
    )
    context = _bare_context(supported_action_view=view)

    assert controller._non_dispatch_is_productive(context, "planner_continue")


def test_bare_continue_without_knowledge_abstention_stays_non_productive(
    tmp_path: Path,
) -> None:
    controller = _controller(
        tmp_path, _FakeCodex(_proposal), _FakeEcc(_started())
    )
    actionable_view = SimpleNamespace(
        matches=[SimpleNamespace(applicability=KnowledgeApplicability.PASS)]
    )

    assert not controller._non_dispatch_is_productive(
        _bare_context(supported_action_view=actionable_view),
        "planner_continue",
    )
    assert not controller._non_dispatch_is_productive(
        _bare_context(), "planner_continue"
    )
