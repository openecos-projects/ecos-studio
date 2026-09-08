"""Bounded terminal-wait helpers for the optimization runtime."""

from __future__ import annotations

import os
import threading
from time import monotonic as _monotonic

from ecos_agent.optimization.ecc.adapter import EccCandidateRerunAdapter
from ecos_agent.optimization.execution import CandidateExecutionReceipt


def _wait_for_any_terminal_receipt(
    executor: EccCandidateRerunAdapter,
    execution_ids: tuple[str, ...],
    *,
    timeout_seconds: float,
    stop_event: threading.Event,
) -> CandidateExecutionReceipt:
    """Return the first terminal among the pending candidates.

    On stop or deadline every pending execution is cancelled first; the
    resource slots are only released through collected terminals, never by the
    cancel request itself.
    """
    if not execution_ids:
        from ecos_agent.optimization.runtime import OptimizationRuntimeError

        raise OptimizationRuntimeError("no pending executions to wait for")
    deadline = _monotonic() + max(0.0, timeout_seconds)
    while not stop_event.is_set() and _monotonic() < deadline:
        remaining = deadline - _monotonic()
        if remaining <= 0:
            break
        for execution_id in execution_ids:
            try:
                receipt = executor.wait_for_terminal(
                    execution_id, timeout_seconds=min(0.5, remaining)
                )
            except Exception:
                if stop_event.is_set():
                    break
                raise
            if receipt.outcome is not None:
                return receipt
        stop_event.wait(min(0.05, max(0.0, deadline - _monotonic())))
    cancel_deadline = _monotonic() + 60.0
    for execution_id in execution_ids:
        try:
            executor.cancel(execution_id)
        except Exception:
            if not stop_event.is_set():
                raise
    while _monotonic() < cancel_deadline:
        for execution_id in execution_ids:
            try:
                receipt = executor.wait_for_terminal(
                    execution_id, timeout_seconds=min(0.5, cancel_deadline - _monotonic())
                )
            except Exception:
                receipt = None
            if receipt is not None and receipt.outcome is not None:
                return receipt
        stop_event.wait(0.05)
    return CandidateExecutionReceipt(
        execution_id=execution_ids[0], started=True
    )


def _wait_for_terminal_receipt(
    executor: EccCandidateRerunAdapter,
    execution_id: str,
    *,
    timeout_seconds: float,
    stop_event: threading.Event,
) -> CandidateExecutionReceipt:
    deadline = _monotonic() + max(0.0, timeout_seconds)
    while not stop_event.is_set() and _monotonic() < deadline:
        remaining = deadline - _monotonic()
        if remaining <= 0:
            break
        try:
            receipt = executor.wait_for_terminal(
                execution_id, timeout_seconds=min(1.0, remaining)
            )
        except Exception:
            if stop_event.is_set():
                return executor.cancel(execution_id)
            raise
        if receipt.outcome is not None:
            return receipt
        stop_event.wait(min(0.05, max(0.0, deadline - _monotonic())))
    return executor.cancel(execution_id)


def _terminal_timeout_seconds() -> float:
    from ecos_agent.optimization.runtime import OptimizationRuntimeError

    raw = os.environ.get("ECOS_AGENT_ECC_TERMINAL_TIMEOUT_SECONDS", "900")
    try:
        value = float(raw)
    except ValueError as exc:
        raise OptimizationRuntimeError(
            "ECOS_AGENT_ECC_TERMINAL_TIMEOUT_SECONDS is invalid"
        ) from exc
    if value <= 0:
        raise OptimizationRuntimeError(
            "ECOS_AGENT_ECC_TERMINAL_TIMEOUT_SECONDS is invalid"
        )
    return value
