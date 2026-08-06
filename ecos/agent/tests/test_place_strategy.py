import pytest

from ecos_agent.place_contracts import PlaceEvidence
from ecos_agent.place_strategy import select_applicable_strategies


def test_selects_only_an_approved_strategy_with_required_evidence() -> None:
    entities = [
        {
            "id": "strategy.place.reduce_density",
            "type": "strategy",
            "status": "directly_supported",
            "review_status": "approved",
            "strategy": {
                "strategy_id": "strategy.place.reduce_density",
                "status": "directly_supported",
                "required_metrics": ["place_congestion_egr_overflow_max"],
                "allowed_directions": {"place.target_density": "decrease"},
                "protected_metrics": ["place_hpwl"],
                "verification": "Run the frozen place-only scan.",
                "rollback": "Do not modify the source workspace.",
                "escalation": "Escalate to floorplan when congestion persists.",
                "review_status": "approved",
            },
        }
    ]
    evidence = PlaceEvidence(
        workspace_id="gcd",
        metrics={"place_congestion_egr_overflow_max": 3, "place_hpwl": 12},
    )

    strategies = select_applicable_strategies(entities, evidence)

    assert [strategy.strategy_id for strategy in strategies] == ["strategy.place.reduce_density"]


def test_rejects_strategy_that_uses_an_unauthorized_knob() -> None:
    evidence = PlaceEvidence(workspace_id="gcd", metrics={"place_hpwl": 12})
    entities = [
        {
            "type": "strategy",
            "status": "directly_supported",
            "review_status": "approved",
            "strategy": {
                "strategy_id": "strategy.place.invalid",
                "status": "directly_supported",
                "required_metrics": [],
                "allowed_directions": {"route.thread_number": "increase"},
                "protected_metrics": [],
                "verification": "Verify.",
                "rollback": "Rollback.",
                "escalation": "Escalate.",
                "review_status": "approved",
            },
        }
    ]

    with pytest.raises(ValueError, match="not authorized"):
        select_applicable_strategies(entities, evidence)


@pytest.mark.parametrize(
    ("entity_update", "strategy_update"),
    [
        ({"type": "parameter"}, {}),
        ({"status": "evidence_gap"}, {}),
        ({"review_status": "pending"}, {}),
        ({}, {"status": "evidence_gap"}),
        ({}, {"review_status": "pending"}),
        ({}, {"required_metrics": ["place_hpwl"]}),
    ],
)
def test_skips_strategy_without_the_required_approval_or_evidence(
    entity_update: dict[str, str], strategy_update: dict[str, object]
) -> None:
    strategy = {
        "strategy_id": "strategy.place.reduce_density",
        "status": "directly_supported",
        "required_metrics": ["place_congestion_egr_overflow_max"],
        "allowed_directions": {"place.target_density": "decrease"},
        "protected_metrics": ["place_hpwl"],
        "verification": "Verify.",
        "rollback": "Rollback.",
        "escalation": "Escalate.",
        "review_status": "approved",
    }
    strategy.update(strategy_update)
    entity = {
        "type": "strategy",
        "status": "directly_supported",
        "review_status": "approved",
        "strategy": strategy,
    }
    entity.update(entity_update)

    assert select_applicable_strategies(
        [entity],
        PlaceEvidence(
            workspace_id="gcd", metrics={"place_congestion_egr_overflow_max": 1}
        ),
    ) == []
