import hashlib
import io as io_mod
import tarfile
import zipfile as zf
from pathlib import Path

import pytest

from ecos_server.resource.installer import InstallerService


def _make_tarball(tmp_path: Path, prefix: str = "") -> tuple[bytes, str]:
    buf = io_mod.BytesIO()
    with tarfile.open(fileobj=buf, mode="w:gz") as tar:
        bin_dir = f"{prefix}/bin" if prefix else "bin"
        data = b"#!/bin/sh\necho yosys"
        info = tarfile.TarInfo(name=f"{bin_dir}/yosys")
        info.size = len(data)
        info.mode = 0o755
        tar.addfile(info, io_mod.BytesIO(data))
    content = buf.getvalue()
    sha = hashlib.sha256(content).hexdigest()
    return content, sha


@pytest.fixture
def installer() -> InstallerService:
    return InstallerService()


class TestVerifySha256:
    def test_pass(self, tmp_path: Path) -> None:
        content = b"hello world"
        sha = hashlib.sha256(content).hexdigest()
        file_path = tmp_path / "test.tar.gz"
        file_path.write_bytes(content)
        assert InstallerService.verify_sha256(file_path, sha) is True

    def test_fail(self, tmp_path: Path) -> None:
        file_path = tmp_path / "test.tar.gz"
        file_path.write_bytes(b"hello world")
        assert InstallerService.verify_sha256(file_path, "wrong_hash") is False


class TestExtract:
    def test_tarball_no_prefix(self, installer: InstallerService, tmp_path: Path) -> None:
        content, _ = _make_tarball(tmp_path)
        archive = tmp_path / "yosys.tar.gz"
        archive.write_bytes(content)
        dest = tmp_path / "tools" / "yosys" / "0.61"
        installer.extract(archive_path=archive, dest_dir=dest, strip_prefix=None)
        assert (dest / "bin" / "yosys").exists()

    def test_tarball_with_strip_prefix(self, installer: InstallerService, tmp_path: Path) -> None:
        content, _ = _make_tarball(tmp_path, prefix="yosys-0.61")
        archive = tmp_path / "yosys.tar.gz"
        archive.write_bytes(content)
        dest = tmp_path / "tools" / "yosys" / "0.61"
        installer.extract(archive_path=archive, dest_dir=dest, strip_prefix="yosys-0.61")
        assert (dest / "bin" / "yosys").exists()

    def test_atomic_cleans_up_on_failure(self, installer: InstallerService, tmp_path: Path) -> None:
        bad_archive = tmp_path / "bad.tar.gz"
        bad_archive.write_bytes(b"not a tarball")
        dest = tmp_path / "tools" / "yosys" / "0.61"
        with pytest.raises(ValueError):
            installer.extract(archive_path=bad_archive, dest_dir=dest, strip_prefix=None)
        assert not dest.exists()


class TestArchiveTraversal:
    def test_tar_parent_traversal_rejected(
        self, installer: InstallerService, tmp_path: Path
    ) -> None:
        buf = io_mod.BytesIO()
        with tarfile.open(fileobj=buf, mode="w:gz") as tar:
            info = tarfile.TarInfo(name="../evil")
            info.size = 4
            tar.addfile(info, io_mod.BytesIO(b"evil"))
        archive = tmp_path / "traversal.tar.gz"
        archive.write_bytes(buf.getvalue())
        with pytest.raises(ValueError, match="parent directory traversal"):
            installer.extract(archive_path=archive, dest_dir=tmp_path / "safe", strip_prefix=None)

    def test_tar_absolute_path_rejected(self, installer: InstallerService, tmp_path: Path) -> None:
        buf = io_mod.BytesIO()
        with tarfile.open(fileobj=buf, mode="w:gz") as tar:
            info = tarfile.TarInfo(name="/etc/passwd")
            info.size = 4
            tar.addfile(info, io_mod.BytesIO(b"evil"))
        archive = tmp_path / "absolute.tar.gz"
        archive.write_bytes(buf.getvalue())
        with pytest.raises(ValueError, match="absolute"):
            installer.extract(archive_path=archive, dest_dir=tmp_path / "safe", strip_prefix=None)

    def test_tar_nested_traversal_rejected(
        self, installer: InstallerService, tmp_path: Path
    ) -> None:
        buf = io_mod.BytesIO()
        with tarfile.open(fileobj=buf, mode="w:gz") as tar:
            info = tarfile.TarInfo(name="foo/../../evil")
            info.size = 4
            tar.addfile(info, io_mod.BytesIO(b"evil"))
        archive = tmp_path / "nested.tar.gz"
        archive.write_bytes(buf.getvalue())
        with pytest.raises(ValueError, match="parent directory traversal"):
            installer.extract(archive_path=archive, dest_dir=tmp_path / "safe", strip_prefix=None)

    def test_zip_parent_traversal_rejected(
        self, installer: InstallerService, tmp_path: Path
    ) -> None:
        archive = tmp_path / "traversal.zip"
        with zf.ZipFile(archive, "w") as z:
            z.writestr("../evil", "evil")
        with pytest.raises(ValueError, match="parent directory traversal"):
            installer.extract(archive_path=archive, dest_dir=tmp_path / "safe", strip_prefix=None)

    def test_zip_absolute_path_rejected(self, installer: InstallerService, tmp_path: Path) -> None:
        archive = tmp_path / "absolute.zip"
        with zf.ZipFile(archive, "w") as z:
            z.writestr("/etc/passwd", "evil")
        with pytest.raises(ValueError, match="absolute"):
            installer.extract(archive_path=archive, dest_dir=tmp_path / "safe", strip_prefix=None)


class TestSymlinkHardlink:
    def test_tar_relative_symlink_inside_root_allowed(
        self, installer: InstallerService, tmp_path: Path
    ) -> None:
        buf = io_mod.BytesIO()
        with tarfile.open(fileobj=buf, mode="w:gz") as tar:
            data = b"python3 man page"
            target = tarfile.TarInfo(name="oss-cad-suite/share/man/man1/python3.11")
            target.size = len(data)
            tar.addfile(target, io_mod.BytesIO(data))

            link = tarfile.TarInfo(name="oss-cad-suite/share/man/man1/python3.1")
            link.type = tarfile.SYMTYPE
            link.linkname = "python3.11"
            tar.addfile(link)

        archive = tmp_path / "symlink.tar.gz"
        archive.write_bytes(buf.getvalue())
        dest = tmp_path / "safe"

        installer.extract(archive_path=archive, dest_dir=dest, strip_prefix="oss-cad-suite")

        link_path = dest / "share" / "man" / "man1" / "python3.1"
        assert link_path.is_symlink()
        assert link_path.readlink() == Path("python3.11")

    def test_tar_absolute_symlink_rejected(
        self, installer: InstallerService, tmp_path: Path
    ) -> None:
        buf = io_mod.BytesIO()
        with tarfile.open(fileobj=buf, mode="w:gz") as tar:
            info = tarfile.TarInfo(name="bin/tool")
            info.type = tarfile.SYMTYPE
            info.linkname = "/etc/passwd"
            tar.addfile(info)
        archive = tmp_path / "symlink.tar.gz"
        archive.write_bytes(buf.getvalue())
        with pytest.raises(ValueError, match="absolute symlink"):
            installer.extract(archive_path=archive, dest_dir=tmp_path / "safe", strip_prefix=None)

    def test_tar_symlink_escape_rejected(self, installer: InstallerService, tmp_path: Path) -> None:
        buf = io_mod.BytesIO()
        with tarfile.open(fileobj=buf, mode="w:gz") as tar:
            info = tarfile.TarInfo(name="bin/tool")
            info.type = tarfile.SYMTYPE
            info.linkname = "../../evil"
            tar.addfile(info)
        archive = tmp_path / "symlink-escape.tar.gz"
        archive.write_bytes(buf.getvalue())
        with pytest.raises(ValueError, match="escaping extraction root"):
            installer.extract(archive_path=archive, dest_dir=tmp_path / "safe", strip_prefix=None)

    def test_tar_hardlink_rejected(self, installer: InstallerService, tmp_path: Path) -> None:
        buf = io_mod.BytesIO()
        with tarfile.open(fileobj=buf, mode="w:gz") as tar:
            # First add a regular file
            data = b"safe content"
            reg_info = tarfile.TarInfo(name="bin/original")
            reg_info.size = len(data)
            tar.addfile(reg_info, io_mod.BytesIO(data))
            # Then add a hardlink to it
            link_info = tarfile.TarInfo(name="bin/linked")
            link_info.type = tarfile.LNKTYPE
            link_info.linkname = "bin/original"
            tar.addfile(link_info)
        archive = tmp_path / "hardlink.tar.gz"
        archive.write_bytes(buf.getvalue())
        with pytest.raises(ValueError, match="hardlink"):
            installer.extract(archive_path=archive, dest_dir=tmp_path / "safe", strip_prefix=None)
