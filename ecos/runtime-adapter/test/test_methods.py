from dataclasses import is_dataclass

import ecos_runtime_adapter.requests as requests
from ecos_runtime_adapter.requests import (
    DbEnsureRequest,
    DbReleaseRequest,
    FloorplanEditInspectRequest,
    FloorplanEditRunAutoRequest,
    FloorplanEditValidateRequest,
    WorkspaceSpecOpenRequest,
)


def test_runtime_method_registry_contains_current_methods_once():
    from ecos_runtime_adapter.methods import RUNTIME_METHODS, runtime_method_names

    expected_methods = (
        "workspace_spec.describe",
        "workspace_spec.validate",
        "project.discover",
        "project.manifest.load",
        "project.manifest.mutate",
        "workspace.create",
        "workspace.open",
        "workspace.binding_requirement",
        "workspace.update",
        "workspace.configuration.update",
        "workspace.close",
        "workspace.home",
        "workspace.info",
        "workspace.refresh_config",
        "workspace.sync_config",
        "workspace.reset_flow",
        "workspace.export_signoff",
        "flow.run",
        "flow.run_step",
        "operation.start_flow",
        "operation.start_step",
        "operation.status",
        "operation.cancel",
        "workspace.snapshot",
        "workspace.engineering_snapshot",
        "workspace.recover_interrupted",
    )

    assert runtime_method_names() == expected_methods
    assert len(runtime_method_names()) == len(set(runtime_method_names()))
    assert len(RUNTIME_METHODS) == len(expected_methods)


def test_persistent_db_method_registry_is_separate_and_opt_in():
    from ecos_runtime_adapter.methods import (
        PERSISTENT_DB_METHODS,
        persistent_db_method_names,
        runtime_method_names,
    )

    expected_methods = (
        "db.ensure",
        "db.release",
        "layout.edit.begin",
        "layout.edit.apply",
        "layout.edit.save",
        "layout.edit.discard",
        "floorplan.edit.inspect",
        "floorplan.edit.run_auto",
        "floorplan.edit.validate",
    )

    assert persistent_db_method_names() == expected_methods
    enabled_methods = runtime_method_names(persistent_db_enabled=True)
    assert enabled_methods[-len(expected_methods) :] == expected_methods
    assert "db.ensure" not in runtime_method_names()
    assert len(PERSISTENT_DB_METHODS) == len(expected_methods)


def test_runtime_method_registry_entries_are_typed():
    from ecos_runtime_adapter.methods import runtime_methods

    for spec in runtime_methods(persistent_db_enabled=True):
        assert spec.method_name
        assert isinstance(spec.request_model, type)
        assert is_dataclass(spec.request_model)
        assert spec.handler_name


def test_runtime_method_lookup_returns_spec():
    from ecos_runtime_adapter.methods import runtime_method_by_name

    spec = runtime_method_by_name("workspace.open")

    assert spec is not None
    assert spec.request_model is WorkspaceSpecOpenRequest
    assert spec.handler_name == "open_workspace"
    export_spec = runtime_method_by_name("workspace.export_signoff")
    assert export_spec is not None
    assert export_spec.request_model is requests.WorkspaceExportSignoffRequest
    assert export_spec.handler_name == "export_signoff"
    assert runtime_method_by_name("workspace.inspect_signoff") is None
    assert runtime_method_by_name("db.ensure") is None


def test_persistent_db_method_lookup_requires_persistent_db():
    from ecos_runtime_adapter.methods import runtime_method_by_name

    ensure_spec = runtime_method_by_name("db.ensure", persistent_db_enabled=True)
    release_spec = runtime_method_by_name("db.release", persistent_db_enabled=True)

    assert ensure_spec is not None
    assert ensure_spec.request_model is DbEnsureRequest
    assert ensure_spec.handler_name == "db_ensure"
    assert release_spec is not None
    assert release_spec.request_model is DbReleaseRequest
    assert release_spec.handler_name == "db_release"
    inspect_spec = runtime_method_by_name(
        "floorplan.edit.inspect", persistent_db_enabled=True
    )
    assert inspect_spec is not None
    assert inspect_spec.request_model is FloorplanEditInspectRequest
    auto_spec = runtime_method_by_name(
        "floorplan.edit.run_auto", persistent_db_enabled=True
    )
    assert auto_spec is not None
    assert auto_spec.request_model is FloorplanEditRunAutoRequest
    validate_spec = runtime_method_by_name(
        "floorplan.edit.validate", persistent_db_enabled=True
    )
    assert validate_spec is not None
    assert validate_spec.request_model is FloorplanEditValidateRequest


def test_requests_module_does_not_own_runtime_method_table():
    assert not hasattr(requests, "REQUEST_MODELS")


def test_server_module_does_not_own_runtime_method_table():
    import ecos_runtime_adapter.server as server

    assert not hasattr(server, "RUNTIME_METHODS")
