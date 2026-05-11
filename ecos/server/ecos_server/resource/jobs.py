#!/usr/bin/env python

"""Thin job tracking for resource operations.

Tracks active resource jobs to power duplicate-detection (409 Conflict)
and SSE progress subscriptions.
"""

import logging
from typing import Callable

from ecos_server.sse import event_manager as _default_event_manager

from .schemas import ResourceJob

logger = logging.getLogger(__name__)


class JobTracker:
    """In-memory set of active resource operation keys.

    Used by routers to reject duplicate install/update requests with 409.
    """

    def __init__(self) -> None:
        self._active: set[str] = set()

    def is_active(self, resource_id: str) -> bool:
        return resource_id in self._active

    def start(self, resource_id: str) -> None:
        self._active.add(resource_id)

    def finish(self, resource_id: str) -> None:
        self._active.discard(resource_id)

    def publish(
        self,
        job: ResourceJob,
        on_progress: Callable[[ResourceJob], None] | None = None,
    ) -> None:
        """Publish a job progress update to SSE and optional callback."""
        if on_progress:
            on_progress(job)
        _default_event_manager.publish(f"resource:{job.resource_id}", job)

    def subscribe(self, resource_id: str):
        """Subscribe to SSE events for a resource operation."""
        return _default_event_manager.subscribe(f"resource:{resource_id}")
