"""Deterministic proposal replay for shadow-duplicate episodes.

Replays a stored proposal sequence instead of calling a model: candidate
executions stay identical to the source episode while planner sampling
randomness is removed entirely, so any terminal delta between the replay
and the source episode is machine/load interference, not planner noise.
Input specs come from the source episode's mediation audit calls (knob,
direction, requested_value, claim four-tuple, expected_effects).
"""

from __future__ import annotations

from pathlib import Path
from typing import Any, Mapping, Sequence

from ecos_agent.hashing import canonical_sha256
from ecos_agent.optimization.decision_audit import OptimizationDecisionAudit
from ecos_agent.optimization.parameters.effective_domain import (
    EffectiveDomainSnapshot,
)

_CONTINUE_PROPOSAL = {
    "decision": "continue",
    "reason_code": "replay_exhausted",
    "rationale_summary": "stored proposal sequence exhausted",
}


class ReplayProposalProvider:
    """Rebuild proposal v3 payloads from a frozen spec sequence, in order."""

    def __init__(
        self, specs: Sequence[Mapping[str, object]], *, start_index: int = 0
    ) -> None:
        self._specs: tuple[dict[str, object], ...] = tuple(dict(s) for s in specs)
        for spec in self._specs:
            if not spec.get("expected_effects"):
                raise ValueError(
                    "replay proposal spec requires expected_effects; copy them "
                    "from the source episode's proposal observations"
                )
        if type(start_index) is not int or not 0 <= start_index <= len(self._specs):
            raise ValueError("replay proposal start index is invalid")
        self._index = start_index
        self.consumed = start_index

    def select_model(self, model: str) -> None:
        return None

    def close(self) -> None:
        return None

    def propose_v2(
        self,
        context: Any,
        domains: Any,
    ) -> dict[str, Any]:
        if self._index >= len(self._specs):
            return {
                "schema_version": "ecos.optimization_proposal.v3",
                "context_ref": context.context_ref.model_dump(mode="json"),
                "observation_refs": [
                    context.observation_ref.model_dump(mode="json")
                ],
                **_CONTINUE_PROPOSAL,
            }
        spec = self._specs[self._index]
        self._index += 1
        self.consumed += 1
        snapshot = _snapshot_for(domains, str(spec["knob_id"]))
        claim_fields = {
            key: spec.get(key)
            for key in ("claim_id", "claim_sha256", "binding_id", "binding_sha256")
        }
        if any(claim_fields.values()) and not all(claim_fields.values()):
            raise ValueError("replay proposal spec knowledge binding is incomplete")
        action = {
            "knob_id": spec["knob_id"],
            "direction": spec["direction"],
            "requested_value": spec["requested_value"],
            "effective_domain_sha256": snapshot.snapshot_sha256,
            "expected_effects": list(spec["expected_effects"]),
            **claim_fields,
        }
        return {
            "schema_version": "ecos.optimization_proposal.v3",
            "context_ref": context.context_ref.model_dump(mode="json"),
            "decision": "propose",
            "reason_code": str(spec.get("reason_code") or "observation"),
            "rationale_summary": str(
                spec.get("rationale_summary")
                or "deterministic shadow-duplicate replay of a stored proposal"
            ),
            "observation_refs": [context.observation_ref.model_dump(mode="json")],
            "action": action,
        }


def replay_provider_and_runtime(
    specs: Sequence[Mapping[str, object]], episode_root: Path
) -> tuple[ReplayProposalProvider, dict[str, object]]:
    start_index = 0
    if (episode_root / "optimization-episode-state.v10.json").is_file():
        start_index = sum(
            entry.planner_source == "replay"
            and entry.proposal is not None
            and entry.proposal.action is not None
            for entry in OptimizationDecisionAudit(episode_root).replay().entries
        )
    return ReplayProposalProvider(specs, start_index=start_index), {
        "proposal_validation_mode": "frozen_replay",
        "replay_proposals_sha256": canonical_sha256(specs),
    }


def _snapshot_for(domains: Any, knob_id: str) -> EffectiveDomainSnapshot:
    """Find the legal-domain snapshot the replayed action must bind to."""
    candidates = domains if isinstance(domains, (list, tuple)) else [domains]
    for candidate in candidates:
        snapshot = (
            candidate
            if isinstance(candidate, EffectiveDomainSnapshot)
            else EffectiveDomainSnapshot.model_validate(candidate)
        )
        if snapshot.knob_id.value == knob_id:
            return snapshot
    raise ValueError(f"no effective domain snapshot matches replay knob {knob_id}")
