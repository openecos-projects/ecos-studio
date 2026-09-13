"""Workspace source-evidence retrieval for GUI chat answers."""

from __future__ import annotations

from typing import Any

from ecos_agent.codex.provider import CodexProviderError
from ecos_agent.gui.provider_common import _Session, _is_greeting
from ecos_agent.gui.support import _propose_source_retrieval
from ecos_agent.knowledge.bundle import KnowledgeAnswer
from ecos_agent.knowledge.contracts import SourceSearchProposal
from ecos_agent.knowledge.source import (
    SourceSearchResult,
    deterministic_source_proposal,
)


class ProviderSourceEvidenceMixin:
    def _source_code_evidence(
        self, session: _Session, message: str, knowledge_answer: KnowledgeAnswer | None
    ) -> SourceSearchResult | None:
        if (
            _is_greeting(message)
            or not self.source_retriever.available_root_ids
            or (self.source_retrieval_parser is _propose_source_retrieval and not self._started)
        ):
            return None
        deterministic_proposal = (
            deterministic_source_proposal(
                message, self.source_retriever.available_root_ids
            )
            if self.source_retrieval_parser is _propose_source_retrieval
            else None
        )
        if deterministic_proposal is not None:
            result = self._search_sources(session, deterministic_proposal)
            if result.evidence:
                return result
        context: dict[str, Any] = {
            "schema_version": "flow-agent.source_search_request.v1",
            "natural_language_request": message,
            "available_source_roots": list(self.source_retriever.available_root_ids),
            "source_workspace_roots": [
                str(root) for root in self.source_retriever.source_workspace_roots
            ],
            "_progress_callback": lambda text: self._progress(session, text),
            "_register_interrupt": lambda callback: self._register_interrupt(session, callback),
        }
        if knowledge_answer is not None:
            context["retrieved_knowledge"] = {
                **knowledge_answer.contract,
                "entity_ids": list(knowledge_answer.entity_ids),
                "text": knowledge_answer.text,
            }
        try:
            if self.source_retrieval_parser is _propose_source_retrieval:
                provider = self._chat_provider(session)
                self._register_interrupt(session, provider.interrupt)
                request_context = {
                    key: value for key, value in context.items() if not key.startswith("_")
                }
                payload = provider.propose_source_search(request_context, effort="low")
                self._register_interrupt(session, None)
            else:
                payload = self.source_retrieval_parser(context)
            proposal = SourceSearchProposal.model_validate(payload)
            return self._search_sources(session, proposal)
        except (CodexProviderError, ValueError) as exc:
            if "local-source-search" in session.active_local_activities:
                self._local_activity(
                    session,
                    "source-search",
                    "Search workspace sources",
                    "failed",
                    error=str(exc),
                )
            return None

    def _search_sources(
        self, session: _Session, proposal: SourceSearchProposal
    ) -> SourceSearchResult:
        self._local_activity(
            session,
            "source-search",
            "Search workspace sources",
            "running",
            arguments={
                "roots": list(self.source_retriever.available_root_ids),
                "queries": [query.model_dump(mode="json") for query in proposal.queries],
            },
            progress="Searching approved source roots",
        )
        result = self.source_retriever.retrieve(proposal)
        self._local_activity(
            session,
            "source-search",
            "Searched workspace sources",
            "completed",
            result={
                "evidence_count": len(result.evidence),
                "paths": list(dict.fromkeys(item.path for item in result.evidence)),
                "result_limit_reached": result.result_limit_reached,
            },
        )
        return result
