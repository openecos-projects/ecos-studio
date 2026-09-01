"""Static ECOS Agent authorization for executable ECC candidate parameters."""

from __future__ import annotations

from collections.abc import Iterable

from ecos_agent.ecc_contracts import ECCParameterPatch, ECCStepName
from ecos_agent.knob_registry import authorized_knobs

_AUTHORIZED_KNOBS = authorized_knobs()


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
            f"candidate patch knobs are not authorized for {target_step.value}: {unauthorized}"
        )
