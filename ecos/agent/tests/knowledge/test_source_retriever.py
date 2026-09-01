import hashlib
from pathlib import Path

import pytest

from ecos_agent.knowledge.contracts import SourceSearchProposal
from ecos_agent.knowledge.source import SourceCodeRetriever


def _proposal(*queries: dict[str, str]) -> SourceSearchProposal:
    return SourceSearchProposal.model_validate(
        {
            "schema_version": "flow-agent.source_search_proposal.v1",
            "queries": list(queries),
            "rationale": "Need source-level implementation evidence.",
        }
    )


def test_retriever_returns_literal_query_evidence_with_file_hash(tmp_path: Path) -> None:
    source = tmp_path / "ecc" / "engine.py"
    source.parent.mkdir()
    source.write_text("def route():\n    needle = 'route evidence'\n", encoding="utf-8")
    retriever = SourceCodeRetriever(tmp_path)

    result = retriever.retrieve(_proposal({"root_id": "ecc", "query": "needle ="}))

    evidence = result.contract()["evidence"]
    assert evidence == [
        {
            "evidence_id": "source-1",
            "file_sha256": hashlib.sha256(source.read_bytes()).hexdigest(),
            "line_end": 2,
            "line_start": 1,
            "path": "ecc/engine.py",
            "root_id": "ecc",
            "snippet_sha256": hashlib.sha256(source.read_bytes()).hexdigest(),
            "text": "def route():\n    needle = 'route evidence'\n",
        }
    ]
    assert result.contract()["queries"] == [{"root_id": "ecc", "query": "needle ="}]


def test_retriever_returns_bounded_context_for_an_algorithm_match(tmp_path: Path) -> None:
    source = tmp_path / "ecc" / "engine.py"
    source.parent.mkdir()
    source.write_text(
        "def solve():\n"
        "    initialize()\n"
        "    relax()\n"
        "    target = cost()\n"
        "    update_primal(target)\n"
        "    update_dual()\n"
        "    commit()\n"
        "    finalize()\n"
        "    return target\n",
        encoding="utf-8",
    )

    result = SourceCodeRetriever(tmp_path).retrieve(
        _proposal({"root_id": "ecc", "query": "target = cost()"})
    )

    evidence = result.evidence[0]
    assert evidence.line_start == 1
    assert evidence.line_end == 8
    assert "initialize()" in evidence.text
    assert "finalize()" in evidence.text


def test_retriever_excludes_symlinks_and_sensitive_files(tmp_path: Path) -> None:
    root = tmp_path / "ecos"
    root.mkdir()
    (root / "safe.py").write_text("needle = 'safe'\n", encoding="utf-8")
    (root / ".env").write_text("needle = 'secret'\n", encoding="utf-8")
    outside = tmp_path / "outside.py"
    outside.write_text("needle = 'outside'\n", encoding="utf-8")
    (root / "escape.py").symlink_to(outside)
    retriever = SourceCodeRetriever(tmp_path)

    result = retriever.retrieve(_proposal({"root_id": "ecos", "query": "needle"}))

    assert [item["path"] for item in result.contract()["evidence"]] == ["ecos/safe.py"]


def test_retriever_treats_shell_characters_as_literal_query_text(tmp_path: Path) -> None:
    source = tmp_path / "ecc" / "engine.py"
    source.parent.mkdir()
    source.write_text("needle = 'safe'\n", encoding="utf-8")
    marker = tmp_path / "marker"
    retriever = SourceCodeRetriever(tmp_path)

    result = retriever.retrieve(
        _proposal({"root_id": "ecc", "query": f"needle; touch {marker}"})
    )

    assert result.evidence == ()
    assert not marker.exists()


def test_retriever_caps_evidence_at_twelve_items(tmp_path: Path) -> None:
    root = tmp_path / "ecc"
    root.mkdir()
    for index in range(13):
        (root / f"engine_{index}.py").write_text("needle = True\n", encoding="utf-8")

    result = SourceCodeRetriever(tmp_path).retrieve(_proposal({"root_id": "ecc", "query": "needle"}))

    assert len(result.evidence) == 12
    assert result.result_limit_reached is True


@pytest.mark.parametrize(
    "payload",
    [
        {"root_id": "outside", "query": "needle"},
        {"root_id": "ecc", "query": "one\ntwo"},
    ],
)
def test_source_search_proposal_rejects_invalid_queries(payload: dict[str, str]) -> None:
    with pytest.raises(ValueError, match="source search"):
        _proposal(payload)


def test_source_search_proposal_rejects_duplicate_queries() -> None:
    with pytest.raises(ValueError, match="duplicate"):
        _proposal(
            {"root_id": "ecc", "query": "needle"},
            {"root_id": "ecc", "query": "needle"},
        )


def test_source_search_proposal_rejects_more_than_five_queries() -> None:
    with pytest.raises(ValueError, match="too many"):
        _proposal(*({"root_id": "ecc", "query": f"needle-{index}"} for index in range(6)))
