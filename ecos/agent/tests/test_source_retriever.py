import hashlib
from pathlib import Path

import pytest

from ecos_agent.contracts import SourceSearchProposal
from ecos_agent.source_retriever import SourceCodeRetriever


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
