from __future__ import annotations

import json
from pathlib import Path

import pytest

from .support import (
    CURRENT_VALUES,
    _Clock,
    _FakeCodex,
    _FakeEcc,
    _controller,
    _execution_context,
    _eligible_terminal,
    _objective,
    _observation,
    _proposal,
    _retrieval,
    _started,
)

from ecos_agent.hashing import canonical_sha256
from ecos_agent.optimization.contracts import OptimizationEpisodeState
from ecos_agent.optimization.controller import (
    OptimizationEpisodeController,
    OptimizationEpisodeControllerError,
)
from ecos_agent.optimization.decision_audit import (
    OptimizationDecisionAudit,
    OptimizationDecisionAuditIntegrityError,
)
from ecos_agent.optimization.objective_alignment import build_objective_alignment


def test_recovery_quarantines_pending_execution_and_rejects_tampered_state(
    tmp_path: Path,
) -> None:
    codex = _FakeCodex(_proposal)
    ecc = _FakeEcc(_started())
    controller = _controller(tmp_path, codex, ecc)
    controller.plan(_observation(), _retrieval(), CURRENT_VALUES)
    controller.execute()

    recovered = OptimizationEpisodeController.recover(
        planner=_FakeCodex(_proposal),
        executor=_FakeEcc(),
        ledger=controller.ledger,
        clock=_Clock(),
        execution_context=_execution_context(),
    )
    assert recovered.state == OptimizationEpisodeState.QUARANTINED
    assert recovered.budget.consumed_candidates == 1

    state_path = controller.state_path
    state = json.loads(state_path.read_text(encoding="utf-8"))
    state["state"] = "planning"
    state_path.write_text(json.dumps(state), encoding="utf-8")
    with pytest.raises(OptimizationEpisodeControllerError, match="state hash"):
        OptimizationEpisodeController.recover(
            planner=_FakeCodex(_proposal),
            executor=_FakeEcc(),
            ledger=controller.ledger,
            clock=_Clock(),
            execution_context=_execution_context(),
        )


@pytest.mark.parametrize(
    "changed_context",
    (
        {**_execution_context(), "seed": 1},
        {**_execution_context(), "ecc_revision": "0.1.0-alpha.12"},
    ),
)
def test_recovery_rejects_execution_context_drift_before_approved_execution(
    tmp_path: Path,
    changed_context: dict[str, object],
) -> None:
    controller = _controller(tmp_path, _FakeCodex(_proposal), _FakeEcc(_started()))
    controller.plan(_observation(), _retrieval(), CURRENT_VALUES)

    with pytest.raises(
        OptimizationEpisodeControllerError,
        match="execution context does not match",
    ):
        OptimizationEpisodeController.recover(
            planner=_FakeCodex(_proposal),
            executor=_FakeEcc(_started()),
            ledger=controller.ledger,
            clock=_Clock(),
            execution_context=changed_context,
        )


@pytest.mark.parametrize("version", ("v2", "v5", "v6"))
def test_recovery_rejects_a_pre_policy_episode(tmp_path: Path, version: str) -> None:
    controller = _controller(tmp_path, _FakeCodex(_proposal), _FakeEcc(_started()))
    controller.state_path.rename(
        controller.state_path.with_name(f"optimization-episode-state.{version}.json")
    )

    with pytest.raises(OptimizationEpisodeControllerError, match="pre-policy"):
        OptimizationEpisodeController.recover(
            planner=_FakeCodex(_proposal),
            executor=_FakeEcc(),
            ledger=controller.ledger,
            clock=_Clock(),
        )


def test_recovery_preserves_alignment_and_rejects_alignment_tampering(
    tmp_path: Path,
) -> None:
    baseline = _eligible_terminal("terminal-baseline")
    objective = _objective()
    alignment = build_objective_alignment(objective, baseline)
    controller = _controller(
        tmp_path,
        _FakeCodex(_proposal),
        _FakeEcc(),
        incumbent=baseline,
        objective=objective,
        objective_alignment=alignment,
    )

    recovered = OptimizationEpisodeController.recover(
        planner=_FakeCodex(_proposal),
        executor=_FakeEcc(),
        ledger=controller.ledger,
        clock=_Clock(),
        execution_context=_execution_context(),
    )
    assert recovered.objective_alignment == alignment

    state = json.loads(controller.state_path.read_text(encoding="utf-8"))
    state["objective_alignment"]["drc_count"] = 1
    state["state_sha256"] = canonical_sha256(
        {key: value for key, value in state.items() if key != "state_sha256"}
    )
    controller.state_path.write_text(json.dumps(state), encoding="utf-8")

    with pytest.raises(OptimizationEpisodeControllerError, match="state hash"):
        OptimizationEpisodeController.recover(
            planner=_FakeCodex(_proposal),
            executor=_FakeEcc(),
            ledger=controller.ledger,
            clock=_Clock(),
            execution_context=_execution_context(),
        )


def test_decision_audit_rejects_malformed_hash_and_tampered_record(
    tmp_path: Path,
) -> None:
    audit = OptimizationDecisionAudit(tmp_path / "episode")
    with pytest.raises(ValueError, match="hash is invalid"):
        audit.append(
            planning_entry_sha256="sha256:" + "z" * 64,
            proposal=None,
            validation_result="rejected",
            rejection_reason="proposal_schema",
            requested=None,
            state=OptimizationEpisodeState.PLANNING,
        )

    controller = _controller(tmp_path, _FakeCodex(_proposal), _FakeEcc(_started()))
    controller.plan(_observation(), _retrieval(), CURRENT_VALUES)
    path = OptimizationDecisionAudit(tmp_path / "episode").audit_path
    record = json.loads(path.read_text(encoding="utf-8"))
    record["rejection_reason"] = "tampered"
    path.write_text(json.dumps(record) + "\n", encoding="utf-8")

    with pytest.raises(
        OptimizationDecisionAuditIntegrityError, match="record 1 is invalid"
    ):
        OptimizationDecisionAudit(tmp_path / "episode").verify()
