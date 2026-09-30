"""One GUI turn's execution and local observation lifecycle."""

from __future__ import annotations

import time
import uuid
from typing import Callable

from ecos_agent.codex.rpc import CodexProviderError
from ecos_agent.gui.messages import language_for_text
from ecos_agent.gui.provider_common import _INTERACTION_UNDO_BARRIER_PHASES
from ecos_agent.gui.session import ProviderSession


class ProviderTurnMixin:
    def _run_turn(
        self,
        session: ProviderSession,
        message: str,
        handler: Callable[[ProviderSession, str], None] | None = None,
        *,
        turn_reserved: bool = False,
    ) -> dict[str, str]:
        if not turn_reserved:
            self._reserve_turn(session)
        if not session.language_locked:
            session.language = language_for_text(message)
            session.language_locked = True
        turn_id = uuid.uuid4().hex
        session.active_turn_id = turn_id
        session.active_turn_started_at = round(time.time() * 1000)
        session.active_local_activities.clear()
        session.active_tool_message_id = f"{turn_id}-tool"
        session.interrupt_requested = False
        self._emit_status(session, "running")
        interrupted = False
        failed = False
        try:
            (handler or self._handle_input)(session, message)
            self._check_interrupted(session)
            if session.phase in _INTERACTION_UNDO_BARRIER_PHASES:
                session.interaction_undo.clear()
        except CodexProviderError as exc:
            if exc.failure_class != "interrupted":
                failed = True
                self._emit_status(session, "error")
                raise
            interrupted = True
            self._emit(session, "message", "The current Agent turn was interrupted.")
            self._emit_status(session, "interrupted")
        except Exception:
            failed = True
            self._emit_status(session, "error")
            raise
        finally:
            with session.state_lock:
                session.local_telemetry.finish(
                    turn_id, "interrupted" if interrupted else "failed" if failed else "unknown"
                )
            session.active_interrupt = None
            if session.codex_provider is not None:
                session.codex_provider.clear_interrupted()
            session.active_tool_message_id = None
            session.active_turn_id = None
            session.active_turn_started_at = None
            session.active_local_activities.clear()
            self._finish_turn(session)
        if not interrupted:
            self._emit_status(session, self._resting_status(session))
        return {"messageId": turn_id, "sessionId": session.session_id, "turnId": turn_id}
