"""Read-only, deterministic projections of authoritative Agent state."""

from __future__ import annotations

import copy
from typing import Any, Mapping, TYPE_CHECKING

from ecos_agent.hashing import canonical_sha256
from ecos_agent.optimization.contracts import BudgetSnapshot

if TYPE_CHECKING:
    from ecos_agent.gui.session import ProviderSession


def gui_status_context(session: ProviderSession) -> dict[str, Any]:
    with session.state_lock:
        pending = session.pending_interaction
        return {
            "session_id": session.session_id,
            "episode_id": session.optimization_episode_id,
            "workspace_ref": canonical_sha256(session.rerun_workspace_path)
            if session.rerun_workspace_path else None,
            "phase": session.phase.value,
            "objective": copy.deepcopy(session.optimization_objective),
            "active_objective": copy.deepcopy(session.optimization_active_objective),
            "pending": [pending["request"]["requestId"]] if pending else [],
            "local_activity": session.local_telemetry.snapshot(),
        }


def _mapping(value: object) -> Mapping[str, Any]:
    return value if isinstance(value, Mapping) else {}


def _fields(value: object, keys: tuple[str, ...]) -> dict[str, Any]:
    source = _mapping(value)
    return {key: copy.deepcopy(source[key]) for key in keys if key in source}


class StatusSnapshots:
    """Only the previous environment is retained; business state stays with its owner."""

    def __init__(self) -> None:
        self._scope: dict[str, Any] | None = None
        self._environment: dict[str, Any] | None = None
        self._sequence = 0

    def build(self, payload: Mapping[str, Any], thread_id: str) -> dict[str, Any]:
        gui = _mapping(payload.get("session_state"))
        context = _mapping(payload.get("context_ref"))
        planning = bool(context)
        scope = {
            "thread_id": thread_id,
            "session_id": gui.get("session_id"),
            "episode_id": context.get("episode_id", gui.get("episode_id")),
            "workspace_ref": gui.get("workspace_ref"),
            "lane": "optimization" if planning else "gui" if gui else "request",
        }
        phase = "optimization_planning" if planning else gui.get("phase", payload.get("phase"))
        objective = payload.get("objective") if planning else gui.get("objective")
        active = payload.get("active_objective") if planning else gui.get("active_objective")
        environment = {
            "phase": phase,
            "checkpoint_id": context.get("checkpoint_id"),
            "observation_ref": payload.get("observation_ref"),
            "current_values_sha256": canonical_sha256(payload.get("current_values")),
            "legal_actions_sha256": canonical_sha256(payload.get("legal_actions", payload.get("allowed_operations"))),
            "effective_domains_sha256": canonical_sha256(payload.get("effective_domain", payload.get("effective_domains"))),
            "objective_sha256": canonical_sha256(objective),
            "active_objective_sha256": canonical_sha256(active),
        }
        first = self._scope != scope or self._environment is None
        changed = [] if first else sorted(
            key for key in environment if environment[key] != self._environment.get(key)
        )
        self._sequence = 1 if first else self._sequence + 1
        self._scope = copy.deepcopy(scope)
        self._environment = copy.deepcopy(environment)
        budget = None
        if planning and payload.get("budget") is not None:
            snapshot = BudgetSnapshot.model_validate(payload["budget"])
            budget = {
                "consumed_candidates": snapshot.consumed_candidates,
                "consumed_planning_calls": snapshot.consumed_planning_calls,
                "remaining_candidates": snapshot.remaining_candidates,
                "remaining_planning_calls": snapshot.remaining_planning_calls,
                "remaining_wall_time_seconds": snapshot.remaining_wall_time_seconds,
                "exhausted": snapshot.exhausted,
            }
        history = payload.get("history") if planning else None
        history = history if isinstance(history, list) else []
        last = _mapping(history[-1]) if history else {}
        terminal = _mapping(last.get("terminal_observation"))
        last_action = {
            "reference": copy.deepcopy(last.get("reference")),
            "outcome": last.get("outcome"),
            "terminal_observation_ref": _fields(
                terminal, ("observation_id", "evidence_manifest_sha256")
            ) or None,
        } if last else None
        blockers = ["budget_exhausted"] if budget and budget["exhausted"] else []
        if planning and not payload.get("legal_actions"):
            blockers.append("no_legal_actions")
        pending = copy.deepcopy(gui.get("pending", []))
        if pending:
            blockers.append("awaiting_interaction")
        return {
            "schema_version": "ecos.agent_status.v1",
            "scope": scope,
            "snapshot_seq": self._sequence,
            "phase": phase,
            "objective": _fields(objective, ("primary_metric", "preserve_metrics", "contract_sha256")) or None,
            "active_objective": _fields(active, ("active_primary_metric", "recovery_stage", "alignment_contract_sha256")) or None,
            "progress": {
                "completed": [copy.deepcopy(item.get("reference")) for item in history]
                if planning else None,
                "completed_scope": "recorded_outcomes_not_successes" if planning else "unknown",
                "pending": pending,
                "blockers": blockers,
            },
            "last_action": last_action,
            "local_activity": copy.deepcopy(gui.get("local_activity")),
            "budget": budget,
            "environment": {
                "baseline": "first_snapshot" if first else "previous_request",
                "changed_fields": changed,
                "observation_ref": copy.deepcopy(payload.get("observation_ref")),
                "checkpoint_id": context.get("checkpoint_id"),
            },
        }
