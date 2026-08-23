from __future__ import annotations

import re
from pathlib import Path

from .validation import ValidatedImage


class UnsafeStoragePath(ValueError):
    pass


_ANALYSIS_ID = re.compile(r"^c_[0-9]{8}_[0-9a-f]{32}$")
_EXTENSIONS = {
    "image/png": "png",
    "image/jpeg": "jpg",
    "image/webp": "webp",
}


class LocalImageStore:
    def __init__(self, data_root: Path) -> None:
        self._root = data_root.expanduser().resolve()
        self._root.mkdir(parents=True, exist_ok=True)

    def _safe_path(self, relative_path: str) -> Path:
        relative = Path(relative_path)
        if relative.is_absolute() or not relative.parts or ".." in relative.parts:
            raise UnsafeStoragePath("The storage path is outside the data directory.")

        candidate = self._root.joinpath(relative)
        current = self._root
        for part in relative.parts:
            current = current / part
            if current.is_symlink():
                raise UnsafeStoragePath("Symbolic links are not allowed in storage paths.")

        resolved = candidate.resolve(strict=False)
        if not resolved.is_relative_to(self._root):
            raise UnsafeStoragePath("The storage path is outside the data directory.")
        return resolved

    def put(self, analysis_id: str, image: ValidatedImage) -> str:
        if _ANALYSIS_ID.fullmatch(analysis_id) is None:
            raise UnsafeStoragePath("The analysis ID cannot be used as a storage path.")
        extension = _EXTENSIONS[image.mime_type]
        relative_path = f"images/{analysis_id}/original.{extension}"
        destination = self._safe_path(relative_path)
        destination.parent.mkdir(parents=True, exist_ok=True)
        destination = self._safe_path(relative_path)
        with destination.open("xb") as output:
            output.write(image.data)
        return relative_path

    def read(self, relative_path: str) -> bytes:
        source = self._safe_path(relative_path)
        if not source.is_file():
            raise FileNotFoundError(relative_path)
        return source.read_bytes()

    def delete(self, relative_path: str) -> None:
        target = self._safe_path(relative_path)
        if target.exists():
            target.unlink()
