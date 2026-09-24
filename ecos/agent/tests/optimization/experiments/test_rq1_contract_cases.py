import json

from ecos_agent.optimization.experiments.rq1_contract_cases import (
    run_tier_a_cases,
    write_contract_case_artifacts,
)
from ecos_agent.optimization.experiments.rq1_execution_evidence_reporting import (
    TIER_A_CASE_NAMES,
    build_case_matrix,
)


def test_tier_a_matrix_meets_g2_acceptance() -> None:
    matrix = build_case_matrix(run_tier_a_cases())

    assert [row["case"] for row in matrix["cases"]] == list(TIER_A_CASE_NAMES)
    assert matrix["summary"] == {
        "registered": 18,
        "passed": 18,
        "failed": 0,
        "missing_tier_a_cases": [],
        "unexpected_tier_a_cases": [],
        "duplicate_tier_a_cases": [],
        "false_applied": 0,
        "false_inactive": 0,
        "false_promotion": 0,
        "promotion_invariant_violations": 0,
        "fail_closed_passed": 4,
        "fail_closed_total": 4,
        "fail_closed_rate": 1.0,
        "failure_accounting_conserved": True,
        "receipt_semantic_mismatch": 0,
        "complete": True,
    }

    downstream = next(
        row
        for row in matrix["cases"]
        if row["case"] == "downstream execution failure after application"
    )
    assert downstream["observed"]["status"] == "applied"
    assert downstream["observed"]["execution_outcome"] == "execution_failed"
    assert downstream["metrics"]["false_applied"] == 0


def test_tier_a_duplicate_requested_and_consumed_are_distinct() -> None:
    matrix = build_case_matrix(run_tier_a_cases())
    cases = {row["case"]: row for row in matrix["cases"]}

    assert cases["duplicate requested"]["observed"]["control"] == {
        "native_duplicate": False,
        "shadow_duplicate": False,
    }
    assert cases["duplicate consumed"]["observed"]["control"] == {
        "native_duplicate": True,
        "shadow_duplicate": True,
    }
    assert cases["tampered hash"]["observed"]["control"] == {
        "receipt_hash_rejected": True,
        "ledger_hash_rejected": True,
        "audit_hash_rejected": True,
    }


def test_tier_a_artifacts_are_generated_from_cases(tmp_path) -> None:
    output_dir = tmp_path / "contract-cases"
    matrix = write_contract_case_artifacts(output_dir)

    assert matrix["summary"]["complete"] is True
    stored = json.loads(
        (output_dir / "rq1-contract-case-matrix.v1.json").read_text(
            encoding="utf-8"
        )
    )
    assert stored == matrix
    markdown = (
        output_dir / "rq1-contract-case-matrix.v1.md"
    ).read_text(encoding="utf-8")
    assert "| exact mapping | yes | fixture-only |" in markdown
    assert "Expected roles" in markdown
    assert '"consumed":{"present":true' in markdown
    for row in matrix["cases"]:
        for reference in row["evidence_refs"]:
            assert (tmp_path / reference).is_file()
