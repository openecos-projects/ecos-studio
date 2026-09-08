"""Actual final-layout bounds from ECC's versioned native geometry snapshot.

Harden packages filler output. Read that same stage's snapshot, never an inherited
Floorplan summary or parameter-derived margins. Binary layouts mirror ECC
GeometrySnapshotSchema.h, ShapeRecord.h and OwnerRef.h (schema v1, little endian).
"""
from __future__ import annotations

from contextlib import ExitStack
import mmap
from pathlib import Path
import re
import struct
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, StrictInt, field_validator, model_validator

from ecos_agent.hashing import canonical_sha256, file_sha256
from ecos_agent.optimization.metrics.contracts import safe_relative_ref

_MANIFEST = 'filler_ecc/output/geometry/geometry.manifest'
_HEADER = struct.Struct('<QIIHHIQQQQ')
_SHAPE = struct.Struct('<QIHBBH2xIQII4i')
_OWNER_SIZE = 40


class GeometrySnapshot(BaseModel):
    model_config = ConfigDict(extra='forbid', frozen=True)
    schema_version: Literal['ecos.geometry_snapshot.v1'] = 'ecos.geometry_snapshot.v1'
    dbu_per_micron: StrictInt = Field(gt=0)
    die_bbox: tuple[StrictInt, StrictInt, StrictInt, StrictInt]
    core_bbox: tuple[StrictInt, StrictInt, StrictInt, StrictInt]
    evidence_refs: tuple[str, ...] = Field(min_length=1, max_length=3)
    evidence_sha256: str = Field(pattern=r'^sha256:[0-9a-f]{64}$')

    @field_validator('evidence_refs')
    @classmethod
    def validate_refs(cls, refs: tuple[str, ...]) -> tuple[str, ...]:
        if len(set(refs)) != len(refs) or any(not safe_relative_ref(ref) for ref in refs):
            raise ValueError('geometry evidence references are invalid')
        return refs

    @model_validator(mode='after')
    def validate_bounds(self) -> GeometrySnapshot:
        for bbox in (self.die_bbox, self.core_bbox):
            if any(not -(2**31) <= n < 2**31 for n in bbox) or bbox[0] >= bbox[2] or bbox[1] >= bbox[3]:
                raise ValueError('geometry bounds are invalid')
        die, core = self.die_bbox, self.core_bbox
        if not (die[0] <= core[0] < core[2] <= die[2] and die[1] <= core[1] < core[3] <= die[3]):
            raise ValueError('geometry core bounds must lie inside die bounds')
        return self


def validate_fixed_geometry(baseline: GeometrySnapshot | None, candidate: GeometrySnapshot | None) -> None:
    """Require exact initial bounds and units; artifact contents may otherwise vary."""
    if baseline is None or candidate is None:
        raise ValueError('fixed geometry evidence is missing')
    if (baseline.dbu_per_micron, baseline.die_bbox, baseline.core_bbox) != (
        candidate.dbu_per_micron, candidate.die_bbox, candidate.core_bbox
    ):
        raise ValueError('fixed geometry differs from the initial baseline')


def _checked_records(stack: ExitStack, path: Path, kind: int, record_size: int):
    stream = stack.enter_context(path.open('rb'))
    if path.stat().st_size < _HEADER.size:
        raise ValueError('geometry binary header is truncated')
    data = stack.enter_context(mmap.mmap(stream.fileno(), 0, access=mmap.ACCESS_READ))
    magic, version, header_size, actual_kind, flags, size, count, payload, _, _ = _HEADER.unpack_from(data)
    if (magic, version, header_size, actual_kind, size) != (0x454347454f4d3031, 1, 56, kind, record_size):
        raise ValueError('geometry binary schema is invalid')
    if flags != 0 or payload != count * record_size or len(data) != header_size + payload:
        raise ValueError('geometry binary record lengths are invalid')
    return data, count


def read_terminal_geometry(workspace_root: Path) -> GeometrySnapshot | None:
    """Missing legacy snapshots return None; present unsafe/invalid evidence fails."""
    # Reuse the terminal reader's workspace boundary without creating an import cycle.
    from ecos_agent.optimization.observations import _is_file, _safe_file, _workspace_root

    root = _workspace_root(workspace_root)
    if not _is_file(root, _MANIFEST):
        return None
    manifest_path = _safe_file(root, _MANIFEST)
    if manifest_path.stat().st_size > 65536:
        raise ValueError('geometry manifest is too large')
    entries: dict[str, str] = {}
    for line in manifest_path.read_text(encoding='utf-8').splitlines():
        key, separator, value = line.partition('=')
        if not separator or key in entries:
            raise ValueError('geometry manifest contains invalid or duplicate fields')
        entries[key] = value
    if entries.get('schema_version') != '1':
        raise ValueError('geometry manifest schema is unsupported')
    for key in ('dbu_per_micron', 'shape_count', 'owner_count'):
        if not re.fullmatch(r'[1-9][0-9]*', entries.get(key, '')):
            raise ValueError('geometry manifest counts or units are invalid')
    refs = [_MANIFEST]
    paths = []
    for key in ('shapes', 'owners'):
        relative = entries.get(key, '')
        if not safe_relative_ref(relative):
            raise ValueError('geometry binary reference is unsafe')
        ref = f'{Path(_MANIFEST).parent.as_posix()}/{relative}'
        paths.append(_safe_file(root, ref))
        refs.append(ref)
    bounds = {}
    with ExitStack() as stack:
        shapes, shape_count = _checked_records(stack, paths[0], 2, _SHAPE.size)
        owners, owner_count = _checked_records(stack, paths[1], 4, _OWNER_SIZE)
        if shape_count != int(entries['shape_count']) or owner_count != int(entries['owner_count']):
            raise ValueError('geometry manifest counts do not match binary evidence')
        for index in range(shape_count):
            record = _SHAPE.unpack_from(shapes, _HEADER.size + index * _SHAPE.size)
            owner_index = record[6]
            if owner_index >= owner_count:
                raise ValueError('geometry shape owner is invalid')
            owner_type = owners[_HEADER.size + owner_index * _OWNER_SIZE]
            if record[4] != 1 or owner_type not in (1, 2):
                continue
            if record[3] != 3 or owner_type in bounds:
                raise ValueError('geometry die/core shapes are ambiguous')
            bounds[owner_type] = record[-4:]
    if set(bounds) != {1, 2}:
        raise ValueError('geometry die/core bounds are missing')
    return GeometrySnapshot(
        dbu_per_micron=int(entries['dbu_per_micron']),
        die_bbox=bounds[1], core_bbox=bounds[2], evidence_refs=tuple(refs),
        evidence_sha256=canonical_sha256({ref: file_sha256(_safe_file(root, ref)) for ref in refs}),
    )
