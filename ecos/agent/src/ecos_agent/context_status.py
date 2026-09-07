"""Read-only, deterministic projections of authoritative Agent state."""

from __future__ import annotations

import copy
import json
import math
from typing import Any, Mapping, TYPE_CHECKING

from ecos_agent.hashing import canonical_sha256
from ecos_agent.optimization.contracts import BudgetSnapshot

if TYPE_CHECKING:
    from ecos_agent.gui.session import ProviderSession

MAX_STATUS_BYTES = 8192
_MAX_STATUS_ITEMS = 6
_MAX_STATUS_TEXT_BYTES = 256


def bounded_status(status: Mapping[str, Any]) -> dict[str, Any]:
    """Bound the presentation only; never shorten authoritative control payloads."""
    shortened: set[str] = set()
    nodes = 0

    def visit(value: Any, path: str, depth: int = 0) -> Any:
        nonlocal nodes
        nodes += 1
        if nodes > 256 or depth > 6:
            shortened.add(path)
            return None
        if value is None or isinstance(value, bool):
            return value
        if isinstance(value, (float, int)):
            if (isinstance(value, float) and math.isfinite(value)) or (
                isinstance(value, int) and value.bit_length() <= 64
            ):
                return value
            shortened.add(path)
            return None
        if isinstance(value, str):
            encoded = value.encode("utf-8")
            if len(encoded) > _MAX_STATUS_TEXT_BYTES:
                shortened.add(path)
                return encoded[:_MAX_STATUS_TEXT_BYTES - 3].decode("utf-8", errors="ignore") + "..."
            return value
        if isinstance(value, (list, tuple)):
            if len(value) > _MAX_STATUS_ITEMS:
                shortened.add(path)
            return [visit(item, f"{path}[{index}]", depth + 1) for index, item in enumerate(value[:_MAX_STATUS_ITEMS])]
        if isinstance(value, Mapping):
            keys = sorted(key for key in value if isinstance(key, str))
            if len(keys) > 16 or len(keys) != len(value):
                shortened.add(path)
            return {key: visit(value[key], f"{path}.{key}", depth + 1) for key in keys[:16]}
        shortened.add(path)
        return None

    result = visit(status, "agent_status")

    def encoded_size() -> int:
        result["truncation"] = {
            "applied": bool(shortened),
            "fields": sorted(shortened)[:12],
            "details_complete": len(shortened) <= 12,
        }
        return len(json.dumps(result, ensure_ascii=False, separators=(",", ":")).encode("utf-8"))

    # Keep decision-critical state; detailed history and activity remain in their owners.
    for path in (
        ("progress", "completed"), ("local_activity", "events"),
        ("runtime", "last_turn", "events"), ("environment", "changed_fields"),
    ):
        if encoded_size() <= MAX_STATUS_BYTES:
            break
        parent = result
        for key in path[:-1]:
            parent = _mapping(parent.get(key))
        if path[-1] in parent:
            parent[path[-1]] = []
            shortened.add("agent_status." + ".".join(path))
    if encoded_size() > MAX_STATUS_BYTES:
        return _minimal_status(status)
    return result


def _minimal_status(status: Mapping[str, Any]) -> dict[str, Any]:
    def scalar(value: Any) -> Any:
        if isinstance(value, str):
            encoded = value.encode("utf-8")
            text = value if len(encoded) <= 96 else encoded[:93].decode("utf-8", errors="ignore") + "..."
            while len(json.dumps(text, ensure_ascii=False).encode("utf-8")) > 128:
                text = text[:-1]
            return text
        if value is None or isinstance(value, bool):
            return value
        if isinstance(value, int) and value.bit_length() <= 64:
            return value
        if isinstance(value, float) and math.isfinite(value):
            return value
        return None

    def fields(value: Any, keys: tuple[str, ...]) -> dict[str, Any]:
        source = _mapping(value)
        return {key: scalar(source[key]) for key in keys if key in source}

    progress = _mapping(status.get("progress"))
    runtime = _mapping(status.get("runtime"))
    last = _mapping(status.get("last_action"))
    return {
        "schema_version": "ecos.agent_status.v1",
        "scope": fields(status.get("scope"), ("thread_id", "session_id", "episode_id", "workspace_ref", "lane")),
        "snapshot_seq": scalar(status.get("snapshot_seq")),
        "phase": scalar(status.get("phase")),
        "objective": fields(status.get("objective"), ("primary_metric", "contract_sha256")),
        "active_objective": fields(status.get("active_objective"), ("active_primary_metric", "recovery_stage")),
        "progress": {
            "completed": None,
            "completed_scope": "omitted",
            **{key: [scalar(item) for item in progress[key][:_MAX_STATUS_ITEMS]]
               if isinstance(progress.get(key), list) else None
               for key in ("pending", "blockers")},
        },
        "last_action": {
            "outcome": scalar(last.get("outcome")),
            "reference": fields(last.get("reference"), ("intervention_id", "outcome_sha256")),
        } if last else None,
        "budget": fields(status.get("budget"), (
            "remaining_candidates", "remaining_planning_calls", "remaining_wall_time_seconds", "exhausted",
        )),
        "runtime": {
            key: fields(runtime.get(key), ("thread_id", "turn_id", "failure_class"))
            for key in ("last_turn", "previous_thread_failure")
        },
        "truncation": {"applied": True, "fields": ["agent_status"], "details_complete": False},
    }


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
    """One prior environment per fixed lane; business state stays with its owner."""

    def __init__(self) -> None:
        self._thread_id: str | None = None
        self._previous: dict[str, tuple[dict[str, Any], dict[str, Any]]] = {}
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
        if self._thread_id != thread_id:
            self._thread_id = thread_id
            self._previous.clear()
            self._sequence = 0
        old_scope, old_environment = self._previous.get(scope["lane"], ({}, {}))
        first = old_scope != scope
        changed = [] if first else sorted(
            key for key in environment if environment[key] != old_environment.get(key)
        )
        self._sequence += 1
        self._previous[scope["lane"]] = (copy.deepcopy(scope), copy.deepcopy(environment))
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
        local = _fields(gui.get("local_activity"), (
            "scope", "observed_activities", "counts_complete", "events_truncated",
        ))
        events = _mapping(gui.get("local_activity")).get("events", [])
        if isinstance(events, list):
            local["events"] = [_fields(event, ("item_ref", "status")) for event in events[-6:]]
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
            "local_activity": local if gui.get("local_activity") is not None else None,
            "budget": budget,
            "environment": {
                "baseline": "first_snapshot" if first else "previous_request",
                "changed_fields": changed,
                "observation_ref": copy.deepcopy(payload.get("observation_ref")),
                "checkpoint_id": context.get("checkpoint_id"),
            },
        }
