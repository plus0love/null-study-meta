"""새 목업(design/studyroom.png) 전용 대형 소품. props.py 의 팔레트/도우미를 재사용한다."""
import random

from pixel import Canvas, text_width
from props import (AMBER, AMBER_HALO, AMBER_HI, CREAM, GLASS, GLASS_FRAME, GLASS_FRAME_HI, GLASS_HI, INK, LEAF, LEAF_HI,
                   LEAF_LT, POT, POT_HI, T, WALL, WALL_DK, WALL_LT, WOOD, WOOD_DK, _neon_text, _SPINES, canvas, deco,
                   wall_face, wall_face_block, wall_top)

DARK_PANEL = "#26232b"
PANEL_FRAME = "#3d3944"
CREAM_BOARD = "#ece2d2"
SOFA = "#e9d3b0"
SOFA_DK = "#cdb48c"
SOFA_HI = "#f4e4c8"
CUSHION = "#4f6a45"
CUSHION_DK = "#3b5234"
CUSHION_HI = "#6b8a5e"
MONITOR = "#2c2f3a"
SCREEN = "#7fb0a6"
PAVER = "#7c757f"
PAVER_LINE = "#6a636e"
PAVER_HI = "#8a838e"
FACADE = "#5b5964"
FACADE_DK = "#4b4953"
HEDGE = "#2f4a2d"
HEDGE_LT = "#3f6039"
HEDGE_HI = "#587a4d"


def _script_text(c, cx, y, s, col, scale=1):
    """칠판 손글씨 느낌: 본문 + 오른쪽 아래 1px 그림자."""
    w = text_width(s, scale)
    x = cx - w // 2
    c.text(x + 1, y + 1, s, "#00000040", scale)
    c.text(x, y, s, col, scale)


# ── 상단 좌: 대형 칠판 / 프린터 수납장 ─────────────────────────────────
def chalkboard_big(w=7, h=6):
    c = canvas(w, h)
    c.blit(wall_face_block(w, 2), 0, 0)
    W, H = w * T, h * T
    c.rect(2, 0, W - 4, H - 2, "#3a3438")
    c.rect(4, 2, W - 8, H - 6, "#2e2a30")
    c.frame(4, 2, W - 8, H - 6, "#4a4448")
    lines = ["GOOD", "STUDY", "BETTER", "TOMORROW"]
    y = 12
    for s in lines:
        _script_text(c, W // 2, y, s, "#e8dcc4", 2)
        y += 15
    c.text_center(W // 2 + 30, y + 1, "*", "#d9a98f")
    # 위쪽 조명 갓
    c.rect(W // 2 - 6, 0, 12, 2, WALL_LT)
    c.rect(W // 2 - 4, 2, 8, 1, AMBER_HI)
    # 조명 빛 번짐
    for i in range(4):
        c.hline(W // 2 - 10 - i * 3, W // 2 + 10 + i * 3, 3 + i, "#ffd48a%02x" % (40 - i * 8))
    return c


def cabinet_printer(w=7, h=2):
    c = canvas(w, h)
    W, H = w * T, h * T
    # 상판 + 서랍장
    c.rect(0, 4, W, H - 4, "#5a3f2f")
    c.rect(0, 4, W, 3, "#7c5a44")
    c.hline(0, W - 1, 4, "#956f55")
    for i in range(w):
        c.rect(i * T + 2, 9, T - 4, 9, "#4a3327")
        c.frame(i * T + 2, 9, T - 4, 9, "#6b4c36")
        c.px(i * T + 8, 13, "#d8b58f")
    c.rect(0, H - 3, W, 3, "#3f2d22")
    # 프린터
    c.rect(4, 0, 22, 8, "#e9e4dc")
    c.rect(6, 0, 18, 2, "#d3cec6")
    c.rect(8, 3, 14, 2, "#5a5660")
    c.rect(10, 6, 10, 2, "#f6f2ea")
    c.px(22, 4, "#7fd0a0")
    # 소품: 작은 화분, 꽃, 책
    deco(c, "plant", 40, 0)
    deco(c, "books", 60, 0)
    c.rect(86, 1, 8, 6, "#f6f2ea")
    for dx, dy in ((87, 0), (90, -1), (93, 0)):
        c.px(dx, dy + 1, "#fff5d6")
        c.px(dx + 1, dy + 1, "#f2c6b8")
    deco(c, "cup", 76, 2)
    return c


# ── 창문 (4타일 높이) ─────────────────────────────────────────────────
_SKY = ["#161c33", "#1a2140", "#1f2a4d", "#25335a", "#2c3d66", "#344871", "#3e547d", "#4a6189"]


def window_tall(kind, lamp=False, frame_b=False, seed=0):
    """kind: 'l' | 'm' | 'r'. 64px(4타일) 높이 창문. 하단 8px 는 창턱."""
    rnd = random.Random(seed)
    c = canvas(1, 4)
    H = 64
    for y in range(H):
        idx = min(len(_SKY) - 1, int((y / 56) * len(_SKY)))
        c.hline(0, 15, y, _SKY[idx])
    for _ in range(4):
        c.px(rnd.randint(1, 14), rnd.randint(3, 20), "#dfe6f5")
    # 먼 건물 + 가까운 건물
    base = 55
    lit_a, lit_b = [], []
    x = 0
    while x < 16:
        w = rnd.choice([2, 3, 3, 4])
        h = rnd.randint(10, 26)
        c.rect(x, base - h, w, h, "#10142a")
        c.hline(x, x + w - 1, base - h, "#1a1f38")
        for yy in range(base - h + 2, base - 1, 2):
            for xx in range(x, x + w, 2):
                r = rnd.random()
                if r < 0.35:
                    lit_a.append((xx, yy))
                elif r < 0.55:
                    lit_b.append((xx, yy))
        x += w
    lit = lit_a + (lit_b if frame_b else [])
    if frame_b:
        lit = [p for p in lit if (p[0] * 7 + p[1] * 3) % 4 != 0]
    for lx, ly in lit:
        c.px(lx, ly, rnd.choice(["#f4d98c", "#ffe7a8", "#f7c56f"]))
    # 창틀 격자
    c.rect(0, 0, 16, 2, GLASS_FRAME)
    c.vline(0, 0, 55, GLASS_FRAME_HI)
    c.hline(0, 15, 24, GLASS_FRAME)
    c.hline(0, 15, 40, "#1c1a22")
    c.rect(0, 56, 16, 8, "#4a3b33")
    c.hline(0, 15, 56, "#6a5749")
    c.hline(0, 15, 63, "#2f2620")
    if kind == "l":
        c.rect(0, 0, 3, 56, GLASS_FRAME)
    if kind == "r":
        c.rect(13, 0, 3, 56, GLASS_FRAME)
    for i in range(4):
        c.px(4 + i, 6 + i, "#ffffff22")
        c.px(10 + i, 30 + i, "#ffffff1c")
    if lamp:
        c.vline(8, 2, 14, "#1f1d23")
        c.rect(5, 15, 7, 3, WALL)
        c.rect(4, 18, 9, 1, "#2f2c35")
        c.rect(6, 19, 5, 3, "#ffe9b0")
        c.rect(7, 22, 3, 1, "#ffd98a")
        for i in range(3):
            c.hline(4 - i, 12 + i, 23 + i, "#ffd48a%02x" % (48 - i * 12))
    return c


# ── 라운지 ────────────────────────────────────────────────────────────
def sofa_wide(w=8, h=2):
    c = canvas(w, h)
    W, H = w * T, h * T
    # 등받이
    c.rect(2, 4, W - 4, 10, SOFA_DK)
    c.rect(2, 3, W - 4, 9, SOFA)
    c.hline(3, W - 4, 3, SOFA_HI)
    # 팔걸이
    for ax in (0, W - 10):
        c.rect(ax, 8, 10, H - 12, SOFA_DK)
        c.rect(ax + 1, 7, 8, H - 12, SOFA)
        c.hline(ax + 2, ax + 7, 7, SOFA_HI)
    # 좌석 쿠션
    seat_w = (W - 22) // 3
    for i in range(3):
        sx = 11 + i * seat_w
        c.rect(sx, 13, seat_w - 1, H - 18, SOFA)
        c.frame(sx, 13, seat_w - 1, H - 18, SOFA_DK)
        c.hline(sx + 1, sx + seat_w - 3, 14, SOFA_HI)
    # 초록 쿠션 두 개
    for cx in (16, W - 32):
        c.rect(cx, 5, 16, 11, CUSHION_DK)
        c.rect(cx + 1, 4, 14, 11, CUSHION)
        c.rect(cx + 3, 6, 6, 4, CUSHION_HI)
        c.px(cx + 7, 9, CUSHION_DK)
    # 그림자
    c.rect(2, H - 4, W - 4, 2, "#00000030")
    return c


def round_table(w=3, h=2):
    c = canvas(w, h)
    W, H = w * T, h * T
    c.ellipse(2, 5, W - 4, H - 6, "#2f2016")
    c.ellipse(2, 3, W - 4, H - 7, "#5a4232")
    c.ellipse(5, 5, W - 10, H - 12, "#6b5040")
    c.ellipse(8, 6, W - 16, H - 15, "#7c5f4c")
    deco(c, "plant", 12, 5)
    # 파란 책
    c.rect(26, 9, 8, 6, "#5b7fb0")
    c.rect(27, 10, 6, 4, "#7fa4c4")
    c.px(28, 11, "#e8eef7")
    return c


def dog():
    c = canvas(1, 1)
    body, dark, light = "#c58a4f", "#9c6a3a", "#dba876"
    c.ellipse(3, 7, 10, 7, body)
    c.ellipse(1, 3, 8, 7, body)
    c.rect(0, 4, 3, 4, dark)      # 귀
    c.px(3, 6, INK)
    c.px(4, 6, INK)
    c.px(1, 7, INK)               # 코
    c.px(5, 4, light)
    c.px(6, 8, light)
    c.rect(12, 6, 2, 3, body)     # 꼬리
    c.rect(4, 13, 2, 2, dark)
    c.rect(9, 13, 2, 2, dark)
    return c


# ── 세로 보드 / 유리 패널 ──────────────────────────────────────────────
def board_focus_tall(w=4, h=6):
    c = canvas(w, h)
    c.blit(wall_face_block(w, 2), 0, 0)
    W, H = w * T, h * T
    c.rect(1, 0, W - 2, H - 2, "#2b282f")
    c.rect(2, 1, W - 4, H - 4, DARK_PANEL)
    c.frame(2, 1, W - 4, H - 4, PANEL_FRAME)
    y = 12
    for s in ("FOCUS", "PLAN", "STUDY", "GROW"):
        c.text_center(W // 2, y, s, "#f1e6d2", 2)
        y += 15
    c.hline(W // 2 - 8, W // 2 + 8, y + 2, AMBER)
    return c


def music_panel(w=4, h=8):
    c = canvas(w, h)
    c.blit(wall_face_block(w, 2), 0, 0)
    W, H = w * T, h * T
    c.rect(1, 0, W - 2, H - 2, "#2b282f")
    c.rect(2, 1, W - 4, H - 4, "#1f1c24")
    c.frame(2, 1, W - 4, H - 4, PANEL_FRAME)
    # 유리 반사 (대각선)
    for i in range(0, H - 8, 2):
        c.px(4 + (i // 2) % (W - 10), 3 + i, "#ffffff14")
    for i in range(8):
        c.px(W - 8 + i // 2, 4 + i, "#ffffff22")
    # 상단 조명 번짐
    for i in range(6):
        c.hline(W // 2 - 4 - i * 2, W // 2 + 4 + i * 2, 2 + i, "#ffd48a%02x" % (46 - i * 7))
    y = H // 2 - 22
    for s in ("MUSIC", "ALWAYS", "HELPS"):
        c.text_center(W // 2, y, s, "#efe6d6", 1)
        y += 8
    # 헤드폰 아이콘
    hx, hy = W // 2, y + 6
    c.hline(hx - 5, hx + 5, hy, "#efe6d6")
    c.px(hx - 6, hy + 1, "#efe6d6")
    c.px(hx + 6, hy + 1, "#efe6d6")
    c.rect(hx - 7, hy + 2, 3, 4, "#efe6d6")
    c.rect(hx + 5, hy + 2, 3, 4, "#efe6d6")
    return c


# ── 큰 책장 ───────────────────────────────────────────────────────────
def bookshelf_big(w=7, h=5, seed=5):
    rnd = random.Random(seed)
    c = canvas(w, h)
    c.blit(wall_face_block(w, 2), 0, 0)
    W, H = w * T, h * T
    c.rect(0, 0, W, H, WOOD_DK)
    c.rect(1, 1, W - 2, H - 3, "#4a3327")
    c.rect(0, H - 2, W, 2, "#3f2d22")
    c.vline(W // 2, 1, H - 3, WOOD_DK)
    rows = [1, 20, 39, 58]
    for ri, sy in enumerate(rows):
        bottom = sy + 17
        c.hline(1, W - 2, bottom + 1, WOOD)
        for half in (0, 1):
            x0 = 2 + half * (W // 2)
            x1 = x0 + W // 2 - 4
            if ri == 0 and half == 0:
                # 액자 두 개
                for fx in (x0 + 6, x0 + 28):
                    c.rect(fx, sy + 3, 14, 12, "#a08466")
                    c.rect(fx + 2, sy + 5, 10, 8, "#d9c2a0")
                    c.rect(fx + 4, sy + 8, 6, 3, "#8fa585")
                deco(c, "plant", x0 + 46, sy + 8)
                continue
            if ri == 0 and half == 1:
                c.rect(x0 + 8, sy + 3, 16, 13, "#a08466")
                c.rect(x0 + 10, sy + 5, 12, 9, "#e6d9bf")
                c.rect(x0 + 12, sy + 8, 8, 4, "#d9977a")
                deco(c, "books", x0 + 30, sy + 10)
                continue
            x = x0
            while x < x1:
                if rnd.random() < 0.1:
                    x += 3
                    continue
                bw = rnd.choice([2, 2, 3, 3])
                bh = rnd.choice([9, 10, 11, 12])
                col = rnd.choice(_SPINES)
                c.rect(x, bottom - bh + 1, bw, bh, col)
                c.px(x, bottom - bh + 3, "#ffffff40")
                x += bw
        # 선반 조명
        for lx in (W // 4, 3 * W // 4):
            c.hline(lx - 6, lx + 6, sy + 1, "#ffd48a50")
            c.hline(lx - 4, lx + 4, sy + 2, "#ffd48a30")
    deco(c, "plant", 3, 30)
    deco(c, "plant", W - 9, 49)
    return c


# ── 카페 코너 ─────────────────────────────────────────────────────────
def menu_board_cream(w=4, h=3):
    c = canvas(w, h)
    W, H = w * T, h * T
    c.rect(1, 1, W - 2, H - 2, "#3d3944")
    c.rect(3, 3, W - 6, H - 6, CREAM_BOARD)
    y = 6
    for s in ("COFFEE", "FOR A", "SHARPER", "YOU"):
        c.text(7, y, s, "#3b3540")
        y += 7
    # 커피잔 아이콘
    cx, cy = W - 16, H - 14
    c.rect(cx, cy + 2, 8, 6, "#3b3540")
    c.rect(cx + 8, cy + 3, 2, 3, "#3b3540")
    c.rect(cx + 1, cy + 3, 6, 4, CREAM_BOARD)
    c.px(cx + 2, cy, "#3b3540")
    c.px(cx + 5, cy, "#3b3540")
    # 다리
    c.rect(4, H - 2, 2, 2, "#3d3944")
    c.rect(W - 6, H - 2, 2, 2, "#3d3944")
    return c


def display_case(w=4, h=2):
    c = canvas(w, h)
    W, H = w * T, h * T
    c.rect(0, 0, W, H - 2, "#2f2c35")
    c.rect(0, 0, W, 3, "#e2d8c8")
    c.hline(0, W - 1, 0, "#efe8db")
    c.rect(2, 5, W - 4, H - 10, "#3a3f4c")
    c.frame(2, 5, W - 4, H - 10, "#55515c")
    for i in range(3):
        x = 5 + i * 18
        c.rect(x, 8, 8, 5, ["#e6c78f", "#d9977a", "#f2ece2"][i])
        c.rect(x, 16, 8, 4, ["#a08bc4", "#e6c78f", "#8fa585"][i])
    for i in range(5):
        c.px(4 + i, 6 + i, "#ffffff30")
    c.rect(0, H - 2, W, 2, "#1f1d23")
    return c


def shelf_narrow(h=2, seed=0):
    """폭 1타일 좁은 책장 (벽 쪽)."""
    rnd = random.Random(seed)
    c = canvas(1, h)
    H = h * T
    c.rect(0, 0, 16, H, WOOD_DK)
    c.rect(1, 1, 14, H - 3, "#4a3327")
    for sy in range(8, H - 2, 8):
        c.hline(1, 14, sy, WOOD)
        x = 2
        while x < 13:
            bw = rnd.choice([2, 3])
            c.rect(x, sy - rnd.choice([5, 6]), bw, 6, rnd.choice(_SPINES))
            x += bw + (1 if rnd.random() < 0.3 else 0)
    deco(c, "plant", 5, 0)
    return c


def ladder_shelf(h=3):
    c = canvas(1, h)
    H = h * T
    c.rect(1, 0, 2, H - 1, WOOD)
    c.rect(13, 0, 2, H - 1, WOOD)
    for i, sy in enumerate(range(6, H, 10)):
        c.rect(1, sy, 14, 2, WOOD)
        for k, col in enumerate(["#c96f6f", "#7fa4c4", "#e0c67b", "#8fa585"][: 3 + i % 2]):
            c.rect(3 + k * 3, sy - 5, 2, 5, col)
    deco(c, "plant", 5, H - 10)
    return c


# ── 스터디룸 안 ───────────────────────────────────────────────────────
def desk_monitor(w=3):
    c = canvas(w, 1)
    W = w * T
    c.rect(0, 1, W, 12, "#efe6d6")
    c.hline(0, W - 1, 1, "#f8f2e6")
    c.rect(0, 13, W, 3, "#5a5660")
    c.hline(0, W - 1, 0, "#b9b6b3")
    # 모니터
    mx = W // 2 - 8
    c.rect(mx, 1, 16, 8, MONITOR)
    c.rect(mx + 1, 2, 14, 6, SCREEN)
    c.rect(mx + 2, 3, 6, 1, "#b5dcd3")
    c.rect(mx + 7, 9, 2, 2, MONITOR)
    c.rect(mx + 5, 11, 6, 1, MONITOR)
    # 키보드, 마우스, 램프, 화분
    c.rect(mx + 2, 12, 12, 1, "#b9b6b3")
    c.rect(mx + 15, 12, 2, 1, "#b9b6b3")
    deco(c, "lamp", 3, 2)
    deco(c, "plant", W - 9, 4)
    deco(c, "cup", W - 13, 8)
    return c


def nightstand():
    c = canvas(1, 1)
    c.rect(1, 2, 14, 12, "#4a3327")
    c.rect(1, 2, 14, 3, "#6b4c36")
    c.hline(1, 14, 2, "#8a6a52")
    c.rect(3, 7, 10, 3, "#3f2d22")
    c.rect(3, 11, 10, 2, "#3f2d22")
    c.px(8, 8, "#d8b58f")
    c.px(8, 11, "#d8b58f")
    deco(c, "books", 4, 0)
    return c


def study_panel(label, w=3, h=4, light_side="r"):
    c = canvas(w, h)
    W, H = w * T, h * T
    c.rect(0, 0, W, H, "#2b282f")
    c.rect(1, 1, W - 2, H - 2, DARK_PANEL)
    c.frame(1, 1, W - 2, H - 2, PANEL_FRAME)
    # 플라크
    c.rect(4, 8, W - 8, 12, "#1c1a21")
    c.frame(4, 8, W - 8, 12, "#3d3944")
    c.text_center(W // 2, 11, label, "#efe6d6")
    # 세로 앰버 라인 (문 쪽)
    lx = W - 3 if light_side == "r" else 2
    c.vline(lx, H // 2, H - 6, AMBER)
    c.vline(lx + (-1 if light_side == "r" else 1), H // 2 + 2, H - 8, AMBER_HALO)
    return c


def glass_door_wide(side):
    """2타일짜리 미닫이 유리문의 한쪽. side='l' 은 열린 문짝, 'r' 은 통로."""
    c = canvas(1, 1)
    if side == "l":
        c.rect(0, 5, 16, 6, GLASS_FRAME)
        c.rect(1, 6, 14, 4, GLASS)
        c.hline(2, 13, 6, GLASS_HI)
        c.px(12, 8, AMBER)
    else:
        c.rect(0, 5, 2, 6, GLASS_FRAME)
        c.rect(14, 5, 2, 6, GLASS_FRAME)
    c.hline(1, 14, 12, AMBER_HALO)
    c.hline(2, 13, 13, "#7a4f2c60")
    return c


def rug_pattern(w, h, base="#e3d3b3", border="#cbb28b", accent="#d3bd97"):
    c = canvas(w, h)
    W, H = w * T, h * T
    c.rect(0, 0, W, H, base)
    c.frame(0, 0, W, H, border)
    c.frame(2, 2, W - 4, H - 4, accent)
    for y in range(5, H - 5, 4):
        for x in range(5 + (y // 4 % 2) * 2, W - 5, 4):
            c.px(x, y, accent)
    return c


# ── 회의 테이블 (세로) ────────────────────────────────────────────────
def big_table_v(w=4, h=6):
    c = canvas(w, h)
    W, H = w * T, h * T
    c.rect(1, 1, W - 2, H - 5, "#8a6446")
    c.frame(1, 1, W - 2, H - 5, "#a07a5c")
    c.hline(2, W - 3, 2, "#a8825f")
    c.rect(1, H - 4, W - 2, 3, "#5a3f2f")
    c.hline(1, W - 2, H - 4, "#6b4c36")
    deco(c, "books", 10, 8)
    deco(c, "cup", 40, 10)
    deco(c, "plant", 28, 22)
    deco(c, "paper", 12, 30)
    deco(c, "pencil", 19, 31)
    deco(c, "plant", 28, 44)
    deco(c, "laptop", 12, 62)
    deco(c, "cup", 44, 60)
    deco(c, "cup", 44, 68)
    deco(c, "paper", 42, 24)
    return c


def whiteboard_big(w=5, h=3):
    c = canvas(w, h)
    W, H = w * T, h * T
    c.rect(0, 0, W, H - 3, "#8d8a90")
    c.rect(2, 2, W - 4, H - 7, "#f1e9da")
    c.hline(2, W - 3, H - 5, "#b9b6b3")
    c.text_center(W // 2 - 4, 10, "SMALL STEPS", "#4a5568")
    c.text_center(W // 2 - 4, 19, "BIG CHANGES", "#4a5568")
    c.text_center(W // 2 - 4, 28, ":)", "#4a5568")
    for i, col in enumerate(("#f7d774", "#f4a9b8", "#9fd0c1", "#f7d774")):
        c.rect(5 + (i % 2) * 6, 6 + (i // 2) * 7, 5, 5, col)
    c.rect(W - 10, 20, 5, 5, "#9fd0c1")
    c.rect(4, H - 3, 3, 3, "#6b686f")
    c.rect(W - 7, H - 3, 3, 3, "#6b686f")
    return c


# ── 입구 / 실외 ───────────────────────────────────────────────────────
def entrance_wide(w=10, h=2):
    c = canvas(w, h)
    W, H = w * T, h * T
    for i in range(w):
        c.blit(wall_top(), i * T, 0)
        c.blit(wall_top(), i * T, T)
    # 기둥 + 랜턴
    for px_ in (0, W - T):
        c.rect(px_ + 2, 0, 12, H, "#2f2c35")
        c.frame(px_ + 2, 0, 12, H, "#454250")
        c.rect(px_ + 5, 4, 6, 8, "#1f1d23")
        c.rect(px_ + 6, 5, 4, 5, "#ffd98a")
        c.rect(px_ + 7, 6, 2, 2, "#fff3d0")
        c.rect(px_ + 4, 12, 8, 1, "#454250")
    # 유리 이중문
    c.rect(T, 0, W - 2 * T, H, GLASS_FRAME)
    c.rect(T + 2, 2, W - 2 * T - 4, H - 4, "#8fb3c2")
    mid = W // 2
    c.rect(mid - 1, 2, 2, H - 4, GLASS_FRAME)
    c.rect(T + 2 + (W - 2 * T - 4) // 2 - 2, 2, 1, H - 4, GLASS_FRAME_HI)
    for i in range(10):
        c.px(T + 6 + i, 4 + i, "#ffffff40")
        c.px(mid + 8 + i, 6 + i, "#ffffff30")
    c.hline(T + 4, mid - 3, H // 2, AMBER_HALO)
    c.hline(mid + 2, W - T - 5, H // 2, AMBER_HALO)
    c.rect(mid - 5, H // 2 + 3, 3, 1, AMBER)
    c.rect(mid + 2, H // 2 + 3, 3, 1, AMBER)
    return c


def doormat_big(w=7, h=3):
    c = canvas(w, h)
    W, H = w * T, h * T
    c.rect(1, 1, W - 2, H - 2, "#6b4a3a")
    c.frame(1, 1, W - 2, H - 2, "#a08466")
    c.frame(3, 3, W - 6, H - 6, "#8a6d50")
    c.text_center(W // 2, 8, "WELCOME", "#e4d3b4")
    c.text_center(W // 2, 16, "TO", "#e4d3b4")
    c.text_center(W // 2, 24, "OUR STUDY ROOM", "#e4d3b4")
    c.text_center(W // 2, 34, "*", "#e4d3b4")
    return c


def bollard():
    c = canvas(1, 2)
    c.rect(6, 3, 4, 4, "#1f1d23")
    c.rect(5, 7, 6, 7, "#1f1d23")
    c.rect(6, 8, 4, 5, "#ffd98a")
    c.rect(7, 9, 2, 2, "#fff3d0")
    c.rect(7, 14, 2, 14, "#2f2c35")
    c.rect(5, 28, 6, 3, "#1f1d23")
    for i in range(3):
        c.hline(3 - i, 12 + i, 15 + i, "#ffd48a%02x" % (40 - i * 12))
    return c


def hedge(seed=0):
    rnd = random.Random(seed)
    c = canvas(1, 1, HEDGE)
    for _ in range(14):
        x, y = rnd.randint(0, 15), rnd.randint(0, 15)
        c.px(x, y, HEDGE_LT)
    for _ in range(6):
        c.px(rnd.randint(0, 15), rnd.randint(0, 12), HEDGE_HI)
    c.hline(0, 15, 15, "#22361f")
    return c


def hedge_flower(seed=0):
    c = hedge(seed)
    rnd = random.Random(seed + 7)
    for _ in range(3):
        c.px(rnd.randint(1, 14), rnd.randint(1, 12), rnd.choice(["#f2c6b8", "#fff5d6", "#f4a9b8"]))
    return c


def bench(w=5, h=2):
    c = canvas(w, h)
    W, H = w * T, h * T
    # 등받이
    c.rect(2, 2, W - 4, 4, "#8a5f3a")
    c.rect(2, 7, W - 4, 4, "#8a5f3a")
    c.hline(2, W - 3, 2, "#a8825f")
    c.hline(2, W - 3, 7, "#a8825f")
    # 좌판
    c.rect(2, 13, W - 4, 4, "#7c5a44")
    c.rect(2, 18, W - 4, 4, "#7c5a44")
    c.hline(2, W - 3, 13, "#956f55")
    c.hline(2, W - 3, 18, "#956f55")
    # 철제 다리
    for lx in (3, W - 6):
        c.rect(lx, 6, 3, 2, "#2f2c35")
        c.rect(lx, 11, 3, 2, "#2f2c35")
        c.rect(lx, 22, 3, 8, "#2f2c35")
    return c


def sign_outdoor(lines, arrow=None, w=3, h=5):
    c = canvas(w, h)
    W, H = w * T, h * T
    c.rect(1, 0, W - 2, H - 2, "#2b282f")
    c.rect(3, 2, W - 6, H - 6, DARK_PANEL)
    c.frame(3, 2, W - 6, H - 6, PANEL_FRAME)
    y = 8
    for s in lines:
        c.text_center(W // 2, y, s, "#efe6d6")
        y += 8
    if arrow == "heart":
        c.text_center(W // 2, y + 2, "*", "#efe6d6")
    elif arrow == "right":
        c.hline(W // 2 - 4, W // 2 + 3, y + 4, "#efe6d6")
        c.px(W // 2 + 2, y + 3, "#efe6d6")
        c.px(W // 2 + 2, y + 5, "#efe6d6")
    c.rect(0, H - 2, W, 2, FACADE_DK)
    return c


def facade():
    c = canvas(1, 1, FACADE)
    c.vline(7, 0, 15, FACADE_DK)
    c.hline(0, 15, 7, FACADE_DK)
    return c


def paver(variant=0):
    c = canvas(1, 1, PAVER)
    c.hline(0, 15, 7, PAVER_LINE)
    c.hline(0, 15, 15, PAVER_LINE)
    c.vline(7 if variant == 0 else 3, 0, 6, PAVER_LINE)
    c.vline(3 if variant == 0 else 11, 8, 14, PAVER_LINE)
    c.px(2, 2, PAVER_HI)
    c.px(10, 10, PAVER_HI)
    return c


def kerb():
    c = canvas(1, 1, "#5a5560")
    c.rect(0, 0, 16, 4, "#8a838e")
    c.hline(0, 15, 4, "#3f3b45")
    c.hline(0, 15, 10, "#4f4a56")
    return c


def grass_strip(seed=0):
    rnd = random.Random(seed)
    c = canvas(1, 1, "#2a3f28")
    for _ in range(10):
        c.px(rnd.randint(0, 15), rnd.randint(0, 15), "#3a5636")
    for _ in range(2):
        c.px(rnd.randint(0, 15), rnd.randint(0, 15), rnd.choice(["#f2c6b8", "#fff5d6"]))
    return c


def pouf(color, dark, hi):
    c = canvas(1, 1)
    c.ellipse(1, 3, 14, 12, dark)
    c.ellipse(1, 2, 14, 11, color)
    c.ellipse(4, 4, 6, 3, hi)
    c.hline(4, 11, 8, dark)
    c.vline(8, 4, 12, dark)
    return c


def side_table_round():
    c = canvas(2, 2)
    c.ellipse(3, 7, 26, 18, "#2f2016")
    c.ellipse(3, 5, 26, 17, "#5a4232")
    c.ellipse(6, 7, 20, 12, "#6b5040")
    deco(c, "plant", 8, 8)
    c.rect(18, 12, 6, 7, "#f5efe3")
    c.rect(19, 13, 4, 2, "#7fa4c4")
    c.rect(19, 16, 4, 1, "#c96f6f")
    return c


def wall_spot():
    """벽 위쪽의 작은 스팟 조명 (wall_face 배경 포함, 1x2)."""
    c = canvas(1, 2)
    c.blit(wall_face_block(1, 2), 0, 0)
    c.rect(5, 1, 6, 3, "#1f1d23")
    c.rect(6, 4, 4, 2, "#ffe9b0")
    c.px(7, 6, "#ffd98a")
    c.px(8, 6, "#ffd98a")
    for i in range(6):
        c.hline(7 - i, 8 + i, 7 + i, "#ffd48a%02x" % (56 - i * 9))
    return c
