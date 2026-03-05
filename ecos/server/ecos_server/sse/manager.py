#!/usr/bin/env python
# -*- encoding: utf-8 -*-
"""
SSE 事件管理器 - 支持事件缓冲和跨线程发布
"""

import asyncio
import threading
import time
from collections import defaultdict
from typing import AsyncGenerator, Optional

from pydantic import BaseModel


# 事件缓冲配置
EVENT_BUFFER_MAX_SIZE = 100      # 每个 workspace 最多缓存的事件数
EVENT_BUFFER_TTL_SECONDS = 60    # 缓存事件的最大存活时间（秒）


class EventManager:
    """
    SSE 事件管理器

    负责管理 SSE 连接和事件分发。

    特性：
    - 线程安全：支持从非事件循环线程（如 daemon 线程）发布事件
    - 事件缓冲：当没有订阅者时缓存事件，订阅者连接后补发，避免竞态条件导致的事件丢失
    """

    def __init__(self):
        # 每个 workspace_id 的订阅者队列列表
        self._subscribers: dict[str, list[asyncio.Queue]] = defaultdict(list)
        # 事件循环引用（在 subscribe 时捕获）
        self._loop: Optional[asyncio.AbstractEventLoop] = None
        # 保护 _subscribers 和 _event_buffer 的锁（用于跨线程访问）
        self._lock = threading.Lock()
        # 事件缓冲区：workspace_id -> [(timestamp, response), ...]
        self._event_buffer: dict[str, list[tuple[float, BaseModel]]] = defaultdict(list)

    def _put_to_queue(self, queue: asyncio.Queue, response: BaseModel) -> None:
        """
        安全地将通知放入队列（在事件循环线程中执行）
        """
        try:
            queue.put_nowait(response)
        except asyncio.QueueFull:
            # 队列已满，跳过（避免阻塞）
            pass

    def _buffer_event(self, workspace_id: str, response: BaseModel) -> None:
        """
        缓冲事件（当没有订阅者时调用）

        注意：调用时必须持有 _lock
        """
        buffer = self._event_buffer[workspace_id]

        # 清理过期事件
        current_time = time.time()
        buffer[:] = [
            (ts, evt) for ts, evt in buffer
            if current_time - ts < EVENT_BUFFER_TTL_SECONDS
        ]

        # 添加新事件
        if len(buffer) < EVENT_BUFFER_MAX_SIZE:
            buffer.append((current_time, response))

    def publish(self, workspace_id: str, response: BaseModel) -> None:
        """
        发布事件到指定 workspace 的所有订阅者

        线程安全：可以从任何线程调用此方法。
        当没有订阅者时，事件会被缓冲，等待订阅者连接后补发。

        Args:
            workspace_id: Workspace ID
            response: BaseModel 通知
        """
        with self._lock:
            subscribers = self._subscribers.get(workspace_id, [])
            if not subscribers:
                # 没有订阅者，缓冲事件
                self._buffer_event(workspace_id, response)
                return
            # 复制列表以避免在迭代时被修改
            subscribers = list(subscribers)

        # 检查是否有事件循环
        if self._loop is None:
            return

        # 检查是否在事件循环线程中
        try:
            running_loop = asyncio.get_running_loop()
            in_loop_thread = (running_loop == self._loop)
        except RuntimeError:
            # 不在任何事件循环中
            in_loop_thread = False

        for queue in subscribers:
            if in_loop_thread:
                # 在事件循环线程中，直接操作
                self._put_to_queue(queue, response)
            else:
                # 在其他线程中，使用 call_soon_threadsafe 调度到事件循环
                try:
                    self._loop.call_soon_threadsafe(
                        self._put_to_queue, queue, response
                    )
                except RuntimeError:
                    # 事件循环已关闭
                    pass

    def notify(self, workspace_id: str, response: BaseModel) -> None:
        """
        Args:
            workspace_id: Workspace ID
            response: BaseModel 通知
        """
        self.publish(workspace_id, response)

    async def subscribe(self, workspace_id: str) -> AsyncGenerator[BaseModel, None]:
        """
        订阅 workspace 事件流

        订阅时会自动补发缓冲的历史事件（如果有）。

        Args:
            workspace_id: Workspace ID

        Yields:
            BaseModel: 事件通知
        """
        # 捕获当前事件循环引用（用于跨线程发布）
        if self._loop is None:
            self._loop = asyncio.get_running_loop()

        queue: asyncio.Queue = asyncio.Queue(maxsize=100)
        buffered_events: list[BaseModel] = []

        with self._lock:
            # 获取并清空缓冲的事件
            if workspace_id in self._event_buffer:
                current_time = time.time()
                buffered_events = [
                    evt for ts, evt in self._event_buffer[workspace_id]
                    if current_time - ts < EVENT_BUFFER_TTL_SECONDS
                ]
                del self._event_buffer[workspace_id]

            self._subscribers[workspace_id].append(queue)

        try:
            # 先发送缓冲的历史事件
            for response in buffered_events:
                yield response

            # 然后持续接收新事件
            while True:
                response = await queue.get()
                yield response
        finally:
            # 清理订阅
            with self._lock:
                if workspace_id in self._subscribers:
                    try:
                        self._subscribers[workspace_id].remove(queue)
                    except ValueError:
                        pass
                    # 如果没有订阅者了，清理空列表
                    if not self._subscribers[workspace_id]:
                        del self._subscribers[workspace_id]

    def cleanup(self, workspace_id: str) -> None:
        """
        清理 workspace 相关资源

        Args:
            workspace_id: Workspace ID
        """
        with self._lock:
            self._subscribers.pop(workspace_id, None)
            self._event_buffer.pop(workspace_id, None)

    def get_subscriber_count(self, workspace_id: str) -> int:
        """获取 workspace 的订阅者数量"""
        with self._lock:
            return len(self._subscribers.get(workspace_id, []))


# 全局单例
event_manager = EventManager()
