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
    NumericProposalActionV2,
    OptimizationProposalV2,
    ToolRef,
)
from ecos_agent.parameter_semantics import CARD_ROOT, ParameterSemanticsError, load_parameter_cards


HASH = "sha256:" + "a" * 64


def test_cards_are_exactly_the_frozen_eight() -> None:
    cards = load_parameter_cards()
    assert {knob.value for knob in cards} == {item.value for item in OptimizationKnob}
    assert [len(card.requested_domain.values) for card in cards.values()] == [13, 16, 12, 18, 2, 21, 23, 16]


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


def _density_receipt(context_sha: str) -> ParameterApplicationReceipt:
    payload = dict(
        receipt_id="parameter-receipt-1",
        tool=ToolRef(name="DREAMPlace", revision="bound"),
        context={"context_sha256": context_sha},
        requested={"knob_id": "place.target_density", "value": 0.2, "unit": "ratio"},
        materialization=MaterializationRef(
            receipt_ref="analysis/materialization.json", receipt_sha256=HASH,
            registry_sha256=HASH, patch_sha256=HASH, candidate_ref="candidate-1",
            workspace_ref="workspace", config_before_sha256=HASH,
            config_after_sha256=HASH, written_value=0.2, unit="ratio",
        ),
        effective_initial=EffectiveValue(value=0.8, unit="ratio"),
        application_status="applied",
        activation=ActivationEvidence(status="used", consumers=({"consumer_id": "dreamplace.density_objective", "outcome": "entered", "evidence_ref": "analysis/density.json", "evidence_sha256": HASH},)),
        effective_final=EffectiveValue(value=0.8, unit="ratio"),
    )
    draft = ParameterApplicationReceipt.model_construct(**payload, evidence_sha256=HASH)
    return ParameterApplicationReceipt(**payload, evidence_sha256=canonical_sha256(draft.model_dump(mode="json", exclude={"evidence_sha256"})))


def test_density_floor_excludes_only_values_supported_by_typed_rule() -> None:
    cards = load_parameter_cards()
    card = cards[OptimizationKnob.TARGET_DENSITY]
    context = {"design_sha256": HASH, "stage": "place", "tool_revision": "bound"}
    domain = compile_effective_domain(card, context=context, receipts=(_density_receipt(build_context_fingerprint(context)),))
    assert domain.allowed_requested_values == (0.825, 0.85, 0.875, 0.9, 0.925, 0.95)
    assert domain.current_coordinate["effective_anchor"] == 0.8


def test_rules_empty_does_not_infer_aliases() -> None:
    cards = load_parameter_cards()
    card = cards[OptimizationKnob.FLOORPLAN_ASPECT_RATIO]
    domain = compile_effective_domain(card, context={"design_sha256": HASH}, baseline_surface_value=1.0)
    assert domain.excluded_aliases == ()
    assert len(domain.allowed_requested_values) == 13


def test_context_fingerprint_ignores_run_id_but_binds_inputs() -> None:
    context = {
        "run_id": "candidate-1",
        "design_sha256": HASH,
        "rtl_sha256": HASH,
        "filelist_sha256": HASH,
        "sdc_sha256": HASH,
        "pdk_sha256": HASH,
        "parent_lineage_sha256": HASH,
        "stage": "place",
        "backend": "ecc",
        "tool_revision": "bound",
        "lattice_version": "ecos.optimization_lattice.v1",
        "unit": "ratio",
        "site_width_dbu": 200,
        "seed": 0,
    }
    assert build_context_fingerprint(context) == build_context_fingerprint(
        {**context, "run_id": "candidate-2"}
    )
    assert build_context_fingerprint(context) != build_context_fingerprint(
        {**context, "site_width_dbu": 400}
    )


def test_v2_validator_rejects_value_outside_hash_bound_domain() -> None:
    card = load_parameter_cards()[OptimizationKnob.TARGET_DENSITY]
    domain = compile_effective_domain(card, context={"design_sha256": HASH}, baseline_surface_value=0.2)
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
