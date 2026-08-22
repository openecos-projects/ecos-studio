from __future__ import annotations

import json
from pathlib import Path

import pytest

from ecos_agent.optimization_runtime import (
    OptimizationRuntimeError,
    _place_to_harden_runtime_seconds,
)


_STAGES = (
    "place_dreamplace",
    "CTS_ecc",
    "legalization_dreamplace",
    "route_ecc",
    "drc_ecc",
    "lvs_ecc",
    "filler_ecc",
    "RCX_ecc",
    "sta_ecc",
    "Harden_ecc",
)


def test_place_to_harden_runtime_uses_all_terminal_stages(tmp_path: Path) -> None:
    for index, stage in enumerate(_STAGES, start=1):
        path = tmp_path / stage / "analysis"
        path.mkdir(parents=True)
        (path / "qor_metrics.json").write_text(
            json.dumps({"metrics": [{"id": "runtime_seconds", "value": index}]}),
            encoding="utf-8",
        )

    assert _place_to_harden_runtime_seconds(tmp_path) == sum(range(1, 11))


def test_place_to_harden_runtime_fails_closed_on_missing_stage(tmp_path: Path) -> None:
    with pytest.raises(OptimizationRuntimeError, match="QoR evidence"):
        _place_to_harden_runtime_seconds(tmp_path)
