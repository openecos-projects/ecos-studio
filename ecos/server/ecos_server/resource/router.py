#!/usr/bin/env python

import asyncio
import logging
from pathlib import Path

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
    inst = installed.get(name)
    resource_id = f"tool:{name}"

    if name in installing:
        status = ResourceStatus.installing
        actions = []
    elif inst:
        if versions and versions[0] != inst.version:
            status = ResourceStatus.update_available
        else:
            status = ResourceStatus.installed
        actions = [ResourceAction.uninstall]
        if status == ResourceStatus.update_available:
            actions.insert(0, ResourceAction.install)
    else:
        status = ResourceStatus.available
        actions = [ResourceAction.install]

    return ResourceInfo(
        id=resource_id,
        type=ResourceType.tool,
        display_name=reg_tool.display_name,
        description=reg_tool.description,
        category=reg_tool.category,
        status=status,
        installed_version=inst.version if inst else None,
        available_versions=versions,
        install_path=inst.path if inst else None,
        homepage=reg_tool.homepage,
        actions=actions,
    )


def _pdk_to_resource(entry: PdkInventoryEntry) -> ResourceInfo:
    if entry.health == "missing":
        status = ResourceStatus.missing
    elif entry.health == "invalid":
        status = ResourceStatus.invalid
    else:
        status = ResourceStatus.installed

    actions = [ResourceAction.validate]
    if not entry.active:
        actions.append(ResourceAction.activate)
    actions.append(ResourceAction.remove_reference)

    return ResourceInfo(
        id=f"pdk:{entry.id}",
        type=ResourceType.pdk,
        display_name=entry.name or entry.id,
        description="",
        category="pdk",
        status=status,
        active=entry.active,
        health=entry.health,
        canonical_path=entry.canonical_path,
        installed_version=None,
        available_versions=[],
        install_path=None,
        actions=actions,
        metadata={
            "detected_files": entry.detected_files,
            "imported_at": entry.imported_at,
            "managed": entry.managed,
        },
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

    if state.registry is not None:
        for reg_tool in state.registry.tools:
            resources.append(_tool_to_resource(reg_tool, installed_tools, _job_tracker._active))

    for entry in imported_pdks.values():
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
        raise HTTPException(status_code=400, detail=str(e))
    return {
        "canonical_path": scanned.canonical_path,
        "name": scanned.name,
        "description": scanned.description,
        "tech_node": scanned.tech_node,
        "pdk_id": scanned.pdk_id,
        "detected_files": scanned.detected_files,
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
        raise HTTPException(status_code=400, detail=str(e))
    return _pdk_to_resource(entry)


@router.delete("/pdks/{pdk_id}")
async def remove_pdk_reference(pdk_id: str):
    """Remove a PDK inventory reference (AC-6: never deletes source directory).

    Returns 404 if the PDK is not in inventory."""
    if _pdk_service.get_pdk(pdk_id) is None:
        raise HTTPException(status_code=404, detail=f"PDK '{pdk_id}' not found")
    _pdk_service.remove_reference(pdk_id)
    return {"status": "removed", "resource_id": f"pdk:{pdk_id}"}


@router.post("/registry/refresh")
async def refresh_registry():
    """Force refresh the tool registry from remote."""
    registry_svc = _require_registry()
    state = await registry_svc.refresh()
    count = len(state.registry.tools) if state.registry else 0
    return {"status": "ok", "tools_count": count, "diagnostics": state.diagnostics}


@router.post("/batch")
async def batch_operations(body: dict):
    """Execute batch resource operations."""
    operations = body.get("operations", [])
    results: list[dict] = []
    for op in operations:
        rid = op.get("resource_id", "")
        action = op.get("action", "")
        if not rid or not action:
            results.append({"resource_id": rid, "action": action, "status": 400, "error": "Missing resource_id or action"})
            continue
        try:
            if action == "install" and rid.startswith("tool:"):
                if _job_tracker.is_active(rid):
                    existing = _job_tracker.get_active(rid)
                    results.append({"resource_id": rid, "action": action, "status": 409, "detail": {"existing_job_id": existing.job_id if existing else None}})
                    continue
                name = rid[5:]
                registry_svc = _require_registry()
                state = await registry_svc.fetch()
                if state.registry is None:
                    results.append({"resource_id": rid, "action": action, "status": 503, "error": "Registry unavailable"})
                    continue
                reg_tool = next((t for t in state.registry.tools if t.name == name), None)
                if reg_tool is None or not reg_tool.versions:
                    results.append({"resource_id": rid, "action": action, "status": 404, "error": f"Tool '{name}' not found"})
                    continue
                version_entry = reg_tool.versions[0]
                plat = ToolResourceService.current_platform()
                asset = version_entry.platforms.get(plat)
                if asset is None:
                    results.append({"resource_id": rid, "action": action, "status": 400, "error": f"Not available for {plat}"})
                    continue
                _job_tracker.start(rid, action=ResourceAction.install)
                asyncio.create_task(_run_install(rid, name, version_entry.version, asset))
                results.append({"resource_id": rid, "action": action, "status": 200, "detail": {"status": "installing", "version": version_entry.version}})
            elif action == "uninstall" and rid.startswith("tool:"):
                try:
                    await _tool_service.uninstall(rid[5:])
                    results.append({"resource_id": rid, "action": action, "status": 200, "detail": {"status": "uninstalled"}})
                except KeyError:
                    results.append({"resource_id": rid, "action": action, "status": 404, "error": f"Tool '{rid[5:]}' not installed"})
            elif action == "activate" and rid.startswith("pdk:"):
                try:
                    _pdk_service.activate(rid[4:])
                    results.append({"resource_id": rid, "action": action, "status": 200, "detail": {"status": "activated"}})
                except KeyError:
                    results.append({"resource_id": rid, "action": action, "status": 404, "error": f"PDK '{rid[4:]}' not found"})
            elif action == "validate" and rid.startswith("pdk:"):
                try:
                    health = _pdk_service.validate(rid[4:])
                    results.append({"resource_id": rid, "action": action, "status": 200, "detail": {"health": health}})
                except KeyError:
                    results.append({"resource_id": rid, "action": action, "status": 404, "error": f"PDK '{rid[4:]}' not found"})
            elif action == "remove_reference" and rid.startswith("pdk:"):
                _pdk_service.remove_reference(rid[4:])
                results.append({"resource_id": rid, "action": action, "status": 200, "detail": {"status": "removed"}})
            else:
                results.append({"resource_id": rid, "action": action, "status": 400, "error": f"Unsupported action '{action}' for '{rid}'"})
        except Exception as e:
            results.append({"resource_id": rid, "action": action, "status": 500, "error": str(e)})
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


@router.get("/sse/{resource_id}")
async def resource_event_stream(resource_id: str, request: Request) -> StreamingResponse:
    """SSE stream for resource operation progress events."""
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
    if resource_id.startswith("tool:"):
        name = resource_id[5:]
        registry_svc = _require_registry()
        state = await registry_svc.fetch()
        if state.registry is None:
            raise HTTPException(status_code=503, detail="Registry unavailable")
        reg_tool = next((t for t in state.registry.tools if t.name == name), None)
        if reg_tool is None:
            raise HTTPException(status_code=404, detail=f"Resource '{resource_id}' not found")
        installed = _tool_service.get_installed()
        return _tool_to_resource(reg_tool, installed, _job_tracker._active)

    if resource_id.startswith("pdk:"):
        pdk_id = resource_id[4:]
        entry = _pdk_service.get_pdk(pdk_id)
        if entry is None:
            raise HTTPException(status_code=404, detail=f"Resource '{resource_id}' not found")
        return _pdk_to_resource(entry)

    raise HTTPException(status_code=404, detail=f"Resource '{resource_id}' not found")


@router.post("/{resource_id}/install")
async def install_resource(resource_id: str):
    """Start tool installation. Returns 409 with structured conflict detail."""
    if not resource_id.startswith("tool:"):
        raise HTTPException(status_code=400, detail="Only tools can be installed")

    name = resource_id[5:]

    if _job_tracker.is_active(resource_id):
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
        )

    registry_svc = _require_registry()
    state = await registry_svc.fetch()
    if state.registry is None:
        raise HTTPException(status_code=503, detail="Registry unavailable")

    reg_tool = next((t for t in state.registry.tools if t.name == name), None)
    if reg_tool is None:
        raise HTTPException(status_code=404, detail=f"Tool '{name}' not found")

    if not reg_tool.versions:
        raise HTTPException(status_code=404, detail=f"No versions available for '{name}'")

    version_entry = reg_tool.versions[0]
    plat = ToolResourceService.current_platform()
    asset = version_entry.platforms.get(plat)
    if asset is None:
        raise HTTPException(
            status_code=400,
            detail=f"Tool '{name}' v{version_entry.version} not available for {plat}",
        )

    version = version_entry.version
    _job_tracker.start(resource_id, action=ResourceAction.install)

    asyncio.create_task(_run_install(resource_id, name, version_entry.version, asset))

    return {"status": "installing", "resource_id": resource_id, "version": version}


async def _run_install(resource_id: str, name: str, version: str, asset) -> None:
    """Shared install runner used by both single and batch install routes."""

    def _on_progress(job: ResourceJob) -> None:
        _job_tracker.publish(job)

    try:
        await _tool_service.install(name, version, asset, on_progress=_on_progress)
    except Exception:
        logger.exception("Install failed for %s", name)
        _job_tracker.publish(
            ResourceJob(
                resource_id=resource_id,
                action=ResourceAction.install,
                phase="error",
                progress=0.0,
                message=f"Installation failed for {name}",
            )
        )
    finally:
        _job_tracker.finish(resource_id)


@router.post("/{resource_id}/uninstall")
async def uninstall_resource(resource_id: str):
    """Uninstall a tool."""
    if not resource_id.startswith("tool:"):
        raise HTTPException(status_code=400, detail="Only tools can be uninstalled")

    name = resource_id[5:]
    try:
        await _tool_service.uninstall(name)
    except KeyError:
        raise HTTPException(status_code=404, detail=f"Tool '{name}' is not installed")

    return {"status": "uninstalled", "resource_id": resource_id}


@router.post("/{resource_id}/activate")
async def activate_resource(resource_id: str):
    """Activate a PDK."""
    if not resource_id.startswith("pdk:"):
        raise HTTPException(status_code=400, detail="Only PDKs can be activated")
    pdk_id = resource_id[4:]
    try:
        _pdk_service.activate(pdk_id)
    except KeyError:
        raise HTTPException(status_code=404, detail=f"PDK '{pdk_id}' not found")
    return {"status": "activated", "resource_id": resource_id}


@router.post("/{resource_id}/validate")
async def validate_resource(resource_id: str):
    """Validate PDK health."""
    if not resource_id.startswith("pdk:"):
        raise HTTPException(status_code=400, detail="Only PDKs can be validated")
    pdk_id = resource_id[4:]
    try:
        health = _pdk_service.validate(pdk_id)
    except KeyError:
        raise HTTPException(status_code=404, detail=f"PDK '{pdk_id}' not found")
    return {"resource_id": resource_id, "health": health}


@router.delete("/{resource_id}")
async def remove_resource_reference(resource_id: str):
    """Remove a PDK reference (inventory only, not source directory)."""
    if not resource_id.startswith("pdk:"):
        raise HTTPException(status_code=400, detail="Only PDK references can be removed")
    pdk_id = resource_id[4:]
    _pdk_service.remove_reference(pdk_id)
    return {"status": "removed", "resource_id": resource_id}


def _resource_progress_sse_format(job: ResourceJob) -> str:
    lines = [
        "event: progress",
        f"data: {job.model_dump_json()}",
        "",
    ]
    return "\n".join(lines) + "\n"
