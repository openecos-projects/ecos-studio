"""Deterministic, two-channel knowledge retrieval for optimization planning."""

from __future__ import annotations

import re
from dataclasses import dataclass
from enum import StrEnum
from typing import Iterable, Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

from ecos_agent.ecc_contracts import ECCStepName
from ecos_agent.hashing import canonical_sha256
from ecos_agent.knowledge_retriever import (
    GlobalKnowledgeRetriever,
    RetrievalConfig,
    load_production_retrieval_config,
)
from ecos_agent.optimization_contracts import (
    KnowledgeReference,
    OptimizationKnob,
    StageObservation,
)
from ecos_agent.optimization_ledger import OptimizationOutcomeKind
from ecos_agent.step_knowledge import (
    load_default_general_knowledge_bundles,
    load_default_step_knowledge,
)


_ID = re.compile(r"^[A-Za-z][A-Za-z0-9_.-]{0,127}$")
_METRIC_ID = re.compile(r"^[a-z][a-z0-9_]*$")
_CHUNK_SHA256 = re.compile(r"^[0-9a-f]{64}$")


class KnowledgeChannel(StrEnum):
    TOOL = "tool"
    GENERAL = "general"


class OptimizationRetrievalError(ValueError):
    """A frozen retrieval request or trusted answer is invalid."""


class OptimizationRetrievalRequest(BaseModel):
    """The complete, value-free input allowed to influence FTS retrieval."""

    model_config = ConfigDict(extra="forbid", frozen=True)

    schema_version: Literal["ecos.optimization_retrieval_request.v1"] = (
        "ecos.optimization_retrieval_request.v1"
    )
    task_id: str
    current_stage: ECCStepName
    action_stage: Literal["place"] = "place"
    observed_metric_ids: tuple[str, ...] = Field(min_length=1, max_length=128)
    observation_status: Literal["success"] = "success"
    previous_intervention_outcome: OptimizationOutcomeKind | None = None
    allowed_knobs: tuple[OptimizationKnob, ...] = tuple(OptimizationKnob)

    @field_validator("task_id")
    @classmethod
    def validate_task_id(cls, value: str) -> str:
        if not _ID.fullmatch(value):
            raise ValueError("retrieval task id is invalid")
        return value

    @field_validator("observed_metric_ids")
    @classmethod
    def validate_metrics(cls, value: tuple[str, ...]) -> tuple[str, ...]:
        if tuple(sorted(value)) != value or any(not _METRIC_ID.fullmatch(item) for item in value):
            raise ValueError("retrieval observed metric ids are invalid")
        if len(set(value)) != len(value):
            raise ValueError("retrieval observed metric ids must be unique")
        return value

    @model_validator(mode="after")
    def validate_knobs(self) -> "OptimizationRetrievalRequest":
        if self.allowed_knobs != tuple(OptimizationKnob):
            raise ValueError("retrieval allowed knobs are not frozen")
        return self

    @property
    def request_sha256(self) -> str:
        return canonical_sha256(self.model_dump(mode="json"))


@dataclass(frozen=True)
class KnowledgeChannelResult:
    channel: KnowledgeChannel
    enabled: bool
    query: str | None
    query_sha256: str | None
    corpus_sha256: str | None
    answer_text: str | None
    knowledge_refs: tuple[KnowledgeReference, ...]


@dataclass(frozen=True)
class OptimizationRetrievalResult:
    request: OptimizationRetrievalRequest
    channels: tuple[KnowledgeChannelResult, ...]
    knowledge_refs: tuple[KnowledgeReference, ...]

    @property
    def request_sha256(self) -> str:
        return self.request.request_sha256

    @property
    def contract(self) -> dict[str, object]:
        return {
            "schema_version": "ecos.optimization_knowledge_retrieval.v1",
            "request_sha256": self.request_sha256,
            "request": self.request.model_dump(mode="json"),
            "channels": [
                {
                    "channel": item.channel,
                    "enabled": item.enabled,
                    "query": item.query,
                    "query_sha256": item.query_sha256,
                    "corpus_sha256": item.corpus_sha256,
                    "knowledge_refs": [ref.model_dump() for ref in item.knowledge_refs],
                }
                for item in self.channels
            ],
            "knowledge_refs": [ref.model_dump() for ref in self.knowledge_refs],
        }


class OptimizationKnowledgeRetriever:
    """Use separate, fixed corpora so RQ2 can disable either knowledge source."""

    def __init__(
        self,
        *,
        tool_retriever: GlobalKnowledgeRetriever | None = None,
        general_retriever: GlobalKnowledgeRetriever | None = None,
    ) -> None:
        if (tool_retriever is None) != (general_retriever is None):
            raise ValueError("tool and general retrievers must be configured together")
        if tool_retriever is None:
            config = _frozen_top_k_config()
            tool_retriever = GlobalKnowledgeRetriever(load_default_step_knowledge(), config=config)
            general_retriever = GlobalKnowledgeRetriever(
                load_default_general_knowledge_bundles(), config=config
            )
        self._tool_retriever = tool_retriever
        self._general_retriever = general_retriever

    def retrieve(
        self,
        request: OptimizationRetrievalRequest,
        *,
        enabled_channels: Iterable[KnowledgeChannel] = tuple(KnowledgeChannel),
    ) -> OptimizationRetrievalResult:
        enabled = _enabled_channels(enabled_channels)
        seen_entity_ids: set[str] = set()
        channel_results = []
        for channel, retriever in (
            (KnowledgeChannel.TOOL, self._tool_retriever),
            (KnowledgeChannel.GENERAL, self._general_retriever),
        ):
            if channel not in enabled:
                channel_results.append(
                    KnowledgeChannelResult(channel, False, None, None, None, None, ())
                )
                continue
            query = _fixed_query(request, channel)
            answer = retriever.reply_for_stages(query, (request.action_stage,))
            channel_results.append(_channel_result(channel, query, answer, seen_entity_ids))
        references = tuple(ref for item in channel_results for ref in item.knowledge_refs)
        return OptimizationRetrievalResult(request, tuple(channel_results), references)


def build_optimization_retrieval_request(
    *,
    task_id: str,
    observation: StageObservation,
    previous_intervention_outcome: OptimizationOutcomeKind | None,
) -> OptimizationRetrievalRequest:
    return OptimizationRetrievalRequest(
        task_id=task_id,
        current_stage=observation.stage,
        observed_metric_ids=tuple(sorted(observation.metrics)),
        previous_intervention_outcome=previous_intervention_outcome,
    )


def _frozen_top_k_config() -> RetrievalConfig:
    config = load_production_retrieval_config()
    if config.top_k != 3:
        raise OptimizationRetrievalError("optimization retrieval requires frozen top_k=3")
    return config


def _enabled_channels(channels: Iterable[KnowledgeChannel]) -> frozenset[KnowledgeChannel]:
    values = tuple(channels)
    if len(set(values)) != len(values) or any(not isinstance(value, KnowledgeChannel) for value in values):
        raise ValueError("retrieval channels are invalid")
    return frozenset(values)


def _fixed_query(request: OptimizationRetrievalRequest, channel: KnowledgeChannel) -> str:
    outcome = request.previous_intervention_outcome or "none"
    metrics = " ".join(request.observed_metric_ids)
    knobs = "target density cell padding routability optimization"
    prefix = "DreamPlace placement" if channel == KnowledgeChannel.TOOL else "congestion strategy"
    return (
        f"{prefix} current stage {request.current_stage.value} action stage {request.action_stage} "
        f"observation {request.observation_status} metrics {metrics} previous outcome {outcome} "
        f"legal knobs {knobs}"
    )


def _channel_result(
    channel: KnowledgeChannel,
    query: str,
    answer: object,
    seen_entity_ids: set[str],
) -> KnowledgeChannelResult:
    if answer is None:
        return KnowledgeChannelResult(channel, True, query, None, None, None, ())
    contract = getattr(answer, "contract", None)
    text = getattr(answer, "text", None)
    if not isinstance(contract, dict) or not isinstance(text, str):
        raise OptimizationRetrievalError("knowledge channel returned an invalid answer")
    retrieval = contract.get("retrieval")
    matches = contract.get("matches")
    if not isinstance(retrieval, dict) or not isinstance(matches, list):
        raise OptimizationRetrievalError("knowledge channel returned an invalid contract")
    query_sha256 = retrieval.get("query_sha256")
    corpus_sha256 = retrieval.get("corpus_sha256")
    if not _valid_hash(query_sha256) or not _valid_hash(corpus_sha256):
        raise OptimizationRetrievalError("knowledge channel returned an unhashed contract")
    references = []
    for match in matches[:3]:
        if not isinstance(match, dict):
            raise OptimizationRetrievalError("knowledge channel match is invalid")
        try:
            reference = KnowledgeReference(
                entity_id=match["entity_id"], chunk_sha256=match["chunk_sha256"]
            )
        except (KeyError, ValueError) as exc:
            raise OptimizationRetrievalError("knowledge channel evidence reference is invalid") from exc
        if reference.entity_id not in seen_entity_ids:
            seen_entity_ids.add(reference.entity_id)
            references.append(reference)
    return KnowledgeChannelResult(
        channel,
        True,
        query,
        query_sha256,
        corpus_sha256,
        text,
        tuple(references),
    )


def _valid_hash(value: object) -> bool:
    return isinstance(value, str) and bool(_CHUNK_SHA256.fullmatch(value))
