"""Static ECOS Agent authorization for executable ECC candidate parameters."""

from __future__ import annotations

from collections.abc import Iterable

from ecos_agent.ecc_contracts import ECCParameterPatch, ECCStepName


_AUTHORIZED_KNOBS = {
    ECCStepName.PLACEMENT: frozenset(
        {
            "place.target_density",
            "place.target_overflow",
            "place.cell_padding_x",
            "place.routability_opt",
            "place.density_weight",
            "place.gp_noise_ratio",
            "place.num_threads",
        }
    ),
    ECCStepName.CTS: frozenset(
        {
            "cts.skew_bound",
            "cts.max_buf_tran",
            "cts.root_input_slew",
            "cts.max_sink_tran",
            "cts.max_cap",
            "cts.wirelength_unit_um",
            "cts.wirelength_iterations",
            "cts.slew_steps",
            "cts.cap_steps",
            "cts.wire_width",
            "cts.max_fanout",
            "cts.routing_layer",
            "cts.buffer_type",
            "cts.char_buf_redundancy_pct",
            "cts.force_branch_buffer",
            "cts.htree_depth_explore_window",
            "cts.htree_topology_tolerance",
            "cts.enable_analytical_htree",
            "cts.enable_sink_clustering",
        }
    ),
    ECCStepName.LEGALIZATION: frozenset(
        {
            "legalization.cell_padding_x",
            "legalization.bndry_padding_x",
            "legalization.bndry_padding_y",
            "legalization.detailed_place_flag",
            "legalization.num_threads",
            "legalization.deterministic",
        }
    ),
    ECCStepName.ROUTING: frozenset(
        {
            "route.bottom_layer",
            "route.top_layer",
            "route.thread_number",
            "route.enable_timing",
        }
    ),
}


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
    unauthorized = sorted(set(knob_ids) - _AUTHORIZED_KNOBS.get(target_step, frozenset()))
    if unauthorized:
        raise ValueError(
            f"candidate patch knobs are not authorized for {target_step.value}: {unauthorized}"
        )
