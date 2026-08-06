"""Typed, non-executable contracts for ECOS Placement knowledge answers."""

from typing import Literal

from pydantic import BaseModel, ConfigDict, Field


class PlaceQuery(BaseModel):
    model_config = ConfigDict(extra="forbid")

    schema_version: Literal["ecos-place-query.v1"] = "ecos-place-query.v1"
    intent: Literal["explain", "analyze", "recommend", "apply_request", "clarify"]
    language: Literal["en", "zh"]
    entity_ids: list[str] = Field(default_factory=list, max_length=8)
    evidence_required: bool = False


class KnowledgeHit(BaseModel):
    model_config = ConfigDict(extra="forbid")

    entity_id: str = Field(min_length=1, max_length=160)
    document: str = Field(min_length=1, max_length=128)
    anchor: str = Field(min_length=1, max_length=160)
    source_ids: list[str] = Field(default_factory=list, max_length=8)


class PlaceArtifact(BaseModel):
    model_config = ConfigDict(extra="forbid")

    relative_path: str = Field(min_length=1, max_length=512)
    fingerprint: dict[str, object]


class PlaceEvidence(BaseModel):
    model_config = ConfigDict(extra="forbid")

    schema_version: Literal["ecos-place-evidence.v1"] = "ecos-place-evidence.v1"
    workspace_id: str = Field(min_length=1, max_length=128)
    step_status: dict[str, str] = Field(default_factory=dict, max_length=2)
    effective_config: dict[str, object] = Field(default_factory=dict, max_length=128)
    metrics: dict[str, float] = Field(default_factory=dict, max_length=16)
    artifacts: list[PlaceArtifact] = Field(default_factory=list, max_length=8)
    findings: list[str] = Field(default_factory=list, max_length=16)


class PlaceStrategy(BaseModel):
    model_config = ConfigDict(extra="forbid")

    strategy_id: str = Field(min_length=1, max_length=160)
    status: Literal["directly_supported", "internally_effective", "approximated", "cross_stage", "unsupported", "evidence_gap"]
    allowed_knob_ids: list[str] = Field(default_factory=list, max_length=8)
    allowed_directions: dict[str, Literal["increase", "decrease"]] = Field(default_factory=dict)
    review_status: Literal["approved"]


class PlaceAnswer(BaseModel):
    model_config = ConfigDict(extra="forbid")

    schema_version: Literal["ecos-place-answer.v1"] = "ecos-place-answer.v1"
    intent: Literal["explain", "analyze", "recommend", "apply_request", "clarify"]
    text: str = Field(min_length=1, max_length=2_000)
    evidence_ids: list[str] = Field(default_factory=list, max_length=8)
    hits: list[KnowledgeHit] = Field(default_factory=list, max_length=8)
    uncertainty: str | None = Field(default=None, max_length=512)
