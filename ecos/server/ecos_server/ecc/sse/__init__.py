#!/usr/bin/env python

from ecos_server.sse import event_manager

from .models import to_sse_format
from .notify_service import NotifyService

global _notify_service
_notify_service = NotifyService()


def server_notify():
    global _notify_service
    return _notify_service


__all__ = ["to_sse_format", "event_manager", "NotifyService", "server_notify"]
