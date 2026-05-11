#!/usr/bin/env python

import asyncio
import logging
import os
import platform
import shutil
from pathlib import Path

from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import StreamingResponse

from ecos_server.sse import event_manager

from .schemas import InstallProgress, InstallRequest, ToolInfo, ToolStatus
from .services import InstallerService, ManagerService, RegistryService

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/plugin", tags=["plugin"])

_manager = ManagerService()
_registry = RegistryService(
    registry_url=os.environ.get(
        "ECOS_REGISTRY_URL",
        "https://github.com/openecos-projects/ecos-registry/releases/latest/download/tool-registry.json",
    )
)
_installer = InstallerService(manager=_manager)

_installing: set[str] = set()


def _current_platform() -> str:
    system = platform.system().lower()
    machine = platform.machine().lower().replace("amd64", "x86_64")
    if system == "linux":
        return f"linux-{machine}"
    if system == "darwin":
        return f"darwin-{machine}"
    return f"{system}-{machine}"


def _merge_tool_list(registry, installed: dict) -> list[ToolInfo]:
    if registry is None:
        return []
    tools: list[ToolInfo] = []
    for rt in registry.tools:
        versions = [v.version for v in rt.versions]
        inst = installed.get(rt.name)
        if rt.name in _installing:
            status = ToolStatus.installing
        elif inst:
            installed_ver = inst["version"]
            if versions and versions[0] != installed_ver:
                status = ToolStatus.update_available
            else:
                status = ToolStatus.installed
        else:
            status = ToolStatus.available

        tools.append(
            ToolInfo(
                name=rt.name,
                display_name=rt.display_name,
                description=rt.description,
                category=rt.category,
                status=status,
                installed_version=inst["version"] if inst else None,
                available_versions=versions,
                install_path=inst["path"] if inst else None,
            )
        )
    return tools


@router.get("/tools", response_model=list[ToolInfo])
async def list_tools() -> list[ToolInfo]:
    registry = await _registry.fetch()
    installed = _manager.get_installed()
    return _merge_tool_list(registry, installed)


@router.get("/tools/{name}/status", response_model=ToolInfo)
async def get_tool_status(name: str) -> ToolInfo:
    registry = await _registry.fetch()
    installed = _manager.get_installed()
    tools = _merge_tool_list(registry, installed)
    for t in tools:
        if t.name == name:
            return t
    raise HTTPException(status_code=404, detail=f"Tool '{name}' not found")


@router.post("/tools/{name}/install")
async def install_tool(name: str, body: InstallRequest | None = None) -> dict:
    if name in _installing:
        raise HTTPException(status_code=409, detail=f"Tool '{name}' is already installing")

    registry = await _registry.fetch()
    if registry is None:
        raise HTTPException(status_code=503, detail="Registry unavailable")

    reg_tool = next((t for t in registry.tools if t.name == name), None)
    if reg_tool is None:
        raise HTTPException(status_code=404, detail=f"Tool '{name}' not found in registry")

    requested_version = body.version if body else None
    version_entry = None
    if requested_version:
        for v in reg_tool.versions:
            if v.version == requested_version:
                version_entry = v
                break
    elif reg_tool.versions:
        version_entry = reg_tool.versions[0]

    if version_entry is None:
        raise HTTPException(status_code=404, detail=f"Version not found for '{name}'")

    plat = _current_platform()
    asset = version_entry.platforms.get(plat)
    if asset is None:
        raise HTTPException(
            status_code=400,
            detail=f"Tool '{name}' v{version_entry.version} not available for {plat}",
        )

    _installing.add(name)
    asyncio.create_task(_run_install(name, version_entry.version, asset))

    return {"status": "installing", "tool": name, "version": version_entry.version}


async def _run_install(name: str, version: str, asset) -> None:
    import tempfile

    tools_dir = _manager.tools_dir
    dest_dir = tools_dir / name / version

    def _publish_progress(phase: str, progress: float, message: str) -> None:
        event_manager.publish(
            f"plugin:{name}",
            InstallProgress(tool=name, phase=phase, progress=progress, message=message),
        )

    try:
        _publish_progress("downloading", 0.0, f"Downloading {name} v{version}...")

        with tempfile.TemporaryDirectory() as tmp:
            archive_path = Path(tmp) / f"{name}.archive"

            def on_download_progress(pct: float) -> None:
                _publish_progress("downloading", pct, f"Downloading... {pct:.0%}")

            await _installer.download(
                url=asset.url,
                dest=archive_path,
                expected_size=asset.size,
                on_progress=on_download_progress,
            )

            _publish_progress("verifying", 0.0, "Verifying SHA256...")
            ok = await asyncio.to_thread(InstallerService.verify_sha256, archive_path, asset.sha256)
            if not ok:
                _publish_progress("error", 0.0, "SHA256 verification failed")
                return

            _publish_progress("extracting", 0.0, f"Extracting to {dest_dir}...")
            await asyncio.to_thread(
                _installer.extract,
                archive_path,
                dest_dir,
                asset.strip_prefix,
            )

        _manager.add_tool(
            name=name,
            version=version,
            path=str(dest_dir),
            sha256=asset.sha256,
        )
        _publish_progress("done", 1.0, f"{name} v{version} installed successfully")

    except Exception:
        logger.exception("Install failed for %s v%s", name, version)
        _publish_progress("error", 0.0, f"Installation failed for {name}")
    finally:
        _installing.discard(name)


@router.post("/tools/{name}/uninstall")
async def uninstall_tool(name: str) -> dict:
    installed = _manager.get_installed()
    if name not in installed:
        raise HTTPException(status_code=404, detail=f"Tool '{name}' is not installed")

    tool_path = Path(installed[name]["path"])
    if tool_path.exists():
        await asyncio.to_thread(shutil.rmtree, tool_path)

    _manager.remove_tool(name)
    return {"status": "uninstalled", "tool": name}


def _install_progress_sse_format(progress: InstallProgress) -> str:
    lines = [
        "event: progress",
        f"data: {progress.model_dump_json()}",
        "",
    ]
    return "\n".join(lines) + "\n"


@router.get("/sse/{tool_name}")
async def plugin_event_stream(tool_name: str, request: Request) -> StreamingResponse:
    channel = f"plugin:{tool_name}"

    async def generate():
        async for response in event_manager.subscribe(channel):
            if await request.is_disconnected():
                break
            if isinstance(response, InstallProgress):
                yield _install_progress_sse_format(response)

    return StreamingResponse(
        generate(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )


@router.post("/registry/refresh")
async def refresh_registry() -> dict:
    registry = await _registry.fetch(force=True)
    count = len(registry.tools) if registry else 0
    return {"status": "ok", "tools_count": count}
