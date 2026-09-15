"""Logical knobs the Agent may propose from ECC-provided current values."""

from __future__ import annotations

import math
from dataclasses import dataclass
from typing import Mapping

from ecos_agent.ecc_contracts import ECCParameterPatchItem, ECCStepName

@dataclass(frozen=True)
class KnobSpec:
    """Authorization and value contract for one logical knob."""

    knob_id: str
    step: ECCStepName
    kind: str
    bounds: tuple[float, float] | None = None


_SPECS: tuple[KnobSpec, ...] = (
    KnobSpec("design.frequency_max", ECCStepName.SYNTHESIS, "positive_number"),
    KnobSpec("floorplan.utilitization", ECCStepName.FLOORPLAN, "ranged", (0.01, 1.0)),
    KnobSpec("floorplan.aspect_ratio", ECCStepName.FLOORPLAN, "positive_number"),
    KnobSpec("floorplan.die_width", ECCStepName.FLOORPLAN, "positive_number"),
    KnobSpec("floorplan.die_height", ECCStepName.FLOORPLAN, "positive_number"),
    KnobSpec("floorplan.global_right_padding", ECCStepName.FLOORPLAN, "zero_based_integer"),
    KnobSpec("place.target_density", ECCStepName.PLACEMENT, "ranged", (0.1, 0.95)),
    KnobSpec("place.target_overflow", ECCStepName.PLACEMENT, "ranged", (0.0, 1.0)),
    KnobSpec("place.cell_padding_x", ECCStepName.PLACEMENT, "zero_based_integer"),
    KnobSpec("place.routability_opt", ECCStepName.PLACEMENT, "boolean"),
    KnobSpec("place.density_weight", ECCStepName.PLACEMENT, "number"),
    KnobSpec("place.gp_noise_ratio", ECCStepName.PLACEMENT, "ranged", (0.0, 1.0)),
    KnobSpec("place.num_threads", ECCStepName.PLACEMENT, "integer"),
    KnobSpec("cts.skew_bound", ECCStepName.CTS, "ranged", (0.0, 1.0)),
    KnobSpec("cts.max_buf_tran", ECCStepName.CTS, "number"),
    KnobSpec("cts.root_input_slew", ECCStepName.CTS, "number"),
    KnobSpec("cts.max_sink_tran", ECCStepName.CTS, "number"),
    KnobSpec("cts.max_cap", ECCStepName.CTS, "number"),
    KnobSpec("cts.wirelength_unit_um", ECCStepName.CTS, "number"),
    KnobSpec("cts.wirelength_iterations", ECCStepName.CTS, "integer"),
    KnobSpec("cts.slew_steps", ECCStepName.CTS, "integer"),
    KnobSpec("cts.cap_steps", ECCStepName.CTS, "integer"),
    KnobSpec("cts.wire_width", ECCStepName.CTS, "number"),
    KnobSpec("cts.max_fanout", ECCStepName.CTS, "integer"),
    KnobSpec("cts.routing_layer", ECCStepName.CTS, "int_list"),
    KnobSpec("cts.buffer_type", ECCStepName.CTS, "str_list"),
    KnobSpec("cts.char_buf_redundancy_pct", ECCStepName.CTS, "number"),
    KnobSpec("cts.force_branch_buffer", ECCStepName.CTS, "boolean"),
    KnobSpec("cts.htree_depth_explore_window", ECCStepName.CTS, "integer"),
    KnobSpec("cts.htree_topology_tolerance", ECCStepName.CTS, "number"),
    KnobSpec("cts.enable_analytical_htree", ECCStepName.CTS, "boolean"),
    KnobSpec("cts.enable_sink_clustering", ECCStepName.CTS, "boolean"),
    KnobSpec("legalization.cell_padding_x", ECCStepName.LEGALIZATION, "zero_based_integer"),
    KnobSpec("legalization.bndry_padding_x", ECCStepName.LEGALIZATION, "integer"),
    KnobSpec("legalization.bndry_padding_y", ECCStepName.LEGALIZATION, "integer"),
    KnobSpec("legalization.detailed_place_flag", ECCStepName.LEGALIZATION, "boolean"),
    KnobSpec("legalization.num_threads", ECCStepName.LEGALIZATION, "integer"),
    KnobSpec("legalization.deterministic", ECCStepName.LEGALIZATION, "boolean"),
    KnobSpec("route.bottom_layer", ECCStepName.ROUTING, "string"),
    KnobSpec("route.top_layer", ECCStepName.ROUTING, "string"),
    KnobSpec("route.thread_number", ECCStepName.ROUTING, "integer"),
    KnobSpec("route.enable_timing", ECCStepName.ROUTING, "boolean"),
)


KNOB_SPECS: Mapping[str, KnobSpec] = {spec.knob_id: spec for spec in _SPECS}

BOOLEAN_KNOBS = frozenset(spec.knob_id for spec in _SPECS if spec.kind == "boolean")


def authorized_knobs() -> dict[ECCStepName, frozenset[str]]:
    """Knob ids grouped by the ECC step that authorizes them."""
    grouped: dict[ECCStepName, set[str]] = {}
    for spec in _SPECS:
        grouped.setdefault(spec.step, set()).add(spec.knob_id)
    return {step: frozenset(ids) for step, ids in grouped.items()}


def knob_spec(knob_id: str) -> KnobSpec:
    spec = KNOB_SPECS.get(knob_id)
    if spec is None:
        raise ValueError(f"unsupported parameter: {knob_id}")
    return spec


def validate_value(item: ECCParameterPatchItem) -> None:
    """Reject values a knob cannot legally take.

    Value bounds are the practical safety net for parameter changes: a
    structurally valid but out-of-range value is what actually breaks a flow.
    """
    spec = knob_spec(item.knob_id)
    value = item.value
    kind = spec.kind
    if kind == "ranged":
        assert spec.bounds is not None
        lower, upper = spec.bounds
        if type(value) not in {int, float} or not lower <= value <= upper:
            raise ValueError(f"{item.knob_id} is outside {lower:g}..{upper:g}")
    elif kind == "integer":
        if type(value) is not int or value < 1:
            raise ValueError(f"{item.knob_id} must be an integer >= 1")
    elif kind == "zero_based_integer":
        if type(value) is not int or value < 0:
            raise ValueError(f"{item.knob_id} must be an integer >= 0")
    elif kind == "boolean":
        if type(value) is not bool:
            raise ValueError(f"{item.knob_id} must be a boolean")
    elif kind == "string":
        if type(value) is not str or not value.strip():
            raise ValueError(f"{item.knob_id} must be a non-empty string")
    elif kind == "int_list":
        if (
            not isinstance(value, list)
            or not value
            or len(value) != len(set(value))
            or any(type(entry) is not int or entry < 1 for entry in value)
        ):
            raise ValueError(f"{item.knob_id} must be a non-empty unique integer list >= 1")
    elif kind == "str_list":
        if (
            not isinstance(value, list)
            or not value
            or len(value) != len(set(value))
            or any(type(entry) is not str or not entry.strip() for entry in value)
        ):
            raise ValueError(f"{item.knob_id} must be a non-empty unique string list")
    elif kind == "positive_number":
        if type(value) not in {int, float} or not math.isfinite(value) or value <= 0:
            raise ValueError(f"{item.knob_id} must be a finite number > 0")
    else:
        if type(value) not in {int, float} or not math.isfinite(value) or value < 0:
            raise ValueError(f"{item.knob_id} must be a finite number >= 0")
