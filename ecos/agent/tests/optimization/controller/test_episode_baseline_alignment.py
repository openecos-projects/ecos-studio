"""The episode anchor and the alignment's canonical baseline may differ."""

from pathlib import Path

import pytest

from ecos_agent.optimization.contracts import (
    ObjectiveMetric,
    OptimizationObjectiveProposal,
)
from ecos_agent.optimization.controller import (
    OptimizationAgentMode,
    OptimizationEpisodeControllerError,
)
from ecos_agent.optimization.objective_alignment import build_objective_alignment
from ecos_agent.optimization.rules import freeze_optimization_objective

from .support import _FakeCodex, _FakeEcc, _controller, _eligible_terminal, _started


def _wirelength_proposal() -> OptimizationObjectiveProposal:
    return OptimizationObjectiveProposal(
        primary_metric=ObjectiveMetric.ROUTE_WIRELENGTH,
        preserve_metrics=(ObjectiveMetric.DRC_COUNT,),
        rationale_summary="Wirelength is primary; routing quality stays constrained.",
    )


def _timing_proposal() -> OptimizationObjectiveProposal:
    return OptimizationObjectiveProposal(
        primary_metric=ObjectiveMetric.STA_SETUP_WNS,
        preserve_metrics=(ObjectiveMetric.DRC_COUNT,),
        rationale_summary="Timing is primary for this run.",
    )


def test_rerun_path_incumbent_accepts_canonical_alignment(tmp_path: Path) -> None:
    """The GUI freezes the alignment from the canonical scan before calibration
    runs, then anchors the episode on the middle replay; the two observations
    legitimately differ, so construction must not demand baseline equality."""
    canonical = _eligible_terminal("terminal-canonical")
    replay = _eligible_terminal("terminal-replay")
    goal = freeze_optimization_objective(
        "Minimize route wirelength while preserving DRC.", _wirelength_proposal()
    )
    controller = _controller(
        tmp_path,
        _FakeCodex(),
        _FakeEcc(_started()),
        objective=goal,
        incumbent=replay,
        objective_alignment=build_objective_alignment(goal, canonical),
    )

    assert controller.incumbent is replay
    assert controller.mode is OptimizationAgentMode.FULL_AGENT


def test_alignment_bound_to_another_objective_is_rejected(tmp_path: Path) -> None:
    incumbent = _eligible_terminal("terminal-replay")
    goal = freeze_optimization_objective(
        "Minimize route wirelength while preserving DRC.", _wirelength_proposal()
    )

    with pytest.raises(OptimizationEpisodeControllerError, match="episode baseline"):
        _controller(
            tmp_path,
            _FakeCodex(),
            _FakeEcc(_started()),
            objective=goal,
            incumbent=incumbent,
            objective_alignment=build_objective_alignment(
                freeze_optimization_objective(
                    "Minimize total negative slack while preserving DRC.",
                    _timing_proposal(),
                ),
                incumbent,
            ),
        )


def test_incumbent_with_invalid_evidence_is_rejected(tmp_path: Path) -> None:
    goal = freeze_optimization_objective(
        "Minimize route wirelength while preserving DRC.", _wirelength_proposal()
    )
    incumbent = _eligible_terminal("terminal-replay")
    alignment = build_objective_alignment(goal, incumbent)

    with pytest.raises(OptimizationEpisodeControllerError, match="episode baseline"):
        _controller(
            tmp_path,
            _FakeCodex(),
            _FakeEcc(_started()),
            objective=goal,
            incumbent=incumbent.model_copy(update={"evidence_valid": False}),
            objective_alignment=alignment,
        )
