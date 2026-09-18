"""17단계 소품: 2인 스터디룸 안쪽 정리.
격자 러그(테두리+격자만) · 위를 보는 2인 소파(등받이가 아래 벽) · 낮은 테이블(책·머그) · 작은 사이드 테이블 ·
작은 화이트보드(이젤) · 2단 책장 · 미니 냉장고(위 칸은 top 레이어) · 바닥 쿠션 2색.

모든 함수는 16px 논리 해상도 Canvas 를 돌려준다. 글자는 그리지 않는다 (클라이언트 웹폰트).
"""
from props import (INK, LEAF, LEAF_HI, LEAF_LT, METAL, METAL_DK, POT, POT_HI, T, WOOD, WOOD_DK, WOOD_HI, WOOD_LT, _SPINES, canvas,
                   deco)
from props_room import CUSHION, CUSHION_DK, CUSHION_HI, SOFA, SOFA_DK, SOFA_HI
from props_v4 import BURG, RUG_PALETTES

TERRA_DK, TERRA, TERRA_HI = "#b8765c", "#d9977a", "#efb59a"
FRIDGE, FRIDGE_DK, FRIDGE_HI = "#e9e4dc", "#b9b6b3", "#f7f3ec"
BOARD_FRAME, BOARD = "#8d8a90", "#f1e9da"


# ── 러그 ─────────────────────────────────────────────────────────────
def rug_grid(w, h, palette="cream"):
    """단순 격자 러그: 테두리(바깥 2px + 안쪽 1px 선) + 8px 격자, 교차점에 점. 책상 앞에만 깔리는 작은 러그용."""
    p = RUG_PALETTES[palette]
    c = canvas(w, h)
    W, H = w * T, h * T
    c.rect(0, 0, W, H, p["base"])
    for x in range(8, W - 4, 8):
        c.vline(x, 5, H - 6, p["accent"])
    for y in range(8, H - 4, 8):
        c.hline(5, W - 6, y, p["accent"])
    for y in range(8, H - 4, 8):
        for x in range(8, W - 4, 8):
            c.px(x, y, p["accent2"])
    c.frame(0, 0, W, H, p["border"])
    c.frame(1, 1, W - 2, H - 2, p["border"])
    c.frame(3, 3, W - 6, H - 6, p["border2"])
    for y in range(2, H - 2, 3):
        c.px(0, y, p["border2"])
        c.px(W - 1, y, p["border2"])
    return c


# ── 소파 · 테이블 ─────────────────────────────────────────────────────
def sofa_love_n(w=4, h=2):
    """위를 보는 2인 소파 4x2: 윗줄 = 팔걸이 2 + 좌석 쿠션 2(통과 가능), 아랫줄 = 등받이(뒤에서 본 모습, 오른쪽에 담요)."""
    c = canvas(w, h)
    W, H = w * T, h * T
    # 좌석 바닥
    c.rect(6, 2, W - 12, 14, SOFA_DK)
    seat_w = (W - 16) // 2
    for i in range(2):
        sx = 8 + i * seat_w
        c.rect(sx, 2, seat_w - 1, 13, SOFA)
        c.frame(sx, 2, seat_w - 1, 13, SOFA_DK)
        c.hline(sx + 1, sx + seat_w - 3, 3, SOFA_HI)
        c.px(sx + seat_w // 2 - 1, 8, SOFA_DK)
    # 팔걸이 (두 줄에 걸침)
    for ax in (0, W - 8):
        c.rect(ax, 4, 8, H - 8, SOFA_DK)
        c.rect(ax + 1, 3, 6, H - 8, SOFA)
        c.hline(ax + 2, ax + 5, 3, SOFA_HI)
        c.vline(ax + 1, 4, H - 6, SOFA_HI)
    # 등받이 (아랫줄): 윗면 밝게, 가운데 이음선
    c.rect(2, 15, W - 4, 13, SOFA_DK)
    c.rect(3, 14, W - 6, 12, SOFA)
    c.hline(4, W - 5, 14, SOFA_HI)
    c.hline(4, W - 5, 15, SOFA_HI)
    c.vline(W // 2, 16, 25, SOFA_DK)
    for x in range(6, W - 6, 6):
        c.px(x, 21, SOFA_DK)
    # 담요 (버건디, 등받이 오른쪽에 걸침)
    c.rect(W - 22, 12, 12, 12, "#6f3a40")
    c.rect(W - 21, 11, 10, 12, BURG)
    for y in range(13, 22, 3):
        c.hline(W - 20, W - 13, y, "#a86a6b")
    for x in range(W - 21, W - 11, 2):
        c.px(x, 23, "#dcae94")
    # 다리 · 그림자
    c.rect(3, 28, 3, 2, "#3f2d22")
    c.rect(W - 6, 28, 3, 2, "#3f2d22")
    c.rect(2, 29, W - 4, 2, "#00000030")
    return c


def low_table_study():
    """낮은 테이블 2x1: 나무 상판에 책 2권 + 머그."""
    c = canvas(2, 1)
    W = 2 * T
    c.rect(1, 3, W - 2, 8, WOOD_DK)
    c.rect(1, 2, W - 2, 7, WOOD_LT)
    c.hline(2, W - 3, 2, WOOD_HI)
    c.hline(1, W - 2, 9, WOOD)
    c.rect(1, 10, W - 2, 2, WOOD_DK)
    for lx in (2, W - 4):
        c.rect(lx, 12, 2, 3, "#3f2d22")
    c.rect(3, 15, W - 6, 1, "#00000030")
    # 책 2권 (겹침) + 머그
    c.rect(4, 4, 9, 2, "#c96f6f")
    c.rect(5, 2, 9, 2, "#7fa4c4")
    c.px(12, 4, "#f5efe3")
    c.px(13, 2, "#f5efe3")
    c.rect(21, 3, 4, 4, "#f2ece2")
    c.px(25, 4, "#f2ece2")
    c.hline(21, 24, 3, "#8b5e3c")
    c.px(22, 1, "#ffffff70")
    return c


def side_table_small():
    """작은 사이드 테이블 1x1: 둥근 상판 + 기둥 + 받침, 위에 작은 초."""
    c = canvas(1, 1)
    c.ellipse(2, 5, 12, 6, WOOD_DK)
    c.ellipse(2, 4, 12, 5, WOOD_LT)
    c.hline(5, 10, 4, WOOD_HI)
    c.rect(7, 9, 2, 5, WOOD_DK)
    c.rect(4, 14, 8, 2, WOOD_DK)
    c.hline(5, 10, 14, WOOD)
    c.rect(6, 2, 4, 4, "#f2ece2")
    c.hline(6, 9, 2, "#e4dccb")
    c.px(7, 1, "#ffb85c")
    c.px(8, 0, "#ffe6b3")
    return c


# ── 벽 쪽 가구 ───────────────────────────────────────────────────────
def whiteboard_small():
    """작은 화이트보드 2x2 (이젤): 판 + 마커 자국(할 일 줄) + 마커 받침 + 다리."""
    c = canvas(2, 2)
    W = 2 * T
    c.rect(2, 1, W - 4, 19, BOARD_FRAME)
    c.rect(3, 2, W - 6, 17, BOARD)
    c.hline(3, W - 4, 2, "#ffffff")
    # 마커 자국: 제목 줄 + 체크 목록 3줄
    c.hline(6, 15, 5, "#5b7fb4")
    c.hline(6, 12, 6, "#5b7fb4")
    for i, (col, ln) in enumerate((("#d9655f", 10), ("#5b7fb4", 8), ("#7fa585", 12))):
        y = 9 + i * 3
        c.rect(6, y, 2, 2, "#b9b6b3")
        c.hline(9, 9 + ln, y, col)
    c.px(7, 9, "#7fa585")
    c.px(6, 10, "#7fa585")
    # 마커 받침 + 마커 2
    c.rect(3, 19, W - 6, 2, "#6b686f")
    c.rect(8, 18, 4, 1, "#d9655f")
    c.rect(14, 18, 4, 1, "#5b7fb4")
    # 이젤 다리
    for lx in (4, W - 6):
        c.rect(lx, 21, 2, 9, "#6b686f")
        c.rect(lx - 1, 29, 4, 2, "#4a4752")
    c.hline(6, W - 7, 25, "#6b686f")
    c.rect(4, 31, W - 8, 1, "#00000030")
    return c


def bookcase_2tier():
    """2단 책장 2x2: 두 칸에 책, 위에 상자 + 작은 화분."""
    c = canvas(2, 2)
    W, H = 2 * T, 2 * T
    c.rect(0, 6, W, H - 7, WOOD_DK)
    c.hline(0, W - 1, 6, WOOD)
    c.rect(1, 8, W - 2, 21, "#4a3327")
    k = 1
    for sy in (18, 29):
        c.hline(1, W - 2, sy, WOOD)
        x = 2
        while x < W - 3:
            bw = 2 if k % 3 else 3
            hh = 7 if k % 2 else 8
            c.rect(x, sy - hh, bw, hh, _SPINES[k % len(_SPINES)])
            c.px(x, sy - hh + 1, "#ffffff40")
            x += bw + (1 if k % 4 == 0 else 0)
            k += 1
    c.rect(1, H - 2, W - 2, 1, "#2f2016")
    c.rect(19, 1, 9, 5, "#c9a98b")
    c.frame(19, 1, 9, 5, "#a08466")
    c.hline(20, 26, 3, "#a08466")
    deco(c, "plant", 3, -1)
    return c


def mini_fridge():
    """미니 냉장고 1x2 (위 칸은 top 레이어): 크림색 몸체 + 손잡이 + 자석, 위에 작은 화분."""
    c = canvas(1, 2)
    c.rect(2, 9, 12, 22, FRIDGE_DK)
    c.rect(3, 10, 10, 20, FRIDGE)
    c.hline(3, 12, 10, FRIDGE_HI)
    c.vline(3, 11, 28, FRIDGE_HI)
    c.hline(3, 12, 17, FRIDGE_DK)
    c.vline(11, 12, 15, METAL_DK)
    c.vline(11, 19, 26, METAL_DK)
    c.px(5, 13, "#d9655f")
    c.px(7, 13, "#7fa585")
    c.rect(5, 21, 3, 2, "#9fc6ea")
    c.rect(3, 30, 2, 1, INK)
    c.rect(11, 30, 2, 1, INK)
    c.rect(2, 31, 12, 1, "#00000030")
    deco(c, "plant", 5, 2)
    return c


# ── 바닥 소품 ────────────────────────────────────────────────────────
def cushion_floor(kind=0):
    """바닥 쿠션 1x1 (통과 가능). kind 0: 세이지, 1: 테라코타."""
    c = canvas(1, 1)
    dk, mid, hi = (CUSHION_DK, CUSHION, CUSHION_HI) if kind == 0 else (TERRA_DK, TERRA, TERRA_HI)
    c.rect(3, 4, 11, 9, dk)
    c.rect(2, 3, 11, 9, mid)
    for cx, cy in ((2, 3), (12, 3), (2, 11), (12, 11)):  # 모서리 둥글게 (알파 0 은 px() 가 무시하니 직접)
        c.px_[cx, cy] = (0, 0, 0, 0)
    c.hline(4, 9, 4, hi)
    c.px(4, 5, hi)
    c.px(7, 7, dk)
    c.px(8, 7, dk)
    c.hline(4, 12, 13, "#00000030")
    return c
