from __future__ import annotations

import json
from pathlib import Path

import pytest

from ecos_agent.optimization_runtime import (
    OptimizationRuntimeError,
    _place_to_harden_runtime_seconds,
)


_STAGES = (
    "place",
    "CTS",
    "legalization",
    "route",
    "drc",
    "lvs",
    "filler",
    "RCX",
    "sta",
    "Harden",
)


def _write_flow(tmp_path: Path, *, states: dict[str, str] | None = None) -> None:
    (tmp_path / "home").mkdir()
    (tmp_path / "home" / "flow.json").write_text(
        json.dumps(
            {
                "steps": [
                    {
                        "name": stage,
                        "state": (states or {}).get(stage, "Success"),
                        "runtime": f"0:0:{index}",
                    }
                    for index, stage in enumerate(_STAGES)
                ]
            }
        ),
        encoding="utf-8",
    )


def test_place_to_harden_runtime_uses_successful_flow_records(tmp_path: Path) -> None:
    _write_flow(tmp_path)

    assert _place_to_harden_runtime_seconds(tmp_path) == sum(range(10))


def test_place_to_harden_runtime_fails_closed_on_incomplete_stage(tmp_path: Path) -> None:
    _write_flow(tmp_path, states={"place": "Ongoing"})

    with pytest.raises(OptimizationRuntimeError, match="flow completion evidence"):
        _place_to_harden_runtime_seconds(tmp_path)
