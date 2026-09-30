"""Canonical matching between knowledge phases and runtime flow steps."""

from __future__ import annotations

from collections.abc import Iterable

from ecos_agent.ecc_contracts import ECCStepName

_FLOORPLAN_STAGE_ALIASES = frozenset(
    {
        "floorplan",
        ECCStepName.PRE_FLOORPLAN.value.casefold(),
        ECCStepName.MACRO_PLACEMENT.value.casefold(),
        ECCStepName.POST_FLOORPLAN.value.casefold(),
    }
)


KNOWLEDGE_PHASE_ALIASES = {
    stage: "floorplan"
    for stage in _FLOORPLAN_STAGE_ALIASES
    if stage != "floorplan"
}


def _normalized(stage: str | ECCStepName) -> str:
    return (stage.value if isinstance(stage, ECCStepName) else stage).casefold()


def knowledge_phase(stage: str | ECCStepName) -> str:
    """Return the conceptual knowledge phase for a runtime or phase name."""
    normalized = _normalized(stage)
    return "floorplan" if normalized in _FLOORPLAN_STAGE_ALIASES else normalized


def stage_aliases(stage: str | ECCStepName) -> frozenset[str]:
    """Return the canonical comparison family for one stage name."""
    normalized = _normalized(stage)
    if normalized in _FLOORPLAN_STAGE_ALIASES:
        return _FLOORPLAN_STAGE_ALIASES
    return frozenset((normalized,))


def stage_matches_any(
    stage: str | ECCStepName,
    candidates: Iterable[str | ECCStepName],
) -> bool:
    """Whether a runtime stage belongs to any candidate knowledge phase."""
    aliases = stage_aliases(stage)
    return any(aliases.intersection(stage_aliases(candidate)) for candidate in candidates)
