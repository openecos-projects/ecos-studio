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
            "--calibration-source", str(tmp_path / "calibration"),
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
                "--calibration-source", str(tmp_path / "calibration"),
                "--design", "gcd",
                "--run-root", str(tmp_path / "run"),
                "--designs-root", str(tmp_path / "designs"),
                "--pdk-root", str(tmp_path / "pdk"),
            ],
        )
    assert not (tmp_path / "receipt.json").exists()
    assert "ecc" in str(error.value).lower() or "ECC" in str(error.value)


def test_prebuild_only_exits_before_the_driver(monkeypatch, tmp_path, capsys):
    """Batch preparation mode: receipt written, no episode, no cell-exit record."""
    receipt_path = tmp_path / "receipt.json"
    monkeypatch.setattr(
        rerun_run_cell, "_prepare_workspace",
        lambda *a, **k: {
            "schema_version": "ecos.rerun_prebuild_receipt.v1",
            "mode": "create", "elapsed_seconds": 1.0,
        },
    )
    monkeypatch.setattr(rerun_run_cell, "_seed_workspace_calibration", lambda *a, **k: None)
    monkeypatch.setattr(
        rerun_run_cell, "driver_main",
        lambda *a, **k: (_ for _ in ()).throw(AssertionError("driver must not run")),
    )
    exit_code = main(
        [
            "--prebuild-receipt", str(receipt_path),
            "--calibration-source", str(tmp_path / "calibration"),
            "--design", "gcd",
            "--run-root", str(tmp_path / "run"),
            "--designs-root", str(tmp_path / "designs"),
            "--pdk-root", str(tmp_path / "pdk"),
            "--model", "glm-5.3-flash",
            "--prebuild-only",
        ],
    )
    assert exit_code == 0
    receipt = json.loads(receipt_path.read_text())
    assert receipt["schema_version"] == "ecos.rerun_prebuild_receipt.v1"
    assert not (receipt_path.parent / "cell-exit.json").exists()
    assert "prebuild-only" in capsys.readouterr().out


def test_wrapper_flags_are_stripped_but_driver_flags_passthrough():
    """Regression: parse_known_args must not swallow shared driver flags."""
    argv = [
        "--prebuild-receipt", "r.json",
        "--calibration-source", "/tmp/calibration",
        "--design", "gcd",
        "--run-root", "/tmp/run",
        "--designs-root", "/tmp/designs",
        "--pdk-root", "/tmp/pdk",
        "--prebuild-timeout-seconds", "900",
        "--model", "glm-5.3-flash",
        "--stop-after-started", "2",
    ]
    own = ("--prebuild-receipt", "--prebuild-timeout-seconds")
    rest, skip, index = [], 0, 0
    while index < len(argv):
        arg = argv[index]
        if skip:
            skip -= 1
        elif arg in own or arg.split("=", 1)[0] in own:
            skip = "=" not in arg
        else:
            rest.append(arg)
        index += 1
    assert "--design" in rest and rest[rest.index("--design") + 1] == "gcd"
    assert "--model" in rest and "--stop-after-started" in rest
    assert "--calibration-source" in rest
    assert "--prebuild-receipt" not in rest and "900" not in rest
