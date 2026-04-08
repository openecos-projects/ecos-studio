import hashlib
import io
import tarfile
from pathlib import Path

import pytest

from ecos_server.plugin.services.installer import InstallerService
from ecos_server.plugin.services.manager import ManagerService


def _make_tarball(tmp_path: Path, prefix: str = "") -> tuple[bytes, str]:
    buf = io.BytesIO()
    with tarfile.open(fileobj=buf, mode="w:gz") as tar:
        bin_dir = f"{prefix}/bin" if prefix else "bin"
        data = b"#!/bin/sh\necho yosys"
        info = tarfile.TarInfo(name=f"{bin_dir}/yosys")
        info.size = len(data)
        info.mode = 0o755
        tar.addfile(info, io.BytesIO(data))
    content = buf.getvalue()
    sha = hashlib.sha256(content).hexdigest()
    return content, sha


@pytest.fixture()
def tools_dir(tmp_path: Path) -> Path:
    d = tmp_path / "tools"
    d.mkdir()
    return d


@pytest.fixture()
def manager(tools_dir: Path) -> ManagerService:
    return ManagerService(tools_dir=tools_dir)


@pytest.fixture()
def installer(manager: ManagerService) -> InstallerService:
    return InstallerService(manager=manager)


def test_verify_sha256_pass(tmp_path: Path) -> None:
    content = b"hello world"
    sha = hashlib.sha256(content).hexdigest()
    file_path = tmp_path / "test.tar.gz"
    file_path.write_bytes(content)
    assert InstallerService.verify_sha256(file_path, sha) is True


def test_verify_sha256_fail(tmp_path: Path) -> None:
    file_path = tmp_path / "test.tar.gz"
    file_path.write_bytes(b"hello world")
    assert InstallerService.verify_sha256(file_path, "wrong_hash") is False


def test_extract_tarball_no_prefix(installer: InstallerService, tmp_path: Path, tools_dir: Path) -> None:
    content, _ = _make_tarball(tmp_path)
    archive = tmp_path / "yosys.tar.gz"
    archive.write_bytes(content)
    dest = tools_dir / "yosys" / "0.61"
    installer.extract(archive_path=archive, dest_dir=dest, strip_prefix=None)
    assert (dest / "bin" / "yosys").exists()


def test_extract_tarball_with_strip_prefix(
    installer: InstallerService, tmp_path: Path, tools_dir: Path
) -> None:
    content, _ = _make_tarball(tmp_path, prefix="yosys-0.61")
    archive = tmp_path / "yosys.tar.gz"
    archive.write_bytes(content)
    dest = tools_dir / "yosys" / "0.61"
    installer.extract(archive_path=archive, dest_dir=dest, strip_prefix="yosys-0.61")
    assert (dest / "bin" / "yosys").exists()


def test_atomic_extract_cleans_up_on_failure(installer: InstallerService, tmp_path: Path, tools_dir: Path) -> None:
    bad_archive = tmp_path / "bad.tar.gz"
    bad_archive.write_bytes(b"not a tarball")
    dest = tools_dir / "yosys" / "0.61"
    with pytest.raises(Exception):
        installer.extract(archive_path=bad_archive, dest_dir=dest, strip_prefix=None)
    assert not dest.exists()
