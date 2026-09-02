from __future__ import annotations

import json
import threading
from pathlib import Path
from typing import Any

import pytest

import ecos_agent.optimization.experiments.parameter_gap_resume as gap_resume
import ecos_agent.optimization.experiments.parameter_gap_runner as gap_runner
import ecos_agent.optimization.experiments.parameter_gap_setup as gap_setup
from ecos_agent.hashing import canonical_sha256
from ecos_agent.optimization.contracts import OptimizationKnob
from ecos_agent.optimization.experiments.parameter_gap import (
    ProbeResult,
    classify_receipt,
    semantic_application_signature,
    semantic_response_signature,
    summarize_knob,
)
from ecos_agent.optimization.experiments.parameter_gap_runner import (
    overall_verdict,
    screen_values,
)
from ecos_agent.optimization.parameters.contracts import (
    ActivationEvidence,
    ConsumerEvidence,
    EffectiveValue,
    MaterializationRef,
    ParameterApplicationReceipt,
    RuntimeTransition,
    ToolRef,
)
from ecos_agent.optimization.parameters.semantics import load_parameter_cards

HASH = "sha256:" + "a" * 64


def _receipt(
    knob_id: str,
    requested: bool | int | float,
    *,
    written: bool | int | float | None = None,
    effective: bool | int | float | None = None,
    final: bool | int | float | None = None,
    activation: str = "used",
    transition: str | None = None,
    rule_id: str | None = None,
    receipt_id: str = "receipt-1",
    evidence_ref: str = "analysis/report-1.json",
    observation: dict[str, Any] | None = None,
) -> ParameterApplicationReceipt:
    card = load_parameter_cards()[OptimizationKnob(knob_id)]
    written = requested if written is None else written
    effective = written if effective is None else effective
    final = effective if final is None else final
    consumer = card.consumers[0]
    consumer_evidence = ConsumerEvidence(
        consumer_id=consumer.consumer_id,
        outcome=consumer.event if activation == "used" else "evaluated",
        evidence_ref=evidence_ref,
        evidence_sha256=HASH,
    )
    transitions = (
        RuntimeTransition(
            sequence=0,
            **{"from": "materialized"},
            to=transition,
            value=effective,
            reason="tool admission",
            rule_id=rule_id,
            evidence_ref=evidence_ref,
            evidence_sha256=HASH,
        ),
    ) if transition else ()
    payload = {
        "receipt_id": receipt_id,
        "tool": ToolRef(
            name=card.tool.name,
            revision=card.tool.revision,
            source_sha256=card.tool.source_sha256,
        ),
        "context": {"stage": card.stage, "context_sha256": HASH},
        "requested": {
            "knob_id": knob_id,
            "value": requested,
            "unit": card.surface.unit,
        },
        "materialization": MaterializationRef(
            receipt_ref="analysis/materialization.json",
            receipt_sha256=HASH,
            registry_sha256=HASH,
            patch_sha256=HASH,
            candidate_ref="candidate-1",
            workspace_ref="workspace",
            config_before_sha256=HASH,
            config_after_sha256="sha256:" + "b" * 64,
            written_value=written,
            unit="dbu" if knob_id == "place.cell_padding_x" else card.surface.unit,
        ),
        "effective_initial": EffectiveValue(
            value=effective,
            unit="dbu" if knob_id == "place.cell_padding_x" else card.surface.unit,
        ),
        "transitions": transitions,
        "application_status": "applied",
        "activation": ActivationEvidence(
            status=activation,
            consumers=(consumer_evidence,),
        ),
        "consumer_observation": observation or {"iterations": 7},
        "effective_final": EffectiveValue(
            value=final,
            unit="dbu" if knob_id == "place.cell_padding_x" else card.surface.unit,
        ),
    }
    draft = ParameterApplicationReceipt.model_construct(**payload, evidence_sha256=HASH)
    return ParameterApplicationReceipt(
        **payload,
        evidence_sha256=canonical_sha256(
            draft.model_dump(mode="json", exclude={"evidence_sha256"})
        ),
    )


def _result(
    candidate_id: str,
    receipt: ParameterApplicationReceipt | None,
    *,
    terminal_closed: bool = True,
    error: str | None = None,
) -> ProbeResult:
    return ProbeResult.from_receipt(
        candidate_id=candidate_id,
        requested_value=receipt.requested["value"] if receipt else 0.2,
        receipt=receipt,
        terminal_closed=terminal_closed,
        runtime_seconds=1.0,
        error=error,
        site_width_dbu=200,
    )


def test_padding_unit_mapping_alone_is_not_a_gap() -> None:
    receipt = _receipt("place.cell_padding_x", 2, written=400, effective=400)

    assert classify_receipt(receipt, site_width_dbu=200) == ("mapping_only",)


def test_adoption_and_activation_gaps_are_distinct() -> None:
    receipt = _receipt(
        "place.target_density",
        0.2,
        effective=0.8,
        activation="not_activated",
        transition="overridden",
        rule_id="dreamplace.target_density.utilization_floor",
    )

    assert classify_receipt(receipt, site_width_dbu=200) == (
        "adoption_gap",
        "activation_gap",
    )


def test_semantic_signatures_ignore_request_and_evidence_identity() -> None:
    left = _receipt(
        "place.target_density",
        0.1,
        effective=0.8,
        transition="overridden",
        rule_id="dreamplace.target_density.utilization_floor",
        receipt_id="receipt-left",
        evidence_ref="analysis/left.json",
    )
    right = _receipt(
        "place.target_density",
        0.2,
        effective=0.8,
        transition="overridden",
        rule_id="dreamplace.target_density.utilization_floor",
        receipt_id="receipt-right",
        evidence_ref="analysis/right.json",
    )

    assert semantic_application_signature(left) == semantic_application_signature(right)
    assert semantic_response_signature(left) == semantic_response_signature(right)


def test_gap_requires_two_of_three_terminal_closed_repeats() -> None:
    gap = _receipt(
        "place.target_density",
        0.2,
        effective=0.8,
        transition="overridden",
        rule_id="dreamplace.target_density.utilization_floor",
    )
    direct = _receipt("place.target_density", 0.2)

    confirmed = summarize_knob(
        OptimizationKnob.TARGET_DENSITY,
        (_result("a", gap), _result("b", gap), _result("c", direct)),
    )
    unconfirmed = summarize_knob(
        OptimizationKnob.TARGET_DENSITY,
        (_result("a", gap), _result("b", direct), _result("c", direct)),
    )

    assert confirmed.verdict == "gap_confirmed"
    assert confirmed.confirmed_gap_kinds == ("adoption_gap",)
    assert unconfirmed.verdict == "gap_unconfirmed"


def test_missing_terminal_or_failed_probe_makes_negative_result_indeterminate() -> None:
    direct = _receipt("cts.max_fanout", 32)
    report = summarize_knob(
        OptimizationKnob.CTS_MAX_FANOUT,
        (
            _result("ok", direct),
            _result("missing-terminal", direct, terminal_closed=False),
            _result("failed", None, terminal_closed=False, error="timeout"),
        ),
        lattice_complete=True,
    )

    assert report.verdict == "indeterminate"
    assert report.failed_candidates == ("failed",)


def test_typed_alias_requires_distinct_requests_and_card_rule() -> None:
    left = _receipt(
        "place.target_density",
        0.1,
        effective=0.8,
        transition="overridden",
        rule_id="dreamplace.target_density.utilization_floor",
    )
    right = _receipt(
        "place.target_density",
        0.2,
        effective=0.8,
        transition="overridden",
        rule_id="dreamplace.target_density.utilization_floor",
    )
    report = summarize_knob(
        OptimizationKnob.TARGET_DENSITY,
        (_result("left", left), _result("right", right)),
    )

    assert report.typed_alias_groups == ((0.1, 0.2),)


def test_screen_values_use_boundaries_and_neighbors_without_noop() -> None:
    cards = load_parameter_cards()

    assert screen_values(cards[OptimizationKnob.TARGET_DENSITY], 0.5) == (
        0.1,
        0.45,
        0.55,
        0.95,
    )
    assert screen_values(cards[OptimizationKnob.ROUTABILITY_OPT], True) == (False,)


def test_ecc_readiness_checks_runtime_version_separately(monkeypatch, tmp_path) -> None:
    executable = tmp_path / "ecc"
    executable.write_bytes(b"ecc")
    config = gap_setup.ParameterGapConfig.model_construct(
        expected_ecc_revision="e" * 40,
        expected_ecc_runtime_version="0.1.0-alpha.11",
        expected_ecc_executable_sha256=HASH,
    )

    class FakeClient:
        def __init__(self, *_args, **_kwargs) -> None:
            pass

        def ecc_revision(self) -> str:
            return "0.1.0-alpha.11"

        def close(self) -> None:
            pass

    monkeypatch.setattr(gap_setup, "_ecc_executable", lambda: executable)
    monkeypatch.setattr(gap_setup, "file_sha256", lambda _path: HASH)
    monkeypatch.setattr(gap_setup, "EccContentLengthRpcClient", FakeClient)

    report = gap_setup._ecc_readiness(config)

    assert report["ecc_runtime_version"] == "0.1.0-alpha.11"


def test_resume_readiness_rejects_source_config_hash_drift(monkeypatch, tmp_path) -> None:
    config_path = tmp_path / "config.json"
    config_path.write_text("{}\n", encoding="utf-8")
    resume = gap_setup.ParameterGapResumeConfig.model_construct(
        source_config_sha256=HASH,
    )
    monkeypatch.setattr(
        gap_setup, "load_parameter_gap_config", lambda _path: object()
    )
    monkeypatch.setattr(
        gap_setup, "load_parameter_gap_resume_config", lambda _path: resume
    )
    monkeypatch.setattr(gap_setup, "file_sha256", lambda _path: "sha256:" + "b" * 64)

    with pytest.raises(gap_setup.ParameterGapError, match="source parameter gap config"):
        gap_setup.resume_readiness_report(config_path, Path("resume.json"))


def test_overall_verdict_has_only_preregistered_outcomes() -> None:
    direct = _receipt("cts.max_fanout", 32)
    no_gap = summarize_knob(
        OptimizationKnob.CTS_MAX_FANOUT,
        (_result("ok", direct),),
        lattice_complete=True,
    )
    uncertain = summarize_knob(
        OptimizationKnob.CTS_MAX_FANOUT,
        (_result("ok", direct),),
    )
    gap_receipt = _receipt(
        "place.target_density",
        0.2,
        effective=0.8,
        transition="overridden",
        rule_id="dreamplace.target_density.utilization_floor",
    )
    gap = summarize_knob(
        OptimizationKnob.TARGET_DENSITY,
        tuple(_result(str(index), gap_receipt) for index in range(3)),
    )

    assert overall_verdict((no_gap,)) == "no_gap_observed_on_gcd_at_fixed_context"
    assert overall_verdict((uncertain,)) == "indeterminate"
    assert overall_verdict((no_gap, gap)) == "gap_confirmed_on_gcd"


def test_gap_screen_repeats_positive_probe_then_skips_expansion(
    monkeypatch, tmp_path
) -> None:
    requested: list[float] = []

    def fake_execute(*args, **_kwargs):
        value = args[5]
        requested.append(value)
        receipt = (
            _receipt(
                "place.target_density",
                value,
                effective=0.8,
                transition="overridden",
                rule_id="dreamplace.target_density.utilization_floor",
            )
            if value == 0.1
            else _receipt("place.target_density", value)
        )
        return _result(f"candidate-{len(requested)}", receipt)

    monkeypatch.setattr(gap_runner, "_execute_probe", fake_execute)
    card = load_parameter_cards()[OptimizationKnob.TARGET_DENSITY]

    results, summary, sequence = gap_runner._run_knob(
        None,
        {},
        tmp_path,
        None,
        OptimizationKnob.TARGET_DENSITY,
        card,
        0.5,
        0,
        tmp_path,
    )

    assert requested == [0.1, 0.1, 0.1, 0.45, 0.55, 0.95]
    assert len(results) == sequence == 6
    assert summary.verdict == "gap_confirmed"
    assert summary.lattice_complete is False


def test_parent_candidate_ref_comes_from_recorded_evidence(tmp_path) -> None:
    candidate = "rq1-place-routability_opt-116"
    evidence = tmp_path / "probes" / candidate / "candidate-evidence.v1.json"
    evidence.parent.mkdir(parents=True)
    evidence.write_text(
        json.dumps(
            {
                "candidate_root_ref": (
                    ".agent/candidates/candidate-0123456789abcdef-"
                    "rq1-place-routability_opt-116"
                )
            }
        ),
        encoding="utf-8",
    )

    assert gap_runner._read_candidate_root_ref(tmp_path, candidate) == (
        ".agent/candidates/candidate-0123456789abcdef-rq1-place-routability_opt-116"
    )


def test_resume_finds_materialized_workspace_from_recorded_evidence(tmp_path) -> None:
    candidate_ref = ".agent/candidates/candidate-0123456789abcdef-rq1-place-density-001"
    workspace = tmp_path / "workspace"
    materialization = workspace / candidate_ref / "analysis/candidate_materialization.v1.json"
    materialization.parent.mkdir(parents=True)
    materialization.write_text("{}\n", encoding="utf-8")
    source_probe = tmp_path / "source-probe"
    source_probe.mkdir()
    (source_probe / "candidate-evidence.v1.json").write_text(
        json.dumps({"candidate_root_ref": candidate_ref}), encoding="utf-8"
    )

    assert gap_resume._has_resumable_workspace(workspace, source_probe) is True


def test_resume_reuses_completed_smoke_result(tmp_path) -> None:
    result = _result("candidate-001", _receipt("place.target_density", 0.6))
    path = tmp_path / "probes/candidate-001/probe-result.v1.json"
    path.parent.mkdir(parents=True)
    path.write_text(json.dumps(result.to_dict()), encoding="utf-8")

    assert gap_resume._completed_resume_result(tmp_path, "candidate-001") == result


def test_resume_archives_failed_attempt_before_retry(tmp_path) -> None:
    output = tmp_path / "probes/candidate-001"
    output.mkdir(parents=True)
    (output / "failure.v1.json").write_text("{}\n", encoding="utf-8")

    gap_resume._archive_failed_probe_output(tmp_path, output, "candidate-001")

    assert not output.exists()
    assert (tmp_path / "attempts/candidate-001/attempt-001/failure.v1.json").is_file()


def test_resume_config_bounds_parallel_workers() -> None:
    payload = {
        "schema_version": "ecos.rq1_parameter_gap_resume_config.v1",
        "source_run_id": "source-run",
        "resume_id": "parallel-resume",
        "previous_resume_id": "serial-resume",
        "expected_previous_manifest_sha256": HASH,
        "source_config_sha256": HASH,
        "expected_ecos_revision": "a" * 40,
        "expected_ecc_revision": "b" * 40,
        "expected_ecc_runtime_version": "0.1.0-alpha.11",
        "expected_pdk_revision": "c" * 40,
        "expected_ecc_executable_sha256": HASH,
        "pdk_root": "../../pdk",
        "reason": "bounded_parallel_resume",
        "max_workers": 4,
    }

    resume = gap_setup.ParameterGapResumeConfig.model_validate(payload)

    assert resume.max_workers == 4
    assert resume.previous_resume_id == "serial-resume"
    assert resume.expected_previous_manifest_sha256 == HASH
    with pytest.raises(ValueError):
        gap_setup.ParameterGapResumeConfig.model_validate({**payload, "max_workers": 5})
    with pytest.raises(ValueError, match="must be paired"):
        gap_setup.ParameterGapResumeConfig.model_validate(
            {**payload, "expected_previous_manifest_sha256": None}
        )


def test_resume_lock_rejects_duplicate_driver(tmp_path) -> None:
    resume_root = tmp_path / "resumes/parallel-resume"

    with gap_resume._exclusive_resume_lock(resume_root):
        with pytest.raises(gap_setup.ParameterGapError, match="already running"):
            with gap_resume._exclusive_resume_lock(resume_root):
                pass


def test_resume_rejects_symlinked_resume_root(tmp_path) -> None:
    target = tmp_path / "target"
    target.mkdir()
    resume_root = tmp_path / "resume"
    resume_root.symlink_to(target, target_is_directory=True)

    resume = gap_setup.ParameterGapResumeConfig.model_construct(
        source_run_id="source-run",
        resume_id="resume",
        reason="bounded_parallel_resume",
    )

    with pytest.raises(gap_setup.ParameterGapError, match="directory is invalid"):
        gap_resume._prepare_resume_root(
            resume_root,
            resume,
            {},
            tmp_path,
            {"candidate_count": 0},
            frozenset(),
        )


def test_resume_runs_independent_candidates_in_parallel(monkeypatch, tmp_path) -> None:
    receipts = tuple(
        _result(f"candidate-{index:03d}", _receipt("place.target_density", 0.6))
        for index in range(1, 5)
    )
    barrier = threading.Barrier(2)

    def fake_resume(*args, **_kwargs):
        barrier.wait(timeout=1)
        return args[6]

    monkeypatch.setattr(gap_resume, "_resume_or_preserve_probe", fake_resume)
    results = gap_resume._resume_results(
        object(),
        {},
        tmp_path,
        tmp_path / "resume",
        object(),
        {"place.target_density": 0.5},
        receipts,
        {
            "knobs": [
                {"knob_id": "place.target_density", "candidate_count": len(receipts)}
            ]
        },
        None,
        max_workers=4,
    )

    assert results == receipts


def test_resume_keeps_routability_parent_dependency_serial(monkeypatch, tmp_path) -> None:
    receipts = tuple(
        _result(
            f"candidate-{index:03d}",
            _receipt("place.routability_opt", value),
        )
        for index, value in ((116, False), (117, True))
    )
    seen: list[str] = []

    def fake_resume(*args, **_kwargs):
        result = args[6]
        if seen:
            assert args[9][-1].candidate_id == seen[-1]
        seen.append(result.candidate_id)
        return result

    monkeypatch.setattr(gap_resume, "_resume_or_preserve_probe", fake_resume)
    results = gap_resume._resume_results(
        object(),
        {},
        tmp_path,
        tmp_path / "resume",
        object(),
        {"place.routability_opt": True},
        receipts,
        {
            "knobs": [
                {"knob_id": "place.routability_opt", "candidate_count": 2}
            ]
        },
        None,
        max_workers=4,
    )

    assert results == receipts
    assert seen == ["candidate-116", "candidate-117"]


def test_resume_imports_only_terminal_closed_probe_artifacts(tmp_path) -> None:
    run_root = tmp_path / "run"
    previous_root = run_root / "resumes/serial-resume"
    manifest = previous_root / "resume-manifest.v1.json"
    manifest.parent.mkdir(parents=True)
    manifest.write_text(
        json.dumps(
            {
                "schema_version": "ecos.rq1_parameter_gap_resume_run.v1",
                "source_run_id": "source-run",
                "resume_id": "serial-resume",
                "source_report_sha256": HASH,
                "readiness": {"source_config_sha256": HASH},
            }
        ),
        encoding="utf-8",
    )
    complete = _result("candidate-001", _receipt("place.target_density", 0.6))
    incomplete = _result(
        "candidate-002",
        _receipt("place.target_density", 0.7),
        terminal_closed=False,
    )
    for result in (complete, incomplete):
        path = previous_root / "probes" / result.candidate_id / "probe-result.v1.json"
        path.parent.mkdir(parents=True)
        path.write_text(json.dumps(result.to_dict()), encoding="utf-8")
    resume = gap_setup.ParameterGapResumeConfig.model_construct(
        source_run_id="source-run",
        resume_id="parallel-resume",
        previous_resume_id="serial-resume",
        expected_previous_manifest_sha256=gap_setup.file_sha256(manifest),
        source_config_sha256=HASH,
    )

    imported = gap_resume._import_previous_resume(
        run_root,
        run_root / "resumes/parallel-resume",
        resume,
        HASH,
        frozenset({"candidate-001", "candidate-002"}),
    )

    assert set(imported["candidate_artifact_sha256"]) == {"candidate-001"}
    assert (
        run_root
        / "resumes/parallel-resume/probes/candidate-001/probe-result.v1.json"
    ).is_file()
    assert not (run_root / "resumes/parallel-resume/probes/candidate-002").exists()


def test_resume_requires_import_binding_when_previous_resume_is_configured(
    tmp_path,
) -> None:
    with pytest.raises(gap_setup.ParameterGapError, match="binding is missing"):
        gap_resume._verify_imported_resume(tmp_path, None, required=True)


def test_resume_import_rejects_symlinked_probe_artifact(tmp_path) -> None:
    previous_root = tmp_path / "previous"
    probe = previous_root / "probes/candidate-001"
    probe.mkdir(parents=True)
    result = _result("candidate-001", _receipt("place.target_density", 0.6))
    (probe / "probe-result.v1.json").write_text(
        json.dumps(result.to_dict()), encoding="utf-8"
    )
    (probe / "unsafe").symlink_to(tmp_path / "outside")

    with pytest.raises(gap_setup.ParameterGapError, match="unsafe"):
        gap_resume._copy_completed_probes(
            previous_root,
            tmp_path / "resume",
            frozenset({"candidate-001"}),
        )


def test_resume_import_rejects_existing_destination(tmp_path) -> None:
    previous_root = tmp_path / "previous"
    probe = previous_root / "probes/candidate-001"
    probe.mkdir(parents=True)
    result = _result("candidate-001", _receipt("place.target_density", 0.6))
    (probe / "probe-result.v1.json").write_text(
        json.dumps(result.to_dict()), encoding="utf-8"
    )
    destination = tmp_path / "resume/probes/candidate-001"
    destination.mkdir(parents=True)

    with pytest.raises(gap_setup.ParameterGapError, match="already exists"):
        gap_resume._copy_completed_probes(
            previous_root,
            tmp_path / "resume",
            frozenset({"candidate-001"}),
        )
