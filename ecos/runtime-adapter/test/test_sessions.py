from pathlib import Path

import pytest
from ecos_runtime_adapter.sessions import WorkspaceSessionNotFound, WorkspaceSessionRegistry


def test_create_session_returns_workspace_id_and_resolved_directory(tmp_path):
    registry = WorkspaceSessionRegistry()
    workspace = object()

    session = registry.create_session(tmp_path / "ws", workspace=workspace)

    assert session.workspace_id.startswith("workspace-")
    assert session.directory == (tmp_path / "ws").resolve()
    assert session.workspace is workspace
    assert session.db_handle is None


def test_open_reuses_existing_session_for_same_directory(tmp_path):
    registry = WorkspaceSessionRegistry()

    first = registry.open_session(tmp_path / "ws", workspace="first")
    second = registry.open_session(Path(tmp_path / "ws"), workspace="second")

    assert second.workspace_id == first.workspace_id
    assert second.workspace == "first"


def test_create_replaces_existing_session_for_same_directory(tmp_path):
    released = []
    registry = WorkspaceSessionRegistry(db_releaser=released.append)

    first = registry.open_session(tmp_path / "ws", workspace="first")
    db_handle = object()
    first.db_handle = db_handle
    second = registry.create_session(Path(tmp_path / "ws"), workspace="second")

    assert second.workspace_id != first.workspace_id
    assert second.directory == first.directory
    assert second.workspace == "second"
    assert first.db_handle is None
    assert released == [db_handle]
    assert registry.get_session(second.workspace_id) is second
    with pytest.raises(WorkspaceSessionNotFound, match=first.workspace_id):
        registry.get_session(first.workspace_id)
    assert registry.open_session(tmp_path / "ws", workspace="third") is second


def test_get_session_rejects_unknown_and_closed_workspace_id(tmp_path):
    registry = WorkspaceSessionRegistry()
    session = registry.open_session(tmp_path / "ws", workspace=object())

    registry.close_session(session.workspace_id)

    with pytest.raises(WorkspaceSessionNotFound, match=session.workspace_id):
        registry.get_session(session.workspace_id)
    with pytest.raises(WorkspaceSessionNotFound, match="missing"):
        registry.get_session("missing")


def test_close_session_releases_active_db_handle_once(tmp_path):
    released = []
    registry = WorkspaceSessionRegistry(db_releaser=released.append)
    session = registry.open_session(tmp_path / "ws", workspace=object())
    db_handle = object()
    session.db_handle = db_handle

    registry.close_session(session.workspace_id)

    assert session.db_handle is None
    assert released == [db_handle]


def test_close_all_releases_all_active_db_handles_and_clears_directory_map(tmp_path):
    released = []
    registry = WorkspaceSessionRegistry(db_releaser=released.append)
    first = registry.open_session(tmp_path / "first", workspace=object())
    second = registry.open_session(tmp_path / "second", workspace=object())
    first_db = object()
    second_db = object()
    first.db_handle = first_db
    second.db_handle = second_db

    registry.close_all()

    assert first.db_handle is None
    assert second.db_handle is None
    assert released == [first_db, second_db]
    with pytest.raises(WorkspaceSessionNotFound, match=first.workspace_id):
        registry.get_session(first.workspace_id)
    reopened = registry.open_session(tmp_path / "first", workspace="new")
    assert reopened.workspace == "new"


def test_per_session_lock_serializes_mutating_commands(tmp_path):
    registry = WorkspaceSessionRegistry()
    session = registry.open_session(tmp_path / "ws", workspace=object())

    with session.mutation_lock:
        assert not session.mutation_lock.acquire(blocking=False)
