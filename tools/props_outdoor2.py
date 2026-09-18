"""14단계 야외 다듬기 타일 (16px 논리). 12단계 팔레트(props_outdoor.py)를 그대로 쓴다. 전부 코드로 그린 오리지널.

  잔디 v2: 이음새 없는 4톤 x 3시드 + 소품(잔디 결·클로버·작은 꽃·돌) 바닥 변형
  자갈 산책로: 16방향 마스크(가장자리 흙 테두리) · 트랙: 흰/빨강 연석 흙길(8방향) · 스키드 자국 · 출발선 변형 · 타이어 배리어 · 출발 배너 · 기둥 ·
        관중 벤치(아래를 봄) · 코너 표지판 · 피트 박스
  건물: 벽돌 벽 · 큰 창문(밤/낮) · 캐노피 · 간판 조명 · 덩굴 · 자전거 거치대 · 화단(플랜터)
  공원: 큰 활엽수 · 자작나무 · 덤불 · 갈대 · 연못 돌 · 수련 · 피크닉 담요 · 화단 4색
  광장: 원형 포석 띠 · 카트 차고     언덕: 경사 띠 3단
"""
import random

from pixel import Canvas
from props import LEAF, LEAF_HI, LEAF_LT, T, WOOD, WOOD_DK, WOOD_HI, canvas
from props_outdoor import (DIRT, DIRT_DK, DIRT_LT, GRASS, GRASS_DK, GRASS_LT, GRASS_SPECK, HILL, HILL_DK, HILL_HI, PANEL, PANEL_FRAME,
                           PANEL_LED, PATH, PATH_HI, PATH_LINE, PEBBLE, PLAZA, PLAZA_LINE, POST, POST_HI, ROCK, ROCK_DK, ROCK_HI, SHORE,
                           SHORE_DK, WATER, WATER_DK, WATER_FOAM, WATER_HI, dirt, flower, plaza, water)

GRASS_TONES = ["#7d9c66", "#7f9e68", "#7b9a64", "#829f6b"]
WHITE = "#f1ece2"
RED = "#d64d4d"
RED_DK = "#a83a3a"
BRICK = "#3a3741"
BRICK_DK = "#2d2a33"
BRICK_LT = "#46424e"
BRICK_MORTAR = "#26232b"
WIN_NIGHT = "#f2c98a"
WIN_NIGHT_DK = "#d9a55c"
WIN_NIGHT_HI = "#fff0cc"
WIN_DAY = "#8fb3c2"
WIN_DAY_HI = "#c9e6f2"
WIN_DAY_DK = "#6f95a6"
WIN_FRAME = "#1f1d23"
AWNING = "#d9977a"
AWNING_LT = "#f0bb9c"
AWNING_DK = "#b8765c"
BIRCH = "#e9e4d8"
BIRCH_DK = "#8f8a80"
FLOWER_SETS = {
    "pink": ["#f2a0b0", "#f7c3cc", "#e07a92"],
    "yellow": ["#f4c37a", "#f7d99a", "#e0a24a"],
    "purple": ["#d8a6e0", "#e9c8ee", "#b57cc0"],
    "white": ["#ffffff", "#f3f3ee", "#d6d6cc"],
    "red": ["#e2605e", "#f08a86", "#b84744"],
}


# ── 잔디 v2 ────────────────────────────────────────────────────────────
def grass2(tone=0, seed=0):
    """이음새 없는 잔디: 단색 베이스 + 아주 옅은 점 몇 개 (톤 차이가 작아 격자가 보이지 않는다)."""
    base = GRASS_TONES[tone % len(GRASS_TONES)]
    rnd = random.Random(seed * 31 + tone * 7 + 100)
    c = canvas(1, 1, base)
    for _ in range(5):
        x, y = rnd.randint(0, 15), rnd.randint(0, 15)
        c.px(x, y, GRASS_SPECK if rnd.random() < 0.5 else GRASS_DK)
    return c


def grass_tuft(seed=0):
    """잔디 결: 짧은 풀잎 몇 가닥."""
    c = grass2(seed % 4, seed)
    rnd = random.Random(seed + 300)
    for _ in range(3):
        x, y = rnd.randint(1, 13), rnd.randint(4, 14)
        c.px(x, y, GRASS_DK)
        c.px(x, y - 1, GRASS_LT)
        c.px(x + 1, y - 2, GRASS_SPECK)
        c.px(x + 2, y - 1, GRASS_LT)
        c.px(x + 2, y, GRASS_DK)
    return c


def grass_clover(seed=0):
    c = grass2(seed % 4, seed)
    rnd = random.Random(seed + 400)
    for _ in range(2):
        x, y = rnd.randint(2, 12), rnd.randint(2, 12)
        for dx, dy in ((0, 0), (1, 0), (0, 1), (1, 1)):
            c.px(x + dx, y + dy, "#5f8a4c")
        c.px(x, y, "#7fb069")
        c.px(x + 1, y + 1, "#7fb069")
        c.px(x + 1, y + 2, GRASS_DK)
    return c


def grass_flowers(seed=0):
    """작은 꽃 2~3송이 (단색 점)."""
    c = grass2(seed % 4, seed)
    rnd = random.Random(seed + 500)
    for _ in range(rnd.randint(2, 3)):
        x, y = rnd.randint(1, 14), rnd.randint(1, 14)
        col = rnd.choice(["#fff0c2", "#f2a0b0", "#ffffff", "#f4c37a"])
        c.px(x, y, col)
        c.px(x, y + 1, GRASS_DK)
    return c


def grass_pebble(seed=0):
    c = grass2(seed % 4, seed)
    rnd = random.Random(seed + 600)
    x, y = rnd.randint(2, 11), rnd.randint(3, 12)
    c.rect(x, y, 3, 2, ROCK)
    c.px(x, y, ROCK_HI)
    c.hline(x, x + 2, y + 2, ROCK_DK)
    if rnd.random() < 0.5:
        c.rect(x + 5, y + 3, 2, 1, ROCK_DK)
    return c


# ── 자갈 산책로 (마스크: N=1 E=2 S=4 W=8 가 잔디와 닿는 쪽 → 흙 테두리) ────
def gravel(mask=0, seed=0):
    rnd = random.Random(seed + mask * 3 + 700)
    c = canvas(1, 1, PATH)
    for _ in range(14):
        x, y = rnd.randint(0, 15), rnd.randint(0, 15)
        c.px(x, y, rnd.choice([PATH_HI, PATH_LINE, "#d0c7bb", "#aaa093"]))
    for _ in range(4):
        x, y = rnd.randint(0, 14), rnd.randint(0, 15)
        c.hline(x, x + 1, y, PATH_LINE)
    band = 2
    if mask & 1:
        c.rect(0, 0, 16, band, DIRT_DK)
        c.hline(0, 15, 0, "#8b6f58")
    if mask & 4:
        c.rect(0, 16 - band, 16, band, DIRT_DK)
        c.hline(0, 15, 15, "#8b6f58")
    if mask & 8:
        c.rect(0, 0, band, 16, DIRT_DK)
        c.vline(0, 0, 15, "#8b6f58")
    if mask & 2:
        c.rect(16 - band, 0, band, 16, DIRT_DK)
        c.vline(15, 0, 15, "#8b6f58")
    return c


# ── 트랙 ───────────────────────────────────────────────────────────────
def _kerb_stripes(c, side, length=16):
    """side 쪽 가장자리에 3px 흰/빨강 줄무늬 연석."""
    for i in range(length):
        col = WHITE if (i // 3) % 2 == 0 else RED
        if side == "N":
            c.vline(i, 0, 2, col)
            c.px(i, 3, "#8b6f58")
        elif side == "S":
            c.vline(i, 13, 15, col)
            c.px(i, 12, "#8b6f58")
        elif side == "W":
            c.hline(0, 2, i, col)
            c.px(3, i, "#8b6f58")
        else:
            c.hline(13, 15, i, col)
            c.px(12, i, "#8b6f58")


def dirt_kerb(sides):
    """트랙 가장자리 흙 + sides(N/E/S/W 1~2개) 쪽 연석."""
    c = dirt(1, 5 + len(sides))
    for s in sides:
        _kerb_stripes(c, s)
    return c


def dirt_skid(variant=0):
    """코너 안쪽 스키드 자국: 진한 두 줄이 비스듬히."""
    c = dirt(0, 20 + variant)
    rnd = random.Random(variant + 800)
    for k in range(2):
        off = k * 4
        for i in range(16):
            y = (i // 2 + off + (3 if variant else 0)) % 16
            if rnd.random() < 0.8:
                c.px(i, y, "#8a6f56")
            if rnd.random() < 0.5:
                c.px(i, (y + 1) % 16, "#7d6350")
    return c


def start_line_v(kerb=None):
    """출발선(가로 체크 띠) + 선택적 연석."""
    c = dirt(0, 9)
    for x in range(16):
        for y in range(6, 10):
            c.px(x, y, WHITE if ((x // 2) + (y // 2)) % 2 == 0 else "#2b282f")
    if kerb:
        _kerb_stripes(c, kerb)
    return c


def tire_stack():
    c = canvas(1, 1)
    for i, y in enumerate((9, 5, 1)):
        col = "#2b282f" if i != 1 else RED_DK
        c.ellipse(1, y + 1, 14, 6, "#1a181e")
        c.ellipse(1, y, 14, 6, col)
        c.ellipse(5, y + 1, 6, 3, "#4a4752" if i != 1 else "#c94a4a")
    c.px(3, 2, "#5a5660")
    return c


def start_banner(w=5):
    """출발 아치 배너 (top 레이어, 5x1): 양 끝 깃발 + 'START'."""
    c = canvas(w, 1)
    W = w * T
    c.rect(2, 4, W - 4, 8, "#2b282f")
    c.frame(2, 4, W - 4, 8, "#4a4752")
    for x in range(4, W - 4, 4):
        c.px(x, 5, PANEL_LED if (x // 4) % 2 else "#7a4f2c")
    c.text_center(W // 2, 6, "START", "#fff0cc")
    # 깃발 (양 끝)
    for fx, col in ((3, RED), (W - 5, "#4d8fd6")):
        c.vline(fx, 0, 12, POST_HI)
        c.rect(fx + 1, 0, 4, 3, col)
        c.px(fx + 5, 1, col)
    c.hline(2, W - 3, 12, "#1f1d23")
    return c


def arch_post():
    c = canvas(1, 1)
    c.rect(6, 0, 4, 14, POST)
    c.vline(7, 0, 13, POST_HI)
    c.rect(5, 13, 6, 3, "#1f1d23")
    for y in range(0, 14, 3):
        c.px(9, y, RED)
        c.px(9, y + 1, WHITE)
    return c


def stand_bench_s():
    """관중 벤치 3x1 (아래·트랙 쪽을 본다)."""
    c = canvas(3, 1)
    c.rect(1, 1, 46, 4, "#8a5f3a")
    c.hline(1, 46, 1, "#a8825f")
    c.rect(1, 7, 46, 5, "#7c5a44")
    c.hline(1, 46, 7, "#956f55")
    for lx in (2, 22, 42):
        c.rect(lx, 12, 3, 3, POST)
    return c


def corner_sign(n):
    c = canvas(1, 1)
    c.rect(7, 8, 2, 8, POST)
    c.rect(3, 1, 10, 8, "#f4c37a")
    c.frame(3, 1, 10, 8, "#c9843a")
    c.text_center(8, 3, str(n), "#2b282f")
    return c


def pit_box():
    """피트 박스 3x2: 위 줄은 지붕(top), 아래 줄은 뒷벽 + 공구대 + 타이어."""
    c = canvas(3, 2)
    W = 3 * T
    # 지붕
    c.rect(0, 2, W, 12, "#4a4752")
    c.hline(0, W - 1, 2, "#6b686f")
    for x in range(0, W, 6):
        c.rect(x, 4, 3, 10, "#3f3b45")
    c.hline(0, W - 1, 13, "#2b282f")
    c.text_center(W // 2, 6, "PIT", PANEL_LED)
    # 아래: 기둥 + 뒷벽 + 공구대
    c.rect(1, 14, 2, 18, POST)
    c.rect(W - 3, 14, 2, 18, POST)
    c.rect(3, 16, W - 6, 10, "#2f2c35")
    c.rect(5, 22, 14, 5, "#8a5f3a")
    c.hline(5, 18, 22, "#a8825f")
    c.rect(7, 18, 3, 3, "#c9843a")
    c.rect(12, 19, 4, 2, "#b8b4bf")
    c.ellipse(24, 20, 10, 6, "#2b282f")
    c.ellipse(27, 21, 4, 3, "#4a4752")
    c.ellipse(36, 20, 10, 6, "#2b282f")
    c.ellipse(39, 21, 4, 3, "#4a4752")
    c.rect(0, 30, W, 2, "#1f1d23")
    return c


# ── 건물 파사드 ─────────────────────────────────────────────────────────
def brick(variant=0):
    rnd = random.Random(variant + 900)
    c = canvas(1, 1, BRICK)
    for row, off in enumerate((0, 4, 0, 4)):
        y = row * 4
        c.hline(0, 15, y + 3, BRICK_MORTAR)
        for x in range(off - 8, 16, 8):
            c.vline(x + 7, y, y + 2, BRICK_MORTAR)
    for _ in range(3):
        x, y = rnd.randint(0, 14), rnd.randint(0, 3) * 4
        c.hline(x, x + 1, y, BRICK_LT)
    for _ in range(2):
        x, y = rnd.randint(0, 15), rnd.randint(0, 3) * 4 + 1
        c.px(x, y, BRICK_DK)
    return c


def _window_frame(c, W, H):
    c.rect(1, 0, W - 2, H - 1, WIN_FRAME)
    c.rect(0, H - 2, W, 2, "#4a4752")  # 창턱
    c.hline(0, W - 1, H - 2, "#6b686f")


def facade_window_night():
    """큰 창문 2x2 (밤): 안에서 따뜻한 불빛 + 커튼·책상 실루엣."""
    c = canvas(2, 2)
    W, H = 2 * T, 2 * T
    _window_frame(c, W, H)
    c.rect(3, 2, W - 6, H - 5, WIN_NIGHT)
    c.rect(3, 2, W - 6, 4, WIN_NIGHT_HI)
    # 커튼 (양옆)
    c.rect(3, 2, 4, H - 5, "#c98a6a")
    c.rect(W - 7, 2, 4, H - 5, "#c98a6a")
    c.vline(5, 2, H - 4, "#b8765c")
    c.vline(W - 6, 2, H - 4, "#b8765c")
    # 책상·모니터 실루엣
    c.rect(11, 16, 10, 2, WIN_NIGHT_DK)
    c.rect(13, 10, 6, 5, "#a37a48")
    c.rect(14, 11, 4, 3, "#ffe3ad")
    c.px(8, 6, "#fff8e6")
    # 십자 창살
    c.vline(W // 2 - 1, 2, H - 4, WIN_FRAME)
    c.vline(W // 2, 2, H - 4, WIN_FRAME)
    c.hline(3, W - 4, H // 2 - 1, WIN_FRAME)
    return c


def facade_window_day():
    """큰 창문 2x2 (낮): 하늘·건물이 비친 유리 + 사선 반사."""
    c = canvas(2, 2)
    W, H = 2 * T, 2 * T
    _window_frame(c, W, H)
    c.rect(3, 2, W - 6, H - 5, WIN_DAY)
    c.rect(3, 2, W - 6, 6, WIN_DAY_HI)
    c.rect(3, H - 10, W - 6, 7, WIN_DAY_DK)
    for i in range(10):
        c.px(6 + i, 4 + i, "#ffffff70")
        c.px(7 + i, 4 + i, "#ffffff40")
        c.px(18 + i, 8 + i, "#ffffff40")
    c.vline(W // 2 - 1, 2, H - 4, WIN_FRAME)
    c.vline(W // 2, 2, H - 4, WIN_FRAME)
    c.hline(3, W - 4, H // 2 - 1, WIN_FRAME)
    return c


def canopy(w=10):
    """입구 위 캐노피 (top, w x 1): 줄무늬 천막 + 아래 그림자."""
    c = canvas(w, 1)
    W = w * T
    c.rect(0, 2, W, 9, AWNING)
    for x in range(0, W, 8):
        c.rect(x, 2, 4, 9, AWNING_LT)
    c.hline(0, W - 1, 2, "#f6d3ba")
    # 물결 가장자리
    for x in range(0, W, 4):
        c.rect(x, 11, 4, 2, AWNING_DK if (x // 4) % 2 else AWNING)
        c.px(x + 1, 13, AWNING_DK)
        c.px(x + 2, 13, AWNING_DK)
    c.rect(0, 14, W, 2, "#00000050")
    return c


def sign_lamp():
    """간판 위 작은 조명 (top 1x1): 벽에서 튀어나온 갓 + 아래로 빛."""
    c = canvas(1, 1)
    c.rect(6, 2, 4, 4, "#1f1d23")
    c.rect(4, 6, 8, 2, "#2f2c35")
    c.rect(5, 8, 6, 2, "#ffe9b0")
    for i in range(5):
        c.hline(6 - i, 9 + i, 10 + i, "#ffd48a%02x" % (72 - i * 13))
    return c


def wall_vine():
    """벽을 타는 덩굴 (top 1x2)."""
    c = canvas(1, 2)
    rnd = random.Random(1001)
    for y in range(0, 32, 2):
        x = 6 + int(3 * (1 if (y // 4) % 2 else -1) * ((y % 4) / 4))
        c.px(x, y, "#4f7a55")
        c.px(x, y + 1, "#4f7a55")
    for _ in range(18):
        x, y = rnd.randint(2, 13), rnd.randint(0, 30)
        c.rect(x, y, 2, 2, rnd.choice([LEAF, LEAF_LT, "#4f7a55"]))
    for _ in range(3):
        c.px(rnd.randint(3, 12), rnd.randint(2, 28), "#f2a0b0")
    return c


def bike_rack():
    """자전거 거치대 2x1: 철제 걸이 + 자전거 2대."""
    c = canvas(2, 1)
    c.rect(0, 13, 32, 2, "#6b686f")
    for x in (2, 12, 22):
        c.rect(x, 4, 2, 10, "#8a838e")
        c.px(x, 4, "#b8b4bf")
    for bx, col in ((3, "#4d8fd6"), (17, "#d9977a")):
        for cx in (bx, bx + 8):
            c.ellipse(cx, 6, 6, 6, "#2b282f")
            c.ellipse(cx + 2, 8, 2, 2, "#8a838e")
        c.hline(bx + 2, bx + 9, 6, col)
        c.px(bx + 4, 5, col)
        c.px(bx + 6, 4, col)
        c.px(bx + 3, 4, "#2b282f")
    return c


def planter(colors="pink"):
    """나무 화단 2x1: 상자 + 꽃."""
    c = canvas(2, 1)
    c.rect(1, 7, 30, 8, WOOD)
    c.hline(1, 30, 7, WOOD_HI)
    c.hline(1, 30, 14, WOOD_DK)
    c.vline(8, 8, 13, WOOD_DK)
    c.vline(16, 8, 13, WOOD_DK)
    c.vline(24, 8, 13, WOOD_DK)
    c.rect(2, 3, 28, 5, LEAF)
    rnd = random.Random(hash(colors) % 1000)
    pal = FLOWER_SETS[colors]
    for _ in range(9):
        x, y = rnd.randint(2, 28), rnd.randint(1, 6)
        c.px(x, y, pal[0])
        c.px(x + 1, y, pal[1])
        c.px(x, y + 1, pal[2])
    c.rect(0, 15, 32, 1, "#00000040")
    return c


# ── 공원 ───────────────────────────────────────────────────────────────
def tree_round_big():
    """큰 활엽수 3x4 (위 3줄 top)."""
    c = canvas(3, 4)
    c.ellipse(1, 3, 46, 42, "#46703f")
    c.ellipse(2, 1, 44, 41, LEAF)
    c.ellipse(6, 4, 28, 24, LEAF_LT)
    c.ellipse(10, 6, 14, 10, LEAF_HI)
    rnd = random.Random(1010)
    for _ in range(26):
        c.px(rnd.randint(5, 42), rnd.randint(5, 38), rnd.choice([LEAF_LT, "#4f7a55", LEAF_HI]))
    c.rect(20, 40, 8, 22, WOOD_DK)
    c.rect(21, 40, 4, 21, WOOD)
    c.px(22, 44, WOOD_HI)
    c.rect(18, 56, 3, 4, WOOD_DK)
    c.ellipse(13, 58, 22, 6, "#4f6b45")
    return c


def tree_birch():
    """자작나무 2x3: 밝은 잎 + 흰 줄기."""
    c = canvas(2, 3)
    c.ellipse(2, 2, 28, 28, "#5f8a5c")
    c.ellipse(3, 0, 26, 27, "#8fb47a")
    c.ellipse(6, 3, 16, 14, "#a9cc92")
    c.ellipse(9, 5, 7, 5, "#c6e0b0")
    rnd = random.Random(1020)
    for _ in range(12):
        c.px(rnd.randint(5, 26), rnd.randint(5, 24), rnd.choice(["#7fae76", "#c6e0b0"]))
    c.rect(13, 27, 5, 19, BIRCH_DK)
    c.rect(14, 27, 3, 18, BIRCH)
    for y in (30, 35, 40):
        c.hline(14, 15, y, "#3b3540")
    c.ellipse(9, 42, 14, 5, "#4f6b45")
    return c


def tree_olive():
    """연둣빛 작은 활엽수 2x3 (종류 변주)."""
    c = canvas(2, 3)
    c.ellipse(1, 4, 30, 26, "#4d6f3d")
    c.ellipse(2, 2, 28, 25, "#7a9a5e")
    c.ellipse(5, 4, 18, 14, "#93b374")
    c.ellipse(8, 6, 8, 6, "#b3cc95")
    c.rect(14, 28, 4, 18, WOOD_DK)
    c.rect(15, 28, 2, 17, WOOD)
    c.ellipse(10, 42, 12, 5, "#4f6b45")
    return c


def bush(seed=0):
    rnd = random.Random(seed + 1030)
    c = canvas(1, 1)
    c.ellipse(1, 4, 14, 11, "#3f6a3c")
    c.ellipse(1, 2, 14, 11, LEAF)
    c.ellipse(3, 3, 8, 5, LEAF_LT)
    for _ in range(5):
        c.px(rnd.randint(2, 13), rnd.randint(3, 12), rnd.choice([LEAF_HI, LEAF_LT]))
    if seed % 2:
        for _ in range(3):
            c.px(rnd.randint(3, 12), rnd.randint(3, 9), rnd.choice(["#f2a0b0", "#fff0c2"]))
    c.hline(3, 12, 15, "#00000040")
    return c


def reed():
    """갈대 (top 1x1): 물가 위에 겹쳐 그린다."""
    c = canvas(1, 1)
    for x, h in ((3, 12), (6, 15), (9, 11), (12, 14)):
        c.vline(x, 16 - h, 15, "#7a9a5e")
        c.px(x + 1, 16 - h + 1, "#93b374")
        c.rect(x - 1, 16 - h - 1, 3, 3, "#8a5f3a")
        c.px(x, 16 - h - 1, "#a8825f")
    return c


def pond_rock():
    c = canvas(1, 1)
    c.ellipse(1, 5, 14, 10, ROCK_DK)
    c.ellipse(2, 3, 12, 10, ROCK)
    c.ellipse(4, 4, 6, 3, ROCK_HI)
    c.px(3, 12, "#4f6b45")
    c.px(12, 11, "#4f6b45")
    return c


def water_lily(frame=0):
    c = water(frame)
    c.ellipse(3, 5 + frame, 9, 7, "#5f8a5c")
    c.ellipse(4, 6 + frame, 7, 5, "#7fae76")
    c.rect(7, 8 + frame, 2, 2, WATER)
    c.px(9, 4 + frame, "#f2a0b0")
    c.px(10, 4 + frame, "#f7c3cc")
    c.px(9, 3 + frame, "#f7c3cc")
    return c


def blanket():
    """피크닉 담요 2x2 (바닥, 통과 가능): 빨강/크림 체크 + 바구니."""
    c = canvas(2, 2)
    c.rect(1, 1, 30, 30, "#e0c9a6")
    for y in range(1, 31):
        for x in range(1, 31):
            if ((x // 4) + (y // 4)) % 2 == 0:
                c.px(x, y, "#d97a6e")
    c.frame(1, 1, 30, 30, "#b8765c")
    c.rect(18, 8, 8, 6, "#c9a35a")
    c.hline(18, 25, 8, "#e2c47a")
    c.rect(20, 5, 4, 3, "#a37a48")
    c.rect(8, 18, 4, 4, "#f5efe3")
    c.rect(8, 19, 4, 1, "#7fa4c4")
    return c


def flowerbed(colors="pink", seed=0):
    """돌 테두리 화단 1x1 (통과 불가): 촘촘한 꽃."""
    rnd = random.Random(seed + hash(colors) % 500)
    pal = FLOWER_SETS[colors]
    c = canvas(1, 1, "#4f7a55")
    c.frame(0, 0, 16, 16, ROCK)
    c.hline(0, 15, 15, ROCK_DK)
    for _ in range(14):
        x, y = rnd.randint(1, 14), rnd.randint(1, 13)
        c.px(x, y, pal[rnd.randint(0, 2)])
    for _ in range(4):
        x, y = rnd.randint(2, 13), rnd.randint(2, 12)
        c.px(x, y, pal[0])
        c.px(x + 1, y, pal[0])
        c.px(x, y + 1, pal[0])
        c.px(x - 1, y, pal[0])
        c.px(x, y - 1, pal[0])
        c.px(x, y, pal[1])
    return c


# ── 광장 ───────────────────────────────────────────────────────────────
def plaza_ring2():
    """분수 바깥 두 번째 원형 띠: 점선 포석."""
    c = plaza(0)
    for x in range(0, 16, 4):
        c.rect(x, 6, 2, 4, "#a89a84")
        c.rect(x + 2, 6, 2, 4, "#d6c9b4")
    return c


def plaza_center():
    """분수 바로 둘레: 진한 포석."""
    c = canvas(1, 1, "#b8a992")
    c.frame(0, 0, 16, 16, PLAZA_LINE)
    c.px(3, 3, "#c9bba5")
    c.px(11, 11, "#c9bba5")
    return c


def kart_garage():
    """카트 차고 3x2: 지붕(top) + 셔터 + 간판."""
    c = canvas(3, 2)
    W = 3 * T
    c.rect(0, 3, W, 11, "#b8765c")
    c.hline(0, W - 1, 3, "#d9977a")
    for x in range(0, W, 6):
        c.rect(x, 5, 3, 9, "#a5674f")
    c.hline(0, W - 1, 13, "#7a4f3c")
    c.rect(2, 14, W - 4, 16, "#2f2c35")
    c.rect(4, 16, W - 8, 13, "#8a838e")
    for y in range(17, 29, 3):
        c.hline(4, W - 5, y, "#6b686f")
    c.rect(W - 12, 20, 6, 4, PANEL)
    c.rect(W - 11, 21, 4, 2, PANEL_LED)
    c.rect(0, 30, W, 2, "#1f1d23")
    return c


# ── 언덕 경사 띠 ───────────────────────────────────────────────────────
def hill_step(level=0):
    """경사 띠: 아래로 갈수록 어두운 잔디 + 위쪽 밝은 능선 줄."""
    base = ["#66865a", "#5f7d52", "#58744b"][level]
    rnd = random.Random(level + 1100)
    c = canvas(1, 1, base)
    c.hline(0, 15, 0, HILL_HI if level == 0 else "#7f9c69")
    for _ in range(6):
        c.px(rnd.randint(0, 15), rnd.randint(1, 15), rnd.choice([HILL_DK, "#6f8d5a"]))
    return c
