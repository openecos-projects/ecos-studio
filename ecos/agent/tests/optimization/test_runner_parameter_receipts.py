from ecos_agent.optimization.rules import native_receipt_is_effective
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
