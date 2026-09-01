import json
import queue
import threading
from pathlib import Path
from types import SimpleNamespace

import pytest
from chipcompiler.engine import signoff_export
from chipcompiler.engine.signoff_export import SignoffExportError
from ecos_runtime_adapter.requests import (
    WorkspaceExportSignoffRequest,
    WorkspaceInspectSignoffRequest,
)
from ecos_runtime_adapter.sessions import WorkspaceSessionRegistry
from ecos_runtime_adapter.workspace_api import RuntimeApiError, WorkspaceRuntimeApi


def test_workspace_export_signoff_returns_exact_output_path(monkeypatch, tmp_path):
    workspace = SimpleNamespace(directory=tmp_path / "workspace")
    sessions = WorkspaceSessionRegistry()
    session = sessions.open_session(workspace.directory, workspace=workspace)
    output_path = tmp_path / "exports" / "custom name.tar.gz"
    calls = []

    def fake_export(active_workspace, requested_output, additional_files=None):
        calls.append((active_workspace, requested_output))
        return str(output_path)

    monkeypatch.setattr(
        "chipcompiler.engine.signoff_export.export_signoff_package_archive",
        fake_export,
    )
    monkeypatch.setattr(
        "chipcompiler.engine.signoff_export.inspect_signoff_package",
        lambda _workspace: {"status": "ready", "groups": [], "risks": []},
    )
    api = WorkspaceRuntimeApi(sessions=sessions)

    result = api.export_signoff(
        WorkspaceExportSignoffRequest(
            workspace_id=session.workspace_id,
            output_path=str(output_path),
        )
    )

    assert result == {"outputPath": str(output_path)}
    assert calls == [(workspace, str(output_path))]


def test_workspace_export_signoff_waits_for_session_mutation_lock(monkeypatch, tmp_path):
    workspace = SimpleNamespace(directory=tmp_path / "workspace")
    sessions = WorkspaceSessionRegistry()
    session = sessions.open_session(workspace.directory, workspace=workspace)
    output_path = tmp_path / "export.tar.gz"
    entered = threading.Event()
    results = queue.Queue()

    def fake_export(_workspace, requested_output, additional_files=None):
        entered.set()
        return requested_output

    monkeypatch.setattr(
        "chipcompiler.engine.signoff_export.export_signoff_package_archive",
        fake_export,
    )
    monkeypatch.setattr(
        "chipcompiler.engine.signoff_export.inspect_signoff_package",
        lambda _workspace: {"status": "ready", "groups": [], "risks": []},
    )
    api = WorkspaceRuntimeApi(sessions=sessions)

    def run_export():
        try:
            results.put(
                api.export_signoff(
                    WorkspaceExportSignoffRequest(
                        workspace_id=session.workspace_id,
                        output_path=str(output_path),
                    )
                )
            )
        except BaseException as error:  # pragma: no cover - re-raised below
            results.put(error)

    with session.mutation_lock:
        worker = threading.Thread(target=run_export)
        worker.start()
        assert not entered.wait(0.1)
        assert worker.is_alive()

    worker.join(timeout=2)
    assert not worker.is_alive()
    result = results.get_nowait()
    if isinstance(result, BaseException):
        raise result
    assert result == {"outputPath": str(output_path)}
    assert entered.is_set()


def test_workspace_export_signoff_rejects_current_blocked_assessment(monkeypatch, tmp_path):
    workspace = SimpleNamespace(directory=tmp_path / "workspace")
    sessions = WorkspaceSessionRegistry()
    session = sessions.open_session(workspace.directory, workspace=workspace)
    monkeypatch.setattr(
        "chipcompiler.engine.signoff_export.inspect_signoff_package",
        lambda _workspace: {"status": "blocked", "groups": [], "risks": [{"id": "drc"}]},
    )
    monkeypatch.setattr(
        "chipcompiler.engine.signoff_export.export_signoff_package_archive",
        lambda *_args, **_kwargs: pytest.fail("blocked assessment must prevent export"),
    )

    with pytest.raises(RuntimeApiError) as exc_info:
        WorkspaceRuntimeApi(sessions=sessions).export_signoff(
            WorkspaceExportSignoffRequest(
                workspace_id=session.workspace_id,
                output_path=str(tmp_path / "blocked.tar.gz"),
            )
        )

    assert exc_info.value.code == "signoff_blocked"
    assert exc_info.value.data["assessment"]["status"] == "blocked"


def test_inspect_signoff_package_reads_current_home_checklist(monkeypatch, tmp_path):
    workspace_dir = tmp_path / "workspace"
    checklist_path = workspace_dir / "home" / "checklist.json"
    checklist_path.parent.mkdir(parents=True)
    checklist_path.write_text(
        json.dumps(
            {
                "schema_version": 3,
                "kind": "signoff_checklist",
                "status": "blocked",
                "summary": {"passed": 1, "blocked": 1, "attention": 1, "unavailable": 0},
                "checklist": [
                    {
                        "id": "quality.drc.clean",
                        "step": "drc",
                        "category": "quality_gate",
                        "owner": "qor",
                        "policy": "block",
                        "state": "failed",
                        "blocked": True,
                        "title": "Final DRC clean",
                        "summary": "drc_count=2 (required == 0)",
                        "source": {
                            "kind": "qor_gate",
                            "path": "drc_ecc/analysis/qor_summary.json",
                            "gate_id": "qor.drc.clean",
                        },
                        "evidence": [{"kind": "feature", "path": "drc_ecc/feature/drc.step.json"}],
                    },
                    {
                        "id": "report.optional.image",
                        "step": "workspace",
                        "category": "report",
                        "owner": "checklist",
                        "policy": "warn",
                        "state": "warning",
                        "blocked": False,
                        "title": "Optional image",
                        "summary": "Optional image is missing.",
                        "source": {"kind": "package", "path": "filler_ecc/output/gcd_filler.png"},
                        "evidence": [],
                    },
                    {
                        "id": "provenance.initial.rtl",
                        "step": "workspace",
                        "category": "provenance",
                        "owner": "checklist",
                        "policy": "block",
                        "state": "pass",
                        "blocked": False,
                        "title": "Initial RTL",
                        "summary": "Current output is present and non-empty.",
                        "source": {"kind": "provenance", "path": "origin/gcd.v"},
                        "evidence": [],
                    },
                ],
            }
        ),
        encoding="utf-8",
    )

    class FakeFlow:
        def __init__(self, workspace):
            assert workspace.directory == workspace_dir

        def collect_signoff_package(self, options):
            assert options.archive is False
            assert options.materialize is False
            return SimpleNamespace()

    monkeypatch.setattr(signoff_export, "EngineFlow", FakeFlow)

    review = signoff_export.inspect_signoff_package(SimpleNamespace(directory=workspace_dir))

    assert review["status"] == "blocked"
    assert [group["id"] for group in review["groups"]] == [
        "initial",
        "config",
        "harden",
        "final_design",
        "sta",
        "spef",
        "reports",
    ]
    drc_group = next(group for group in review["groups"] if group["id"] == "final_design")
    assert drc_group == {
        "id": "final_design",
        "label": "Final Design",
        "status": "blocked",
        "available": 0,
        "expected": 2,
        "summary": "1 blocking checklist requirements",
    }
    reports_group = next(group for group in review["groups"] if group["id"] == "reports")
    assert reports_group["status"] == "ready"
    assert [risk["severity"] for risk in review["risks"]] == ["blocked", "warning"]
    blocked_risk = next(risk for risk in review["risks"] if risk["severity"] == "blocked")
    assert blocked_risk["details"] == [
        {
            "kind": "quality_gate",
            "label": "Final DRC clean",
            "location": "drc_ecc/analysis/qor_summary.json",
            "reason": "drc_count=2 (required == 0)",
            "owner": "qor",
            "policy": "block",
            "state": "failed",
            "evidence": [{"kind": "feature", "path": "drc_ecc/feature/drc.step.json"}],
        }
    ]


def test_inspect_signoff_package_blocks_when_current_checklist_is_unavailable(
    monkeypatch, tmp_path
):
    workspace_dir = tmp_path / "workspace"
    (workspace_dir / "home").mkdir(parents=True)

    class FakeFlow:
        def __init__(self, workspace):
            assert workspace.directory == workspace_dir

        def collect_signoff_package(self, options):
            return SimpleNamespace()

    monkeypatch.setattr(signoff_export, "EngineFlow", FakeFlow)

    review = signoff_export.inspect_signoff_package(SimpleNamespace(directory=workspace_dir))

    assert review["status"] == "blocked"
    assert review["risks"][0]["title"] == "Signoff checklist unavailable"


def test_workspace_inspect_signoff_waits_for_session_mutation_lock(monkeypatch, tmp_path):
    workspace = SimpleNamespace(directory=tmp_path / "workspace")
    sessions = WorkspaceSessionRegistry()
    session = sessions.open_session(workspace.directory, workspace=workspace)
    entered = threading.Event()
    results = queue.Queue()

    def fake_inspect(active_workspace):
        assert active_workspace is workspace
        entered.set()
        return {"status": "ready", "groups": [], "risks": []}

    monkeypatch.setattr(signoff_export, "inspect_signoff_package", fake_inspect)
    api = WorkspaceRuntimeApi(sessions=sessions)

    def run_inspection():
        try:
            results.put(
                api.inspect_signoff(
                    WorkspaceInspectSignoffRequest(workspace_id=session.workspace_id)
                )
            )
        except BaseException as error:  # pragma: no cover - re-raised below
            results.put(error)

    with session.mutation_lock:
        worker = threading.Thread(target=run_inspection)
        worker.start()
        assert not entered.wait(0.1)
        assert worker.is_alive()

    worker.join(timeout=2)
    assert not worker.is_alive()
    result = results.get_nowait()
    if isinstance(result, BaseException):
        raise result
    assert result == {"status": "ready", "groups": [], "risks": []}


def test_export_signoff_package_archive_collects_temporarily_and_replaces_atomically(
    monkeypatch,
    tmp_path,
):
    from chipcompiler.engine.signoff_export import export_signoff_package_archive

    output_path = tmp_path / "nested" / "chosen.tar.gz"
    captured_output_dirs = []

    class FakeFlow:
        def __init__(self, workspace):
            assert workspace == "workspace"

        def collect_signoff_package(self, options):
            captured_output_dirs.append(options.output_dir)
            package_dir = Path(options.output_dir) / "design_signoff_package"
            package_dir.mkdir(parents=True, exist_ok=True)
            (package_dir / "dummy.txt").write_text("archive")
            return SimpleNamespace(
                ok=True,
                package_dir=str(package_dir),
                missing_required=[],
            )

    monkeypatch.setattr(
        "chipcompiler.engine.signoff_export.EngineFlow",
        FakeFlow,
    )

    result = export_signoff_package_archive("workspace", str(output_path))

    assert result == str(output_path.resolve())
    import tarfile

    with tarfile.open(output_path, "r:gz") as tar:
        assert tar.extractfile("design_signoff_package/dummy.txt").read() == b"archive"
    assert captured_output_dirs
    assert not Path(captured_output_dirs[0]).exists()
    assert not list(output_path.parent.glob(f".{output_path.name}.*"))


def test_export_signoff_package_archive_preserves_existing_target_on_incomplete_result(
    monkeypatch,
    tmp_path,
):
    from chipcompiler.engine.signoff_export import export_signoff_package_archive

    output_path = tmp_path / "existing.tar.gz"
    output_path.write_bytes(b"old")

    class FakeFlow:
        def __init__(self, workspace):
            pass

        def collect_signoff_package(self, options):
            return SimpleNamespace(
                ok=False,
                package_dir=None,
                missing_required=["harden/design.gds", "harden/design.lef"],
            )

    monkeypatch.setattr(
        "chipcompiler.engine.signoff_export.EngineFlow",
        FakeFlow,
    )

    with pytest.raises(SignoffExportError) as exc_info:
        export_signoff_package_archive("workspace", str(output_path))

    assert "harden/design.gds" in str(exc_info.value)
    assert "harden/design.lef" in str(exc_info.value)
    assert output_path.read_bytes() == b"old"


def test_export_signoff_package_archive_replaces_symlink_entry_not_target(
    monkeypatch,
    tmp_path,
):
    from chipcompiler.engine.signoff_export import export_signoff_package_archive

    target = tmp_path / "target.tar.gz"
    target.write_bytes(b"target")
    output_path = tmp_path / "chosen.tar.gz"
    try:
        output_path.symlink_to(target.name)
    except (OSError, NotImplementedError):
        pytest.skip("symlinks are unavailable")

    class FakeFlow:
        def __init__(self, workspace):
            pass

        def collect_signoff_package(self, options):
            package_dir = Path(options.output_dir) / "design_signoff_package"
            package_dir.mkdir(parents=True, exist_ok=True)
            (package_dir / "dummy.txt").write_text("new")
            return SimpleNamespace(ok=True, package_dir=str(package_dir), missing_required=[])

    monkeypatch.setattr(
        "chipcompiler.engine.signoff_export.EngineFlow",
        FakeFlow,
    )

    export_signoff_package_archive("workspace", str(output_path))

    assert not output_path.is_symlink()
    import tarfile

    with tarfile.open(output_path, "r:gz") as tar:
        assert tar.extractfile("design_signoff_package/dummy.txt").read() == b"new"
    assert target.read_bytes() == b"target"
