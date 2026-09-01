import pytest

from ecos_agent.provider_session import (
    GuiPhase,
    OptimizationUiPhase,
    ProviderSession,
)


def test_provider_session_validates_phase_assignments() -> None:
    session = ProviderSession(session_id="session-1")

    session.phase = "operation"
    session.optimization_phase = "running"

    assert session.phase is GuiPhase.OPERATION
    assert session.phase == "operation"
    assert session.optimization_phase is OptimizationUiPhase.RUNNING
    assert session.optimization_phase == "running"

    with pytest.raises(ValueError, match="unknown GUI phase"):
        session.phase = "typo"
    with pytest.raises(ValueError, match="unknown optimization UI phase"):
        session.optimization_phase = "typo"
