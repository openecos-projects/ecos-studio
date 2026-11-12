import unittest

from render_interaction_evidence import interaction_readiness, scene_availability


def sample(**values):
    return {"frame_interval_ms": 10, "is_gpu": False, "cpu_scene_visible": True,
            "geometry_drawn_shapes": 100, **values}


class InteractionEvidenceTests(unittest.TestCase):
    def test_translated_and_held_bitmaps_are_not_current_geometry(self):
        samples = [sample(cpu_scene_preview=True)] * 50 + [sample(cpu_scene_held=True)] * 50
        result = interaction_readiness(samples)
        self.assertEqual(result["current_camera_fraction"], 0)
        self.assertEqual(result["max_old_view_or_empty_run_ms"], 1000)
        self.assertEqual(result["camera_availability_counts"], {
            "translated_old_camera": 50, "held_old_camera": 50,
        })

    def test_partial_current_camera_resets_proxy_duration_but_is_not_complete(self):
        result = interaction_readiness([
            sample(cpu_scene_preview=True), sample(cpu_scene_preview=True),
            sample(cpu_scene_partial=True, geometry_drawn_shapes=0),
            sample(cpu_scene_preview=True), sample(),
        ])
        self.assertEqual(result["max_old_view_or_empty_run_ms"], 20)
        self.assertEqual(result["current_camera_fraction"], .4)
        self.assertEqual(result["camera_availability_counts"]["current_partial"], 1)

    def test_conflicting_old_camera_flags_cannot_be_counted_as_current_partial(self):
        self.assertEqual(scene_availability(sample(cpu_scene_held=True, cpu_scene_partial=True)), "held_old_camera")
        self.assertEqual(scene_availability(sample(cpu_scene_preview=True, cpu_scene_partial=True)), "translated_old_camera")

    def test_gpu_geometry_is_current_but_overview_and_missing_geometry_are_not(self):
        self.assertEqual(scene_availability(sample(is_gpu=True)), "current_geometry")
        self.assertEqual(scene_availability(sample(is_gpu=True, use_view_tiles=True)), "overview")
        self.assertEqual(scene_availability(sample(is_gpu=True, geometry_drawn_shapes=0)), "empty")
        self.assertEqual(scene_availability({}), "empty")

    def test_missing_samples_and_invalid_intervals_do_not_prove_success(self):
        self.assertIsNone(interaction_readiness([])["current_camera_fraction"])
        self.assertIsNone(interaction_readiness([])["max_old_view_or_empty_run_ms"])
        for interval in [float("nan"), float("inf"), -1, True]:
            with self.subTest(interval=interval), self.assertRaises(ValueError):
                interaction_readiness([sample(frame_interval_ms=interval)])


if __name__ == "__main__":
    unittest.main()
