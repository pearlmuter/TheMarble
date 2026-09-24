"""Derive the shipped all-sky panorama from the 16K Gaia EDR3 master.

The master is `gaia-edr3-cds-hips2fits-16k` (16384x8192, 49.35 MB), retained in
git history and in the origin asset store under its sha256
15102ef7b5b575320d2fbddf0603612d259c93d1b03847dfd519e47eb972e0e0.jpg.

Why the shipped panorama is 8192x4096 rather than the master's 16384x8192:

The sky sphere is drawn at a fixed 22 degree vertical field of view, so the
visible band is 22/180 of the texture height -- about 1000 texels of the master.
A 1600x1000 capture therefore samples the master at roughly 1:1, which is the
*worst* case for a smaller texture; at Retina the master is already magnified
about 2x and the gap only narrows. The panorama is also composited at 0.08
exposure beneath a separately drawn Hipparcos star catalogue, so it contributes
diffuse galactic glow rather than point sources -- the high-frequency content
that resolution buys is exactly what the exposure attenuates.

Measured by re-rendering the three fixed production smoke views at a pinned
scene time, master against derived:

| View       | Max channel difference | Pixels differing by >1 level |
| ---------- | ---------------------- | ---------------------------- |
| day        | 1 / 255                | 0.000%                       |
| night      | 1 / 255                | 0.000%                       |
| terminator | 2 / 255                | 0.003%                       |

That is at or below the 8-bit quantisation step, for 35.7 MB -- the panorama
was 58% of everything a first view of the site downloaded.

Quality 90 with no chroma subsampling is deliberate: the master is dominated by
per-pixel star noise, so lowering quality barely moves the file (q78 at full
resolution still weighs 46 MB). Resolution is the only lever that pays here.

Usage: python3 scripts/build-milky-way-panorama.py <master.jpg> <output.jpg>
"""

import hashlib
import sys

from PIL import Image

WIDTH = 8192
HEIGHT = 4096
QUALITY = 90

# The master exceeds Pillow's decompression-bomb guard, which is sized for
# untrusted input rather than a known 134-megapixel panorama.
Image.MAX_IMAGE_PIXELS = None


def main() -> int:
    if len(sys.argv) != 3:
        sys.stderr.write(f"usage: {sys.argv[0]} <master.jpg> <output.jpg>\n")
        return 2
    source, destination = sys.argv[1], sys.argv[2]

    master = Image.open(source).convert("RGB")
    if master.size[0] != master.size[1] * 2:
        raise SystemExit(f"An equirectangular panorama must be 2:1, not {master.size[0]}x{master.size[1]}")

    master.resize((WIDTH, HEIGHT), Image.LANCZOS).save(
        destination,
        "JPEG",
        quality=QUALITY,
        optimize=True,
        progressive=True,
        subsampling=0,
    )

    payload = open(destination, "rb").read()
    print(f"{destination}: {WIDTH}x{HEIGHT}, {len(payload)} bytes")
    print(f"sha256: {hashlib.sha256(payload).hexdigest()}")
    print("Record both in resources.milkyWay of public/earth-state/bundled-v1.json.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
