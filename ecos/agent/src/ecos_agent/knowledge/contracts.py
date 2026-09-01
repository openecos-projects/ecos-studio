"""Typed, read-only routing and source-search proposals."""

import re
from typing import Literal

from pydantic import BaseModel, ConfigDict, field_validator, model_validator


SOURCE_ROOT_IDS = ("ecc", "ecos", "pdk", "ip")
_IDENTIFIER = re.compile(r"[A-Za-z_][A-Za-z0-9_]*")
_MAX_STAGE_ROUTING_CANDIDATES = 3
_MAX_SOURCE_SEARCH_QUERIES = 5


class StageRoutingProposal(BaseModel):
    """Untrusted read-only scope and stage hints for knowledge retrieval."""

    model_config = ConfigDict(extra="forbid")

    schema_version: Literal["flow-agent.stage_routing_proposal.v1"]
    scope: Literal["in_scope", "out_of_scope", "ambiguous"]
    candidate_stages: tuple[str, ...]
    rationale: str

    @field_validator("candidate_stages")
    @classmethod
    def validate_candidate_stages(cls, value: tuple[str, ...]) -> tuple[str, ...]:
        if len(value) > _MAX_STAGE_ROUTING_CANDIDATES:
            raise ValueError("stage routing has too many candidates")
        normalized = tuple(stage.strip() for stage in value)
        if len(set(normalized)) != len(normalized) or any(
            not _IDENTIFIER.fullmatch(stage) for stage in normalized
        ):
            raise ValueError("stage routing candidates are invalid")
        return normalized

    @field_validator("rationale")
    @classmethod
    def validate_rationale(cls, value: str) -> str:
        value = value.strip()
        if not value or len(value) > 512:
            raise ValueError("stage routing rationale is invalid")
        return value

    @model_validator(mode="after")
    def validate_scope(self) -> "StageRoutingProposal":
        if self.scope != "in_scope" and self.candidate_stages:
            raise ValueError("out-of-scope or ambiguous routing cannot select stages")
        return self


class SourceSearchQuery(BaseModel):
    """One literal query constrained to an ECOS source root."""

    model_config = ConfigDict(extra="forbid")

    root_id: str
    query: str

    @field_validator("root_id")
    @classmethod
    def validate_root_id(cls, value: str) -> str:
        value = value.strip()
        if value not in SOURCE_ROOT_IDS:
            raise ValueError("source search root is invalid")
        return value

    @field_validator("query")
    @classmethod
    def validate_query(cls, value: str) -> str:
        value = value.strip()
        if not 2 <= len(value) <= 128 or any(
            character in value for character in ("\x00", "\n", "\r")
        ):
            raise ValueError("source search query is invalid")
        return value


class SourceSearchProposal(BaseModel):
    """Untrusted requests for bounded, local source-code retrieval."""

    model_config = ConfigDict(extra="forbid")

    schema_version: Literal["flow-agent.source_search_proposal.v1"]
    queries: tuple[SourceSearchQuery, ...]
    rationale: str

    @field_validator("queries")
    @classmethod
    def validate_queries(
        cls, value: tuple[SourceSearchQuery, ...]
    ) -> tuple[SourceSearchQuery, ...]:
        if len(value) > _MAX_SOURCE_SEARCH_QUERIES:
            raise ValueError("source search has too many queries")
        keys = tuple((query.root_id, query.query) for query in value)
        if len(set(keys)) != len(keys):
            raise ValueError("source search has duplicate queries")
        return value

    @field_validator("rationale")
    @classmethod
    def validate_rationale(cls, value: str) -> str:
        value = value.strip()
        if not value or len(value) > 512:
            raise ValueError("source search rationale is invalid")
        return value
