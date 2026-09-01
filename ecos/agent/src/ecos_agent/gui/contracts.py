"""Untrusted proposal contracts for GUI chat routing."""

import re
from typing import Literal

from pydantic import BaseModel, ConfigDict, field_validator, model_validator


class GuiClarificationOption(BaseModel):
    model_config = ConfigDict(extra="forbid")

    id: str
    label: str

    @field_validator("id", "label")
    @classmethod
    def validate_text(cls, value: str) -> str:
        value = value.strip()
        if not value or len(value) > 256:
            raise ValueError("clarification option text is invalid")
        return value


class GuiClarificationProposal(BaseModel):
    model_config = ConfigDict(extra="forbid")

    title: str
    description: str | None = None
    options: tuple[GuiClarificationOption, ...]

    @field_validator("title", "description")
    @classmethod
    def validate_text(cls, value: str | None) -> str | None:
        if value is None:
            return None
        value = value.strip()
        if not value or len(value) > 512:
            raise ValueError("clarification text is invalid")
        return value

    @field_validator("options")
    @classmethod
    def validate_options(
        cls, value: tuple[GuiClarificationOption, ...]
    ) -> tuple[GuiClarificationOption, ...]:
        if not 1 <= len(value) <= 8 or len({option.id for option in value}) != len(value):
            raise ValueError("clarification options are invalid")
        return value


class GuiChatResponseProposal(BaseModel):
    """Untrusted local-Codex response for one GUI chat turn."""

    model_config = ConfigDict(extra="forbid")

    schema_version: Literal["flow-agent.gui_chat_response.v1"] = (
        "flow-agent.gui_chat_response.v1"
    )
    operation: Literal["1", "2", "3", "4"] | None = None
    answer: str | None = None
    clarification: GuiClarificationProposal | None = None
    evidence_ids: tuple[str, ...] = ()

    @field_validator("answer")
    @classmethod
    def validate_answer(cls, value: str | None) -> str | None:
        if value is None:
            return None
        value = value.strip()
        if not value or len(value) > 4096:
            raise ValueError("chat answer is invalid")
        return value

    @field_validator("evidence_ids")
    @classmethod
    def validate_evidence_ids(cls, value: tuple[str, ...]) -> tuple[str, ...]:
        if len(value) > 12 or len(set(value)) != len(value) or any(
            not re.fullmatch(r"source-[1-9][0-9]*", item) for item in value
        ):
            raise ValueError("chat evidence ids are invalid")
        return value

    @model_validator(mode="after")
    def validate_route(self) -> "GuiChatResponseProposal":
        routes = (self.operation, self.answer, self.clarification)
        if sum(value is not None for value in routes) != 1:
            raise ValueError("chat response must contain exactly one route")
        if self.operation is not None and self.evidence_ids:
            raise ValueError("chat operation cannot cite source evidence")
        if self.clarification is not None and self.evidence_ids:
            raise ValueError("chat clarification cannot cite source evidence")
        return self
