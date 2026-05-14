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
    update = "update"
    uninstall = "uninstall"
    validate = "validate"
    activate = "activate"
    remove_reference = "remove_reference"


# ── Resource API models ────────────────────────────────────────────────


class ResourceJob(BaseModel):
    id: str = ""
    resource_id: str
    action: ResourceAction
    phase: str
    progress: float = 0.0
    message: str = ""
    error: str | None = None


class ResourceInfo(BaseModel):
    id: str
    type: ResourceType
    name: str
    display_name: str
    description: str = ""
    category: str = ""
    status: ResourceStatus = ResourceStatus.available
    installed_version: str | None = None
    available_versions: list[str] = Field(default_factory=list)
    active_version: str | None = None
    active: bool = False
    path: str | None = None
    managed_root: str | None = None
    platform: str | None = None
    size: int | None = None
    source: str = "local"
    homepage: str = ""
    actions: list[ResourceAction] = Field(default_factory=list)
    health: dict[str, object] = Field(default_factory=dict)
    error: str | None = None


class ResourceList(BaseModel):
    resources: list[ResourceInfo]
    diagnostics: list[str] = Field(default_factory=list)


class ToolInstallRequest(BaseModel):
    version: str | None = None


# ── Registry schemas ───────────────────────────────────────────────────


class PostInstallStep(BaseModel):
    command: list[str]
    cwd: str = "."


class PlatformAsset(BaseModel):
    url: str
    sha256: str
    size: int
    strip_prefix: str | None = None
    post_install: list[PostInstallStep] = Field(default_factory=list)


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


class RegistryPdkVersion(BaseModel):
    version: str
    platforms: dict[str, PlatformAsset]


class RegistryPdk(BaseModel):
    id: str
    display_name: str
    description: str = ""
    category: str = "pdk"
    homepage: str = ""
    versions: list[RegistryPdkVersion] = Field(default_factory=list)


class ToolRegistry(BaseModel):
    """Flat tools list used by Resource Manager services."""

    schema_version: int
    tools: list[RegistryTool] = Field(default_factory=list)
    pdks: list[RegistryPdk] = Field(default_factory=list)


class ResourceRegistryV1(BaseModel):
    """Resource Manager registry schema.

    Supported schema versions: 2 (current). Reserves pdks field.
    """

    schema_version: int
    tools: list[RegistryTool] = Field(default_factory=list)
    pdks: list[RegistryPdk] = Field(default_factory=list)

    @field_validator("schema_version")
    @classmethod
    def check_supported_version(cls, v: int) -> int:
        if v != 2:
            raise ValueError(f"Unsupported registry schema version: {v}. Expected: 2")
        return v
