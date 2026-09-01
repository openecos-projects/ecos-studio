from __future__ import annotations

from pathlib import Path

import pytest

from .support import (
    CURRENT_VALUES,
    HASH,
    _Clock,
    _FakeCodex,
    _FakeEcc,
    _budget,
    _controller,
    _density_proposal,
    _eligible_terminal,
    _execution_context,
    _native_receipt,
    _observation,
    _proposal,
    _retrieval,
    _started,
)

from ecos_agent.optimization.contracts import (
    LegalAction,
    OptimizationDecision,
    OptimizationEpisodeState,
    OptimizationKnob,
    ProposalReason,
    RequestedKnobValue,
    StrategyDirection,
)
from ecos_agent.optimization.controller import (
    CandidateExecutionEvidence,
    CandidateExecutionReceipt,
    OptimizationAgentMode,
    OptimizationEpisodeController,
)
from ecos_agent.optimization.ledger import (
    OptimizationLedger,
    OptimizationOutcomeKind,
)


def test_recovery_does_not_use_receipt_without_eligible_terminal_observation(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    controller = _controller(
        tmp_path,
        _FakeCodex(_density_proposal),
        _FakeEcc(_started()),
    )
    first = controller.plan(_observation(), _retrieval(), CURRENT_VALUES)
    assert first.requested is not None
    controller.execute()
    controller.complete_terminal(
        CandidateExecutionReceipt(
            execution_id="execution-1",
            started=True,
            outcome=OptimizationOutcomeKind.DEGRADED,
            parameter_application_receipt=_native_receipt(
                first.requested, effective_value=0.8
            ),
        ),
        incumbent_decision="incumbent_retained",
    )

    def stop(context: object) -> dict[str, object]:
        proposal = _proposal(context)
        proposal.update(
            decision=OptimizationDecision.STOP,
            reason_code=ProposalReason.NO_LEGAL_CANDIDATE,
        )
        proposal.pop("action")
        return proposal

    planner = _FakeCodex(stop, stop)
    monkeypatch.setattr(
        "ecos_agent.optimization.controller.legal_actions",
        lambda **_: (
            LegalAction(
                knob_id="place.target_density",
                direction=StrategyDirection.INCREASE,
            ),
        ),
    )
    recovered = OptimizationEpisodeController.recover(
        planner=planner,
        executor=_FakeEcc(),
        ledger=controller.ledger,
        clock=_Clock(),
        execution_context=_execution_context(),
    )
    deferred = recovered.plan(_observation(), _retrieval(), CURRENT_VALUES)
    planned = recovered.plan(_observation(), _retrieval(), CURRENT_VALUES)

    context = planner.contexts[0]
    assert context.history[0].parameter_application_receipt is not None
    density_domain = next(
        item
        for item in context.effective_domains
        if item.knob_id == OptimizationKnob.TARGET_DENSITY
    )
    assert density_domain.current_coordinate == {
        "surface_value": CURRENT_VALUES["place.target_density"],
        "effective_anchor": None,
    }
    assert tuple(item.value for item in context.excluded_surface_values) == (0.55,)
    assert deferred.state == OptimizationEpisodeState.PLANNING
    assert planned.rejection_reason == "controlled_coordinate_fallback"
    assert planned.requested != RequestedKnobValue(
        knob_id="place.target_density", value=0.875
    )


def test_same_execution_context_reuses_eligible_receipt_across_episodes(
    tmp_path: Path,
) -> None:
    optimization_root = tmp_path / "optimization"
    first = OptimizationEpisodeController(
        episode_id="episode-1",
        checkpoint_id="checkpoint-1",
        mode=OptimizationAgentMode.FULL_AGENT,
        budget=_budget(),
        planner=_FakeCodex(_density_proposal),
        executor=_FakeEcc(_started()),
        ledger=OptimizationLedger(optimization_root / "episode-1"),
        clock=_Clock(),
        execution_context=_execution_context(),
    )
    planned = first.plan(_observation(), _retrieval(), CURRENT_VALUES)
    assert planned.requested is not None
    first.execute()
    first.complete_terminal(
        CandidateExecutionReceipt(
            execution_id="execution-1",
            started=True,
            outcome=OptimizationOutcomeKind.DEGRADED,
            parameter_application_receipt=_native_receipt(
                planned.requested, effective_value=0.8
            ),
        ),
        _eligible_terminal(),
        incumbent_decision="incumbent_retained",
    )

    second_planner = _FakeCodex(_proposal)
    second = OptimizationEpisodeController(
        episode_id="episode-2",
        checkpoint_id="checkpoint-2",
        mode=OptimizationAgentMode.FULL_AGENT,
        budget=_budget(),
        planner=second_planner,
        executor=_FakeEcc(),
        ledger=OptimizationLedger(optimization_root / "episode-2"),
        clock=_Clock(),
        execution_context=_execution_context(),
    )
    second.plan(_observation(), _retrieval(), CURRENT_VALUES)

    density_domain = next(
        item
        for item in second_planner.contexts[0].effective_domains
        if item.knob_id == OptimizationKnob.TARGET_DENSITY
    )
    assert density_domain.current_coordinate == {
        "surface_value": CURRENT_VALUES["place.target_density"],
        "effective_anchor": None,
    }
    assert density_domain.thresholds[0].value == 0.8
    assert density_domain.observed_response_signatures
    assert 0.8 not in density_domain.allowed_requested_values


def test_cross_episode_receipt_scan_rejects_symlinked_ledger_root(
    tmp_path: Path,
) -> None:
    external_root = tmp_path / "external" / "episode-1"
    first = OptimizationEpisodeController(
        episode_id="episode-1",
        checkpoint_id="checkpoint-1",
        mode=OptimizationAgentMode.FULL_AGENT,
        budget=_budget(),
        planner=_FakeCodex(_density_proposal),
        executor=_FakeEcc(_started()),
        ledger=OptimizationLedger(external_root),
        clock=_Clock(),
        execution_context=_execution_context(),
    )
    planned = first.plan(_observation(), _retrieval(), CURRENT_VALUES)
    assert planned.requested is not None
    first.execute()
    first.complete_terminal(
        CandidateExecutionReceipt(
            execution_id="execution-1",
            started=True,
            outcome=OptimizationOutcomeKind.DEGRADED,
            parameter_application_receipt=_native_receipt(
                planned.requested, effective_value=0.8
            ),
        ),
        _eligible_terminal(),
        incumbent_decision="incumbent_retained",
    )

    optimization_root = tmp_path / "optimization"
    optimization_root.mkdir()
    try:
        (optimization_root / "linked-episode").symlink_to(
            external_root, target_is_directory=True
        )
    except OSError:
        pytest.skip("directory symlinks are unavailable")
    second = OptimizationEpisodeController(
        episode_id="episode-2",
        checkpoint_id="checkpoint-2",
        mode=OptimizationAgentMode.FULL_AGENT,
        budget=_budget(),
        planner=_FakeCodex(_proposal),
        executor=_FakeEcc(),
        ledger=OptimizationLedger(optimization_root / "episode-2"),
        clock=_Clock(),
        execution_context=_execution_context(),
    )

    assert second._native_receipts() == ()


def test_sibling_promoted_receipt_does_not_replace_new_episode_baseline(
    tmp_path: Path,
) -> None:
    optimization_root = tmp_path / "optimization"
    evidence = CandidateExecutionEvidence(
        candidate_root_ref=".agent/candidates/candidate-a",
        candidate_manifest_ref=(
            ".agent/candidates/candidate-a/analysis/candidate_workspace.v1.json"
        ),
        candidate_manifest_sha256=HASH,
    )
    first = OptimizationEpisodeController(
        episode_id="episode-a",
        checkpoint_id="checkpoint-1",
        mode=OptimizationAgentMode.FULL_AGENT,
        budget=_budget(),
        planner=_FakeCodex(_density_proposal),
        executor=_FakeEcc(_started()),
        ledger=OptimizationLedger(optimization_root / "episode-a"),
        clock=_Clock(),
        execution_context=_execution_context(),
    )
    planned = first.plan(_observation(), _retrieval(), CURRENT_VALUES)
    assert planned.requested is not None
    first.execute()
    first.complete_terminal(
        CandidateExecutionReceipt(
            execution_id="execution-1",
            started=True,
            outcome=OptimizationOutcomeKind.EXECUTION_SUCCEEDED,
            evidence=evidence,
            parameter_application_receipt=_native_receipt(
                planned.requested, effective_value=0.8
            ),
        ),
        _eligible_terminal(),
        outcome=OptimizationOutcomeKind.IMPROVED,
        incumbent_decision="candidate_better",
    )

    planner = _FakeCodex(_proposal)
    second = OptimizationEpisodeController(
        episode_id="episode-b",
        checkpoint_id="checkpoint-2",
        mode=OptimizationAgentMode.FULL_AGENT,
        budget=_budget(),
        planner=planner,
        executor=_FakeEcc(),
        ledger=OptimizationLedger(optimization_root / "episode-b"),
        clock=_Clock(),
        execution_context=_execution_context(),
    )
    second.plan(_observation(), _retrieval(), CURRENT_VALUES)

    density_domain = next(
        item
        for item in planner.contexts[0].effective_domains
        if item.knob_id == OptimizationKnob.TARGET_DENSITY
    )
    assert density_domain.current_coordinate == {
        "surface_value": CURRENT_VALUES["place.target_density"],
        "effective_anchor": None,
    }
    assert density_domain.thresholds[0].value == 0.8


def test_completed_terminal_receipt_is_bound_to_promoted_incumbent(
    tmp_path: Path,
) -> None:
    evidence = CandidateExecutionEvidence(
        candidate_root_ref=".agent/candidates/candidate-a",
        candidate_manifest_ref=(
            ".agent/candidates/candidate-a/analysis/candidate_workspace.v1.json"
        ),
        candidate_manifest_sha256=HASH,
    )
    controller = _controller(
        tmp_path,
        _FakeCodex(_density_proposal, _density_proposal),
        _FakeEcc(_started()),
    )
    planned = controller.plan(_observation(), _retrieval(), CURRENT_VALUES)
    assert planned.requested is not None
    controller.execute()
    controller.complete_terminal(
        CandidateExecutionReceipt(
            execution_id="execution-1",
            started=True,
            outcome=OptimizationOutcomeKind.EXECUTION_SUCCEEDED,
            evidence=evidence,
            parameter_application_receipt=_native_receipt(
                planned.requested, effective_value=0.8
            ),
        ),
        _eligible_terminal(),
        outcome=OptimizationOutcomeKind.IMPROVED,
        incumbent_decision="candidate_better",
    )

    assert len(controller._native_receipts(promoted_only=True)) == 1

    next_values = {
        **CURRENT_VALUES,
        planned.requested.knob_id.value: 0.8,
    }
    controller.plan(_observation(), _retrieval(), next_values)
    density_domain = next(
        item
        for item in controller.planner.contexts[1].effective_domains
        if item.knob_id == OptimizationKnob.TARGET_DENSITY
    )
    assert density_domain.current_coordinate is not None
    assert density_domain.current_coordinate["surface_value"] == planned.requested.value
    assert density_domain.current_coordinate["effective_anchor"] == 0.8
    assert density_domain.observed_response_signatures


def test_episode_identity_does_not_change_execution_contract_fingerprint(
    tmp_path: Path,
) -> None:
    first_planner = _FakeCodex(_proposal)
    second_planner = _FakeCodex(_proposal)
    for episode_id, checkpoint_id, planner in (
        ("episode-1", "checkpoint-1", first_planner),
        ("episode-2", "checkpoint-2", second_planner),
    ):
        controller = OptimizationEpisodeController(
            episode_id=episode_id,
            checkpoint_id=checkpoint_id,
            mode=OptimizationAgentMode.FULL_AGENT,
            budget=_budget(),
            planner=planner,
            executor=_FakeEcc(),
            ledger=OptimizationLedger(tmp_path / episode_id),
            clock=_Clock(),
            execution_context=_execution_context(),
        )
        controller.plan(_observation(), _retrieval(), CURRENT_VALUES)

    first_domains = {
        item.knob_id: item.context_sha256
        for item in first_planner.contexts[0].effective_domains
    }
    second_domains = {
        item.knob_id: item.context_sha256
        for item in second_planner.contexts[0].effective_domains
    }
    assert first_domains == second_domains


def test_promoting_another_knob_invalidates_the_density_floor(tmp_path: Path) -> None:
    controller = _controller(
        tmp_path,
        _FakeCodex(_density_proposal, _proposal, _density_proposal),
        _FakeEcc(_started("execution-1"), _started("execution-2")),
    )
    first = controller.plan(_observation(), _retrieval(), CURRENT_VALUES)
    assert first.requested is not None
    controller.execute()
    controller.complete_terminal(
        CandidateExecutionReceipt(
            execution_id="execution-1",
            started=True,
            outcome=OptimizationOutcomeKind.DEGRADED,
            parameter_application_receipt=_native_receipt(
                first.requested, effective_value=0.8
            ),
        ),
        incumbent_decision="incumbent_retained",
    )
    second = controller.plan(_observation(), _retrieval(), CURRENT_VALUES)
    assert second.requested == RequestedKnobValue(
        knob_id="place.cell_padding_x", value=3
    )
    controller.execute()
    controller.complete_terminal(
        CandidateExecutionReceipt(
            execution_id="execution-2",
            started=True,
            outcome=OptimizationOutcomeKind.IMPROVED,
            parameter_application_receipt=_native_receipt(second.requested),
        ),
        incumbent_decision="candidate_better",
    )

    planned = controller.plan(
        _observation(),
        _retrieval(),
        {**CURRENT_VALUES, "place.cell_padding_x": 3},
    )

    assert tuple(
        item.value for item in controller.planner.contexts[2].excluded_surface_values
    ) == (0.55, 3)
    assert planned.requested == RequestedKnobValue(
        knob_id="place.target_density", value=0.75
    )
