#!/usr/bin/env python
# -*- encoding: utf-8 -*-

from enum import Enum
from pydantic import BaseModel

class CMDEnum(Enum):
    home_page = "home_page"
    create_workspace = "create_workspace"
    set_pdk_root = "set_pdk_root"
    load_workspace = "load_workspace"
    delete_workspace = "delete_workspace"
    rtl2gds = "rtl2gds"
    run_step = "run_step"
    get_info = "get_info"
    notify = "notify"

class ResponseEnum(Enum):
    success = "success"
    failed = "failed"
    error = "error"
    warning = "warning"

class ECCRequest(BaseModel):
    """
    """
    cmd : str
    data : dict

class ECCResponse(BaseModel):
    """
    """
    cmd : str
    response : str
    data : dict
    message : list
