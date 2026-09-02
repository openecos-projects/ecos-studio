from collections.abc import Callable
from typing import Any


class RuntimeFlowObserver:
    def __init__(
        self,
        manager: Any,
        operation_id: str,
        snapshot_committer: Callable[[Any, Any, str | None], int] | None = None,
    ):
        self._manager = manager
        self._operation_id = operation_id
        self._snapshot_committer = snapshot_committer
        self._committed_revision: int | None = None

    @property
    def runtime_operation(self) -> dict[str, Any]:
        return {
            "schema": 1,
            "operation_id": self._operation_id,
            "runtime_instance_id": self._manager._runtime_instance_id,
        }

    def on_step_started(self, workspace_step: Any) -> None:
        self._manager.step_started(self._operation_id, workspace_step)

    def raise_if_cancelled(self) -> None:
        self._manager.raise_if_cancel_requested(self._operation_id)

    def on_rerun_prepared(
        self,
        *,
        affected_steps: list[str],
        scope: str,
        workspace_revision: int,
        target_step: str = "",
    ) -> None:
        self._manager.rerun_prepared(
            self._operation_id,
            affected_steps=affected_steps,
            scope=scope,
            target_step=target_step,
            workspace_revision=workspace_revision,
        )

    def on_step_completed(
        self,
        workspace_step: Any,
        state: Any,
        error: str | None = None,
    ) -> None:
        if self._committed_revision is None and self._snapshot_committer is not None:
            self.commit_step(workspace_step, state, error)
        self._manager.step_completed(
            self._operation_id,
            workspace_step,
            state,
            error,
            self._committed_revision,
        )
        self._committed_revision = None

    def on_step_diagnostic(
        self,
        workspace_step: Any,
        diagnostic: dict[str, Any],
    ) -> None:
        self._manager.step_diagnostic(self._operation_id, workspace_step, diagnostic)

    def commit_step(self, workspace_step: Any, state: Any, error: str | None = None) -> None:
        if self._snapshot_committer is not None:
            self._committed_revision = self._snapshot_committer(workspace_step, state, error)

    def on_subflow_stage(self, workspace_step: Any, subflow_step: dict[str, Any]) -> None:
        self._manager.subflow_stage(self._operation_id, workspace_step, subflow_step)

    def on_step_skipped(self, workspace_step: Any) -> None:
        self._manager.step_skipped(self._operation_id, workspace_step)
