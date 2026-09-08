"""Empirical case recording for terminal candidates."""

from __future__ import annotations

from ecos_agent.hashing import canonical_sha256
from ecos_agent.optimization.contracts import (
    OptimizationOutcomeKind,
    TerminalObservation,
)
from ecos_agent.optimization.controller_models import PendingExecutionRecord
from ecos_agent.optimization.knowledge.cases import (
    EmpiricalCaseDiagnostic,
    EmpiricalOutcome,
    build_terminal_empirical_case,
)
from ecos_agent.optimization.ledger import OptimizationTerminalOutcome
from ecos_agent.optimization.parameters.contracts import (
    ExpectedEffectV2,
    ParameterApplicationReceipt,
)
from ecos_agent.optimization.rules import native_receipt_is_effective


class ControllerCaseRecordingMixin:
    def _record_empirical_case(
        self,
        outcome: OptimizationTerminalOutcome,
        receipt: ParameterApplicationReceipt | None,
        terminal: TerminalObservation | None,
        record: PendingExecutionRecord | None = None,
    ) -> None:
        proposal = record.proposal_v2 if record is not None else None
        if proposal is not None and proposal.action is not None and proposal.action.claim_id is None:
            # Unclaimed probes remain episode evidence, not claim-bound empirical cases.
            return
        if proposal is None or receipt is None or terminal is None:
            self._append_case_diagnostic(
                "missing_terminal_case_evidence", outcome, receipt, terminal
            )
            return
        action = proposal.action
        planning_entry = next(
            (
                entry
                for entry in self._planning_audit.replay().entries
                if record is not None
                and entry.entry_sha256 == record.planning_entry_sha256
            ),
            None,
        )
        domain = next(
            (
                item
                for item in (planning_entry.effective_domains if planning_entry else ())
                if action is not None
                and item.snapshot_sha256 == action.effective_domain_sha256
            ),
            None,
        )
        if domain is None:
            self._append_case_diagnostic(
                "missing_effective_domain", outcome, receipt, terminal
            )
            return
        try:
            case = build_terminal_empirical_case(
                case_id=f"case-{self.episode_id}-{outcome.intervention_id}",
                proposal=proposal,
                effective_domain=domain,
                receipt=receipt,
                terminal_outcome=outcome,
                terminal=terminal,
                outcome_class=self._empirical_outcome(
                    outcome.outcome,
                    receipt,
                    terminal,
                    incumbent=self._incumbent,
                    expected_effects=(
                        proposal.action.expected_effects
                        if proposal.action is not None
                        else ()
                    ),
                ),
                guardrail_status="pass" if terminal.eligible_for_incumbent else "fail",
                design_id=self._design_id(),
            )
        except ValueError:
            self._append_case_diagnostic(
                "terminal_case_chain_invalid", outcome, receipt, terminal
            )
            return
        if not self._external_case_pool:
            self._case_pool.append_case(case)
        self._case_audit.append_case(case)

    @staticmethod
    def _empirical_outcome(
        outcome: OptimizationOutcomeKind,
        receipt: ParameterApplicationReceipt,
        terminal: TerminalObservation,
        *,
        incumbent: TerminalObservation | None = None,
        expected_effects: tuple[ExpectedEffectV2, ...] = (),
    ) -> EmpiricalOutcome:
        if not native_receipt_is_effective(receipt):
            return EmpiricalOutcome.INEFFECTIVE
        if not terminal.eligible_for_incumbent or outcome in {
            OptimizationOutcomeKind.CANDIDATE_INELIGIBLE,
            OptimizationOutcomeKind.INFEASIBLE,
        }:
            return EmpiricalOutcome.GUARDRAIL_FAILURE
        if outcome in {
            OptimizationOutcomeKind.IMPROVED,
            OptimizationOutcomeKind.EXECUTION_SUCCEEDED,
        }:
            # Promotion is not hypothesis support: at least one declared
            # expected effect must be observed against the prior incumbent.
            if (
                incumbent is not None
                and expected_effects
                and not ControllerCaseRecordingMixin._expected_effect_realized(
                    expected_effects, incumbent, terminal
                )
            ):
                return EmpiricalOutcome.CONTRADICTED
            return EmpiricalOutcome.SUPPORTED
        if outcome in {
            OptimizationOutcomeKind.DEGRADED,
            OptimizationOutcomeKind.TRADEOFF,
        }:
            return EmpiricalOutcome.CONTRADICTED
        return EmpiricalOutcome.FAILURE

    @staticmethod
    def _expected_effect_realized(
        expected_effects: tuple[ExpectedEffectV2, ...],
        incumbent: TerminalObservation,
        terminal: TerminalObservation,
    ) -> bool:
        # ponytail: any realized declared effect counts as support; per-effect
        # verdicts would need a case schema extension.
        before = incumbent.objective_metrics
        after = terminal.objective_metrics
        for effect in expected_effects:
            if effect.metric_id not in before or effect.metric_id not in after:
                continue
            old_value = before[effect.metric_id]
            new_value = after[effect.metric_id]
            if effect.direction == "increase" and new_value > old_value:
                return True
            if effect.direction == "decrease" and new_value < old_value:
                return True
        return False

    def _append_case_diagnostic(
        self,
        reason_code: str,
        outcome: OptimizationTerminalOutcome,
        receipt: ParameterApplicationReceipt | None,
        terminal: TerminalObservation | None,
        record: PendingExecutionRecord | None = None,
    ) -> None:
        self._case_audit.append_diagnostic(
            EmpiricalCaseDiagnostic(
                intervention_id=outcome.intervention_id,
                reason_code=reason_code,
                proposal_sha256=(
                    canonical_sha256(record.proposal_v2.model_dump(mode="json"))
                    if record is not None and record.proposal_v2 is not None
                    else None
                ),
                receipt_sha256=(receipt.evidence_sha256 if receipt is not None else None),
                terminal_outcome_sha256=canonical_sha256(
                    outcome.model_dump(mode="json")
                ),
                terminal_observation_sha256=(
                    canonical_sha256(terminal.model_dump(mode="json"))
                    if terminal is not None
                    else None
                ),
            )
        )
