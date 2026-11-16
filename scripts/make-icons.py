"""Generate the dashboard favicon / home-screen icons into dashboard/public.

Run: uv run --with pillow python scripts/make-icons.py

Design: a yellow vertical "Short" card with a dark play button, cut diagonally (the clip), on the
dashboard's dark background. Geometry is defined once on a 512-unit grid and used for the SVG and PNGs.
"""

from __future__ import annotations

import json
from pathlib import Path

from PIL import Image, ImageDraw

OUT = Path(__file__).resolve().parents[1] / "dashboard" / "public"
BG = "#0f1115"
ACCENT = "#ffe14d"
DARK = "#14171f"

# 512-unit design grid. `inset` shrinks the artwork for maskable icons (safe zone = inner 80%).
CARD = (156, 64, 356, 448)  # 9:16-ish vertical card
CARD_R = 40
PLAY = [(218, 168), (218, 300), (324, 234)]
CUT_W = 30  # width of the diagonal cut
CUT = ((110, 470), (400, 340))  # across the card's lower corner, clear of the play button


def scale_pts(pts, s, off):
    return [(off + x * s, off + y * s) for x, y in pts]


def draw_png(size: int, *, rounded_bg: bool, maskable: bool = False) -> Image.Image:
    ss = 4  # supersample for smooth edges
    S = size * ss
    img = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    if rounded_bg:
        d.rounded_rectangle((0, 0, S - 1, S - 1), radius=int(S * 0.22), fill=BG)
    else:
        d.rectangle((0, 0, S, S), fill=BG)
    k = 0.72 if maskable else 1.0  # keep artwork inside the maskable safe zone
    s = S / 512 * k
    off = (S - 512 * s) / 2
    x0, y0, x1, y1 = CARD
    d.rounded_rectangle((off + x0 * s, off + y0 * s, off + x1 * s, off + y1 * s), radius=CARD_R * s, fill=ACCENT)
    d.polygon(scale_pts(PLAY, s, off), fill=DARK)
    # Diagonal cut across the card (drawn in background color).
    w = CUT_W * s
    a, b = CUT
    d.line([(off + a[0] * s, off + a[1] * s), (off + b[0] * s, off + b[1] * s)], fill=BG, width=int(w))
    return img.resize((size, size), Image.LANCZOS)


def svg() -> str:
    x0, y0, x1, y1 = CARD
    pts = " ".join(f"{x},{y}" for x, y in PLAY)
    return f"""<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">
  <rect width="512" height="512" rx="112" fill="{BG}"/>
  <rect x="{x0}" y="{y0}" width="{x1 - x0}" height="{y1 - y0}" rx="{CARD_R}" fill="{ACCENT}"/>
  <polygon points="{pts}" fill="{DARK}"/>
  <line x1="{CUT[0][0]}" y1="{CUT[0][1]}" x2="{CUT[1][0]}" y2="{CUT[1][1]}" stroke="{BG}" stroke-width="{CUT_W}"/>
</svg>
"""


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    (OUT / "favicon.svg").write_text(svg())
    draw_png(180, rounded_bg=False).convert("RGB").save(OUT / "apple-touch-icon.png")  # iOS adds its own rounding
    draw_png(192, rounded_bg=True).save(OUT / "icon-192.png")
    draw_png(512, rounded_bg=True).save(OUT / "icon-512.png")
    draw_png(512, rounded_bg=False, maskable=True).save(OUT / "icon-maskable-512.png")
    ico = draw_png(64, rounded_bg=True)
    ico.save(OUT / "favicon.ico", sizes=[(16, 16), (32, 32), (48, 48), (64, 64)])
    manifest = {
        "name": "Clipper",
        "short_name": "Clipper",
        "description": "Review and publish YouTube Shorts clips",
        "start_url": "/",
        "scope": "/",
        "display": "standalone",
        "background_color": BG,
        "theme_color": BG,
        "icons": [
            {"src": "/icon-192.png", "sizes": "192x192", "type": "image/png"},
            {"src": "/icon-512.png", "sizes": "512x512", "type": "image/png"},
            {"src": "/icon-maskable-512.png", "sizes": "512x512", "type": "image/png", "purpose": "maskable"},
        ],
    }
    (OUT / "site.webmanifest").write_text(json.dumps(manifest, indent=2) + "\n")
    print("wrote", sorted(p.name for p in OUT.iterdir()))


if __name__ == "__main__":
    main()
