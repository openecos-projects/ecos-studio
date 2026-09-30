"""Opt-in, private pre-planner evidence; never a planner-readable artifact.

Call ``configure_planning_snapshots`` on the controller before its first plan.
The caller must enumerate *all* planner-readable roots (including cwd, workspace,
artifact and tool roots), and keep the private root out of subsequent grants.
POSIX modes are defense in depth, not isolation from a same-UID provider.

The provider-boundary writer can join using the unchanged ``context_ref`` plus
``source_identity``; ``planning_snapshot_id`` and ``path_for`` need no controller
state. A snapshot records entry into the planner, not proof of a provider request.
No snapshot path or full-history data is attached to the planner context, task
memory, episode checkpoint, or artifact roots. Missing captures stay missing.
"""

from __future__ import annotations

import json
import os
import tempfile
from dataclasses import dataclass, replace
from datetime import datetime, timezone
from pathlib import Path
from typing import TYPE_CHECKING, Mapping, Sequence

from pydantic_core import to_jsonable_python

from ecos_agent.hashing import canonical_sha256
from ecos_agent.optimization.contracts import ProposalContextRef
from ecos_agent.optimization.planning import OptimizationPlanningContext

if TYPE_CHECKING:
    from ecos_agent.optimization.controller import OptimizationEpisodeController


def planning_snapshot_id(
    context_ref: ProposalContextRef, source_identity: Mapping[str, object],
) -> str:
    """Stable attempt-scoped join; does not depend on filenames or list indices."""
    return canonical_sha256({
        "context_ref": context_ref.model_dump(mode="json"),
        "source_identity": dict(source_identity),
    }).removeprefix("sha256:")


def _check_private_root(root: Path, readable_roots: tuple[Path, ...]) -> None:
    resolved = root.resolve()
    if any(resolved.is_relative_to(path.resolve()) for path in readable_roots):
        raise ValueError("snapshot root must be outside every planner-readable root")
    if resolved != root:
        raise ValueError("snapshot root changed through a symlink")


def _write_new(path: Path, payload: dict[str, object]) -> None:
    """Publish only complete, fsynced bytes; link refuses any existing target."""
    fd, temporary = tempfile.mkstemp(prefix=".snapshot-", dir=path.parent)
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as stream:
            json.dump(payload, stream, sort_keys=True, ensure_ascii=False, allow_nan=False)
            stream.write("\n")
            stream.flush()
            os.fchmod(stream.fileno(), 0o400)
            os.fsync(stream.fileno())
        os.link(temporary, path)
        directory_fd = os.open(path.parent, os.O_RDONLY | os.O_DIRECTORY)
        try:
            os.fsync(directory_fd)
        finally:
            os.close(directory_fd)
    finally:
        os.unlink(temporary)


@dataclass(frozen=True)
class PlanningSnapshotStore:
    root: Path
    source_identity_json: str
    planner_readable_roots: tuple[Path, ...]

    @property
    def source_identity(self) -> dict[str, object]:
        # A fresh value keeps later caller mutations out of frozen source IDs.
        return json.loads(self.source_identity_json)

    def path_for(self, context_ref: ProposalContextRef) -> Path:
        return self.root / (
            planning_snapshot_id(context_ref, self.source_identity) + ".json"
        )

    def capture(
        self, controller: OptimizationEpisodeController,
        context: OptimizationPlanningContext,
    ) -> Path:
        _check_private_root(self.root, self.planner_readable_roots)
        # Do not run context construction twice: knowledge selection may audit
        # or read mutable external inputs. Only restore authoritative history.
        full_history = controller._history(include_receipts=True)
        internal_context = to_jsonable_python(replace(
            context, history=full_history, parameter_trajectories=full_history,
        ))
        replay = controller.ledger.replay()
        checkpoint = json.loads(controller.state_path.read_text(encoding="utf-8"))
        payload = {
            "schema_version": "ecos.optimization_planning_snapshot.v1",
            "phase": "pre_planner",
            "captured_at": datetime.now(timezone.utc).isoformat(),
            "planning_id": planning_snapshot_id(context.context_ref, self.source_identity),
            "context_ref": context.context_ref.model_dump(mode="json"),
            "source_identity": self.source_identity,
            "source_identity_sha256": canonical_sha256(self.source_identity),
            "execution_context_sha256": canonical_sha256(controller._execution_context),
            "started_candidates": context.budget.consumed_candidates,
            "planning_call": context.budget.consumed_planning_calls,
            "remaining_budget": {
                "candidates": context.budget.remaining_candidates,
                "planning_calls": context.budget.remaining_planning_calls,
                "wall_time_seconds": context.budget.remaining_wall_time_seconds,
            },
            "max_in_flight_candidates": controller.max_in_flight_candidates,
            "receipt_aware_planning": controller.receipt_aware_planning,
            "internal_context": internal_context,
            "context_sha256": canonical_sha256(internal_context),
            # Not the projected outgoing-input hash: the provider owns that.
            "planner_context_sha256": canonical_sha256(to_jsonable_python(context)),
            "pending": [
                record.model_dump(mode="json")
                for record in controller._pending_executions.values()
            ],
            "completed": [item.model_dump(mode="json") for item in replay.terminal_outcomes],
            "ledger_chain_head_sha256": replay.chain_head_sha256,
            "checkpoint": checkpoint,
        }
        payload["snapshot_sha256"] = canonical_sha256(payload)
        path = self.path_for(context.context_ref)
        _write_new(path, payload)
        return path


def configure_planning_snapshots(
    controller: OptimizationEpisodeController,
    *,
    root: Path,
    source_identity: Mapping[str, object],
    planner_readable_roots: Sequence[Path],
) -> PlanningSnapshotStore:
    """Enable capture without changing controller/provider constructors.

    ``source_identity`` should freeze cohort/cell/attempt, design, source model,
    package, repeat, q and code/manifest hashes. It is separate from evaluated
    model identity. Use an attempt-private root outside the complete read grants.
    Capture failures propagate before the planner call; never run uncaptured.
    """
    if getattr(controller, "_planning_snapshot_store", None) is not None:
        raise ValueError("planning snapshots are already configured")
    if controller.budget.consumed_planning_calls:
        raise ValueError("configure snapshots before the first planning call")
    if not source_identity or not planner_readable_roots:
        raise ValueError("source identity and complete planner-readable roots are required")
    identity_json = json.dumps(dict(source_identity), sort_keys=True, allow_nan=False)
    root = Path(root).resolve()
    readable = tuple(Path(path).resolve() for path in planner_readable_roots) + (
        controller.ledger.root.resolve(),
    )
    _check_private_root(root, readable)
    root.mkdir(mode=0o700, parents=True, exist_ok=True)
    store = PlanningSnapshotStore(root, identity_json, readable)
    controller._planning_snapshot_store = store
    return store
