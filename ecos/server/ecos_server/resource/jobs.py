#!/usr/bin/env python

"""Job tracking for resource operations.

Tracks active resource jobs to power duplicate-detection (409 Conflict)
and SSE progress subscriptions. Each active job stores metadata so
clients receive a structured conflict response with the existing job id.
"""

import logging
import threading
from collections.abc import Callable
from dataclasses import dataclass

from ecos_server.sse import event_manager as _default_event_manager

from .schemas import ResourceAction, ResourceJob

logger = logging.getLogger(__name__)


@dataclass
class ActiveJob:
    resource_id: str
    action: ResourceAction
    job_id: str

    @property
    def event_url(self) -> str:
        return f"/api/resources/events/{self.job_id}"


class JobTracker:
    """In-memory tracker of active resource operations with metadata.

    Used by routers to reject duplicate install/update requests with 409
    and expose existing job info so clients can subscribe to progress.
    """

    def __init__(self) -> None:
        self._active: dict[str, ActiveJob] = {}
        self._counter = 0
        self._lock = threading.Lock()

    def is_active(self, resource_id: str) -> bool:
        with self._lock:
            return resource_id in self._active

    def get_active(self, resource_id: str) -> ActiveJob | None:
        with self._lock:
            return self._active.get(resource_id)

    def start(self, resource_id: str, action: ResourceAction = ResourceAction.install) -> ActiveJob:
        with self._lock:
            if resource_id in self._active:
                raise KeyError(f"Job already active for {resource_id}")
            self._counter += 1
            job = ActiveJob(
                resource_id=resource_id,
                action=action,
                job_id=f"job-{self._counter}",
            )
            self._active[resource_id] = job
            return job

    def finish(self, resource_id: str) -> None:
        with self._lock:
            self._active.pop(resource_id, None)

    def publish(
        self,
        job: ResourceJob,
        on_progress: Callable[[ResourceJob], None] | None = None,
    ) -> None:
        """Publish a job progress update to SSE and optional callback."""
        if not job.id:
            active = self.get_active(job.resource_id)
            job.id = active.job_id if active else ""
        if on_progress:
            on_progress(job)
        _default_event_manager.publish(f"resource:{job.resource_id}", job)
        _default_event_manager.publish("resource:*", job)
        if job.id:
            _default_event_manager.publish(f"resource-job:{job.id}", job)

    def subscribe(self, resource_id: str):
        """Subscribe to SSE events for a resource operation."""
        return _default_event_manager.subscribe(f"resource:{resource_id}")
