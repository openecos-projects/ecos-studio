"""Direction-only ablation arm: LLM owns selection, the lattice owns values.

Wraps any ``propose_v2`` provider so the planner keeps full authority over
(knob, direction) but the exact probe value is rewritten through the frozen
lattice selector — the same value mechanism the deterministic baselines use.
Comparing this arm against the free-value LLM isolates the numeric-precision
contribution; comparing it against rule_guided isolates the rich-feedback
selection contribution.  Everything else (context, budget, receipts,
promotion contract) is unchanged.
"""

from __future__ import annotations

from typing import Any

from ecos_agent.optimization.contracts import (
    LegalAction,
    OptimizationKnob,
    ProposalReason,
    RequestedKnobValue,
    StrategyDirection,
)
from ecos_agent.optimization.rules import select_requested_value


class DirectionOnlyProposalProvider:
    """Rewrite the wrapped planner's requested_value to the lattice value."""

    def __init__(self, inner: Any) -> None:
        self._inner = inner

    def __getattr__(self, name: str) -> Any:
        return getattr(self._inner, name)

    def propose_v2(
        self,
        context: Any,
        domains: Any,
    ) -> dict[str, Any]:
        raw = self._inner.propose_v2(context, domains)
        payload = raw if isinstance(raw, dict) else raw.model_dump(mode="json")
        action = payload.get("action")
        if not isinstance(action, dict):
            return payload
        attempted = tuple(
            RequestedKnobValue(knob_id=domain.knob_id, value=value)
            for domain in domains
            for value in domain.attempted_values
        )
        requested = select_requested_value(
            LegalAction(
                knob_id=OptimizationKnob(action["knob_id"]),
                direction=StrategyDirection(action["direction"]),
            ),
            current_values=context.current_values or {},
            attempted=attempted,
        )
        if requested is None:
            # The LLM's direction stands but the lattice cannot serve it; the
            # proposal becomes a typed continue so the episode's existing
            # planner_continue stall accounting applies.  The contract caps
            # the rationale at 512 characters, so the original text truncates.
            payload.pop("action", None)
            payload["decision"] = "continue"
            payload["reason_code"] = ProposalReason.NO_LEGAL_CANDIDATE.value
            payload["rationale_summary"] = (
                "direction-only ablation: lattice exhausted for the proposed "
                f"({action['knob_id']}, {action['direction']}); "
                + str(payload.get("rationale_summary", ""))
            )[:512]
            return payload
        action["requested_value"] = requested.value
        return payload
