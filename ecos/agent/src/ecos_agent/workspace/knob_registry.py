"""Single source of truth for ECOS Agent tunable workspace parameters.

Every tunable knob is declared exactly once here: which ECC step authorizes it,
which on-disk surface owns it, and how its value is constrained. Both the read
path (contract "current value") and the write path (GUI execution target)
resolve through this registry, so the two can never drift.

ECC stores workspace overrides in home/params.toml. Each DreamPlace worker
resolves its own tool config in its ledger-recorded step directory.
"""

from __future__ import annotations

import math
from dataclasses import dataclass
from typing import Literal, Mapping

from ecos_agent.ecc_contracts import ECCParameterPatchItem, ECCStepName

KnobSurface = Literal["parameters", "step_config"]

PARAMS_TOML_FILE = "home/params.toml"
DREAMPLACE_FILE = "config/dreamplace_ecc.json"
CTS_FILE = "config/cts_ecc.json"
ROUTE_FILE = "config/routing_ecc.json"

WRITABLE_FILES = frozenset({PARAMS_TOML_FILE, DREAMPLACE_FILE, CTS_FILE, ROUTE_FILE})


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
    # The DreamPlace config stores its routability flag as an integer.
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


def _params_toml(*json_path: str | int) -> KnobTarget:
    return KnobTarget(surface="parameters", file=PARAMS_TOML_FILE, json_path=json_path)


def _dreamplace(key: str) -> KnobTarget:
    return KnobTarget(surface="step_config", file=DREAMPLACE_FILE, json_path=(key,))


def _placement_parameter(field: str) -> KnobTarget:
    return _params_toml("params", "step_params", "placement", f"place.{field}")


def _cts(key: str) -> KnobTarget:
    return KnobTarget(surface="step_config", file=CTS_FILE, json_path=(key,))


def _route(key: str) -> KnobTarget:
    return KnobTarget(surface="step_config", file=ROUTE_FILE, json_path=("RT", key))


_SPECS: tuple[KnobSpec, ...] = (
    # -- Synthesis: global design intent -------------------------------------
    KnobSpec("design.clock", ECCStepName.SYNTHESIS, "string", parameters=_params_toml("design", "clock_port")),
    KnobSpec(
        "design.frequency_max",
        ECCStepName.SYNTHESIS,
        "positive_number",
        parameters=_params_toml("design", "frequency_mhz"),
    ),
    # -- Floorplan: die and core geometry ------------------------------------
    KnobSpec(
        "floorplan.utilitization",
        ECCStepName.POST_FLOORPLAN,
        "ranged",
        parameters=_params_toml("params", "core", "utilitization"),
        bounds=(0.01, 1.0),
    ),
    KnobSpec(
        "floorplan.aspect_ratio",
        ECCStepName.POST_FLOORPLAN,
        "positive_number",
        parameters=_params_toml("params", "core", "aspect_ratio"),
    ),
    KnobSpec(
        "floorplan.margin_x",
        ECCStepName.POST_FLOORPLAN,
        "number",
        parameters=_params_toml("params", "core", "margin", 0),
    ),
    KnobSpec(
        "floorplan.margin_y",
        ECCStepName.POST_FLOORPLAN,
        "number",
        parameters=_params_toml("params", "core", "margin", 1),
    ),
    KnobSpec(
        "floorplan.die_width",
        ECCStepName.POST_FLOORPLAN,
        "positive_number",
        parameters=_params_toml("params", "die", "size", 0),
    ),
    KnobSpec(
        "floorplan.die_height",
        ECCStepName.POST_FLOORPLAN,
        "positive_number",
        parameters=_params_toml("params", "die", "size", 1),
    ),
    # -- Placement -----------------------------------------------------------
    KnobSpec(
        "place.target_density",
        ECCStepName.PLACEMENT,
        "ranged",
        config=_dreamplace("target_density"),
        parameters=_placement_parameter("target_density"),
        bounds=(0.1, 0.95),
    ),
    KnobSpec(
        "place.target_overflow",
        ECCStepName.PLACEMENT,
        "ranged",
        config=_dreamplace("stop_overflow"),
        parameters=_placement_parameter("stop_overflow"),
        bounds=(0.0, 1.0),
    ),
    KnobSpec(
        "place.cell_padding_x",
        ECCStepName.PLACEMENT,
        "zero_based_integer",
        config=_dreamplace("cell_padding_x"),
        parameters=_placement_parameter("cell_padding_x"),
    ),
    KnobSpec(
        "place.routability_opt",
        ECCStepName.PLACEMENT,
        "boolean",
        config=_dreamplace("routability_opt_flag"),
        parameters=_placement_parameter("routability_opt_flag"),
        store_boolean_as_int=True,
    ),
    KnobSpec(
        "place.density_weight",
        ECCStepName.PLACEMENT,
        "number",
        config=_dreamplace("density_weight"),
        parameters=_placement_parameter("density_weight")
    ),
    KnobSpec(
        "place.gp_noise_ratio",
        ECCStepName.PLACEMENT,
        "ranged",
        config=_dreamplace("gp_noise_ratio"),
        parameters=_placement_parameter("gp_noise_ratio"),
        bounds=(0.0, 1.0),
    ),
    KnobSpec(
        "place.num_threads",
        ECCStepName.PLACEMENT,
        "integer",
        config=_dreamplace("num_threads"),
        parameters=_placement_parameter("num_threads")
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
    # -- Routing -------------------------------------------------------------
    KnobSpec(
        "route.bottom_layer",
        ECCStepName.ROUTING,
        "string",
        config=_route("-bottom_routing_layer"),
    ),
    KnobSpec(
        "route.top_layer",
        ECCStepName.ROUTING,
        "string",
        config=_route("-top_routing_layer"),
    ),
    KnobSpec(
        "route.thread_number", ECCStepName.ROUTING, "integer", config=_route("-thread_number")
    ),
    KnobSpec(
        "route.enable_timing", ECCStepName.ROUTING, "boolean", config=_route("-enable_timing")
    ),
)


KNOB_SPECS: Mapping[str, KnobSpec] = {spec.knob_id: spec for spec in _SPECS}
KNOB_SPECS = {
    **KNOB_SPECS,
    "floorplan.core_util": KNOB_SPECS["floorplan.utilitization"],
}

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
    spec = knob_spec(item.knob_id)
    target = spec.write_target
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
