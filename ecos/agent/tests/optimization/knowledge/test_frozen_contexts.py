import pytest

from ecos_agent.optimization.experiments.frozen_contexts import (
    CONTEXT_STRATA,
    build_frozen_context,
    validate_context_bank,
    validate_frozen_context,
)


def _context(**overrides) -> dict:
    payload = {
        "design_id": "gcd",
        "objective_contract_sha256": "sha256:o",
        "legal_domain_sha256": "sha256:d",
        "stratum": "knowledge_opportunity",
        "expected_behavior": "action",
        "planning_context": {"legal_actions": [{"knob_id": "x"}]},
    }
    payload.update(overrides)
    return build_frozen_context(payload)


def test_frozen_context_round_trip_and_bank_scope() -> None:
    context = _context(observation_sha256="sha256:x")
    validate_frozen_context(context)
    validate_context_bank([context], design_id="gcd")
    assert "knowledge_opportunity" in CONTEXT_STRATA


def test_frozen_context_rejects_tampering_and_mixed_design() -> None:
    context = _context()
    context["design_id"] = "vm80"
    with pytest.raises(ValueError):
        validate_frozen_context(context)


def test_frozen_context_requires_stratum_label_and_planning_context() -> None:
    with pytest.raises(ValueError, match="stratum"):
        validate_frozen_context(_context(stratum=None))
    with pytest.raises(ValueError, match="stratum"):
        validate_frozen_context(_context(stratum="galaxy_brain"))
    with pytest.raises(ValueError, match="expected behavior"):
        validate_frozen_context(_context(expected_behavior="explode"))
    with pytest.raises(ValueError, match="planning_context"):
        validate_frozen_context(_context(planning_context={}))


def test_context_bank_rejects_duplicate_fingerprints() -> None:
    context = _context()
    with pytest.raises(ValueError, match="repeats a context fingerprint"):
        validate_context_bank([context, context], design_id="gcd")
