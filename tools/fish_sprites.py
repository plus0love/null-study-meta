"""14단계 물고기 스프라이트 (오리지널, 16x8 논리 → 2배 = 32x16 프레임).

출력: public/assets/fish.png / fish.json — 10종 x 2프레임(꼬리 흔들기). 프레임 = species.index * 2 + f. 왼쪽을 본다 (오른쪽은 flipX).
      tools/out/s14_fish_row.png (검수용)
도감의 미포획 실루엣은 클라이언트가 캔버스로 어둡게 칠한다.
실행: python tools/fish_sprites.py
"""
import json
import os
import sys

from PIL import Image, ImageDraw

sys.path.insert(0, os.path.dirname(__file__))
from pixel import Canvas  # noqa: E402

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "public", "assets")
PREVIEW_DIR = os.path.join(ROOT, "tools", "out")
W, H, SCALE = 16, 8, 2
EYE = "#2b2530"

# id, 몸 색, 밝은 색, 진한 색, 무늬
FISH = [
    ("crucian", "#b8a05a", "#d9c47a", "#8a7a3a", None),
    ("minnow", "#b9c4d6", "#e2e8f0", "#8a95a8", "stripe"),
    ("bluegill", "#5f8a9c", "#8fb8c8", "#3f6a7c", "blue_cheek"),
    ("carp", "#8a7f6a", "#b3a68c", "#5e5646", "scales"),
    ("catfish", "#6b6a62", "#8f8e86", "#4a4942", "whisker"),
    ("loach", "#a88a5e", "#c9ab7e", "#7a6240", "dots"),
    ("koi", "#f2f0ea", "#ffffff", "#c9c4b8", "koi"),
    ("trout", "#8fa88a", "#b8ccb2", "#5f7a5a", "spots"),
    ("bass", "#6f8a4a", "#95ad6a", "#4a6230", "stripe_h"),
    ("golden_carp", "#f2c23a", "#ffe07a", "#c9901a", "gold"),
]
NAMES = {"crucian": "붕어", "minnow": "피라미", "bluegill": "블루길", "carp": "잉어", "catfish": "메기", "loach": "미꾸라지", "koi": "비단잉어", "trout": "송어", "bass": "배스", "golden_carp": "황금 잉어"}


def fish(spec, frame):
    fid, body, hi, dk, pat = spec
    c = Canvas(W, H)
    slim = fid in ("loach", "minnow")
    # 몸 (왼쪽 머리)
    if slim:
        c.ellipse(1, 2, 12, 4, body)
    else:
        c.ellipse(1, 1, 11, 6, body)
    c.hline(3, 8, 2 if not slim else 3, hi)
    # 꼬리 (프레임에 따라 위/아래로)
    ty = 1 if frame == 0 else 4
    c.rect(12, 2, 2, 4, dk)
    c.rect(14, ty, 2, 3, dk)
    # 등지느러미
    c.rect(5, 0 if not slim else 1, 3, 1, dk)
    # 눈
    c.px(3, 3, EYE)
    if pat == "stripe":
        c.hline(4, 10, 4, dk)
    elif pat == "blue_cheek":
        c.px(4, 5, "#2f4f7c")
        c.px(5, 5, "#2f4f7c")
    elif pat == "scales":
        for x in (5, 7, 9):
            c.px(x, 4, dk)
    elif pat == "whisker":
        c.px(0, 4, dk)
        c.px(0, 5, dk)
        c.px(1, 6, dk)
    elif pat == "dots":
        for x in (4, 7, 10):
            c.px(x, 2 if frame == 0 else 3, dk)
    elif pat == "koi":
        c.rect(5, 2, 3, 3, "#e0603a")
        c.rect(9, 3, 2, 2, "#e0603a")
    elif pat == "spots":
        for x, y in ((5, 3), (8, 4), (10, 2)):
            c.px(x, y, "#d97a6e")
    elif pat == "stripe_h":
        c.hline(3, 10, 3, dk)
    elif pat == "gold":
        c.px(6, 3, "#ffffff")
        c.px(9, 2, "#ffffff")
        c.px(2, 1, "#fff6c0")
    return c


def build():
    sheet = Image.new("RGBA", (2 * W, len(FISH) * H), (0, 0, 0, 0))
    for i, spec in enumerate(FISH):
        for f in range(2):
            sheet.alpha_composite(fish(spec, f).im, (f * W, i * H))
    big = sheet.resize((sheet.width * SCALE, sheet.height * SCALE), Image.NEAREST)
    os.makedirs(OUT, exist_ok=True)
    big.save(os.path.join(OUT, "fish.png"), optimize=True)
    meta = {"frameWidth": W * SCALE, "frameHeight": H * SCALE, "framesPerSpecies": 2, "species": {s[0]: {"index": i, "name": NAMES[s[0]]} for i, s in enumerate(FISH)}}
    with open(os.path.join(OUT, "fish.json"), "w", encoding="utf-8") as fp:
        json.dump(meta, fp, ensure_ascii=False, separators=(",", ":"))
    os.makedirs(PREVIEW_DIR, exist_ok=True)
    cell = W * SCALE * 2 + 12
    row = Image.new("RGBA", (len(FISH) * cell + 12, H * SCALE * 2 + 34), (106, 156, 192, 255))
    d = ImageDraw.Draw(row)
    for i, spec in enumerate(FISH):
        fr = fish(spec, 0).im.resize((W * SCALE * 2, H * SCALE * 2), Image.NEAREST)
        row.alpha_composite(fr, (6 + i * cell, 4))
        d.text((6 + i * cell, H * SCALE * 2 + 10), NAMES[spec[0]], fill=(20, 18, 30, 255))
    row.save(os.path.join(PREVIEW_DIR, "s14_fish_row.png"))
    print("fish:", big.size)


if __name__ == "__main__":
    build()
