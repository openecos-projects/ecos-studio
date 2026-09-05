from __future__ import annotations

import json
import os
import shutil
import subprocess
import sys

import pytest

from ecos_agent.hashing import canonical_sha256
from ecos_agent.optimization.contracts import OptimizationKnob
from ecos_agent.optimization.parameters.contracts import (
    ParameterApplicationReceipt,
    ParameterSemanticsCard,
)
from ecos_agent.optimization.parameters.semantics import (
    CARD_ROOT,
    ParameterSemanticsError,
    card_hash,
    load_parameter_card,
    load_parameter_cards,
)
from tests.paths import AGENT_ROOT


def test_parameter_cards_are_flat_under_optimization() -> None:
    manifest = json.loads((CARD_ROOT / "manifest.json").read_text(encoding="utf-8"))

    assert CARD_ROOT.name == "optimization"
    assert {item["path"] for item in manifest["cards"]} == {
        f"{knob.value}.json" for knob in OptimizationKnob
    }
    assert {path.name for path in CARD_ROOT.iterdir()} == {
        "manifest.json",
        *(f"{knob.value}.json" for knob in OptimizationKnob),
    }


def test_loader_accepts_semantically_identical_json_formatting(tmp_path) -> None:
    root = tmp_path / "cards"
    shutil.copytree(CARD_ROOT, root)
    card_path = root / "floorplan.aspect_ratio.json"
    card = json.loads(card_path.read_text(encoding="utf-8"))
    card_path.write_text(json.dumps(card, indent=2) + "\n", encoding="utf-8")

    loaded = load_parameter_cards(root)

    assert loaded[OptimizationKnob.FLOORPLAN_ASPECT_RATIO].knob_id == (
        OptimizationKnob.FLOORPLAN_ASPECT_RATIO
    )


def test_loader_rejects_semantically_changed_card_without_manifest_update(tmp_path) -> None:
    root = tmp_path / "cards"
    shutil.copytree(CARD_ROOT, root)
    card_path = root / "floorplan.aspect_ratio.json"
    card = json.loads(card_path.read_text(encoding="utf-8"))
    card["runtime_semantics"]["mechanism"] += " Changed."
    card_path.write_text(json.dumps(card), encoding="utf-8")

    with pytest.raises(ParameterSemanticsError, match="card hash"):
        load_parameter_cards(root)


def test_single_card_loader_ignores_unrelated_invalid_card(tmp_path) -> None:
    root = tmp_path / "cards"
    shutil.copytree(CARD_ROOT, root)
    card_path = root / "place.target_overflow.json"
    card = json.loads(card_path.read_text(encoding="utf-8"))
    card["requested_domain"]["values"][0] = 0.117
    card_path.write_text(json.dumps(card), encoding="utf-8")
    _refresh_card_manifest(root)

    loaded = load_parameter_card(OptimizationKnob.TARGET_DENSITY, root)

    assert loaded.knob_id is OptimizationKnob.TARGET_DENSITY
    with pytest.raises(ParameterSemanticsError, match="lattice"):
        load_parameter_cards(root)


def test_parameter_receipt_schema_explains_evidence_boundaries() -> None:
    schema = ParameterApplicationReceipt.model_json_schema()

    assert schema["properties"]["requested"]["description"] == (
        "The proposal intent before materialization; it does not prove what the tool used."
    )
    assert schema["$defs"]["MaterializationRef"]["properties"]["written_value"][
        "description"
    ] == "The value actually written to the tool input, after unit mapping."
    assert schema["properties"]["effective_initial"]["description"] == (
        "The value the tool accepted after admission, normalization, clamping, or override."
    )
    assert schema["properties"]["effective_final"]["description"] == (
        "The value remaining after all recorded runtime adjustments."
    )
    assert schema["$defs"]["ActivationEvidence"]["properties"]["status"][
        "description"
    ] == "Whether an allowlisted runtime branch, operator, or consumer used the parameter."
    assert schema["description"] == (
        "Tool-observed parameter evidence; this alone does not prove QoR improvement."
    )


def test_cards_are_exactly_the_frozen_seven() -> None:
    cards = load_parameter_cards()
    assert {knob.value for knob in cards} == {item.value for item in OptimizationKnob}
    assert [len(card.requested_domain.values) for card in cards.values()] == [
        13,
        16,
        12,
        18,
        2,
        21,
        23,
    ]


def test_dreamplace_cards_bind_typed_runtime_semantics_to_native_sources() -> None:
    cards = load_parameter_cards()
    dreamplace_cards = [
        card for card in cards.values() if card.tool.name == "DREAMPlace"
    ]

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
        referenced = (
            {
                span_id
                for condition in card.activation_conditions
                for span_id in condition.source_span_ids
            }
            | {
                span_id
                for consumer in card.consumers
                for span_id in consumer.source_span_ids
            }
            | set(card.runtime_semantics.source_span_ids)
        )
        assert referenced <= span_ids


def test_non_dreamplace_cards_bind_typed_runtime_semantics_to_native_sources() -> None:
    cards = load_parameter_cards()
    native_cards = [
        card for card in cards.values() if card.tool.name != "DREAMPlace"
    ]

    assert len(native_cards) == 2
    for card in native_cards:
        assert card.runtime_semantics is not None
        assert card.runtime_semantics.mechanism
        assert all(span.span_id is not None for span in card.source_spans)
        assert {span.role for span in card.source_spans} >= {
            "runtime_report_producer",
            "native_consumer",
        }


def test_loader_rejects_dreamplace_card_without_native_consumer_span(tmp_path) -> None:
    root = tmp_path / "cards"
    shutil.copytree(CARD_ROOT, root)
    card_path = root / "place.target_density.json"
    card = json.loads(card_path.read_text(encoding="utf-8"))
    card["source_spans"] = [
        span
        for span in card["source_spans"]
        if span.get("role") == "runtime_report_producer"
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


def test_loader_rejects_dreamplace_card_without_runtime_report_producer(
    tmp_path,
) -> None:
    root = tmp_path / "cards"
    shutil.copytree(CARD_ROOT, root)
    card_path = root / "place.target_density.json"
    card = json.loads(card_path.read_text(encoding="utf-8"))
    card["tool"].pop("source_sha256", None)
    card["source_spans"] = [
        span
        for span in card["source_spans"]
        if span.get("role") != "runtime_report_producer"
    ]
    card["runtime_semantics"]["invalidation_rules"] = []
    card_path.write_text(json.dumps(card, separators=(",", ":")), encoding="utf-8")
    _refresh_card_manifest(root)

    with pytest.raises(ParameterSemanticsError, match="runtime report producer"):
        load_parameter_cards(root)


def test_loader_rejects_source_span_hash_when_line_range_changes(tmp_path) -> None:
    root = tmp_path / "cards"
    shutil.copytree(CARD_ROOT, root)
    card_path = root / "place.target_density.json"
    card = json.loads(card_path.read_text(encoding="utf-8"))
    card["source_spans"][1]["start"] = 1
    card["source_spans"][1]["end"] = 1
    card_path.write_text(json.dumps(card, separators=(",", ":")), encoding="utf-8")
    _refresh_card_manifest(root)

    with pytest.raises(ParameterSemanticsError, match="source span hash"):
        load_parameter_cards(root)


def _refresh_card_manifest(root) -> None:
    manifest_path = root / "manifest.json"
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    for item in manifest["cards"]:
        card = ParameterSemanticsCard.model_validate_json(
            (root / item["path"]).read_bytes()
        )
        item["sha256"] = card_hash(card)
    manifest["manifest_sha256"] = canonical_sha256(
        {key: value for key, value in manifest.items() if key != "manifest_sha256"}
    )
    manifest_path.write_text(
        json.dumps(manifest, separators=(",", ":")), encoding="utf-8"
    )


def test_loader_rejects_changed_frozen_lattice(tmp_path) -> None:
    root = tmp_path / "cards"
    shutil.copytree(CARD_ROOT, root)
    card_path = root / "place.target_density.json"
    card = json.loads(card_path.read_text(encoding="utf-8"))
    card["requested_domain"]["values"][0] = 0.11
    card_path.write_text(json.dumps(card, separators=(",", ":")), encoding="utf-8")
    _refresh_card_manifest(root)

    with pytest.raises(ParameterSemanticsError, match="lattice"):
        load_parameter_cards(root)


def test_loader_rejects_unregistered_runtime_probe(tmp_path) -> None:
    root = tmp_path / "cards"
    shutil.copytree(CARD_ROOT, root)
    card_path = root / "place.target_density.json"
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
        cwd=AGENT_ROOT,
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
        [
            sys.executable,
            "-c",
            "from ecos_agent.optimization.parameters.semantics import load_parameter_cards; assert len(load_parameter_cards()) == 7",
        ],
        cwd=tmp_path,
        env=env,
        check=False,
        capture_output=True,
        text=True,
    )
    assert result.returncode == 0, result.stderr
