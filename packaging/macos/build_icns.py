#!/usr/bin/env python3
"""Build an ICNS container from the PNGs in a macOS iconset directory."""

from __future__ import annotations

import struct
import sys
from pathlib import Path


ICON_CHUNKS = (
    (b"icp4", "icon_16x16.png"),
    (b"icp5", "icon_32x32.png"),
    (b"icp6", "icon_32x32@2x.png"),
    (b"ic07", "icon_128x128.png"),
    (b"ic08", "icon_128x128@2x.png"),
    (b"ic09", "icon_256x256@2x.png"),
    (b"ic10", "icon_512x512@2x.png"),
)


def build(iconset: Path, output: Path) -> None:
    chunks = bytearray()
    for chunk_type, filename in ICON_CHUNKS:
        image = (iconset / filename).read_bytes()
        chunks.extend(chunk_type)
        chunks.extend(struct.pack(">I", len(image) + 8))
        chunks.extend(image)

    output.write_bytes(b"icns" + struct.pack(">I", len(chunks) + 8) + chunks)


if __name__ == "__main__":
    if len(sys.argv) != 3:
        raise SystemExit("Usage: build_icns.py ICONSET_DIRECTORY OUTPUT.icns")
    build(Path(sys.argv[1]), Path(sys.argv[2]))
