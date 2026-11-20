import unittest

from PIL import Image, ImageDraw

from render_zoom_content import (
    conservative_feedback_seconds, feedback_capture, layout_feedback, route_pixels,
)


def image(routes=False):
    result = Image.new("RGB", (1024, 768), (24, 24, 28))
    draw = ImageDraw.Draw(result)
    draw.rectangle((0, 0, 300, 768), fill=(230, 40, 10))  # colorful sidebar is not routing
    draw.rectangle((370, 140, 540, 500), outline=(140, 140, 140), width=3)
    if routes:
        draw.line((380, 200, 520, 200), fill=(210, 45, 120), width=3)
    return result


class ZoomContentTests(unittest.TestCase):
    def test_feedback_budget_includes_the_first_verified_image_capture(self):
        self.assertEqual(conservative_feedback_seconds(0.024, 0.15), 0.15)
        self.assertEqual(conservative_feedback_seconds(0.1, 0.05), 0.1)
        self.assertIsNone(conservative_feedback_seconds(0.024, None))
        self.assertIsNone(conservative_feedback_seconds(None, 0.15))

    def test_gray_partial_is_unusable_even_when_native_claims_current_content(self):
        evidence = feedback_capture(image(), image(True), [{
            "zoom": 2, "cpu_stats_after_paint": True,
            "cpu_scene_partial": True, "geometry_drawn_shapes": 100,
        }], 2)
        self.assertEqual(evidence["colored_route_pixels"], 0)
        self.assertTrue(evidence["claims_partial"])
        self.assertTrue(evidence["partial_without_routes"])
        self.assertFalse(evidence["verified_current_layout"])

    def test_matching_empty_progress_reference_does_not_prove_feedback(self):
        evidence = layout_feedback(image(), image())
        self.assertIsNone(evidence["colored_route_fraction_of_reference"])
        self.assertFalse(evidence["usable_layout_image"])
        self.assertFalse(evidence["colored_reference_applicable"])
        flags = feedback_capture(image(), image(), [{
            "zoom": 2, "cpu_stats_after_paint": True, "cpu_scene_partial": True,
        }], 2)
        self.assertFalse(flags["partial_insufficient_routes"])

    def test_one_few_or_mostly_gray_route_pixels_fail_reference_ink_floor(self):
        reference = image(True)
        for count in (1, 3, 32, 105):
            with self.subTest(colored_pixels=count):
                frame = image()
                ImageDraw.Draw(frame).line((380, 200, 380 + count - 1, 200), fill=(210, 45, 120))
                evidence = feedback_capture(frame, reference, [{
                    "zoom": 2, "cpu_stats_after_paint": True, "cpu_scene_partial": True,
                }], 2)
                self.assertEqual(evidence["colored_route_pixels"], count)
                self.assertFalse(evidence["usable_layout_image"])
                self.assertTrue(evidence["partial_insufficient_routes"])
                self.assertFalse(evidence["verified_current_layout"])

    def test_quarter_reference_ink_boundary_is_inclusive(self):
        reference = image()
        ImageDraw.Draw(reference).line((380, 200, 579, 200), fill=(210, 45, 120))
        for count, usable in ((49, False), (50, True)):
            with self.subTest(count=count):
                frame = image()
                ImageDraw.Draw(frame).line((380, 200, 380 + count - 1, 200), fill=(210, 45, 120))
                self.assertEqual(layout_feedback(frame, reference)["usable_layout_image"], usable)

    def test_small_real_reference_uses_the_same_relative_floor(self):
        reference = image()
        reference.putpixel((400, 200), (210, 45, 120))
        evidence = layout_feedback(reference, reference)
        self.assertEqual(evidence["reference_colored_route_pixels"], 1)
        self.assertTrue(evidence["usable_layout_image"])

    def test_real_route_pixels_with_after_paint_current_partial_are_usable(self):
        evidence = feedback_capture(image(True), image(True), [{
            "zoom": 2, "cpu_stats_after_paint": True, "cpu_scene_partial": True,
        }], 2)
        self.assertEqual(evidence["colored_route_pixels"], 423)
        self.assertEqual(evidence["colored_route_fraction_of_reference"], 1)
        self.assertTrue(evidence["verified_current_layout"])

    def test_colored_ui_and_grayscale_layout_do_not_count_as_routes(self):
        self.assertEqual(route_pixels(image()), 0)

    def test_color_cannot_certify_old_camera_or_before_paint_stats(self):
        for state in [{"zoom": 1}, {"cpu_scene_preview": True},
                      {"cpu_scene_held": True}, {"cpu_stats_after_paint": False}]:
            with self.subTest(state=state):
                evidence = feedback_capture(image(True), image(True), [{
                    "zoom": 2, "cpu_stats_after_paint": True,
                    "cpu_scene_partial": True, **state,
                }], 2)
                self.assertFalse(evidence["verified_current_layout"])

    def test_incompatible_captures_are_errors(self):
        with self.assertRaises(ValueError):
            layout_feedback(image(), Image.new("RGB", (1024, 767)))
        with self.assertRaises(ValueError):
            route_pixels(Image.new("RGB", (128, 128)))


if __name__ == "__main__":
    unittest.main()
