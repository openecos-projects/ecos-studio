from __future__ import annotations

import importlib.util
import json
from pathlib import Path

import pytest
from ecos_agent.optimization import memory as optimization_memory
from ecos_agent.hashing import canonical_sha256, file_sha256
from ecos_agent.optimization.parameters.effective_domain import EffectiveDomainSnapshot
from ecos_agent.optimization.contracts import (
    BudgetSnapshot,
    EpisodeBudget,
    ExpectedEffectDirection,
    GateResult,
    ObjectiveMetric,
    ObservationReference,
    OptimizationDecision,
    OptimizationEpisodeState,
    OptimizationKnob,
    OptimizationProposal,
    ProposalAction,
    ProposalContextRef,
    ProposalReason,
    RequestedKnobValue,
    SignoffGates,
    StrategyDirection,
    TerminalObservation,
    TimingMetric,
)
from ecos_agent.optimization.decision_audit import OptimizationDecisionAudit
from ecos_agent.optimization.ledger import (
    OptimizationInterventionStart,
    OptimizationLedger,
    OptimizationOutcomeKind,
    OptimizationPlanningAudit,
    OptimizationTerminalOutcome,
)
from ecos_agent.optimization.memory import (
    OptimizationTaskMemoryStore,
    build_task_memory_scope,
)
from ecos_agent.optimization.metrics.contracts import (
    EvaluationMetricCategory,
    EvaluationMetricDirection,
    EvaluationMetricRole,
    TerminalEvaluationMetric,
)
from ecos_agent.optimization.parameters.contracts import (
    ParameterApplicationReceipt,
    ParameterSemanticsCard,
)
from ecos_agent.optimization.parameters.semantics import card_hash

_SCRIPT = Path(__file__).parents[1] / "scripts" / "build_parameter_acceptance.py"
_SPEC = importlib.util.spec_from_file_location("build_parameter_acceptance", _SCRIPT)
assert _SPEC is not None and _SPEC.loader is not None
acceptance = importlib.util.module_from_spec(_SPEC)
_SPEC.loader.exec_module(acceptance)


HASH = "sha256:" + "a" * 64
CARD_PATH = (
    Path(__file__).parents[1]
    / "knowledge/optimization/parameter-effectiveness/cards/place.target_density.json"
)


def _card_for(knob: OptimizationKnob) -> ParameterSemanticsCard:
    path = (
        Path(__file__).parents[1]
        / f"knowledge/optimization/parameter-effectiveness/cards/{knob.value}.json"
    )
    return ParameterSemanticsCard.model_validate_json(path.read_bytes())


def _card() -> ParameterSemanticsCard:
    return ParameterSemanticsCard.model_validate_json(CARD_PATH.read_bytes())


def _write_json(path: Path, payload: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, sort_keys=True), encoding="utf-8")


def _receipt_hash_payload(receipt: dict) -> dict:
    payload = {key: value for key, value in receipt.items() if key != "evidence_sha256"}
    if payload.get("consumer_observation") is None:
        payload.pop("consumer_observation", None)
    return payload


def _write_candidate(
    workspace: Path,
    *,
    knob: OptimizationKnob = OptimizationKnob.TARGET_DENSITY,
    requested_value: float = 0.65,
    written_value: int | float | None = None,
    effective_value: int | float = 0.65,
    requested_unit: str = "ratio",
    written_unit: str = "ratio",
    config_key: str = "dreamplace",
    config_field: str = "target_density",
    consumer_id: str = "dreamplace.density_objective",
    observation_payload: dict | None = None,
    transitions: list[dict] | None = None,
) -> dict[str, Path]:
    candidate_id = "candidate-acceptance-test"
    candidate_ref = f".agent/candidates/{candidate_id}"
    candidate_root = workspace / candidate_ref
    analysis = workspace / candidate_ref / "analysis"
    materialization_path = analysis / "candidate_materialization.v1.json"
    receipt_path = analysis / "parameter_application_receipt.v1.json"
    runtime_path = analysis / "parameter_runtime_report.v1.json"
    manifest_path = analysis / "candidate_workspace.v1.json"
    replay_path = analysis / "candidate_execution_receipt.v1.json"
    config_path = candidate_root / "config/dreamplace_ecc.json"
    before_snapshot_path = analysis / "snapshots/dreamplace_ecc.before.json"
    after_snapshot_path = analysis / "snapshots/dreamplace_ecc.after.json"
    written = requested_value if written_value is None else written_value
    _write_json(before_snapshot_path, {config_field: 0})
    _write_json(after_snapshot_path, {config_field: written})
    _write_json(config_path, {config_field: written})
    patch = [{"knob_id": knob.value, "value": written}]
    patch_sha256 = canonical_sha256(patch)
    before_sha256 = file_sha256(before_snapshot_path)
    after_sha256 = file_sha256(after_snapshot_path)
    materialization = {
        "schema": "ecc.workspace.candidate_materialization.v1",
        "schema_version": 1,
        "candidate_id": candidate_id,
        "target_step": "place",
        "target": {"step": "place"},
        "registry_sha256": HASH,
        "patch": patch,
        "patch_sha256": patch_sha256,
        "configs": [
            {
                "ref": "config/dreamplace_ecc.json",
                "config_key": config_key,
                "before_sha256": before_sha256,
                "after_sha256": after_sha256,
            }
        ],
        "snapshots": [
            {
                "config_key": config_key,
                "before_ref": "analysis/snapshots/dreamplace_ecc.before.json",
                "before_sha256": before_sha256,
                "after_ref": "analysis/snapshots/dreamplace_ecc.after.json",
                "after_sha256": after_sha256,
            }
        ],
    }
    materialization["receipt_sha256"] = canonical_sha256(materialization)
    _write_json(materialization_path, materialization)
    card = _card_for(knob)
    observation = observation_payload or {
        "evidence_complete": True,
        "effective_target_density": effective_value,
        "density_tensor_value": effective_value,
    }
    evidence = {
        "consumer_id": consumer_id,
        "outcome": "entered",
        "evidence_ref": "analysis/parameter_runtime_report.v1.json",
        "evidence_sha256": canonical_sha256(
            {
                "consumer_id": consumer_id,
                "outcome": "entered",
                "consumer_observation": observation,
            }
        ),
    }
    runtime = {
        "tool": card.tool.model_dump(mode="json"),
        "application_status": "applied",
        "activation": {
            "status": "used",
            "consumers": [evidence],
        },
        "effective_initial": {"value": effective_value, "unit": written_unit},
        "effective_final": {"value": effective_value, "unit": written_unit},
        "transitions": transitions or [],
        "consumer_observation": observation,
    }
    _write_json(runtime_path, runtime)
    receipt = {
        "schema_version": "tool.parameter_application_receipt.v1",
        "receipt_id": "parameter-receipt-acceptance-test",
        "tool": card.tool.model_dump(mode="json"),
        "context": {
            "run_id": candidate_id,
            "stage": "place",
            "lattice_version": "ecos.optimization_lattice.v1",
            "site_width_dbu": 2000,
            "ecc_revision": "ecc-test-revision",
            "parameter_card_sha256": card_hash(card),
            "context_sha256": HASH,
        },
        "requested": {
            "knob_id": knob.value,
            "value": requested_value,
            "unit": requested_unit,
        },
        "materialization": {
            "receipt_ref": "analysis/candidate_materialization.v1.json",
            "receipt_sha256": materialization["receipt_sha256"],
            "registry_sha256": HASH,
            "patch_sha256": patch_sha256,
            "candidate_ref": candidate_ref,
            "parent_ref": None,
            "workspace_ref": candidate_ref,
            "target_step": "place",
            "config_ref": "config/dreamplace_ecc.json",
            "config_before_sha256": before_sha256,
            "config_after_sha256": after_sha256,
            "before_snapshot_ref": "analysis/snapshots/dreamplace_ecc.before.json",
            "before_snapshot_sha256": before_sha256,
            "after_snapshot_ref": "analysis/snapshots/dreamplace_ecc.after.json",
            "after_snapshot_sha256": after_sha256,
            "written_value": written,
            "unit": written_unit,
            "parent_manifest_ref": None,
            "parent_manifest_sha256": None,
            "parent_state_sha256": HASH,
        },
        "effective_initial": runtime["effective_initial"],
        "transitions": runtime["transitions"],
        "application_status": runtime["application_status"],
        "activation": runtime["activation"],
        "consumer_observation": runtime["consumer_observation"],
        "effective_final": runtime["effective_final"],
    }
    receipt["evidence_sha256"] = canonical_sha256(_receipt_hash_payload(receipt))
    _write_json(receipt_path, receipt)
    manifest = {
        "schema": "ecc.workspace.candidate_workspace.v1",
        "schema_version": 1,
        "candidate_id": candidate_id,
        "candidate_root_ref": candidate_ref,
        "parent_candidate_root_ref": None,
        "parent_flow_sha256": HASH,
        "parent_state_sha256": HASH,
        "parent_manifest_ref": None,
        "parent_manifest_sha256": None,
        "target_step": "place",
        "end_step": "Harden",
        "execution_scope": "full_flow",
        "terminal_state": "succeeded",
        "candidate_flow_sha256": "sha256:" + "c" * 64,
        "candidate_state_sha256": "sha256:" + "d" * 64,
        "artifacts": {
            "candidate_materialization": {
                "ref": "analysis/candidate_materialization.v1.json",
                "sha256": file_sha256(materialization_path),
            },
            "parameter_application_receipt": {
                "ref": "analysis/parameter_application_receipt.v1.json",
                "sha256": file_sha256(receipt_path),
            },
            "parameter_runtime_report": {
                "ref": "analysis/parameter_runtime_report.v1.json",
                "sha256": file_sha256(runtime_path),
            },
        },
    }
    _write_json(manifest_path, manifest)
    replay = {
        "schema": "ecc.candidate_execution_receipt.v1",
        "candidate_id": candidate_id,
        "candidate_root_ref": candidate_ref,
        "parent_candidate_root_ref": None,
        "parent_flow_sha256": HASH,
        "parent_state_sha256": HASH,
        "target_step": "place",
        "end_step": "Harden",
        "execution_scope": "full_flow",
        "candidate_manifest_sha256": file_sha256(manifest_path),
    }
    _write_json(replay_path, replay)
    return {
        "manifest": manifest_path,
        "receipt": receipt_path,
        "runtime": runtime_path,
        "replay": replay_path,
    }


def _terminal(*, eligible: bool = True) -> TerminalObservation:
    positive = {
        "rcx_expected_corner_count",
        "rcx_spef_file_count",
        "sta_corner_count",
        "sta_expected_corner_count",
    }
    metric_ids = (
        "drc_count",
        "lvs_count",
        "rcx_expected_corner_count",
        "rcx_spef_file_count",
        "rcx_missing_corner_count",
        "rcx_spef_parse_failure_count",
        "sta_corner_count",
        "sta_expected_corner_count",
        "sta_missing_corner_count",
        "sta_setup_violation_count",
        "sta_hold_violation_count",
        "harden_artifact_missing_count",
    )
    return TerminalObservation(
        schema_version="ecos.terminal_observation.v3",
        observation_id="terminal-acceptance-test",
        evidence_manifest_sha256=HASH,
        evidence_valid=eligible,
        harden_artifacts_complete=True,
        signoff_gates=SignoffGates.all(GateResult.PASS),
        metrics={
            ObjectiveMetric.ROUTE_DR_TOTAL_VIOLATION_COUNT: 0,
            ObjectiveMetric.ROUTE_LA_TOTAL_OVERFLOW: 0,
            ObjectiveMetric.ROUTE_WIRELENGTH: 100,
        },
        timing_guardrail={metric: 0 for metric in TimingMetric},
        evaluation_metrics=tuple(
            TerminalEvaluationMetric(
                metric_id=metric_id,
                value=1 if metric_id in positive else 0,
                unit="count",
                category=EvaluationMetricCategory.ELIGIBILITY,
                role=EvaluationMetricRole.GATE,
                direction=EvaluationMetricDirection.EXACT,
                source_refs=("analysis/terminal.json",),
            )
            for metric_id in metric_ids
        ),
        evaluation_metrics_complete=True,
        sta_corner_ids=("typical",),
        sta_corner_set_sha256=canonical_sha256({"corners": ["typical"]}),
    )


def _write_trace(
    workspace: Path,
    paths: dict[str, Path],
    observation: TerminalObservation,
    *,
    domain_context_sha256: str | None = None,
) -> Path:
    optimization_root = workspace / ".agent/optimization"
    episode_root = optimization_root / "episode-acceptance-test"
    scope = build_task_memory_scope(
        workspace_manifest_sha256=HASH,
        design_id="design-a",
        checkpoint_id="place",
        episode_id=episode_root.name,
        objective_contract_sha256=HASH,
    )
    store = OptimizationTaskMemoryStore(optimization_root, scope)
    store.ensure_episode_scope(episode_root, scope)
    context_ref = ProposalContextRef(
        episode_id=scope.episode_id,
        checkpoint_id=scope.checkpoint_id,
        input_sha256=HASH,
    )
    native = ParameterApplicationReceipt.model_validate_json(
        paths["receipt"].read_bytes()
    )
    knob = OptimizationKnob(native.requested["knob_id"])
    action = ProposalAction(
        knob_id=knob,
        direction=StrategyDirection.DECREASE,
        expected_effects=(
            {
                "metric_id": ObjectiveMetric.ROUTE_LA_TOTAL_OVERFLOW,
                "direction": ExpectedEffectDirection.DECREASE,
            },
        ),
    )
    proposal = OptimizationProposal(
        context_ref=context_ref,
        decision=OptimizationDecision.PROPOSE,
        reason_code=ProposalReason.OBSERVATION,
        rationale_summary="Replay one acceptance candidate.",
        observation_refs=(
            ObservationReference(observation_id="observation-1", sha256=HASH),
        ),
        action=action,
    )
    planning = OptimizationPlanningAudit(episode_root).append(
        context_ref=context_ref,
        history_refs=(),
        history_outcomes=(),
        budget_snapshot=BudgetSnapshot(budget=EpisodeBudget.from_reference_rerun(1)),
        incumbent=None,
        planner_payload_sha256=HASH,
        effective_domains=(
            _domain_for(
                knob,
                domain_context_sha256 or native.context["context_sha256"],
            ),
        ),
    )
    OptimizationDecisionAudit(episode_root).append(
        planning_entry_sha256=planning.entry_sha256,
        proposal=proposal,
        validation_result="accepted",
        rejection_reason=None,
        requested=None,
        state=OptimizationEpisodeState.AWAITING_EXECUTION,
        objective_contract_sha256=scope.objective_contract_sha256,
    )
    candidate_ref = ".agent/candidates/candidate-acceptance-test"
    ledger = OptimizationLedger(episode_root)
    ledger.append_start(
        OptimizationInterventionStart(
            intervention_id="intervention-1",
            parent_checkpoint_id=scope.checkpoint_id,
            candidate_checkpoint_id="candidate-1",
            parameter_before_sha256=HASH,
            parameter_after_sha256=HASH,
            proposal_sha256=canonical_sha256(proposal.model_dump(mode="json")),
            execution_contract_sha256=HASH,
            parent_manifest_sha256=scope.workspace_manifest_sha256,
            environment_sha256=HASH,
            objective_contract_sha256=scope.objective_contract_sha256,
            proposal_action=action,
            requested=RequestedKnobValue(
                knob_id=knob,
                value=native.requested["value"],
            ),
        )
    )
    ledger.append_terminal(
        OptimizationTerminalOutcome(
            intervention_id="intervention-1",
            outcome=OptimizationOutcomeKind.IMPROVED,
            candidate_manifest_sha256=file_sha256(paths["manifest"]),
            candidate_root_ref=candidate_ref,
            candidate_manifest_ref=(
                f"{candidate_ref}/analysis/candidate_workspace.v1.json"
            ),
            receipt_sha256=native.evidence_sha256,
            terminal_observation_sha256=canonical_sha256(
                observation.model_dump(mode="json")
            ),
            terminal_observation=observation,
            parameter_application_receipt=native,
            parameter_card_sha256=card_hash(_card_for(knob)),
            materialization_receipt_sha256=native.materialization.receipt_sha256,
            parameter_application_receipt_id=native.receipt_id,
            outcome_details_sha256=HASH,
        )
    )
    ledger_replay = ledger.verify()
    decision_replay = OptimizationDecisionAudit(episode_root).verify()
    state = {
        "schema_version": "ecos.optimization_episode_state.v6",
        "episode_id": scope.episode_id,
        "checkpoint_id": scope.checkpoint_id,
        "objective": {"contract_sha256": scope.objective_contract_sha256},
        "parent_manifest_sha256": scope.workspace_manifest_sha256,
        "ledger_event_count": len(ledger_replay.entries),
        "ledger_chain_head_sha256": ledger_replay.chain_head_sha256,
        "decision_audit_event_count": len(decision_replay.entries),
        "decision_audit_chain_head_sha256": decision_replay.chain_head_sha256,
        "task_memory_scope_sha256": scope.scope_sha256,
    }
    state["state_sha256"] = canonical_sha256(state)
    _write_json(episode_root / "optimization-episode-state.v6.json", state)
    store.synchronize()
    return episode_root


def _domain_for(knob: OptimizationKnob, context_sha256: str) -> EffectiveDomainSnapshot:
    payload = {
        "schema_version": "ecos.effective_domain.v1",
        "knob_id": knob,
        "context_sha256": context_sha256,
        "current_coordinate": None,
        "surface_values": (0.2, 0.65),
        "excluded_aliases": (),
        "allowed_requested_values": (0.2, 0.65),
        "thresholds": (),
        "observed_application_signatures": (),
        "observed_response_signatures": (),
    }
    return EffectiveDomainSnapshot(
        **payload, snapshot_sha256=canonical_sha256(payload)
    )


def _build_acceptance(
    workspace: Path,
    output: Path,
    episode_roots: tuple[Path, ...],
) -> dict:
    receipt = json.loads(
        (
            workspace
            / ".agent/candidates/candidate-acceptance-test/analysis"
            / "parameter_application_receipt.v1.json"
        ).read_text(encoding="utf-8")
    )
    return acceptance.build_acceptance(
        workspace,
        output,
        candidates={receipt["requested"]["knob_id"]: "candidate-acceptance-test"},
        episode_roots=episode_roots,
        expected_ecos_revision=acceptance._current_revisions()["ecos_revision"],
        expected_ecc_revision="ecc-test-revision",
    )


def _rewrite_receipt(paths: dict[str, Path], mutate) -> None:
    receipt = json.loads(paths["receipt"].read_text(encoding="utf-8"))
    mutate(receipt)
    receipt["evidence_sha256"] = canonical_sha256(_receipt_hash_payload(receipt))
    _write_json(paths["receipt"], receipt)
    manifest = json.loads(paths["manifest"].read_text(encoding="utf-8"))
    manifest["artifacts"]["parameter_application_receipt"]["sha256"] = file_sha256(
        paths["receipt"]
    )
    _write_json(paths["manifest"], manifest)
    replay = json.loads(paths["replay"].read_text(encoding="utf-8"))
    replay["candidate_manifest_sha256"] = file_sha256(paths["manifest"])
    _write_json(paths["replay"], replay)


@pytest.mark.parametrize(
    ("case", "classification", "issue"),
    [
        ("valid", "Engineering Complete", None),
        ("outside_lattice", "Engineering Incomplete", "receipt contract"),
        ("ineligible_terminal", "Engineering Incomplete", "terminal observation"),
        ("tampered_runtime", "Engineering Incomplete", "runtime report"),
        ("foreign_runtime_tool", "Engineering Incomplete", "runtime report tool"),
        ("missing_runtime", "Engineering Incomplete", "runtime report"),
        ("missing_card_source", "Engineering Incomplete", "tool source"),
        ("unbound_replay", "Engineering Incomplete", "replay candidate manifest"),
        ("tampered_chain", "Engineering Incomplete", "optimization trace replay"),
    ],
)
def test_acceptance_fails_closed_on_unbound_evidence(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
    case: str,
    classification: str,
    issue: str | None,
) -> None:
    workspace = tmp_path / "workspace"
    output = tmp_path / "output"
    paths = _write_candidate(workspace)
    monkeypatch.setattr(
        acceptance,
        "load_parameter_cards",
        lambda: {OptimizationKnob.TARGET_DENSITY: _card()},
    )
    monkeypatch.setattr(
        optimization_memory,
        "load_parameter_cards",
        lambda: {OptimizationKnob.TARGET_DENSITY: _card()},
    )
    monkeypatch.setattr(acceptance, "_state_sha256", lambda _: HASH)
    revisions = acceptance._current_revisions()
    monkeypatch.setattr(
        acceptance,
        "_current_revisions",
        lambda: {**revisions, "ecc_gitlink_revision": "ecc-test-revision"},
    )
    eligible = case != "ineligible_terminal"
    observation = _terminal(eligible=eligible)
    episode_root = _write_trace(workspace, paths, observation)
    monkeypatch.setattr(
        acceptance,
        "build_candidate_terminal_observation",
        lambda *_: observation,
    )
    if case == "outside_lattice":
        _rewrite_receipt(
            paths,
            lambda receipt: (
                receipt["requested"].update(value=0.05),
                receipt["materialization"].update(written_value=0.05),
                receipt["effective_initial"].update(value=0.05),
                receipt["effective_final"].update(value=0.05),
                receipt["consumer_observation"].update(
                    effective_target_density=0.05,
                    density_tensor_value=0.05,
                ),
            ),
        )
    elif case == "tampered_runtime":
        paths["runtime"].write_text("{}", encoding="utf-8")
    elif case == "foreign_runtime_tool":
        runtime = json.loads(paths["runtime"].read_text(encoding="utf-8"))
        runtime["tool"]["source_sha256"] = "sha256:" + "f" * 64
        _write_json(paths["runtime"], runtime)
    elif case == "missing_runtime":
        paths["runtime"].unlink()
    elif case == "missing_card_source":
        _rewrite_receipt(
            paths, lambda receipt: receipt["tool"].update(source_sha256=None)
        )
    elif case == "unbound_replay":
        replay = json.loads(paths["replay"].read_text(encoding="utf-8"))
        replay["candidate_manifest_sha256"] = None
        _write_json(paths["replay"], replay)
    elif case == "tampered_chain":
        assert episode_root is not None
        audit = episode_root / "optimization-planning-audit.v1.jsonl"
        audit.write_text(
            audit.read_text(encoding="utf-8").replace('"sequence":1', '"sequence":9'),
            encoding="utf-8",
        )

    _build_acceptance(workspace, output, (episode_root,))

    report = json.loads(
        (output / "acceptance-report.v1.json").read_text(encoding="utf-8")
    )
    assert report["classification"] == classification
    issues = report["entries"][0]["issues"]
    if issue is None:
        assert issues == []
        assert report["terminal_closed_knobs"] == ["place.target_density"]
        assert report["provenance"]["current"] is True
        assert report["provenance"]["expected_ecc_revision"] == "ecc-test-revision"
        assert report["provenance"]["observed_ecc_revisions"] == [
            "ecc-test-revision"
        ]
    else:
        assert any(issue in item for item in issues)
        assert report["terminal_closed_knobs"] == []


def test_acceptance_requires_explicit_episode_roots_and_candidate_mapping(
    tmp_path: Path,
) -> None:
    revisions = acceptance._current_revisions()
    with pytest.raises(ValueError, match="episode root"):
        acceptance.build_acceptance(
            tmp_path,
            tmp_path / "output",
            candidates={"place.target_density": "candidate-1"},
            episode_roots=(),
            expected_ecos_revision=revisions["ecos_revision"],
            expected_ecc_revision="ecc-test-revision",
        )

    with pytest.raises(ValueError, match="candidate mapping"):
        acceptance.build_acceptance(
            tmp_path,
            tmp_path / "output",
            candidates={},
            episode_roots=(tmp_path / "episode",),
            expected_ecos_revision=revisions["ecos_revision"],
            expected_ecc_revision="ecc-test-revision",
        )

    with pytest.raises(ValueError, match="candidate id"):
        acceptance._validate_inputs(
            tmp_path,
            {"place.target_density": "../candidate-1"},
            (tmp_path / ".agent/optimization/episode-1",),
            revisions["ecos_revision"],
            "ecc-test-revision",
            {"place.target_density"},
        )


def test_acceptance_cli_requires_exactly_eight_unique_candidate_bindings() -> None:
    specs = [
        f"{knob.value}=candidate-{index}"
        for index, knob in enumerate(OptimizationKnob)
    ]

    assert acceptance._parse_candidates(specs) == {
        knob.value: f"candidate-{index}"
        for index, knob in enumerate(OptimizationKnob)
    }
    with pytest.raises(ValueError, match="eight unique"):
        acceptance._parse_candidates(specs[:-1])


def test_acceptance_rejects_planning_domain_receipt_context_mismatch(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    workspace = tmp_path / "workspace"
    output = tmp_path / "output"
    paths = _write_candidate(workspace)
    observation = _terminal()
    episode_root = _write_trace(
        workspace,
        paths,
        observation,
        domain_context_sha256="sha256:" + "b" * 64,
    )
    _patch_acceptance_for_single_density(monkeypatch, observation)

    _build_acceptance(workspace, output, (episode_root,))

    report = json.loads(
        (output / "acceptance-report.v1.json").read_text(encoding="utf-8")
    )
    assert report["classification"] == "Engineering Incomplete"
    assert any(
        "planning domain context" in issue for issue in report["entries"][0]["issues"]
    )


def test_acceptance_is_not_current_when_ecc_gitlink_differs(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    workspace = tmp_path / "workspace"
    output = tmp_path / "output"
    paths = _write_candidate(workspace)
    observation = _terminal()
    episode_root = _write_trace(workspace, paths, observation)
    _patch_acceptance_for_single_density(monkeypatch, observation)
    revisions = acceptance._current_revisions()
    monkeypatch.setattr(
        acceptance,
        "_current_revisions",
        lambda: {**revisions, "ecc_gitlink_revision": "ecc-other-revision"},
    )

    _build_acceptance(workspace, output, (episode_root,))

    report = json.loads(
        (output / "acceptance-report.v1.json").read_text(encoding="utf-8")
    )
    assert report["classification"] == "Engineering Incomplete"
    assert report["provenance"]["current"] is False


def _patch_acceptance_for_single_density(
    monkeypatch: pytest.MonkeyPatch,
    observation: TerminalObservation,
    *,
    knob: OptimizationKnob = OptimizationKnob.TARGET_DENSITY,
) -> None:
    revisions = acceptance._current_revisions()
    monkeypatch.setattr(
        acceptance,
        "_current_revisions",
        lambda: {
            **revisions,
            "ecc_gitlink_revision": "ecc-test-revision",
        },
    )
    monkeypatch.setattr(
        acceptance,
        "load_parameter_cards",
        lambda: {knob: _card_for(knob)},
    )
    monkeypatch.setattr(
        optimization_memory,
        "load_parameter_cards",
        lambda: {knob: _card_for(knob)},
    )
    monkeypatch.setattr(acceptance, "_state_sha256", lambda _: HASH)
    monkeypatch.setattr(
        acceptance,
        "build_candidate_terminal_observation",
        lambda *_: observation,
    )


def test_acceptance_allows_evidenced_target_density_override(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    workspace = tmp_path / "workspace"
    output = tmp_path / "output"
    observation_payload = {
        "evidence_complete": True,
        "effective_target_density": 0.8,
        "density_tensor_value": 0.8,
    }
    override_hash = canonical_sha256(
        {
            "consumer_id": "dreamplace.density_objective",
            "outcome": "entered",
            "consumer_observation": observation_payload,
        }
    )
    paths = _write_candidate(
        workspace,
        requested_value=0.2,
        effective_value=0.8,
        transitions=[
            {
                "sequence": 0,
                "from": "requested",
                "to": "overridden",
                "value": 0.8,
                "reason": "Raised to the native utilization floor.",
                "rule_id": "dreamplace.target_density.utilization_floor",
                "iteration": None,
                "evidence_ref": "analysis/parameter_runtime_report.v1.json",
                "evidence_sha256": override_hash,
            }
        ],
    )
    observation = _terminal()
    episode_root = _write_trace(workspace, paths, observation)
    _patch_acceptance_for_single_density(monkeypatch, observation)

    _build_acceptance(workspace, output, (episode_root,))

    report = json.loads(
        (output / "acceptance-report.v1.json").read_text(encoding="utf-8")
    )
    assert report["classification"] == "Engineering Complete"
    assert report["entries"][0]["issues"] == []
    assert report["terminal_closed_knobs"] == ["place.target_density"]


def test_acceptance_requires_l1_materialization_binding(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    workspace = tmp_path / "workspace"
    output = tmp_path / "output"
    paths = _write_candidate(workspace)

    def remove_l1_binding(receipt: dict) -> None:
        receipt["materialization"].update(
            {
                "target_step": None,
                "config_ref": None,
                "before_snapshot_ref": None,
                "before_snapshot_sha256": None,
                "after_snapshot_ref": None,
                "after_snapshot_sha256": None,
                "parent_state_sha256": None,
            }
        )

    _rewrite_receipt(paths, remove_l1_binding)
    observation = _terminal()
    episode_root = _write_trace(workspace, paths, observation)
    _patch_acceptance_for_single_density(monkeypatch, observation)

    _build_acceptance(workspace, output, (episode_root,))

    report = json.loads(
        (output / "acceptance-report.v1.json").read_text(encoding="utf-8")
    )
    assert report["classification"] == "Engineering Incomplete"
    assert any("candidate artifact" in item for item in report["entries"][0]["issues"])
    assert report["terminal_closed_knobs"] == []


def _write_padding_candidate(
    workspace: Path,
    *,
    written_value: int = 4000,
    effective_value: int = 4000,
) -> dict[str, Path]:
    return _write_candidate(
        workspace,
        knob=OptimizationKnob.CELL_PADDING_X,
        requested_value=2,
        written_value=written_value,
        effective_value=effective_value,
        requested_unit="site",
        written_unit="dbu",
        config_field="cell_padding_x",
        consumer_id="dreamplace.cell_size_expansion",
        observation_payload={
            "evidence_complete": True,
            "effective_padding_dbu": effective_value,
            "movable_node_count": 10,
        },
    )


@pytest.mark.parametrize(
    ("paths_mutation", "classification"),
    (
        (None, "Engineering Complete"),
        ("wrong_written_value", "Engineering Incomplete"),
    ),
)
def test_acceptance_validates_cell_padding_site_to_dbu_materialization(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
    paths_mutation: str | None,
    classification: str,
) -> None:
    workspace = tmp_path / "workspace"
    output = tmp_path / "output"
    paths = _write_padding_candidate(
        workspace,
        written_value=(2 if paths_mutation == "wrong_written_value" else 4000),
        effective_value=(2 if paths_mutation == "wrong_written_value" else 4000),
    )
    observation = _terminal()
    episode_root = _write_trace(workspace, paths, observation)
    _patch_acceptance_for_single_density(
        monkeypatch,
        observation,
        knob=OptimizationKnob.CELL_PADDING_X,
    )

    _build_acceptance(workspace, output, (episode_root,))

    report = json.loads(
        (output / "acceptance-report.v1.json").read_text(encoding="utf-8")
    )
    assert report["classification"] == classification
    if classification == "Engineering Complete":
        assert report["terminal_closed_knobs"] == ["place.cell_padding_x"]
    else:
        assert any(
            "candidate artifact" in item for item in report["entries"][0]["issues"]
        )
        assert report["terminal_closed_knobs"] == []


@pytest.mark.parametrize("mutation", ("missing_config", "tampered_after_snapshot"))
def test_acceptance_rejects_unavailable_or_tampered_l1_files(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
    mutation: str,
) -> None:
    workspace = tmp_path / "workspace"
    output = tmp_path / "output"
    paths = _write_candidate(workspace)
    candidate_root = paths["manifest"].parents[1]
    if mutation == "missing_config":
        (candidate_root / "config/dreamplace_ecc.json").unlink()
    else:
        _write_json(
            candidate_root / "analysis/snapshots/dreamplace_ecc.after.json",
            {"target_density": 0.7},
        )
    observation = _terminal()
    episode_root = _write_trace(workspace, paths, observation)
    _patch_acceptance_for_single_density(monkeypatch, observation)

    _build_acceptance(workspace, output, (episode_root,))

    report = json.loads(
        (output / "acceptance-report.v1.json").read_text(encoding="utf-8")
    )
    assert report["classification"] == "Engineering Incomplete"
    assert any("candidate artifact" in item for item in report["entries"][0]["issues"])
    assert report["terminal_closed_knobs"] == []
