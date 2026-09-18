"""GUI execution and terminal reporting for bounded optimization episodes."""

from __future__ import annotations

from ecos_agent.gui.messages import optimization_error_message
from ecos_agent.gui.session import ProviderSession as _Session
from ecos_agent.optimization.contracts import OptimizationEpisodeState


class ProviderOptimizationEpisodeMixin:
    def _run_optimization_episode(self, session: _Session) -> None:
        runner = session.optimization_runner
        provider = session.optimization_provider
        if runner is None:
            return
        runner.event_listener = (
            lambda kind, detail, _session=session, _runner=runner: (
                self._emit_optimization_turn_event(_session, _runner, kind, detail)
            )
        )
        final_phase = "completed"
        rejection_reason = None
        error_text = None
        try:
            while True:
                if not session.optimization_stop.is_set() and runner.state not in {
                    OptimizationEpisodeState.CREATED,
                    OptimizationEpisodeState.PLANNING,
                    OptimizationEpisodeState.EXECUTING,
                    OptimizationEpisodeState.AWAITING_EXECUTION,
                }:
                    break
                # Pause stops new dispatch but still collects in-flight
                # terminals; only an idle paused episode waits here.
                while (
                    session.optimization_pause.is_set()
                    and not runner.pending_execution_ids
                    and not session.optimization_stop.wait(0.1)
                ):
                    pass
                stop_requested = session.optimization_stop.is_set()
                in_flight = len(runner.pending_execution_ids)
                if stop_requested and not in_flight:
                    # U1: one candidate ending never reads as all-complete; the
                    # episode only finishes after every in-flight terminal is
                    # collected or cancelled.
                    final_phase = "stopped"
                    break
                if runner.state == OptimizationEpisodeState.QUARANTINED:
                    final_phase = "quarantined"
                    break
                turn = runner.run_turn(paused=session.optimization_pause.is_set())
                rejection_reason = turn.planning.rejection_reason or (
                    turn.execution.rejection_reason if turn.execution else None
                )
                session.optimization_turn_count += 1
                active_before = getattr(turn, "active_objective_before", None)
                active_after = getattr(turn, "active_objective_after", None)
                if active_after is not None:
                    session.optimization_active_objective = active_after.model_dump(
                        mode="json"
                    )
                active = session.optimization_active_objective or {}
                counts = {
                    key: active.get(key)
                    for key in (
                        "drc_count",
                        "sta_setup_violation_count",
                        "sta_hold_violation_count",
                    )
                }
                transition = (
                    f"{active_before.recovery_stage}_to_{active_after.recovery_stage}"
                    if active_before is not None
                    and active_after is not None
                    and active_before.recovery_stage != active_after.recovery_stage
                    else None
                )
                self._emit(
                    session,
                    "optimization",
                    (
                        f"Optimization turn {session.optimization_turn_count} finished for "
                        f"active objective {active.get('active_primary_metric', session.optimization_primary_metric)}."
                    ),
                    optimization={
                        "schema_version": "ecos.optimization_progress.v2",
                        "episode_id": runner.episode_id,
                        "objective_sha256": session.optimization_objective_sha256,
                        "primary_metric": session.optimization_primary_metric,
                        "original_objective": session.optimization_objective,
                        "original_primary_metric": session.optimization_primary_metric,
                        "alignment_sha256": (
                            session.optimization_objective_alignment or {}
                        ).get("alignment_contract_sha256"),
                        "active_primary_metric": active.get("active_primary_metric"),
                        "active_preserve_metrics": active.get(
                            "active_preserve_metrics", []
                        ),
                        "violation_counts": counts,
                        "recovery_stage": active.get("recovery_stage"),
                        "recovery_transition": transition,
                        "recovery_incomplete": getattr(
                            runner, "recovery_incomplete", False
                        ),
                        "state": runner.state.value,
                        "turn": session.optimization_turn_count,
                        "in_flight": len(runner.pending_execution_ids),
                        "planning_state": turn.planning.state.value,
                        "execution_state": turn.execution.state.value if turn.execution else None,
                        "incumbent_decision": (
                            turn.incumbent_comparison.decision.value
                            if turn.incumbent_comparison
                            else None
                        ),
                        "decisive_metric": (
                            turn.incumbent_comparison.decisive_metric.value
                            if turn.incumbent_comparison and turn.incumbent_comparison.decisive_metric
                            else None
                        ),
                        "proposal_decision": (
                            turn.planning.proposal.decision.value
                            if turn.planning.proposal
                            else None
                        ),
                        "proposal_reason": (
                            turn.planning.proposal.reason_code.value
                            if turn.planning.proposal
                            else None
                        ),
                        "rejection_reason": turn.planning.rejection_reason,
                        "action": (
                            turn.planning.proposal.action.model_dump(mode="json")
                            if turn.planning.proposal and turn.planning.proposal.action
                            else None
                        ),
                        "requested": (
                            turn.planning.requested.model_dump(mode="json")
                            if turn.planning.requested
                            else None
                        ),
                        "incumbent_candidate_root_ref": (
                            runner.incumbent_candidate_root_ref
                        ),
                    },
                )
                if runner.state == OptimizationEpisodeState.QUARANTINED:
                    final_phase = "quarantined"
                    break
                if session.optimization_stop.is_set() and not runner.pending_execution_ids:
                    final_phase = "stopped"
                    break
            if final_phase == "completed":
                final_phase = {
                    OptimizationEpisodeState.ESCALATED: "error",
                    OptimizationEpisodeState.QUARANTINED: "quarantined",
                    OptimizationEpisodeState.STOPPED: "stopped",
                }.get(runner.state, "completed")
            if final_phase in {"error", "quarantined"}:
                error_text = optimization_error_message(
                    session.language, runner.state.value, rejection_reason
                )
                self._emit(session, "error", error_text)
        except Exception as exc:
            if (
                session.optimization_stop.is_set()
                and runner.state != OptimizationEpisodeState.EXECUTING
            ):
                final_phase = "stopped"
            else:
                final_phase = "error"
                rejection_reason = str(exc)
                error_text = optimization_error_message(session.language, "error", rejection_reason)
                self._emit(session, "error", error_text)
        finally:
            for resource in (runner, provider):
                if resource is None:
                    continue
                try:
                    resource.close()
                except Exception as exc:
                    final_phase = "error"
                    rejection_reason = f"{rejection_reason or 'cleanup_failed'}; {exc}"
                    error_text = optimization_error_message(session.language, "error", rejection_reason)
                    self._emit(session, "error", error_text)
            session.active_interrupt = None
            session.active_tool_message_id = None
            session.optimization_provider = None
            session.optimization_runner = None
            session.optimization_thread = None
            session.optimization_phase = final_phase
            session.phase = "operation" if session.mode == "workspace" else "home_ready"
            status = {
                "completed": "idle",
                "stopped": "interrupted",
                "error": "error",
                "quarantined": "error",
            }.get(final_phase, "idle")
            active = session.optimization_active_objective or {}
            self._emit(
                session,
                "optimization",
                error_text or f"Optimization episode {final_phase}.",
                optimization={
                    "schema_version": "ecos.optimization_status.v1",
                    "episode_id": runner.episode_id,
                    "state": (
                        runner.state.value
                        if final_phase in {"error", "quarantined"} and runner.state in {
                            OptimizationEpisodeState.ESCALATED,
                            OptimizationEpisodeState.QUARANTINED,
                        }
                        else final_phase
                    ),
                    "turn_count": session.optimization_turn_count,
                    "objective_sha256": session.optimization_objective_sha256,
                    "original_objective": session.optimization_objective,
                    "original_primary_metric": session.optimization_primary_metric,
                    "alignment_sha256": (session.optimization_objective_alignment or {}).get(
                        "alignment_contract_sha256"
                    ),
                    "active_primary_metric": active.get("active_primary_metric"),
                    "active_preserve_metrics": active.get("active_preserve_metrics", []),
                    "recovery_stage": active.get("recovery_stage"),
                    "recovery_incomplete": getattr(runner, "recovery_incomplete", False),
                    "violation_counts": {
                        key: active.get(key)
                        for key in (
                            "drc_count", "sta_setup_violation_count", "sta_hold_violation_count"
                        )
                    },
                    "rejection_reason": rejection_reason,
                    "rationale_summary": error_text,
                },
            )
            self._emit_status(session, status)
            self._emit_phase_choice(session)
