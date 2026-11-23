import unittest

from render_latency import camera_latencies


def sample(**values):
    return {
        "frame_interval_ms": 10,
        "zoom": 2,
        "geometry_drawn_shapes": 10,
        "scene_pending": False,
        "cpu_labels_pending": False,
        **values,
    }


class CameraLatencyTests(unittest.TestCase):
    def test_old_camera_and_translated_preview_are_not_current_output(self):
        self.assertEqual(camera_latencies([
            sample(zoom=1), sample(cpu_scene_preview=True),
            sample(cpu_scene_held=True), sample(cpu_scene_partial=True),
            sample(scene_pending=True, cpu_labels_pending=True), sample(),
        ], 2), {
            "first_current_view_seconds": 0.04,
            "geometry_response_seconds": 0.05,
            "full_response_seconds": 0.06,
            "full_response_cache_hit": False,
        })

    def test_geometry_does_not_imply_labels_are_complete(self):
        actual = camera_latencies([
            sample(scene_pending=True, cpu_labels_pending=True),
            sample(cpu_labels_pending=True),
        ], 2)
        self.assertEqual(actual, {
            "first_current_view_seconds": 0.01,
            "geometry_response_seconds": 0.01,
            "full_response_seconds": None,
            "full_response_cache_hit": None,
        })

    def test_cached_completion_is_recorded_separately(self):
        self.assertEqual(camera_latencies([
            sample(zoom=1), sample(cpu_scene_cache_hit=True), sample(),
        ], 2), {
            "first_current_view_seconds": 0.02,
            "geometry_response_seconds": 0.02,
            "full_response_seconds": 0.02,
            "full_response_cache_hit": True,
        })

    def test_no_visible_labels_and_gpu_geometry_can_be_complete(self):
        self.assertEqual(camera_latencies([
            sample(is_gpu=True, label_count=0),
        ], 2), {
            "first_current_view_seconds": 0.01,
            "geometry_response_seconds": 0.01,
            "full_response_seconds": 0.01,
            "full_response_cache_hit": False,
        })

    def test_absent_readiness_is_not_complete(self):
        self.assertIsNone(camera_latencies([
            {"frame_interval_ms": 10, "zoom": 2, "geometry_drawn_shapes": 10},
        ], 2)["full_response_seconds"])
        self.assertEqual(camera_latencies([], 2), {
            "first_current_view_seconds": None,
            "geometry_response_seconds": None,
            "full_response_seconds": None,
            "full_response_cache_hit": None,
        })


if __name__ == "__main__":
    unittest.main()
