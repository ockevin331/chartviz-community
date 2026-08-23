import os

import pytest

from chartviz_community.image_store import LocalImageStore, UnsafeStoragePath
from chartviz_community.validation import validate_image
from test_validation import png


ANALYSIS_ID = "c_20260823_0123456789abcdef0123456789abcdef"


def test_image_store_round_trips_under_the_analysis_directory(tmp_path) -> None:
    store = LocalImageStore(tmp_path)
    image = validate_image(png(), max_bytes=1_000_000, max_pixels=1_000_000)

    relative_path = store.put(ANALYSIS_ID, image)

    assert relative_path == f"images/{ANALYSIS_ID}/original.png"
    assert store.read(relative_path) == image.data
    store.delete(relative_path)
    assert not (tmp_path / relative_path).exists()


@pytest.mark.parametrize(
    "unsafe_path",
    ["../outside.png", "/etc/passwd", "images/../../outside.png"],
)
def test_image_store_rejects_paths_outside_the_data_root(
    tmp_path,
    unsafe_path: str,
) -> None:
    store = LocalImageStore(tmp_path)

    with pytest.raises(UnsafeStoragePath):
        store.read(unsafe_path)


def test_image_store_rejects_symlinks_that_escape_the_data_root(tmp_path) -> None:
    outside = tmp_path.parent / f"{tmp_path.name}-outside"
    outside.mkdir()
    (outside / "secret.png").write_bytes(b"outside")
    (tmp_path / "images").mkdir()
    os.symlink(outside, tmp_path / "images" / "linked")
    store = LocalImageStore(tmp_path)

    with pytest.raises(UnsafeStoragePath):
        store.read("images/linked/secret.png")
