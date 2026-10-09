"""Static ECOS Agent authorization for the GUI workspace rerun surface."""

from __future__ import annotations

from collections.abc import Iterable

from ecos_agent.ecc_contracts import ECCParameterPatch, ECCStepName
from ecos_agent.workspace.knob_registry import authorized_knobs as _registry_authorized_knobs

# The Electron rerun execution gate (workspaceRerun.ts AUTHORIZED_KNOBS)
# authorizes place/CTS/legalization/route knobs only. Offering floorplan
# geometry here would produce contracts the GUI always rejects, so the GUI
# rerun surface excludes the floorplan steps entirely; geometry changes belong
# to the workspace spec (creation wizard) or controlled optimization. The
# underlying KNOB_SPECS entries stay: optimization parameter cards use them
# (product decision 2026-09-13, ecos/agent/docs/diff.md #8).
_GUI_RERUN_EXCLUDED_STEPS = frozenset(
    {
        ECCStepName.PRE_FLOORPLAN,
        ECCStepName.MACRO_PLACEMENT,
        ECCStepName.POST_FLOORPLAN,
    }
)

_AUTHORIZED_KNOBS = {
    step: knobs
    for step, knobs in _registry_authorized_knobs().items()
    if step not in _GUI_RERUN_EXCLUDED_STEPS
}


def authorized_knobs_for_step(target_step: ECCStepName) -> frozenset[str]:
    return _AUTHORIZED_KNOBS.get(target_step, frozenset())


def assert_authorized_parameter_patch(
    target_step: ECCStepName,
    parameter_patch: ECCParameterPatch | None,
) -> None:
    if parameter_patch is None:
        return
    assert_authorized_candidate_knobs(
        target_step,
        (item.knob_id for item in parameter_patch.items),
    )


def assert_authorized_candidate_knobs(
    target_step: ECCStepName,
    knob_ids: Iterable[str],
) -> None:
    unauthorized = sorted(set(knob_ids) - authorized_knobs_for_step(target_step))
    if unauthorized:
        raise ValueError(
            f"parameter patch knobs are not authorized for {target_step.value}: {unauthorized}"
        )
