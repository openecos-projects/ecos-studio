"""Fixed ECC JSON-RPC execution boundary for optimization candidates."""

from __future__ import annotations

import hashlib
import json
import os
import queue
import re
import subprocess
import threading
import time
from collections.abc import Mapping
from pathlib import Path
from typing import Protocol

from ecos_agent.hashing import file_sha256
from ecos_agent.optimization.contracts import OptimizationKnob, RequestedKnobValue
from ecos_agent.optimization.execution import (
    CANDIDATE_END_STEP,
    CANDIDATE_EXECUTION_SCOPE,
    CandidateExecutionEvidence,
    CandidateExecutionReceipt,
    CandidateExecutionRequest,
    candidate_target_step,
)
from ecos_agent.optimization.ecc.evidence import (
    OptimizationEccAdapterError,
    validate_candidate_artifacts,
)
from ecos_agent.optimization.ledger import OptimizationOutcomeKind
from ecos_agent.optimization.parameters.contracts import ParameterApplicationReceipt
from ecos_agent.optimization.parameters.semantics import (
    ParameterSemanticsError,
    card_hash,
    load_parameter_card,
    validate_application_receipt,
)

_SHA256 = re.compile(r"^sha256:[0-9a-f]{64}$")
_SAFE_RPC_ERROR_DETAIL = re.compile(r"^[A-Za-z0-9][A-Za-z0-9 .:_-]{0,255}$")
_MAX_PAYLOAD_BYTES = 16 * 1024 * 1024
_ALLOWED_METHODS = frozenset(
    {
        "workspace.open",
        "rpc.hello",
        "candidate.rerun",
        "operation.cancel",
        "operation.status",
        "operation.ack_step_rendered",
    }
)
_TERMINAL_STATES = frozenset({"succeeded", "failed", "cancelled"})
class EccRpcTransport(Protocol):
    def call(self, method: str, params: dict[str, object]) -> dict[str, object]: ...

    def wait_for_terminal(
        self, operation_id: str, timeout_seconds: float
    ) -> dict[str, object] | None: ...


class EccCandidateRerunAdapter:
    """Materialize one approved knob value into the only permitted ECC RPC."""

    def __init__(
        self,
        rpc: EccRpcTransport,
        *,
        workspace_id: str,
        site_width_dbu: int,
        workspace_root: Path | None = None,
    ) -> None:
        if not _ID.fullmatch(workspace_id):
            raise OptimizationEccAdapterError("workspace id is invalid")
        if type(site_width_dbu) is not int or site_width_dbu <= 0:
            raise OptimizationEccAdapterError("site width is invalid")
        self._rpc = rpc
        self._workspace_id = workspace_id
        self._site_width_dbu = site_width_dbu
        self._workspace_root = (
            Path(workspace_root).resolve() if workspace_root else None
        )
        if self._workspace_root is not None and not self._workspace_root.is_dir():
            raise OptimizationEccAdapterError("workspace root is unavailable")
        self._binding_by_execution_id: dict[
            str, tuple[RequestedKnobValue, str, str | None, str, int]
        ] = {}
        self._ecc_revision: str | None = None

    def close(self) -> None:
        close = getattr(self._rpc, "close", None)
        if callable(close):
            close()

    def start(self, request: CandidateExecutionRequest) -> CandidateExecutionReceipt:
        self._validate_request(request)
        patch = self._materialize_patch(request)
        return self._start_rerun(
            candidate_id=_candidate_id(request.episode_id, request.intervention_id),
            idempotency_key=f"{request.episode_id}.{request.intervention_id}",
            patch=patch,
            requested=request.requested,
            context_sha256=request.context_sha256,
            seed=request.seed,
            parent_candidate_root_ref=request.parent_candidate_root_ref,
        )

    def resume(self, request: CandidateExecutionRequest) -> CandidateExecutionReceipt:
        self._validate_request(request)
        return self._start_rerun(
            candidate_id=_candidate_id(request.episode_id, request.intervention_id),
            idempotency_key=f"{request.episode_id}.{request.intervention_id}.resume",
            patch=None,
            requested=request.requested,
            context_sha256=request.context_sha256,
            seed=request.seed,
            parent_candidate_root_ref=request.parent_candidate_root_ref,
        )

    def _validate_request(self, request: CandidateExecutionRequest) -> None:
        if not _ID.fullmatch(request.episode_id) or not _ID.fullmatch(
            request.intervention_id
        ):
            raise OptimizationEccAdapterError("candidate request id is invalid")
        if not _SHA256.fullmatch(request.context_sha256):
            raise OptimizationEccAdapterError("candidate context hash is invalid")
        if self.ecc_revision() != request.ecc_revision:
            raise OptimizationEccAdapterError(
                "candidate ECC revision does not match execution context"
            )

    def _start_rerun(
        self,
        *,
        candidate_id: str,
        idempotency_key: str,
        patch: dict[str, object] | None,
        requested: RequestedKnobValue,
        context_sha256: str,
        seed: int,
        parent_candidate_root_ref: str | None,
    ) -> CandidateExecutionReceipt:
        if type(seed) is not int:
            raise OptimizationEccAdapterError("candidate seed is invalid")
        candidate_ref = f".agent/candidates/{candidate_id}"
        params: dict[str, object] = {
            "workspaceId": self._workspace_id,
            "candidateId": candidate_id,
            "idempotencyKey": idempotency_key,
            "contextSha256": context_sha256,
            "parameterCardSha256": card_hash(
                load_parameter_card(requested.knob_id)
            ),
            "seed": seed,
        }
        method = "candidate.resume" if patch is None else "candidate.rerun"
        if patch is not None:
            params.update(
                {
                    "targetStep": candidate_target_step(requested.knob_id),
                    "endStep": CANDIDATE_END_STEP,
                    "patch": [patch],
                    "executionScope": CANDIDATE_EXECUTION_SCOPE,
                }
            )
            if parent_candidate_root_ref is not None:
                params["parentCandidateRootRef"] = parent_candidate_root_ref
        response = self._rpc.call(method, params)
        operation_id, state = self._validate_operation(response)
        self._validate_execution_contract(response, requested)
        evidence = self._evidence(response)
        application_receipt = self._application_receipt(
            response,
            requested,
            state,
            evidence,
            candidate_ref,
            parent_candidate_root_ref,
            context_sha256,
            seed,
        )
        self._binding_by_execution_id[operation_id] = (
            requested,
            candidate_ref,
            parent_candidate_root_ref,
            context_sha256,
            seed,
        )
        if state == "failed":
            self._binding_by_execution_id.pop(operation_id, None)
            return CandidateExecutionReceipt(
                execution_id=operation_id,
                started=True,
                outcome=OptimizationOutcomeKind.EXECUTION_FAILED,
                evidence=evidence,
                parameter_application_receipt=application_receipt,
            )
        if state == "cancelled":
            self._binding_by_execution_id.pop(operation_id, None)
            return CandidateExecutionReceipt(
                execution_id=operation_id,
                started=True,
                outcome=OptimizationOutcomeKind.TIMED_OUT_CANCELLED,
                evidence=evidence,
                parameter_application_receipt=application_receipt,
            )
        if state == "succeeded":
            return CandidateExecutionReceipt(
                execution_id=operation_id,
                started=True,
                outcome=OptimizationOutcomeKind.EXECUTION_SUCCEEDED,
                evidence=evidence,
                parameter_application_receipt=application_receipt,
            )
        return CandidateExecutionReceipt(execution_id=operation_id, started=True)

    def cancel(self, intervention_id: str) -> CandidateExecutionReceipt:
        if not _ID.fullmatch(intervention_id):
            raise OptimizationEccAdapterError("operation id is invalid")
        response = self._rpc.call("operation.cancel", {"operationId": intervention_id})
        returned_id = response.get("operationId")
        if returned_id is not None and returned_id != intervention_id:
            raise OptimizationEccAdapterError("cancel operation id does not match")
        terminal = self._rpc.wait_for_terminal(intervention_id, timeout_seconds=60.0)
        if terminal is None:
            return CandidateExecutionReceipt(execution_id=intervention_id, started=True)
        terminal_id, state = self._validate_operation(terminal, require_workspace=False)
        if terminal_id != intervention_id:
            raise OptimizationEccAdapterError("terminal operation id does not match")
        outcome = (
            OptimizationOutcomeKind.TIMED_OUT_CANCELLED
            if state in {"cancelled", "failed"}
            else None
        )
        evidence = self._evidence(terminal)
        binding = self._binding_by_execution_id.get(intervention_id)
        application_receipt = self._application_receipt(
            terminal,
            binding[0] if binding else None,
            state,
            evidence,
            binding[1] if binding else None,
            binding[2] if binding else None,
            binding[3] if binding else None,
            binding[4] if binding else None,
        )
        self._binding_by_execution_id.pop(intervention_id, None)
        return CandidateExecutionReceipt(
            execution_id=intervention_id,
            started=True,
            outcome=outcome,
            evidence=evidence,
            parameter_application_receipt=application_receipt,
        )

    def wait_for_terminal(
        self,
        execution_id: str,
        *,
        timeout_seconds: float = 60.0,
    ) -> CandidateExecutionReceipt:
        if not _ID.fullmatch(execution_id):
            raise OptimizationEccAdapterError("operation id is invalid")
        if type(timeout_seconds) not in {int, float} or timeout_seconds <= 0:
            raise OptimizationEccAdapterError("terminal wait timeout is invalid")
        terminal = self._rpc.wait_for_terminal(execution_id, float(timeout_seconds))
        if terminal is None:
            return CandidateExecutionReceipt(execution_id=execution_id, started=True)
        terminal_id, state = self._validate_operation(terminal)
        if terminal_id != execution_id:
            raise OptimizationEccAdapterError("terminal operation id does not match")
        if state not in _TERMINAL_STATES:
            raise OptimizationEccAdapterError("terminal operation state is invalid")
        binding = self._binding_by_execution_id.get(execution_id)
        if binding is not None:
            self._validate_execution_contract(terminal, binding[0])
        outcome = {
            "succeeded": OptimizationOutcomeKind.EXECUTION_SUCCEEDED,
            "failed": OptimizationOutcomeKind.EXECUTION_FAILED,
            "cancelled": OptimizationOutcomeKind.TIMED_OUT_CANCELLED,
        }.get(state)
        evidence = self._evidence(terminal)
        application_receipt = self._application_receipt(
            terminal,
            binding[0] if binding else None,
            state,
            evidence,
            binding[1] if binding else None,
            binding[2] if binding else None,
            binding[3] if binding else None,
            binding[4] if binding else None,
        )
        self._binding_by_execution_id.pop(execution_id, None)
        return CandidateExecutionReceipt(
            execution_id=execution_id,
            started=True,
            outcome=outcome,
            evidence=self._evidence(terminal),
            parameter_application_receipt=application_receipt,
        )

    @staticmethod
    def _validate_execution_contract(
        response: Mapping[str, object], requested: RequestedKnobValue
    ) -> None:
        result = EccCandidateRerunAdapter._result(response)
        if result is None:
            return
        fields = (
            result.get("targetStep"),
            result.get("endStep"),
            result.get("executionScope"),
        )
        if all(value is None for value in fields):
            return
        if fields != (
            candidate_target_step(requested.knob_id),
            CANDIDATE_END_STEP,
            CANDIDATE_EXECUTION_SCOPE,
        ):
            raise OptimizationEccAdapterError(
                "candidate execution contract does not match"
            )

    @staticmethod
    def _evidence(response: Mapping[str, object]) -> CandidateExecutionEvidence | None:
        result = EccCandidateRerunAdapter._result(response)
        if result is None:
            return None
        values = {
            "candidate_root_ref": result.get("candidateRootRef"),
            "candidate_manifest_ref": result.get("candidateManifestRef"),
            "candidate_manifest_sha256": result.get("candidateManifestSha256"),
            "target_step": result.get("targetStep"),
            "end_step": result.get("endStep"),
            "execution_scope": result.get("executionScope"),
        }
        if all(value is None for value in values.values()):
            return None
        required = tuple(
            values[key]
            for key in (
                "candidate_root_ref",
                "candidate_manifest_ref",
                "candidate_manifest_sha256",
            )
        )
        optional = tuple(
            values[key] for key in ("target_step", "end_step", "execution_scope")
        )
        if not all(isinstance(value, str) for value in required) or any(
            value is not None and not isinstance(value, str) for value in optional
        ):
            raise OptimizationEccAdapterError(
                "candidate terminal evidence is incomplete"
            )
        try:
            return CandidateExecutionEvidence(**values)
        except ValueError as exc:
            raise OptimizationEccAdapterError(
                "candidate terminal evidence is invalid"
            ) from exc

    @staticmethod
    def _result(response: Mapping[str, object]) -> Mapping[str, object] | None:
        result = response.get("result")
        if result is None:
            return None
        if not isinstance(result, Mapping):
            raise OptimizationEccAdapterError("candidate terminal result is invalid")
        return result

    def _application_receipt(
        self,
        response: Mapping[str, object],
        requested: RequestedKnobValue | None,
        state: str,
        evidence: CandidateExecutionEvidence | None = None,
        candidate_ref: str | None = None,
        parent_ref: str | None = None,
        context_sha256: str | None = None,
        seed: int | None = None,
    ) -> ParameterApplicationReceipt | None:
        result = self._result(response)
        if result is None:
            return None
        raw = result.get("parameterApplicationReceipt")
        if raw is None:
            return None
        if requested is None:
            raise OptimizationEccAdapterError("application receipt cannot be bound")
        if state not in _TERMINAL_STATES:
            raise OptimizationEccAdapterError("application receipt is non-terminal")
        normalized = _normalize_receipt_payload(raw)
        try:
            if (
                not isinstance(normalized, Mapping)
                or normalized.get("schema_version")
                != "tool.parameter_application_receipt.v1"
            ):
                raise ValueError("legacy application receipt is read-only")
            receipt = ParameterApplicationReceipt.model_validate(normalized)
        except (TypeError, ValueError) as exc:
            raise OptimizationEccAdapterError("application receipt is invalid") from exc
        if (
            receipt.requested.get("knob_id") != requested.knob_id.value
            or receipt.requested.get("value") != requested.value
        ):
            raise OptimizationEccAdapterError(
                "application receipt written value does not match"
            )
        if (
            context_sha256 is None
            or receipt.context.get("context_sha256") != context_sha256
        ):
            raise OptimizationEccAdapterError(
                "application receipt context does not match"
            )
        if seed is None or receipt.context.get("seed") != seed:
            raise OptimizationEccAdapterError("application receipt seed does not match")
        if receipt.context.get("ecc_revision") != self.ecc_revision():
            raise OptimizationEccAdapterError(
                "application receipt ECC revision does not match"
            )
        self._validate_receipt_result_binding(result, raw, candidate_ref)
        card = load_parameter_card(requested.knob_id)
        if receipt.context.get("parameter_card_sha256") != card_hash(card):
            raise OptimizationEccAdapterError(
                "application receipt parameter card does not match"
            )
        try:
            validate_application_receipt(receipt, {requested.knob_id: card})
        except (ParameterSemanticsError, ValueError) as exc:
            raise OptimizationEccAdapterError(
                "application receipt card binding is invalid"
            ) from exc
        if candidate_ref is None:
            raise OptimizationEccAdapterError("application receipt cannot be bound")
        validate_candidate_artifacts(
            workspace_root=self._workspace_root,
            site_width_dbu=self._site_width_dbu,
            receipt=receipt,
            requested=requested,
            evidence=evidence,
            candidate_ref=candidate_ref,
            parent_ref=parent_ref,
            terminal_state=state,
            target_step=candidate_target_step(requested.knob_id),
            config_ref=card.surface.file,
            config_json_path=card.surface.json_path,
        )
        return receipt

    def ecc_revision(self) -> str:
        if self._ecc_revision is not None:
            return self._ecc_revision
        result = self._rpc.call("rpc.hello", {"version": 1})
        revision = result.get("eccVersion")
        if not _valid_revision(revision):
            raise OptimizationEccAdapterError("ECC revision is invalid")
        self._ecc_revision = revision.strip()
        return self._ecc_revision

    def _validate_receipt_result_binding(
        self,
        result: Mapping[str, object],
        embedded: object,
        candidate_ref: str | None,
    ) -> None:
        ref = result.get("parameterApplicationReceiptRef")
        digest = result.get("parameterApplicationReceiptSha256")
        if (
            not isinstance(ref, str)
            or not isinstance(digest, str)
            or not _SHA256.fullmatch(digest)
        ):
            raise OptimizationEccAdapterError(
                "application receipt reference is invalid"
            )
        if (
            candidate_ref is None
            or ref != f"{candidate_ref}/analysis/parameter_application_receipt.v1.json"
        ):
            raise OptimizationEccAdapterError(
                "application receipt reference does not match"
            )
        if self._workspace_root is None:
            raise OptimizationEccAdapterError(
                "application receipt workspace is unavailable"
            )
        path = self._workspace_root / ref
        try:
            resolved = path.resolve(strict=True)
            resolved.relative_to(self._workspace_root)
            if path.is_symlink() or not resolved.is_file():
                raise ValueError("receipt path is invalid")
            payload = json.loads(resolved.read_text(encoding="utf-8"))
        except (OSError, ValueError, json.JSONDecodeError) as exc:
            raise OptimizationEccAdapterError(
                "application receipt reference is unavailable"
            ) from exc
        if file_sha256(resolved) != digest:
            raise OptimizationEccAdapterError(
                "application receipt reference hash does not match"
            )
        if payload != embedded:
            raise OptimizationEccAdapterError(
                "application receipt payload does not match"
            )

    def _materialize_patch(
        self, request: CandidateExecutionRequest
    ) -> dict[str, object]:
        action = request.proposal.action
        if action is None or request.requested.knob_id != action.knob_id:
            raise OptimizationEccAdapterError("requested knob does not match proposal")
        value = request.requested.value
        if request.requested.knob_id == OptimizationKnob.CELL_PADDING_X:
            if type(value) is not int:
                raise OptimizationEccAdapterError("cell padding value is invalid")
        elif request.requested.knob_id != OptimizationKnob.ROUTABILITY_OPT:
            if type(value) not in {int, float} or isinstance(value, bool):
                raise OptimizationEccAdapterError("numeric knob value is invalid")
            value = float(value)
        elif type(value) is not bool:
            raise OptimizationEccAdapterError("routability value is invalid")
        return {"knob_id": request.requested.knob_id.value, "value": value}

    def _validate_operation(
        self,
        response: Mapping[str, object],
        *,
        require_workspace: bool = True,
    ) -> tuple[str, str]:
        operation_id = response.get("operationId")
        state = response.get("state")
        if not isinstance(operation_id, str) or not _ID.fullmatch(operation_id):
            raise OptimizationEccAdapterError("operation id is invalid")
        if not isinstance(state, str) or state not in {
            "queued",
            "running",
            *_TERMINAL_STATES,
        }:
            raise OptimizationEccAdapterError("operation state is invalid")
        if require_workspace and response.get("workspaceId") != self._workspace_id:
            raise OptimizationEccAdapterError("operation workspace does not match")
        return operation_id, state


def _normalize_receipt_payload(value: object) -> object:
    if isinstance(value, Mapping):
        normalized: dict[str, object] = {}
        for key, item in value.items():
            if not isinstance(key, str):
                raise ValueError("application receipt field name is invalid")
            snake_key = re.sub(r"(?<!^)([A-Z])", r"_\1", key).lower()
            if snake_key in normalized:
                raise ValueError("application receipt contains duplicate fields")
            normalized[snake_key] = _normalize_receipt_payload(item)
        return normalized
    if isinstance(value, (list, tuple)):
        return [_normalize_receipt_payload(item) for item in value]
    return value


from ecos_agent.optimization.ecc.rpc_client import (  # noqa: E402
    EccContentLengthRpcClient,
    _ContentLengthDecoder,
    _ID,
    _candidate_id,
    _safe_rpc_error_detail,
    _step_render_ack,
    _terminal_event,
    _valid_revision,
)
