import pytest

from ecos_agent.optimization_ledger import OptimizationOutcomeKind
from ecos_agent.optimization_rules import (
    IncumbentComparison,
    IncumbentDecision,
    terminal_quality_outcome,
)


@pytest.mark.parametrize(
    ("decision", "expected"),
    (
        (IncumbentDecision.INITIALIZED, OptimizationOutcomeKind.EXECUTION_SUCCEEDED),
        (IncumbentDecision.CANDIDATE_BETTER, OptimizationOutcomeKind.IMPROVED),
        (IncumbentDecision.INCUMBENT_RETAINED, OptimizationOutcomeKind.DEGRADED),
        (IncumbentDecision.NOISE_TIE, OptimizationOutcomeKind.TRADEOFF),
        (
            IncumbentDecision.CANDIDATE_INELIGIBLE,
            OptimizationOutcomeKind.CANDIDATE_INELIGIBLE,
        ),
    ),
)
def test_terminal_quality_outcome_is_centralized(
    decision: IncumbentDecision, expected: OptimizationOutcomeKind
) -> None:
    comparison = IncumbentComparison(decision, None)

    assert (
        terminal_quality_outcome(
            OptimizationOutcomeKind.EXECUTION_SUCCEEDED, comparison
        )
        is expected
    )


def test_terminal_quality_outcome_preserves_execution_failure() -> None:
    comparison = IncumbentComparison(IncumbentDecision.CANDIDATE_BETTER, None)

    assert (
        terminal_quality_outcome(OptimizationOutcomeKind.EXECUTION_FAILED, comparison)
        is OptimizationOutcomeKind.EXECUTION_FAILED
    )
