import copy
import unittest

from render_zoom_gate import evaluate


def report():
    return {
        "display_size": [2048, 1280],
        "is_gpu": False,
        "raster_trace_diagnostic": False,
        "continuous_unrecognized_colored_pixel_fraction": 0,
        "failures": [],
        "steps": [{
            "zoom": zoom,
            "full_response_cache_hit": zoom == 1,
            "first_current_view_seconds": .03,
            "geometry_response_seconds": .12,
            "full_response_seconds": .20,
            "frame_p95_ms": 20,
            "max_frame_ms": 40,
            "unrecognized_colored_pixel_fraction": 0,
        } for zoom in [121, 46, 17, 6.8, 2.6, 1]],
    }


class ZoomGateTests(unittest.TestCase):
    def evaluate(self, candidate, baseline=None, samples=20):
        return evaluate([baseline or report()] * samples, [candidate] * samples)

    def test_complete_fast_uncached_evidence_passes_with_a_separate_cached_fit(self):
        actual = self.evaluate(report())
        self.assertEqual(actual["status"], "pass")
        fit = actual["cameras"][0]
        self.assertEqual(fit["candidate"]["uncached"]["samples"], 0)
        self.assertEqual(fit["candidate"]["cached"]["samples"], 20)

    def test_faster_cached_camera_cannot_hide_uncached_regression_or_missing_evidence(self):
        before = report()
        after = copy.deepcopy(before)
        after["steps"][0]["full_response_cache_hit"] = True
        after["steps"][0]["full_response_seconds"] = .15
        actual = self.evaluate(after, before)
        self.assertEqual(actual["status"], "fail")
        self.assertTrue(any("candidate has fewer than 20 uncached" in failure for failure in actual["failures"]))
        self.assertIsNone(actual["cameras"][-1]["candidate"]["uncached"]["full_p95_ms"])

    def test_fast_geometry_does_not_count_as_completed_labels(self):
        after = report()
        after["steps"][4]["full_response_seconds"] = .4
        failures = self.evaluate(after)["failures"]
        self.assertTrue(any("uncached full_p95_ms exceeds 250" in failure for failure in failures))

    def test_slow_feedback_bad_frame_and_missing_completion_each_fail(self):
        for field, value in [("first_current_view_seconds", .1), ("frame_p95_ms", 40),
                             ("max_frame_ms", 300), ("full_response_seconds", None)]:
            with self.subTest(field=field):
                after = report()
                after["steps"][2][field] = value
                self.assertEqual(self.evaluate(after)["status"], "fail")

    def test_diagnostics_wrong_dimensions_fidelity_and_renderer_changes_fail(self):
        for field, value in [("raster_trace_diagnostic", True), ("display_size", [1280, 860]),
                             ("continuous_unrecognized_colored_pixel_fraction", .1), ("is_gpu", True),
                             ("environment_diagnostic", True), ("acceptance_evidence", False),
                             ("progress_evidence_complete", False),
                             ("capture_backend", "XGetImage")]:
            with self.subTest(field=field):
                after = report()
                after[field] = value
                self.assertEqual(self.evaluate(after)["status"], "fail")

    def test_matching_direct_capture_is_allowed_and_unknown_backends_fail(self):
        before, after = report(), report()
        before["capture_backend"] = after["capture_backend"] = "XGetImage"
        self.assertEqual(self.evaluate(after, before)["status"], "pass")
        before["capture_backend"] = after["capture_backend"] = "lossy"
        self.assertEqual(self.evaluate(after, before)["status"], "fail")

    def test_small_samples_and_single_long_tail_do_not_pass_on_medians(self):
        self.assertEqual(self.evaluate(report(), samples=3)["status"], "fail")
        candidates = [report() for _ in range(20)]
        for candidate in candidates[-2:]:
            candidate["steps"][3]["full_response_seconds"] = .5
        actual = evaluate([report()] * 20, candidates)
        camera = next(record for record in actual["cameras"] if record["zoom"] == 6.8)
        self.assertEqual(camera["candidate"]["uncached"]["full_p95_ms"], 500)
        self.assertEqual(actual["status"], "fail")

    def test_uncached_regression_is_rejected_even_if_it_still_meets_absolute_budget(self):
        after = report()
        after["steps"][1]["full_response_seconds"] = .21
        self.assertTrue(any("p95 regressed" in failure for failure in self.evaluate(after)["failures"]))

    def test_invalid_control_is_rejected_but_a_slow_control_can_be_improved(self):
        before = report()
        before["raster_trace_diagnostic"] = True
        self.assertEqual(self.evaluate(report(), before)["status"], "fail")
        before = report()
        before["steps"][0]["full_response_seconds"] = .5
        before["steps"][0]["frame_p95_ms"] = 40
        before["failures"] = ["baseline exceeds recovery budget"]
        actual = self.evaluate(report(), before)
        self.assertEqual(actual["status"], "pass")
        self.assertTrue(actual["baseline_failures"])

    def test_incomplete_duplicate_or_nonfinite_camera_records_fail_closed(self):
        for change in ("missing-cache", "nan", "duplicate", "missing-step"):
            with self.subTest(change=change):
                after = report()
                if change == "missing-cache":
                    del after["steps"][0]["full_response_cache_hit"]
                elif change == "nan":
                    after["steps"][0]["full_response_seconds"] = float("nan")
                elif change == "duplicate":
                    after["steps"][0]["zoom"] = after["steps"][1]["zoom"]
                else:
                    after["steps"].pop()
                self.assertEqual(self.evaluate(after)["status"], "fail")


if __name__ == "__main__":
    unittest.main()
