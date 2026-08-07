import json
from pathlib import Path

from ecos_agent.place_assistant import PlaceAssistant
from ecos_agent.place_contracts import PlaceEvidence
from ecos_agent.place_network import PublicKnowledgeHit, public_lookup_query
from ecos_agent.provider import EcosAgentProvider


def _bundle(root: Path) -> Path:
    root.mkdir()
    (root / "knowledge").mkdir()
    (root / "catalog.json").write_text(
        json.dumps(
            {
                "schema_version": "ecos-place-catalog.v1",
                "domain": "ecos_placement",
                "review_status": "approved",
                "entities": [
                    {
                        "id": "parameter.dreamplace.target_density",
                        "type": "parameter",
                        "aliases": ["target density", "target_density"],
                        "stage_scope": ["place"],
                        "tool_scope": "ecos_dreamplace",
                        "status": "user_settable",
                        "default": 0.8,
                        "document": "parameters.md",
                        "anchor": "parameter.dreamplace.target_density",
                        "review_status": "approved",
                        "evidence": [{"source_id": "ecos-source.config", "symbol": "target_density"}],
                        "relationships": [],
                    },
                    {
                        "id": "algorithm.dreamplace.global_placement",
                        "type": "algorithm",
                        "aliases": ["global placement"],
                        "stage_scope": ["place"],
                        "tool_scope": "ecos_dreamplace",
                        "status": "internal_effective",
                        "document": "algorithms.md",
                        "anchor": "algorithm.dreamplace.global_placement",
                        "review_status": "approved",
                        "evidence": [{"source_id": "ecos-source.module", "symbol": "run_placement"}],
                        "relationships": [],
                    },
                    {
                        "id": "metric.place_rudy_utilization_max",
                        "type": "metric",
                        "aliases": ["RUDY"],
                        "stage_scope": ["place"],
                        "tool_scope": "ecos_dreamplace",
                        "status": "internal_effective",
                        "document": "metrics.md",
                        "anchor": "metric.place_rudy_utilization_max",
                        "review_status": "approved",
                        "evidence": [{"source_id": "ecos-source.rudy", "symbol": "Rudy.forward"}],
                        "relationships": [],
                    },
                ],
            }
        ),
        encoding="utf-8",
    )
    (root / "sources.json").write_text('{"sources": []}', encoding="utf-8")
    (root / "knowledge" / "parameters.md").write_text(
        '<a id="parameter.dreamplace.target_density"></a>', encoding="utf-8"
    )
    (root / "knowledge" / "algorithms.md").write_text(
        '<a id="algorithm.dreamplace.global_placement"></a>', encoding="utf-8"
    )
    (root / "knowledge" / "metrics.md").write_text(
        '<a id="metric.place_rudy_utilization_max"></a>', encoding="utf-8"
    )
    return root


def test_explain_is_read_only_and_references_the_approved_entity(tmp_path: Path) -> None:
    assistant = PlaceAssistant.from_bundle(_bundle(tmp_path / "bundle"), audit_path=tmp_path / "audit.jsonl")

    answer = assistant.reply("What is target density?", language="en")

    assert answer.intent == "explain"
    assert answer.evidence_ids == ["parameter.dreamplace.target_density"]
    assert "0.8" in answer.text
    assert "does not execute" in answer.text


def test_explains_target_density_in_chinese_with_the_ecos_boundary(tmp_path: Path) -> None:
    assistant = PlaceAssistant.from_bundle(_bundle(tmp_path / "bundle"), audit_path=tmp_path / "audit.jsonl")

    answer = assistant.reply("place阶段的target density这个参数的含义是什么？", language="zh")

    assert answer.intent == "explain"
    assert answer.evidence_ids == ["parameter.dreamplace.target_density"]
    assert "0.8" in answer.text
    assert "全局布局" in answer.text
    assert "floorplan utilization" in answer.text
    assert "不会执行" in answer.text


def test_explains_the_ecos_place_execution_path_in_chinese(tmp_path: Path) -> None:
    assistant = PlaceAssistant.from_bundle(_bundle(tmp_path / "bundle"), audit_path=tmp_path / "audit.jsonl")

    answer = assistant.reply("place内部算法是如何执行的？", language="zh")

    assert answer.intent == "explain"
    assert answer.evidence_ids == ["algorithm.dreamplace.global_placement"]
    assert "DreamplaceModule" in answer.text
    assert "PlacementEngine" in answer.text
    assert "全局布局" in answer.text
    assert "合法化" in answer.text
    assert "detailed placement" in answer.text


def test_explains_rudy_computation_in_chinese(tmp_path: Path) -> None:
    assistant = PlaceAssistant.from_bundle(_bundle(tmp_path / "bundle"), audit_path=tmp_path / "audit.jsonl")

    answer = assistant.reply("RUDY指标是如何计算的？", language="zh")

    assert answer.intent == "explain"
    assert answer.evidence_ids == ["metric.place_rudy_utilization_max"]
    assert "bounding box" in answer.text
    assert "horizontal" in answer.text
    assert "vertical" in answer.text
    assert "max" in answer.text


def test_ambiguous_utilization_direction_requires_clarification(tmp_path: Path) -> None:
    assistant = PlaceAssistant.from_bundle(_bundle(tmp_path / "bundle"), audit_path=tmp_path / "audit.jsonl")

    answer = assistant.reply("Should utilization be smaller?", language="en")

    assert answer.intent == "clarify"
    assert answer.evidence_ids == []
    assert "clarify" in answer.text.lower()


def test_provider_keeps_the_existing_operation_menu_after_a_place_answer(tmp_path: Path) -> None:
    events: list[dict[str, object]] = []
    assistant = PlaceAssistant.from_bundle(_bundle(tmp_path / "bundle"), audit_path=tmp_path / "audit.jsonl")
    provider = EcosAgentProvider(emit=events.append, place_assistant=assistant)
    session_id = provider.start_session({"mode": "home"})["sessionId"]

    provider.send_message({"sessionId": session_id, "message": "What is target density?"})

    session = provider.sessions[session_id]
    assert session.phase == "operation"
    answer = next(event for event in reversed(events) if event["type"] == "message")
    assert answer["contract"]["schema_version"] == "ecos-place-answer.v1"
    assert events[-2]["type"] == "choice"


def test_provider_answers_a_chinese_place_algorithm_question_without_execution(tmp_path: Path) -> None:
    events: list[dict[str, object]] = []
    assistant = PlaceAssistant.from_bundle(_bundle(tmp_path / "bundle"), audit_path=tmp_path / "audit.jsonl")
    provider = EcosAgentProvider(emit=events.append, place_assistant=assistant)
    session_id = provider.start_session({"mode": "home"})["sessionId"]

    provider.send_message({"sessionId": session_id, "message": "place内部算法是如何执行的？"})

    answer = next(event for event in reversed(events) if event["type"] == "message")
    assert "PlacementEngine" in str(answer["text"])
    assert answer["contract"]["intent"] == "explain"
    assert provider.sessions[session_id].phase == "operation"
    assert not any(event["type"] == "workspace_optimization" for event in events)


def test_analysis_does_not_claim_a_strategy_when_the_bundle_has_none(tmp_path: Path) -> None:
    assistant = PlaceAssistant.from_bundle(_bundle(tmp_path / "bundle"), audit_path=tmp_path / "audit.jsonl")
    evidence = PlaceEvidence(workspace_id="gcd", step_status={"place": "Success"})

    answer = assistant.reply("Analyze target density", language="en", evidence=evidence)

    assert answer.intent == "analyze"
    assert answer.evidence_ids == ["parameter.dreamplace.target_density"]
    assert "No reviewed PlaceStrategy" in answer.text


def test_analysis_reports_an_approved_strategy_with_required_evidence(tmp_path: Path) -> None:
    root = _bundle(tmp_path / "bundle")
    catalog_path = root / "catalog.json"
    catalog = json.loads(catalog_path.read_text(encoding="utf-8"))
    catalog["entities"].append(
        {
            "id": "strategy.place.reduce_density",
            "type": "strategy",
            "aliases": ["congestion"],
            "stage_scope": ["place"],
            "tool_scope": "ecos_dreamplace",
            "status": "directly_supported",
            "document": "strategies.md",
            "anchor": "strategy.place.reduce_density",
            "review_status": "approved",
            "evidence": [],
            "relationships": [],
            "strategy": {
                "strategy_id": "strategy.place.reduce_density",
                "status": "directly_supported",
                "required_metrics": ["place_congestion_egr_overflow_max"],
                "allowed_directions": {"place.target_density": "decrease"},
                "protected_metrics": ["place_hpwl"],
                "verification": "Run the frozen place-only scan.",
                "rollback": "Do not modify the source workspace.",
                "escalation": "Escalate to floorplan when congestion persists.",
                "review_status": "approved",
            },
        }
    )
    catalog_path.write_text(json.dumps(catalog), encoding="utf-8")
    (root / "knowledge" / "strategies.md").write_text(
        '<a id="strategy.place.reduce_density"></a>', encoding="utf-8"
    )
    assistant = PlaceAssistant.from_bundle(root, audit_path=tmp_path / "audit.jsonl")

    answer = assistant.reply(
        "Analyze target density",
        language="en",
        evidence=PlaceEvidence(
            workspace_id="gcd",
            metrics={"place_congestion_egr_overflow_max": 3, "place_hpwl": 12},
        ),
    )

    assert "strategy.place.reduce_density" in answer.text
    assert "decrease" in answer.text
    assert "does not execute" in answer.text
    assert answer.evidence_ids == [
        "parameter.dreamplace.target_density",
        "strategy.place.reduce_density",
    ]


def test_public_lookup_query_never_reuses_private_user_text() -> None:
    query = public_lookup_query(
        "Search online for /private/gcd.v metrics=8.2 and token=secret"
    )

    assert query == "DREAMPlace placement target density congestion"
    assert "/private" not in query
    assert "secret" not in query


def test_provider_saves_public_results_only_as_unreviewed_candidates(tmp_path: Path) -> None:
    events: list[dict[str, object]] = []
    candidate_path = tmp_path / "candidates.jsonl"
    seen_queries: list[str] = []
    provider = EcosAgentProvider(
        emit=events.append,
        candidate_path=candidate_path,
        place_assistant=PlaceAssistant.from_bundle(
            _bundle(tmp_path / "bundle"), audit_path=tmp_path / "audit.jsonl"
        ),
        public_knowledge_lookup=lambda query: (
            seen_queries.append(query)
            or [PublicKnowledgeHit(title="Public placement paper", url="https://doi.org/10.1/example")]
        ),
    )
    session_id = provider.start_session({"mode": "home"})["sessionId"]

    provider.send_message({"sessionId": session_id, "message": "Search the web for placement papers"})
    assert provider.sessions[session_id].phase == "place_network_confirmation"

    provider.send_message({"sessionId": session_id, "message": "1"})
    assert seen_queries == ["DREAMPlace placement target density congestion"]
    assert provider.sessions[session_id].phase == "place_candidate_confirmation"
    response = next(event for event in reversed(events) if event["type"] == "message")["text"]
    assert "unreviewed" in response
    assert "https://doi.org/10.1/example" in response

    provider.send_message({"sessionId": session_id, "message": "1"})
    candidate = json.loads(candidate_path.read_text(encoding="utf-8"))
    assert candidate["review_status"] == "unreviewed"
    assert candidate["kind"] == "public_metadata"
    assert provider.sessions[session_id].phase == "operation"
