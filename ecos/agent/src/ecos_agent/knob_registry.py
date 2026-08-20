"""Single source of truth for ECOS Agent tunable workspace parameters.

Every tunable knob is declared exactly once here: which ECC step authorizes it,
which on-disk surface owns it, and how its value is constrained. Both the read
path (contract "current value") and the write path (GUI execution target)
resolve through this registry, so the two can never drift.

Two surfaces exist in an ECOS workspace and ECC keeps them in sync:

- ``parameters`` -- ``home/parameters.json``, the ICS55 flat template. It is the
  authoritative source; ``refresh_config`` regenerates step configs from it.
- ``step_config`` -- ``config/*.json`` per-tool configuration, mirroring the ECC
  candidate registry's ``config_key`` / ``json_path``. ``sync_config`` pushes a
  change here back into ``parameters`` and then refreshes.

A knob may exist on one surface or both. Reads use the ECC-canonical surface
(the step config, which the candidate rerun system applies to). Writes use the
authoritative surface, and the caller must always invoke the matching sync RPC
so the two converge -- skipping it is what makes the surfaces drift apart.
"""

from __future__ import annotations

import math
from dataclasses import dataclass
from typing import Literal, Mapping

from ecos_agent.ecc_contracts import ECCParameterPatchItem, ECCStepName

KnobSurface = Literal["parameters", "step_config"]

PARAMETERS_FILE = "home/parameters.json"
DREAMPLACE_FILE = "config/dreamplace_ecc.json"
CTS_FILE = "config/cts_ecc.json"
ROUTE_FILE = "config/route_ecc.json"

WRITABLE_FILES = frozenset({PARAMETERS_FILE, DREAMPLACE_FILE, CTS_FILE, ROUTE_FILE})


@dataclass(frozen=True)
class KnobTarget:
    """Where a knob physically lives inside the workspace."""

    surface: KnobSurface
    file: str
    json_path: tuple[str | int, ...]


@dataclass(frozen=True)
class KnobSpec:
    """Authorization, location, and value contract for one tunable knob."""

    knob_id: str
    step: ECCStepName
    kind: str
    config: KnobTarget | None = None
    parameters: KnobTarget | None = None
    bounds: tuple[float, float] | None = None
    # parameters.json stores some flags as 0/1 rather than JSON booleans.
    store_boolean_as_int: bool = False

    @property
    def read_target(self) -> KnobTarget:
        """ECC-canonical surface: what the candidate rerun system applies to."""
        target = self.config or self.parameters
        assert target is not None
        return target

    @property
    def write_target(self) -> KnobTarget:
        """Authoritative surface; step configs are regenerated from parameters."""
        target = self.parameters or self.config
        assert target is not None
        return target


def _parameters(*json_path: str | int) -> KnobTarget:
    return KnobTarget(surface="parameters", file=PARAMETERS_FILE, json_path=json_path)


def _dreamplace(key: str) -> KnobTarget:
    return KnobTarget(surface="step_config", file=DREAMPLACE_FILE, json_path=(key,))


def _cts(key: str) -> KnobTarget:
    return KnobTarget(surface="step_config", file=CTS_FILE, json_path=(key,))


def _route(key: str) -> KnobTarget:
    return KnobTarget(surface="step_config", file=ROUTE_FILE, json_path=("RT", key))


_SPECS: tuple[KnobSpec, ...] = (
    # -- Synthesis: global design intent -------------------------------------
    KnobSpec("design.clock", ECCStepName.SYNTHESIS, "string", parameters=_parameters("Clock")),
    KnobSpec(
        "design.frequency_max",
        ECCStepName.SYNTHESIS,
        "positive_number",
        parameters=_parameters("Frequency max [MHz]"),
    ),
    # -- Floorplan: die and core geometry ------------------------------------
    KnobSpec(
        "floorplan.utilitization",
        ECCStepName.FLOORPLAN,
        "ranged",
        parameters=_parameters("Core", "Utilitization"),
        bounds=(0.01, 1.0),
    ),
    KnobSpec(
        "floorplan.aspect_ratio",
        ECCStepName.FLOORPLAN,
        "positive_number",
        parameters=_parameters("Core", "Aspect ratio"),
    ),
    KnobSpec(
        "floorplan.margin_x",
        ECCStepName.FLOORPLAN,
        "number",
        parameters=_parameters("Core", "Margin", 0),
    ),
    KnobSpec(
        "floorplan.margin_y",
        ECCStepName.FLOORPLAN,
        "number",
        parameters=_parameters("Core", "Margin", 1),
    ),
    KnobSpec(
        "floorplan.die_width",
        ECCStepName.FLOORPLAN,
        "positive_number",
        parameters=_parameters("Die", "Size", 0),
    ),
    KnobSpec(
        "floorplan.die_height",
        ECCStepName.FLOORPLAN,
        "positive_number",
        parameters=_parameters("Die", "Size", 1),
    ),
    KnobSpec(
        "floorplan.global_right_padding",
        ECCStepName.FLOORPLAN,
        "zero_based_integer",
        parameters=_parameters("Global right padding"),
    ),
    # -- Placement -----------------------------------------------------------
    KnobSpec(
        "place.target_density",
        ECCStepName.PLACEMENT,
        "ranged",
        config=_dreamplace("target_density"),
        parameters=_parameters("Target density"),
        bounds=(0.1, 0.95),
    ),
    KnobSpec(
        "place.target_overflow",
        ECCStepName.PLACEMENT,
        "ranged",
        config=_dreamplace("stop_overflow"),
        parameters=_parameters("Target overflow"),
        bounds=(0.0, 1.0),
    ),
    KnobSpec(
        "place.cell_padding_x",
        ECCStepName.PLACEMENT,
        "zero_based_integer",
        config=_dreamplace("cell_padding_x"),
        parameters=_parameters("Cell padding x"),
    ),
    KnobSpec(
        "place.routability_opt",
        ECCStepName.PLACEMENT,
        "boolean",
        config=_dreamplace("routability_opt_flag"),
        parameters=_parameters("Routability opt flag"),
        store_boolean_as_int=True,
    ),
    KnobSpec(
        "place.density_weight", ECCStepName.PLACEMENT, "number", config=_dreamplace("density_weight")
    ),
    KnobSpec(
        "place.gp_noise_ratio",
        ECCStepName.PLACEMENT,
        "ranged",
        config=_dreamplace("gp_noise_ratio"),
        bounds=(0.0, 1.0),
    ),
    KnobSpec(
        "place.num_threads", ECCStepName.PLACEMENT, "integer", config=_dreamplace("num_threads")
    ),
    # -- Clock tree synthesis ------------------------------------------------
    KnobSpec(
        "cts.skew_bound", ECCStepName.CTS, "ranged", config=_cts("skew_bound"), bounds=(0.0, 1.0)
    ),
    KnobSpec("cts.max_buf_tran", ECCStepName.CTS, "number", config=_cts("max_buf_tran")),
    KnobSpec("cts.root_input_slew", ECCStepName.CTS, "number", config=_cts("root_input_slew")),
    KnobSpec("cts.max_sink_tran", ECCStepName.CTS, "number", config=_cts("max_sink_tran")),
    KnobSpec("cts.max_cap", ECCStepName.CTS, "number", config=_cts("max_cap")),
    KnobSpec("cts.wirelength_unit_um", ECCStepName.CTS, "number", config=_cts("wirelength_unit_um")),
    KnobSpec(
        "cts.wirelength_iterations",
        ECCStepName.CTS,
        "integer",
        config=_cts("wirelength_iterations"),
    ),
    KnobSpec("cts.slew_steps", ECCStepName.CTS, "integer", config=_cts("slew_steps")),
    KnobSpec("cts.cap_steps", ECCStepName.CTS, "integer", config=_cts("cap_steps")),
    KnobSpec("cts.wire_width", ECCStepName.CTS, "number", config=_cts("wire_width")),
    KnobSpec(
        "cts.max_fanout",
        ECCStepName.CTS,
        "integer",
        config=_cts("max_fanout"),
        parameters=_parameters("Max fanout"),
    ),
    KnobSpec("cts.routing_layer", ECCStepName.CTS, "int_list", config=_cts("routing_layer")),
    KnobSpec("cts.buffer_type", ECCStepName.CTS, "str_list", config=_cts("buffer_type")),
    KnobSpec(
        "cts.char_buf_redundancy_pct",
        ECCStepName.CTS,
        "number",
        config=_cts("char_buf_redundancy_pct"),
    ),
    KnobSpec(
        "cts.force_branch_buffer", ECCStepName.CTS, "boolean", config=_cts("force_branch_buffer")
    ),
    KnobSpec(
        "cts.htree_depth_explore_window",
        ECCStepName.CTS,
        "integer",
        config=_cts("htree_depth_explore_window"),
    ),
    KnobSpec(
        "cts.htree_topology_tolerance",
        ECCStepName.CTS,
        "number",
        config=_cts("htree_topology_tolerance"),
    ),
    KnobSpec(
        "cts.enable_analytical_htree",
        ECCStepName.CTS,
        "boolean",
        config=_cts("enable_analytical_htree"),
    ),
    KnobSpec(
        "cts.enable_sink_clustering",
        ECCStepName.CTS,
        "boolean",
        config=_cts("enable_sink_clustering"),
    ),
    # -- Legalization --------------------------------------------------------
    KnobSpec(
        "legalization.cell_padding_x",
        ECCStepName.LEGALIZATION,
        "zero_based_integer",
        config=_dreamplace("cell_padding_x"),
    ),
    KnobSpec(
        "legalization.bndry_padding_x",
        ECCStepName.LEGALIZATION,
        "integer",
        config=_dreamplace("bndry_padding_x"),
    ),
    KnobSpec(
        "legalization.bndry_padding_y",
        ECCStepName.LEGALIZATION,
        "integer",
        config=_dreamplace("bndry_padding_y"),
    ),
    KnobSpec(
        "legalization.detailed_place_flag",
        ECCStepName.LEGALIZATION,
        "boolean",
        config=_dreamplace("detailed_place_flag"),
    ),
    KnobSpec(
        "legalization.num_threads",
        ECCStepName.LEGALIZATION,
        "integer",
        config=_dreamplace("num_threads"),
    ),
    KnobSpec(
        "legalization.deterministic",
        ECCStepName.LEGALIZATION,
        "boolean",
        config=_dreamplace("deterministic_flag"),
    ),
    # -- Routing -------------------------------------------------------------
    KnobSpec(
        "route.bottom_layer",
        ECCStepName.ROUTING,
        "string",
        config=_route("-bottom_routing_layer"),
        parameters=_parameters("Bottom layer"),
    ),
    KnobSpec(
        "route.top_layer",
        ECCStepName.ROUTING,
        "string",
        config=_route("-top_routing_layer"),
        parameters=_parameters("Top layer"),
    ),
    KnobSpec(
        "route.thread_number", ECCStepName.ROUTING, "integer", config=_route("-thread_number")
    ),
    KnobSpec(
        "route.enable_timing", ECCStepName.ROUTING, "boolean", config=_route("-enable_timing")
    ),
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


def storage_value(item: ECCParameterPatchItem) -> object:
    """On-disk representation of a validated patch value."""
    spec = knob_spec(item.knob_id)
    if spec.store_boolean_as_int:
        return 1 if item.value is True else 0
    return item.value


def resolve_write(item: ECCParameterPatchItem) -> dict[str, object]:
    """Execution instruction for the GUI: exactly where and what to write.

    Emitting the resolved target with the contract keeps the knob mapping in one
    place; the GUI executes the instruction instead of holding its own table.
    """
    target = knob_spec(item.knob_id).write_target
    return {
        "knob_id": item.knob_id,
        "value": storage_value(item),
        "surface": target.surface,
        "file": target.file,
        "json_path": list(target.json_path),
    }


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
