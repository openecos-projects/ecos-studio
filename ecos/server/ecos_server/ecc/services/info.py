#!/usr/bin/env python
# -*- encoding: utf-8 -*-

from enum import Enum
from chipcompiler.data import Workspace, WorkspaceStep

def get_step_info(workspace: Workspace,
                  step: WorkspaceStep,
                  id : str) -> dict:
    from chipcompiler.tools import get_step_info
    return get_step_info(workspace=workspace,
                         step=step,
                         id=id)
