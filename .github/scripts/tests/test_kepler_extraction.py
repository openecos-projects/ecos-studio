import importlib.util
import io
from pathlib import Path
import tarfile
import tempfile
import unittest


SPEC = importlib.util.spec_from_file_location(
    "extract_kepler", Path(__file__).parents[1] / "extract-kepler.py"
)
extractor = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(extractor)


def file_member(name, content=b"executable"):
    member = tarfile.TarInfo(name)
    member.size = len(content)
    member.mode = 0o755
    return member, content


def link_member(name, target, kind=tarfile.SYMTYPE):
    member = tarfile.TarInfo(name)
    member.type = kind
    member.linkname = target
    return member, None


class KeplerExtractionTests(unittest.TestCase):
    def extract_members(self, root, members):
        archive = root / "kepler.tar.gz"
        with tarfile.open(archive, "w:gz") as package:
            for member, content in members:
                package.addfile(member, None if content is None else io.BytesIO(content))
        destination = root / "installed"
        extractor.extract(archive, destination)
        return destination

    def test_executable_and_internal_link_are_preserved(self):
        with tempfile.TemporaryDirectory() as directory:
            destination = self.extract_members(Path(directory), [
                file_member("kepler-formal/bin/kepler-formal"),
                link_member("kepler-formal/kepler-formal", "bin/kepler-formal"),
            ])
            binary = destination / "kepler-formal/bin/kepler-formal"
            self.assertEqual(binary.read_bytes(), b"executable")
            self.assertTrue(binary.stat().st_mode & 0o100)
            self.assertTrue((destination / "kepler-formal/kepler-formal").is_symlink())

    def test_host_startup_hook_is_omitted(self):
        with tempfile.TemporaryDirectory() as directory:
            destination = self.extract_members(Path(directory), [
                file_member("kepler-formal/bin/kepler-formal"),
                link_member("kepler-formal/lib/python3.10/sitecustomize.py",
                            "/etc/python3.10/sitecustomize.py"),
            ])
            hook = destination / "kepler-formal/lib/python3.10/sitecustomize.py"
            self.assertFalse(hook.exists())
            self.assertFalse(hook.is_symlink())

    def test_escaping_members_and_links_are_rejected(self):
        invalid = [
            file_member("../escape"), file_member("/absolute"),
            link_member("kepler-formal/lib/escape", "../../../escape"),
            link_member("kepler-formal/lib/escape", "/etc/passwd"),
            link_member("kepler-formal/lib/hardlink", "../../escape", tarfile.LNKTYPE),
            link_member("kepler-formal/lib/python3.10/sitecustomize.py", "/etc/passwd"),
            link_member("kepler-formal/lib/python3.10/sitecustomize.py", "/nix/store/../../etc/passwd"),
        ]
        for member in invalid:
            with self.subTest(member=member[0].name), tempfile.TemporaryDirectory() as directory:
                with self.assertRaises((ValueError, tarfile.FilterError)):
                    self.extract_members(Path(directory), [member])
                self.assertFalse((Path(directory) / "escape").exists())

    def test_link_then_file_cannot_escape(self):
        with tempfile.TemporaryDirectory() as directory:
            with self.assertRaises(tarfile.FilterError):
                self.extract_members(Path(directory), [
                    link_member("kepler-formal/escape", "../.."),
                    file_member("kepler-formal/escape/outside"),
                ])
            self.assertFalse((Path(directory) / "outside").exists())


if __name__ == "__main__":
    unittest.main()
