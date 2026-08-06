"""Select reviewed, evidence-backed Placement strategies without executing them."""

from collections.abc import Iterable
from typing import Any

from pydantic import ValidationError

from ecos_agent.ecc_contracts import ECCStepName
from ecos_agent.parameter_authorization import assert_authorized_candidate_knobs
from ecos_agent.place_contracts import PlaceEvidence, PlaceStrategy


def select_applicable_strategies(
    entities: Iterable[object], evidence: PlaceEvidence
) -> list[PlaceStrategy]:
    strategies = []
    for entity in entities:
        if not isinstance(entity, dict) or not _is_reviewed_strategy(entity):
            continue
        try:
            strategy = PlaceStrategy.model_validate(entity["strategy"])
        except ValidationError:
            continue
        assert_authorized_candidate_knobs(
            ECCStepName.PLACEMENT, strategy.allowed_directions
        )
        if all(metric in evidence.metrics for metric in strategy.required_metrics):
            strategies.append(strategy)
    return strategies


def _is_reviewed_strategy(entity: dict[str, Any]) -> bool:
    strategy = entity.get("strategy")
    return (
        entity.get("type") == "strategy"
        and entity.get("status") == "directly_supported"
        and entity.get("review_status") == "approved"
        and isinstance(strategy, dict)
        and strategy.get("status") == "directly_supported"
        and strategy.get("review_status") == "approved"
    )
