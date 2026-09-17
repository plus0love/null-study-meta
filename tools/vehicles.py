"""12단계 탈것 스프라이트 (오리지널, 코드 생성).

  종류 4 (bicycle · kickboard · kart · sport) × 색 6 × 8방향 = 192 프레임 + 낡은 인력거(rickshaw, 색 'wood' 하나, 바퀴 하나 찌그러짐) 8프레임, 24x20 논리 → 48x40 px.
  데칼 3종(flame · star · stripe) 8x8 논리, 경적은 소리(fx.js)뿐이라 그림 없음.
  E/SE/NE/N/S 를 그리고 W/SW/NW 는 좌우 반전.

출력: public/assets/vehicles.png / vehicles.json (Phaser atlas hash + meta.seat[type][dir] = 아바타 발 위치 오프셋(px, 프레임 아래 가운데 기준),
      meta.decal[type][dir] = 데칼 중심(px, 프레임 좌상단 기준) | null)
실행: python tools/vehicles.py
"""
import json
import os
import sys

from PIL import Image

sys.path.insert(0, os.path.dirname(__file__))
from pixel import Canvas  # noqa: E402

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "public", "assets")
FW, FH = 24, 20  # 논리 프레임
SCALE = 2
DIRS = ["s", "sw", "w", "nw", "n", "ne", "e", "se"]
DRAWN = {"e", "se", "s", "ne", "n"}
FLIP = {"w": "e", "sw": "se", "nw": "ne"}

# 몸체 색은 자리표시 3톤으로 그리고 변형마다 치환한다
BODY, BODY_DK, BODY_HI = (255, 0, 0, 255), (170, 0, 0, 255), (255, 102, 102, 255)
COLORS = {
    "red": ("#d9655f", "#a84a45", "#eb8d88"),
    "blue": ("#6d8fc4", "#4f6f9f", "#93aee0"),
    "green": ("#7fa585", "#5f8565", "#a3c4a6"),
    "yellow": ("#e5c56a", "#c4a04a", "#f1dc9a"),
    "white": ("#efe6d6", "#c9bfb0", "#ffffff"),
    "black": ("#3d3944", "#26232b", "#5a5660"),
}
RICKSHAW_COLORS = {"wood": ("#a37d5e", "#7c5a44", "#c4a184")}  # 인력거는 색 선택 없음
TIRE = "#2b282f"
TIRE_HI = "#4d4954"
RIM = "#b8b4bf"
METAL = "#8a8c94"
METAL_HI = "#c9c5cc"
SEAT_COL = "#3b3540"
SHADOW = "#00000055"


def hx(c):
    c = c.lstrip("#")
    return tuple(int(c[i:i + 2], 16) for i in (0, 2, 4)) + (255,)


def wheel_side(c, cx, cy, r=3):
    c.ellipse(cx - r, cy - r, 2 * r + 1, 2 * r + 1, TIRE)
    c.ellipse(cx - r + 1, cy - r + 1, 2 * r - 1, 2 * r - 1, TIRE_HI)
    c.px(cx, cy, RIM)


def wheel_top(c, x, y, w, h):
    c.rect(x, y, w, h, TIRE)
    c.rect(x + 1, y + 1, max(1, w - 2), max(1, h - 2), TIRE_HI)


def shadow(c, x, y, w, h):
    c.ellipse(x, y, w, h, SHADOW)


# ── 자전거 ─────────────────────────────────────────────────────────────
def bicycle(d):
    c = Canvas(FW, FH)
    if d == "e":
        shadow(c, 3, 15, 18, 4)
        wheel_side(c, 6, 14, 3)
        wheel_side(c, 17, 14, 3)
        c.hline(6, 12, 9, BODY)
        c.hline(12, 17, 9, BODY_DK)
        c.vline(9, 9, 14, BODY)
        c.vline(14, 6, 14, BODY_DK)
        c.hline(9, 14, 9, BODY_HI)
        c.rect(8, 7, 4, 2, SEAT_COL)
        c.rect(14, 5, 3, 2, METAL)
        c.px(16, 4, METAL_HI)
    elif d == "se":
        shadow(c, 4, 15, 16, 4)
        wheel_side(c, 8, 14, 3)
        c.ellipse(13, 11, 6, 7, TIRE)
        c.px(15, 14, RIM)
        c.hline(8, 14, 9, BODY)
        c.vline(11, 9, 14, BODY_DK)
        c.rect(9, 7, 4, 2, SEAT_COL)
        c.rect(13, 5, 4, 2, METAL)
    elif d == "s":
        shadow(c, 7, 15, 10, 4)
        wheel_top(c, 11, 4, 3, 5)
        wheel_top(c, 11, 12, 3, 6)
        c.rect(10, 8, 5, 4, BODY)
        c.hline(10, 14, 8, BODY_HI)
        c.rect(11, 8, 3, 1, SEAT_COL)
        c.hline(8, 16, 12, METAL)
        c.px(8, 13, METAL_HI)
        c.px(16, 13, METAL_HI)
    elif d == "ne":
        shadow(c, 4, 15, 16, 4)
        c.ellipse(6, 10, 6, 8, TIRE)
        c.px(8, 14, RIM)
        wheel_side(c, 16, 14, 3)
        c.hline(9, 16, 9, BODY)
        c.vline(12, 9, 14, BODY_DK)
        c.rect(14, 7, 4, 2, SEAT_COL)
        c.rect(6, 5, 4, 2, METAL)
    elif d == "n":
        shadow(c, 7, 15, 10, 4)
        wheel_top(c, 11, 12, 3, 6)
        wheel_top(c, 11, 3, 3, 6)
        c.rect(10, 8, 5, 4, BODY)
        c.hline(10, 14, 8, BODY_HI)
        c.rect(11, 11, 3, 1, SEAT_COL)
        c.hline(8, 16, 4, METAL)
    return c


# ── 킥보드 ─────────────────────────────────────────────────────────────
def kickboard(d):
    c = Canvas(FW, FH)
    if d == "e":
        shadow(c, 4, 16, 16, 3)
        wheel_side(c, 7, 16, 2)
        wheel_side(c, 17, 16, 2)
        c.rect(7, 13, 10, 2, BODY)
        c.hline(7, 16, 13, BODY_HI)
        c.vline(17, 3, 13, METAL)
        c.vline(18, 3, 13, BODY_DK)
        c.rect(15, 2, 6, 2, METAL_HI)
    elif d == "se":
        shadow(c, 5, 16, 14, 3)
        wheel_side(c, 8, 16, 2)
        wheel_side(c, 15, 16, 2)
        c.rect(8, 13, 8, 2, BODY)
        c.vline(15, 3, 13, METAL)
        c.rect(13, 2, 5, 2, METAL_HI)
    elif d == "s":
        shadow(c, 7, 15, 10, 4)
        wheel_top(c, 11, 5, 3, 3)
        wheel_top(c, 11, 15, 3, 3)
        c.rect(10, 8, 5, 8, BODY)
        c.hline(10, 14, 8, BODY_HI)
        c.vline(12, 4, 8, METAL)
        c.hline(8, 16, 4, METAL_HI)
    elif d == "ne":
        shadow(c, 5, 16, 14, 3)
        wheel_side(c, 8, 16, 2)
        wheel_side(c, 15, 16, 2)
        c.rect(8, 13, 8, 2, BODY)
        c.vline(8, 3, 13, METAL)
        c.rect(6, 2, 5, 2, METAL_HI)
    elif d == "n":
        shadow(c, 7, 15, 10, 4)
        wheel_top(c, 11, 14, 3, 3)
        wheel_top(c, 11, 3, 3, 3)
        c.rect(10, 6, 5, 8, BODY)
        c.hline(10, 14, 6, BODY_HI)
        c.hline(8, 16, 3, METAL_HI)
    return c


# ── 카트 ───────────────────────────────────────────────────────────────
def kart(d, sport=False):
    c = Canvas(FW, FH)
    low = 1 if sport else 0
    if d == "e":
        shadow(c, 2, 16, 20, 4)
        c.rect(4, 9 + low, 17, 6 - low, BODY)
        c.hline(4, 20, 9 + low, BODY_HI)
        c.rect(18, 8 + low, 4, 3, BODY_DK)  # 앞 범퍼(코)
        c.rect(6, 6 + low, 6, 3, SEAT_COL)  # 시트 등받이
        if sport:
            c.rect(2, 5, 5, 2, BODY_DK)  # 스포일러
            c.vline(4, 7, 9, METAL)
            c.hline(12, 17, 12, BODY_HI)
        wheel_side(c, 6, 15, 3)
        wheel_side(c, 17, 15, 3)
        c.rect(13, 7 + low, 3, 2, METAL)  # 핸들
    elif d == "se":
        shadow(c, 2, 16, 20, 4)
        c.rect(4, 9 + low, 16, 6 - low, BODY)
        c.hline(4, 19, 9 + low, BODY_HI)
        c.rect(16, 9 + low, 5, 4, BODY_DK)
        c.rect(6, 6 + low, 6, 3, SEAT_COL)
        if sport:
            c.rect(3, 5, 5, 2, BODY_DK)
        wheel_side(c, 6, 15, 3)
        wheel_side(c, 16, 16, 3)
        c.rect(12, 7 + low, 3, 2, METAL)
    elif d == "s":
        shadow(c, 4, 15, 16, 4)
        c.rect(7, 4 + low, 10, 12 - low, BODY)
        c.hline(7, 16, 4 + low, BODY_HI)
        c.rect(7, 13, 10, 3, BODY_DK)  # 앞 범퍼
        c.rect(8, 5 + low, 8, 2, SEAT_COL)  # 등받이 (위)
        if sport:
            c.rect(5, 3, 14, 2, BODY_DK)
        wheel_top(c, 4, 5, 3, 5)
        wheel_top(c, 17, 5, 3, 5)
        wheel_top(c, 4, 13, 3, 5)
        wheel_top(c, 17, 13, 3, 5)
        c.hline(9, 14, 11, METAL)
    elif d == "ne":
        shadow(c, 2, 16, 20, 4)
        c.rect(4, 9 + low, 16, 6 - low, BODY)
        c.hline(4, 19, 9 + low, BODY_HI)
        c.rect(3, 9 + low, 5, 4, BODY_DK)
        c.rect(12, 6 + low, 6, 3, SEAT_COL)
        if sport:
            c.rect(16, 5, 5, 2, BODY_DK)
        wheel_side(c, 17, 15, 3)
        wheel_side(c, 7, 16, 3)
        c.rect(9, 7 + low, 3, 2, METAL)
    elif d == "n":
        shadow(c, 4, 15, 16, 4)
        c.rect(7, 4 + low, 10, 12 - low, BODY)
        c.hline(7, 16, 4 + low, BODY_HI)
        c.rect(7, 4 + low, 10, 2, BODY_DK)  # 앞 범퍼 (위)
        c.rect(8, 13, 8, 2, SEAT_COL)  # 등받이 (아래)
        if sport:
            c.rect(5, 15, 14, 2, BODY_DK)
        wheel_top(c, 4, 5, 3, 5)
        wheel_top(c, 17, 5, 3, 5)
        wheel_top(c, 4, 13, 3, 5)
        wheel_top(c, 17, 13, 3, 5)
        c.hline(9, 14, 8, METAL)
    return c


# ── 낡은 인력거 ────────────────────────────────────────────────────────
def dented_wheel(c, cx, cy, r=3):
    """찌그러진 바퀴: 타원을 눌러 그리고 한쪽 테를 찌그러뜨린다."""
    c.ellipse(cx - r, cy - r + 1, 2 * r + 1, 2 * r - 1, TIRE)
    c.ellipse(cx - r + 1, cy - r + 2, 2 * r - 1, 2 * r - 3, TIRE_HI)
    c.px(cx + r - 1, cy - r + 1, TIRE)  # 찌그러진 귀퉁이
    c.px(cx + r, cy - 1, (0, 0, 0, 0))
    c.px(cx, cy, RIM)


def rickshaw(d):
    c = Canvas(FW, FH)
    if d == "e":
        shadow(c, 3, 16, 18, 3)
        c.rect(6, 8, 10, 7, BODY)  # 좌석 상자
        c.hline(6, 15, 8, BODY_HI)
        c.rect(5, 5, 3, 4, BODY_DK)  # 등받이
        c.hline(15, 22, 13, METAL)  # 손잡이 막대
        c.px(22, 12, METAL_HI)
        dented_wheel(c, 8, 15, 3)
        wheel_side(c, 14, 15, 3)
    elif d == "se":
        shadow(c, 3, 16, 18, 3)
        c.rect(6, 8, 10, 7, BODY)
        c.hline(6, 15, 8, BODY_HI)
        c.rect(5, 5, 3, 4, BODY_DK)
        c.hline(14, 20, 14, METAL)
        dented_wheel(c, 8, 15, 3)
        wheel_side(c, 14, 16, 3)
    elif d == "s":
        shadow(c, 6, 15, 12, 4)
        c.rect(8, 5, 8, 9, BODY)
        c.hline(8, 15, 5, BODY_HI)
        c.rect(8, 5, 8, 2, BODY_DK)
        c.vline(7, 12, 18, METAL)
        c.vline(16, 12, 18, METAL)
        wheel_top(c, 5, 7, 3, 5)
        wheel_top(c, 16, 8, 3, 4)  # 찌그러진 쪽은 낮게
        c.px(18, 8, (0, 0, 0, 0))
    elif d == "ne":
        shadow(c, 3, 16, 18, 3)
        c.rect(8, 8, 10, 7, BODY)
        c.hline(8, 17, 8, BODY_HI)
        c.rect(16, 5, 3, 4, BODY_DK)
        c.hline(4, 10, 14, METAL)
        wheel_side(c, 10, 16, 3)
        dented_wheel(c, 16, 15, 3)
    elif d == "n":
        shadow(c, 6, 15, 12, 4)
        c.rect(8, 6, 8, 9, BODY)
        c.hline(8, 15, 6, BODY_HI)
        c.rect(8, 13, 8, 2, BODY_DK)
        c.vline(7, 2, 8, METAL)
        c.vline(16, 2, 8, METAL)
        wheel_top(c, 5, 8, 3, 5)
        wheel_top(c, 16, 9, 3, 4)
        c.px(18, 9, (0, 0, 0, 0))
    return c


DRAW = {"bicycle": bicycle, "kickboard": kickboard, "kart": lambda d: kart(d, False), "sport": lambda d: kart(d, True), "rickshaw": rickshaw}

# 아바타 발 위치 (프레임 아래 가운데 기준, 논리 px) — 방향별. 반전 방향은 dx 부호를 뒤집는다
SEAT = {
    "bicycle": {"e": (-2, -8), "se": (-1, -8), "s": (0, -6), "ne": (2, -8), "n": (0, -7)},
    "kickboard": {"e": (1, -5), "se": (0, -5), "s": (0, -4), "ne": (-1, -5), "n": (0, -6)},
    "kart": {"e": (-3, -6), "se": (-2, -6), "s": (0, -5), "ne": (3, -6), "n": (0, -7)},
    "sport": {"e": (-3, -5), "se": (-2, -5), "s": (0, -4), "ne": (3, -5), "n": (0, -6)},
    "rickshaw": {"e": (-1, -7), "se": (-1, -7), "s": (0, -6), "ne": (1, -7), "n": (0, -6)},
}
# 데칼 중심 (프레임 좌상단 기준) — 몸체가 보이는 방향만
DECAL = {
    "bicycle": {"e": None, "se": None, "s": None, "ne": None, "n": None},
    "kickboard": {"e": (12, 14), "se": (12, 14), "s": (12, 12), "ne": (12, 14), "n": (12, 10)},
    "kart": {"e": (14, 12), "se": (13, 12), "s": (12, 10), "ne": (10, 12), "n": (12, 10)},
    "sport": {"e": (14, 13), "se": (13, 13), "s": (12, 10), "ne": (10, 13), "n": (12, 10)},
    "rickshaw": {"e": None, "se": None, "s": None, "ne": None, "n": None},
}


def decal(kind):
    c = Canvas(8, 8)
    if kind == "flame":
        pts = [(3, 7), (4, 7), (2, 6), (5, 6), (2, 5), (3, 5), (4, 5), (5, 5), (3, 4), (4, 4), (3, 3), (4, 2), (3, 1)]
        for x, y in pts:
            c.px(x, y, "#ff8a3d")
        for x, y in [(3, 6), (4, 6), (3, 5), (4, 4)]:
            c.px(x, y, "#ffd34a")
    elif kind == "star":
        pts = [(3, 0), (4, 0), (3, 1), (4, 1), (1, 2), (2, 2), (3, 2), (4, 2), (5, 2), (6, 2), (2, 3), (3, 3), (4, 3), (5, 3), (2, 4), (3, 4), (4, 4), (5, 4), (1, 5), (2, 5), (5, 5), (6, 5), (1, 6), (6, 6)]
        for x, y in pts:
            c.px(x, y, "#fff1b0")
        c.px(3, 3, "#ffffff")
        c.px(4, 3, "#ffffff")
    elif kind == "stripe":
        for y in range(8):
            c.px(2, y, "#f1ece2")
            c.px(3, y, "#f1ece2")
            c.px(5, y, "#f1ece2")
    return c


def colorize(img, variant):
    body, dk, hi = (hx(x) for x in {**COLORS, **RICKSHAW_COLORS}[variant])
    out = Image.new("RGBA", img.size)
    s, d = img.load(), out.load()
    for y in range(img.height):
        for x in range(img.width):
            p = s[x, y]
            d[x, y] = body if p == BODY else dk if p == BODY_DK else hi if p == BODY_HI else p
    return out


def main():
    frames = {}
    order = []
    for kind, fn in DRAW.items():
        base = {d: fn(d).im for d in DRAWN}
        for d in DIRS:
            src = base[d] if d in DRAWN else base[FLIP[d]].transpose(Image.FLIP_LEFT_RIGHT)
            for variant in (RICKSHAW_COLORS if kind == "rickshaw" else COLORS):
                key = f"{kind}|{variant}|{d}"
                frames[key] = colorize(src, variant).resize((FW * SCALE, FH * SCALE), Image.NEAREST)
                order.append(key)
    for k in ("flame", "star", "stripe"):
        key = f"decal/{k}"
        frames[key] = decal(k).im.resize((8 * SCALE, 8 * SCALE), Image.NEAREST)
        order.append(key)
    cols = 8
    cw, ch = FW * SCALE, FH * SCALE
    rows = (len(order) + cols - 1) // cols
    atlas = Image.new("RGBA", (cols * cw, rows * ch), (0, 0, 0, 0))
    meta_frames = {}
    for i, key in enumerate(order):
        im = frames[key]
        x, y = (i % cols) * cw, (i // cols) * ch
        atlas.alpha_composite(im, (x, y))
        meta_frames[key] = dict(frame=dict(x=x, y=y, w=im.width, h=im.height), rotated=False, trimmed=False, spriteSourceSize=dict(x=0, y=0, w=im.width, h=im.height), sourceSize=dict(w=im.width, h=im.height))
    os.makedirs(OUT, exist_ok=True)
    atlas.save(os.path.join(OUT, "vehicles.png"), optimize=True)
    seat = {}
    dec = {}
    for kind in DRAW:
        seat[kind] = {}
        dec[kind] = {}
        for d in DIRS:
            src = d if d in DRAWN else FLIP[d]
            sx, sy = SEAT[kind][src]
            seat[kind][d] = [(-sx if d in FLIP else sx) * SCALE, sy * SCALE]
            dc = DECAL[kind][src]
            dec[kind][d] = None if dc is None else [((FW - dc[0]) if d in FLIP else dc[0]) * SCALE, dc[1] * SCALE]
    meta = dict(app="tools/vehicles.py", image="vehicles.png", format="RGBA8888", size=dict(w=atlas.width, h=atlas.height), scale="1",
                frameWidth=cw, frameHeight=ch, dirs=DIRS, colors=list(COLORS), seat=seat, decal=dec)
    with open(os.path.join(OUT, "vehicles.json"), "w", encoding="utf-8") as f:
        json.dump(dict(frames=meta_frames, meta=meta), f, ensure_ascii=False, separators=(",", ":"))
    # 검수용 미리보기: 종류별 8방향 (빨강) + 데칼
    pv = Image.new("RGBA", (8 * cw * 2 + 16, 5 * ch * 2 + 16 + 40), (60, 58, 66, 255))
    for r, kind in enumerate(DRAW):
        for i, d in enumerate(DIRS):
            im = frames[f"{kind}|{'wood' if kind == 'rickshaw' else 'red'}|{d}"].resize((cw * 2, ch * 2), Image.NEAREST)
            pv.alpha_composite(im, (8 + i * cw * 2, 8 + r * ch * 2))
    for i, k in enumerate(("flame", "star", "stripe")):
        pv.alpha_composite(frames[f"decal/{k}"].resize((32, 32), Image.NEAREST), (8 + i * 40, 5 * ch * 2 + 12))
    os.makedirs(os.path.join(ROOT, "tools", "out"), exist_ok=True)
    pv.save(os.path.join(ROOT, "tools", "out", "vehicles_preview.png"))
    print("vehicles:", len(order), "frames", atlas.size)


if __name__ == "__main__":
    main()
