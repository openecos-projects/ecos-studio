#!/usr/bin/env python

from enum import StrEnum

from pydantic import BaseModel, Field


class ToolStatus(StrEnum):
    available = "available"
    installing = "installing"
    installed = "installed"
    update_available = "update_available"
    uninstalling = "uninstalling"
    error = "error"


class PlatformAsset(BaseModel):
    url: str
    sha256: str
    size: int
    strip_prefix: str | None = None


class RegistryToolVersion(BaseModel):
    version: str
    platforms: dict[str, PlatformAsset]
    requires: list[str] = Field(default_factory=list)


class RegistryTool(BaseModel):
    name: str
    display_name: str
    description: str
    category: str
    homepage: str
    versions: list[RegistryToolVersion]


class ToolRegistry(BaseModel):
    schema_version: int
    tools: list[RegistryTool]


class ToolInfo(BaseModel):
    name: str
    display_name: str
    description: str
    category: str
    status: ToolStatus = ToolStatus.available
    installed_version: str | None = None
    available_versions: list[str] = Field(default_factory=list)
    install_path: str | None = None


class InstallProgress(BaseModel):
    tool: str
    phase: str
    progress: float
    message: str


class InstallRequest(BaseModel):
    version: str | None = None
