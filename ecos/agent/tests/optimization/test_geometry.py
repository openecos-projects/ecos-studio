"""Actual ECC geometry evidence and fixed-outline constraints."""
import struct
from pathlib import Path

import pytest

from ecos_agent.optimization.geometry import read_terminal_geometry, validate_fixed_geometry

HEADER = struct.Struct('<QIIHHIQQQQ')
SHAPE = struct.Struct('<QIHBBH2xIQII4i')
OWNER = struct.Struct('<BBH4xQIIIII4x')


def write_snapshot(root: Path, *, die=(0, 0, 1000, 1000), core=(100, 100, 900, 900), dbu=1000):
    directory = root / 'filler_ecc/output/geometry'
    directory.mkdir(parents=True, exist_ok=True)
    for name, kind, record, values in (
        ('shapes', 2, SHAPE, [SHAPE.pack(i + 1, 1, 0, 3, 1, 0, i, 0, 0, 0, *bbox) for i, bbox in enumerate((die, core))]),
        ('owners', 4, OWNER, [OWNER.pack(t, 0, 0, 0, 0, 0, 0, 0, 0) for t in (1, 2)]),
    ):
        payload = b''.join(values)
        (directory / f'{name}.bin').write_bytes(HEADER.pack(0x454347454f4d3031, 1, 56, kind, 0, record.size, len(values), len(payload), 0, 0) + payload)
    (directory / 'geometry.manifest').write_text(f'schema_version=1\ndbu_per_micron={dbu}\nshape_count=2\nowner_count=2\nshapes=shapes.bin\nowners=owners.bin\n')
    return directory


def test_actual_geometry_and_evidence_hash(tmp_path):
    directory = write_snapshot(tmp_path)
    geometry = read_terminal_geometry(tmp_path)
    assert geometry.die_bbox == (0, 0, 1000, 1000)
    assert geometry.core_bbox == (100, 100, 900, 900)
    assert geometry.dbu_per_micron == 1000
    assert len(geometry.evidence_refs) == 3
    (directory / 'geometry.manifest').write_text((directory / 'geometry.manifest').read_text() + 'design_name=changed\n')
    changed = read_terminal_geometry(tmp_path)
    assert geometry.evidence_sha256 != changed.evidence_sha256
    validate_fixed_geometry(geometry, changed)


@pytest.mark.parametrize('kwargs', [dict(die=(0, 0, 500, 2000)), dict(die=(1, 0, 1001, 1000)), dict(core=(101, 100, 901, 900)), dict(dbu=2000)])
def test_shape_translation_core_and_units_changes_rejected(tmp_path, kwargs):
    write_snapshot(tmp_path)
    original = read_terminal_geometry(tmp_path)
    write_snapshot(tmp_path, **kwargs)
    with pytest.raises(ValueError, match='geometry'):
        validate_fixed_geometry(original, read_terminal_geometry(tmp_path))


def test_missing_geometry_never_satisfies_fixed_policy(tmp_path):
    assert read_terminal_geometry(tmp_path) is None
    with pytest.raises(ValueError, match='missing'):
        validate_fixed_geometry(None, None)


@pytest.mark.parametrize('mutation', ['version', 'truncated', 'duplicate', 'outside', 'symlink', 'parent_symlink', 'units', 'bounds'])
def test_invalid_or_unsafe_evidence_rejected(tmp_path, mutation):
    directory = write_snapshot(tmp_path)
    manifest = directory / 'geometry.manifest'
    if mutation == 'version':
        manifest.write_text(manifest.read_text().replace('schema_version=1', 'schema_version=2'))
    elif mutation == 'truncated':
        (directory / 'shapes.bin').write_bytes(b'bad')
    elif mutation == 'duplicate':
        manifest.write_text(manifest.read_text() + 'dbu_per_micron=1000\n')
    elif mutation == 'outside':
        manifest.write_text(manifest.read_text().replace('shapes=shapes.bin', 'shapes=../shapes.bin'))
    elif mutation == 'symlink':
        target = directory / 'shapes.bin'
        target.rename(directory / 'target.bin')
        target.symlink_to(directory / 'target.bin')
    elif mutation == 'parent_symlink':
        directory.rename(directory.with_name('target'))
        directory.symlink_to(directory.with_name('target'), target_is_directory=True)
    elif mutation == 'units':
        write_snapshot(tmp_path, dbu=0)
    else:
        write_snapshot(tmp_path, core=(100, 100, 1200, 900))
    with pytest.raises(ValueError):
        read_terminal_geometry(tmp_path)


from tests.optimization.observation_support import frozen_workspace


def test_terminal_binds_geometry_and_legacy_serialization(frozen_workspace):
    from ecos_agent.optimization.observations import build_terminal_observation
    from ecos_agent.optimization.observation_contracts import TerminalObservation
    legacy = build_terminal_observation(frozen_workspace)
    assert 'geometry' not in legacy.model_dump(mode='json')
    write_snapshot(frozen_workspace)
    observation = build_terminal_observation(frozen_workspace)
    assert observation.geometry is not None
    assert observation.evidence_manifest_sha256 != legacy.evidence_manifest_sha256
    assert TerminalObservation.model_validate_json(observation.model_dump_json()) == observation
    write_snapshot(frozen_workspace, core=(110, 100, 910, 900))
    changed = build_terminal_observation(frozen_workspace)
    assert observation.evidence_manifest_sha256 != changed.evidence_manifest_sha256
