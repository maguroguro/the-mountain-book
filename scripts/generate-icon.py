#!/usr/bin/env python3
"""
Genera build/icon-1024.png (1024², sfondo trasparente) da assets/mountain-icon.png.

L’icona dell’app in package.json è assets/mountain-icon.png (stessa immagine del
caricamento in index.html). Questo script serve solo se vuoi un PNG grande per
anteprima o strumenti esterni.
"""
from pathlib import Path

try:
    from PIL import Image
except ImportError:
    raise SystemExit("Install Pillow: python3 -m venv .venv && .venv/bin/pip install Pillow")

ROOT = Path(__file__).resolve().parents[1]
SRC = ROOT / "assets" / "mountain-icon.png"
OUT = ROOT / "build" / "icon-1024.png"


def main():
    im = Image.open(SRC).convert("RGBA")
    side = 1024
    canvas = Image.new("RGBA", (side, side), (0, 0, 0, 0))
    w, h = im.size
    scale = min(side * 0.88 / w, side * 0.88 / h)
    nw, nh = int(w * scale), int(h * scale)
    im = im.resize((nw, nh), Image.LANCZOS)
    canvas.paste(im, ((side - nw) // 2, (side - nh) // 2), im)
    OUT.parent.mkdir(parents=True, exist_ok=True)
    canvas.save(OUT, "PNG")
    print(OUT)


if __name__ == "__main__":
    main()
