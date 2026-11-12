"""Classify sampled current-camera availability separately from old-view proxies."""

from collections import Counter
import math


def scene_availability(sample):
    if sample.get("use_view_tiles", False):
        return "overview"
    if sample.get("is_gpu", False):
        return "current_geometry" if sample.get("geometry_drawn_shapes", 0) > 0 else "empty"
    if not sample.get("cpu_scene_visible", False):
        return "empty"
    if sample.get("cpu_scene_held", False):
        return "held_old_camera"
    if sample.get("cpu_scene_preview", False):
        return "translated_old_camera"
    if sample.get("cpu_scene_partial", False):
        return "current_partial"
    return "current_geometry" if sample.get("geometry_drawn_shapes", 0) > 0 else "empty"


def interaction_readiness(samples):
    counts = Counter()
    proxy_run_ms = 0.0
    maximum_proxy_ms = 0.0
    current = 0
    for sample in samples:
        interval = sample["frame_interval_ms"]
        if type(interval) not in (int, float) or not math.isfinite(interval) or interval < 0:
            raise ValueError("invalid native frame interval")
        kind = scene_availability(sample)
        counts[kind] += 1
        if kind in ("current_partial", "current_geometry"):
            current += 1
            proxy_run_ms = 0.0
        else:
            proxy_run_ms += interval
            maximum_proxy_ms = max(maximum_proxy_ms, proxy_run_ms)
    return {
        "camera_availability_samples": len(samples),
        "camera_availability_counts": dict(counts),
        "current_camera_fraction": current / len(samples) if samples else None,
        "max_old_view_or_empty_run_ms": maximum_proxy_ms if samples else None,
    }
