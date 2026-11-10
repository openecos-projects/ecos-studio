import importlib.util
from pathlib import Path
import unittest
from unittest.mock import patch


SPEC = importlib.util.spec_from_file_location(
    "ecc_toolchain", Path(__file__).parents[1] / "resolve-ecc-toolchain.py"
)
toolchain = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(toolchain)
SHA = "a" * 40
DESIGNS_SHA = "b" * 40
LOGS = f"""2026-11-09T09:28:16.2032090Z e2e_designs_git_commit={DESIGNS_SHA}
2026-11-09T09:28:16.2037712Z kepler_formal_run_id=123
2026-11-09T09:28:16.2041014Z oss_cad_suite_version=2026-10-14
"""
VERSIONS_JOB = {"name": "List dependency versions", "id": 7,
                "status": "completed", "conclusion": "success"}


def artifacts(*names):
    return {"artifacts": [
        {"id": index + 1, "name": name, "expired": False, "size_in_bytes": 10,
         "digest": "sha256:example"}
        for index, name in enumerate(names)
    ]}


class ToolchainTests(unittest.TestCase):
    def test_packaged_design_job_name(self):
        self.assertTrue(toolchain.is_packaged_design_job("E2E (gcd)"))
        for name in ("E2E Packaged Flow (gcd)", "E2E", "E2E helper (gcd)", "Build E2E (gcd)"):
            with self.subTest(name=name):
                self.assertFalse(toolchain.is_packaged_design_job(name))

    def test_version_manifest(self):
        self.assertEqual(toolchain.parse_toolchain(LOGS), {
            "oss_cad_suite_version": "2026-10-14",
            "kepler_run_id": "123",
            "designs_sha": DESIGNS_SHA,
        })

    def test_missing_or_ambiguous_provenance(self):
        for logs in (LOGS.replace("e2e_designs_git_commit=", "missing="),
                     LOGS.replace(DESIGNS_SHA, "missing"),
                     LOGS.replace("kepler_formal_run_id=123", "kepler_formal_run_id=${run_id}"),
                     LOGS.replace("oss_cad_suite_version=2026-10-14", "oss_cad_suite_version=latest"),
                     LOGS + "\nkepler_formal_run_id=456\n"):
            with self.subTest(logs=logs), self.assertRaises(ValueError):
                toolchain.parse_toolchain(logs)

    def test_artifact_validation(self):
        payload = artifacts("pdk")
        self.assertEqual(toolchain.artifact_records(payload, ("pdk",))["pdk"]["id"], 1)
        for invalid in ({"artifacts": []}, {"artifacts": payload["artifacts"] * 2},
                        {"artifacts": [dict(payload["artifacts"][0], expired=True)]},
                        {"artifacts": [dict(payload["artifacts"][0], size_in_bytes=0)]}):
            with self.subTest(invalid=invalid), self.assertRaises(ValueError):
                toolchain.artifact_records(invalid, ("pdk",))

    @patch.object(toolchain, "api")
    def test_wrong_ecc_pin(self, api):
        api.return_value = {"head_sha": "wrong"}
        with self.assertRaisesRegex(ValueError, "pinned ECC"):
            toolchain.resolve(1, SHA, 0)
        self.assertEqual(api.call_count, 1)

    @patch.object(toolchain, "api")
    def test_no_successful_design(self, api):
        api.side_effect = [{"head_sha": SHA}, {"jobs": [
            {"name": "E2E (gcd)", "status": "completed", "conclusion": "failure"}
        ]}]
        with self.assertRaisesRegex(ValueError, "no successful"):
            toolchain.resolve(1, SHA, 0)

    @patch.object(toolchain, "api")
    def test_pending_design_timeout(self, api):
        api.side_effect = [{"head_sha": SHA}, {"jobs": [
            {"name": "E2E (gcd)", "status": "in_progress", "conclusion": None}
        ]}]
        with self.assertRaisesRegex(ValueError, "Timed out"):
            toolchain.resolve(1, SHA, 0)

    @patch.object(toolchain.time, "sleep")
    @patch.object(toolchain, "api")
    def test_waits_for_design_matrix_to_start(self, api, sleep):
        api.side_effect = [
            {"head_sha": SHA}, {"jobs": []}, {"status": "in_progress"},
            {"jobs": [{"name": "E2E (gcd)", "id": 9,
                       "status": "completed", "conclusion": "success"}, VERSIONS_JOB]},
            LOGS, artifacts("ecc-cli-linux-x86_64", "icsprout55-pdk", "ecc-sizer"),
            {"head_sha": "c" * 40, "conclusion": "success"},
            artifacts("kepler-formal-linux-x64"),
        ]
        self.assertEqual(toolchain.resolve(1, SHA, 60)["ecc_job_id"], 9)
        sleep.assert_called_once()

    @patch.object(toolchain, "api")
    def test_completed_run_without_design_jobs_is_rejected(self, api):
        api.side_effect = [
            {"head_sha": SHA}, {"jobs": []}, {"status": "completed"},
        ]
        with self.assertRaisesRegex(ValueError, "no successful"):
            toolchain.resolve(1, SHA, 60)

    @patch.object(toolchain, "api")
    def test_exact_run_artifacts_and_kepler_are_recorded(self, api):
        api.side_effect = [
            {"head_sha": SHA},
            {"jobs": [{"name": "E2E (gcd)", "id": 9,
                       "status": "completed", "conclusion": "success"}, VERSIONS_JOB]},
            LOGS,
            artifacts("ecc-cli-linux-x86_64", "icsprout55-pdk", "ecc-sizer"),
            {"head_sha": "c" * 40, "conclusion": "success"},
            artifacts("kepler-formal-linux-x64"),
        ]
        manifest = toolchain.resolve(1, SHA, 0)
        self.assertEqual(manifest["ecc_job_id"], 9)
        self.assertEqual(manifest["kepler_sha"], "c" * 40)
        self.assertIn("icsprout55-pdk", manifest["artifacts"])
        self.assertEqual(api.call_args_list[-1].args[0],
                         "repos/openecos-projects/kepler-formal/actions/runs/123/artifacts?per_page=100")

    @patch.object(toolchain.time, "sleep")
    @patch.object(toolchain, "api")
    def test_waits_for_success_without_requiring_all_designs_to_pass(self, api, sleep):
        pending = {"name": "E2E (gcd)", "id": 9,
                   "status": "in_progress", "conclusion": None}
        api.side_effect = [
            {"head_sha": SHA}, {"jobs": [pending]},
            {"jobs": [dict(pending, status="completed", conclusion="success"),
                      dict(pending, name="E2E (other)", conclusion="failure"),
                      VERSIONS_JOB]},
            LOGS, artifacts("ecc-cli-linux-x86_64", "icsprout55-pdk", "ecc-sizer"),
            {"head_sha": "c" * 40, "conclusion": "success"},
            artifacts("kepler-formal-linux-x64"),
        ]
        self.assertEqual(toolchain.resolve(1, SHA, 60)["ecc_job_id"], 9)
        sleep.assert_called_once()

    @patch.object(toolchain, "api")
    def test_failed_kepler_is_rejected(self, api):
        api.side_effect = [
            {"head_sha": SHA},
            {"jobs": [{"name": "E2E (gcd)", "id": 9,
                       "status": "completed", "conclusion": "success"}, VERSIONS_JOB]},
            LOGS, artifacts("ecc-cli-linux-x86_64", "icsprout55-pdk", "ecc-sizer"),
            {"head_sha": "c" * 40, "conclusion": "failure"},
        ]
        with self.assertRaisesRegex(ValueError, "Kepler run"):
            toolchain.resolve(1, SHA, 0)

    def locked_manifest(self):
        return {
            "ecc_sha": SHA, "ecc_run_id": "1", "ecc_job_id": 9,
            "oss_cad_suite_version": "2026-10-14", "designs_sha": DESIGNS_SHA,
            "kepler_run_id": "123", "kepler_sha": "c" * 40,
            "artifacts": toolchain.artifact_records(
                artifacts("ecc-cli-linux-x86_64", "icsprout55-pdk", "ecc-sizer"),
                ("ecc-cli-linux-x86_64", "icsprout55-pdk", "ecc-sizer")),
            "kepler_artifacts": toolchain.artifact_records(
                artifacts("kepler-formal-linux-x64"), ("kepler-formal-linux-x64",)),
        }

    @patch.object(toolchain, "api")
    def test_ci_verifies_lock_without_downloading_logs(self, api):
        manifest = self.locked_manifest()
        api.side_effect = [
            {"head_sha": SHA},
            {"jobs": [{"id": 9, "name": "E2E (gcd)", "conclusion": "success"}]},
            artifacts("ecc-cli-linux-x86_64", "icsprout55-pdk", "ecc-sizer"),
            {"head_sha": "c" * 40, "conclusion": "success"},
            artifacts("kepler-formal-linux-x64"),
        ]
        self.assertEqual(toolchain.verify_lock(manifest, 1, SHA), manifest)
        self.assertTrue(all(not call.args[0].endswith("/logs") for call in api.call_args_list))

    @patch.object(toolchain, "api")
    def test_outdated_lock_is_rejected_before_network_access(self, api):
        for run_id, sha in ((2, SHA), (1, "d" * 40)):
            with self.subTest(run_id=run_id, sha=sha), self.assertRaisesRegex(ValueError, "Update"):
                toolchain.verify_lock(self.locked_manifest(), run_id, sha)
        api.assert_not_called()

    @patch.object(toolchain, "api")
    def test_replaced_artifacts_are_rejected(self, api):
        for key, value in (("id", 999), ("digest", "sha256:replaced")):
            manifest = self.locked_manifest()
            manifest["artifacts"]["icsprout55-pdk"][key] = value
            api.side_effect = [
                {"head_sha": SHA},
                {"jobs": [{"id": 9, "name": "E2E (gcd)", "conclusion": "success"}]},
                artifacts("ecc-cli-linux-x86_64", "icsprout55-pdk", "ecc-sizer"),
            ]
            with self.subTest(key=key), self.assertRaisesRegex(ValueError, "artifact metadata"):
                toolchain.verify_lock(manifest, 1, SHA)


if __name__ == "__main__":
    unittest.main()
