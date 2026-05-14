#!/usr/bin/env python

import os
from pathlib import Path


def xdg_data_home() -> Path:
    raw = os.environ.get("XDG_DATA_HOME", "").strip()
    return Path(raw) if raw else Path.home() / ".local" / "share"


def xdg_state_home() -> Path:
    raw = os.environ.get("XDG_STATE_HOME", "").strip()
    return Path(raw) if raw else Path.home() / ".local" / "state"


def xdg_cache_home() -> Path:
    raw = os.environ.get("XDG_CACHE_HOME", "").strip()
    return Path(raw) if raw else Path.home() / ".cache"


def ecos_data_dir() -> Path:
    return xdg_data_home() / "ecos-studio"


def ecos_state_dir() -> Path:
    return xdg_state_home() / "ecos-studio"


def ecos_cache_dir() -> Path:
    return xdg_cache_home() / "ecos-studio"


def default_resources_dir() -> Path:
    return ecos_state_dir() / "resources"


def default_tools_dir() -> Path:
    return ecos_data_dir() / "tools"


def default_pdks_dir() -> Path:
    return ecos_data_dir() / "pdks"


def default_registry_cache_dir() -> Path:
    return ecos_cache_dir()
