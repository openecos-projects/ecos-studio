"""Explicit, metadata-only public fallback for otherwise unanswered Placement questions."""

from __future__ import annotations

import hashlib
import ipaddress
import json
import os
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import urlencode, urlparse
from urllib.request import Request, urlopen


_PUBLIC_QUERY = "DREAMPlace placement target density congestion"


@dataclass(frozen=True)
class PublicKnowledgeHit:
    title: str
    url: str


def public_lookup_query(_message: str) -> str:
    """Use a fixed topic so workspace/user content can never leave the process."""
    return _PUBLIC_QUERY


def search_public_metadata(query: str) -> list[PublicKnowledgeHit]:
    if query != _PUBLIC_QUERY:
        raise ValueError("public lookup query is not authorized")
    endpoint = "https://api.crossref.org/works?" + urlencode(
        {"query": query, "rows": 3, "select": "DOI,title,URL"}
    )
    request = Request(endpoint, headers={"User-Agent": "ECOS-Placement-Knowledge/1.0"})
    with urlopen(request, timeout=10) as response:  # noqa: S310 - fixed HTTPS endpoint
        payload = json.loads(response.read().decode("utf-8"))
    items = payload.get("message", {}).get("items", [])
    return [hit for item in items if (hit := _crossref_hit(item)) is not None]


def append_knowledge_candidate(path: Path, query: str, hit: PublicKnowledgeHit) -> None:
    hit = validate_public_hit(hit)
    path.parent.mkdir(parents=True, exist_ok=True)
    candidate_id = hashlib.sha256(f"{query}\0{hit.url}".encode()).hexdigest()[:20]
    record = {
        "schema_version": "ecos-place-knowledge-candidate.v1",
        "candidate_id": candidate_id,
        "kind": "public_metadata",
        "query": query,
        "review_status": "unreviewed",
        "submission_state": "offline_review_required",
        "source": {"title": hit.title, "url": hit.url},
        "timestamp": datetime.now(timezone.utc).isoformat(),
    }
    with path.open("a", encoding="utf-8") as handle:
        handle.write(json.dumps(record, sort_keys=True) + "\n")


def default_candidate_path() -> Path:
    root = Path(os.environ.get("XDG_STATE_HOME", Path.home() / ".local" / "state"))
    return root / "ecos-agent" / "place-knowledge-candidates.jsonl"


def _crossref_hit(item: object) -> PublicKnowledgeHit | None:
    if not isinstance(item, dict):
        return None
    titles = item.get("title")
    title = titles[0] if isinstance(titles, list) and titles and isinstance(titles[0], str) else ""
    doi = item.get("DOI")
    url = f"https://doi.org/{doi}" if isinstance(doi, str) and doi else item.get("URL")
    if not isinstance(url, str) or not title:
        return None
    try:
        return validate_public_hit(PublicKnowledgeHit(title=title, url=url))
    except ValueError:
        return None


def validate_public_hit(hit: PublicKnowledgeHit) -> PublicKnowledgeHit:
    _validate_public_url(hit.url)
    title = " ".join(hit.title.split())[:256]
    if not title:
        raise ValueError("public knowledge title is invalid")
    return PublicKnowledgeHit(title=title, url=hit.url)


def _validate_public_url(value: str) -> None:
    parsed = urlparse(value)
    host = parsed.hostname
    if parsed.scheme != "https" or not host or host == "localhost":
        raise ValueError("public knowledge URL is invalid")
    try:
        if not ipaddress.ip_address(host).is_global:
            raise ValueError("public knowledge URL is invalid")
    except ValueError:
        if host.replace(".", "").isdigit():
            raise ValueError("public knowledge URL is invalid")
