"""Require route pixels in zoom feedback, independently of native partial flags."""

from PIL import ImageChops


def conservative_feedback_seconds(flag_seconds, verified_capture_seconds):
    if flag_seconds is None or verified_capture_seconds is None:
        return None
    return max(flag_seconds, verified_capture_seconds)


def route_pixels(image):
    """Count chromatic layout pixels inside the harness's layout crop."""
    width, height = image.size
    if width <= 790 or height <= 200:
        raise ValueError("zoom evidence is too small for the documented layout crop")
    red, green, blue = image.convert("RGB").crop((350, 110, width - 440, height - 90)).split()
    highest = ImageChops.lighter(ImageChops.lighter(red, green), blue)
    lowest = ImageChops.darker(ImageChops.darker(red, green), blue)
    return sum(ImageChops.subtract(highest, lowest).histogram()[26:])


def layout_feedback(image, reference):
    if image.size != reference.size:
        raise ValueError("transition and target reference dimensions differ")
    actual = route_pixels(image)
    expected = route_pixels(reference)
    # Match the interaction harness's 25% reference-ink floor. This is necessary
    # visibility, not a fidelity or complete coverage proof. Gray references
    # make this check inapplicable; callers choose whether color is required.
    return {
        "colored_route_pixels": actual,
        "reference_colored_route_pixels": expected,
        "colored_route_fraction_of_reference": actual / expected if expected else None,
        "colored_reference_applicable": expected > 0,
        "usable_layout_image": expected > 0 and actual >= expected * 0.25,
    }


def feedback_capture(image, reference, samples, zoom):
    evidence = layout_feedback(image, reference)
    current = [sample for sample in samples
               if abs(sample["zoom"] / zoom - 1) < 0.0001
               and sample.get("cpu_stats_after_paint", False)
               and not sample.get("cpu_scene_held", False)
               and not sample.get("cpu_scene_preview", False)]
    partial = any(sample.get("cpu_scene_partial", False) for sample in current)
    claimed = partial or any(sample.get("geometry_drawn_shapes", 0) > 0 for sample in current)
    applicable = evidence["colored_reference_applicable"]
    return {
        **evidence,
        "claims_current_camera": claimed,
        "claims_partial": partial,
        "partial_without_routes": partial and applicable and evidence["colored_route_pixels"] == 0,
        "partial_insufficient_routes": partial and applicable and not evidence["usable_layout_image"],
        "verified_current_layout": claimed and evidence["usable_layout_image"],
    }
