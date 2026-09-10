import pytest

from ecos_agent.optimization.experiments.frozen_contexts import (
    build_frozen_context,
    validate_context_bank,
    validate_frozen_context,
)


def test_frozen_context_round_trip_and_bank_scope() -> None:
    context = build_frozen_context({
        "design_id": "gcd",
        "objective_contract_sha256": "sha256:o",
        "legal_domain_sha256": "sha256:d",
        "observation_sha256": "sha256:x",
    })
    validate_frozen_context(context)
    validate_context_bank([context], design_id="gcd")


def test_frozen_context_rejects_tampering_and_mixed_design() -> None:
    context = build_frozen_context({
        "design_id": "gcd",
        "objective_contract_sha256": "sha256:o",
        "legal_domain_sha256": "sha256:d",
    })
    context["design_id"] = "vm80"
    with pytest.raises(ValueError):
        validate_frozen_context(context)
