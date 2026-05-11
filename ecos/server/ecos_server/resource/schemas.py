#!/usr/bin/env python

from enum import StrEnum

from pydantic import BaseModel, Field, field_validator


# ── Enums ──────────────────────────────────────────────────────────────

class ResourceType(StrEnum):
    tool = "tool"
    pdk = "pdk"


class ResourceStatus(StrEnum):
    available = "available"
    installing = "installing"
    installed = "installed"
    update_available = "update_available"
    uninstalling = "uninstalling"
    error = "error"
    missing = "missing"
    invalid = "invalid"
    removing = "removing"


class ResourceAction(StrEnum):
    install = "install"
    uninstall = "uninstall"
    validate = "validate"
    activate = "activate"
    remove_reference = "remove_reference"


# ── Resource API models ────────────────────────────────────────────────

class ResourceJob(BaseModel):
    resource_id: str
    action: ResourceAction
    phase: str
    progress: float = 0.0
    message: str = ""


class ResourceInfo(BaseModel):
    id: str
    type: ResourceType
    display_name: str
    description: str = ""
    category: str = ""
    status: ResourceStatus = ResourceStatus.available
    active: bool = False
    installed_version: str | None = None
    available_versions: list[str] = Field(default_factory=list)
    install_path: str | None = None
    health: str | None = None
    canonical_path: str | None = None
    homepage: str = ""
    actions: list[ResourceAction] = Field(default_factory=list)
    metadata: dict = Field(default_factory=dict)


class ResourceList(BaseModel):
    resources: list[ResourceInfo]
    diagnostics: list[str] = Field(default_factory=list)


# ── Registry schemas ───────────────────────────────────────────────────

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
    """Flat tools list — used for backward compat serialization."""
    schema_version: int
    tools: list[RegistryTool]


class ResourceRegistryV1(BaseModel):
    """Resource Manager registry schema.

    Supported schema versions: 2 (current). Reserves pdks field.
    """

    schema_version: int
    tools: list[RegistryTool] = Field(default_factory=list)
    pdks: list = Field(default_factory=list)

    @field_validator("schema_version")
    @classmethod
    def check_supported_version(cls, v: int) -> int:
        if v != 2:
            raise ValueError(f"Unsupported registry schema version: {v}. Expected: 2")
        return v
