"""Validate structured objective semantics before user confirmation and freezing."""

from __future__ import annotations

from typing import TYPE_CHECKING, Literal

from pydantic import BaseModel, ConfigDict, StrictBool

if TYPE_CHECKING:
    from ecos_agent.optimization.contracts import ObjectiveMetric, OptimizationObjectiveProposal


class OptimizationParameterPolicy(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)

    schema_version: Literal["ecos.optimization_parameter_policy.v1"] = (
        "ecos.optimization_parameter_policy.v1"
    )
    geometry_mode: Literal["fixed", "variable"] = "fixed"
    advanced_parameters_enabled: StrictBool = False


def resolve_objective_intent(
    goal: str, proposal: OptimizationObjectiveProposal,
) -> tuple[ObjectiveMetric, OptimizationParameterPolicy]:
    """Check semantic field conflicts without reparsing language as permissions.

    The structured provider interprets scope, negation and explicit opt-in. ECOS
    validates the policy and presents it for confirmation before execution. Old
    proposals infer geometry only from their typed metric; old frozen episodes
    retain their missing policy and are handled separately by recovery.
    """
    from ecos_agent.optimization.contracts import ObjectiveMetric

    if proposal.unsupported_reason is not None:
        raise ValueError(f"Unsupported optimization intent: {proposal.unsupported_reason}")
    primary = proposal.primary_metric
    physical_area = primary in (ObjectiveMetric.DIE_AREA, ObjectiveMetric.CORE_AREA)
    policy = proposal.parameter_policy or OptimizationParameterPolicy(
        geometry_mode="variable" if physical_area else "fixed",
    )
    if physical_area and policy.geometry_mode != "variable":
        raise ValueError("Reducing physical area requires an explicitly variable outline policy.")
    return primary, policy
