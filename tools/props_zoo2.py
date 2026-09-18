"""야외 후속 타일 (16px 논리, 오리지널) — 동물원 서식지 · 트랙 안쪽 · 공원 소품 밀도.

  바닥: 흙 2 · 마른 풀(사바나) 2 · 진흙 2 · 낙엽 3 · 우리 물 위 수련 2프레임
  우리 소품: 큰 바위(2x2) · 마른 풀 다발 · 그늘 나무(2x3) · 먹이대(1x2) · 얼음 덩어리 · 미끄럼 바위(2x1) · 굴 · 당근 접시 · 타이어 그네(1x2) · 촘촘 대나무(1x2)
  공원 소품: 관목 2 · 그루터기 · 응원 깃발 3색(1x2) · 꽃 패치 5색(테두리 없는 촘촘한 꽃, 통과 가능 — 꽃 군락 중심)
  안내판: 큰 안내판 2x2 (위 줄 = 판, 아래 줄 = 기둥 왼쪽/오른쪽 + 빈 칸)
"""
import random

from props import LEAF, LEAF_HI, LEAF_LT, WOOD, WOOD_DK, WOOD_HI, WOOD_LT, canvas
from props_outdoor import GRASS_DK, PEBBLE, POST, ROCK, ROCK_DK, ROCK_HI
from props_outdoor2 import FLOWER_SETS, grass2
from props_zoo import FENCE, FENCE_DK, FENCE_HI, ICE, ICE_DK, ICE_HI, pool

SOIL = "#a3865f"
SOIL_DK = "#8c7050"
SOIL_HI = "#b89a72"
SAV = "#b9b06a"
SAV_DK = "#a39a5a"
SAV_HI = "#d0c883"
MUD = "#6f5a44"
MUD_DK = "#5c4a38"
MUD_HI = "#8a7358"
MUD_SHEEN = "#8d8a99"
LEAF_FALL = ["#d98b4a", "#c9a35a", "#b06a3a", "#e0b060"]
FLAG_SETS = [("#d64d4d", "#f08a86"), ("#f4c37a", "#f7d99a"), ("#5f9ad6", "#9fc4ec")]


# ── 바닥 ───────────────────────────────────────────────────────────────
def soil(variant=0):
    """흙 바닥 (토끼·원숭이 우리)."""
    rnd = random.Random(variant + 1400)
    c = canvas(1, 1, SOIL)
    for _ in range(7):
        c.px(rnd.randint(0, 15), rnd.randint(0, 15), rnd.choice([SOIL_DK, SOIL_HI]))
    if variant:
        c.rect(4, 9, 3, 2, SOIL_DK)
        c.px(11, 4, PEBBLE)
    return c


def savanna(variant=0):
    """마른 풀 바닥 (기린 우리)."""
    rnd = random.Random(variant + 1500)
    c = canvas(1, 1, SAV)
    for _ in range(5):
        x, y = rnd.randint(1, 13), rnd.randint(3, 14)
        c.px(x, y, SAV_DK)
        c.px(x, y - 1, SAV_HI)
        c.px(x + 1, y - 2, SAV_HI)
    if variant:
        c.px(3, 12, SOIL_DK)
        c.px(12, 5, SOIL_DK)
    return c


def mud(variant=0):
    """진흙 (코끼리 물웅덩이 둘레): 어두운 젖은 흙 + 물기 반짝임."""
    rnd = random.Random(variant + 1600)
    c = canvas(1, 1, MUD)
    for _ in range(5):
        c.px(rnd.randint(0, 15), rnd.randint(0, 15), rnd.choice([MUD_DK, MUD_HI]))
    ox = 2 + variant * 5
    c.ellipse(ox, 6, 8, 5, MUD_DK)
    c.hline(ox + 2, ox + 4, 7, MUD_SHEEN)
    return c


def leaves(seed=0):
    """낙엽 깔린 잔디 (바닥 변형, 통과 가능)."""
    c = grass2(seed % 4, seed + 20)
    rnd = random.Random(seed + 1700)
    for _ in range(5):
        x, y = rnd.randint(1, 13), rnd.randint(1, 13)
        col = rnd.choice(LEAF_FALL)
        c.px(x, y, col)
        c.px(x + 1, y, col)
        c.px(x + (1 if rnd.random() < 0.5 else 0), y + 1, col)
    return c


def pool_lily(frame=0):
    """우리 안 물 위 수련 (플라밍고)."""
    c = pool(frame)
    c.ellipse(3, 5 + frame, 9, 7, "#5f8a5c")
    c.ellipse(4, 6 + frame, 7, 5, "#7fae76")
    c.rect(7, 8 + frame, 2, 2, "#7fb0d0")
    c.px(9, 4 + frame, "#f2a0b0")
    c.px(10, 4 + frame, "#f7c3cc")
    c.px(9, 3 + frame, "#f7c3cc")
    return c


# ── 우리 소품 ───────────────────────────────────────────────────────────
def rock_big():
    """큰 바위 2x2 (사자 낮잠 바위)."""
    c = canvas(2, 2)
    c.ellipse(1, 12, 30, 18, ROCK_DK)
    c.ellipse(1, 4, 30, 22, ROCK)
    c.ellipse(5, 6, 16, 9, ROCK_HI)
    c.ellipse(19, 10, 9, 6, ROCK_HI)
    c.hline(8, 14, 16, ROCK_DK)
    c.hline(14, 20, 19, ROCK_DK)
    c.px(21, 20, ROCK_DK)
    c.ellipse(2, 24, 28, 7, ROCK_DK)
    c.hline(3, 28, 30, "#00000040")
    return c


def dry_grass():
    """마른 풀 다발 (통과 가능)."""
    c = canvas(1, 1)
    for x, h in ((2, 8), (5, 11), (8, 9), (11, 10), (14, 7)):
        c.vline(x, 16 - h, 14, SAV_DK)
        c.px(x - 1, 16 - h + 1, SAV_HI)
        c.px(x + 1, 16 - h, SAV_HI)
    c.hline(2, 13, 15, "#00000030")
    return c


def tree_flat():
    """넓적한 그늘 나무 2x3 (위 2줄 top): 납작한 우산 모양 잎."""
    c = canvas(2, 3)
    c.ellipse(0, 6, 32, 14, "#4d6f3d")
    c.ellipse(1, 3, 30, 13, "#7a9a5e")
    c.ellipse(4, 3, 22, 7, "#93b374")
    c.ellipse(8, 4, 10, 4, "#b3cc95")
    c.rect(14, 18, 4, 28, WOOD_DK)
    c.rect(15, 18, 2, 27, WOOD)
    c.rect(10, 20, 5, 2, WOOD_DK)
    c.rect(17, 24, 5, 2, WOOD_DK)
    c.ellipse(6, 42, 20, 5, "#00000040")
    return c


def feeder_tall():
    """기린 먹이대 1x2 (위 줄 top): 높은 기둥 위 건초 바구니."""
    c = canvas(1, 2)
    c.rect(6, 10, 4, 22, WOOD_DK)
    c.rect(7, 10, 2, 21, WOOD)
    c.rect(2, 2, 12, 9, WOOD_DK)
    c.rect(3, 3, 10, 7, WOOD)
    c.hline(3, 12, 3, WOOD_HI)
    c.rect(4, 4, 8, 4, "#e2c47a")
    c.px(5, 5, "#c9a35a")
    c.px(9, 6, "#c9a35a")
    c.rect(3, 29, 10, 2, WOOD_DK)
    return c


def ice_block():
    """얼음 덩어리 (펭귄)."""
    c = canvas(1, 1)
    c.rect(2, 4, 12, 11, ICE)
    c.frame(2, 4, 12, 11, ICE_DK)
    c.rect(3, 5, 10, 2, ICE_HI)
    for i in range(4):
        c.px(4 + i, 8 + i, ICE_HI)
    c.rect(2, 13, 12, 2, ICE_DK)
    c.hline(3, 12, 15, "#00000040")
    return c


def ice_slide():
    """미끄럼 바위 2x1: 왼쪽이 낮고 오른쪽이 높은 얼음 비탈."""
    c = canvas(2, 1)
    for x in range(2, 30):
        top = 12 - (x - 2) * 9 // 28
        c.vline(x, top, 14, ICE)
        c.px(x, top, ICE_HI)
    c.rect(24, 3, 5, 12, ICE)
    c.rect(24, 3, 5, 2, ICE_HI)
    c.vline(29, 3, 14, ICE_DK)
    c.hline(2, 29, 14, ICE_DK)
    c.px(8, 12, ICE_HI)
    c.px(14, 10, ICE_HI)
    c.hline(3, 28, 15, "#00000040")
    return c


def burrow():
    """토끼 굴: 흙 둔덕 + 어두운 구멍."""
    c = canvas(1, 1)
    c.ellipse(1, 5, 14, 10, SOIL_DK)
    c.ellipse(1, 3, 14, 10, "#b0916a")
    c.ellipse(4, 7, 8, 6, "#2b2530")
    c.ellipse(5, 7, 6, 3, "#3d3540")
    c.px(3, 5, SOIL_HI)
    c.px(12, 6, SOIL_HI)
    return c


def carrot_plate():
    """당근 접시 (통과 가능)."""
    c = canvas(1, 1)
    c.ellipse(2, 7, 12, 7, "#f1e6d2")
    c.ellipse(3, 8, 10, 5, "#e0d6c4")
    for x in (4, 7, 10):
        c.rect(x, 8, 2, 3, "#e8873a")
        c.px(x, 11, "#e8873a")
        c.px(x + 1, 7, "#5f8a5c")
        c.px(x, 6, "#7fae76")
    return c


def tire_swing():
    """타이어 그네 1x2 (위 줄 top): 틀 + 밧줄 + 타이어."""
    c = canvas(1, 2)
    c.rect(1, 1, 3, 30, WOOD_DK)
    c.rect(12, 1, 3, 30, WOOD_DK)
    c.px(2, 2, WOOD_HI)
    c.px(13, 2, WOOD_HI)
    c.rect(0, 0, 16, 3, WOOD)
    c.hline(0, 15, 0, WOOD_HI)
    c.vline(8, 3, 16, "#c9a35a")
    c.vline(7, 5, 15, "#a37a48")
    c.ellipse(4, 16, 9, 9, "#1f1d23")
    c.ellipse(6, 18, 5, 5, "#3b3540")
    c.px(6, 18, "#5a5660")
    c.px(9, 21, "#5a5660")
    return c


def bamboo_dense():
    """촘촘한 대나무 1x2 (위 줄 top): 줄기 5개."""
    c = canvas(1, 2)
    for x, h in ((1, 28), (4, 31), (7, 27), (10, 30), (13, 29)):
        c.rect(x, 32 - h, 2, h, "#6fa04a")
        for y in range(32 - h + 4, 32, 6):
            c.hline(x, x + 1, y, "#4e7a33")
        c.px(x + 2, 32 - h + 3, "#8fbf62")
        c.px(x - 1, 32 - h + 7, "#8fbf62")
        c.rect(x + 2, 32 - h + 10, 2, 1, "#8fbf62")
    return c


# ── 공원 소품 ───────────────────────────────────────────────────────────
def shrub(seed=0):
    """작은 관목 1x1 (덤불보다 작고 성글다)."""
    rnd = random.Random(seed + 1800)
    c = canvas(1, 1)
    c.ellipse(3, 7, 10, 8, "#3f6a3c")
    c.ellipse(3, 5, 10, 8, LEAF)
    c.ellipse(5, 6, 5, 3, LEAF_LT)
    for _ in range(4):
        c.px(rnd.randint(4, 11), rnd.randint(6, 11), rnd.choice([LEAF_HI, LEAF_LT]))
    if seed % 2:
        c.px(6, 6, "#e0b060")
        c.px(10, 8, "#d98b4a")
    c.hline(4, 11, 15, "#00000040")
    return c


def stump():
    """그루터기 1x1: 나이테."""
    c = canvas(1, 1)
    c.ellipse(2, 8, 12, 7, WOOD_DK)
    c.rect(2, 8, 12, 4, WOOD_DK)
    c.ellipse(2, 4, 12, 8, WOOD_LT)
    c.ellipse(4, 5, 8, 5, WOOD_HI)
    c.ellipse(6, 6, 4, 3, WOOD_LT)
    c.px(7, 7, WOOD_DK)
    c.px(3, 10, GRASS_DK)
    c.hline(3, 12, 15, "#00000040")
    return c


def cheer_flag(i=0):
    """응원 깃발 1x2 (위 줄 top): 기둥 + 삼각 깃발 2장."""
    a, b = FLAG_SETS[i % len(FLAG_SETS)]
    c = canvas(1, 2)
    c.vline(4, 1, 30, POST)
    c.px(4, 0, "#c9c4bb")
    for y in range(7):
        w = 10 - abs(y - 3) * 3
        c.hline(5, 5 + max(w, 1) - 1, 1 + y, a)
    c.hline(5, 8, 3, b)
    for y in range(5):
        w = 7 - abs(y - 2) * 3
        c.hline(5, 5 + max(w, 1) - 1, 11 + y, b)
    c.rect(3, 29, 3, 2, POST)
    c.hline(2, 7, 31, "#00000040")
    return c


def zoo_sign_big(side="l"):
    """큰 안내판 2x2 (위 줄 top): 넓은 판 + 아래 줄 기둥(왼쪽/오른쪽 칸, 나머지 칸은 비움)."""
    c = canvas(2, 2)
    c.rect(1, 1, 30, 14, "#f4e3c6")
    c.frame(1, 1, 30, 14, WOOD_DK)
    c.frame(2, 2, 28, 12, "#c9a37e")
    c.hline(5, 24, 5, "#8a6a4e")
    c.hline(5, 19, 8, "#8a6a4e")
    c.hline(5, 22, 11, "#8a6a4e")
    c.ellipse(24, 8, 4, 4, "#8a6a4e")
    c.px(25, 7, "#8a6a4e")
    c.px(27, 7, "#8a6a4e")
    px = 6 if side == "l" else 22
    c.rect(px, 15, 4, 15, FENCE_DK)
    c.rect(px + 1, 15, 2, 14, FENCE)
    c.px(px + 1, 16, FENCE_HI)
    c.rect(px - 1, 29, 6, 2, FENCE_DK)
    c.hline(px - 2, px + 5, 31, "#00000040")
    return c


def flower_patch(colors="pink", seed=0):
    """테두리 없는 촘촘한 꽃 패치 1x1 (통과 가능): 잔디 위에 그대로 겹친다 — 꽃 군락의 중심."""
    rnd = random.Random(seed + sum(ord(ch) for ch in colors) * 7 + 1900)
    pal = FLOWER_SETS[colors]
    c = canvas(1, 1)
    for _ in range(6):
        x, y = rnd.randint(1, 14), rnd.randint(1, 14)
        c.px(x, y + 1, "#4f7a55")
        c.px(x + 1, y + 2, "#5f8a5c")
    for _ in range(7):
        x, y = rnd.randint(1, 14), rnd.randint(1, 14)
        col = pal[rnd.randint(0, 1)]
        c.px(x - 1, y, col)
        c.px(x + 1, y, col)
        c.px(x, y - 1, col)
        c.px(x, y + 1, col)
        c.px(x, y, pal[2] if rnd.random() < 0.5 else "#f7dc7c")
    return c
