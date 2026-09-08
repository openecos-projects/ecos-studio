from __future__ import annotations

import json
from pathlib import Path

import pytest

from .support import (
    CURRENT_VALUES,
    HASH,
    _FakeCodex,
    _FakeEcc,
    _controller,
    _eligible_terminal,
    _native_receipt,
    _observation,
    _proposal,
    _retrieval,
    _started,
    _terminal,
)

from ecos_agent.optimization.contracts import (
    OptimizationEpisodeState,
    RequestedKnobValue,
)
from ecos_agent.optimization.controller import (
    CandidateExecutionReceipt,
    CandidateExecutionRequest,
    OptimizationEpisodeController,
    OptimizationEpisodeControllerError,
)
from ecos_agent.optimization.knowledge.cases import EmpiricalCaseAuditStore
from ecos_agent.optimization.ledger import OptimizationOutcomeKind


def test_missing_fake_ecc_receipt_is_charged_and_quarantined(tmp_path: Path) -> None:
    class _NoReceiptEcc(_FakeEcc):
        def start(self, request: object) -> CandidateExecutionReceipt:
            self.start_calls.append(request)
            raise RuntimeError("connection lost after request")

    controller = _controller(tmp_path, _FakeCodex(_proposal), _NoReceiptEcc())
    controller.plan(_observation(), _retrieval(), CURRENT_VALUES)

    result = controller.execute()

    assert result.state == OptimizationEpisodeState.QUARANTINED
    assert controller.budget.consumed_candidates == 1
    assert (
        controller.ledger.replay().terminal_outcomes[0].outcome
        == OptimizationOutcomeKind.INDETERMINATE
    )
    state = json.loads(controller.state_path.read_text(encoding="utf-8"))
    assert [probe["requested"] for probe in state["attempted_probes"]] == [
        {"knob_id": "place.cell_padding_x", "value": 3}
    ]
    assert all(probe["parent_config_sha256"] for probe in state["attempted_probes"])


def test_not_started_retries_once_without_consuming_a_candidate(tmp_path: Path) -> None:
    codex = _FakeCodex(_proposal)
    ecc = _FakeEcc(
        CandidateExecutionReceipt(execution_id="execution-1", started=False),
        CandidateExecutionReceipt(execution_id="execution-2", started=False),
    )
    controller = _controller(tmp_path, codex, ecc)
    controller.plan(_observation(), _retrieval(), CURRENT_VALUES)

    result = controller.execute()

    assert result.state == OptimizationEpisodeState.PLANNING
    assert result.rejection_reason == "execution_not_started"
    assert len(ecc.start_calls) == 2
    assert controller.budget.consumed_candidates == 0
    assert controller.ledger.replay().entries == ()


def test_timeout_cancels_once_and_quarantines_when_fake_ecc_has_no_receipt(
    tmp_path: Path,
) -> None:
    codex = _FakeCodex(_proposal)
    ecc = _FakeEcc(_started(), cancel_receipt=_started())
    controller = _controller(tmp_path, codex, ecc)
    controller.plan(_observation(), _retrieval(), CURRENT_VALUES)
    controller.execute()

    quarantined = controller.timeout()

    assert quarantined.state == OptimizationEpisodeState.QUARANTINED
    assert controller.budget.consumed_candidates == 1
    assert len(ecc.cancel_calls) == 1
    assert (
        controller.ledger.replay().terminal_outcomes[0].outcome
        == OptimizationOutcomeKind.INDETERMINATE
    )
    with pytest.raises(OptimizationEpisodeControllerError, match="already requested"):
        controller.timeout()


def test_timeout_with_terminal_cancel_receipt_preserves_negative_outcome(
    tmp_path: Path,
) -> None:
    codex = _FakeCodex(_proposal)
    ecc = _FakeEcc(
        _started(),
        cancel_receipt=_terminal(OptimizationOutcomeKind.TIMED_OUT_CANCELLED),
    )
    controller = _controller(tmp_path, codex, ecc)
    controller.plan(_observation(), _retrieval(), CURRENT_VALUES)
    controller.execute()

    result = controller.timeout()

    assert result.state == OptimizationEpisodeState.PLANNING
    assert controller.ledger.replay().terminal_outcomes[0].outcome == (
        OptimizationOutcomeKind.TIMED_OUT_CANCELLED
    )


def test_terminal_outcome_can_only_complete_the_pending_execution(
    tmp_path: Path,
) -> None:
    controller = _controller(tmp_path, _FakeCodex(_proposal), _FakeEcc(_started()))
    controller.plan(_observation(), _retrieval(), CURRENT_VALUES)
    controller.execute()

    result = controller.complete_terminal(
        _terminal(OptimizationOutcomeKind.DEGRADED, "execution-1")
    )

    assert result.state == OptimizationEpisodeState.PLANNING
    assert (
        controller.ledger.replay().terminal_outcomes[0].outcome
        == OptimizationOutcomeKind.DEGRADED
    )


def test_controller_persists_native_receipt_in_terminal_ledger(tmp_path: Path) -> None:
    controller = _controller(tmp_path, _FakeCodex(_proposal), _FakeEcc(_started()))
    controller.plan(_observation(), _retrieval(), CURRENT_VALUES)
    controller.execute()

    controller.complete_terminal(
        CandidateExecutionReceipt(
            execution_id="execution-1",
            started=True,
            outcome=OptimizationOutcomeKind.DEGRADED,
            parameter_application_receipt=_native_receipt(
                RequestedKnobValue(knob_id="place.cell_padding_x", value=3),
                effective_value=2,
            ),
        )
    )

    outcome = controller.ledger.replay().terminal_outcomes[0]
    assert outcome.parameter_application_receipt is not None
    assert outcome.parameter_application_receipt.actual_value == 2


def _complete_padding_probe(controller: OptimizationEpisodeController) -> None:
    controller.complete_terminal(
        CandidateExecutionReceipt(
            execution_id="execution-1",
            started=True,
            outcome=OptimizationOutcomeKind.DEGRADED,
            parameter_application_receipt=_native_receipt(
                RequestedKnobValue(knob_id="place.cell_padding_x", value=3),
                effective_value=2,
            ),
        ),
        _eligible_terminal(),
    )


def test_unclaimed_probe_records_diagnostic_instead_of_case(
    tmp_path: Path,
) -> None:
    controller = _controller(tmp_path, _FakeCodex(_proposal), _FakeEcc(_started()))
    controller.plan(_observation(), _retrieval(), CURRENT_VALUES)
    controller.execute()

    _complete_padding_probe(controller)

    replay = EmpiricalCaseAuditStore(tmp_path / "episode").verify()
    assert replay.cases == ()
    assert [item.reason_code for item in replay.diagnostics] == ["unclaimed_probe"]
    assert replay.diagnostics[0].intervention_id == "intervention-1"
    assert replay.diagnostics[0].proposal_sha256 is not None


def test_claimed_probe_still_records_an_empirical_case(tmp_path: Path) -> None:
    def _claimed_proposal(context: object) -> dict[str, object]:
        proposal = _proposal(context)
        proposal["action"].update(
            {
                "claim_id": "strategy.congestion.padding.v1",
                "claim_sha256": HASH,
                "binding_id": "binding.test.v1",
                "binding_sha256": "sha256:" + "c" * 64,
            }
        )
        return proposal

    controller = _controller(
        tmp_path, _FakeCodex(_claimed_proposal), _FakeEcc(_started())
    )
    controller.plan(_observation(), _retrieval(), CURRENT_VALUES)
    controller.execute()

    _complete_padding_probe(controller)

    replay = EmpiricalCaseAuditStore(tmp_path / "episode").verify()
    assert replay.diagnostics == ()
    assert [item.claim_id for item in replay.cases] == [
        "strategy.congestion.padding.v1"
    ]


def test_candidate_execution_receipt_exposes_only_native_parameter_receipts() -> None:
    assert "application_receipt" not in CandidateExecutionReceipt.__dataclass_fields__


def test_candidate_execution_request_rejects_non_integer_seed(tmp_path: Path) -> None:
    controller = _controller(tmp_path, _FakeCodex(_proposal), _FakeEcc())
    planned = controller.plan(_observation(), _retrieval(), CURRENT_VALUES)
    assert planned.proposal is not None
    assert planned.requested is not None

    with pytest.raises(ValueError, match="seed"):
        CandidateExecutionRequest(
            intervention_id="intervention-1",
            episode_id="episode-1",
            checkpoint_id="checkpoint-1",
            proposal=planned.proposal,
            requested=planned.requested,
            context_sha256=HASH,
            seed=True,
            ecc_revision="0.1.0-alpha.11",
        )
