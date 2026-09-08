"""Natural-language task permissions are frozen and hash-bound."""

import pytest
from pydantic import ValidationError

from ecos_agent.hashing import canonical_sha256
from ecos_agent.optimization.contracts import (
    OptimizationObjectiveContract, OptimizationObjectiveProposal,
    OptimizationParameterPolicy,
)
from ecos_agent.optimization.rules import freeze_optimization_objective
from ecos_agent.gui.message_prompts import optimization_objective_summary_message


def freeze(goal, metric="route_wirelength", policy=None, preserve=()):
    return freeze_optimization_objective(goal, OptimizationObjectiveProposal(
        primary_metric=metric, preserve_metrics=preserve,
        parameter_policy=policy, rationale_summary=goal,
    ))


@pytest.mark.parametrize("goal,metric", [
    ("期望降低面积", "die_area"),
    ("make the footprint smaller", "die_area"),
    ("降低核心面积", "core_area"),
    ("minimize core area", "core_area"),
    ("减少综合单元面积", "synthesis_cell_area"),
    ("reduce final standard cell area", "sta_standard_cell_area"),
])
def test_structured_area_scope_is_preserved(goal, metric):
    # Provider-output fixtures do not constitute a live language-model evaluation.
    geometry = "variable" if metric in ("die_area", "core_area") else "fixed"
    objective = freeze(goal, metric, policy={"geometry_mode": geometry})
    assert objective.primary_metric.value == metric
    assert objective.parameter_policy.geometry_mode == geometry
    assert not objective.parameter_policy.advanced_parameters_enabled


@pytest.mark.parametrize("goal", [
    "保持面积不变，降低线长", "reduce wirelength while keeping area unchanged",
    "keep area fixed and reduce wirelength", "降低线长", "reduce wirelength",
    "don't change the outline; reduce wirelength",
    "不要降低面积，降低线长", "do not reduce area; reduce wirelength",
    "不降低面积，降低线长", "无需改变外形，降低线长",
    "reduce wirelength without changing area",
    "降低线长，不启用floorplan", "reduce wirelength; do not enable floorplan",
])
def test_structured_negative_geometry_intent_stays_fixed(goal):
    objective = freeze(goal, policy={"geometry_mode": "fixed"}, preserve=("die_area",))
    assert objective.parameter_policy.geometry_mode == "fixed"
    assert objective.preserve_metrics == ()


def test_legacy_proposal_defaults_are_based_only_on_typed_metric():
    assert freeze("enable floorplan and advanced parameters").parameter_policy == OptimizationParameterPolicy()
    assert freeze("area", "die_area").parameter_policy.geometry_mode == "variable"


@pytest.mark.parametrize("goal", [
    "固定核心面积，但允许改变宽高比", "keep area fixed and adjust aspect ratio",
    "reduce area while preserving core area",
])
def test_provider_reports_unsupported_geometry_before_freezing(goal):
    proposal = OptimizationObjectiveProposal(
        primary_metric="route_wirelength", rationale_summary=goal,
        parameter_policy={"geometry_mode": "fixed"},
        unsupported_reason="Fixed-area shape exploration is unsupported.",
    )
    with pytest.raises(ValueError, match="Unsupported optimization intent"):
        freeze_optimization_objective(goal, proposal)


@pytest.mark.parametrize("metric", ["die_area", "core_area"])
def test_structured_fixed_policy_conflicts_with_physical_area_objective(metric):
    with pytest.raises(ValueError, match="variable"):
        freeze("reduce area", metric, policy={"geometry_mode": "fixed"})


@pytest.mark.parametrize("goal,enabled", [
    ("降低线长，启用高级参数", True),
    ("reduce wirelength; enable density_weight", True),
    ("高级层也可以参与此次优化", True),
    ("density_weight is fair game for this run", True),
    ("reduce wirelength; do not use density_weight", False),
    ("降低线长，不要启用高级参数", False),
])
def test_structured_advanced_opt_in_is_preserved(goal, enabled):
    objective = freeze(goal, policy={"advanced_parameters_enabled": enabled})
    assert objective.parameter_policy.advanced_parameters_enabled is enabled


@pytest.mark.parametrize("goal", [
    "优化连线长度，芯片轮廓可以一起搜索", "the outline is fair game for this run",
])
def test_structured_outline_permission_does_not_depend_on_keyword_spelling(goal):
    objective = freeze(goal, policy={"geometry_mode": "variable"})
    assert objective.parameter_policy.geometry_mode == "variable"


def test_policy_hash_binding_and_legacy_roundtrip():
    objective = freeze("保持面积不变，降低线长")
    payload = objective.model_dump(mode="json")
    assert OptimizationObjectiveContract.model_validate(payload) == objective
    payload["parameter_policy"]["geometry_mode"] = "variable"
    with pytest.raises(ValidationError, match="hash"):
        OptimizationObjectiveContract.model_validate(payload)
    payload.pop("parameter_policy")
    payload["contract_sha256"] = canonical_sha256({k: v for k, v in payload.items() if k != "contract_sha256"})
    legacy = OptimizationObjectiveContract.model_validate(payload)
    assert legacy.parameter_policy is None
    assert legacy.model_dump(mode="json") == payload


def test_policy_rejects_unknown_version_and_truthy_string():
    with pytest.raises(ValidationError):
        OptimizationParameterPolicy(schema_version="v2")
    with pytest.raises(ValidationError):
        OptimizationParameterPolicy(advanced_parameters_enabled="true")


def test_summary_discloses_outline_and_advanced_settings():
    message = optimization_objective_summary_message(
        "zh", primary_metric="die_area", preserve_metrics=(), signoff_gates=(),
        rationale_summary="降低面积", objective_sha256="hash", geometry_mode="variable",
    )
    assert "可变" in message and "density_weight：禁用" in message
    assert "主要物理参数" in message and "收敛证据" in message


def test_fixed_geometry_does_not_consume_preserve_budget_before_drc_binding():
    objective = freeze("keep area fixed; reduce wirelength preserving DRC and power",
                       preserve=("die_area", "sta_typical_dynamic_power"))
    assert objective.preserve_metrics == ("drc_count", "sta_typical_dynamic_power")


def test_fixed_cell_area_does_not_freeze_outline():
    objective = freeze("保持标准单元面积不变，降低线长，允许改变外形",
                       policy={"geometry_mode": "variable"},
                       preserve=("sta_standard_cell_area",))
    assert objective.parameter_policy.geometry_mode == "variable"
    assert objective.preserve_metrics == ("sta_standard_cell_area",)


def test_frozen_contract_and_nested_policy_cannot_be_mutated():
    objective = freeze("降低线长")
    with pytest.raises(ValidationError, match="frozen"):
        objective.parameter_policy.geometry_mode = "variable"
    with pytest.raises(ValidationError, match="frozen"):
        objective.parameter_policy.advanced_parameters_enabled = True
    with pytest.raises(ValidationError, match="frozen"):
        objective.parameter_policy = OptimizationParameterPolicy(geometry_mode="variable")
