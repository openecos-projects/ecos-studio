"""Slash-command handlers for the ECOS Agent GUI chat."""

from __future__ import annotations

import uuid
from typing import Any, Callable, Mapping

from ecos_agent.codex.provider import CodexProviderError
from ecos_agent.gui.provider_common import _Session


class ProviderSlashCommandsMixin:
    def _handle_slash_command(self, session: _Session, message: str) -> None:
        command, _, argument = message.partition(" ")
        handlers: dict[str, Callable[[_Session, str], None]] = {
            "/compact": self._slash_compact,
            "/fork": self._slash_fork,
            "/goal": self._slash_goal,
            "/help": self._slash_help,
            "/model": self._slash_model,
            "/new": self._slash_new,
            "/permissions": self._slash_permissions,
            "/rename": self._slash_rename,
            "/resume": self._slash_resume,
            "/review": self._slash_review,
            "/status": self._slash_status,
        }
        handler = handlers.get(command.casefold())
        if handler is None:
            detail = (
                "Shell execution is not exposed in Agent Chat."
                if command.casefold() in {"/command", "/exec", "/shell", "/terminal"}
                else "Type /help for supported commands."
            )
            self._emit(session, "error", f"Unsupported slash command: {command}. {detail}")
            return
        try:
            handler(session, argument.strip())
        except (CodexProviderError, ValueError) as exc:
            self._emit(session, "error", str(exc))

    def _slash_help(self, session: _Session, _argument: str) -> None:
        self._emit(
            session,
            "message",
            "Supported: /model, /goal, /compact, /review, /new, /resume, "
            "/fork, /rename, /status, /permissions. Terminal-only commands "
            "such as /theme and /keymap do not apply to Agent Chat.",
        )

    def _slash_model(self, session: _Session, argument: str) -> None:
        provider = self._chat_provider(session)
        if argument:
            model = provider.select_model(argument)
            name = model.get("displayName") or model.get("model")
            self._emit(session, "message", f"Model set to {name}.")
            return
        models = provider.list_models()
        options = [
            {
                "id": str(index),
                "label": str(item.get("displayName") or item.get("model") or item.get("id")),
                "value": f"/model {item.get('model') or item.get('id')}",
            }
            for index, item in enumerate(models, start=1)
        ]
        self._emit_command_choice(session, "Select a Codex model", options)

    def _slash_goal(self, session: _Session, argument: str) -> None:
        provider = self._chat_provider(session)
        if not argument:
            goal = provider.get_goal()
            self._emit(session, "message", self._goal_text(goal))
            return
        action, _, value = argument.partition(" ")
        if action == "clear":
            provider.clear_goal()
            self._emit(session, "message", "Goal cleared.")
        elif action in {"pause", "resume"}:
            goal = provider.set_goal(status="paused" if action == "pause" else "active")
            self._emit(session, "message", self._goal_text(goal))
        elif action == "edit":
            if not value.strip():
                raise ValueError("Usage: /goal edit <objective>")
            goal = provider.set_goal(objective=value.strip())
            self._emit(session, "message", self._goal_text(goal))
        else:
            goal = provider.set_goal(objective=argument)
            self._emit(session, "message", self._goal_text(goal))

    @staticmethod
    def _goal_text(goal: Mapping[str, Any] | None) -> str:
        if goal is None:
            return "No active goal."
        return f"Goal ({goal.get('status', 'active')}): {goal.get('objective', '')}"

    def _slash_compact(self, session: _Session, argument: str) -> None:
        if argument:
            raise ValueError("Usage: /compact")
        self._chat_provider(session).compact()
        self._emit(session, "message", "Compaction started for this Chat thread.")

    def _slash_review(self, session: _Session, argument: str) -> None:
        if argument:
            raise ValueError("Usage: /review")
        review = self._chat_provider(session).review_uncommitted_changes()
        self._emit(session, "message", review or "Review completed with no findings.")

    def _slash_new(self, session: _Session, argument: str) -> None:
        thread_id = self._chat_provider(session).start_new_thread(argument or None)
        self._emit(session, "message", f"Started a new Codex thread: {thread_id}")

    def _slash_fork(self, session: _Session, argument: str) -> None:
        if argument:
            raise ValueError("Usage: /fork")
        thread_id = self._chat_provider(session).fork_thread()
        self._emit(session, "message", f"Forked into Codex thread: {thread_id}")

    def _slash_rename(self, session: _Session, argument: str) -> None:
        if not argument:
            raise ValueError("Usage: /rename <name>")
        self._chat_provider(session).rename_thread(argument)
        self._emit(session, "message", f"Chat renamed to {argument}.")

    def _slash_resume(self, session: _Session, argument: str) -> None:
        provider = self._chat_provider(session)
        if argument:
            thread_id = provider.resume_thread(argument)
            self._emit(session, "message", f"Resumed Codex thread: {thread_id}")
            return
        options = [
            {
                "id": str(index),
                "label": str(item.get("name") or item.get("preview") or item.get("id")),
                "value": f"/resume {item.get('id')}",
            }
            for index, item in enumerate(provider.list_threads(), start=1)
            if item.get("id")
        ]
        self._emit_command_choice(session, "Resume a Codex thread", options)

    def _slash_status(self, session: _Session, argument: str) -> None:
        if argument:
            raise ValueError("Usage: /status")
        provider = self._chat_provider(session)
        thread_id = provider.thread_id or "not started"
        model = provider.model or "default"
        self._emit(
            session,
            "message",
            f"Thread: {thread_id}\nModel: {model}\nPermissions: read-only, approvals disabled",
        )

    def _slash_permissions(self, session: _Session, _argument: str) -> None:
        self._emit(
            session,
            "message",
            "ECOS Agent Chat is fixed to read-only Codex access. Execution remains behind "
            "typed ECOS contracts, local validation, and explicit GUI confirmation.",
        )

    def _emit_command_choice(
        self, session: _Session, title: str, options: list[dict[str, str]]
    ) -> None:
        if not options:
            raise ValueError(f"{title}: no options are available")
        request, values = self._interaction_for_choice(
            session,
            {
                "promptId": uuid.uuid4().hex,
                "title": title,
                "options": options,
                "allowFreeText": False,
                "variant": "list",
            },
        )
        self._validate_interaction_budget(request)
        session.pending_interaction = {"request": request, "values": values}
        self._emit(session, "interaction", title, interaction=request)
