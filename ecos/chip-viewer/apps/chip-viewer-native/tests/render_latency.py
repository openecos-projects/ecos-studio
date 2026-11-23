"""Classify sampled camera readiness without counting old-view previews as exact."""


def camera_latencies(samples, zoom):
    elapsed_ms = 0.0
    feedback = None
    geometry = None
    complete = None
    cache_hit = None
    for sample in samples:
        elapsed_ms += sample["frame_interval_ms"]
        elapsed = elapsed_ms / 1000
        if abs(sample["zoom"] / zoom - 1) >= 0.0001:
            continue
        exact_geometry = (
            sample.get("geometry_drawn_shapes", 0) > 0
            and not sample.get("cpu_scene_held", False)
            and not sample.get("cpu_scene_preview", False)
            and not sample.get("cpu_scene_partial", False)
        )
        if feedback is None and (sample.get("cpu_scene_partial", False) or exact_geometry):
            feedback = elapsed
        if geometry is None and exact_geometry:
            geometry = elapsed
        if (
            complete is None and exact_geometry
            and not sample.get("scene_pending", True)
            and not sample.get("cpu_labels_pending", False)
        ):
            complete = elapsed
            cache_hit = sample.get("cpu_scene_cache_hit", False)
    return {
        "first_current_view_seconds": feedback,
        "geometry_response_seconds": geometry,
        "full_response_seconds": complete,
        "full_response_cache_hit": cache_hit,
    }
