#!/usr/bin/env python
# -*- encoding: utf-8 -*-
"""
NotifyService - 全局通知服务单例

提供全局的 SSE 通知能力，基于 workspace 进行通知分发。
"""

from typing import Optional

from ..schemas import ECCResponse
from ecos_server.sse import event_manager


class NotifyService:
    """
    全局通知服务

    基于 workspace_id 管理通知分发。当 ECCService 加载或创建 workspace 时，
    会设置当前的 workspace_id，之后任何函数都可以通过 notify() 发送通知。

    # 设置 workspace
    set_workspace(workspace_id)

    # 发送通知（自动使用当前 workspace_id）
    notify(ECCResponse(...))

    # 清除 workspace
    clear_workspace()
    """

    def __init__(self):
        self._workspace_id: Optional[str] = None

    @property
    def workspace_id(self) -> Optional[str]:
        """获取当前 workspace_id"""
        return self._workspace_id

    def set_workspace(self, workspace_id: str) -> None:
        """
        设置当前 workspace ID

        Args:
            workspace_id: workspace 目录路径或唯一标识
        """
        self._workspace_id = workspace_id

    def clear_workspace(self) -> None:
        """清除当前 workspace ID"""
        self._workspace_id = None

    def get_workspace_id(self) -> Optional[str]:
        """
        获取当前 workspace ID

        Returns:
            当前 workspace ID，如果未设置则返回 None
        """
        return self._workspace_id

    def has_workspace(self) -> bool:
        """
        检查是否有当前 workspace

        Returns:
            是否已设置 workspace ID
        """
        return self._workspace_id is not None

    def notify(self, response: ECCResponse, workspace_id: Optional[str] = None) -> bool:
        """
        发送通知

        Args:
            response: ECCResponse 通知对象
            workspace_id: 可选的 workspace ID，如果不提供则使用当前 workspace ID

        Returns:
            是否成功发送（如果没有 workspace_id 则返回 False）
        """
        target_id = workspace_id or self._workspace_id

        if target_id is None:
            return False

        event_manager.notify(workspace_id=target_id,
                             response=response)
        return True

    def notify_to(self, workspace_id: str, response: ECCResponse) -> None:
        """
        向指定 workspace 发送通知

        Args:
            workspace_id: 目标 workspace ID
            response: ECCResponse 通知对象
        """
        event_manager.notify(workspace_id=workspace_id,
                             response=response)

    def notify_step(self, step : str, step_path : str, home_page : str, log_file : str = ""):
        """
        update step status for home page
        "response" : {
            "step" : "",
            "id" : "",
            "info" : {
                "step_path" : "",
                "home_page" : "",
                "log_file" : ""
            }
        }
        """
        from ..schemas.ecc import CMDEnum, ResponseEnum
        from ..schemas.info import NotifyEnum
        response = ECCResponse(
            cmd=CMDEnum.notify.value,
            response=ResponseEnum.success.value,
            data={
                "step": step,
                "id" : NotifyEnum.step.value,
                "info": {
                    "step_path" : step_path,
                    "home_page" : home_page,
                    "log_file" : log_file
                }
            },

            message=[f"update step {step} status."]
        )

        self.notify(response=response)

    def notify_subflow(self,
                       step : str,
                       subflow_path : str,
                       home_page : str=""):
        """
        update subflow status for step page
        "response" : {
            "step" : "",
            "id" : "",
            "info" : {
                "home_page" : "", # if home_page = "", don't need to update home page
                "subflow_path" : ""
            }
        }
        """
        from ..schemas.ecc import CMDEnum, ResponseEnum
        from ..schemas.info import NotifyEnum
        response = ECCResponse(
            cmd=CMDEnum.notify.value,
            response=ResponseEnum.success.value,
            data={
                "step": step,
                "id" : NotifyEnum.subflow.value,
                "info": {
                    "home_page" : home_page,
                    "subflow_path" : subflow_path
                }
            },

            message=[f"update step {step} status."]
        )

        self.notify(response=response)
