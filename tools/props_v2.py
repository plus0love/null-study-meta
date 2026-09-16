"""1단계 다듬기용 소품: 널빤지 바닥, 몰딩 벽, 패턴 러그, 큰 창문(3프레임), 확대 가구, 자잘한 소품.

글자는 그리지 않는다 — 보드/표지판 글자는 클라이언트에서 웹폰트(Gaegu/Pretendard) Phaser 텍스트로 올린다.
"""
import random

from props import (GLASS_FRAME, GLASS_FRAME_HI, INK, LEAF, LEAF_HI, LEAF_LT, METAL, POT, POT_HI, T, WALL, WOOD,
                   WOOD_DK, _SPINES, canvas, deco)
from props_room import (CUSHION, CUSHION_DK, CUSHION_HI, DARK_PANEL, MONITOR, PANEL_FRAME, SCREEN, SOFA, SOFA_DK,
                        SOFA_HI, dog)

# 3단계: 채도를 조금 낮추고 한 톤 깊은 따뜻한 갈색 (목업의 바닥 톤에 맞춤)
PLANK_TONES = [("#86624f", "#907059", "#725241"), ("#805d4b", "#8a6a55", "#6c4e3e"), ("#8b6752", "#957560", "#775644")]


# ── 바닥 / 벽 ─────────────────────────────────────────────────────────
def floor_plank(variant=0, seam=None):
    """가로 널빤지 마루. 타일 하나 = 널빤지 한 장(16px 높이), 결(가는 선) + 이음새(세로 선)."""
    base, hi, dk = PLANK_TONES[variant % 3]
    c = canvas(1, 1, base)
    c.hline(0, 15, 0, hi)
    c.hline(0, 15, 15, dk)
    c.hline(0, 15, 14, "#00000010")
    grain = {0: [(1, 5, 9), (8, 10, 14), (3, 12, 6)], 1: [(0, 4, 5), (7, 9, 15), (10, 12, 13)], 2: [(2, 6, 12), (0, 11, 4), (9, 3, 15)]}[variant % 3]
    for x0, y, x1 in grain:
        c.hline(x0, x1, y, dk + "60")
    if seam is not None:
        c.vline(seam, 0, 15, dk)
        c.vline(seam + 1, 1, 14, hi + "a0")
    return c


def floor_shadow(base_tile, side="N", depth=6):
    """벽 아래 그림자 한 줄: 기존 바닥 타일 위에 어두운 그라데이션."""
    c = canvas(1, 1)
    c.blit(base_tile, 0, 0)
    for i in range(depth):
        a = int(96 * (1 - i / depth))
        col = "#1a1016%02x" % a
        if side == "N":
            c.hline(0, 15, i, col)
        elif side == "W":
            c.vline(i, 0, 15, col)
        elif side == "E":
            c.vline(15 - i, 0, 15, col)
    return c


def wall_face_molding(row):
    """상단 벽면: row 0 은 어두운 몰딩 띠 + 하이라이트, row 1 은 걸레받이."""
    c = canvas(1, 1, WALL)
    for x in (3, 11):
        c.vline(x, 0, 15, "#36333c")
    if row == 0:
        c.rect(0, 0, 16, 4, "#242129")
        c.hline(0, 15, 4, "#4d4955")
        c.hline(0, 15, 5, "#3f3b46")
    else:
        c.rect(0, 13, 16, 3, "#57483f")
        c.hline(0, 15, 13, "#6d5a4e")
    return c


def wall_block(w, h=2):
    c = canvas(w, h)
    for i in range(w):
        c.blit(wall_face_molding(0), i * T, 0)
        for r in range(1, h):
            c.blit(wall_face_molding(1), i * T, r * T)
    return c


def rug_fancy(w, h, base="#e3d3b3", border="#b98f6a", border2="#d2b590", pattern="grid", accent="#cfbc99"):
    """테두리 두 겹 + 격자/도트/다이아 패턴 러그."""
    c = canvas(w, h)
    W, H = w * T, h * T
    c.rect(0, 0, W, H, base)
    c.frame(0, 0, W, H, border)
    c.frame(1, 1, W - 2, H - 2, border)
    c.frame(3, 3, W - 6, H - 6, border2)
    if pattern == "grid":
        for x in range(8, W - 6, 8):
            c.vline(x, 6, H - 7, accent)
        for y in range(8, H - 6, 8):
            c.hline(6, W - 7, y, accent)
        for x in range(8, W - 6, 8):
            for y in range(8, H - 6, 8):
                c.px(x, y, border2)
    elif pattern == "dots":
        for y in range(7, H - 6, 4):
            for x in range(7 + (y // 4 % 2) * 2, W - 6, 4):
                c.px(x, y, accent)
    elif pattern == "diamond":
        for y in range(8, H - 6, 6):
            for x in range(8 + (y // 6 % 2) * 3, W - 6, 6):
                c.px(x, y, accent)
                c.px(x - 1, y + 1, accent)
                c.px(x + 1, y + 1, accent)
                c.px(x, y + 2, accent)
    for y in range(3, H - 3, 3):
        c.px(0, y, border2)
        c.px(W - 1, y, border2)
    return c


# ── 창문: 5타일 높이, 3프레임 깜빡임, 줄 달린 펜던트 ────────────────────
_SKY5 = ["#141a30", "#171e38", "#1b2442", "#202b4d", "#263457", "#2d3e63", "#35496f", "#3f557c", "#4a6189", "#566d94"]


# 낮 건물 톤 (밝은 회청색) — 하늘은 타일에 굽지 않고 클라이언트가 시간대별 그라데이션으로 그린다 (public/js/daylight.js)
_DAY_LAYERS = [("#8fa3c2", "#7b8fae", "#66799a")]


def window_big(kind, lamp=False, frame=0, seed=0, day=False):
    """80px(5타일) 높이 창문. frame 0/1/2 는 창 불빛 깜빡임 프레임. day=True 면 낮 건물(밝음, 불빛 적음, 애니 없음).
    하늘 영역(y 0..71)은 투명 — 클라이언트가 room.windows 사각형에 하늘 그라데이션을 깔고 그 위에 이 타일을 올린다."""
    rnd = random.Random(seed)
    c = canvas(1, 5)
    H = 80
    sky_h = 72
    layers = [("#2a355a", 16, 30, 0.0), ("#1a213d", 24, 42, 0.25), ("#0e1226", 10, 34, 0.4)]
    if day:
        layers = [(_DAY_LAYERS[0][i], hmin, hmax, litp) for i, (_c, hmin, hmax, litp) in enumerate(layers)]
    base = 71
    lit = {0: [], 1: [], 2: []}
    for col, hmin, hmax, litp in layers:
        x = rnd.randint(-2, 0)
        while x < 16:
            w = rnd.choice([2, 3, 3, 4, 5])
            h = rnd.randint(hmin, hmax)
            c.rect(max(0, x), base - h, w, h, col)
            c.hline(max(0, x), min(15, x + w - 1), base - h, "#ffffff10" if not day else "#ffffff40")
            if litp:
                for yy in range(base - h + 2, base - 1, 2):
                    for xx in range(x, x + w, 2):
                        if 0 <= xx < 16 and rnd.random() < litp:
                            lit[rnd.choice([0, 0, 1, 2])].append((xx, yy))
            x += w
    if day:
        # 낮: 창은 어두운 유리, 불 켜진 창은 드물게
        for k in (0, 1, 2):
            for lx, ly in lit[k]:
                c.px(lx, ly, "#56698a")
        for i, (lx, ly) in enumerate(lit[0]):
            if (lx * 7 + ly * 3) % 11 == 0:
                c.px(lx, ly, "#f4e2b0")
    else:
        for lx, ly in lit[0]:
            if (lx * 7 + ly * 3 + frame) % 9 != 0:
                c.px(lx, ly, "#f4d98c")
        for lx, ly in lit[(frame % 2) + 1]:
            c.px(lx, ly, rnd.choice(["#ffe7a8", "#f7c56f"]))
    # 창틀
    c.rect(0, 0, 16, 3, GLASS_FRAME)
    c.vline(0, 0, sky_h - 1, GLASS_FRAME_HI)
    c.hline(0, 15, 26, GLASS_FRAME)
    c.hline(0, 15, 50, GLASS_FRAME)
    c.rect(0, sky_h, 16, 8, "#4a3b33")
    c.hline(0, 15, sky_h, "#6a5749")
    c.hline(0, 15, H - 1, "#2f2620")
    if kind == "l":
        c.rect(0, 0, 3, sky_h, GLASS_FRAME)
    if kind == "r":
        c.rect(13, 0, 3, sky_h, GLASS_FRAME)
    for i in range(5):
        c.px(4 + i, 7 + i, "#ffffff20")
        c.px(9 + i, 33 + i, "#ffffff18")
    if lamp:
        c.rect(6, 3, 4, 2, "#1f1d23")
        c.vline(8, 5, 20, "#15131a")
        c.px(8, 12, "#2a2830")
        c.rect(5, 21, 7, 2, "#2f2c35")
        c.rect(4, 23, 9, 3, "#3a3741")
        c.rect(3, 26, 11, 1, "#2f2c35")
        c.rect(6, 27, 5, 3, "#ffe9b0")
        c.rect(7, 30, 3, 1, "#ffd98a")
        for i in range(4):
            c.hline(4 - i, 12 + i, 31 + i, "#ffd48a%02x" % (56 - i * 12))
    return c


# ── 라운지 ────────────────────────────────────────────────────────────
def sofa_wide(w=6, h=2):
    c = canvas(w, h)
    W, H = w * T, h * T
    c.rect(2, 4, W - 4, 10, SOFA_DK)
    c.rect(2, 3, W - 4, 9, SOFA)
    c.hline(3, W - 4, 3, SOFA_HI)
    for ax in (0, W - 9):
        c.rect(ax, 8, 9, H - 12, SOFA_DK)
        c.rect(ax + 1, 7, 7, H - 12, SOFA)
        c.hline(ax + 2, ax + 6, 7, SOFA_HI)
    seat_w = (W - 20) // 3
    for i in range(3):
        sx = 10 + i * seat_w
        c.rect(sx, 13, seat_w - 1, H - 18, SOFA)
        c.frame(sx, 13, seat_w - 1, H - 18, SOFA_DK)
        c.hline(sx + 1, sx + seat_w - 3, 14, SOFA_HI)
    cush = [(CUSHION_DK, CUSHION, CUSHION_HI), ("#cdb48c", "#f0e2c6", "#faf1dc"), ("#cdb48c", "#f0e2c6", "#faf1dc"), (CUSHION_DK, CUSHION, CUSHION_HI)]
    gap = (W - 20 - 4 * 13) // 3
    for i, (dk, mid, hi) in enumerate(cush):
        cx = 10 + i * (13 + gap)
        c.rect(cx, 5, 13, 11, dk)
        c.rect(cx + 1, 4, 11, 11, mid)
        c.rect(cx + 3, 6, 5, 3, hi)
        c.px(cx + 6, 9, dk)
    c.rect(2, H - 4, W - 4, 2, "#00000030")
    return c


def round_table(w=4, h=2):
    c = canvas(w, h)
    W, H = w * T, h * T
    c.ellipse(1, 6, W - 2, H - 7, "#2f2016")
    c.ellipse(1, 3, W - 2, H - 7, "#5a4232")
    c.ellipse(4, 5, W - 8, H - 12, "#6b5040")
    c.ellipse(8, 6, W - 16, H - 15, "#7c5f4c")
    deco(c, "plant", 16, 6)
    c.rect(34, 10, 9, 6, "#5b7fb0")
    c.rect(35, 11, 7, 4, "#7fa4c4")
    c.px(36, 12, "#e8eef7")
    deco(c, "cup", 27, 14)
    return c


def sprite_png(name):
    """tools/sprites/ 의 16px 논리 해상도 PNG 를 Canvas 로 읽는다 (손으로 그린 소품 보관용)."""
    import os
    from PIL import Image
    from pixel import Canvas
    path = os.path.join(os.path.dirname(os.path.abspath(__file__)), "sprites", name)
    im = Image.open(path).convert("RGBA")
    c = Canvas(im.width, im.height)
    c.paste(im, 0, 0)
    return c


def dog_cushion():
    """예전 1x1 강아지 (미사용). 현재는 tools/sprites/poodle_cushion.png 의 푸들을 쓴다."""
    c = canvas(1, 1)
    c.ellipse(0, 6, 16, 10, "#8a6a4c")
    c.ellipse(0, 5, 16, 10, "#b39274")
    c.ellipse(2, 6, 12, 7, "#c4a78a")
    c.blit(dog(), 1, -1)
    return c


# ── 검정 등받이 의자 ──────────────────────────────────────────────────
def chair_black(facing):
    c = canvas(1, 1)
    seat, back, hi, leg = "#2e2b33", "#1d1b22", "#4a4652", "#15131a"
    if facing == "n":
        c.rect(3, 3, 10, 7, seat)
        c.rect(2, 9, 12, 5, back)
        c.hline(3, 12, 9, hi)
        c.rect(3, 14, 2, 1, leg)
        c.rect(11, 14, 2, 1, leg)
    elif facing == "s":
        c.rect(2, 1, 12, 5, back)
        c.hline(3, 12, 1, hi)
        c.rect(3, 6, 10, 7, seat)
        c.rect(4, 7, 8, 1, hi)
        c.rect(3, 13, 2, 1, leg)
        c.rect(11, 13, 2, 1, leg)
    elif facing == "e":
        c.rect(1, 2, 5, 12, back)
        c.vline(1, 3, 12, hi)
        c.rect(6, 3, 8, 10, seat)
        c.rect(7, 4, 1, 8, hi)
        c.rect(12, 13, 1, 1, leg)
    else:
        c.rect(10, 2, 5, 12, back)
        c.vline(14, 3, 12, hi)
        c.rect(2, 3, 8, 10, seat)
        c.rect(8, 4, 1, 8, hi)
        c.rect(3, 13, 1, 1, leg)
    return c


# ── 스터디룸 책상 (3x1 본체 + 1x1 리턴) ──────────────────────────────
def desk_wide(w=3):
    c = canvas(w, 1)
    W = w * T
    c.rect(0, 1, W, 12, "#efe6d6")
    c.hline(0, W - 1, 1, "#f8f2e6")
    c.rect(0, 13, W, 3, "#5a5660")
    c.hline(0, W - 1, 0, "#b9b6b3")
    mx = W // 2 - 9
    c.rect(mx, 1, 18, 9, MONITOR)
    c.rect(mx + 1, 2, 16, 7, SCREEN)
    c.rect(mx + 2, 3, 7, 1, "#b5dcd3")
    c.rect(mx + 2, 5, 10, 1, "#a9d3c9")
    c.rect(mx + 8, 10, 2, 2, MONITOR)
    c.rect(mx + 5, 12, 8, 1, MONITOR)
    c.rect(mx + 3, 13, 12, 1, "#b9b6b3")
    c.rect(mx + 17, 12, 2, 2, "#b9b6b3")
    deco(c, "lamp", 3, 2)
    deco(c, "cup", W - 7, 7)
    deco(c, "books", W - 14, 2)
    deco(c, "paper", 11, 7)
    return c


def desk_return():
    c = canvas(1, 1)
    c.rect(0, 0, 16, 12, "#efe6d6")
    c.hline(0, 15, 0, "#f8f2e6")
    c.rect(0, 12, 16, 3, "#5a5660")
    deco(c, "plant", 2, 2)
    c.rect(9, 3, 6, 6, "#e9e4dc")
    c.rect(10, 5, 4, 1, "#5a5660")
    return c


# ── 큰 푸프 (2x2) ────────────────────────────────────────────────────
def pouf_big(color, dark, hi):
    c = canvas(2, 2)
    c.ellipse(2, 6, 28, 24, dark)
    c.ellipse(2, 3, 28, 24, color)
    c.ellipse(7, 7, 12, 6, hi)
    c.hline(6, 25, 16, dark)
    c.vline(16, 6, 26, dark)
    c.ellipse(11, 11, 10, 7, color)
    c.ellipse(13, 12, 5, 3, hi)
    return c


# ── 자잘한 소품 ───────────────────────────────────────────────────────
def cup_shelf():
    c = canvas(2, 1)
    c.rect(0, 9, 32, 3, WOOD_DK)
    c.hline(0, 31, 9, WOOD)
    c.rect(0, 2, 32, 3, WOOD_DK)
    c.hline(0, 31, 2, WOOD)
    for i in range(5):
        x = 2 + i * 6
        c.rect(x, 5, 3, 4, "#f2ece2")
        c.px(x + 3, 6, "#f2ece2")
        c.px(x + 1, 5, "#c9c4bb")
    for i in range(4):
        x = 3 + i * 7
        col = ["#c99175", "#8fa585", "#e0c67b", "#a08bc4"][i]
        c.rect(x, 12, 3, 4, col)
        c.hline(x, x + 2, 12, "#5a5660")
    return c


def counter_dense(kind=0):
    c = canvas(1, 1)
    c.rect(0, 2, 16, 11, "#e2d8c8")
    c.hline(0, 15, 2, "#efe8db")
    c.rect(0, 13, 16, 3, "#8a6f58")
    c.hline(0, 15, 13, "#a3866a")
    if kind == 0:
        deco(c, "cup", 2, 4)
        deco(c, "cup", 7, 5)
        deco(c, "cup", 11, 3)
        c.rect(3, 9, 8, 2, "#c9c4bb")
    elif kind == 1:
        for i, col in enumerate(["#c99175", "#8fa585", "#e0c67b"]):
            c.rect(2 + i * 4, 4, 3, 6, col)
            c.hline(2 + i * 4, 4 + i * 4, 4, "#5a5660")
        c.rect(2, 11, 11, 1, "#b9b6b3")
    else:
        c.rect(4, 3, 8, 8, "#3d3a44")
        c.rect(6, 1, 4, 3, "#55515c")
        c.rect(5, 8, 6, 2, METAL)
        c.px(11, 5, "#e35d5d")
        deco(c, "cup", 12, 8)
    return c


def wall_clock():
    c = canvas(1, 2)
    c.blit(wall_block(1, 2), 0, 0)
    c.ellipse(3, 6, 10, 10, "#f2ece2")
    c.ellipse(4, 7, 8, 8, "#faf6ef")
    c.frame(3, 6, 10, 10, INK)
    c.px(8, 7, INK)
    c.px(8, 14, INK)
    c.px(4, 10, INK)
    c.px(11, 10, INK)
    c.vline(8, 8, 10, INK)
    c.hline(8, 10, 10, "#c96f6f")
    return c


def wall_frames(kind=0):
    """벽면 액자 1~2개 (wall 배경 포함 1x2)."""
    c = canvas(1, 2)
    c.blit(wall_block(1, 2), 0, 0)
    if kind == 0:
        c.rect(2, 7, 12, 10, "#a08466")
        c.rect(4, 9, 8, 6, "#d9c2a0")
        c.rect(5, 11, 6, 3, "#8fa585")
    else:
        c.rect(1, 7, 6, 8, "#6b4c36")
        c.rect(2, 8, 4, 6, "#e6d9bf")
        c.rect(9, 9, 6, 6, "#6b4c36")
        c.rect(10, 10, 4, 4, "#d9977a")
    return c


def coat_rack():
    c = canvas(1, 2)
    c.rect(7, 2, 2, 26, "#4a3327")
    c.rect(4, 28, 8, 3, "#3f2d22")
    c.hline(3, 12, 2, "#4a3327")
    for x in (3, 12):
        c.vline(x, 2, 5, "#4a3327")
    c.rect(1, 5, 6, 9, "#6f8a9a")
    c.rect(2, 6, 4, 8, "#7f9aaa")
    c.rect(10, 5, 5, 7, "#c96f6f")
    c.rect(11, 6, 3, 5, "#d98383")
    return c


def trash_bin():
    c = canvas(1, 1)
    c.rect(4, 4, 8, 11, "#5a5660")
    c.rect(4, 4, 8, 2, "#7e7974")
    c.rect(3, 3, 10, 2, "#8a8c94")
    c.rect(6, 6, 1, 8, "#6e6a75")
    c.rect(7, 2, 2, 1, "#f2ece2")
    return c


def water_dispenser():
    c = canvas(1, 2)
    c.rect(4, 12, 8, 18, "#e9e4dc")
    c.rect(4, 12, 8, 2, "#d3cec6")
    c.rect(5, 16, 6, 4, INK)
    c.px(6, 17, "#5fb0e0")
    c.px(9, 17, "#e35d5d")
    c.rect(5, 22, 6, 6, "#d3cec6")
    c.rect(3, 30, 10, 1, "#a19b95")
    c.ellipse(4, 1, 8, 12, "#7fb8e0")
    c.ellipse(5, 2, 6, 10, "#a9d3f0")
    c.rect(6, 3, 1, 6, "#d6ecfa")
    return c


def plant_bush(seed=0):
    rnd = random.Random(seed)
    c = canvas(1, 1)
    c.rect(5, 11, 6, 4, POT)
    c.hline(5, 10, 11, POT_HI)
    c.ellipse(2, 2, 12, 10, LEAF)
    c.ellipse(4, 1, 8, 6, LEAF_LT)
    for _ in range(5):
        c.px(rnd.randint(3, 12), rnd.randint(2, 9), LEAF_HI)
    for _ in range(3):
        c.px(rnd.randint(3, 12), rnd.randint(3, 10), "#3f5f3d")
    return c


def plant_palm(seed=0):
    rnd = random.Random(seed)
    c = canvas(1, 2)
    c.rect(4, 25, 8, 6, "#6b5040")
    c.rect(3, 24, 10, 2, "#7c5f4c")
    c.hline(4, 11, 30, "#4a3327")
    c.vline(7, 10, 24, "#7a6a3c")
    c.vline(8, 12, 24, "#8f7c46")
    fronds = [(7, 10, -1, -1), (8, 10, 1, -1), (7, 12, -1, 0), (8, 12, 1, 0), (7, 9, 0, -1), (8, 14, 1, 1), (7, 14, -1, 1)]
    for sx, sy, dx, dy in fronds:
        x, y = sx, sy
        for k in range(6):
            col = LEAF_LT if k < 3 else LEAF
            c.px(x, y, col)
            if k % 2 == 0:
                c.px(x, y + 1, "#3f5f3d")
            x += dx
            if k % 2:
                y += dy
    for _ in range(6):
        c.px(rnd.randint(2, 13), rnd.randint(4, 16), LEAF_HI)
    return c


def wall_vine():
    c = canvas(1, 2)
    c.rect(4, 0, 8, 3, "#5e4331")
    for x, ln in ((2, 14), (5, 22), (8, 18), (11, 26), (14, 12)):
        c.vline(x, 3, 3 + ln, LEAF)
        for k in range(0, ln, 3):
            c.px(x - 1 + (k % 2) * 2, 4 + k, LEAF_LT)
            if k % 6 == 0:
                c.px(x + 1 - (k % 4) // 2, 5 + k, LEAF_HI)
    return c


# ── 글자 없는 보드/표지판 (글자는 클라이언트 웹폰트) ────────────────────
def chalkboard_blank(w=7, h=6):
    c = canvas(w, h)
    c.blit(wall_block(w, 2), 0, 0)
    W, H = w * T, h * T
    c.rect(2, 0, W - 4, H - 2, "#3a3438")
    c.rect(4, 2, W - 8, H - 6, "#2e2a30")
    c.frame(4, 2, W - 8, H - 6, "#4a4448")
    for i in range(7):
        c.px(6 + i * 13, H - 7, "#ffffff10")
    c.rect(W // 2 - 6, 0, 12, 2, "#4a4752")
    c.rect(W // 2 - 4, 2, 8, 1, "#ffe6b3")
    for i in range(5):
        c.hline(W // 2 - 10 - i * 4, W // 2 + 10 + i * 4, 3 + i, "#ffd48a%02x" % (44 - i * 8))
    return c


def board_tall_blank(w=4, h=6):
    c = canvas(w, h)
    c.blit(wall_block(w, 2), 0, 0)
    W, H = w * T, h * T
    c.rect(1, 0, W - 2, H - 2, "#2b282f")
    c.rect(2, 1, W - 4, H - 4, DARK_PANEL)
    c.frame(2, 1, W - 4, H - 4, PANEL_FRAME)
    c.hline(W // 2 - 8, W // 2 + 8, H - 14, "#ffb85c")
    return c


def music_panel_blank(w=4, h=8):
    c = canvas(w, h)
    c.blit(wall_block(w, 2), 0, 0)
    W, H = w * T, h * T
    c.rect(1, 0, W - 2, H - 2, "#2b282f")
    c.rect(2, 1, W - 4, H - 4, "#1f1c24")
    c.frame(2, 1, W - 4, H - 4, PANEL_FRAME)
    for i in range(0, H - 8, 2):
        c.px(4 + (i // 2) % (W - 10), 3 + i, "#ffffff14")
    for i in range(8):
        c.px(W - 8 + i // 2, 4 + i, "#ffffff22")
    for i in range(6):
        c.hline(W // 2 - 4 - i * 2, W // 2 + 4 + i * 2, 2 + i, "#ffd48a%02x" % (46 - i * 7))
    hx, hy = W // 2, H // 2 + 22
    c.hline(hx - 6, hx + 6, hy, "#efe6d6")
    c.px(hx - 7, hy + 1, "#efe6d6")
    c.px(hx + 7, hy + 1, "#efe6d6")
    c.rect(hx - 8, hy + 2, 3, 5, "#efe6d6")
    c.rect(hx + 6, hy + 2, 3, 5, "#efe6d6")
    return c


def menu_board_blank(w=5, h=3):
    c = canvas(w, h)
    W, H = w * T, h * T
    c.rect(1, 1, W - 2, H - 2, "#3d3944")
    c.rect(3, 3, W - 6, H - 6, "#ece2d2")
    cx, cy = W - 18, H - 15
    c.rect(cx, cy + 2, 8, 6, INK)
    c.rect(cx + 8, cy + 3, 2, 3, INK)
    c.rect(cx + 1, cy + 3, 6, 4, "#ece2d2")
    c.px(cx + 2, cy, INK)
    c.px(cx + 5, cy, INK)
    c.rect(4, H - 2, 2, 2, "#3d3944")
    c.rect(W - 6, H - 2, 2, 2, "#3d3944")
    return c


def study_panel_blank(w=3, h=4, light_side="r"):
    c = canvas(w, h)
    W, H = w * T, h * T
    c.rect(0, 0, W, H, "#2b282f")
    c.rect(1, 1, W - 2, H - 2, DARK_PANEL)
    c.frame(1, 1, W - 2, H - 2, PANEL_FRAME)
    c.rect(4, 8, W - 8, 14, "#1c1a21")
    c.frame(4, 8, W - 8, 14, "#3d3944")
    lx = W - 3 if light_side == "r" else 2
    c.vline(lx, H // 2, H - 6, "#ffb85c")
    c.vline(lx + (-1 if light_side == "r" else 1), H // 2 + 2, H - 8, "#7a4f2c")
    return c


def whiteboard_blank(w=5, h=3):
    c = canvas(w, h)
    W, H = w * T, h * T
    c.rect(0, 0, W, H - 3, "#8d8a90")
    c.rect(2, 2, W - 4, H - 7, "#f1e9da")
    c.hline(2, W - 3, H - 5, "#b9b6b3")
    for i, col in enumerate(("#f7d774", "#f4a9b8", "#9fd0c1", "#f7d774")):
        c.rect(5 + (i % 2) * 6, 6 + (i // 2) * 7, 5, 5, col)
    c.rect(W - 10, 20, 5, 5, "#9fd0c1")
    c.rect(W - 16, 8, 5, 5, "#f4a9b8")
    c.rect(4, H - 3, 3, 3, "#6b686f")
    c.rect(W - 7, H - 3, 3, 3, "#6b686f")
    return c


def doormat_blank(w=7, h=3):
    c = canvas(w, h)
    W, H = w * T, h * T
    c.rect(1, 1, W - 2, H - 2, "#6b4a3a")
    c.frame(1, 1, W - 2, H - 2, "#a08466")
    c.frame(3, 3, W - 6, H - 6, "#8a6d50")
    return c


def sign_outdoor_blank(w=3, h=5):
    c = canvas(w, h)
    W, H = w * T, h * T
    c.rect(1, 0, W - 2, H - 2, "#2b282f")
    c.rect(3, 2, W - 6, H - 6, DARK_PANEL)
    c.frame(3, 2, W - 6, H - 6, PANEL_FRAME)
    c.rect(0, H - 2, W, 2, "#4b4953")
    return c
