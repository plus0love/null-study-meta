"""12단계 야외 타일 (16px 논리). 실내 팔레트(props.py)의 채도·톤에 맞춘 낮 색이며,
밤/노을은 클라이언트가 어둠·틴트 레이어를 얹어 표현한다.

  바닥: 잔디 3톤 · 언덕 잔디 2톤 + 능선 · 흙길 2종 + 출발선 · 돌길 2종 · 광장 포석 2종 · 물 2프레임 + 물가 8방향 · 전망대 데크
  소품: 나무 3종(둥근·침엽·작은) · 꽃 3종 · 돌 2종 · 분수 3프레임 · 가로등 · 공원 벤치 · 관중 벤치 · 피크닉 테이블 · 카트 정류장 ·
        전광판(글자는 클라이언트) · 난간 · 망원경
전부 코드로 그린 오리지널 (CC0 원본 없음).
"""
import random

from pixel import Canvas
from props import LEAF, LEAF_HI, LEAF_LT, T, WOOD, WOOD_DK, WOOD_HI, canvas

GRASS = "#7d9c66"
GRASS_LT = "#8aa972"
GRASS_DK = "#6f8d5a"
GRASS_SPECK = "#9bb883"
HILL = "#6a8a58"
HILL_DK = "#5f7d4f"
HILL_HI = "#8aa972"
DIRT = "#b39473"
DIRT_DK = "#a2846a"
DIRT_LT = "#c2a586"
PEBBLE = "#8f7660"
PATH = "#b8ada0"
PATH_LINE = "#a1968a"
PATH_HI = "#c6bcb0"
PLAZA = "#c9bba5"
PLAZA_LINE = "#b3a48e"
PLAZA_HI = "#d6c9b4"
WATER = "#6a9cc0"
WATER_DK = "#5d8bb0"
WATER_HI = "#8fb8d4"
WATER_FOAM = "#c9e2ef"
SHORE = "#d3c19c"
SHORE_DK = "#b9a682"
PINE = "#4f7a55"
PINE_LT = "#6a9468"
PINE_HI = "#86ab7f"
ROCK = "#9a948f"
ROCK_DK = "#7e7873"
ROCK_HI = "#b3ada7"
POST = "#2f2c35"
POST_HI = "#4a4752"
LAMP_GLOW = "#ffd98a"
LAMP_HI = "#fff3d0"
DECK = "#a37d5e"
DECK_LINE = "#8a6a4e"
DECK_HI = "#b48f6e"
PANEL = "#26232b"
PANEL_FRAME = "#3d3944"
PANEL_LED = "#ffb85c"
FLOWERS = ["#f2a0b0", "#fff0c2", "#f4c37a", "#d8a6e0", "#ffffff"]


# ── 바닥 ───────────────────────────────────────────────────────────────
def grass(tone=0, seed=0):
    base = [GRASS, GRASS_LT, GRASS_DK][tone]
    rnd = random.Random(seed * 13 + tone)
    c = canvas(1, 1, base)
    for _ in range(7):
        x, y = rnd.randint(0, 15), rnd.randint(0, 15)
        c.px(x, y, GRASS_SPECK if rnd.random() < 0.6 else GRASS_DK)
    for _ in range(3):
        x, y = rnd.randint(0, 14), rnd.randint(1, 14)
        c.px(x, y, GRASS_LT)
        c.px(x, y - 1, GRASS_SPECK)
    return c


def hill(tone=0, seed=0):
    base = [HILL, HILL_DK][tone]
    rnd = random.Random(seed * 7 + tone + 40)
    c = canvas(1, 1, base)
    for _ in range(6):
        c.px(rnd.randint(0, 15), rnd.randint(0, 15), HILL_HI if rnd.random() < 0.5 else HILL_DK)
    return c


def hill_edge(seed=0):
    """언덕 아래 능선: 위쪽 밝은 테두리 + 아래 그림자."""
    c = hill(0, seed)
    c.hline(0, 15, 0, HILL_HI)
    c.hline(0, 15, 1, "#7f9c69")
    c.hline(0, 15, 14, HILL_DK)
    c.hline(0, 15, 15, "#54704a")
    return c


def dirt(variant=0, seed=0):
    rnd = random.Random(seed + variant * 3)
    c = canvas(1, 1, DIRT if variant == 0 else DIRT_DK)
    for _ in range(6):
        c.px(rnd.randint(0, 15), rnd.randint(0, 15), DIRT_LT)
    for _ in range(3):
        x, y = rnd.randint(0, 14), rnd.randint(0, 15)
        c.px(x, y, PEBBLE)
        c.px(x + 1, y, "#a08a72")
    return c


def dirt_edge(side):
    """흙길 가장자리: 잔디와 닿는 쪽에 밝은 흙 띠 (side: N/S/E/W)."""
    c = dirt(0, 5)
    col = DIRT_LT
    if side == "N":
        c.hline(0, 15, 0, col)
        c.hline(0, 15, 1, "#bda081")
    elif side == "S":
        c.hline(0, 15, 15, col)
        c.hline(0, 15, 14, "#bda081")
    elif side == "W":
        c.vline(0, 0, 15, col)
        c.vline(1, 0, 15, "#bda081")
    else:
        c.vline(15, 0, 15, col)
        c.vline(14, 0, 15, "#bda081")
    return c


def start_line():
    """출발선: 흙길 위 흑백 체크 띠 (세로 직선 구간용 — 가로 띠)."""
    c = dirt(0, 9)
    for x in range(16):
        for y in range(6, 10):
            c.px(x, y, "#f1ece2" if ((x // 2) + (y // 2)) % 2 == 0 else "#2b282f")
    return c


def stone_path(variant=0):
    c = canvas(1, 1, PATH)
    c.hline(0, 15, 7, PATH_LINE)
    c.hline(0, 15, 15, PATH_LINE)
    c.vline(7 if variant == 0 else 3, 0, 6, PATH_LINE)
    c.vline(3 if variant == 0 else 11, 8, 14, PATH_LINE)
    c.px(2, 2, PATH_HI)
    c.px(11, 10, PATH_HI)
    return c


def plaza(variant=0):
    c = canvas(1, 1, PLAZA)
    c.frame(0, 0, 16, 16, PLAZA_LINE)
    if variant == 1:
        c.hline(0, 15, 8, PLAZA_LINE)
        c.vline(8, 0, 15, PLAZA_LINE)
    c.px(2, 2, PLAZA_HI)
    c.px(12, 11, PLAZA_HI)
    return c


def plaza_ring():
    """분수 둘레 원형 포석 느낌 (진한 띠)."""
    c = plaza(0)
    c.frame(2, 2, 12, 12, "#a89a84")
    return c


def water(frame=0):
    c = canvas(1, 1, WATER)
    rnd = random.Random(21 + frame)
    for _ in range(4):
        x, y = rnd.randint(0, 12), rnd.randint(0, 15)
        c.hline(x, x + 3, y, WATER_HI)
    for _ in range(2):
        x, y = rnd.randint(0, 13), rnd.randint(0, 15)
        c.hline(x, x + 2, y, WATER_DK)
    # 반짝임 (프레임마다 자리가 다르다)
    c.px(3 + frame * 6, 4 + frame * 2, WATER_FOAM)
    c.px(11 - frame * 5, 12 - frame * 3, WATER_FOAM)
    return c


def shore(sides):
    """물가 타일: sides 에 든 방향(N/S/E/W)이 잔디 쪽. 모래 띠 + 잔디."""
    c = water(0)
    band = 5
    if "N" in sides:
        c.rect(0, 0, 16, band, GRASS)
        c.hline(0, 15, band, SHORE)
        c.hline(0, 15, band + 1, SHORE_DK)
    if "S" in sides:
        c.rect(0, 16 - band, 16, band, GRASS)
        c.hline(0, 15, 15 - band, SHORE)
        c.hline(0, 15, 14 - band, SHORE_DK)
    if "W" in sides:
        c.rect(0, 0, band, 16, GRASS)
        c.vline(band, 0, 15, SHORE)
        c.vline(band + 1, 0, 15, SHORE_DK)
    if "E" in sides:
        c.rect(16 - band, 0, band, 16, GRASS)
        c.vline(15 - band, 0, 15, SHORE)
        c.vline(14 - band, 0, 15, SHORE_DK)
    # 모서리는 잔디 쪽 사각형이 겹쳐 자연스럽게 안쪽 모서리가 된다
    return c


def deck(variant=0):
    c = canvas(1, 1, DECK)
    for y in (3, 7, 11, 15):
        c.hline(0, 15, y, DECK_LINE)
    c.vline(7 if variant == 0 else 12, 0, 3, DECK_LINE)
    c.vline(3 if variant == 0 else 9, 8, 11, DECK_LINE)
    c.px(1, 1, DECK_HI)
    c.px(9, 9, DECK_HI)
    return c


# ── 소품 ───────────────────────────────────────────────────────────────
def tree_round():
    """둥근 활엽수 2x3 (위 2줄은 top 레이어, 아래 줄 줄기)."""
    c = canvas(2, 3)
    c.ellipse(1, 1, 30, 30, "#46703f")
    c.ellipse(2, 0, 28, 28, LEAF)
    c.ellipse(5, 2, 18, 16, LEAF_LT)
    c.ellipse(8, 4, 9, 7, LEAF_HI)
    rnd = random.Random(3)
    for _ in range(10):
        c.px(rnd.randint(4, 27), rnd.randint(4, 26), LEAF_LT)
    # 줄기
    c.rect(13, 28, 6, 18, WOOD_DK)
    c.rect(14, 28, 3, 17, WOOD)
    c.px(15, 30, WOOD_HI)
    c.ellipse(9, 42, 14, 5, "#4f6b45")
    return c


def tree_pine():
    c = canvas(2, 3)
    layers = [(6, 2, 20, 12), (3, 10, 26, 13), (1, 20, 30, 14)]
    for i, (x, y, w, h) in enumerate(layers):
        c.ellipse(x, y + 1, w, h, "#3d6144")
        col = [PINE_HI, PINE_LT, PINE][i]
        # 삼각형 층
        for yy in range(h):
            half = int((w / 2) * (yy + 1) / h)
            c.hline(x + w // 2 - half, x + w // 2 + half - 1, y + yy, col)
        c.hline(x + w // 2 - 2, x + w // 2 + 1, y + 1, PINE_HI)
    c.rect(14, 34, 4, 12, WOOD_DK)
    c.rect(15, 34, 2, 11, WOOD)
    c.ellipse(10, 42, 12, 5, "#4f6b45")
    return c


def tree_small():
    c = canvas(1, 2)
    c.ellipse(1, 1, 14, 16, "#46703f")
    c.ellipse(2, 0, 12, 14, LEAF)
    c.ellipse(4, 2, 7, 6, LEAF_LT)
    c.px(6, 3, LEAF_HI)
    c.rect(7, 15, 3, 13, WOOD_DK)
    c.rect(8, 15, 1, 12, WOOD)
    c.ellipse(4, 27, 8, 4, "#4f6b45")
    return c


def flower(seed=0):
    rnd = random.Random(seed + 70)
    c = canvas(1, 1)
    for _ in range(3):
        x, y = rnd.randint(2, 12), rnd.randint(4, 13)
        c.px(x, y + 1, GRASS_DK)
        c.px(x, y + 2, GRASS_DK)
        col = rnd.choice(FLOWERS)
        c.px(x, y, col)
        c.px(x - 1, y, col)
        c.px(x + 1, y, col)
        c.px(x, y - 1, col)
        c.px(x, y, "#f7dc7c" if col != "#fff0c2" else "#f2a0b0")
    return c


def rock(big=False):
    c = canvas(2 if big else 1, 1)
    w = 30 if big else 14
    c.ellipse(1, 6, w, 9, ROCK_DK)
    c.ellipse(1, 3, w, 10, ROCK)
    c.ellipse(4, 4, w // 2, 4, ROCK_HI)
    c.hline(2, w - 2, 12, ROCK_DK)
    return c


def fountain(frame=0):
    """분수 3x3: 돌 수반 + 물 + 가운데 기둥에서 솟는 물줄기 (3프레임)."""
    c = canvas(3, 3)
    W = 48
    c.ellipse(1, 6, W - 2, 40, "#6f6a66")
    c.ellipse(1, 4, W - 2, 40, ROCK)
    c.ellipse(3, 6, W - 6, 36, ROCK_HI)
    c.ellipse(6, 9, W - 12, 30, WATER)
    rnd = random.Random(frame)
    for _ in range(6):
        x, y = rnd.randint(8, 36), rnd.randint(12, 34)
        c.hline(x, x + 2, y, WATER_HI)
    # 가운데 기둥
    c.rect(20, 16, 8, 12, ROCK_DK)
    c.rect(21, 15, 6, 12, ROCK)
    c.ellipse(18, 24, 12, 5, ROCK_HI)
    # 물줄기 (프레임마다 높이·물방울 위치가 다르다)
    h = [10, 13, 8][frame]
    c.rect(23, 15 - h, 2, h, WATER_HI)
    c.px(23, 14 - h, WATER_FOAM)
    c.px(24, 14 - h, WATER_FOAM)
    for i, (dx, dy) in enumerate([(-5, 4), (5, 3), (-8, 9), (8, 8), (-3, 12), (3, 11)]):
        f = (i + frame) % 3
        c.px(24 + dx, 15 - h + dy + f * 2, WATER_FOAM if f == 0 else WATER_HI)
    # 수면 파문
    for r in range(3):
        c.px(14 + r * 3 + frame, 30 + r, WATER_FOAM)
        c.px(33 - r * 3 - frame, 30 + r, WATER_FOAM)
    return c


def lamp_post():
    c = canvas(1, 2)
    c.rect(5, 1, 6, 5, POST)
    c.rect(6, 2, 4, 3, LAMP_GLOW)
    c.px(7, 3, LAMP_HI)
    c.px(8, 3, LAMP_HI)
    c.rect(7, 6, 2, 22, POST)
    c.px(7, 8, POST_HI)
    c.rect(5, 28, 6, 3, POST)
    c.rect(4, 30, 8, 2, "#1f1d23")
    return c


def bench_park():
    """공원 벤치 2x1 (앉는 칸 2, 아래를 본다)."""
    c = canvas(2, 1)
    c.rect(2, 1, 28, 3, WOOD)
    c.hline(2, 29, 1, WOOD_HI)
    c.rect(2, 5, 28, 3, WOOD)
    c.hline(2, 29, 5, WOOD_HI)
    c.rect(1, 9, 30, 4, "#8a6a4e")
    c.hline(1, 30, 9, WOOD_HI)
    for lx in (2, 27):
        c.rect(lx, 8, 3, 2, POST)
        c.rect(lx, 13, 3, 3, POST)
    return c


def stand_bench():
    """관중 벤치 3x1 (왼쪽·트랙 쪽을 본다)."""
    c = canvas(3, 1)
    c.rect(1, 2, 46, 4, "#8a5f3a")
    c.hline(1, 46, 2, "#a8825f")
    c.rect(1, 8, 46, 5, "#7c5a44")
    c.hline(1, 46, 8, "#956f55")
    for lx in (2, 22, 42):
        c.rect(lx, 13, 3, 3, POST)
    return c


def picnic_table():
    """피크닉 테이블 3x2 (통과 불가, 위 줄·아래 줄이 벤치)."""
    c = canvas(3, 2)
    c.rect(2, 4, 44, 3, "#8a6a4e")
    c.rect(2, 22, 44, 3, "#8a6a4e")
    c.rect(4, 9, 40, 11, WOOD)
    c.hline(4, 43, 9, WOOD_HI)
    for y in (12, 15, 18):
        c.hline(4, 43, y, WOOD_DK)
    for lx in (6, 38):
        c.rect(lx, 7, 3, 2, WOOD_DK)
        c.rect(lx, 20, 3, 6, WOOD_DK)
    # 테이블 위 소품: 바구니·컵
    c.rect(20, 11, 7, 5, "#c9a35a")
    c.hline(20, 26, 11, "#e2c47a")
    c.rect(30, 12, 3, 4, "#f5efe3")
    return c


def kart_stop():
    """카트 정류장 2x2: 기둥 + 지붕 + 표지판."""
    c = canvas(2, 2)
    c.rect(1, 2, 30, 6, "#d9977a")
    c.hline(1, 30, 2, "#e8b68e")
    for x in range(1, 31, 4):
        c.rect(x, 5, 2, 3, "#c4806a")
    c.rect(3, 8, 2, 22, POST)
    c.rect(27, 8, 2, 22, POST)
    c.rect(8, 10, 16, 12, PANEL)
    c.frame(8, 10, 16, 12, PANEL_FRAME)
    # 카트 픽토그램
    c.rect(11, 14, 10, 4, PANEL_LED)
    c.rect(13, 12, 5, 2, PANEL_LED)
    c.px(12, 19, "#f1ece2")
    c.px(19, 19, "#f1ece2")
    c.rect(2, 30, 28, 2, "#1f1d23")
    return c


def scoreboard():
    """전광판 5x3 (글자는 클라이언트가 그린다)."""
    c = canvas(5, 3)
    W, H = 5 * T, 3 * T
    c.rect(0, 0, W, H - 6, PANEL_FRAME)
    c.rect(2, 2, W - 4, H - 10, PANEL)
    c.frame(2, 2, W - 4, H - 10, "#4d4954")
    # 상단 LED 띠
    for x in range(4, W - 4, 3):
        c.px(x, 4, PANEL_LED if (x // 3) % 2 else "#8a5f3a")
    c.hline(4, W - 5, 6, "#3d3944")
    # 기둥
    c.rect(6, H - 6, 4, 6, POST)
    c.rect(W - 10, H - 6, 4, 6, POST)
    return c


def railing(axis):
    c = canvas(1, 1)
    if axis == "H":
        c.rect(0, 5, 16, 2, WOOD)
        c.hline(0, 15, 5, WOOD_HI)
        c.rect(0, 10, 16, 2, WOOD)
        for x in (2, 9):
            c.rect(x, 3, 2, 12, WOOD_DK)
    else:
        c.rect(5, 0, 2, 16, WOOD)
        c.rect(10, 0, 2, 16, WOOD)
        for y in (2, 9):
            c.rect(3, y, 10, 2, WOOD_DK)
    return c


def telescope():
    c = canvas(1, 2)
    c.rect(6, 22, 4, 8, POST)
    c.rect(4, 29, 8, 2, "#1f1d23")
    # 경통 (비스듬히)
    for i in range(8):
        c.rect(8 + i, 20 - i * 2, 4, 3, "#5a5660")
        c.px(8 + i, 20 - i * 2, "#8a8c94")
    c.rect(14, 4, 4, 4, "#8a8c94")
    c.px(15, 5, "#c9e6f2")
    return c


def sky_tile():
    """하늘 띠 자리(투명) — 실제 하늘은 클라이언트 그라데이션."""
    return canvas(1, 1)
