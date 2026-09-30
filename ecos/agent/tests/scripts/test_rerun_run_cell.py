"""Offline checks for the shared-rerun cell entry (no provider, no ECC)."""

import importlib.util
import json
from pathlib import Path

import pytest

_SPEC = importlib.util.spec_from_file_location(
    "rerun_run_cell",
    Path(__file__).resolve().parents[2] / "scripts" / "rerun_run_cell.py",
)
rerun_run_cell = importlib.util.module_from_spec(_SPEC)
_SPEC.loader.exec_module(rerun_run_cell)
main = rerun_run_cell.main


def test_dry_run_disables_all_dispatch(tmp_path, capsys):
    assert main(
        [
            "--prebuild-receipt", str(tmp_path / "receipt.json"),
            "--design", "gcd",
            "--run-root", str(tmp_path / "run"),
            "--designs-root", str(tmp_path / "designs"),
            "--pdk-root", str(tmp_path / "pdk"),
            "--dry-run",
        ],
    ) == 0
    payload = json.loads(capsys.readouterr().out)
    assert payload == {
        "dispatch": "disabled",
        "provider": "disabled",
        "native": "disabled",
        "prebuild": "skipped-in-dry-run",
        "workspace": str(tmp_path / "run" / "workspaces" / "gcd"),
    }
    assert not (tmp_path / "receipt.json").exists()


def test_real_run_requires_ecc_environment(monkeypatch, tmp_path):
    """Without a usable ECC RPC binary the prebuild fails closed, loudly."""
    monkeypatch.delenv("ECOS_AGENT_ECC_RPC_BIN", raising=False)
    monkeypatch.setenv("PATH", "/nonexistent")
    with pytest.raises(Exception) as error:
        main(
            [
                "--prebuild-receipt", str(tmp_path / "receipt.json"),
                "--design", "gcd",
                "--run-root", str(tmp_path / "run"),
                "--designs-root", str(tmp_path / "designs"),
                "--pdk-root", str(tmp_path / "pdk"),
            ],
        )
    assert not (tmp_path / "receipt.json").exists()
    assert "ecc" in str(error.value).lower() or "ECC" in str(error.value)
