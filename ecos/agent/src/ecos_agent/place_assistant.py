"""Read-only local ECOS Placement knowledge route."""

from __future__ import annotations

import hashlib
import json
import os
import re
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from ecos_agent.place_contracts import (
    KnowledgeHit,
    PlaceAnswer,
    PlaceEvidence,
    PlaceQuery,
    PlaceStrategy,
)
from ecos_agent.place_strategy import select_applicable_strategies


_APPLY_RE = re.compile(r"\b(apply|optimi[sz]e|scan|execute)\b|应用|优化|扫描|执行", re.IGNORECASE)
_ANALYZE_RE = re.compile(r"\b(analy[sz]e|diagnos[ei]|recommend)\b|分析|诊断|建议", re.IGNORECASE)
_AMBIGUOUS_RE = re.compile(r"\b(utili[sz]ation|density)\b|利用率|密度", re.IGNORECASE)


class PlaceAssistant:
    """Serve only reviewed bundle entries and persist non-sensitive audit records."""

    def __init__(self, entities: list[dict[str, Any]], audit_path: Path) -> None:
        self.entities = entities
        self.audit_path = audit_path

    @classmethod
    def from_bundle(cls, root: Path, audit_path: Path | None = None) -> "PlaceAssistant":
        catalog_path = root / "catalog.json"
        sources_path = root / "sources.json"
        if not catalog_path.is_file() or not sources_path.is_file():
            raise ValueError("ECOS Placement knowledge bundle is incomplete")
        catalog = json.loads(catalog_path.read_text(encoding="utf-8"))
        entities = catalog.get("entities")
        if (
            catalog.get("schema_version") != "ecos-place-catalog.v1"
            or catalog.get("domain") != "ecos_placement"
            or catalog.get("review_status") != "approved"
            or not isinstance(entities, list)
        ):
            raise ValueError("ECOS Placement knowledge bundle is not approved")
        for entity in entities:
            if not isinstance(entity, dict) or entity.get("review_status") != "approved":
                raise ValueError("ECOS Placement knowledge bundle has unreviewed entities")
            document = root / "knowledge" / str(entity.get("document", ""))
            anchor = str(entity.get("anchor", ""))
            if not document.is_file() or 'id="' + anchor + '"' not in document.read_text(encoding="utf-8"):
                raise ValueError("ECOS Placement knowledge bundle has invalid links")
        return cls(entities, audit_path or _default_audit_path())

    @classmethod
    def from_environment(cls) -> "PlaceAssistant | None":
        location = os.environ.get("ECOS_AGENT_PLACE_KNOWLEDGE")
        if location:
            return cls.from_bundle(Path(location).expanduser().resolve())
        bundle = getattr(sys, "_MEIPASS", None)
        return cls.from_bundle(Path(bundle) / "place-knowledge") if bundle else None

    def reply(
        self, message: str, *, language: str, evidence: PlaceEvidence | None = None
    ) -> PlaceAnswer | None:
        query = self._query(message, language)
        if query is None:
            return None
        if query.intent == "clarify":
            answer = PlaceAnswer(
                intent="clarify",
                text=_clarification_text(language),
                uncertainty="The requested direction is ambiguous.",
            )
        elif query.intent == "apply_request":
            answer = PlaceAnswer(
                intent="apply_request",
                text=_apply_text(language),
                evidence_ids=query.entity_ids,
                hits=self._hits(query.entity_ids),
            )
        elif query.intent == "analyze":
            answer = self._analyze(query, evidence)
        else:
            answer = self._explain(query)
        self._audit(message, query, answer)
        return answer

    @staticmethod
    def requires_evidence(message: str) -> bool:
        return bool(_ANALYZE_RE.search(message) or _APPLY_RE.search(message))

    def _query(self, message: str, language: str) -> PlaceQuery | None:
        normalized = message.casefold()
        entity_ids = [entity["id"] for entity in self.entities if _matches(entity, normalized)]
        if _AMBIGUOUS_RE.search(message) and not entity_ids:
            return PlaceQuery(intent="clarify", language=language)
        if not entity_ids:
            return None
        intent = (
            "apply_request"
            if _APPLY_RE.search(message)
            else "analyze"
            if _ANALYZE_RE.search(message)
            else "explain"
        )
        return PlaceQuery(
            intent=intent,
            language=language,
            entity_ids=entity_ids[:8],
        )

    def _explain(self, query: PlaceQuery) -> PlaceAnswer:
        entity = next(item for item in self.entities if item["id"] == query.entity_ids[0])
        status = entity["status"]
        default = entity.get("default")
        if query.language == "zh":
            text = f"`{entity['id']}` 当前状态为 `{status}`，适用于 ECOS {', '.join(entity['stage_scope'])}。"
            if default is not None:
                text += f" 源码默认值为 `{default}`。"
            text += " 这是只读解释，不会执行或修改 workspace。"
        else:
            text = f"`{entity['id']}` is `{status}` for ECOS {', '.join(entity['stage_scope'])}."
            if default is not None:
                text += f" The source default is `{default}`."
            text += " This read-only answer does not execute or modify a workspace."
        summary = entity.get("summary")
        if isinstance(summary, str) and summary:
            text += " " + summary
        return PlaceAnswer(
            intent="explain",
            text=text,
            evidence_ids=query.entity_ids,
            hits=self._hits(query.entity_ids),
        )

    def _analyze(self, query: PlaceQuery, evidence: PlaceEvidence | None) -> PlaceAnswer:
        if evidence is None:
            return PlaceAnswer(
                intent="analyze",
                text=_evidence_required_text(query.language),
                evidence_ids=query.entity_ids,
                hits=self._hits(query.entity_ids),
                uncertainty="No valid PlaceEvidence is available.",
            )
        state = evidence.step_status.get("place", "unavailable")
        hpwl = evidence.metrics.get("place_hpwl")
        detail = "unavailable" if hpwl is None else str(hpwl)
        strategies = select_applicable_strategies(self.entities, evidence)
        strategy = strategies[0] if strategies else None
        evidence_ids = list(dict.fromkeys([*query.entity_ids, *([strategy.strategy_id] if strategy else [])]))
        text = _analysis_text(query.language, state, detail, strategy)
        return PlaceAnswer(
            intent="analyze",
            text=text,
            evidence_ids=evidence_ids,
            hits=self._hits(evidence_ids),
        )

    def _hits(self, entity_ids: list[str]) -> list[KnowledgeHit]:
        hits = []
        for entity in self.entities:
            if entity["id"] in entity_ids:
                hits.append(
                    KnowledgeHit(
                        entity_id=entity["id"],
                        document=entity["document"],
                        anchor=entity["anchor"],
                        source_ids=[item["source_id"] for item in entity.get("evidence", [])],
                    )
                )
        return hits

    def _audit(self, message: str, query: PlaceQuery, answer: PlaceAnswer) -> None:
        self.audit_path.parent.mkdir(parents=True, exist_ok=True)
        record = {
            "schema_version": "ecos-place-audit.v1",
            "timestamp": datetime.now(timezone.utc).isoformat(),
            "message_sha256": hashlib.sha256(message.encode()).hexdigest(),
            "intent": query.intent,
            "filters": {"domain": "ecos_placement", "review_status": "approved"},
            "entity_ids": query.entity_ids,
            "hit_ids": answer.evidence_ids,
        }
        with self.audit_path.open("a", encoding="utf-8") as handle:
            handle.write(json.dumps(record, sort_keys=True) + "\n")

    def audit_public_lookup(self, query: str, urls: list[str]) -> None:
        self.audit_path.parent.mkdir(parents=True, exist_ok=True)
        record = {
            "schema_version": "ecos-place-audit.v1",
            "timestamp": datetime.now(timezone.utc).isoformat(),
            "event": "public_metadata_lookup",
            "query": query,
            "urls": urls,
        }
        with self.audit_path.open("a", encoding="utf-8") as handle:
            handle.write(json.dumps(record, sort_keys=True) + "\n")


def _matches(entity: dict[str, Any], message: str) -> bool:
    return any(str(alias).casefold() in message for alias in entity.get("aliases", []))


def _default_audit_path() -> Path:
    root = Path(os.environ.get("XDG_STATE_HOME", Path.home() / ".local" / "state"))
    return root / "ecos-agent" / "place-audit.jsonl"


def _clarification_text(language: str) -> str:
    if language == "zh":
        return "请先澄清你指的是 floorplan 利用率还是 DREAMPlace `target_density`，以及希望比较的指标。"
    return "Please clarify whether you mean floorplan utilization or DREAMPlace `target_density`, and which metric you want to protect."


def _apply_text(language: str) -> str:
    if language == "zh":
        return "这是 apply/optimization 请求。请先审阅并确认既有受控 rerun 合同；当前消息不会执行 ECC 或修改 workspace。"
    return "This is an apply/optimization request. Review and confirm the existing controlled rerun contract first; this message does not execute ECC or modify a workspace."


def _evidence_required_text(language: str) -> str:
    if language == "zh":
        return "设计级分析需要当前 workspace 的有效 PlaceEvidence；当前不会推断根因或参数方向。"
    return "Design-level analysis requires valid PlaceEvidence from the current workspace; no root cause or parameter direction is inferred."


def _analysis_text(
    language: str, state: str, hpwl: str, strategy: PlaceStrategy | None
) -> str:
    if strategy is None:
        if language == "zh":
            return (
                f"观测：place 状态为 `{state}`，`place_hpwl` 为 `{hpwl}`。"
                "当前没有已审核的 PlaceStrategy，因此不会提出参数变更。"
            )
        return (
            f"Observation: place status is `{state}` and `place_hpwl` is `{hpwl}`. "
            "No reviewed PlaceStrategy is available, so this analysis does not propose a parameter change."
        )
    directions = ", ".join(
        f"`{key}`: {value}" for key, value in strategy.allowed_directions.items()
    )
    protected = ", ".join(f"`{metric}`" for metric in strategy.protected_metrics) or "none"
    if language == "zh":
        return (
            f"观测：place 状态为 `{state}`，`place_hpwl` 为 `{hpwl}`。"
            f"已审核策略 `{strategy.strategy_id}` 仅允许趋势 `{directions}`，并保护 {protected}；"
            "这不是可执行参数变更。"
        )
    return (
        f"Observation: place status is `{state}` and `place_hpwl` is `{hpwl}`. "
        f"Reviewed strategy `{strategy.strategy_id}` permits only {directions} while "
        f"protecting {protected}; this does not execute a parameter change."
    )
