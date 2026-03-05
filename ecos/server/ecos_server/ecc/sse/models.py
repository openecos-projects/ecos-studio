#!/usr/bin/env python
# -*- encoding: utf-8 -*-
"""
SSE 通知模型定义
"""

from ..schemas import ECCResponse, CMDEnum


def to_sse_format(response: ECCResponse) -> str:
    """
    将 ECCResponse 转换为 SSE 格式字符串

    Args:
        response: ECCResponse 实例

    Returns:
        SSE 格式的字符串
    """
    lines = [
        f"event: {CMDEnum.notify.value}",
        f"data: {response.model_dump_json()}",
        "",  # SSE 消息以空行结束
    ]
    return "\n".join(lines) + "\n"
