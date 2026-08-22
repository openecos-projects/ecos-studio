from __future__ import annotations

import json
from pathlib import Path

import pytest

from ecos_agent.knowledge_bundle import KnowledgeAnswer
from ecos_agent.optimization_contracts import (
    BudgetSnapshot,
    EpisodeBudget,
    OptimizationKnob,
)
from ecos_agent.optimization_ledger import OptimizationOutcomeKind
from ecos_agent.optimization_observations import (
    OptimizationObservationError,
    build_stage_observation,
    build_terminal_observation,
)
from ecos_agent.optimization_retrieval import (
    KnowledgeChannel,
    OptimizationKnowledgeRetriever,
    build_optimization_retrieval_request,
)


def _budget() -> BudgetSnapshot:
    return BudgetSnapshot(
        budget=EpisodeBudget.from_default_reruns((10.0, 11.0, 12.0)),
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


@pytest.fixture
def frozen_workspace(tmp_path: Path) -> Path:
    root = tmp_path / "workspace"
    _write_json(
        root / "home/flow.json",
        {
            "steps": [
                {"name": "place", "state": "Success"},
                {"name": "route", "state": "Success"},
                {"name": "drc", "state": "Success"},
                {"name": "sta", "state": "Success"},
                {"name": "Harden", "state": "Success"},
            ]
        },
    )
    _write_json(
        root / "home/parameters.json",
        {"Design": "tiny", "Target density": 0.2, "Cell padding x": 300, "Routability opt flag": 1},
    )
    _write_json(
        root / "place_dreamplace/analysis/qor_metrics.json",
        _metrics(("place_lutrudy_utilization_max", 0.88), ("place_total_wirelength", 123.0)),
    )
    _write_json(
        root / "route_ecc/analysis/qor_metrics.json",
        _metrics(
            ("route_dr_total_violation_count", 0),
            ("route_la_total_overflow", 1),
            ("route_wirelength", 5243.741),
        ),
    )
    _write_json(root / "drc_ecc/analysis/qor_metrics.json", _metrics(("drc_count", 0)))
    _write_json(
        root / "sta_ecc/analysis/qor_metrics.json",
        _metrics(("sta_setup_violation_count", 0), ("sta_hold_violation_count", 0)),
    )
    _write_json(
        root / "Harden_ecc/analysis/qor_metrics.json",
        _metrics(("harden_artifact_missing_count", 0)),
    )
    _write_json(root / "drc_ecc/checklist.json", _checklist(("quality.drc.clean", "pass")))
    _write_json(
        root / "sta_ecc/checklist.json",
        _checklist(
            ("quality.sta.setup_closed", "pass"),
            ("quality.sta.hold_closed", "pass"),
        ),
    )
    _write_json(
        root / "Harden_ecc/checklist.json",
        _checklist(
            ("quality.mpc.minimum_area", "pass"),
            ("quality.mpc.maximum_area", "pass"),
        ),
    )
    for suffix in ("gds", "lef", "lib"):
        output = root / f"Harden_ecc/output/tiny_Harden.{suffix}"
        output.parent.mkdir(parents=True, exist_ok=True)
        output.write_text(suffix, encoding="utf-8")
    return root


def test_stage_observation_reads_only_the_fixed_stage_artifacts(
    frozen_workspace: Path,
) -> None:
    observation = build_stage_observation(
        frozen_workspace,
        "place",
        budget=_budget(),
    )

    assert observation.observation_id == "stage-place"
    assert observation.metrics == {
        "place_lutrudy_utilization_max": 0.88,
        "place_total_wirelength": 123.0,
    }
    assert observation.requested_knobs == ()
    assert observation.budget.remaining_candidates == 5

    repeated = build_stage_observation(frozen_workspace, "place", budget=_budget())
    assert repeated.evidence_manifest_sha256 == observation.evidence_manifest_sha256


def test_stage_observation_rejects_incomplete_and_unsafe_workspace_evidence(
    frozen_workspace: Path,
    tmp_path: Path,
) -> None:
    flow_path = frozen_workspace / "home/flow.json"
    flow = json.loads(flow_path.read_text(encoding="utf-8"))
    flow["steps"][0]["state"] = "Running"
    _write_json(flow_path, flow)

    with pytest.raises(OptimizationObservationError, match="not successful"):
        build_stage_observation(frozen_workspace, "place", budget=_budget())

    flow["steps"][0]["state"] = "Success"
    _write_json(flow_path, flow)
    external = tmp_path / "external.json"
    _write_json(external, _metrics(("place_lutrudy_utilization_max", 0.88)))
    metrics_path = frozen_workspace / "place_dreamplace/analysis/qor_metrics.json"
    metrics_path.unlink()
    metrics_path.symlink_to(external)

    with pytest.raises(OptimizationObservationError, match="unsafe"):
        build_stage_observation(frozen_workspace, "place", budget=_budget())


def test_terminal_observation_uses_fixed_signoff_sources_and_preserves_unavailable_lvs(
    frozen_workspace: Path,
) -> None:
    observation = build_terminal_observation(frozen_workspace)

    assert observation.observation_id == "terminal-Harden"
    assert observation.metrics == {
        "route_dr_total_violation_count": 0.0,
        "route_la_total_overflow": 1.0,
        "route_wirelength": 5243.741,
    }
    assert observation.signoff_gates.drc_clean.value == "pass"
    assert observation.signoff_gates.sta_setup_closed.value == "pass"
    assert observation.signoff_gates.sta_hold_closed.value == "pass"
    assert observation.signoff_gates.lvs_clean.value == "unavailable"
    assert observation.harden_artifacts_complete is True
    assert observation.eligible_for_incumbent is False


def test_terminal_observation_keeps_evidence_but_marks_missing_harden_outputs_incomplete(
    frozen_workspace: Path,
) -> None:
    (frozen_workspace / "Harden_ecc/output/tiny_Harden.lib").unlink()

    observation = build_terminal_observation(frozen_workspace)

    assert observation.evidence_valid is True
    assert observation.harden_artifacts_complete is False


class _RecordingRetriever:
    def __init__(self, prefix: str) -> None:
        self.prefix = prefix
        self.calls: list[tuple[str, tuple[str, ...]]] = []

    def reply_for_stages(
        self, query: str, candidate_stages: tuple[str, ...]
    ) -> KnowledgeAnswer:
        self.calls.append((query, candidate_stages))
        matches = [
            {
                "entity_id": f"{self.prefix}.{index}",
                "chunk_sha256": f"{index:x}" * 64,
            }
            for index in range(1, 5)
        ]
        return KnowledgeAnswer(
            text=f"{self.prefix} evidence",
            entity_ids=tuple(item["entity_id"] for item in matches),
            contract={
                "retrieval": {"query_sha256": "f" * 64, "corpus_sha256": "e" * 64},
                "matches": matches,
            },
        )


def test_optimization_retrieval_uses_fixed_query_inputs_and_independent_channels(
    frozen_workspace: Path,
) -> None:
    observation = build_stage_observation(frozen_workspace, "place", budget=_budget())
    request = build_optimization_retrieval_request(
        task_id="task-1",
        observation=observation,
        previous_intervention_outcome=OptimizationOutcomeKind.DEGRADED,
    )
    tool = _RecordingRetriever("parameter.dreamplace")
    general = _RecordingRetriever("strategy.congestion")
    retriever = OptimizationKnowledgeRetriever(tool_retriever=tool, general_retriever=general)

    result = retriever.retrieve(request)

    assert request.action_stage == "place"
    assert request.allowed_knobs == tuple(OptimizationKnob)
    assert request.observed_metric_ids == tuple(sorted(observation.metrics))
    assert "0.88" not in json.dumps(request.model_dump(mode="json"))
    assert len(result.knowledge_refs) == 6
    assert {channel.channel for channel in result.channels if channel.enabled} == {
        KnowledgeChannel.TOOL,
        KnowledgeChannel.GENERAL,
    }
    assert all(len(channel.knowledge_refs) == 3 for channel in result.channels if channel.enabled)
    assert tool.calls[0][1] == ("place",)
    assert general.calls[0][1] == ("place",)
    assert "0.88" not in tool.calls[0][0]
    assert "5243" not in general.calls[0][0]

    no_knowledge = retriever.retrieve(request, enabled_channels=())
    assert no_knowledge.request_sha256 == result.request_sha256
    assert no_knowledge.knowledge_refs == ()
    assert all(not channel.enabled for channel in no_knowledge.channels)
    assert len(tool.calls) == 1
    assert len(general.calls) == 1

    with pytest.raises(ValueError, match="channels"):
        retriever.retrieve(request, enabled_channels=("source",))  # type: ignore[arg-type]


def test_optimization_retrieval_deduplicates_channel_evidence(
    frozen_workspace: Path,
) -> None:
    observation = build_stage_observation(frozen_workspace, "place", budget=_budget())
    request = build_optimization_retrieval_request(
        task_id="task-1",
        observation=observation,
        previous_intervention_outcome=None,
    )
    tool = _RecordingRetriever("parameter.dreamplace")
    general = _RecordingRetriever("parameter.dreamplace")

    result = OptimizationKnowledgeRetriever(
        tool_retriever=tool, general_retriever=general
    ).retrieve(request)

    assert len(result.knowledge_refs) == 3
    assert result.channels[1].knowledge_refs == ()


def test_default_optimization_retrieval_keeps_tool_and_general_knowledge_separate(
    frozen_workspace: Path,
) -> None:
    observation = build_stage_observation(frozen_workspace, "place", budget=_budget())
    request = build_optimization_retrieval_request(
        task_id="task-1",
        observation=observation,
        previous_intervention_outcome=None,
    )

    result = OptimizationKnowledgeRetriever().retrieve(request)

    tool, general = result.channels
    assert len(tool.knowledge_refs) <= 3
    assert len(general.knowledge_refs) <= 3
    assert all(not ref.entity_id.startswith("strategy.") for ref in tool.knowledge_refs)
    assert all(ref.entity_id.startswith("strategy.congestion.") for ref in general.knowledge_refs)
