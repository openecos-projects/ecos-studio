"""Thread, goal, and model management for the Codex provider."""

from __future__ import annotations

import json
from typing import Any, Mapping

from ecos_agent.codex.provider_helpers import (
    _model_reasoning_efforts,
    _read_only_thread_config,
    _build_prompt,
    ToolPolicy,
)
from ecos_agent.codex.rpc import CodexProviderError, _read_nested_string, _JsonLineRpcProcessClient
from ecos_agent.context_status import StatusSnapshots
from ecos_agent.runtime_status import RequestTelemetry
from ecos_agent.hashing import canonical_sha256
from ecos_agent.optimization.contracts import PlanningProviderEnvelope


class CodexThreadManagementMixin:
    def _request_json(
        self,
        *,
        system: str,
        user: dict[str, Any],
        output_schema: dict[str, Any],
        tool_policy: ToolPolicy = "none",
    ) -> dict[str, Any]:
        with self._state_lock:
            if self._interrupted:
                raise CodexProviderError("Codex turn interrupted", failure_class="interrupted")
        thread_id = self._ensure_thread(self._ensure_client())
        status = self._status_snapshots.build(user, thread_id)
        status["runtime"] = self._runtime_status.snapshot(thread_id)
        prompt = _build_prompt(system, user, tool_policy=tool_policy, agent_status=status)
        with self._state_lock:
            if self._planning_envelope is not None:
                envelope = self._planning_envelope.model_dump(mode="json", exclude={"envelope_sha256"})
                envelope["prompt"] = prompt
                self._planning_envelope = PlanningProviderEnvelope(
                    **envelope, envelope_sha256=canonical_sha256(envelope)
                )
        text = self._run_turn(prompt, output_schema, tool_policy=tool_policy)
        try:
            payload = json.loads(text)
        except json.JSONDecodeError as exc:
            self._runtime_status.validation(False)
            raise CodexProviderError(
                "Codex assistant content is not valid JSON", failure_class="parse_error"
            ) from exc
        if not isinstance(payload, dict):
            self._runtime_status.validation(False)
            raise CodexProviderError(
                "Codex assistant JSON must be an object", failure_class="parse_error"
            )
        return payload

    def _start_and_wait(
        self, client: _JsonLineRpcProcessClient, thread_id: str,
        method: str, params: dict[str, Any], *, tool_policy: ToolPolicy = "none",
    ) -> str:
        self._runtime_status.begin(thread_id)
        self._last_turn_usage = None
        failure = None
        turn_id = None
        try:
            response = client.request(method, params)
            turn_id = _read_nested_string(response, (("turn", "id"), ("turnId",), ("id",)))
            return self._wait_for_turn(client, thread_id, response, tool_policy=tool_policy)
        except Exception as exc:
            failure = "interrupted" if self._interrupted else getattr(exc, "failure_class", "tool_error")
            raise
        finally:
            observed = {
                "thread_id": thread_id, "turn_id": turn_id,
                "tool_calls": None, "tool_counts_complete": False,
                "usage": self._last_turn_usage, "usage_source": None,
            }
            telemetry = getattr(client, "turn_telemetry", None)
            if telemetry is not None:
                details = telemetry.snapshot()
                if turn_id is not None and details.get("turn_id") == turn_id and details.get("thread_id") == thread_id:
                    observed = details
            self._runtime_status.finish(observed, failure)

    def close(self) -> None:
        if self._client is not None:
            self._client.close()
            self._client = None
            self._thread_id = None

    @property
    def optimization_proposal_v2_enabled(self) -> bool:
        return self.env.get("ECOS_ENABLE_OPTIMIZATION_PROPOSAL_V2", "1") == "1"

    def interrupt(self) -> None:
        with self._state_lock:
            self._interrupted = True
            client = self._client
            thread_id = self._thread_id
            turn_id = self._active_turn_id
        if client is not None:
            if thread_id is not None and turn_id is not None:
                client.interrupt_turn(thread_id, turn_id)
            else:
                client.close()
                with self._state_lock:
                    if self._client is client:
                        self._client = None
                        self._thread_id = None

    def clear_interrupted(self) -> None:
        with self._state_lock:
            self._interrupted = False

    def new_ephemeral_thread(self) -> None:
        """Discard prior proposal context before an independent evaluation case."""

        with self._state_lock:
            if self._active_turn_id is not None:
                raise CodexProviderError(
                    "Codex turn is active", failure_class="tool_error"
                )
            self._thread_id = None
            self._interrupted = False
            self._status_snapshots = StatusSnapshots()
            self._runtime_status = RequestTelemetry()

    @property
    def thread_id(self) -> str | None:
        return self._thread_id

    @property
    def model(self) -> str | None:
        return self._model

    def list_models(self) -> list[dict[str, Any]]:
        response = self._ensure_client().request("model/list", {"includeHidden": False})
        models = response.get("data")
        if (
            not isinstance(models, list)
            or not models
            or not all(
                isinstance(item, dict) and isinstance(item.get("model"), str)
                for item in models
            )
        ):
            raise CodexProviderError(
                "Codex model/list response is invalid", failure_class="tool_error"
            )
        return models

    def select_model(self, requested: str) -> dict[str, Any]:
        model = next(
            (
                item
                for item in self.list_models()
                if requested in {item.get("id"), item.get("model")}
            ),
            None,
        )
        if model is None or not isinstance(model.get("model"), str):
            raise CodexProviderError(
                f"Unknown Codex model: {requested}", failure_class="missing_input"
            )
        self._model = model["model"]
        efforts = _model_reasoning_efforts(model)
        if self._reasoning_effort not in efforts:
            default = model.get("defaultReasoningEffort")
            self._reasoning_effort = default if default in efforts else efforts[0]
        return model

    def get_model_settings(self) -> dict[str, Any]:
        models = self.list_models()
        current = next(
            (item for item in models if self._model in {item.get("id"), item.get("model")}),
            next((item for item in models if item.get("isDefault") is True), models[0]),
        )
        efforts = _model_reasoning_efforts(current)
        default = current.get("defaultReasoningEffort")
        effort = self._reasoning_effort or (default if default in efforts else efforts[0])
        return {
            "model": current["model"],
            "displayName": current.get("displayName") or current["model"],
            "reasoningEffort": effort,
            "models": [
                {
                    "model": item["model"],
                    "displayName": item.get("displayName") or item["model"],
                    "defaultReasoningEffort": (
                        item.get("defaultReasoningEffort")
                        if item.get("defaultReasoningEffort")
                        in _model_reasoning_efforts(item)
                        else _model_reasoning_efforts(item)[0]
                    ),
                    "supportedReasoningEfforts": _model_reasoning_efforts(item),
                }
                for item in models
                if isinstance(item.get("model"), str)
            ],
        }

    def set_model_settings(
        self, *, model: str | None = None, reasoning_effort: str | None = None
    ) -> dict[str, Any]:
        if model is not None:
            self.select_model(model)
        settings = self.get_model_settings()
        if reasoning_effort is not None:
            current = next(
                item for item in settings["models"] if item["model"] == settings["model"]
            )
            if reasoning_effort not in current["supportedReasoningEfforts"]:
                raise CodexProviderError(
                    f"Unsupported reasoning effort: {reasoning_effort}",
                    failure_class="missing_input",
                )
            self._model = settings["model"]
            self._reasoning_effort = reasoning_effort
            settings["reasoningEffort"] = reasoning_effort
        return settings

    def get_goal(self) -> dict[str, Any] | None:
        response = self._thread_request("thread/goal/get")
        goal = response.get("goal")
        return goal if isinstance(goal, dict) else None

    def set_goal(
        self, *, objective: str | None = None, status: str | None = None
    ) -> dict[str, Any]:
        params: dict[str, Any] = {}
        if objective is not None:
            params["objective"] = objective
        if status is not None:
            params["status"] = status
        response = self._thread_request("thread/goal/set", **params)
        goal = response.get("goal")
        if not isinstance(goal, dict):
            raise CodexProviderError(
                "Codex thread/goal/set response is invalid", failure_class="tool_error"
            )
        return goal

    def clear_goal(self) -> None:
        self._thread_request("thread/goal/clear")

    def compact(self) -> None:
        self._thread_request("thread/compact/start")

    def rename_thread(self, name: str) -> None:
        self._thread_request("thread/name/set", name=name)

    def start_new_thread(self, name: str | None = None) -> str:
        self.new_ephemeral_thread()
        thread_id = self._ensure_thread(self._ensure_client())
        if name:
            self.rename_thread(name)
        return thread_id

    def fork_thread(self) -> str:
        client = self._ensure_client()
        thread_id = self._ensure_thread(client)
        response = client.request(
            "thread/fork",
            {
                "threadId": thread_id,
                "model": self._model,
                "cwd": str(self.cwd),
                **_read_only_thread_config(),
                "ephemeral": self.ephemeral,
            },
        )
        fork_id = _read_nested_string(response, (("thread", "id"), ("threadId",), ("id",)))
        if not fork_id:
            raise CodexProviderError(
                "Codex thread/fork response missing thread id", failure_class="tool_error"
            )
        self._thread_id = fork_id
        self._status_snapshots = StatusSnapshots()
        self._runtime_status = RequestTelemetry()
        return fork_id

    def list_threads(self) -> list[dict[str, Any]]:
        response = self._ensure_client().request(
            "thread/list", {"cwd": str(self.cwd), "archived": False, "limit": 50}
        )
        threads = response.get("data")
        if not isinstance(threads, list) or not all(isinstance(item, dict) for item in threads):
            raise CodexProviderError(
                "Codex thread/list response is invalid", failure_class="tool_error"
            )
        return threads

    def resume_thread(self, thread_id: str) -> str:
        if thread_id not in {
            item.get("id") for item in self.list_threads() if isinstance(item.get("id"), str)
        }:
            raise CodexProviderError(
                "Codex thread is not available in this workspace",
                failure_class="missing_input",
            )
        response = self._ensure_client().request(
            "thread/resume",
            {
                "threadId": thread_id,
                "model": self._model,
                "cwd": str(self.cwd),
                **_read_only_thread_config(),
            },
        )
        resumed_id = _read_nested_string(response, (("thread", "id"), ("threadId",), ("id",)))
        if not resumed_id:
            raise CodexProviderError(
                "Codex thread/resume response missing thread id", failure_class="tool_error"
            )
        self._thread_id = resumed_id
        self._status_snapshots = StatusSnapshots()
        self._runtime_status = RequestTelemetry()
        return resumed_id

    def review_uncommitted_changes(self) -> str:
        client = self._ensure_client()
        thread_id = self._ensure_thread(client)
        return self._start_and_wait(
            client, thread_id, "review/start",
            {
                "threadId": thread_id,
                "target": {"type": "uncommittedChanges"},
                "delivery": "inline",
            },
        )

    def _thread_request(self, method: str, **params: Any) -> dict[str, Any]:
        client = self._ensure_client()
        return client.request(method, {"threadId": self._ensure_thread(client), **params})
