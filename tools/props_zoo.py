"""14단계 B 동물원 타일 (16px 논리, 오리지널).

  울타리: 낮은 나무 펜스(가로·세로·모서리 4) · 유리 펜스(가로·세로) · 문 기둥
  바닥: 모래 2종 · 얼음 2종 · 우리 안 물(2프레임, 동물만 지나감) · 포토존 발자국 표시
  소품: 대나무(1x2) · 아카시아(2x4) · 건초 · 여물통 · 통나무 · 눈더미 · 밧줄 기둥/밧줄 · 놀이 단 · 안내판 · 'ZOO' 아치 배너 · 매점(3x2) · 포토존 보드(3x1)
"""
import random

from pixel import Canvas
from props import LEAF, LEAF_HI, LEAF_LT, T, WOOD, WOOD_DK, WOOD_HI, canvas
from props_outdoor import GRASS, PANEL, PANEL_FRAME, PANEL_LED, POST, POST_HI, ROCK, ROCK_DK, ROCK_HI, WATER, WATER_DK, WATER_FOAM, WATER_HI
from props_outdoor2 import AWNING, AWNING_DK, AWNING_LT, WHITE

FENCE = "#a8825f"
FENCE_DK = "#7c5a44"
FENCE_HI = "#c9a37e"
GLASS = "#c9e6f2"
GLASS_DK = "#8fb3c2"
SAND = "#d9c49a"
SAND_DK = "#c7b088"
SAND_HI = "#e6d4b0"
ICE = "#dff0f7"
ICE_DK = "#b9d6e6"
ICE_HI = "#ffffff"


# ── 울타리 ─────────────────────────────────────────────────────────────
def _post(c, x=6, y=1, w=4, h=15):
    """굵은 기둥 (갓 있음)."""
    c.rect(x, y, w, h, FENCE_DK)
    c.rect(x + 1, y, w - 2, h - 1, FENCE)
    c.px(x + 1, y + 1, FENCE_HI)
    c.rect(x - 1, y, w + 2, 2, FENCE_DK)
    c.hline(x - 1, x + w, y, FENCE_HI)


def _rails_h(c, x0=0, x1=15):
    """두꺼운 가로대 2줄 (3px)."""
    for y in (5, 10):
        c.rect(x0, y, x1 - x0 + 1, 3, FENCE)
        c.hline(x0, x1, y, FENCE_HI)
        c.hline(x0, x1, y + 2, FENCE_DK)


def _rails_v(c, y0=0, y1=15):
    """두꺼운 세로대 2줄 (3px)."""
    for x in (4, 9):
        c.rect(x, y0, 3, y1 - y0 + 1, FENCE)
        c.vline(x, y0, y1, FENCE_HI)
        c.vline(x + 2, y0, y1, FENCE_DK)


def fence_h():
    """두꺼운 나무 울타리(가로): 가로대 2줄 + 가운데 기둥."""
    c = canvas(1, 1)
    _rails_h(c)
    _post(c)
    c.hline(4, 11, 15, "#00000040")
    return c


def fence_v():
    """두꺼운 나무 울타리(세로): 세로대 2줄 + 가로 버팀."""
    c = canvas(1, 1)
    _rails_v(c)
    c.rect(3, 6, 10, 4, FENCE_DK)
    c.rect(4, 6, 8, 3, FENCE)
    c.hline(4, 11, 6, FENCE_HI)
    return c


def fence_corner(kind):
    """모서리: nw/ne/sw/se — 굵은 기둥 하나 + 두 방향 가로대."""
    c = canvas(1, 1)
    if kind in ("nw", "ne"):
        _rails_v(c, 8, 15)
    else:
        _rails_v(c, 0, 8)
    if kind in ("nw", "sw"):
        _rails_h(c, 8, 15)
    else:
        _rails_h(c, 0, 8)
    _post(c, 5, 1, 6, 15)
    c.hline(3, 12, 15, "#00000040")
    return c


def glass_fence_h():
    c = canvas(1, 1)
    c.rect(0, 4, 16, 10, GLASS + "a0")
    c.hline(0, 15, 4, GLASS_DK)
    c.rect(0, 13, 16, 3, "#6b686f")
    c.hline(0, 15, 13, "#8a838e")
    for i in range(4):
        c.px(3 + i, 6 + i, "#ffffff90")
    return c


def glass_fence_v():
    c = canvas(1, 1)
    c.rect(4, 0, 9, 16, GLASS + "a0")
    c.vline(4, 0, 15, GLASS_DK)
    c.rect(12, 0, 3, 16, "#6b686f")
    c.vline(12, 0, 15, "#8a838e")
    for i in range(4):
        c.px(6 + i, 3 + i, "#ffffff90")
    return c


def gate_post():
    """문 기둥: 울타리 기둥보다 굵고 높다 (출입구 양쪽)."""
    c = canvas(1, 1)
    c.rect(4, 0, 8, 16, FENCE_DK)
    c.rect(5, 0, 6, 15, FENCE)
    c.rect(6, 1, 2, 12, FENCE_HI)
    c.rect(3, 0, 10, 2, FENCE_DK)
    c.hline(3, 12, 0, FENCE_HI)
    c.rect(3, 14, 10, 2, FENCE_DK)
    return c


# ── 바닥 ───────────────────────────────────────────────────────────────
def sand(variant=0):
    rnd = random.Random(variant + 1200)
    c = canvas(1, 1, SAND)
    for _ in range(8):
        c.px(rnd.randint(0, 15), rnd.randint(0, 15), rnd.choice([SAND_DK, SAND_HI]))
    if variant:
        c.hline(3, 7, 9, SAND_DK)
    return c


def ice(variant=0):
    rnd = random.Random(variant + 1300)
    c = canvas(1, 1, ICE)
    for _ in range(4):
        x, y = rnd.randint(0, 12), rnd.randint(0, 15)
        c.hline(x, x + 3, y, ICE_HI)
    for _ in range(2):
        x, y = rnd.randint(0, 12), rnd.randint(0, 15)
        c.hline(x, x + 2, y, ICE_DK)
    if variant:
        c.px(4, 4, ICE_DK)
        c.px(5, 5, ICE_DK)
        c.px(6, 6, ICE_DK)
    return c


def pool(frame=0):
    """우리 안 물 (동물만 지나감, 통과 가능 바닥)."""
    c = canvas(1, 1, "#7fb0d0")
    rnd = random.Random(31 + frame)
    for _ in range(3):
        x, y = rnd.randint(0, 12), rnd.randint(0, 15)
        c.hline(x, x + 3, y, "#a9d0e6")
    c.px(4 + frame * 5, 3 + frame * 3, WATER_FOAM)
    c.px(12 - frame * 4, 11 - frame * 2, WATER_FOAM)
    return c


def pool_edge(sides):
    """우리 안 물가: sides 쪽이 바닥(모래/잔디). 모래 띠."""
    c = pool(0)
    band = 4
    if "N" in sides:
        c.rect(0, 0, 16, band, SAND)
        c.hline(0, 15, band, SAND_DK)
    if "S" in sides:
        c.rect(0, 16 - band, 16, band, SAND)
        c.hline(0, 15, 15 - band, SAND_DK)
    if "W" in sides:
        c.rect(0, 0, band, 16, SAND)
        c.vline(band, 0, 15, SAND_DK)
    if "E" in sides:
        c.rect(16 - band, 0, band, 16, SAND)
        c.vline(15 - band, 0, 15, SAND_DK)
    return c


def photo_mark():
    """포토존 발자국 표시 (바닥, 통과 가능)."""
    from props_outdoor import plaza
    c = plaza(0)
    for fx in (3, 9):
        c.ellipse(fx, 4, 4, 7, "#f1e6d2")
        c.ellipse(fx, 2, 4, 3, "#f1e6d2")
    return c


# ── 소품 ───────────────────────────────────────────────────────────────
def bamboo():
    c = canvas(1, 2)
    for x, h in ((3, 30), (8, 26), (12, 31)):
        c.rect(x, 32 - h, 2, h, "#6fa04a")
        for y in range(32 - h + 4, 32, 6):
            c.hline(x, x + 1, y, "#4e7a33")
        c.px(x + 2, 32 - h + 2, "#8fbf62")
        c.px(x - 1, 32 - h + 6, "#8fbf62")
        c.rect(x + 2, 32 - h + 8, 3, 1, "#8fbf62")
    return c


def acacia():
    """키 큰 아카시아 2x4 (위 3줄 top): 넓적한 우산 모양 잎 + 긴 줄기."""
    c = canvas(2, 4)
    c.ellipse(0, 4, 32, 12, "#4d6f3d")
    c.ellipse(1, 2, 30, 11, "#7a9a5e")
    c.ellipse(5, 3, 20, 6, "#93b374")
    c.rect(14, 14, 4, 48, WOOD_DK)
    c.rect(15, 14, 2, 47, WOOD)
    c.rect(11, 20, 4, 2, WOOD_DK)
    c.rect(17, 26, 4, 2, WOOD_DK)
    c.ellipse(9, 58, 14, 5, "#4f6b45")
    return c


def hay():
    c = canvas(1, 1)
    c.ellipse(1, 5, 14, 10, "#c9a35a")
    c.ellipse(3, 3, 10, 7, "#e2c47a")
    for x, y in ((3, 7), (7, 5), (11, 8), (5, 11), (9, 12)):
        c.px(x, y, "#a37a48")
    return c


def trough():
    c = canvas(2, 1)
    c.rect(1, 5, 30, 9, WOOD_DK)
    c.rect(2, 6, 28, 7, WOOD)
    c.rect(3, 7, 26, 3, "#e2c47a")
    c.rect(2, 14, 3, 2, WOOD_DK)
    c.rect(27, 14, 3, 2, WOOD_DK)
    return c


def log():
    c = canvas(2, 1)
    c.ellipse(1, 4, 30, 9, WOOD_DK)
    c.ellipse(1, 3, 30, 8, WOOD)
    c.ellipse(24, 4, 7, 6, WOOD_HI)
    c.ellipse(26, 5, 3, 3, WOOD_DK)
    c.hline(4, 20, 6, WOOD_DK)
    return c


def snow_mound():
    c = canvas(1, 1)
    c.ellipse(1, 6, 14, 9, ICE_DK)
    c.ellipse(1, 4, 14, 9, ICE_HI)
    c.px(4, 6, ICE)
    return c


def rope_post():
    c = canvas(1, 2)
    c.rect(6, 2, 4, 28, WOOD_DK)
    c.rect(7, 2, 2, 27, WOOD)
    c.rect(4, 0, 8, 3, WOOD_DK)
    c.rect(5, 29, 6, 3, "#1f1d23")
    return c


def rope():
    c = canvas(1, 1)
    for x in range(16):
        y = 1 + ((x - 8) * (x - 8)) // 24
        c.px(x, y, "#c9a35a")
        c.px(x, y + 1, "#a37a48")
    return c


def platform():
    c = canvas(2, 1)
    c.rect(1, 4, 30, 6, WOOD)
    c.hline(1, 30, 4, WOOD_HI)
    c.hline(1, 30, 9, WOOD_DK)
    c.rect(3, 10, 3, 6, WOOD_DK)
    c.rect(26, 10, 3, 6, WOOD_DK)
    return c


def zoo_sign():
    c = canvas(1, 1)
    c.rect(7, 9, 2, 7, POST)
    c.rect(2, 1, 12, 9, "#f4e3c6")
    c.frame(2, 1, 12, 9, WOOD_DK)
    c.hline(4, 11, 4, "#8a6a4e")
    c.hline(4, 9, 6, "#8a6a4e")
    return c


def zoo_banner(w=5):
    """'ZOO' 아치 배너 (top, 5x1)."""
    c = canvas(w, 1)
    W = w * T
    c.rect(1, 3, W - 2, 10, WOOD)
    c.hline(1, W - 2, 3, WOOD_HI)
    c.hline(1, W - 2, 12, WOOD_DK)
    c.frame(1, 3, W - 2, 10, WOOD_DK)
    c.text_center(W // 2, 5, "ZOO", "#fff0cc", scale=1)
    # 발자국 장식 양쪽
    for fx in (8, W - 14):
        c.ellipse(fx, 6, 4, 4, "#fff0cc")
        c.px(fx + 1, 5, "#fff0cc")
        c.px(fx + 3, 5, "#fff0cc")
    c.rect(1, 13, 3, 3, POST)
    c.rect(W - 4, 13, 3, 3, POST)
    return c


def snack_bar():
    """매점 3x2 (위 줄 차양 top): 카운터 + 아이스크림·츄러스 그림 + 메뉴판."""
    c = canvas(3, 2)
    W = 3 * T
    c.rect(0, 3, W, 9, AWNING)
    for x in range(0, W, 8):
        c.rect(x, 3, 4, 9, AWNING_LT)
    c.hline(0, W - 1, 3, "#f6d3ba")
    for x in range(0, W, 4):
        c.rect(x, 12, 4, 2, AWNING_DK if (x // 4) % 2 else AWNING)
    c.rect(2, 16, W - 4, 14, WOOD)
    c.hline(2, W - 3, 16, WOOD_HI)
    c.rect(2, 22, W - 4, 2, WOOD_DK)
    c.rect(4, 24, W - 8, 5, WOOD_DK)
    # 아이스크림
    c.rect(8, 8, 4, 6, "#e2c47a")
    c.ellipse(7, 4, 6, 5, "#f7c3cc")
    c.ellipse(7, 2, 6, 4, "#fff0cc")
    # 츄러스
    c.rect(28, 4, 3, 11, "#c9843a")
    c.px(29, 6, "#e2c47a")
    c.px(29, 10, "#e2c47a")
    c.rect(32, 5, 3, 10, "#c9843a")
    c.px(33, 8, "#e2c47a")
    # 메뉴판
    c.rect(18, 17, 12, 5, PANEL)
    c.px(20, 19, PANEL_LED)
    c.hline(22, 27, 19, "#f1e6d2")
    c.rect(0, 30, W, 2, "#1f1d23")
    return c


def photo_board():
    """포토존 보드 3x1: 액자 모양 배경 + 카메라 아이콘."""
    c = canvas(3, 1)
    W = 3 * T
    c.rect(1, 0, W - 2, 13, "#f4e3c6")
    c.frame(1, 0, W - 2, 13, "#8a6a4e")
    c.frame(3, 2, W - 6, 9, "#c9a37e")
    c.rect(20, 4, 8, 6, "#3b3540")
    c.rect(22, 3, 4, 1, "#3b3540")
    c.ellipse(22, 5, 4, 4, "#8fb3c2")
    c.px(23, 6, WHITE)
    c.rect(4, 13, 3, 3, POST)
    c.rect(W - 7, 13, 3, 3, POST)
    return c


def deck_railing_post():
    c = canvas(1, 1)
    c.rect(6, 0, 4, 16, WOOD_DK)
    c.rect(7, 0, 2, 15, WOOD)
    c.rect(5, 0, 6, 2, WOOD_DK)
    return c
