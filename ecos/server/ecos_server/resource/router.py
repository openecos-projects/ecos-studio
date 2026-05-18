#!/usr/bin/env python

import asyncio
import logging
from collections.abc import Callable
from typing import Any

from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import StreamingResponse

from ecos_server.sse import event_manager

from .inventory import InventoryService, PdkInventoryEntry, ToolInventoryEntry
from .jobs import JobTracker
from .pdks import PdkResourceService
from .registry import RegistryService
from .schemas import (
    ResourceAction,
    ResourceInfo,
    ResourceJob,
    ResourceList,
    ResourceStatus,
    ResourceType,
    ToolInstallRequest,
)
from .tools import ToolResourceService

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/resources", tags=["resources"])

# ── Service singletons ────────────────────────────────────────────────
_inventory = InventoryService()
_job_tracker = JobTracker()
_pdk_service = PdkResourceService(inventory=_inventory)
_tool_service = ToolResourceService(inventory=_inventory)

_registry_service: RegistryService | None = None

_TOOL_PREFIX = "tool:"
_PDK_PREFIX = "pdk:"
_ALL_PLATFORM = "all-platform"


def _tool_health(entry: ToolInventoryEntry) -> dict[str, object]:
    return {
        "detected_executables": entry.detected_executables,
        "installed_at": entry.installed_at,
        "managed": entry.managed,
        "sha256": entry.sha256,
        "executable": entry.executable,
    }


def _select_platform_asset(version_entry) -> tuple[str, Any | None]:
    platform_id = ToolResourceService.current_platform()
    asset = version_entry.platforms.get(platform_id)
    if asset is not None:
        return platform_id, asset
    fallback_asset = version_entry.platforms.get(_ALL_PLATFORM)
    if fallback_asset is not None:
        return _ALL_PLATFORM, fallback_asset
    return platform_id, None


def _pdk_health(entry: PdkInventoryEntry) -> dict[str, object]:
    return {
        "status": entry.health,
        "detected_files": entry.detected_file_groups,
        "detected_file_list": entry.detected_files,
        "detected_file_groups": entry.detected_file_groups,
        "imported_at": entry.imported_at,
        "managed": entry.managed,
        "version": entry.version,
        "sha256": entry.sha256,
        "source": entry.source,
        "source_url": entry.source_url,
    }


def _pdk_status(entry: PdkInventoryEntry, *, update_available: bool = False) -> ResourceStatus:
    if entry.health == "missing":
        return ResourceStatus.missing
    if entry.health == "invalid":
        return ResourceStatus.invalid
    if update_available:
        return ResourceStatus.update_available
    return ResourceStatus.installed


def _managed_pdk_reference_error(entry: PdkInventoryEntry) -> str | None:
    if entry.managed:
        return f"PDK '{entry.id}' is managed and cannot remove reference; use uninstall"
    return None


def init_registry(registry_url: str) -> None:
    global _registry_service
    _registry_service = RegistryService(registry_url=registry_url)


def _require_registry() -> RegistryService:
    if _registry_service is None:
        raise HTTPException(status_code=503, detail="Registry not configured")
    return _registry_service


# ── Resource row builders ──────────────────────────────────────────────


def _tool_to_resource(
    reg_tool, installed: dict[str, ToolInventoryEntry], installing: set[str]
) -> ResourceInfo:
    name = reg_tool.name
    versions = [v.version for v in reg_tool.versions]
    platform_id = ToolResourceService.current_platform()
    latest = reg_tool.versions[0] if reg_tool.versions else None
    platform_asset = latest.platforms.get(platform_id) if latest else None
    inst = installed.get(name)
    resource_id = f"{_TOOL_PREFIX}{name}"

    if resource_id in installing:
        status = ResourceStatus.installing
        actions = []
    elif inst:
        if versions and versions[0] != inst.version:
            status = ResourceStatus.update_available
        else:
            status = ResourceStatus.installed
        actions = []
        if status == ResourceStatus.update_available:
            actions.append(ResourceAction.update)
        if inst.managed:
            actions.append(ResourceAction.uninstall)
    else:
        status = ResourceStatus.available
        actions = [ResourceAction.install]

    return ResourceInfo(
        id=resource_id,
        type=ResourceType.tool,
        name=name,
        display_name=reg_tool.display_name,
        description=reg_tool.description,
        category=reg_tool.category,
        status=status,
        installed_version=inst.version if inst else None,
        available_versions=versions,
        active_version=inst.version if inst and inst.active else None,
        active=inst.active if inst else False,
        path=inst.path if inst else None,
        managed_root=str(_inventory.tools_dir),
        platform=platform_id,
        size=platform_asset.size if platform_asset else None,
        source="registry",
        homepage=reg_tool.homepage,
        actions=actions,
        health=_tool_health(inst) if inst else {},
    )


def _installed_tool_to_resource(
    name: str, entry: ToolInventoryEntry, installing: set[str]
) -> ResourceInfo:
    resource_id = f"{_TOOL_PREFIX}{name}"
    status = ResourceStatus.installing if resource_id in installing else ResourceStatus.installed
    actions = []
    if status != ResourceStatus.installing and entry.managed:
        actions = [ResourceAction.uninstall]
    return ResourceInfo(
        id=resource_id,
        type=ResourceType.tool,
        name=name,
        display_name=name,
        description="",
        category="",
        status=status,
        installed_version=entry.version,
        available_versions=[],
        active_version=entry.version if entry.active else None,
        active=entry.active,
        path=entry.path,
        managed_root=str(_inventory.tools_dir) if entry.managed else None,
        source="local",
        homepage="",
        actions=actions,
        health=_tool_health(entry),
    )


def _pdk_to_resource(entry: PdkInventoryEntry) -> ResourceInfo:
    status = _pdk_status(entry)
    actions = [ResourceAction.validate]
    if not entry.active:
        actions.append(ResourceAction.activate)
    if entry.managed:
        actions.append(ResourceAction.uninstall)
    else:
        actions.append(ResourceAction.remove_reference)

    return ResourceInfo(
        id=f"{_PDK_PREFIX}{entry.id}",
        type=ResourceType.pdk,
        name=entry.id,
        display_name=entry.name or entry.id,
        description="",
        category="pdk",
        status=status,
        active=entry.active,
        installed_version=entry.version or None,
        available_versions=[],
        active_version=entry.version if entry.active and entry.version else None,
        path=entry.canonical_path,
        managed_root=str(_inventory.pdks_dir) if entry.managed else None,
        source=entry.source or "local",
        actions=actions,
        health=_pdk_health(entry),
    )


def _registry_pdk_to_resource(
    reg_pdk, installed: dict[str, PdkInventoryEntry], installing: set[str]
) -> ResourceInfo:
    pdk_id = reg_pdk.id
    versions = [v.version for v in reg_pdk.versions]
    latest = reg_pdk.versions[0] if reg_pdk.versions else None
    platform_id = ToolResourceService.current_platform()
    selected_platform = platform_id
    platform_asset = None
    if latest is not None:
        selected_platform, platform_asset = _select_platform_asset(latest)
    inst = installed.get(pdk_id)
    resource_id = f"{_PDK_PREFIX}{pdk_id}"

    if resource_id in installing:
        status = ResourceStatus.installing
        actions: list[ResourceAction] = []
        error = None
    elif inst:
        actionable_update = (
            inst.managed
            and bool(inst.version)
            and latest is not None
            and latest.version != inst.version
            and platform_asset is not None
        )
        status = _pdk_status(inst, update_available=actionable_update)
        actions = [ResourceAction.validate]
        if not inst.active:
            actions.append(ResourceAction.activate)
        if status == ResourceStatus.update_available:
            actions.append(ResourceAction.update)
        if inst.managed:
            actions.append(ResourceAction.uninstall)
        else:
            actions.append(ResourceAction.remove_reference)
        error = None
    elif platform_asset is None:
        status = ResourceStatus.error
        actions = []
        error = f"PDK '{pdk_id}' is not available for {platform_id} or {_ALL_PLATFORM}"
    else:
        status = ResourceStatus.available
        actions = [ResourceAction.install]
        error = None

    return ResourceInfo(
        id=resource_id,
        type=ResourceType.pdk,
        name=pdk_id,
        display_name=reg_pdk.display_name,
        description=reg_pdk.description,
        category=reg_pdk.category,
        status=status,
        installed_version=inst.version if inst and inst.version else None,
        available_versions=versions,
        active_version=inst.version if inst and inst.active and inst.version else None,
        active=inst.active if inst else False,
        path=inst.canonical_path if inst else None,
        managed_root=str(_inventory.pdks_dir),
        platform=selected_platform,
        size=platform_asset.size if platform_asset else None,
        source="registry",
        homepage=reg_pdk.homepage,
        actions=actions,
        health=_pdk_health(inst) if inst else {},
        error=error,
    )


# ── Static routes (must precede dynamic /{resource_id} routes) ─────────


@router.get("", response_model=ResourceList)
async def list_resources():
    """List all resources: tools from registry + installed tools + imported PDKs."""
    registry_svc = _require_registry()
    state = await registry_svc.fetch()
    installed_tools = _tool_service.get_installed()
    imported_pdks = _pdk_service.list_pdks()

    resources: list[ResourceInfo] = []
    seen_tool_names: set[str] = set()
    seen_pdk_ids: set[str] = set()

    if state.registry is not None:
        for reg_tool in state.registry.tools:
            resources.append(_tool_to_resource(reg_tool, installed_tools, _job_tracker._active))
            seen_tool_names.add(reg_tool.name)
        for reg_pdk in state.registry.pdks:
            resources.append(
                _registry_pdk_to_resource(reg_pdk, imported_pdks, _job_tracker._active)
            )
            seen_pdk_ids.add(reg_pdk.id)

    for name, entry in installed_tools.items():
        if name not in seen_tool_names:
            resources.append(_installed_tool_to_resource(name, entry, _job_tracker._active))

    for pdk_id, entry in imported_pdks.items():
        if pdk_id not in seen_pdk_ids:
            resources.append(_pdk_to_resource(entry))

    return ResourceList(resources=resources, diagnostics=state.diagnostics)


@router.post("/pdks/scan")
async def scan_pdk(body: dict):
    """Scan a PDK directory and return metadata without importing."""
    path = body.get("path", "")
    if not path:
        raise HTTPException(status_code=400, detail="Path is required")
    try:
        scanned = _pdk_service.scan(path)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e
    return {
        "canonical_path": scanned.canonical_path,
        "name": scanned.name,
        "description": scanned.description,
        "tech_node": scanned.tech_node,
        "pdk_id": scanned.pdk_id,
        "detected_files": scanned.detected_file_groups,
        "detected_file_list": scanned.detected_files,
    }


@router.post("/pdks/import")
async def import_pdk(body: dict):
    """Import a PDK from a directory path into inventory."""
    path = body.get("path", "")
    if not path:
        raise HTTPException(status_code=400, detail="Path is required")
    try:
        entry = _pdk_service.import_pdk(path)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e
    return _pdk_to_resource(entry)


@router.delete("/pdks/{pdk_id}")
async def remove_pdk_reference(pdk_id: str):
    """Remove a PDK inventory reference (AC-6: never deletes source directory).

    Returns 404 if the PDK is not in inventory."""
    entry = _pdk_service.get_pdk(pdk_id)
    if entry is None:
        raise HTTPException(status_code=404, detail=f"PDK '{pdk_id}' not found")
    managed_error = _managed_pdk_reference_error(entry)
    if managed_error is not None:
        raise HTTPException(status_code=400, detail=managed_error)
    _pdk_service.remove_reference(pdk_id)
    return {"status": "removed", "resource_id": f"{_PDK_PREFIX}{pdk_id}"}


@router.post("/registry/refresh")
async def refresh_registry():
    """Force refresh the tool registry from remote."""
    registry_svc = _require_registry()
    state = await registry_svc.refresh()
    count = len(state.registry.tools) if state.registry else 0
    return {"status": "ok", "tools_count": count, "diagnostics": state.diagnostics}


# ── Batch operation helpers ────────────────────────────────────────────


async def _batch_install(rid: str, action: ResourceAction = ResourceAction.install) -> dict:
    """Look up tool in registry, check platform, and start install/update job."""
    action_value = action.value
    running_status = "updating" if action == ResourceAction.update else "installing"
    name = rid[5:]
    try:
        registry_svc = _require_registry()
    except HTTPException as e:
        return {
            "resource_id": rid,
            "action": action_value,
            "status": e.status_code,
            "error": str(e.detail),
        }

    try:
        _job_tracker.start(rid, action=action)
    except KeyError:
        existing = _job_tracker.get_active(rid)
        return {
            "resource_id": rid,
            "action": action_value,
            "status": 409,
            "detail": {"existing_job_id": existing.job_id if existing else None},
        }

    state = await registry_svc.fetch()

    if state.registry is None:
        _job_tracker.finish(rid)
        return {
            "resource_id": rid,
            "action": action_value,
            "status": 503,
            "error": "Registry unavailable",
        }

    reg_tool = next((t for t in state.registry.tools if t.name == name), None)
    if reg_tool is None or not reg_tool.versions:
        _job_tracker.finish(rid)
        return {
            "resource_id": rid,
            "action": action_value,
            "status": 404,
            "error": f"Tool '{name}' not found",
        }

    version_entry = reg_tool.versions[0]
    plat = ToolResourceService.current_platform()
    asset = version_entry.platforms.get(plat)
    if asset is None:
        _job_tracker.finish(rid)
        return {
            "resource_id": rid,
            "action": action_value,
            "status": 400,
            "error": f"Not available for {plat}",
        }

    asyncio.create_task(_run_install(rid, name, version_entry.version, asset, action))
    return {
        "resource_id": rid,
        "action": action_value,
        "status": 200,
        "detail": {"status": running_status, "version": version_entry.version},
    }


async def _batch_update(rid: str) -> dict:
    """Start a tool update job using the latest registry version."""
    return await _batch_install(rid, ResourceAction.update)


async def _batch_install_pdk(rid: str, action: ResourceAction = ResourceAction.install) -> dict:
    """Start a PDK install/update job using the latest registry version."""
    try:
        result = await _start_pdk_install_or_update(rid, action)
        return {
            "resource_id": rid,
            "action": action.value,
            "status": 200,
            "detail": result,
        }
    except HTTPException as e:
        if isinstance(e.detail, dict):
            return {
                "resource_id": rid,
                "action": action.value,
                "status": e.status_code,
                "detail": e.detail,
            }
        return {
            "resource_id": rid,
            "action": action.value,
            "status": e.status_code,
            "error": str(e.detail),
        }


async def _batch_update_pdk(rid: str) -> dict:
    """Start a PDK update job using the latest registry version."""
    return await _batch_install_pdk(rid, ResourceAction.update)


async def _batch_uninstall(rid: str) -> dict:
    """Uninstall a tool by name."""
    try:
        await _tool_service.uninstall(rid[5:])
        return {
            "resource_id": rid,
            "action": "uninstall",
            "status": 200,
            "detail": {"status": "uninstalled"},
        }
    except PermissionError as e:
        return {
            "resource_id": rid,
            "action": "uninstall",
            "status": 400,
            "error": str(e),
        }
    except KeyError:
        return {
            "resource_id": rid,
            "action": "uninstall",
            "status": 404,
            "error": f"Tool '{rid[5:]}' not installed",
        }


async def _batch_uninstall_pdk(rid: str) -> dict:
    """Uninstall a managed PDK by id."""
    try:
        await _pdk_service.uninstall_managed_pdk(rid[4:])
        return {
            "resource_id": rid,
            "action": "uninstall",
            "status": 200,
            "detail": {"status": "uninstalled"},
        }
    except PermissionError as e:
        return {
            "resource_id": rid,
            "action": "uninstall",
            "status": 400,
            "error": str(e),
        }
    except KeyError:
        return {
            "resource_id": rid,
            "action": "uninstall",
            "status": 404,
            "error": f"PDK '{rid[4:]}' not installed",
        }


def _batch_activate_pdk(rid: str) -> dict:
    """Activate a PDK by id."""
    try:
        _pdk_service.activate(rid[4:])
        return {
            "resource_id": rid,
            "action": "activate",
            "status": 200,
            "detail": {"status": "activated"},
        }
    except KeyError:
        return {
            "resource_id": rid,
            "action": "activate",
            "status": 404,
            "error": f"PDK '{rid[4:]}' not found",
        }


def _batch_validate_pdk(rid: str) -> dict:
    """Validate PDK health."""
    try:
        health = _pdk_service.validate(rid[4:])
        return {
            "resource_id": rid,
            "action": "validate",
            "status": 200,
            "detail": {"health": {"status": health}},
        }
    except KeyError:
        return {
            "resource_id": rid,
            "action": "validate",
            "status": 404,
            "error": f"PDK '{rid[4:]}' not found",
        }


def _batch_remove_pdk_reference(rid: str) -> dict:
    """Remove a PDK inventory reference."""
    entry = _pdk_service.get_pdk(rid[4:])
    if entry is None:
        return {
            "resource_id": rid,
            "action": "remove_reference",
            "status": 404,
            "error": f"PDK '{rid[4:]}' not found",
        }
    managed_error = _managed_pdk_reference_error(entry)
    if managed_error is not None:
        return {
            "resource_id": rid,
            "action": "remove_reference",
            "status": 400,
            "error": managed_error,
        }
    _pdk_service.remove_reference(rid[4:])
    return {
        "resource_id": rid,
        "action": "remove_reference",
        "status": 200,
        "detail": {"status": "removed"},
    }


# ── Batch dispatch table ──────────────────────────────────────────────

_BATCH_DISPATCH: dict[str, dict[str, Callable[..., Any]]] = {
    _TOOL_PREFIX: {
        "install": _batch_install,
        "update": _batch_update,
        "uninstall": _batch_uninstall,
    },
    _PDK_PREFIX: {
        "install": _batch_install_pdk,
        "update": _batch_update_pdk,
        "uninstall": _batch_uninstall_pdk,
        "activate": _batch_activate_pdk,
        "validate": _batch_validate_pdk,
        "remove_reference": _batch_remove_pdk_reference,
    },
}


def _dispatch_batch_operation(rid: str, action: str) -> tuple[Callable[..., Any] | None, str]:
    """Resolve the batch handler for a given resource_id prefix and action.

    Returns (handler, error_message). If handler is None, error_message
    contains the reason.
    """
    for prefix, actions in _BATCH_DISPATCH.items():
        if rid.startswith(prefix):
            handler = actions.get(action)
            if handler is None:
                return None, f"Unsupported action '{action}' for '{rid}'"
            return handler, ""
    # No prefix matched
    return None, f"Unsupported action '{action}' for '{rid}'"


@router.post("/batch")
async def batch_operations(body: dict):
    """Execute batch resource operations."""
    operations = body.get("operations", [])
    results: list[dict] = []

    for op in operations:
        rid = op.get("resource_id", "")
        action = op.get("action", "")

        if not rid or not action:
            results.append(
                {
                    "resource_id": rid,
                    "action": action,
                    "status": 400,
                    "error": "Missing resource_id or action",
                }
            )
            continue

        handler, dispatch_error = _dispatch_batch_operation(rid, action)

        if handler is None:
            results.append(
                {
                    "resource_id": rid,
                    "action": action,
                    "status": 400,
                    "error": dispatch_error,
                }
            )
            continue

        try:
            if asyncio.iscoroutinefunction(handler):
                results.append(await handler(rid))
            else:
                results.append(handler(rid))
        except Exception as e:
            results.append(
                {
                    "resource_id": rid,
                    "action": action,
                    "status": 500,
                    "error": str(e),
                }
            )

    return {"results": results}


@router.get("/doctor")
async def resource_doctor():
    """Diagnostics for the Resource Manager subsystem."""
    diagnostics: list[str] = []
    registry_svc = _require_registry()
    state = await registry_svc.fetch()

    installed_tools = _tool_service.get_installed()
    imported_pdks = _pdk_service.list_pdks()

    if state.is_degraded:
        diagnostics.extend(state.diagnostics)
    if state.registry is None:
        diagnostics.append("No registry loaded")
    else:
        diagnostics.append(f"Registry: {len(state.registry.tools)} tools")

    diagnostics.append(f"Installed tools: {len(installed_tools)}")
    diagnostics.append(f"Imported PDKs: {len(imported_pdks)}")

    active_jobs = len(_job_tracker._active)
    if active_jobs > 0:
        diagnostics.append(f"Active jobs: {active_jobs}")

    return {
        "status": "degraded" if state.is_degraded else "ok",
        "diagnostics": diagnostics,
        "stats": {
            "registry_tools": len(state.registry.tools) if state.registry else 0,
            "installed_tools": len(installed_tools),
            "imported_pdks": len(imported_pdks),
            "active_jobs": active_jobs,
        },
    }


@router.get("/events/{job_id}")
async def resource_job_event_stream(job_id: str, request: Request) -> StreamingResponse:
    """SSE stream for one resource job."""
    channel = f"resource-job:{job_id}"

    async def generate():
        async for response in event_manager.subscribe(channel):
            if await request.is_disconnected():
                break
            if isinstance(response, ResourceJob):
                yield _resource_progress_sse_format(response)

    return StreamingResponse(
        generate(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )


@router.get("/events")
async def resource_all_event_stream(request: Request) -> StreamingResponse:
    """SSE stream for all resource manager events."""
    channel = "resource:*"

    async def generate():
        async for response in event_manager.subscribe(channel):
            if await request.is_disconnected():
                break
            if isinstance(response, ResourceJob):
                yield _resource_progress_sse_format(response)

    return StreamingResponse(
        generate(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )


@router.get("/sse/{resource_id}")
async def resource_event_stream(resource_id: str, request: Request) -> StreamingResponse:
    """Legacy development SSE stream for resource operation progress events."""
    channel = f"resource:{resource_id}"

    async def generate():
        async for response in event_manager.subscribe(channel):
            if await request.is_disconnected():
                break
            if isinstance(response, ResourceJob):
                yield _resource_progress_sse_format(response)

    return StreamingResponse(
        generate(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )


# ── Dynamic resource-id routes ─────────────────────────────────────────


@router.get("/{resource_id}", response_model=ResourceInfo)
async def get_resource(resource_id: str):
    """Get a single resource by id (e.g. tool:yosys or pdk:ics55)."""
    if resource_id.startswith(_TOOL_PREFIX):
        name = resource_id[5:]
        registry_svc = _require_registry()
        state = await registry_svc.fetch()
        installed = _tool_service.get_installed()
        local_entry = installed.get(name)
        if state.registry is None:
            if local_entry is not None:
                return _installed_tool_to_resource(name, local_entry, _job_tracker._active)
            raise HTTPException(status_code=503, detail="Registry unavailable")
        reg_tool = next((t for t in state.registry.tools if t.name == name), None)
        if reg_tool is None and local_entry is not None:
            return _installed_tool_to_resource(name, local_entry, _job_tracker._active)
        if reg_tool is None:
            raise HTTPException(status_code=404, detail=f"Resource '{resource_id}' not found")
        return _tool_to_resource(reg_tool, installed, _job_tracker._active)

    if resource_id.startswith(_PDK_PREFIX):
        pdk_id = resource_id[4:]
        registry_svc = _require_registry()
        state = await registry_svc.fetch()
        installed_pdks = _pdk_service.list_pdks()
        local_entry = installed_pdks.get(pdk_id)
        if state.registry is None:
            if local_entry is not None:
                return _pdk_to_resource(local_entry)
            raise HTTPException(status_code=503, detail="Registry unavailable")
        reg_pdk = next((p for p in state.registry.pdks if p.id == pdk_id), None)
        if reg_pdk is not None:
            return _registry_pdk_to_resource(reg_pdk, installed_pdks, _job_tracker._active)
        if local_entry is not None:
            return _pdk_to_resource(local_entry)
        raise HTTPException(status_code=404, detail=f"Resource '{resource_id}' not found")

    raise HTTPException(status_code=404, detail=f"Resource '{resource_id}' not found")


@router.post("/{resource_id}/install")
async def install_resource(resource_id: str, request: ToolInstallRequest | None = None):
    """Start resource installation. Returns 409 with structured conflict detail."""
    requested_version = request.version if request else None
    if resource_id.startswith(_TOOL_PREFIX):
        return await _start_tool_install_or_update(
            resource_id, ResourceAction.install, requested_version=requested_version
        )
    if resource_id.startswith(_PDK_PREFIX):
        return await _start_pdk_install_or_update(
            resource_id, ResourceAction.install, requested_version=requested_version
        )
    raise HTTPException(status_code=404, detail=f"Resource '{resource_id}' not found")


@router.post("/{resource_id}/update")
async def update_resource(resource_id: str):
    """Start resource update to the latest registry version."""
    if resource_id.startswith(_TOOL_PREFIX):
        return await _start_tool_install_or_update(resource_id, ResourceAction.update)
    if resource_id.startswith(_PDK_PREFIX):
        return await _start_pdk_install_or_update(resource_id, ResourceAction.update)
    raise HTTPException(status_code=404, detail=f"Resource '{resource_id}' not found")


async def _start_pdk_install_or_update(
    resource_id: str,
    action: ResourceAction,
    requested_version: str | None = None,
):
    """Start a PDK install/update job. Returns 409 with structured conflict detail."""
    if not resource_id.startswith(_PDK_PREFIX):
        verb = "updated" if action == ResourceAction.update else "installed"
        raise HTTPException(status_code=400, detail=f"Only PDKs can be {verb}")

    pdk_id = resource_id[4:]
    running_status = "updating" if action == ResourceAction.update else "installing"
    registry_svc = _require_registry()

    try:
        _job_tracker.start(resource_id, action=action)
    except KeyError as e:
        existing = _job_tracker.get_active(resource_id)
        raise HTTPException(
            status_code=409,
            detail={
                "resource_id": resource_id,
                "action": existing.action.value if existing else action.value,
                "status": "conflict",
                "existing_job_id": existing.job_id if existing else None,
                "event_url": existing.event_url if existing else None,
            },
        ) from e

    state = await registry_svc.fetch()
    if state.registry is None:
        _job_tracker.finish(resource_id)
        raise HTTPException(status_code=503, detail="Registry unavailable")

    reg_pdk = next((p for p in state.registry.pdks if p.id == pdk_id), None)
    if reg_pdk is None:
        _job_tracker.finish(resource_id)
        raise HTTPException(status_code=404, detail=f"PDK '{pdk_id}' not found")

    if not reg_pdk.versions:
        _job_tracker.finish(resource_id)
        raise HTTPException(status_code=404, detail=f"No versions available for PDK '{pdk_id}'")

    version_entry = reg_pdk.versions[0]
    if requested_version is not None:
        version_entry = next((v for v in reg_pdk.versions if v.version == requested_version), None)
        if version_entry is None:
            _job_tracker.finish(resource_id)
            raise HTTPException(
                status_code=404,
                detail=f"PDK '{pdk_id}' v{requested_version} not found",
            )

    selected_platform, asset = _select_platform_asset(version_entry)
    if asset is None:
        _job_tracker.finish(resource_id)
        platform_id = ToolResourceService.current_platform()
        raise HTTPException(
            status_code=400,
            detail=(
                f"PDK '{pdk_id}' v{version_entry.version} not available for {platform_id} "
                f"or {_ALL_PLATFORM}"
            ),
        )

    asyncio.create_task(
        _run_pdk_install(
            resource_id=resource_id,
            pdk_id=pdk_id,
            display_name=reg_pdk.display_name,
            version=version_entry.version,
            asset=asset,
            action=action,
        )
    )

    return {
        "status": running_status,
        "resource_id": resource_id,
        "version": version_entry.version,
        "platform": selected_platform,
    }


async def _run_pdk_install(
    *,
    resource_id: str,
    pdk_id: str,
    display_name: str,
    version: str,
    asset,
    action: ResourceAction,
) -> None:
    """Shared install runner used by single and batch PDK install/update routes."""

    def _on_progress(job: ResourceJob) -> None:
        _job_tracker.publish(job)

    try:
        await _pdk_service.install_managed_pdk(
            pdk_id=pdk_id,
            display_name=display_name,
            version=version,
            asset=asset,
            action=action,
            on_progress=_on_progress,
        )
    except Exception as exc:
        logger.exception("PDK install failed for %s", pdk_id)
        detail = str(exc).strip() or f"Installation failed for PDK {pdk_id}"
        _job_tracker.publish(
            ResourceJob(
                resource_id=resource_id,
                action=action,
                phase="error",
                progress=0.0,
                message=detail,
                error=detail,
            )
        )
    finally:
        _job_tracker.finish(resource_id)


async def _start_tool_install_or_update(
    resource_id: str,
    action: ResourceAction,
    requested_version: str | None = None,
):
    """Start a tool install/update job. Returns 409 with structured conflict detail."""
    if not resource_id.startswith(_TOOL_PREFIX):
        verb = "updated" if action == ResourceAction.update else "installed"
        raise HTTPException(status_code=400, detail=f"Only tools can be {verb}")

    name = resource_id[5:]
    running_status = "updating" if action == ResourceAction.update else "installing"
    registry_svc = _require_registry()

    try:
        _job_tracker.start(resource_id, action=action)
    except KeyError as e:
        existing = _job_tracker.get_active(resource_id)
        raise HTTPException(
            status_code=409,
            detail={
                "resource_id": resource_id,
                "action": existing.action.value if existing else "install",
                "status": "conflict",
                "existing_job_id": existing.job_id if existing else None,
                "event_url": existing.event_url if existing else None,
            },
        ) from e

    state = await registry_svc.fetch()
    if state.registry is None:
        _job_tracker.finish(resource_id)
        raise HTTPException(status_code=503, detail="Registry unavailable")

    reg_tool = next((t for t in state.registry.tools if t.name == name), None)
    if reg_tool is None:
        _job_tracker.finish(resource_id)
        raise HTTPException(status_code=404, detail=f"Tool '{name}' not found")

    if not reg_tool.versions:
        _job_tracker.finish(resource_id)
        raise HTTPException(status_code=404, detail=f"No versions available for '{name}'")

    version_entry = reg_tool.versions[0]
    if requested_version is not None:
        version_entry = next((v for v in reg_tool.versions if v.version == requested_version), None)
        if version_entry is None:
            _job_tracker.finish(resource_id)
            raise HTTPException(
                status_code=404,
                detail=f"Tool '{name}' v{requested_version} not found",
            )

    plat = ToolResourceService.current_platform()
    asset = version_entry.platforms.get(plat)
    if asset is None:
        _job_tracker.finish(resource_id)
        raise HTTPException(
            status_code=400,
            detail=f"Tool '{name}' v{version_entry.version} not available for {plat}",
        )

    version = version_entry.version

    asyncio.create_task(_run_install(resource_id, name, version_entry.version, asset, action))

    return {"status": running_status, "resource_id": resource_id, "version": version}


async def _run_install(
    resource_id: str, name: str, version: str, asset, action: ResourceAction
) -> None:
    """Shared install runner used by single and batch install/update routes."""

    def _on_progress(job: ResourceJob) -> None:
        _job_tracker.publish(job)

    try:
        await _tool_service.install(name, version, asset, action=action, on_progress=_on_progress)
    except Exception:
        logger.exception("Install failed for %s", name)
        _job_tracker.publish(
            ResourceJob(
                resource_id=resource_id,
                action=action,
                phase="error",
                progress=0.0,
                message=f"Installation failed for {name}",
                error=f"Installation failed for {name}",
            )
        )
    finally:
        _job_tracker.finish(resource_id)


@router.post("/{resource_id}/uninstall")
async def uninstall_resource(resource_id: str):
    """Uninstall a resource."""
    if resource_id.startswith(_TOOL_PREFIX):
        name = resource_id[5:]
        try:
            await _tool_service.uninstall(name)
        except PermissionError as e:
            raise HTTPException(status_code=400, detail=str(e)) from e
        except KeyError as e:
            raise HTTPException(status_code=404, detail=f"Tool '{name}' is not installed") from e
        return {"status": "uninstalled", "resource_id": resource_id}

    if resource_id.startswith(_PDK_PREFIX):
        pdk_id = resource_id[4:]
        try:
            await _pdk_service.uninstall_managed_pdk(pdk_id)
        except PermissionError as e:
            raise HTTPException(status_code=400, detail=str(e)) from e
        except KeyError as e:
            raise HTTPException(status_code=404, detail=f"PDK '{pdk_id}' is not installed") from e
        return {"status": "uninstalled", "resource_id": resource_id}

    raise HTTPException(status_code=404, detail=f"Resource '{resource_id}' not found")


@router.post("/{resource_id}/activate")
async def activate_resource(resource_id: str):
    """Activate a PDK."""
    if not resource_id.startswith(_PDK_PREFIX):
        raise HTTPException(status_code=400, detail="Only PDKs can be activated")
    pdk_id = resource_id[4:]
    try:
        _pdk_service.activate(pdk_id)
    except KeyError as e:
        raise HTTPException(status_code=404, detail=f"PDK '{pdk_id}' not found") from e
    return {"status": "activated", "resource_id": resource_id}


@router.post("/{resource_id}/validate")
async def validate_resource(resource_id: str):
    """Validate PDK health."""
    if not resource_id.startswith(_PDK_PREFIX):
        raise HTTPException(status_code=400, detail="Only PDKs can be validated")
    pdk_id = resource_id[4:]
    try:
        health = _pdk_service.validate(pdk_id)
    except KeyError as e:
        raise HTTPException(status_code=404, detail=f"PDK '{pdk_id}' not found") from e
    return {"resource_id": resource_id, "health": {"status": health}}


def _resource_progress_sse_format(job: ResourceJob) -> str:
    lines = [
        "event: progress",
        f"data: {job.model_dump_json()}",
        "",
    ]
    return "\n".join(lines) + "\n"
