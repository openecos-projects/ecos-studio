import json
from pathlib import Path

import pytest

from ecos_agent.optimization.parameters.effective_domain import EffectiveDomainSnapshot
from ecos_agent.hashing import canonical_sha256
from ecos_agent.optimization.contracts import (
    GateResult,
    ObjectiveMetric,
    OptimizationKnob,
    SignoffGates,
    TerminalObservation,
    TimingMetric,
)
from ecos_agent.optimization.knowledge.cases import (
    EmpiricalCaseAuditError,
    EmpiricalCaseAuditIntegrityError,
    EmpiricalCaseAuditRecoveryRequired,
    EmpiricalCaseAuditStore,
    EmpiricalCaseDiagnostic,
    EmpiricalOutcome,
    TerminalEmpiricalCase,
    build_empirical_case_audit,
    build_terminal_empirical_case,
    replay_empirical_case_selection,
    select_empirical_cases,
)
from ecos_agent.optimization.ledger import (
    OptimizationOutcomeKind,
    OptimizationTerminalOutcome,
)
from ecos_agent.optimization.parameters.contracts import (
    ActivationEvidence,
    ConsumerEvidence,
    EffectiveValue,
    MaterializationRef,
    NumericProposalActionV2,
    OptimizationProposalV2,
    ParameterApplicationReceipt,
    ToolRef,
)

HASH = "sha256:" + "a" * 64
DOMAIN_HASH = "sha256:" + "b" * 64
CARD_HASH = "sha256:" + "c" * 64
TOOLCHAIN_HASH = "sha256:" + "d" * 64
MATERIALIZATION_HASH = "sha256:" + "e" * 64


def _domain() -> EffectiveDomainSnapshot:
    payload = {
        "knob_id": OptimizationKnob.TARGET_DENSITY,
        "context_sha256": HASH,
        "current_coordinate": {"requested": 0.8, "effective": 0.8},
        "surface_values": (0.8, 0.85),
        "allowed_requested_values": (0.85,),
    }
    draft = EffectiveDomainSnapshot.model_construct(**payload, snapshot_sha256=HASH)
    return EffectiveDomainSnapshot(
        **payload,
        snapshot_sha256=canonical_sha256(
            draft.model_dump(mode="json", exclude={"snapshot_sha256"})
        ),
    )


def _proposal(domain: EffectiveDomainSnapshot) -> OptimizationProposalV2:
    return OptimizationProposalV2(
        context_ref={
            "episode_id": "episode-1",
            "checkpoint_id": "place",
            "input_sha256": HASH,
        },
        decision="propose",
        reason_code="observation",
        rationale_summary="Use the supported knowledge action.",
        observation_refs=({"observation_id": "observation-1", "sha256": HASH},),
        action=NumericProposalActionV2(
            claim_id="claim.one",
            claim_sha256=HASH,
            binding_id="binding.one",
            binding_sha256=HASH,
            knob_id=OptimizationKnob.TARGET_DENSITY,
            direction="increase",
            requested_value=0.85,
            effective_domain_sha256=domain.snapshot_sha256,
            expected_effects=(
                {"metric_id": "route_wirelength", "direction": "decrease"},
            ),
        ),
    )


def _receipt(*, receipt_id: str = "receipt-1") -> ParameterApplicationReceipt:
    consumer = ConsumerEvidence(
        consumer_id="dreamplace.density_objective",
        outcome="entered",
        evidence_ref="analysis/runtime.json",
        evidence_sha256=HASH,
    )
    payload = {
        "receipt_id": receipt_id,
        "tool": ToolRef(
            name="DREAMPlace", revision="test", source_sha256=TOOLCHAIN_HASH
        ),
        "context": {
            "context_sha256": HASH,
            "parameter_card_sha256": CARD_HASH,
        },
        "requested": {
            "knob_id": OptimizationKnob.TARGET_DENSITY.value,
            "value": 0.85,
            "unit": "ratio",
        },
        "materialization": MaterializationRef(
            receipt_ref="analysis/materialization.json",
            receipt_sha256=MATERIALIZATION_HASH,
            registry_sha256=HASH,
            patch_sha256=HASH,
            candidate_ref="candidate-1",
            workspace_ref="workspace-1",
            config_before_sha256=HASH,
            config_after_sha256=DOMAIN_HASH,
            written_value=0.85,
            unit="ratio",
        ),
        "effective_initial": EffectiveValue(value=0.85, unit="ratio"),
        "application_status": "applied",
        "activation": ActivationEvidence(status="used", consumers=(consumer,)),
        "effective_final": EffectiveValue(value=0.85, unit="ratio"),
    }
    draft = ParameterApplicationReceipt.model_construct(
        **payload, evidence_sha256=HASH
    )
    digest_payload = draft.model_dump(mode="json", exclude={"evidence_sha256"})
    digest_payload.pop("consumer_observation", None)
    return ParameterApplicationReceipt(
        **payload, evidence_sha256=canonical_sha256(digest_payload)
    )


def _terminal() -> TerminalObservation:
    return TerminalObservation(
        observation_id="terminal-1",
        evidence_manifest_sha256=HASH,
        evidence_valid=True,
        harden_artifacts_complete=True,
        signoff_gates=SignoffGates.all(GateResult.PASS),
        metrics={metric: 0.0 for metric in ObjectiveMetric},
        timing_guardrail={metric: 0.0 for metric in TimingMetric},
    )


def _terminal_outcome(
    receipt: ParameterApplicationReceipt, terminal: TerminalObservation
) -> OptimizationTerminalOutcome:
    terminal_hash = canonical_sha256(terminal.model_dump(mode="json"))
    return OptimizationTerminalOutcome(
        intervention_id="intervention-1",
        outcome=OptimizationOutcomeKind.IMPROVED,
        candidate_manifest_sha256=HASH,
        receipt_sha256=receipt.evidence_sha256,
        terminal_observation_sha256=terminal_hash,
        terminal_observation=terminal,
        parameter_application_receipt=receipt,
        parameter_card_sha256=CARD_HASH,
        materialization_receipt_sha256=MATERIALIZATION_HASH,
        parameter_application_receipt_id=receipt.receipt_id,
        outcome_details_sha256=HASH,
    )


def _case(
    case_id: str,
    outcome: EmpiricalOutcome,
    *,
    design: str = "d1",
    binding: str = "binding.one",
    toolchain: str = TOOLCHAIN_HASH,
    stale: bool = False,
) -> TerminalEmpiricalCase:
    return TerminalEmpiricalCase(
        case_id=case_id,
        context_fingerprint=HASH,
        claim_id="claim.one",
        binding_id=binding,
        toolchain_ref=toolchain,
        requested_value=0.85,
        effective_initial=0.85,
        activation_status="used",
        proposal_sha256=HASH,
        effective_domain_sha256=DOMAIN_HASH,
        parameter_card_sha256=CARD_HASH,
        materialization_receipt_sha256=MATERIALIZATION_HASH,
        receipt_sha256=HASH,
        terminal_outcome_sha256=HASH,
        terminal_observation_sha256=HASH,
        evidence_status="stale" if stale else "current",
        guardrail_status="pass" if outcome == EmpiricalOutcome.SUPPORTED else "fail",
        outcome_class=outcome,
        design_id=design,
    )


def test_builder_binds_complete_l0_to_l3_chain() -> None:
    domain = _domain()
    proposal = _proposal(domain)
    receipt = _receipt()
    terminal = _terminal()
    terminal_outcome = _terminal_outcome(receipt, terminal)

    case = build_terminal_empirical_case(
        case_id="case.complete",
        proposal=proposal,
        effective_domain=domain,
        receipt=receipt,
        terminal_outcome=terminal_outcome,
        terminal=terminal,
        outcome_class=EmpiricalOutcome.SUPPORTED,
        guardrail_status="pass",
    )

    assert case.claim_id == "claim.one"
    assert case.binding_id == "binding.one"
    assert case.toolchain_ref == TOOLCHAIN_HASH
    assert case.proposal_sha256 == canonical_sha256(proposal.model_dump(mode="json"))
    assert case.effective_domain_sha256 == domain.snapshot_sha256
    assert case.parameter_card_sha256 == CARD_HASH
    assert case.materialization_receipt_sha256 == MATERIALIZATION_HASH
    assert case.receipt_sha256 == receipt.evidence_sha256
    assert case.terminal_outcome_sha256 == canonical_sha256(
        terminal_outcome.model_dump(mode="json")
    )
    assert case.terminal_observation_sha256 == canonical_sha256(
        terminal.model_dump(mode="json")
    )

    foreign = _receipt(receipt_id="receipt-foreign")
    with pytest.raises(ValueError, match="terminal native receipt does not match"):
        build_terminal_empirical_case(
            case_id="case.foreign",
            proposal=proposal,
            effective_domain=domain,
            receipt=foreign,
            terminal_outcome=terminal_outcome,
            terminal=terminal,
            outcome_class=EmpiricalOutcome.SUPPORTED,
            guardrail_status="pass",
        )


def test_three_shot_selection_is_stratified_filtered_and_replayable() -> None:
    cases = (
        _case("case.supported", EmpiricalOutcome.SUPPORTED),
        _case("case.ineffective", EmpiricalOutcome.INEFFECTIVE),
        _case("case.failure", EmpiricalOutcome.FAILURE),
        _case("case.heldout", EmpiricalOutcome.SUPPORTED, design="heldout"),
        _case("case.stale", EmpiricalOutcome.SUPPORTED, stale=True),
        _case("case.foreign-binding", EmpiricalOutcome.SUPPORTED, binding="binding.two"),
        _case("case.foreign-tool", EmpiricalOutcome.SUPPORTED, toolchain=HASH),
    )
    filters = {
        "context_fingerprint": HASH,
        "eligible_binding_ids": ("binding.one",),
        "eligible_toolchain_refs": (TOOLCHAIN_HASH,),
        "held_out_design": "heldout",
    }
    selection, selected = select_empirical_cases(cases, shot_count=3, **filters)
    assert selection.selected_case_ids == (
        "case.supported",
        "case.ineffective",
        "case.failure",
    )
    audit = build_empirical_case_audit(selection, selected)
    assert replay_empirical_case_selection(audit, cases, **filters) == selected

    stale_selected = tuple(
        item.model_copy(update={"evidence_status": "stale"})
        if item.case_id == "case.supported"
        else item
        for item in cases
    )
    with pytest.raises(ValueError, match="does not match audit"):
        replay_empirical_case_selection(audit, stale_selected, **filters)


def test_zero_shot_and_incomplete_cases_are_not_eligible() -> None:
    selection, selected = select_empirical_cases(
        [_case("case.unknown", EmpiricalOutcome.INEFFECTIVE)], shot_count=0
    )
    assert selection.selected_case_ids == ()
    assert selected == ()

    incomplete = TerminalEmpiricalCase.model_construct(
        **_case("case.incomplete", EmpiricalOutcome.SUPPORTED).model_dump(
            exclude={"materialization_receipt_sha256"}
        )
    )
    selection, selected = select_empirical_cases([incomplete], shot_count=3)
    assert selection.selected_case_ids == ()
    assert selected == ()


def test_append_only_case_audit_store_detects_tamper_and_torn_record(
    tmp_path: Path,
) -> None:
    store = EmpiricalCaseAuditStore(tmp_path / "valid")
    case = _case("case.persisted", EmpiricalOutcome.SUPPORTED)
    selection, selected = select_empirical_cases([case], shot_count=3)
    audit = build_empirical_case_audit(selection, selected)

    store.append_case(case)
    store.append_selection(audit)
    diagnostic = EmpiricalCaseDiagnostic(
        intervention_id="intervention-2",
        reason_code="missing_terminal_receipt",
        proposal_sha256=HASH,
    )
    store.append_diagnostic(diagnostic)
    replay = store.verify()
    assert replay.cases == (case,)
    assert replay.selections == (audit,)
    assert replay.diagnostics == (diagnostic,)
    assert replay.event_count == 3
    assert replay.chain_head_sha256 is not None

    with pytest.raises(ValueError, match="diagnostic hash"):
        EmpiricalCaseDiagnostic(
            intervention_id="intervention-3",
            reason_code="invalid_proposal",
            proposal_sha256="sha256:invalid",
        )

    lines = store.audit_path.read_text(encoding="utf-8").splitlines()
    tampered = json.loads(lines[0])
    tampered["payload"]["case_id"] = "case.tampered"
    lines[0] = json.dumps(tampered, sort_keys=True, separators=(",", ":"))
    store.audit_path.write_text("\n".join(lines) + "\n", encoding="utf-8")
    with pytest.raises(EmpiricalCaseAuditIntegrityError):
        store.verify()

    torn = EmpiricalCaseAuditStore(tmp_path / "torn")
    torn.append_case(case)
    with torn.audit_path.open("ab") as stream:
        stream.write(b'{"sequence":')
    with pytest.raises(EmpiricalCaseAuditRecoveryRequired):
        torn.verify()


def test_read_only_case_pool_never_creates_or_appends_files(tmp_path: Path) -> None:
    pool = tmp_path / "frozen-pool"
    pool.mkdir()
    store = EmpiricalCaseAuditStore(pool, read_only=True)

    assert store.verify().event_count == 0
    assert list(pool.iterdir()) == []
    with pytest.raises(EmpiricalCaseAuditError, match="read-only"):
        store.append_diagnostic(
            EmpiricalCaseDiagnostic(
                intervention_id="intervention-1",
                reason_code="test",
            )
        )
