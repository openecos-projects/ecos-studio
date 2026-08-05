"""Read-only Codex proposals for the ECOS GUI agent."""

from __future__ import annotations

import json
import os
import shutil
import threading
from pathlib import Path
from typing import Any, Callable, Iterable, Mapping

from ecos_agent.codex_rpc import CodexProviderError, _JsonLineRpcProcessClient, _read_nested_string
from ecos_agent.contracts import GUI_WORKSPACE_FLOW_STEPS, GuiWorkspaceSetupProposal
from ecos_agent.ecc_contracts import ECCParameterPatchItem
from ecos_agent.workspace_rerun import GuiWorkspaceRerunParameterProposal


class CodexAppServerProposalProvider:
    """Codex app-server client constrained to read-only typed GUI proposals."""

    def __init__(
        self,
        *,
        codex_bin: str | None = None,
        cwd: Path | None = None,
        env: Mapping[str, str] | None = None,
        timeout_seconds: int | None = None,
        runtime_workspace_roots: Iterable[str | Path] | None = None,
        progress_callback: Callable[[str], None] | None = None,
    ) -> None:
        self.cwd = Path(cwd or Path.cwd())
        self.env = dict(env or os.environ)
        self.timeout_seconds = timeout_seconds or _timeout_from_env(self.env)
        self.codex_bin = _resolve_codex_bin(codex_bin or self.env.get("ECOS_AGENT_CODEX_BIN"), self.env)
        self.runtime_workspace_roots = _runtime_workspace_roots(runtime_workspace_roots or (self.cwd,))
        self.progress_callback = progress_callback
        self._client: _JsonLineRpcProcessClient | None = None
        self._thread_id: str | None = None
        self._active_turn_id: str | None = None
        self._interrupted = False
        self._state_lock = threading.Lock()

    def close(self) -> None:
        if self._client is not None:
            self._client.close()
            self._client = None
            self._thread_id = None

    def interrupt(self) -> None:
        with self._state_lock:
            self._interrupted = True
            client = self._client
            turn_id = self._active_turn_id
        if client is not None:
            if turn_id is not None:
                client.interrupt_turn(turn_id)
            else:
                client.close()

    def propose_gui_workspace_setup(self, context: dict[str, Any]) -> dict[str, Any]:
        return self._proposal(
            context,
            (
                "Return one JSON object matching flow-agent.gui_workspace_setup_proposal.v1. "
                "Interpret only a correction to the supplied GUI workspace specification. "
                "When numeric_field is supplied, interpret only that field and return null for every other "
                "optional field. "
                "Use read-only search and file reading only inside filesystem_roots. "
                "Never modify files, return shell commands, select an ECC command, or grant execution authority."
            ),
            _gui_workspace_setup_output_schema(),
            GuiWorkspaceSetupProposal,
        )

    def propose_gui_workspace_path_discovery(self, context: dict[str, Any]) -> dict[str, Any]:
        return self._proposal(
            context,
            (
                "Return one JSON object matching flow-agent.gui_workspace_setup_proposal.v1. "
                "Find existing RTL, filelist, and SDC files only within filesystem_roots. "
                "Return null for every other field except summary. Never modify files or return commands."
            ),
            _gui_workspace_setup_output_schema(),
            GuiWorkspaceSetupProposal,
        )

    def propose_gui_workspace_rerun_patch(self, context: dict[str, Any]) -> dict[str, Any]:
        allowed_knobs = context.get("allowed_knobs")
        if not isinstance(allowed_knobs, list) or not all(isinstance(item, str) for item in allowed_knobs):
            raise CodexProviderError("GUI rerun request has no allowed knobs", failure_class="missing_input")
        boolean_knobs = context.get("boolean_knobs")
        if (
            not isinstance(boolean_knobs, list)
            or not all(isinstance(item, str) and item in allowed_knobs for item in boolean_knobs)
        ):
            raise CodexProviderError("GUI rerun request has invalid boolean knobs", failure_class="missing_input")
        return self._proposal(
            context,
            (
                "Return one JSON object matching flow-agent.gui_workspace_rerun_parameter_proposal.v1. "
                "Return every requested applicable parameter change as one separate parameter_patch item. "
                "Use only knob_id values from allowed_knobs; resolve an unqualified knob name only when it has "
                "one unique match in allowed_knobs. For knob_id values in boolean_knobs, interpret numeric 0 as "
                "false and 1 as true, then return JSON booleans. Never return paths, shell commands, ECC commands, "
                "tool calls, stage changes, workspace names, or execution instructions."
            ),
            _gui_workspace_rerun_patch_output_schema(allowed_knobs),
            GuiWorkspaceRerunParameterProposal,
        )

    def _proposal(
        self,
        context: dict[str, Any],
        system: str,
        output_schema: dict[str, Any],
        model: type[GuiWorkspaceSetupProposal] | type[GuiWorkspaceRerunParameterProposal],
    ) -> dict[str, Any]:
        try:
            return model.model_validate(
                self._request_json(system=system, user=context, output_schema=output_schema)
            ).model_dump(mode="json")
        except CodexProviderError:
            raise
        except Exception as exc:
            raise CodexProviderError(
                "Codex GUI proposal failed schema validation", failure_class="parse_error"
            ) from exc

    def _request_json(
        self, *, system: str, user: dict[str, Any], output_schema: dict[str, Any]
    ) -> dict[str, Any]:
        text = self._run_turn(_build_prompt(system, user), output_schema)
        try:
            payload = json.loads(text)
        except json.JSONDecodeError as exc:
            raise CodexProviderError("Codex assistant content is not valid JSON", failure_class="parse_error") from exc
        if not isinstance(payload, dict):
            raise CodexProviderError("Codex assistant JSON must be an object", failure_class="parse_error")
        return payload

    def _run_turn(self, prompt: str, output_schema: dict[str, Any]) -> str:
        with self._state_lock:
            if self._interrupted:
                raise CodexProviderError("Codex turn interrupted", failure_class="interrupted")
        self._report_progress("Codex is analyzing the bounded request.")
        client = self._ensure_client()
        thread_id = self._ensure_thread(client)
        response = client.request(
            "turn/start",
            {
                "threadId": thread_id,
                "input": [{"type": "text", "text": prompt, "text_elements": []}],
                "responsesapiClientMetadata": None,
                "environments": [],
                "cwd": str(self.cwd),
                "runtimeWorkspaceRoots": list(self.runtime_workspace_roots),
                "approvalPolicy": "never",
                "approvalsReviewer": None,
                "sandboxPolicy": {"type": "readOnly", "networkAccess": False},
                "permissions": None,
                "model": None,
                "serviceTier": None,
                "effort": None,
                "summary": None,
                "personality": None,
                "outputSchema": output_schema,
                "collaborationMode": None,
            },
        )
        turn_id = _read_nested_string(response, (("turn", "id"), ("turnId",), ("id",)))
        if not turn_id:
            raise CodexProviderError("Codex turn/start response missing turn id", failure_class="tool_error")
        with self._state_lock:
            self._active_turn_id = turn_id
        self._report_progress("Codex request accepted; waiting for read-only activity.")
        try:
            text, _ = client.wait_for_turn_details(
                turn_id, thread_id=thread_id, activity_callback=self._report_progress
            )
        except CodexProviderError as exc:
            if self._interrupted:
                raise CodexProviderError("Codex turn interrupted", failure_class="interrupted") from exc
            raise
        finally:
            with self._state_lock:
                self._active_turn_id = None
        if self._interrupted:
            raise CodexProviderError("Codex turn interrupted", failure_class="interrupted")
        self._report_progress("Codex returned a structured proposal for local validation.")
        return text

    def _ensure_client(self) -> _JsonLineRpcProcessClient:
        if self._client is None:
            self._client = _JsonLineRpcProcessClient(
                command=self.codex_bin,
                args=["app-server", "-c", "mcp_servers={}", "--listen", "stdio://"],
                cwd=self.cwd,
                env=self.env,
                timeout_seconds=self.timeout_seconds,
            )
            self._client.start()
            self._client.request(
                "initialize",
                {
                    "clientInfo": {"name": "ecos-agent", "title": "ECOS Agent", "version": "0.1.0"},
                    "capabilities": {"experimentalApi": True, "requestAttestation": False},
                },
            )
        return self._client

    def _ensure_thread(self, client: _JsonLineRpcProcessClient) -> str:
        if self._thread_id is None:
            response = client.request(
                "thread/start",
                {
                    "model": None,
                    "modelProvider": None,
                    "serviceTier": None,
                    "cwd": str(self.cwd),
                    "runtimeWorkspaceRoots": list(self.runtime_workspace_roots),
                    "approvalPolicy": "never",
                    "approvalsReviewer": None,
                    "sandbox": "read-only",
                    "permissions": None,
                    "config": None,
                    "serviceName": "ecos-agent",
                    "baseInstructions": None,
                    "developerInstructions": None,
                    "personality": None,
                    "ephemeral": True,
                    "sessionStartSource": None,
                    "threadSource": None,
                    "environments": [],
                    "dynamicTools": None,
                    "mockExperimentalField": None,
                    "experimentalRawEvents": False,
                    "persistExtendedHistory": False,
                },
            )
            self._thread_id = _read_nested_string(response, (("thread", "id"), ("threadId",), ("id",)))
            if not self._thread_id:
                raise CodexProviderError("Codex thread/start response missing thread id", failure_class="tool_error")
        return self._thread_id

    def _report_progress(self, text: str) -> None:
        if self.progress_callback is not None:
            self.progress_callback(text)


def create_required_codex_provider(
    *,
    cwd: Path | None = None,
    runtime_workspace_roots: Iterable[str | Path] | None = None,
    progress_callback: Callable[[str], None] | None = None,
) -> CodexAppServerProposalProvider:
    return CodexAppServerProposalProvider(
        cwd=cwd,
        runtime_workspace_roots=runtime_workspace_roots,
        progress_callback=progress_callback,
    )


def validate_required_codex_cli(env: Mapping[str, str] | None = None) -> str:
    environment = os.environ if env is None else env
    return _resolve_codex_bin(environment.get("ECOS_AGENT_CODEX_BIN"), environment)


def _resolve_codex_bin(candidate: str | None, env: Mapping[str, str]) -> str:
    if candidate:
        path = Path(candidate).expanduser()
        resolved = shutil.which(str(path), path=env.get("PATH"))
        if resolved:
            return resolved
        if path.is_file() and os.access(path, os.X_OK):
            return str(path)
        raise CodexProviderError("Codex CLI is required but not executable", failure_class="missing_input")
    resolved = shutil.which("codex", path=env.get("PATH"))
    if not resolved:
        raise CodexProviderError("Codex CLI is required for ECOS Agent", failure_class="missing_input")
    return resolved


def _timeout_from_env(env: Mapping[str, str]) -> int:
    try:
        timeout = int(env.get("ECOS_AGENT_CODEX_TIMEOUT_SECONDS", "150"))
    except ValueError as exc:
        raise CodexProviderError("ECOS_AGENT_CODEX_TIMEOUT_SECONDS must be an integer", failure_class="missing_input") from exc
    if timeout <= 0:
        raise CodexProviderError("ECOS_AGENT_CODEX_TIMEOUT_SECONDS must be positive", failure_class="missing_input")
    return timeout


def _runtime_workspace_roots(roots: Iterable[str | Path]) -> tuple[str, ...]:
    normalized = tuple(dict.fromkeys(str(Path(root).expanduser().resolve()) for root in roots))
    if not normalized or any(not Path(root).is_dir() for root in normalized):
        raise CodexProviderError("Codex runtime workspace roots must be existing directories", failure_class="missing_input")
    return normalized


def _build_prompt(system: str, user: dict[str, Any]) -> str:
    return "\n\n".join(
        (
            system,
            "ECOS Agent constraints:\n- Return exactly one JSON object and no markdown.\n- Do not return shell commands or raw ECC commands.\n- Local validation and GUI confirmation own execution.",
            "Payload JSON:\n" + json.dumps(user, sort_keys=True, default=str),
        )
    )


def _gui_workspace_setup_output_schema() -> dict[str, Any]:
    return {
        "type": "object",
        "additionalProperties": False,
        "required": [
            "schema_version", "workspace_name", "description", "design_name", "top_module", "clock_name",
            "frequency_mhz", "max_fanout", "flow_start", "flow_end", "die_area_mode", "utilitization",
            "margin", "die_width", "die_height", "target_density", "target_overflow", "project_root",
            "rtl_path", "filelist_path", "sdc_path", "pdk_root", "summary",
        ],
        "properties": {
            "schema_version": {"type": "string", "const": "flow-agent.gui_workspace_setup_proposal.v1"},
            "workspace_name": {"type": "null"},
            "description": {"type": "null"},
            "design_name": {"type": ["string", "null"], "maxLength": 128},
            "top_module": {"type": ["string", "null"], "maxLength": 128},
            "clock_name": {"type": ["string", "null"], "maxLength": 128},
            "frequency_mhz": {"type": ["number", "null"]},
            "max_fanout": {"type": ["number", "null"]},
            "flow_start": {"type": "null"},
            "flow_end": {"type": ["string", "null"], "enum": [*GUI_WORKSPACE_FLOW_STEPS, None]},
            "die_area_mode": {"type": ["string", "null"], "enum": ["utilitization_margin", "width_height", None]},
            "utilitization": {"type": ["number", "null"]},
            "margin": {"type": ["number", "null"]},
            "die_width": {"type": ["number", "null"]},
            "die_height": {"type": ["number", "null"]},
            "target_density": {"type": ["number", "null"]},
            "target_overflow": {"type": ["number", "null"]},
            "project_root": {"type": ["string", "null"], "maxLength": 4096},
            "rtl_path": {"type": ["string", "null"], "maxLength": 4096},
            "filelist_path": {"type": ["string", "null"], "maxLength": 4096},
            "sdc_path": {"type": ["string", "null"], "maxLength": 4096},
            "pdk_root": {"type": ["string", "null"], "maxLength": 4096},
            "summary": {"type": "string", "minLength": 1, "maxLength": 512},
        },
    }


def _gui_workspace_rerun_patch_output_schema(allowed_knobs: list[str]) -> dict[str, Any]:
    value_schema = ECCParameterPatchItem.model_json_schema()["properties"]["value"]
    return {
        "type": "object",
        "additionalProperties": False,
        "required": ["schema_version", "parameter_patch", "summary"],
        "properties": {
            "schema_version": {"type": "string", "const": "flow-agent.gui_workspace_rerun_parameter_proposal.v1"},
            "parameter_patch": {
                "type": "array",
                "maxItems": 16,
                "items": {
                    "type": "object",
                    "additionalProperties": False,
                    "required": ["knob_id", "value"],
                    "properties": {
                        "knob_id": {"type": "string", "enum": allowed_knobs},
                        "value": value_schema,
                    },
                },
            },
            "summary": {"type": "string", "minLength": 1, "maxLength": 512},
        },
    }
