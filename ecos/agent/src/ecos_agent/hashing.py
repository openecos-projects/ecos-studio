import hashlib
import json
from pathlib import Path
from typing import Any


def canonical_sha256(data: Any) -> str:
    payload = json.dumps(data, sort_keys=True, separators=(",", ":"), ensure_ascii=False).encode("utf-8")
    return "sha256:" + hashlib.sha256(payload).hexdigest()


def file_sha256(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as fh:
        for chunk in iter(lambda: fh.read(1024 * 1024), b""):
            h.update(chunk)
    return "sha256:" + h.hexdigest()


def _sha256_bytes(payload: bytes) -> str:
    return "sha256:" + hashlib.sha256(payload).hexdigest()


def artifact_fingerprint(
    path: Path,
    large_threshold_bytes: int = 50 * 1024 * 1024,
    edge_bytes: int = 1024 * 1024,
) -> dict[str, Any]:
    size_bytes = path.stat().st_size
    if size_bytes < large_threshold_bytes:
        return {
            "hash_policy": "sha256",
            "sha256": file_sha256(path),
            "size_bytes": size_bytes,
            "full_hash_available": True,
        }
    with path.open("rb") as fh:
        head = fh.read(edge_bytes)
        if size_bytes > edge_bytes:
            fh.seek(max(size_bytes - edge_bytes, 0))
        tail = fh.read(edge_bytes)
    return {
        "hash_policy": "size_mtime_head_tail",
        "sha256": None,
        "size_bytes": size_bytes,
        "mtime_ns": path.stat().st_mtime_ns,
        "head_sha256": _sha256_bytes(head),
        "tail_sha256": _sha256_bytes(tail),
        "full_hash_available": False,
    }
