import hashlib
import json

from ecos_agent.knowledge.generation.general_details import _strategy_entries
from ecos_agent.optimization.contracts import OptimizationKnob
from ecos_agent.optimization.knowledge.compiler import GeneralDomainClaim, StatePredicate
from ecos_agent.optimization.knowledge.compiler_runtime import _evaluate
from tests.paths import AGENT_ROOT


INPUT_ROOT = AGENT_ROOT / "knowledge" / "inputs" / "general"
REPOSITORY_ROOT = AGENT_ROOT.parents[1]


def _inputs(name: str) -> list[dict]:
    return [
        json.loads(line)
        for path in sorted(INPUT_ROOT.glob(f"*/{name}.jsonl"))
        for line in path.read_text(encoding="utf-8").splitlines()
        if line.strip()
    ]


def test_bindings_cover_exactly_the_seven_controlled_knobs() -> None:
    statements = {item["id"]: item for item in _inputs("statements")}
    bindings = _inputs("bindings")
    assert {
        knob["knob_id"] for binding in bindings for knob in binding["knobs"]
    } == {knob.value for knob in OptimizationKnob}
    for binding in bindings:
        for knob in binding["knobs"]:
            assert set(knob) <= {"knob_id", "direction", "step", "note"}
        for strategy_id in binding["strategy_ids"]:
            statement = statements[strategy_id]
            assert statement["action_intent"] == binding["action_intent"]
            for knob in binding["knobs"]:
                assert knob["step"] in statement["scope"]["stages"]
    preservation = next(
        binding for binding in bindings
        if binding["action_intent"] == "preserve_padding_through_legalization"
    )
    assert preservation["knobs"] == []
    assert preservation["review_status"] == "unbound"


def test_source_derived_trials_have_exact_native_evidence() -> None:
    trials = [
        statement for statement in _inputs("statements")
        if statement["review_status"] == "source_derived_hypothesis"
    ]
    assert trials
    for statement in trials:
        assert "not paper-validated efficacy" in statement["condition"]
        for evidence in statement["evidence"]:
            assert evidence["source_id"].startswith("source.")
            path = REPOSITORY_ROOT / evidence["source_path"]
            assert path.is_relative_to(REPOSITORY_ROOT)
            span = "".join(
                path.read_text(encoding="utf-8").splitlines(keepends=True)[
                    evidence["start"] - 1:evidence["end"]
                ]
            )
            assert span == evidence["span"]
            assert hashlib.sha256(span.encode("utf-8")).hexdigest() == evidence["span_sha256"]
        assert all(effect["direction"].startswith("may_") for effect in statement["effects"])


def test_strategy_conditions_are_typed_and_not_just_evidence_presence() -> None:
    for statement in _inputs("statements"):
        predicates = [StatePredicate.model_validate(item) for item in statement["state_predicates"]]
        assert any(predicate.op != "present" for predicate in predicates)
        assert all(predicate.required for predicate in predicates)
        for item in statement["anti_predicates"]:
            assert StatePredicate.model_validate(item).required

    entries = [
        entry
        for metric in ("congestion", "wirelength")
        for entry in _strategy_entries(metric)[0]
    ]
    for entry in entries:
        GeneralDomainClaim.model_validate(entry["support"]["claim"])
    local = next(entry for entry in entries if entry["id"] == "strategy.congestion.local_move_cells.v1")
    claim = GeneralDomainClaim.model_validate(local["support"]["claim"])
    maps_only = {feature_id: True for feature_id in claim.required_evidence}
    diagnostic = next(predicate for predicate in claim.state_predicates if predicate.op == "true")
    assert _evaluate(diagnostic, maps_only) is None
    assert _evaluate(diagnostic, {**maps_only, diagnostic.feature_id: False}) is False
    assert _evaluate(diagnostic, {**maps_only, diagnostic.feature_id: True}) is True


def test_routing_pressure_trials_do_not_invent_native_density_observation() -> None:
    statements = _inputs("statements")
    for name in ("trial_tighter_density_convergence", "trial_stronger_initial_density_penalty"):
        statement = next(item for item in statements if item["id"] == f"strategy.congestion.{name}.v1")
        predicate = StatePredicate.model_validate(statement["state_predicates"][0])
        assert predicate.feature_id == "place_congestion_egr_overflow_total"
        assert _evaluate(predicate, {predicate.feature_id: 0}) is False
        assert _evaluate(predicate, {predicate.feature_id: 2.5}) is True
        assert _evaluate(predicate, {}) is None
        assert "not native placement density overflow" in statement["condition"]


def test_wirelength_relief_requires_clean_route_and_non_regressing_timing() -> None:
    statement = next(
        item for item in _inputs("statements")
        if item["id"] == "strategy.wirelength.reduce_excessive_place_spreading.v1"
    )
    state = [StatePredicate.model_validate(item) for item in statement["state_predicates"]]
    anti = [StatePredicate.model_validate(item) for item in statement["anti_predicates"]]
    features = {
        "route_la_total_overflow": 0,
        "route_dr_total_violation_count": 0,
        "drc_count": 0,
        "route_wirelength": 100,
        "delta.route_wirelength": 1,
        "routability_relief_configured": True,
        **{predicate.feature_id: 0 for predicate in anti},
    }
    assert all(_evaluate(predicate, features) is True for predicate in state)
    assert all(_evaluate(predicate, features) is False for predicate in anti)
    features["route_la_total_overflow"] = 1
    assert any(_evaluate(predicate, features) is False for predicate in state)
    features[anti[0].feature_id] = -0.01
    assert _evaluate(anti[0], features) is True
    del features[anti[0].feature_id]
    assert _evaluate(anti[0], features) is None
