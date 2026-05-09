#!/usr/bin/env python

import hashlib
import logging
import shutil
import sys
import tarfile
import zipfile
from collections.abc import Callable
from pathlib import Path

import httpx

from .manager import ManagerService

logger = logging.getLogger(__name__)


class InstallerService:
    """Download, verify, and extract tool archives."""

    def __init__(self, manager: ManagerService) -> None:
        self._manager = manager

    @staticmethod
    def verify_sha256(file_path: Path, expected: str) -> bool:
        h = hashlib.sha256()
        with open(file_path, "rb") as f:
            for chunk in iter(lambda: f.read(8192), b""):
                h.update(chunk)
        return h.hexdigest() == expected.lower()

    def extract(
        self,
        archive_path: Path,
        dest_dir: Path,
        strip_prefix: str | None,
    ) -> None:
        """Extract archive to dest_dir atomically. On failure, dest_dir is not left half-done."""
        tmp_dir = dest_dir.parent / f".tmp_{dest_dir.name}"
        if tmp_dir.exists():
            shutil.rmtree(tmp_dir)
        tmp_dir.mkdir(parents=True)

        try:
            if tarfile.is_tarfile(archive_path):
                self._extract_tar(archive_path, tmp_dir, strip_prefix)
            elif zipfile.is_zipfile(archive_path):
                self._extract_zip(archive_path, tmp_dir, strip_prefix)
            else:
                msg = f"Unsupported archive format: {archive_path}"
                raise ValueError(msg)

            if dest_dir.exists():
                shutil.rmtree(dest_dir)
            tmp_dir.rename(dest_dir)
        except Exception:
            if tmp_dir.exists():
                shutil.rmtree(tmp_dir)
            raise

    @staticmethod
    def _extract_tar(archive: Path, dest: Path, strip_prefix: str | None) -> None:
        with tarfile.open(archive, "r:*") as tar:
            for member in tar.getmembers():
                orig = member.name
                if strip_prefix and orig.startswith(strip_prefix + "/"):
                    member.name = orig[len(strip_prefix) + 1 :]
                elif strip_prefix and orig == strip_prefix:
                    continue
                if not member.name or member.name == ".":
                    continue
                if sys.version_info >= (3, 12):
                    tar.extract(member, dest, filter="data")
                else:
                    tar.extract(member, dest)

    @staticmethod
    def _extract_zip(archive: Path, dest: Path, strip_prefix: str | None) -> None:
        with zipfile.ZipFile(archive) as zf:
            for info in zf.infolist():
                name = info.filename
                if strip_prefix and name.startswith(strip_prefix + "/"):
                    name = name[len(strip_prefix) + 1 :]
                if not name:
                    continue
                target = dest / name
                if info.is_dir():
                    target.mkdir(parents=True, exist_ok=True)
                else:
                    target.parent.mkdir(parents=True, exist_ok=True)
                    with zf.open(info) as src, open(target, "wb") as dst:
                        shutil.copyfileobj(src, dst)

    async def download(
        self,
        url: str,
        dest: Path,
        expected_size: int | None = None,
        on_progress: Callable[[float], None] | None = None,
    ) -> None:
        """Stream-download a file with optional progress callback (0..1)."""
        dest.parent.mkdir(parents=True, exist_ok=True)
        async with (
            httpx.AsyncClient(timeout=300.0, follow_redirects=True) as client,
            client.stream("GET", url) as resp,
        ):
            resp.raise_for_status()
            cl = resp.headers.get("content-length")
            total = expected_size or (int(cl) if cl else 0)
            downloaded = 0
            with open(dest, "wb") as f:
                async for chunk in resp.aiter_bytes(chunk_size=65536):
                    f.write(chunk)
                    downloaded += len(chunk)
                    if on_progress and total > 0:
                        on_progress(downloaded / total)
