from __future__ import annotations

import json
import subprocess
from pathlib import Path


AGENT_ROOT = Path(__file__).parents[1]


def _evaluate(tmp_path: Path, config: dict[str, object]) -> dict[str, object]:
    config_path = tmp_path / "retrieval-config.json"
    output_path = tmp_path / "evaluation.json"
    config_path.write_text(json.dumps(config), encoding="utf-8")
    completed = subprocess.run(
        [
            "uv",
            "run",
            "python",
            "scripts/evaluate_knowledge_retrieval.py",
            "--config",
            str(config_path),
            "--provider-binary",
            str(AGENT_ROOT / "dist" / "ecos-agent"),
            "--output",
            str(output_path),
        ],
        cwd=AGENT_ROOT,
        capture_output=True,
        text=True,
    )
    assert completed.returncode == 0, completed.stderr
    return json.loads(output_path.read_text(encoding="utf-8"))


def test_headless_evaluation_audits_frozen_retrieval_and_packaged_fallback(tmp_path: Path) -> None:
    payload = _evaluate(
        tmp_path,
        {
            "schema_version": "ecos-frozen-knowledge-retrieval-config.v1",
            "top_k": 3,
            "field_weights": [10.0, 20.0, 10.0, 1.0],
        },
    )

    assert payload["schema_version"] == "ecos-knowledge-retrieval-evaluation.v2"
    frozen = payload["frozen_config"]
    assert frozen["top_k"] == 3
    assert frozen["field_weights"] == {
        "stage": 10.0,
        "identifier": 20.0,
        "reserved": 10.0,
        "content": 1.0,
    }
    test = payload["results"]["test"]["3"]
    assert {"language", "category", "stage"} <= set(test["breakdowns"])
    assert "required_evidence" in test["failures"]
    assert test["quality"]["required_evidence_all_recall"] >= 0.0
    assert test["quality"]["grounding_pass_rate"] == 1.0
    assert test["quality"]["attribution_pass_rate"] == 1.0
    assert test["quality"]["audited_fallback_pass_rate"] == 1.0

    runtime = payload["headless_runtime"]
    assert runtime["provider_startup_ms"] >= 0.0
    assert runtime["peak_bytes"] > 0
    assert runtime["binary"]["size_bytes"] > 0
    assert runtime["network"]["connect_calls"] == 0
    assert runtime["protocol"]["fts5"] is True
    assert runtime["protocol"]["codex_fallback"] is True
    assert runtime["replay_trace"]["contracts_identical"] is True


def test_headless_evaluation_rejects_invalid_frozen_config_types(tmp_path: Path) -> None:
    config_path = tmp_path / "invalid-config.json"
    config_path.write_text(
        json.dumps(
            {
                "schema_version": "ecos-frozen-knowledge-retrieval-config.v1",
                "allow_metadata_match": "true",
            }
        ),
        encoding="utf-8",
    )

    completed = subprocess.run(
        ["uv", "run", "python", "scripts/evaluate_knowledge_retrieval.py", "--config", str(config_path)],
        cwd=AGENT_ROOT,
        capture_output=True,
        text=True,
    )

    assert completed.returncode != 0
    assert "allow_metadata_match" in completed.stderr


def test_dev_config_selection_never_evaluates_test_cases(tmp_path: Path) -> None:
    configs = []
    for min_token_overlap in (2, 3):
        path = tmp_path / f"overlap-{min_token_overlap}.json"
        path.write_text(
            json.dumps(
                {
                    "schema_version": "ecos-frozen-knowledge-retrieval-config.v1",
                    "field_weights": [6.0, 12.0, 0.0, 6.0],
                    "min_token_overlap": min_token_overlap,
                }
            ),
            encoding="utf-8",
        )
        configs.append(path)
    output = tmp_path / "selection.json"

    subprocess.run(
        [
            "uv",
            "run",
            "python",
            "scripts/evaluate_knowledge_retrieval.py",
            "--select-dev-config",
            "--config",
            *(str(path) for path in configs),
            "--output",
            str(output),
        ],
        cwd=AGENT_ROOT,
        check=True,
        capture_output=True,
        text=True,
    )
    selection = json.loads(output.read_text(encoding="utf-8"))["dev_config_selection"]

    assert selection["evaluation_split"] == "dev"
    assert len(selection["candidates"]) == 2
    assert selection["test_cases_evaluated"] == 0
    assert selection["no_answer_fpr_limit"] == 0.05
    assert any(candidate["eligible"] for candidate in selection["candidates"])
    assert selection["selected"] is not None
    assert json.loads(selection["selected"]["frozen_config_json"])["min_token_overlap"] == 3
