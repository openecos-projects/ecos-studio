#!/usr/bin/env python

from enum import StrEnum

from pydantic import BaseModel, Field


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
