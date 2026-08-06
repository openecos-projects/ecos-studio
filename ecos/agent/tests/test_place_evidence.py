import json
from pathlib import Path

import pytest

from ecos_agent.place_evidence import build_place_evidence


def test_collects_whitelisted_place_configuration_and_metrics(tmp_path: Path) -> None:
    workspace = tmp_path / "gcd"
    (workspace / "home").mkdir(parents=True)
    (workspace / "config").mkdir()
    analysis = workspace / "place_dreamplace" / "analysis"
    analysis.mkdir(parents=True)
    (workspace / "home" / "flow.json").write_text(
        json.dumps({"steps": [{"name": "place", "state": "Success"}]}), encoding="utf-8"
    )
    (workspace / "config" / "dreamplace.json").write_text(
        json.dumps({"target_density": 0.7, "detailed_place_flag": 0}), encoding="utf-8"
    )
    (analysis / "qor_metrics.json").write_text(
        json.dumps(
            {
                "schema_version": 3,
                "metrics": [
                    {"id": "place_hpwl", "value": 12.5},
                    {"id": "place_rudy_utilization_max", "value": 0.8},
                    {"id": "route_wirelength", "value": 99},
                ],
            }
        ),
        encoding="utf-8",
    )

    evidence = build_place_evidence(workspace)

    assert evidence.workspace_id == "gcd"
    assert evidence.step_status == {"place": "Success"}
    assert evidence.effective_config == {"detailed_place_flag": 0, "target_density": 0.7}
    assert evidence.metrics == {"place_hpwl": 12.5, "place_rudy_utilization_max": 0.8}
    assert {artifact.relative_path for artifact in evidence.artifacts} == {
        "config/dreamplace.json",
        "home/flow.json",
        "place_dreamplace/analysis/qor_metrics.json",
    }


def test_rejects_workspace_files_that_escape_through_a_symlink(tmp_path: Path) -> None:
    workspace = tmp_path / "gcd"
    workspace.mkdir()
    outside = tmp_path / "outside.json"
    outside.write_text("{}", encoding="utf-8")
    (workspace / "home").symlink_to(tmp_path)

    with pytest.raises(ValueError, match="workspace evidence"):
        build_place_evidence(workspace)
