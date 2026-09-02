from ecos_agent.optimization.contracts import OptimizationKnob
from ecos_agent.optimization.controller import (
    CandidateExecutionEvidence as LegacyCandidateExecutionEvidence,
    CandidateExecutionReceipt as LegacyCandidateExecutionReceipt,
    CandidateExecutionRequest as LegacyCandidateExecutionRequest,
    OptimizationExecutionAdapter as LegacyOptimizationExecutionAdapter,
    OptimizationHistory as LegacyOptimizationHistory,
    OptimizationPlanningContext as LegacyOptimizationPlanningContext,
    OptimizationProposalPlanner as LegacyOptimizationProposalPlanner,
    planning_context_payload as legacy_planning_context_payload,
)
from ecos_agent.optimization.execution import (
    CANDIDATE_END_STEP,
    CANDIDATE_EXECUTION_SCOPE,
    CandidateExecutionEvidence,
    CandidateExecutionReceipt,
    CandidateExecutionRequest,
    OptimizationExecutionAdapter,
    candidate_target_step,
)
from ecos_agent.optimization.planning import (
    OptimizationHistory,
    OptimizationPlanningContext,
    OptimizationProposalPlanner,
    planning_context_payload,
)


def test_controller_reexports_shared_optimization_contracts() -> None:
    assert LegacyCandidateExecutionEvidence is CandidateExecutionEvidence
    assert LegacyCandidateExecutionReceipt is CandidateExecutionReceipt
    assert LegacyCandidateExecutionRequest is CandidateExecutionRequest
    assert LegacyOptimizationExecutionAdapter is OptimizationExecutionAdapter
    assert LegacyOptimizationHistory is OptimizationHistory
    assert LegacyOptimizationPlanningContext is OptimizationPlanningContext
    assert LegacyOptimizationProposalPlanner is OptimizationProposalPlanner
    assert legacy_planning_context_payload is planning_context_payload


def test_candidate_execution_contract_is_centralized() -> None:
    assert CANDIDATE_END_STEP == "Harden"
    assert CANDIDATE_EXECUTION_SCOPE == "full_flow"
    assert {
        knob: candidate_target_step(knob)
        for knob in OptimizationKnob
    } == {
        OptimizationKnob.FLOORPLAN_CORE_UTIL: "Floorplan",
        OptimizationKnob.FLOORPLAN_ASPECT_RATIO: "Floorplan",
        OptimizationKnob.CTS_MAX_FANOUT: "CTS",
        OptimizationKnob.TARGET_DENSITY: "place",
        OptimizationKnob.TARGET_OVERFLOW: "place",
        OptimizationKnob.CELL_PADDING_X: "place",
        OptimizationKnob.ROUTABILITY_OPT: "place",
        OptimizationKnob.DENSITY_WEIGHT: "place",
    }
