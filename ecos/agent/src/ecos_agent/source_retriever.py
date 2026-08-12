"""Bounded local source-code retrieval for ECOS Agent chat answers."""

from __future__ import annotations

import hashlib
import json
import os
from dataclasses import dataclass
from pathlib import Path

from ecos_agent.contracts import SOURCE_ROOT_IDS, SourceSearchProposal


_SOURCE_SUFFIXES = frozenset(
    {
        ".c",
        ".cc",
        ".cmake",
        ".cpp",
        ".cxx",
        ".h",
        ".hh",
        ".hpp",
        ".hxx",
        ".i",
        ".json",
        ".js",
        ".lef",
        ".lib",
        ".md",
        ".py",
        ".sdc",
        ".sh",
        ".sv",
        ".tcl",
        ".tlef",
        ".ts",
        ".tsx",
        ".v",
        ".vh",
        ".vue",
        ".yaml",
        ".yml",
    }
)
_SOURCE_FILENAMES = frozenset({"CMakeLists.txt", "Makefile"})
_SKIPPED_DIRECTORIES = frozenset(
    {".codegraph", ".git", ".pytest_cache", ".venv", "__pycache__", "build", "dist", "node_modules", "out"}
)
_SENSITIVE_SUFFIXES = frozenset({".cer", ".crt", ".der", ".key", ".p12", ".pem"})
_MAX_EVIDENCE = 12
_MAX_FILE_BYTES = 1_000_000
_CONTEXT_LINES = 4


@dataclass(frozen=True)
class SourceEvidence:
    evidence_id: str
    root_id: str
    path: str
    line_start: int
    line_end: int
    text: str
    file_sha256: str
    snippet_sha256: str

    def contract(self) -> dict[str, object]:
        return {
            "evidence_id": self.evidence_id,
            "file_sha256": self.file_sha256,
            "line_end": self.line_end,
            "line_start": self.line_start,
            "path": self.path,
            "root_id": self.root_id,
            "snippet_sha256": self.snippet_sha256,
            "text": self.text,
        }


@dataclass(frozen=True)
class SourceSearchResult:
    proposal_sha256: str
    queries: tuple[dict[str, str], ...]
    available_root_ids: tuple[str, ...]
    unavailable_root_ids: tuple[str, ...]
    evidence: tuple[SourceEvidence, ...]
    result_limit_reached: bool

    def contract(self) -> dict[str, object]:
        return {
            "schema_version": "ecos-source-code-evidence.v1",
            "read_only": True,
            "backend": "local_literal_source_search.v1",
            "available_root_ids": list(self.available_root_ids),
            "unavailable_root_ids": list(self.unavailable_root_ids),
            "queries": list(self.queries),
            "proposal_sha256": self.proposal_sha256,
            "evidence": [item.contract() for item in self.evidence],
            "result_limit_reached": self.result_limit_reached,
        }


class SourceCodeRetriever:
    """Search literal text in approved source roots without invoking a shell."""

    def __init__(self, repository_root: Path | None = None) -> None:
        root = repository_root.resolve() if repository_root is not None else _discover_repository_root()
        self._repository_root = root
        self._roots = _source_roots(root) if root is not None else {}

    @property
    def available_root_ids(self) -> tuple[str, ...]:
        return tuple(self._roots)

    @property
    def source_workspace_roots(self) -> tuple[Path, ...]:
        return tuple(self._roots.values())

    def retrieve(self, proposal: SourceSearchProposal) -> SourceSearchResult:
        evidence: list[SourceEvidence] = []
        unavailable: list[str] = []
        result_limit_reached = False
        for query in proposal.queries:
            root = self._roots.get(query.root_id)
            if root is None:
                unavailable.append(query.root_id)
                continue
            for path in _source_files(root):
                match = _match_file(path, query.query)
                if match is None:
                    continue
                snippet, line_start, line_end, file_sha256 = match
                evidence.append(
                    SourceEvidence(
                        evidence_id=f"source-{len(evidence) + 1}",
                        root_id=query.root_id,
                        path=path.relative_to(self._repository_root).as_posix(),
                        line_start=line_start,
                        line_end=line_end,
                        text=snippet,
                        file_sha256=file_sha256,
                        snippet_sha256=_sha256(snippet.encode("utf-8")),
                    )
                )
                if len(evidence) == _MAX_EVIDENCE:
                    result_limit_reached = True
                    break
            if result_limit_reached:
                break
        return SourceSearchResult(
            proposal_sha256=_proposal_sha256(proposal),
            queries=tuple(query.model_dump(mode="json") for query in proposal.queries),
            available_root_ids=self.available_root_ids,
            unavailable_root_ids=tuple(dict.fromkeys(unavailable)),
            evidence=tuple(evidence),
            result_limit_reached=result_limit_reached,
        )


def _discover_repository_root() -> Path | None:
    candidates = (Path.cwd().resolve(), *Path(__file__).resolve().parents)
    for candidate in candidates:
        if (candidate / "ecos").is_dir() and (candidate / "ecc").is_dir():
            return candidate
    return None


def _source_roots(repository_root: Path) -> dict[str, Path]:
    roots: dict[str, Path] = {}
    for root_id in SOURCE_ROOT_IDS:
        candidate = repository_root / root_id
        if candidate.is_dir() and not candidate.is_symlink():
            roots[root_id] = candidate.resolve()
    return roots


def _source_files(root: Path):
    for directory, names, filenames in os.walk(root, followlinks=False):
        base = Path(directory)
        names[:] = [
            name
            for name in sorted(names)
            if name not in _SKIPPED_DIRECTORIES and not (base / name).is_symlink()
        ]
        for name in sorted(filenames):
            path = base / name
            if _is_searchable_file(path, root):
                yield path


def _is_searchable_file(path: Path, root: Path) -> bool:
    if path.is_symlink() or path.name.startswith(".env") or path.suffix.casefold() in _SENSITIVE_SUFFIXES:
        return False
    if path.name not in _SOURCE_FILENAMES and path.suffix.casefold() not in _SOURCE_SUFFIXES:
        return False
    try:
        resolved = path.resolve(strict=True)
        return resolved.is_relative_to(root) and resolved.is_file() and resolved.stat().st_size <= _MAX_FILE_BYTES
    except OSError:
        return False


def _match_file(path: Path, query: str) -> tuple[str, int, int, str] | None:
    try:
        data = path.read_bytes()
    except OSError:
        return None
    if len(data) > _MAX_FILE_BYTES or b"\x00" in data:
        return None
    try:
        text = data.decode("utf-8")
    except UnicodeDecodeError:
        return None
    lines = text.splitlines(keepends=True)
    for index, line in enumerate(lines):
        if query not in line:
            continue
        start = max(0, index - _CONTEXT_LINES)
        end = min(len(lines), index + _CONTEXT_LINES + 1)
        return "".join(lines[start:end]), start + 1, end, _sha256(data)
    return None


def _proposal_sha256(proposal: SourceSearchProposal) -> str:
    payload = json.dumps(proposal.model_dump(mode="json"), sort_keys=True, separators=(",", ":"))
    return _sha256(payload.encode("utf-8"))


def _sha256(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()
