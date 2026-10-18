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
LOGS = f"""2026-10-18T07:51:46Z Syncing repository: openecos-projects/ecc
[command]/usr/bin/git log -1 --format=%H
{SHA}
2026-10-18T07:51:47Z Syncing repository: openecos-projects/ecc-ci-designs
[command]/usr/bin/git log -1 --format=%H
2026-10-18T07:51:47Z {DESIGNS_SHA}
Downloading package from https://github.com/YosysHQ/oss-cad-suite-build/releases/download/2026-10-14/oss-cad-suite-linux-x64-20261014.tgz
echo "Downloading kepler-formal-linux-x64 from openecos-projects/kepler-formal CI run ${{run_id}}"
2026-10-18T07:52:42Z Downloading kepler-formal-linux-x64 from openecos-projects/kepler-formal CI run 123
"""


def artifacts(*names):
    return {"artifacts": [
        {"id": index + 1, "name": name, "expired": False, "size_in_bytes": 10,
         "digest": "sha256:example"}
        for index, name in enumerate(names)
    ]}


class ToolchainTests(unittest.TestCase):
    def test_actual_download_and_design_checkout(self):
        self.assertEqual(toolchain.parse_toolchain(LOGS), {
            "oss_cad_suite_version": "2026-10-14",
            "kepler_run_id": "123",
            "designs_sha": DESIGNS_SHA,
        })

    def test_missing_or_ambiguous_provenance(self):
        for logs in (LOGS.replace("Syncing repository: openecos-projects/ecc-ci-designs", "missing"),
                     LOGS.replace(DESIGNS_SHA, "missing"),
                     LOGS.replace("CI run 123", "CI run ${run_id}"),
                     LOGS + "\nDownloading kepler-formal-linux-x64 from openecos-projects/kepler-formal CI run 456\n"):
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
            {"name": "E2E Packaged Flow (gcd)", "status": "completed", "conclusion": "failure"}
        ]}]
        with self.assertRaisesRegex(ValueError, "no successful"):
            toolchain.resolve(1, SHA, 0)

    @patch.object(toolchain, "api")
    def test_pending_design_timeout(self, api):
        api.side_effect = [{"head_sha": SHA}, {"jobs": [
            {"name": "E2E Packaged Flow (gcd)", "status": "in_progress", "conclusion": None}
        ]}]
        with self.assertRaisesRegex(ValueError, "Timed out"):
            toolchain.resolve(1, SHA, 0)

    @patch.object(toolchain, "api")
    def test_exact_run_artifacts_and_kepler_are_recorded(self, api):
        api.side_effect = [
            {"head_sha": SHA},
            {"jobs": [{"name": "E2E Packaged Flow (gcd)", "id": 9,
                       "status": "completed", "conclusion": "success"}]},
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
        pending = {"name": "E2E Packaged Flow (gcd)", "id": 9,
                   "status": "in_progress", "conclusion": None}
        api.side_effect = [
            {"head_sha": SHA}, {"jobs": [pending]},
            {"jobs": [dict(pending, status="completed", conclusion="success"),
                      dict(pending, name="E2E Packaged Flow (other)", conclusion="failure")]},
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
            {"jobs": [{"name": "E2E Packaged Flow (gcd)", "id": 9,
                       "status": "completed", "conclusion": "success"}]},
            LOGS, artifacts("ecc-cli-linux-x86_64", "icsprout55-pdk", "ecc-sizer"),
            {"head_sha": "c" * 40, "conclusion": "failure"},
        ]
        with self.assertRaisesRegex(ValueError, "Kepler run"):
            toolchain.resolve(1, SHA, 0)


if __name__ == "__main__":
    unittest.main()
