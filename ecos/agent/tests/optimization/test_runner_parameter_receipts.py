from __future__ import annotations



from ecos_agent.optimization.contracts import TimingMetric
from ecos_agent.optimization.rules import (
    coordinate_value_from_native_receipt,
    native_receipt_is_effective,
)

_HASH = "sha256:" + "a" * 64
_CHUNK_HASH = "b" * 64
_CURRENT_VALUES = {
    "place.target_density": 0.2,
    "place.target_overflow": 0.1,
    "place.cell_padding_x": 2,
    "place.routability_opt": True,
    "place.density_weight": 0.00085,
    "floorplan.core_util": 0.6,
    "floorplan.aspect_ratio": 1.0,
}
_TIMING_GUARDRAIL = {metric: 0.0 for metric in TimingMetric}



from tests.optimization.runner_support import _native_receipt

def test_disabled_controls_are_effective_without_special_cases() -> None:
    assert native_receipt_is_effective(
        _native_receipt(
            "place.routability_opt", False, status="effective"
        )
    )
    assert not native_receipt_is_effective(
        _native_receipt(
            "place.routability_opt", True, status="inactive"
        )
    )
    assert native_receipt_is_effective(_native_receipt("place.cell_padding_x", 0))


def test_native_receipt_coordinates_use_actual_parameter_units() -> (
    None
):
    assert (
        coordinate_value_from_native_receipt(
            _native_receipt("place.density_weight", 0.001),
        )
        == 0.001
    )
    assert (
        coordinate_value_from_native_receipt(
            _native_receipt("place.cell_padding_x", 2, effective_value=1),
        )
        == 1
    )
