import hashlib
import io
import tarfile
from pathlib import Path
from unittest.mock import patch

import pytest

from ecos_server.resource.inventory import InventoryService
from ecos_server.resource.pdks import PdkResourceService
from ecos_server.resource.schemas import PlatformAsset, PostInstallStep, ResourceAction


def _make_pdk_tarball(tmp_path: Path, prefix: str = "ics55-pdk") -> tuple[Path, str, int]:
    buf = io.BytesIO()
    with tarfile.open(fileobj=buf, mode="w:gz") as tar:
        for name, content in {
            f"{prefix}/prtech/tech.lef": b"LAYER M1",
            f"{prefix}/IP/README": b"IP cells",
        }.items():
            info = tarfile.TarInfo(name=name)
            info.size = len(content)
            tar.addfile(info, io.BytesIO(content))
    data = buf.getvalue()
    archive = tmp_path / "ics55.tar.gz"
    archive.write_bytes(data)
    return archive, hashlib.sha256(data).hexdigest(), len(data)


@pytest.fixture
def temp_dirs(tmp_path: Path) -> tuple[Path, Path]:
    resource_manifest = tmp_path / "resources" / "manifest.json"
    tools_manifest = tmp_path / "tools" / "manifest.json"
    return resource_manifest, tools_manifest


@pytest.fixture
def inventory(temp_dirs: tuple[Path, Path]) -> InventoryService:
    rm, _tm = temp_dirs
    return InventoryService(resource_manifest_path=rm)


@pytest.fixture
def service(inventory: InventoryService) -> PdkResourceService:
    return PdkResourceService(inventory=inventory)


@pytest.fixture
def ics55_dir(tmp_path: Path) -> Path:
    """Create a mock ics55 PDK directory structure."""
    pdk_dir = tmp_path / "pdks" / "ics55"
    pdk_dir.mkdir(parents=True)
    (pdk_dir / "prtech").mkdir()
    (pdk_dir / "IP").mkdir()
    (pdk_dir / "libs.ref").write_text("tech.lef")
    (pdk_dir / "tech.lef").write_text("LAYER M1")
    return pdk_dir


@pytest.fixture
def sky130_dir(tmp_path: Path) -> Path:
    """Create a mock sky130 PDK directory structure."""
    pdk_dir = tmp_path / "pdks" / "sky130-tools"
    pdk_dir.mkdir(parents=True)
    (pdk_dir / "sky130_fd_sc_hd").mkdir()
    return pdk_dir


@pytest.fixture
def generic_pdk_dir(tmp_path: Path) -> Path:
    """Create a directory with .lef files."""
    pdk_dir = tmp_path / "pdks" / "mypdk"
    pdk_dir.mkdir(parents=True)
    (pdk_dir / "cells.lef").write_text("MACRO INV")
    (pdk_dir / "cells.lib").write_text("library(cells)")
    return pdk_dir


class TestPdkScan:
    """Scan returns metadata without mutating inventory."""

    def test_scan_ics55_detects_prtech_and_ip(
        self, service: PdkResourceService, ics55_dir: Path
    ) -> None:
        result = service.scan(str(ics55_dir))
        assert result.name == "ics55"
        assert result.tech_node == "55nm"
        assert "ICSPROUT" in result.description
        assert "prtech" in result.detected_files
        assert "IP" in result.detected_files
        assert result.detected_file_groups == {
            "directories": ["IP", "prtech"],
            "files": ["libs.ref", "tech.lef"],
        }

    def test_scan_sky130_detects_directory_prefix(
        self, service: PdkResourceService, sky130_dir: Path
    ) -> None:
        result = service.scan(str(sky130_dir))
        assert result.pdk_id == "sky130"
        assert result.tech_node == "130nm"
        assert "SkyWater" in result.name

    def test_scan_generic_detects_lef_lib_files(
        self, service: PdkResourceService, generic_pdk_dir: Path
    ) -> None:
        result = service.scan(str(generic_pdk_dir))
        assert "Process library" in result.description
        assert "cells.lef" in result.detected_files

    def test_scan_unknown_directory(self, service: PdkResourceService, tmp_path: Path) -> None:
        empty_dir = tmp_path / "empty_pdk"
        empty_dir.mkdir()
        result = service.scan(str(empty_dir))
        assert result.name == "empty_pdk"
        assert result.description == ""

    def test_scan_does_not_mutate_inventory(
        self, service: PdkResourceService, ics55_dir: Path
    ) -> None:
        service.scan(str(ics55_dir))
        assert service.inventory.get_pdk("ics55") is None

    def test_scan_resolves_relative_path(
        self, service: PdkResourceService, ics55_dir: Path, tmp_path: Path
    ) -> None:
        import os

        cwd = os.getcwd()
        try:
            os.chdir(tmp_path)
            rel = str(ics55_dir.relative_to(tmp_path))
            result = service.scan(rel)
            assert result.canonical_path == str(ics55_dir.resolve())
        finally:
            os.chdir(cwd)


class TestPdkImport:
    """Import creates or updates inventory entries."""

    def test_import_creates_entry(self, service: PdkResourceService, ics55_dir: Path) -> None:
        entry = service.import_pdk(str(ics55_dir))
        assert entry.id == "ics55"
        assert entry.name == "ics55"
        assert entry.canonical_path == str(ics55_dir.resolve())
        assert "prtech" in entry.detected_files
        assert entry.detected_file_groups["directories"] == ["IP", "prtech"]
        assert entry.active is False
        assert entry.managed is False
        assert entry.health == "ok"

    def test_import_updates_existing_entry(
        self, service: PdkResourceService, ics55_dir: Path
    ) -> None:
        service.import_pdk(str(ics55_dir))
        service.activate("ics55")
        second = service.import_pdk(str(ics55_dir))
        # Active state preserved on re-import
        assert second.active is True

    def test_import_persists_across_service_instances(
        self, inventory: InventoryService, ics55_dir: Path
    ) -> None:
        svc1 = PdkResourceService(inventory=inventory)
        svc1.import_pdk(str(ics55_dir))

        svc2 = PdkResourceService(inventory=inventory)
        pdk = svc2.get_pdk("ics55")
        assert pdk is not None
        assert pdk.canonical_path == str(ics55_dir.resolve())

    def test_import_replaces_managed_entry_with_unmanaged_local_reference(
        self, service: PdkResourceService, inventory: InventoryService, ics55_dir: Path
    ) -> None:
        inventory.add_or_update_pdk(
            "sky130",
            canonical_path="/tmp/sky130",
            active=True,
        )
        inventory.add_or_update_pdk(
            "ics55",
            canonical_path="/tmp/managed",
            version="1.01",
            sha256="3" * 64,
            source="registry",
            source_url="https://example.com/ics55.tar.gz",
            managed=True,
        )

        entry = service.import_pdk(str(ics55_dir))

        assert entry.canonical_path == str(ics55_dir.resolve())
        assert entry.managed is False
        assert entry.version == ""
        assert entry.sha256 == ""
        assert entry.source == ""
        assert entry.source_url == ""
        assert entry.active is False
        assert inventory.get_pdk("sky130").active is True

    def test_import_preserves_active_when_replacing_active_managed_entry(
        self, service: PdkResourceService, inventory: InventoryService, ics55_dir: Path
    ) -> None:
        inventory.add_or_update_pdk(
            "ics55",
            canonical_path="/tmp/managed",
            version="1.01",
            sha256="3" * 64,
            source="registry",
            source_url="https://example.com/ics55.tar.gz",
            managed=True,
            active=True,
        )

        entry = service.import_pdk(str(ics55_dir))

        assert entry.active is True
        assert entry.managed is False
        assert entry.version == ""
        assert entry.sha256 == ""
        assert entry.source == ""
        assert entry.source_url == ""


class TestPdkActivate:
    """Activate/deactivate PDK entries."""

    def test_activate_marks_active(self, service: PdkResourceService, ics55_dir: Path) -> None:
        service.import_pdk(str(ics55_dir))
        service.activate("ics55")
        assert service.get_pdk("ics55").active is True

    def test_activate_exclusive(
        self, service: PdkResourceService, ics55_dir: Path, sky130_dir: Path
    ) -> None:
        service.import_pdk(str(ics55_dir))
        service.import_pdk(str(sky130_dir))
        service.activate("ics55")
        service.activate("sky130")
        assert service.get_pdk("ics55").active is False
        assert service.get_pdk("sky130").active is True

    def test_deactivate(self, service: PdkResourceService, ics55_dir: Path) -> None:
        service.import_pdk(str(ics55_dir))
        service.activate("ics55")
        service.deactivate("ics55")
        assert service.get_pdk("ics55").active is False

    def test_get_active_pdk(self, service: PdkResourceService, ics55_dir: Path) -> None:
        service.import_pdk(str(ics55_dir))
        service.activate("ics55")
        active = service.get_active_pdk()
        assert active is not None
        assert active.id == "ics55"


class TestPdkValidate:
    """Validate updates PDK health."""

    def test_validate_existing_pdk_ok(self, service: PdkResourceService, ics55_dir: Path) -> None:
        service.import_pdk(str(ics55_dir))
        health = service.validate("ics55")
        assert health == "ok"
        assert service.get_pdk("ics55").health == "ok"

    def test_validate_missing_pdk(self, service: PdkResourceService, tmp_path: Path) -> None:
        # Import a PDK, then delete its source directory
        pdk_dir = tmp_path / "pdks" / "temp_pdk"
        pdk_dir.mkdir(parents=True)
        (pdk_dir / "prtech").mkdir()
        (pdk_dir / "IP").mkdir()

        service.import_pdk(str(pdk_dir))

        # Remove the directory
        import shutil

        shutil.rmtree(pdk_dir)

        health = service.validate("ics55")
        assert health == "missing"
        assert service.get_pdk("ics55").health == "missing"
        # The PDK entry is NOT automatically removed
        assert service.get_pdk("ics55") is not None

    def test_validate_invalid_pdk_path(self, service: PdkResourceService, tmp_path: Path) -> None:
        # Create a file (not a directory) and manually inject it into inventory
        fake_path = tmp_path / "not_a_dir"
        fake_path.write_text("data")
        service.inventory.add_or_update_pdk("test", canonical_path=str(fake_path))

        health = service.validate("test")
        assert health == "invalid"

    def test_validate_nonexistent_pdk_raises(self, service: PdkResourceService) -> None:
        with pytest.raises(KeyError, match="not found"):
            service.validate("nonexistent")


class TestPdkRemoveReference:
    """Remove-reference deletes only inventory entry, never source."""

    def test_remove_reference(self, service: PdkResourceService, ics55_dir: Path) -> None:
        service.import_pdk(str(ics55_dir))
        service.remove_reference("ics55")
        assert service.get_pdk("ics55") is None

    def test_remove_reference_preserves_source(
        self, service: PdkResourceService, ics55_dir: Path
    ) -> None:
        service.import_pdk(str(ics55_dir))
        service.remove_reference("ics55")
        assert ics55_dir.exists()
        assert (ics55_dir / "prtech").is_dir()


class TestPdkList:
    def test_list_pdks(
        self, service: PdkResourceService, ics55_dir: Path, sky130_dir: Path
    ) -> None:
        service.import_pdk(str(ics55_dir))
        service.import_pdk(str(sky130_dir))
        pdks = service.list_pdks()
        assert len(pdks) == 2
        assert "ics55" in pdks
        assert "sky130" in pdks


class TestPdkNegative:
    """Negative tests per AC-6."""

    def test_scan_rejects_invalid_characters(self, service: PdkResourceService) -> None:
        with pytest.raises(ValueError, match="invalid characters"):
            service.scan("/path/with spaces/pdk")

    def test_scan_rejects_non_directory(self, service: PdkResourceService, tmp_path: Path) -> None:
        f = tmp_path / "not_a_dir"
        f.write_text("content")
        with pytest.raises(ValueError, match="Not a directory"):
            service.scan(str(f))

    def test_import_rejects_invalid_path(self, service: PdkResourceService) -> None:
        with pytest.raises(ValueError, match="invalid characters"):
            service.import_pdk("/path/with 中文/pdk")


@pytest.mark.asyncio
async def test_install_managed_pdk_downloads_scans_and_activates_first(
    inventory: InventoryService, tmp_path: Path
) -> None:
    archive, sha, size = _make_pdk_tarball(tmp_path)
    pdks_dir = tmp_path / "managed-pdks"
    inventory = InventoryService(
        resource_manifest_path=tmp_path / "resources" / "manifest.json",
        pdks_dir=pdks_dir,
    )
    service = PdkResourceService(inventory=inventory)
    events = []

    with patch.object(service._installer, "download") as download:

        async def fake_download(url, dest, expected_size=None, on_progress=None):
            dest.write_bytes(archive.read_bytes())
            if on_progress:
                on_progress(1.0)

        download.side_effect = fake_download
        await service.install_managed_pdk(
            pdk_id="ics55",
            display_name="ICSPROUT 55nm PDK",
            version="1.01",
            asset=PlatformAsset(
                url="https://example.com/ics55.tar.gz",
                sha256=sha,
                size=size,
                strip_prefix="ics55-pdk",
            ),
            action=ResourceAction.install,
            on_progress=events.append,
        )

    entry = inventory.get_pdk("ics55")
    assert entry is not None
    assert entry.version == "1.01"
    assert entry.sha256 == sha
    assert entry.source == "registry"
    assert entry.source_url == "https://example.com/ics55.tar.gz"
    assert entry.managed is True
    assert entry.active is True
    assert Path(entry.canonical_path) == pdks_dir / "ics55" / "1.01"
    assert (Path(entry.canonical_path) / "prtech").is_dir()
    assert (Path(entry.canonical_path) / "IP").is_dir()
    assert [event.phase for event in events] == [
        "downloading",
        "downloading",
        "verifying",
        "extracting",
        "done",
    ]


@pytest.mark.asyncio
async def test_install_managed_pdk_extracts_via_staging_dir_then_moves_into_place(
    tmp_path: Path,
) -> None:
    archive, sha, size = _make_pdk_tarball(tmp_path)
    pdks_dir = tmp_path / "managed-pdks"
    inventory = InventoryService(
        resource_manifest_path=tmp_path / "resources" / "manifest.json",
        pdks_dir=pdks_dir,
    )
    service = PdkResourceService(inventory=inventory)
    extract_calls: list[Path] = []
    staging_dir = pdks_dir / "ics55" / ".staging-1.01"
    final_dir = pdks_dir / "ics55" / "1.01"

    with (
        patch.object(service._installer, "download") as download,
        patch.object(service._installer, "extract") as extract,
    ):

        async def fake_download(url, dest, expected_size=None, on_progress=None):
            dest.write_bytes(archive.read_bytes())

        def fake_extract(archive_path, dest_dir, strip_prefix):
            extract_calls.append(dest_dir)
            dest_dir.mkdir(parents=True, exist_ok=True)
            (dest_dir / "prtech").mkdir()
            (dest_dir / "IP").mkdir()

        download.side_effect = fake_download
        extract.side_effect = fake_extract

        await service.install_managed_pdk(
            pdk_id="ics55",
            display_name="ICSPROUT 55nm PDK",
            version="1.01",
            asset=PlatformAsset(
                url="https://example.com/ics55.tar.gz",
                sha256=sha,
                size=size,
                strip_prefix="ics55-pdk",
            ),
        )

    assert extract_calls == [staging_dir]
    assert final_dir.exists()
    assert not staging_dir.exists()


@pytest.mark.asyncio
async def test_install_managed_pdk_runs_post_install_before_scan(tmp_path: Path) -> None:
    archive, sha, size = _make_pdk_tarball(tmp_path)
    pdks_dir = tmp_path / "managed-pdks"
    inventory = InventoryService(
        resource_manifest_path=tmp_path / "resources" / "manifest.json",
        pdks_dir=pdks_dir,
    )
    service = PdkResourceService(inventory=inventory)
    events = []

    with (
        patch.object(service._installer, "download") as download,
        patch.object(service._installer, "extract") as extract,
        patch("ecos_server.resource.pdks.subprocess.run") as run,
    ):

        async def fake_download(url, dest, expected_size=None, on_progress=None):
            dest.write_bytes(archive.read_bytes())

        def fake_extract(archive_path, dest_dir, strip_prefix):
            dest_dir.mkdir(parents=True, exist_ok=True)
            (dest_dir / "Makefile").write_text("unzip:\n\t@true\n")
            (dest_dir / "prtech").mkdir()
            (dest_dir / "IP").mkdir()

        download.side_effect = fake_download
        extract.side_effect = fake_extract

        await service.install_managed_pdk(
            pdk_id="ics55",
            display_name="ICSPROUT 55nm PDK",
            version="1.10.100",
            asset=PlatformAsset(
                url="https://example.com/ics55.tar.gz",
                sha256=sha,
                size=size,
                strip_prefix="ics55-pdk",
                post_install=[PostInstallStep(command=["make", "unzip"])],
            ),
            on_progress=events.append,
        )

    staging_dir = pdks_dir / "ics55" / ".staging-1.10.100"
    run.assert_called_once_with(
        ["make", "unzip"],
        cwd=staging_dir,
        check=True,
        text=True,
        capture_output=True,
    )
    assert inventory.get_pdk("ics55") is not None
    assert [event.phase for event in events] == [
        "downloading",
        "verifying",
        "extracting",
        "post_install",
        "done",
    ]


@pytest.mark.asyncio
async def test_install_managed_pdk_post_install_failure_cleans_up_and_does_not_register(
    tmp_path: Path,
) -> None:
    archive, sha, size = _make_pdk_tarball(tmp_path)
    pdks_dir = tmp_path / "managed-pdks"
    inventory = InventoryService(
        resource_manifest_path=tmp_path / "resources" / "manifest.json",
        pdks_dir=pdks_dir,
    )
    service = PdkResourceService(inventory=inventory)
    staging_dir = pdks_dir / "ics55" / ".staging-1.10.100"
    dest_dir = pdks_dir / "ics55" / "1.10.100"

    with (
        patch.object(service._installer, "download") as download,
        patch.object(service._installer, "extract") as extract,
        patch("ecos_server.resource.pdks.subprocess.run") as run,
    ):

        async def fake_download(url, dest, expected_size=None, on_progress=None):
            dest.write_bytes(archive.read_bytes())

        def fake_extract(archive_path, dest_dir, strip_prefix):
            dest_dir.mkdir(parents=True, exist_ok=True)
            (dest_dir / "Makefile").write_text("unzip:\n\t@false\n")
            (dest_dir / "prtech").mkdir()
            (dest_dir / "IP").mkdir()

        download.side_effect = fake_download
        extract.side_effect = fake_extract
        run.side_effect = RuntimeError("make unzip failed")

        with pytest.raises(RuntimeError, match="make unzip failed"):
            await service.install_managed_pdk(
                pdk_id="ics55",
                display_name="ICSPROUT 55nm PDK",
                version="1.10.100",
                asset=PlatformAsset(
                    url="https://example.com/ics55.tar.gz",
                    sha256=sha,
                    size=size,
                    strip_prefix="ics55-pdk",
                    post_install=[PostInstallStep(command=["make", "unzip"])],
                ),
            )

    assert inventory.get_pdk("ics55") is None
    assert not staging_dir.exists()
    assert not dest_dir.exists()


@pytest.mark.asyncio
async def test_install_managed_pdk_sha256_mismatch_publishes_error_and_does_not_register(
    tmp_path: Path,
) -> None:
    archive, _sha, size = _make_pdk_tarball(tmp_path)
    inventory = InventoryService(
        resource_manifest_path=tmp_path / "resources" / "manifest.json",
        pdks_dir=tmp_path / "managed-pdks",
    )
    service = PdkResourceService(inventory=inventory)
    events = []

    with patch.object(service._installer, "download") as download:

        async def fake_download(url, dest, expected_size=None, on_progress=None):
            dest.write_bytes(archive.read_bytes())

        download.side_effect = fake_download
        with pytest.raises(ValueError, match="SHA256 verification failed"):
            await service.install_managed_pdk(
                pdk_id="ics55",
                display_name="ICSPROUT 55nm PDK",
                version="1.01",
                asset=PlatformAsset(
                    url="https://example.com/ics55.tar.gz",
                    sha256="0" * 64,
                    size=size,
                    strip_prefix="ics55-pdk",
                ),
                on_progress=events.append,
            )

    assert inventory.get_pdk("ics55") is None
    assert [event.phase for event in events][-2:] == ["verifying", "error"]
    assert events[-1].error == "SHA256 verification failed"


@pytest.mark.asyncio
async def test_install_managed_pdk_extract_failure_cleans_up_staging_and_destination(
    tmp_path: Path,
) -> None:
    archive, sha, size = _make_pdk_tarball(tmp_path)
    pdks_dir = tmp_path / "managed-pdks"
    inventory = InventoryService(
        resource_manifest_path=tmp_path / "resources" / "manifest.json",
        pdks_dir=pdks_dir,
    )
    service = PdkResourceService(inventory=inventory)
    dest_dir = pdks_dir / "ics55" / "1.01"
    staging_dir = pdks_dir / "ics55" / ".staging-1.01"

    with (
        patch.object(service._installer, "download") as download,
        patch.object(service._installer, "extract", side_effect=RuntimeError("extract failed")),
    ):

        async def fake_download(url, dest, expected_size=None, on_progress=None):
            dest.write_bytes(archive.read_bytes())

        download.side_effect = fake_download
        with pytest.raises(RuntimeError, match="extract failed"):
            await service.install_managed_pdk(
                pdk_id="ics55",
                display_name="ICSPROUT 55nm PDK",
                version="1.01",
                asset=PlatformAsset(
                    url="https://example.com/ics55.tar.gz",
                    sha256=sha,
                    size=size,
                    strip_prefix="ics55-pdk",
                ),
            )

    assert inventory.get_pdk("ics55") is None
    assert not dest_dir.exists()
    assert not staging_dir.exists()


@pytest.mark.asyncio
async def test_install_managed_pdk_does_not_replace_existing_active_pdk(tmp_path: Path) -> None:
    archive, sha, size = _make_pdk_tarball(tmp_path)
    inventory = InventoryService(
        resource_manifest_path=tmp_path / "resources" / "manifest.json",
        pdks_dir=tmp_path / "managed-pdks",
    )
    active_root = tmp_path / "local" / "active"
    active_root.mkdir(parents=True)
    inventory.add_or_update_pdk(
        "local",
        name="Local PDK",
        canonical_path=str(active_root),
        active=True,
    )
    service = PdkResourceService(inventory=inventory)

    with patch.object(service._installer, "download") as download:

        async def fake_download(url, dest, expected_size=None, on_progress=None):
            dest.write_bytes(archive.read_bytes())

        download.side_effect = fake_download
        await service.install_managed_pdk(
            pdk_id="ics55",
            display_name="ICSPROUT 55nm PDK",
            version="1.01",
            asset=PlatformAsset(
                url="https://example.com/ics55.tar.gz",
                sha256=sha,
                size=size,
                strip_prefix="ics55-pdk",
            ),
        )

    assert inventory.get_pdk("local").active is True
    assert inventory.get_pdk("ics55").active is False
    assert inventory.get_pdk("ics55").canonical_path == str(
        tmp_path / "managed-pdks" / "ics55" / "1.01"
    )


@pytest.mark.asyncio
async def test_install_managed_pdk_update_same_active_pdk_keeps_it_active(tmp_path: Path) -> None:
    archive, sha, size = _make_pdk_tarball(tmp_path)
    pdks_dir = tmp_path / "managed-pdks"
    inventory = InventoryService(
        resource_manifest_path=tmp_path / "resources" / "manifest.json",
        pdks_dir=pdks_dir,
    )
    old_root = pdks_dir / "ics55" / "1.00"
    old_root.mkdir(parents=True)
    (old_root / "prtech").mkdir()
    (old_root / "IP").mkdir()
    inventory.add_or_update_pdk(
        "ics55",
        name="ICSPROUT 55nm PDK",
        canonical_path=str(old_root),
        version="1.00",
        sha256="1" * 64,
        source="registry",
        source_url="https://example.com/ics55-1.00.tar.gz",
        managed=True,
        active=True,
    )
    service = PdkResourceService(inventory=inventory)

    with patch.object(service._installer, "download") as download:

        async def fake_download(url, dest, expected_size=None, on_progress=None):
            dest.write_bytes(archive.read_bytes())

        download.side_effect = fake_download
        await service.install_managed_pdk(
            pdk_id="ics55",
            display_name="ICSPROUT 55nm PDK",
            version="1.01",
            asset=PlatformAsset(
                url="https://example.com/ics55.tar.gz",
                sha256=sha,
                size=size,
                strip_prefix="ics55-pdk",
            ),
        )

    entry = inventory.get_pdk("ics55")
    assert entry is not None
    assert entry.active is True
    assert entry.version == "1.01"
    assert entry.canonical_path == str(pdks_dir / "ics55" / "1.01")


@pytest.mark.asyncio
async def test_install_managed_pdk_update_removes_old_managed_version_directory(
    tmp_path: Path,
) -> None:
    archive, sha, size = _make_pdk_tarball(tmp_path)
    pdks_dir = tmp_path / "managed-pdks"
    inventory = InventoryService(
        resource_manifest_path=tmp_path / "resources" / "manifest.json",
        pdks_dir=pdks_dir,
    )
    local_root = tmp_path / "local" / "active"
    local_root.mkdir(parents=True)
    inventory.add_or_update_pdk(
        "local",
        name="Local PDK",
        canonical_path=str(local_root),
        active=True,
    )
    old_root = pdks_dir / "ics55" / "1.00"
    old_root.mkdir(parents=True)
    (old_root / "prtech").mkdir()
    (old_root / "IP").mkdir()
    inventory.add_or_update_pdk(
        "ics55",
        name="ICSPROUT 55nm PDK",
        canonical_path=str(old_root),
        version="1.00",
        sha256="1" * 64,
        source="registry",
        source_url="https://example.com/ics55-1.00.tar.gz",
        managed=True,
        active=False,
    )
    service = PdkResourceService(inventory=inventory)

    with patch.object(service._installer, "download") as download:

        async def fake_download(url, dest, expected_size=None, on_progress=None):
            dest.write_bytes(archive.read_bytes())

        download.side_effect = fake_download
        await service.install_managed_pdk(
            pdk_id="ics55",
            display_name="ICSPROUT 55nm PDK",
            version="1.01",
            asset=PlatformAsset(
                url="https://example.com/ics55.tar.gz",
                sha256=sha,
                size=size,
                strip_prefix="ics55-pdk",
            ),
        )

    entry = inventory.get_pdk("ics55")
    assert entry is not None
    assert entry.version == "1.01"
    assert entry.canonical_path == str(pdks_dir / "ics55" / "1.01")
    assert entry.active is False
    assert inventory.get_pdk("local").active is True
    assert not old_root.exists()


@pytest.mark.asyncio
async def test_install_managed_pdk_allows_spaces_in_managed_pdks_dir(tmp_path: Path) -> None:
    archive, sha, size = _make_pdk_tarball(tmp_path)
    pdks_dir = tmp_path / "managed pdks"
    inventory = InventoryService(
        resource_manifest_path=tmp_path / "resources" / "manifest.json",
        pdks_dir=pdks_dir,
    )
    service = PdkResourceService(inventory=inventory)

    with patch.object(service._installer, "download") as download:

        async def fake_download(url, dest, expected_size=None, on_progress=None):
            dest.write_bytes(archive.read_bytes())

        download.side_effect = fake_download
        await service.install_managed_pdk(
            pdk_id="ics55",
            display_name="ICSPROUT 55nm PDK",
            version="1.01",
            asset=PlatformAsset(
                url="https://example.com/ics55.tar.gz",
                sha256=sha,
                size=size,
                strip_prefix="ics55-pdk",
            ),
        )

    entry = inventory.get_pdk("ics55")
    assert entry is not None
    assert entry.canonical_path == str(pdks_dir / "ics55" / "1.01")
    assert Path(entry.canonical_path).exists()


@pytest.mark.asyncio
async def test_install_managed_pdk_cleans_up_extracted_dir_on_registration_failure(
    tmp_path: Path,
) -> None:
    archive, sha, size = _make_pdk_tarball(tmp_path)
    pdks_dir = tmp_path / "managed-pdks"
    inventory = InventoryService(
        resource_manifest_path=tmp_path / "resources" / "manifest.json",
        pdks_dir=pdks_dir,
    )
    service = PdkResourceService(inventory=inventory)
    dest_dir = pdks_dir / "ics55" / "1.01"

    with (
        patch.object(service._installer, "download") as download,
        patch.object(
            service._inventory,
            "add_or_update_pdk",
            side_effect=RuntimeError("register failed"),
        ),
    ):

        async def fake_download(url, dest, expected_size=None, on_progress=None):
            dest.write_bytes(archive.read_bytes())

        download.side_effect = fake_download
        with pytest.raises(RuntimeError, match="register failed"):
            await service.install_managed_pdk(
                pdk_id="ics55",
                display_name="ICSPROUT 55nm PDK",
                version="1.01",
                asset=PlatformAsset(
                    url="https://example.com/ics55.tar.gz",
                    sha256=sha,
                    size=size,
                    strip_prefix="ics55-pdk",
                ),
            )

    assert not dest_dir.exists()
    assert inventory.get_pdk("ics55") is None


@pytest.mark.asyncio
async def test_uninstall_managed_pdk_deletes_files_and_manifest(tmp_path: Path) -> None:
    inventory = InventoryService(
        resource_manifest_path=tmp_path / "resources" / "manifest.json",
        pdks_dir=tmp_path / "managed-pdks",
    )
    root = tmp_path / "managed-pdks" / "ics55" / "1.01"
    root.mkdir(parents=True)
    (root / "prtech").mkdir()
    inventory.add_or_update_pdk(
        "ics55",
        name="ICSPROUT 55nm PDK",
        canonical_path=str(root),
        version="1.01",
        managed=True,
    )
    service = PdkResourceService(inventory=inventory)

    await service.uninstall_managed_pdk("ics55")

    assert inventory.get_pdk("ics55") is None
    assert not root.exists()


@pytest.mark.asyncio
async def test_uninstall_unmanaged_pdk_rejects_and_preserves_source(
    service: PdkResourceService, ics55_dir: Path
) -> None:
    service.import_pdk(str(ics55_dir))

    with pytest.raises(PermissionError, match="unmanaged"):
        await service.uninstall_managed_pdk("ics55")

    assert ics55_dir.exists()
    assert service.get_pdk("ics55") is not None
