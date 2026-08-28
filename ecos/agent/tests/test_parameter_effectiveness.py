from __future__ import annotations

import json
import os
import shutil
import subprocess
import sys

import pytest

from ecos_agent.effective_domain import (
    EffectiveDomainError,
    build_context_fingerprint,
    compile_effective_domain,
    validate_numeric_proposal,
)
from ecos_agent.hashing import canonical_sha256, file_sha256
from ecos_agent.optimization_contracts import OptimizationKnob
from ecos_agent.parameter_evidence_contracts import (
    ActivationEvidence,
    EffectiveValue,
    MaterializationRef,
    ParameterApplicationReceipt,
    RuntimeTransition,
    NumericProposalActionV2,
    OptimizationProposalV2,
    ToolRef,
)
from ecos_agent.parameter_semantics import (
    CARD_ROOT,
    ParameterSemanticsError,
    card_hash,
    load_parameter_cards,
    validate_application_receipt,
)


HASH = "sha256:" + "a" * 64


def _domain_context(**updates: object) -> dict[str, object]:
    card = load_parameter_cards()[OptimizationKnob.TARGET_DENSITY]
    context: dict[str, object] = {
        "design_sha256": HASH,
        "rtl_sha256": HASH,
        "filelist_sha256": HASH,
        "sdc_sha256": HASH,
        "pdk_sha256": HASH,
        "parent_lineage_sha256": HASH,
        "stage": "place",
        "backend": "ecc",
        "tool_revision": card.tool.revision,
        "lattice_version": "ecos.optimization_lattice.v1",
        "unit": "ratio",
        "site_width_dbu": 200,
        "seed": 0,
        "tool_source_sha256": card.tool.source_sha256,
        "incumbent_state_sha256": HASH,
        "parameter_card_sha256": card_hash(card),
        "parent_manifest_sha256": HASH,
        "terminal_execution_contract_sha256": HASH,
        "current_values": {"place.target_density": 0.2},
    }
    context.update(updates)
    return context


def test_cards_are_exactly_the_frozen_eight() -> None:
    cards = load_parameter_cards()
    assert {knob.value for knob in cards} == {item.value for item in OptimizationKnob}
    assert [len(card.requested_domain.values) for card in cards.values()] == [13, 16, 12, 18, 2, 21, 23, 16]


def test_dreamplace_cards_bind_typed_runtime_semantics_to_native_sources() -> None:
    cards = load_parameter_cards()
    dreamplace_cards = [card for card in cards.values() if card.tool.name == "DREAMPlace"]

    assert len(dreamplace_cards) == 5
    for card in dreamplace_cards:
        assert card.runtime_semantics is not None
        assert card.runtime_semantics.mechanism
        span_ids = {span.span_id for span in card.source_spans}
        assert None not in span_ids
        assert {span.role for span in card.source_spans} >= {
            "runtime_report_producer",
            "native_consumer",
        }
        referenced = {
            span_id
            for condition in card.activation_conditions
            for span_id in condition.source_span_ids
        } | {
            span_id
            for consumer in card.consumers
            for span_id in consumer.source_span_ids
        } | set(card.runtime_semantics.source_span_ids)
        assert referenced <= span_ids


def test_loader_rejects_dreamplace_card_without_native_consumer_span(tmp_path) -> None:
    root = tmp_path / "cards"
    shutil.copytree(CARD_ROOT, root)
    card_path = root / "cards/place.target_density.json"
    card = json.loads(card_path.read_text(encoding="utf-8"))
    card["source_spans"] = [
        span for span in card["source_spans"] if span.get("role") == "runtime_report_producer"
    ]
    report_span = card["source_spans"][0]["span_id"]
    for item in (*card["activation_conditions"], *card["consumers"]):
        item["source_span_ids"] = [report_span]
    semantics = card["runtime_semantics"]
    semantics["source_span_ids"] = [report_span]
    for key in ("metric_relevance", "interactions", "invalidation_rules"):
        for item in semantics[key]:
            item["source_span_ids"] = [report_span]
    card_path.write_text(json.dumps(card, separators=(",", ":")), encoding="utf-8")
    _refresh_card_manifest(root)

    with pytest.raises(ParameterSemanticsError, match="native consumer"):
        load_parameter_cards(root)


def _refresh_card_manifest(root) -> None:
    manifest_path = root / "manifest.json"
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    for item in manifest["cards"]:
        item["sha256"] = file_sha256(root / item["path"])
    manifest["manifest_sha256"] = canonical_sha256(
        {key: value for key, value in manifest.items() if key != "manifest_sha256"}
    )
    manifest_path.write_text(json.dumps(manifest, separators=(",", ":")), encoding="utf-8")


def test_loader_rejects_changed_frozen_lattice(tmp_path) -> None:
    root = tmp_path / "cards"
    shutil.copytree(CARD_ROOT, root)
    card_path = root / "cards/place.target_density.json"
    card = json.loads(card_path.read_text(encoding="utf-8"))
    card["requested_domain"]["values"][0] = 0.11
    card_path.write_text(json.dumps(card, separators=(",", ":")), encoding="utf-8")
    _refresh_card_manifest(root)

    with pytest.raises(ParameterSemanticsError, match="lattice"):
        load_parameter_cards(root)


def test_loader_rejects_unregistered_runtime_probe(tmp_path) -> None:
    root = tmp_path / "cards"
    shutil.copytree(CARD_ROOT, root)
    card_path = root / "cards/place.target_density.json"
    card = json.loads(card_path.read_text(encoding="utf-8"))
    card["runtime_probe_ids"] = ["unknown.probe"]
    card_path.write_text(json.dumps(card, separators=(",", ":")), encoding="utf-8")
    _refresh_card_manifest(root)

    with pytest.raises(ParameterSemanticsError, match="runtime probe"):
        load_parameter_cards(root)


def test_wheel_loads_cards_without_source_checkout(tmp_path) -> None:
    wheel_dir = tmp_path / "wheel"
    subprocess.run(
        ["uv", "build", "--wheel", "--out-dir", str(wheel_dir)],
        cwd=CARD_ROOT.parents[2],
        check=True,
        capture_output=True,
        text=True,
    )
    wheel = next(wheel_dir.glob("*.whl"))
    site_dir = tmp_path / "site"
    subprocess.run(
        ["uv", "pip", "install", "--quiet", "--target", str(site_dir), str(wheel)],
        check=True,
        capture_output=True,
        text=True,
    )
    env = dict(os.environ, PYTHONPATH=str(site_dir))
    result = subprocess.run(
        [sys.executable, "-c", "from ecos_agent.parameter_semantics import load_parameter_cards; assert len(load_parameter_cards()) == 8"],
        cwd=tmp_path,
        env=env,
        check=False,
        capture_output=True,
        text=True,
    )
    assert result.returncode == 0, result.stderr


def _density_receipt(
    context: dict[str, object], *, with_runtime_trigger: bool = True
) -> ParameterApplicationReceipt:
    receipt_context = {
        key: context[key]
        for key in (
            "design_sha256",
            "rtl_sha256",
            "filelist_sha256",
            "sdc_sha256",
            "pdk_sha256",
            "parent_lineage_sha256",
            "stage",
            "backend",
            "tool_revision",
            "lattice_version",
            "unit",
            "site_width_dbu",
            "seed",
        )
    }
    receipt_context["context_sha256"] = build_context_fingerprint(context)
    payload = dict(
        receipt_id="parameter-receipt-1",
        tool=ToolRef(
            name="DREAMPlace",
            revision=str(context["tool_revision"]),
            source_sha256=str(context["tool_source_sha256"]),
        ),
        context=receipt_context,
        requested={"knob_id": "place.target_density", "value": 0.2, "unit": "ratio"},
        materialization=MaterializationRef(
            receipt_ref="analysis/materialization.json", receipt_sha256=HASH,
            registry_sha256=HASH, patch_sha256=HASH, candidate_ref="candidate-1",
            workspace_ref="workspace", config_before_sha256=HASH,
            config_after_sha256=HASH, written_value=0.2, unit="ratio",
        ),
        effective_initial=EffectiveValue(value=0.8, unit="ratio"),
        transitions=(
            RuntimeTransition(
                sequence=0,
                **{"from": "materialized"},
                to="overridden",
                value=0.8,
                reason="utilization lower bound",
                rule_id="dreamplace.target_density.utilization_floor",
                evidence_ref="analysis/density.json",
                evidence_sha256=HASH,
            ),
        )
        if with_runtime_trigger
        else (),
        application_status="applied",
        activation=ActivationEvidence(status="used", consumers=({"consumer_id": "dreamplace.density_objective", "outcome": "entered", "evidence_ref": "analysis/density.json", "evidence_sha256": HASH},)),
        consumer_observation={
            "requested_target_density": 0.2,
            "effective_target_density": 0.8,
            "density_tensor_value": 0.8,
            "placement_iteration_count": 4,
            "evidence_complete": True,
        },
        effective_final=EffectiveValue(value=0.8, unit="ratio"),
    )
    draft = ParameterApplicationReceipt.model_construct(**payload, evidence_sha256=HASH)
    return ParameterApplicationReceipt(**payload, evidence_sha256=canonical_sha256(draft.model_dump(mode="json", exclude={"evidence_sha256"})))


def test_density_floor_excludes_only_values_supported_by_typed_rule() -> None:
    cards = load_parameter_cards()
    card = cards[OptimizationKnob.TARGET_DENSITY]
    context = _domain_context()
    domain = compile_effective_domain(card, context=context, receipts=(_density_receipt(context),))
    assert domain.allowed_requested_values == (0.825, 0.85, 0.875, 0.9, 0.925, 0.95)
    assert domain.current_coordinate["effective_anchor"] == 0.8


def test_dreamplace_used_receipt_requires_consumer_observation() -> None:
    cards = load_parameter_cards()
    context = _domain_context()
    payload = _density_receipt(context).model_dump(
        mode="json", exclude={"consumer_observation", "evidence_sha256"}
    )
    receipt = ParameterApplicationReceipt(
        **payload, evidence_sha256=canonical_sha256(payload)
    )

    with pytest.raises(ParameterSemanticsError, match="consumer observation"):
        validate_application_receipt(receipt, cards)


def test_application_receipt_requires_card_bound_tool_source() -> None:
    cards = load_parameter_cards()
    payload = _density_receipt(_domain_context()).model_dump(
        mode="json", exclude={"evidence_sha256"}
    )
    payload["tool"]["source_sha256"] = None
    payload["materialization"]["config_after_sha256"] = "sha256:" + "b" * 64
    receipt = ParameterApplicationReceipt(
        **payload, evidence_sha256=canonical_sha256(payload)
    )

    with pytest.raises(ParameterSemanticsError, match="tool source"):
        validate_application_receipt(receipt, cards)


def test_padding_materialization_keeps_surface_and_written_units_distinct() -> None:
    tool = load_parameter_cards()[OptimizationKnob.CELL_PADDING_X].tool
    payload = dict(
        receipt_id="parameter-receipt-padding-1",
        tool=ToolRef(
            name=tool.name, revision=tool.revision, source_sha256=tool.source_sha256
        ),
        context={"stage": "place", "lattice_version": "ecos.optimization_lattice.v1"},
        requested={"knob_id": "place.cell_padding_x", "value": 2, "unit": "site"},
        materialization=MaterializationRef(
            receipt_ref="analysis/candidate_materialization.v1.json",
            receipt_sha256=HASH,
            registry_sha256=HASH,
            patch_sha256=HASH,
            candidate_ref=".agent/candidates/candidate-1",
            workspace_ref=".agent/candidates/candidate-1",
            target_step="place",
            config_ref="config/dreamplace_ecc.json",
            config_before_sha256=HASH,
            config_after_sha256="sha256:" + "b" * 64,
            before_snapshot_ref="analysis/snapshots/dreamplace.before.json",
            before_snapshot_sha256=HASH,
            after_snapshot_ref="analysis/snapshots/dreamplace.after.json",
            after_snapshot_sha256="sha256:" + "b" * 64,
            written_value=400,
            unit="dbu",
        ),
        effective_initial=EffectiveValue(value=400, unit="dbu"),
        application_status="applied",
        activation=ActivationEvidence(status="unknown"),
        effective_final=EffectiveValue(value=400, unit="dbu"),
    )
    draft = ParameterApplicationReceipt.model_construct(**payload, evidence_sha256=HASH)
    hash_payload = draft.model_dump(mode="json", exclude={"evidence_sha256"})
    hash_payload.pop("consumer_observation", None)
    receipt = ParameterApplicationReceipt(
        **payload,
        evidence_sha256=canonical_sha256(hash_payload),
    )

    validate_application_receipt(receipt, load_parameter_cards())
    assert receipt.requested["unit"] == "site"
    assert receipt.materialization.unit == "dbu"


def test_density_floor_without_runtime_trigger_excludes_only_observed_request() -> None:
    card = load_parameter_cards()[OptimizationKnob.TARGET_DENSITY]
    context = _domain_context()
    receipt = _density_receipt(context, with_runtime_trigger=False)

    domain = compile_effective_domain(card, context=context, receipts=(receipt,))

    assert domain.excluded_aliases == (0.2,)
    assert 0.15 in domain.allowed_requested_values


def test_rules_empty_does_not_infer_aliases() -> None:
    cards = load_parameter_cards()
    card = cards[OptimizationKnob.FLOORPLAN_ASPECT_RATIO]
    context = _domain_context(
        stage="Floorplan",
        tool_revision=card.tool.revision,
        tool_source_sha256=card.tool.source_sha256,
        parameter_card_sha256=card_hash(card),
    )
    domain = compile_effective_domain(card, context=context, baseline_surface_value=1.0)
    assert domain.excluded_aliases == ()
    assert len(domain.allowed_requested_values) == 13


def test_context_fingerprint_ignores_run_id_but_binds_inputs() -> None:
    context = _domain_context(run_id="candidate-1")
    assert build_context_fingerprint(context) == build_context_fingerprint(
        {**context, "run_id": "candidate-2"}
    )
    assert build_context_fingerprint(context) != build_context_fingerprint(
        {**context, "site_width_dbu": 400}
    )
    assert build_context_fingerprint(context) != build_context_fingerprint(
        {**context, "incumbent_state_sha256": "sha256:" + "b" * 64}
    )


def test_context_fingerprint_requires_every_binding_field() -> None:
    context = _domain_context()

    for key in tuple(context):
        with pytest.raises(EffectiveDomainError, match="missing binding fields"):
            build_context_fingerprint({name: value for name, value in context.items() if name != key})


def test_effective_domain_rejects_partial_or_mismatched_receipt_context() -> None:
    card = load_parameter_cards()[OptimizationKnob.TARGET_DENSITY]
    context = _domain_context()
    receipt = _density_receipt(context)
    partial = receipt.model_dump(mode="json", exclude={"evidence_sha256"})
    partial["context"].pop("pdk_sha256")
    partial_receipt = ParameterApplicationReceipt(
        **partial, evidence_sha256=canonical_sha256(partial)
    )
    mismatched = receipt.model_dump(mode="json", exclude={"evidence_sha256"})
    mismatched["context"]["seed"] = 1
    mismatched_receipt = ParameterApplicationReceipt(
        **mismatched, evidence_sha256=canonical_sha256(mismatched)
    )
    unbound = receipt.model_dump(mode="json", exclude={"evidence_sha256"})
    unbound["context"].pop("context_sha256")
    unbound_receipt = ParameterApplicationReceipt(
        **unbound, evidence_sha256=canonical_sha256(unbound)
    )

    for candidate in (partial_receipt, mismatched_receipt, unbound_receipt):
        domain = compile_effective_domain(card, context=context, receipts=(candidate,))
        assert domain.current_coordinate is None
        assert domain.observed_application_signatures == ()


def test_v2_validator_rejects_value_outside_hash_bound_domain() -> None:
    card = load_parameter_cards()[OptimizationKnob.TARGET_DENSITY]
    domain = compile_effective_domain(card, context=_domain_context(), baseline_surface_value=0.2)
    proposal = OptimizationProposalV2(
        context_ref={"episode_id": "episode-1", "checkpoint_id": "place", "input_sha256": HASH},
        decision="propose", reason_code="observation", rationale_summary="bounded proposal",
        observation_refs=({"observation_id": "obs-1", "sha256": HASH},),
        action=NumericProposalActionV2(
            knob_id=card.knob_id, direction="increase", requested_value=0.85,
            effective_domain_sha256=domain.snapshot_sha256,
            expected_effects=({"metric_id": "route_wirelength", "direction": "decrease"},),
        ),
    )
    validate_numeric_proposal(proposal, domain)
    invalid = proposal.model_copy(update={"action": proposal.action.model_copy(update={"requested_value": 0.1})})
    try:
        validate_numeric_proposal(invalid, domain)
    except EffectiveDomainError:
        pass
    else:
        raise AssertionError("out-of-domain proposal was accepted")
