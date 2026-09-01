"""Small persistence helpers for the optimization controller."""

from __future__ import annotations

import json
import os
import tempfile
from pathlib import Path


def _pending_tuple(intervention_id: str | None) -> tuple[str, ...]:
    return () if intervention_id is None else (intervention_id,)


def _write_json_atomic(destination: Path, value: object) -> None:
    descriptor, temporary_name = tempfile.mkstemp(
        dir=destination.parent,
        prefix=f".{destination.name}.",
        suffix=".tmp",
    )
    try:
        with os.fdopen(descriptor, "w", encoding="utf-8") as stream:
            json.dump(
                value, stream, sort_keys=True, separators=(",", ":"), allow_nan=False
            )
            stream.write("\n")
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(temporary_name, destination)
    except BaseException:
        Path(temporary_name).unlink(missing_ok=True)
        raise
