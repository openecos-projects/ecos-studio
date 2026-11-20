from __future__ import annotations

import json
import shutil
from pathlib import Path

import pytest
from ecos_agent.hashing import canonical_sha256, file_sha256
from ecos_agent.knowledge.bundle import KnowledgeAnswer
from ecos_agent.optimization.contracts import (
    BudgetSnapshot,
    EpisodeBudget,
    OptimizationKnob,
    TimingMetric,
)
from ecos_agent.optimization.controller import CandidateExecutionEvidence
from ecos_agent.optimization.ledger import OptimizationOutcomeKind
from ecos_agent.optimization.observations import (
    OptimizationObservationError,
    build_candidate_terminal_observation,
    build_stage_observation,
    build_terminal_observation,
)
from ecos_agent.optimization.knowledge.retrieval import (
    KnowledgeChannel,
    OptimizationKnowledgeRetriever,
    build_optimization_retrieval_request,
)


def _budget() -> BudgetSnapshot:
    return BudgetSnapshot(
        budget=EpisodeBudget.from_reference_rerun(11.0),
        consumed_candidates=1,
        consumed_planning_calls=2,
    )


def _write_json(path: Path, payload: object) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, sort_keys=True), encoding="utf-8")


def _metrics(*items: tuple[str, float]) -> dict[str, object]:
    return {
        "status": "success",
        "metrics": [{"id": metric_id, "value": value} for metric_id, value in items],
    }


def _checklist(*items: tuple[str, str]) -> dict[str, object]:
    return {
        "status": "ready",
        "checklist": [{"id": item_id, "state": state} for item_id, state in items],
    }


def _harden_manifest_artifacts(candidate_root: Path) -> dict[str, dict[str, str]]:
    return {
        f"harden_{suffix}": {
            "ref": f"23_harden_ecc/output/tiny_harden.{suffix}",
            "sha256": file_sha256(
                candidate_root / f"23_harden_ecc/output/tiny_harden.{suffix}"
            ),
        }
        for suffix in ("gds", "lef", "lib")
    }


@pytest.fixture
def frozen_workspace(tmp_path: Path) -> Path:
    root = tmp_path / "workspace"
    _write_json(
        root / "home/flow.json",
        {
            "steps": [
                {"name": "synthesis", "directory": "01_synthesis_yosys", "state": "Success"},
                {"name": "pre_floorplan", "directory": "02_pre_floorplan_ecc", "state": "Success"},
                {"name": "macro_placement", "directory": "03_macro_placement_dreamplace", "state": "Success"},
                {"name": "post_floorplan", "directory": "04_post_floorplan_ecc", "state": "Success"},
                {"name": "placement", "directory": "06_placement_dreamplace", "state": "Success"},
                {"name": "cts", "directory": "09_cts_ecc", "state": "Success"},
                {"name": "legalization", "directory": "10_legalization_dreamplace", "state": "Success"},
                {"name": "timing_optimization", "directory": "11_timing_optimization_sizer", "state": "Success"},
                {"name": "routing", "directory": "12_routing_ecc", "state": "Success"},
                {"name": "drc", "directory": "15_drc_ecc", "state": "Success"},
                {"name": "lvs", "directory": "14_lvs_ecc", "state": "Success"},
                {"name": "filler", "directory": "13_filler_ecc", "state": "Success"},
                {"name": "rcx", "directory": "18_rcx_ecc", "state": "Success"},
                {"name": "sta", "directory": "19_sta_ecc", "state": "Success"},
                {"name": "power_analysis", "directory": "20_power_analysis_ecc", "state": "Success"},
                {"name": "harden", "directory": "23_harden_ecc", "state": "Success"},
            ]
        },
    )
    (root / "home/params.toml").write_text(
        'schema_version = 4\n[design]\nname = "tiny"\n[params.step_params.placement]\n'
        '"place.target_density" = 0.2\n"place.cell_padding_x" = 300\n"place.routability_opt_flag" = 1\n'
    )
    _write_json(
        root / "01_synthesis_yosys/analysis/qor_metrics.json",
        _metrics(
            ("synthesis_cell_area", 1200.0),
            ("runtime_seconds", 0.5),
            ("peak_memory_mb", 80.0),
        ),
    )
    _write_json(
        root / "04_post_floorplan_ecc/analysis/qor_metrics.json",
        _metrics(
            ("die_area", 3000.0),
            ("core_area", 2500.0),
            ("runtime_seconds", 0.75),
            ("peak_memory_mb", 90.0),
        ),
    )
    _write_json(
        root / "06_placement_dreamplace/analysis/qor_metrics.json",
        _metrics(
            ("place_hpwl", 4315.0),
            ("place_grwl", 3812.0),
            ("place_lutrudy_utilization_max", 0.88),
            ("place_rudy_utilization_max", 0.55),
            ("place_congestion_egr_overflow_max", 0),
            ("place_congestion_egr_overflow_total", 0),
            ("core_utilization", 0.52),
            ("place_total_wirelength", 123.0),
            ("runtime_seconds", 1.0),
            ("peak_memory_mb", 100.0),
        ),
    )
    _write_json(
        root / "09_cts_ecc/feature/cts.step.json",
        {
            "cts": {
                "total_clock_wirelength": 950.0,
                "clock_path_max_buffer": 4,
                "clock_path_min_buffer": 4,
            }
        },
    )
    _write_json(
        root / "09_cts_ecc/analysis/qor_metrics.json",
        _metrics(("runtime_seconds", 2.0), ("peak_memory_mb", 200.0)),
    )
    _write_json(
        root / "10_legalization_dreamplace/analysis/qor_metrics.json",
        _metrics(("runtime_seconds", 3.0), ("peak_memory_mb", 0.0)),
    )
    _write_json(
        root / "11_timing_optimization_sizer/analysis/qor_metrics.json",
        _metrics(("runtime_seconds", 3.5), ("peak_memory_mb", 0.0)),
    )
    _write_json(
        root / "12_routing_ecc/analysis/qor_metrics.json",
        _metrics(
            ("route_dr_total_violation_count", 0),
            ("route_dr_total_wirelength", 9999),
            ("route_la_total_overflow", 1),
            ("route_wirelength", 5243.741),
            ("route_via_count", 1705),
            ("route_dr_total_patch_count", 126),
            ("runtime_seconds", 4.0),
            ("peak_memory_mb", 300.0),
        ),
    )
    _write_json(
        root / "15_drc_ecc/analysis/qor_metrics.json",
        _metrics(("drc_count", 0), ("runtime_seconds", 5.0), ("peak_memory_mb", 100.0)),
    )
    _write_json(
        root / "14_lvs_ecc/analysis/qor_metrics.json",
        _metrics(("lvs_count", 0), ("runtime_seconds", 6.0), ("peak_memory_mb", 150.0)),
    )
    _write_json(
        root / "13_filler_ecc/analysis/qor_metrics.json",
        _metrics(("runtime_seconds", 7.0), ("peak_memory_mb", 0.0)),
    )
    _write_json(
        root / "18_rcx_ecc/analysis/qor_metrics.json",
        _metrics(
            ("rcx_expected_corner_count", 3),
            ("rcx_spef_file_count", 3),
            ("rcx_missing_corner_count", 0),
            ("rcx_spef_parse_failure_count", 0),
            ("runtime_seconds", 8.0),
            ("peak_memory_mb", 400.0),
        ),
    )
    _write_json(
        root / "19_sta_ecc/analysis/qor_metrics.json",
        _metrics(
            ("sta_setup_violation_count", 0),
            ("sta_hold_violation_count", 0),
            ("sta_setup_wns", 0.2),
            ("sta_setup_tns", 0.0),
            ("sta_hold_wns", 0.1),
            ("sta_hold_tns", 0.0),
            ("sta_corner_count", 3),
            ("sta_expected_corner_count", 3),
            ("sta_missing_corner_count", 0),
            ("runtime_seconds", 9.0),
            ("peak_memory_mb", 500.0),
        ),
    )
    _write_json(
        root / "23_harden_ecc/analysis/qor_metrics.json",
        _metrics(
            ("harden_artifact_missing_count", 0),
            ("runtime_seconds", 10.0),
            ("peak_memory_mb", 250.0),
        ),
    )
    corners = {
        "MAX_125/Cworst": (6.8, 0.2, 313, 105.2, 80.0),
        "ML_125/RCworst": (8.9, 0.1, 964, 103.3, 89.1),
        "TYP_25/TYPICAL": (8.5, 0.14, 672, 66.8, 0.267),
    }
    for corner, (
        setup_wns,
        hold_wns,
        frequency_mhz,
        dynamic_uw,
        leakage_uw,
    ) in corners.items():
        feature_root = root / "19_sta_ecc/feature" / corner
        _write_json(
            feature_root / "qor_summary.json",
            {
                "summary": {
                    "setup": {
                        "wns": setup_wns,
                        "tns": 0.0,
                        "nvp": 0,
                        "frequency_mhz": frequency_mhz,
                    },
                    "hold": {"wns": hold_wns, "tns": 0.0, "nvp": 0},
                },
                "design_statistics": {"cella": 1140.0},
            },
        )
    _write_json(root / "20_power_analysis_ecc/feature/power_summary.json", {
        "schema_version": 1, "internal_uw": 56.8, "switching_uw": 10,
        "dynamic_uw": 66.8, "leakage_uw": 0.267,
    })
    configured_corners = sorted(corners)
    _write_json(
        root / "19_sta_ecc/feature/sta.step.json",
        {
            "sta": {
                "expected_corner_count": len(configured_corners),
                "loaded_corners": configured_corners,
                "signoff_metrics": {
                    "corners": [{"sta_corner": corner} for corner in configured_corners]
                },
            }
        },
    )
    _write_json(
        root / "15_drc_ecc/checklist.json", _checklist(("quality.drc.clean", "pass"))
    )
    _write_json(
        root / "14_lvs_ecc/checklist.json", _checklist(("quality.lvs.clean", "pass"))
    )
    _write_json(
        root / "13_filler_ecc/checklist.json",
        _checklist(("quality.filler.complete", "pass")),
    )
    _write_json(
        root / "18_rcx_ecc/checklist.json",
        _checklist(
            ("quality.rcx.corner_coverage", "pass"),
            ("quality.rcx.spef_parse_health", "pass"),
        ),
    )
    _write_json(
        root / "19_sta_ecc/checklist.json",
        _checklist(
            ("quality.sta.setup_closed", "pass"),
            ("quality.sta.hold_closed", "pass"),
        ),
    )
    _write_json(
        root / "23_harden_ecc/checklist.json",
        _checklist(
            ("quality.mpc.minimum_area", "pass"),
            ("quality.mpc.maximum_area", "pass"),
        ),
    )
    for suffix in ("gds", "lef", "lib"):
        output = root / f"23_harden_ecc/output/tiny_harden.{suffix}"
        output.parent.mkdir(parents=True, exist_ok=True)
        output.write_text(suffix, encoding="utf-8")
    return root
