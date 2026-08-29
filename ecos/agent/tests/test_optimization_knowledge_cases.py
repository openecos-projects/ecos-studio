import pytest

from ecos_agent.optimization_knowledge_cases import (
    EmpiricalOutcome,
    TerminalEmpiricalCase,
    build_empirical_case_audit,
    replay_empirical_case_selection,
    select_empirical_cases,
)

HASH = "sha256:" + "a" * 64


def _case(case_id: str, outcome: EmpiricalOutcome, *, design: str = "d1"):
    return TerminalEmpiricalCase(
        case_id=case_id,
        context_fingerprint=HASH,
        claim_id="claim.one",
        binding_id="binding.one",
        toolchain_ref=HASH,
        requested_value=0.85,
        effective_initial=0.85,
        activation_status="used",
        receipt_sha256=HASH,
        terminal_outcome_sha256=HASH,
        terminal_observation_sha256=HASH,
        guardrail_status="pass" if outcome == EmpiricalOutcome.SUPPORTED else "fail",
        outcome_class=outcome,
        design_id=design,
    )


def test_three_shot_selection_is_stratified_and_replayable() -> None:
    cases = (
        _case("case.supported", EmpiricalOutcome.SUPPORTED),
        _case("case.ineffective", EmpiricalOutcome.INEFFECTIVE),
        _case("case.failure", EmpiricalOutcome.FAILURE),
        _case("case.heldout", EmpiricalOutcome.SUPPORTED, design="heldout"),
    )
    selection, selected = select_empirical_cases(
        cases,
        shot_count=3,
        context_fingerprint=HASH,
        toolchain_ref=HASH,
        held_out_design="heldout",
    )
    assert selection.selected_case_ids == (
        "case.supported",
        "case.ineffective",
        "case.failure",
    )
    audit = build_empirical_case_audit(
        selection,
        selected,
        proposal_refs=(HASH,),
        receipt_refs=(HASH,),
        terminal_refs=(HASH,),
    )
    assert replay_empirical_case_selection(
        audit,
        cases,
        context_fingerprint=HASH,
        toolchain_ref=HASH,
        held_out_design="heldout",
    ) == selected


def test_zero_shot_and_ineligible_cases_are_empty() -> None:
    selection, selected = select_empirical_cases(
        [_case("case.unknown", EmpiricalOutcome.INEFFECTIVE)], shot_count=0
    )
    assert selection.selected_case_ids == ()
    assert selected == ()

    with pytest.raises(ValueError, match="supported empirical"):
        TerminalEmpiricalCase(
            **_case("case.bad", EmpiricalOutcome.SUPPORTED).model_dump(
                mode="json", exclude={"activation_status"}
            ),
            activation_status="unknown",
        )
