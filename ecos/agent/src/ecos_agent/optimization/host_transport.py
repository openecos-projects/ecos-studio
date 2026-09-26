"""JSONL host transport for Electron Product Commands."""

from __future__ import annotations

import threading
from collections.abc import Callable, Mapping
from typing import Protocol

from pathlib import Path

from ecos_agent.optimization.ecc.adapter import EccCandidateRerunAdapter
from ecos_agent.optimization.ecc.evidence import OptimizationEccAdapterError


class HostCaller(Protocol):
    def __call__(self, method: str, params: dict[str, object]) -> dict[str, object]: ...


_BOUND_HOST: object | None = None


def bind_host_transport(transport: object | None) -> None:
    global _BOUND_HOST
    _BOUND_HOST = transport


def _require_host_transport() -> object:
    if _BOUND_HOST is None:
        from ecos_agent.optimization.runtime import OptimizationRuntimeError

        raise OptimizationRuntimeError("Electron Product Command host is unavailable")
    return _BOUND_HOST


_TERMINAL_STATES = frozenset({"succeeded", "failed", "cancelled"})
# `workspace.derive` is intentionally not exposed to the host yet: Electron's
# dispatchHostRequest does not handle it. Re-add it here together with a
# dispatchHostRequest implementation when the calibration migration needs it.
_PRODUCT_COMMAND_METHODS = frozenset(
    {
        "candidate.capabilities",
        "candidate.rerun",
        "candidate.resume",
        "operation.cancel",
        "operation.status",
        "operation.wait",
        "rpc.hello",
        "workspace.open",
        "workspace.run",
    }
)
_WORKSPACE_ID_METHODS = frozenset(
    {
        "candidate.capabilities",
        "candidate.rerun",
        "candidate.resume",
        "workspace.run",
    }
)
_HANDLE_FREE_METHODS = frozenset({"rpc.hello", "workspace.open"})


class ProtocolHostTransport:
    """Translate ECC-shaped adapter calls onto Electron Product Commands."""

    def __init__(
        self,
        caller: HostCaller | object,
        *,
        expected_workspace_revision: int | None = None,
        workspace_handle: str | None = None,
    ) -> None:
        self._caller = caller
        self._expected_workspace_revision = expected_workspace_revision
        self._workspace_handle = workspace_handle
        self.event_callback: Callable[[Mapping[str, object]], None] | None = None

    def call(self, method: str, params: dict[str, object]) -> dict[str, object]:
        if method not in _PRODUCT_COMMAND_METHODS:
            raise OptimizationEccAdapterError("host method is not allowed")
        payload = dict(params)
        if method in _WORKSPACE_ID_METHODS and "workspaceId" in payload:
            payload["workspaceHandle"] = payload.pop("workspaceId")
        if method not in _HANDLE_FREE_METHODS and self._workspace_handle is not None:
            payload.setdefault("workspaceHandle", self._workspace_handle)
        if (
            method in {"candidate.rerun", "candidate.resume", "workspace.run"}
            and self._expected_workspace_revision is not None
        ):
            payload.setdefault(
                "expectedWorkspaceRevision", self._expected_workspace_revision
            )
        result = self._invoke(method, payload)
        if not isinstance(result, dict):
            raise OptimizationEccAdapterError("host result is invalid")
        return result

    def _invoke(self, method: str, params: dict[str, object]) -> object:
        caller = self._caller
        if callable(caller) and not hasattr(caller, "call"):
            return caller(method, params)
        invoke = getattr(caller, "call", None)
        if not callable(invoke):
            raise OptimizationEccAdapterError("host caller is invalid")
        return invoke(method, params)

    def wait_for_terminal(
        self, operation_id: str, timeout_seconds: float
    ) -> dict[str, object] | None:
        if type(timeout_seconds) not in {int, float} or timeout_seconds <= 0:
            raise OptimizationEccAdapterError("terminal wait timeout is invalid")
        if self._workspace_handle is None:
            raise OptimizationEccAdapterError("workspace handle is unavailable")
        result = self._invoke(
            "operation.wait",
            {
                "workspaceHandle": self._workspace_handle,
                "operationId": operation_id,
            },
        )
        if not isinstance(result, dict):
            raise OptimizationEccAdapterError("host result is invalid")
        if result.get("state") in _TERMINAL_STATES:
            return result
        return None

    def close(self) -> None:
        close = getattr(self._caller, "close", None)
        if callable(close):
            close()


def open_execution_adapter(
    *,
    runtime: object,
    workspace: Path,
    site_width_dbu: int,
    parent_manifest: str,
    design_id: str,
) -> tuple[EccCandidateRerunAdapter, dict[str, object]]:
    from ecos_agent.optimization.runtime import (
        OptimizationRuntimeError,
        _optimization_execution_context,
    )

    handle = getattr(runtime, "workspace_handle", None)
    revision = getattr(runtime, "expected_workspace_revision", None)
    if not isinstance(handle, str) or not handle.strip():
        raise OptimizationRuntimeError("optimization workspace handle is missing")
    if type(revision) is not int or revision < 1:
        raise OptimizationRuntimeError("optimization workspace revision is invalid")
    handle = handle.strip()
    transport = ProtocolHostTransport(
        _require_host_transport(),
        expected_workspace_revision=revision,
        workspace_handle=handle,
    )
    try:
        revision_text = transport.call("rpc.hello", {"version": 1}).get("eccVersion")
        if not isinstance(revision_text, str) or not revision_text.strip():
            raise OptimizationRuntimeError("ECC revision is invalid")
        ecc_revision = revision_text.strip()
        try:
            execution_context = _optimization_execution_context(
                workspace, site_width_dbu, parent_manifest, ecc_revision, design_id=design_id
            )
        except OptimizationRuntimeError:
            if (workspace / "origin").exists():
                raise
            execution_context = {
                "design_sha256": parent_manifest,
                "design_id": design_id,
                "parent_lineage_sha256": parent_manifest,
                "ecc_revision": ecc_revision,
                "site_width_dbu": site_width_dbu,
                "seed": getattr(runtime, "seed", 0),
            }
        return (
            EccCandidateRerunAdapter(
                transport,
                workspace_id=handle,
                site_width_dbu=site_width_dbu,
                workspace_root=workspace,
                expected_workspace_revision=revision,
            ),
            execution_context,
        )
    except Exception:
        transport.close()
        raise


class _PendingHostCall:
    def __init__(self) -> None:
        self._event = threading.Event()
        self._payload: dict[str, object] | None = None

    def complete(self, payload: dict[str, object]) -> None:
        self._payload = payload
        self._event.set()

    def wait(self, timeout: float) -> dict[str, object]:
        if not self._event.wait(timeout):
            raise TimeoutError("host Product Command timed out")
        if self._payload is None:
            raise OptimizationEccAdapterError("host Product Command is incomplete")
        return self._payload
