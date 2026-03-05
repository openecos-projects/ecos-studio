#!/usr/bin/env python
# -*- encoding: utf-8 -*-
"""
SSE 路由端点
"""

import asyncio
from fastapi import APIRouter, Request
from fastapi.responses import StreamingResponse

from ecos_server.sse import event_manager
from ..sse import to_sse_format
from ..schemas import ECCResponse, CMDEnum, ResponseEnum

router = APIRouter(prefix="/sse", tags=["sse"])


@router.get("/stream/{workspace_id:path}")
async def event_stream(workspace_id: str, request: Request):
    """
    SSE 事件流端点

    订阅指定 workspace 的事件流，实时接收通知。

    Args:
        workspace_id: Workspace ID（通常为 workspace 目录路径）
        request: FastAPI 请求对象

    Returns:
        StreamingResponse: SSE 事件流
    """

    async def generate():
        # 启动心跳任务
        heartbeat_task = asyncio.create_task(heartbeat_loop(workspace_id))

        try:
            async for response in event_manager.subscribe(workspace_id):
                # 检查客户端是否断开
                if await request.is_disconnected():
                    break

                # 发送 SSE 格式的消息
                yield to_sse_format(response)

        finally:
            heartbeat_task.cancel()
            try:
                await heartbeat_task
            except asyncio.CancelledError:
                pass

    return StreamingResponse(
        generate(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",  # 禁用 nginx 缓冲
        }
    )


async def heartbeat_loop(workspace_id: str):
    """
    心跳循环，定期发送心跳保持连接

    Args:
        workspace_id: Workspace ID
    """
    while True:
        await asyncio.sleep(15)  # 每 15 秒发送心跳
        event_manager.notify(workspace_id, ECCResponse(
            cmd=CMDEnum.notify.value,
            response=ResponseEnum.success.value,
            data={"type": "heartbeat"},
            message=[]
        ))


@router.get("/health")
async def sse_health():
    """SSE 服务健康检查"""
    return {"status": "ok", "service": "sse"}
