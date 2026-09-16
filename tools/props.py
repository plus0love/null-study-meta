"""팩에 없는 소품을 16px 논리 해상도로 직접 그리는 함수 모음.

색은 Kenney 리컬러 결과(recolor.PALETTE)와 목업(design/studyroom.png)에서 뽑은
따뜻한 파스텔 팔레트만 쓴다. 모든 함수는 Canvas(w*16, h*16) 를 돌려준다.
"""
import random

from pixel import FONT, Canvas, text_width

T = 16

# ── 공용 팔레트 ────────────────────────────────────────────────────────
WOOD_DK = "#5e4331"
WOOD = "#7c5a44"
WOOD_LT = "#9a7558"
WOOD_HI = "#b08a6a"
FLOOR = "#98705c"
FLOOR_LINE = "#846150"
FLOOR_HI = "#a07a66"
WALL = "#3a3741"
WALL_DK = "#2b2930"
WALL_LT = "#4a4752"
BASEBOARD = "#57483f"
BASEBOARD_HI = "#6d5a4e"
CREAM = "#eedcbd"
CREAM_DK = "#d9c29d"
CREAM_HI = "#f7ead0"
SAGE = "#8fa585"
SAGE_DK = "#6f8567"
TERRA = "#d9977a"
TERRA_DK = "#b8765c"
AMBER = "#ffb85c"
AMBER_HI = "#ffe6b3"
AMBER_DK = "#c9843a"
AMBER_HALO = "#7a4f2c"
GLASS = "#c9e6f2a8"
GLASS_HI = "#ffffff90"
GLASS_FRAME = "#2b2830"
GLASS_FRAME_HI = "#4d4954"
METAL = "#b8b4bf"
METAL_DK = "#5a5660"
LEAF = "#5f8a5c"
LEAF_LT = "#7fae76"
LEAF_HI = "#9cc691"
POT = "#b57a5f"
POT_HI = "#cc957a"
INK = "#3b3540"


def canvas(w, h, bg=None):
    return Canvas(w * T, h * T, bg)


# ── 바닥 ──────────────────────────────────────────────────────────────
def floor_wood(variant=0):
    """긴 널빤지 마루. 타일 하나가 널빤지 한 줄, 세로 이음새는 변형에 따라 하나 또는 없음."""
    c = canvas(1, 1, FLOOR)
    c.hline(0, 15, 15, FLOOR_LINE)
    c.hline(0, 15, 0, FLOOR_HI)
    seam = {0: None, 1: 4, 2: 11}[variant % 3]
    if seam is not None:
        c.vline(seam, 0, 15, FLOOR_LINE)
        c.vline(seam + 1, 1, 14, FLOOR_HI)
    grain = {0: [(2, 5), (3, 5), (9, 9), (10, 9), (13, 3)], 1: [(7, 6), (8, 6), (13, 11), (1, 12)], 2: [(2, 8), (3, 8), (7, 3), (14, 12), (15, 12)]}[variant % 3]
    for x, y in grain:
        c.px(x, y, "#a37d69")
    return c


def floor_carpet():
    c = canvas(1, 1, "#c9b59c")
    for y in range(0, 16, 4):
        for x in range(0, 16, 4):
            c.px(x + (y // 4 % 2) * 2, y, "#bfaa90")
            c.px(x + (y // 4 % 2) * 2 + 1, y + 1, "#d2bfa6")
    return c


def floor_tile():
    c = canvas(1, 1, "#cdbfae")
    c.rect(8, 0, 8, 8, "#c2b2a0")
    c.rect(0, 8, 8, 8, "#c2b2a0")
    c.hline(0, 15, 0, "#b6a693")
    c.vline(0, 0, 15, "#b6a693")
    c.hline(0, 15, 8, "#b6a693")
    c.vline(8, 0, 15, "#b6a693")
    return c


def floor_outside():
    c = canvas(1, 1, "#2a2732")
    c.hline(0, 15, 0, "#332f3b")
    return c


# ── 벽 ────────────────────────────────────────────────────────────────
def wall_top():
    c = canvas(1, 1, WALL_DK)
    c.hline(0, 15, 0, WALL_LT)
    c.hline(0, 15, 15, "#1f1d23")
    return c


def wall_side(side):
    c = canvas(1, 1, WALL_DK)
    if side == "l":
        c.vline(15, 0, 15, "#1f1d23")
        c.vline(0, 0, 15, WALL_LT)
    else:
        c.vline(0, 0, 15, "#1f1d23")
        c.vline(15, 0, 15, WALL_LT)
    return c


def wall_face(row):
    """상단 벽의 보이는 면. row 0 = 위쪽, row 1 = 아래쪽(걸레받이 포함)."""
    c = canvas(1, 1, WALL)
    for x in (3, 11):
        c.vline(x, 0, 15, "#36333c")
    if row == 0:
        c.hline(0, 15, 0, WALL_DK)
    else:
        c.rect(0, 13, 16, 3, BASEBOARD)
        c.hline(0, 15, 13, BASEBOARD_HI)
    return c


def wall_face_block(w, h=2):
    c = canvas(w, h)
    for i in range(w):
        c.blit(wall_face(0), i * T, 0)
        for r in range(1, h):
            c.blit(wall_face(1), i * T, r * T)
    return c


# ── 창문 (2타일 높이 세로 유닛, 야경) ──────────────────────────────────
_SKY = ["#1b2340", "#1e2848", "#232e53", "#28365f", "#2e3f6b", "#354876", "#3d5282", "#485d8e"]


def _sky_column(seed):
    rnd = random.Random(seed)
    heights = []
    x = 0
    while x < 16:
        w = rnd.choice([2, 3, 3, 4])
        h = rnd.randint(4, 12)
        heights.append((x, w, h))
        x += w
    stars = [(rnd.randint(1, 14), rnd.randint(2, 12)) for _ in range(3)]
    return heights, stars, rnd


def window_unit(kind, lamp=False, frame_b=False, seed=0):
    """kind: 'l' | 'm' | 'r'. 32px 높이. frame_b 는 불빛 깜빡임 두 번째 프레임."""
    c = canvas(1, 2)
    # 하늘 그라데이션 (위 2px 는 창틀)
    for y in range(0, 32):
        idx = min(len(_SKY) - 1, int((y / 32) * len(_SKY)))
        c.hline(0, 15, y, _SKY[idx])
    heights, stars, rnd = _sky_column(seed)
    for sx, sy in stars:
        c.px(sx, sy, "#e6ecf7")
    # 건물 실루엣 (하단)
    base = 28
    lit_a, lit_b = [], []
    for bx, bw, bh in heights:
        c.rect(bx, base - bh, bw, bh, "#141827")
        c.hline(bx, bx + bw - 1, base - bh, "#1d2236")
        for yy in range(base - bh + 2, base - 1, 2):
            for xx in range(bx, bx + bw, 2):
                if rnd.random() < 0.45:
                    (lit_a if rnd.random() < 0.7 else lit_b).append((xx, yy))
                elif rnd.random() < 0.3:
                    lit_b.append((xx, yy))
    lit = lit_a + (lit_b if frame_b else [])
    if frame_b:
        lit = [p for p in lit if (p[0] * 7 + p[1] * 3) % 5 != 0]
    for lx, ly in lit:
        c.px(lx, ly, "#f4d98c")
    # 창틀
    c.rect(0, 0, 16, 2, GLASS_FRAME)
    c.hline(0, 15, 15, GLASS_FRAME)
    c.hline(0, 15, 16, GLASS_FRAME)
    c.rect(0, 28, 16, 4, "#4a3b33")   # 창턱
    c.hline(0, 15, 28, "#6a5749")
    if kind == "l":
        c.rect(0, 0, 2, 32, GLASS_FRAME)
        c.vline(2, 2, 27, GLASS_FRAME_HI)
    if kind == "r":
        c.rect(14, 0, 2, 32, GLASS_FRAME)
        c.vline(13, 2, 27, GLASS_FRAME_HI)
    # 유리 반사
    for i in range(3):
        c.px(4 + i, 5 + i, "#ffffff28")
        c.px(9 + i, 19 + i, "#ffffff22")
    if lamp:
        c.vline(8, 2, 6, "#1f1d23")
        c.rect(6, 7, 5, 2, WALL)
        c.rect(5, 9, 7, 1, "#2f2c35")
        c.rect(7, 10, 3, 2, "#ffe9b0")
        c.px(8, 12, "#ffd98a")
    return c


# ── 책상 / 테이블 ─────────────────────────────────────────────────────
def _desk_base(w, ends=("l", "r")):
    c = canvas(w, 1)
    c.rect(0, 1, w * T, 12, "#8b6a4e")
    c.hline(0, w * T - 1, 1, "#a07d5f")
    c.rect(0, 13, w * T, 3, WOOD_DK)
    c.hline(0, w * T - 1, 13, "#6b4d38")
    c.hline(0, w * T - 1, 0, "#6b4d38")
    if "l" in ends:
        c.vline(0, 0, 15, "#6b4d38")
    if "r" in ends:
        c.vline(w * T - 1, 0, 15, "#6b4d38")
    return c


def deco(c, kind, x, y):
    """테이블 위 소품. (x,y) 는 소품의 좌상단."""
    if kind == "laptop":
        c.rect(x, y, 9, 6, "#3b3f4c")
        c.rect(x + 1, y + 1, 7, 4, "#8fb8d9")
        c.px(x + 2, y + 2, "#c8e2f3")
        c.rect(x, y + 6, 9, 4, "#d6d3d0")
        c.rect(x + 1, y + 7, 7, 1, "#b9b6b3")
        c.rect(x + 3, y + 9, 3, 1, "#b9b6b3")
    elif kind == "lamp":
        c.rect(x + 1, y + 7, 5, 2, INK)
        c.vline(x + 3, y + 3, y + 7, INK)
        c.rect(x, y, 7, 3, "#e9c98a")
        c.hline(x, x + 6, y, "#f3dba6")
        c.hline(x + 1, x + 5, y + 3, "#fff1c8")
    elif kind == "books":
        c.rect(x, y + 4, 7, 2, "#c96f6f")
        c.rect(x + 1, y + 2, 7, 2, "#7fa4c4")
        c.rect(x, y, 6, 2, "#e0c67b")
        c.px(x + 5, y + 4, "#f5efe3")
        c.px(x + 7, y + 2, "#f5efe3")
    elif kind == "plant":
        c.rect(x + 1, y + 4, 4, 3, POT)
        c.hline(x + 1, x + 4, y + 4, POT_HI)
        c.px(x + 2, y + 2, LEAF)
        c.px(x + 3, y + 2, LEAF_LT)
        c.px(x + 1, y + 3, LEAF_LT)
        c.px(x + 4, y + 3, LEAF)
        c.px(x + 2, y + 1, LEAF_HI)
    elif kind == "cup":
        c.rect(x, y, 3, 3, "#f2ece2")
        c.px(x + 3, y + 1, "#f2ece2")
        c.px(x + 1, y, "#8b5e3c")
    elif kind == "paper":
        c.rect(x, y, 5, 6, "#f5efe3")
        c.hline(x + 1, x + 3, y + 1, "#b9b6b3")
        c.hline(x + 1, x + 3, y + 3, "#b9b6b3")
    elif kind == "pencil":
        c.rect(x, y, 1, 5, "#e0c67b")
        c.px(x, y + 5, "#f0b4a4")


def desk(w, decos=()):
    """w 타일짜리 책상. decos = [(kind, x, y), ...] 논리 픽셀 좌표."""
    c = _desk_base(w)
    for kind, x, y in decos:
        deco(c, kind, x, y)
    return c


def desk_seg(kind, decos=()):
    """긴 책상 조각: 'l' | 'm' | 'r'."""
    ends = {"l": ("l",), "m": (), "r": ("r",)}[kind]
    c = _desk_base(1, ends)
    for d, x, y in decos:
        deco(c, d, x, y)
    return c


def big_table(w=5, h=2):
    c = canvas(w, h)
    W, H = w * T, h * T
    c.rect(1, 1, W - 2, H - 5, "#7a5844")
    c.frame(1, 1, W - 2, H - 5, "#8f6c55")
    c.hline(2, W - 3, 2, "#96725a")
    c.rect(1, H - 4, W - 2, 3, "#4f3a2d")
    c.hline(1, W - 2, H - 4, "#5f4636")
    c.vline(0, 1, H - 2, "#5f4636")
    c.vline(W - 1, 1, H - 2, "#5f4636")
    deco(c, "books", 10, 6)
    deco(c, "plant", 36, 10)
    deco(c, "laptop", 56, 9)
    deco(c, "cup", 50, 6)
    deco(c, "paper", 24, 18)
    deco(c, "pencil", 31, 19)
    deco(c, "cup", 66, 20)
    return c


def low_table():
    c = canvas(2, 1)
    c.ellipse(1, 2, 30, 13, "#3f2d22")
    c.ellipse(1, 1, 30, 12, "#5a4232")
    c.ellipse(3, 2, 26, 8, "#6b5040")
    deco(c, "plant", 12, 3)
    deco(c, "books", 20, 3)
    return c


def side_table():
    c = canvas(1, 1)
    c.ellipse(3, 4, 10, 10, "#3f2d22")
    c.ellipse(3, 3, 10, 9, "#6b5040")
    c.ellipse(5, 4, 6, 5, "#7c5f4c")
    deco(c, "cup", 6, 5)
    return c


# ── 조명 ──────────────────────────────────────────────────────────────
def standing_lamp():
    c = canvas(1, 2)
    # 갓
    for i, w in enumerate((8, 10, 12, 12)):
        x = (16 - w) // 2
        c.hline(x, x + w - 1, 4 + i, "#f0dcb0" if i else "#f7e6c0")
    c.hline(2, 13, 8, "#d9bf8c")
    c.hline(3, 12, 9, "#fff3d0")
    c.rect(7, 10, 2, 18, INK)
    c.rect(4, 28, 8, 3, WALL_DK)
    c.hline(4, 11, 28, "#4a4752")
    return c


# ── 네온 사인 / 보드 ──────────────────────────────────────────────────
def _neon_text(c, cx, y, s, scale=2):
    """네온 글자: 어두운 후광 → 앰버 본체 → 각 블록 좌상단 하이라이트."""
    w = text_width(s, scale)
    x = cx - w // 2
    for dx, dy in ((-1, 0), (1, 0), (0, -1), (0, 1)):
        c.text(x + dx, y + dy, s, AMBER_HALO, scale)
    c.text(x, y, s, AMBER, scale)
    if scale > 1:
        gx = x
        for ch in s.upper():
            rows = FONT.get(ch, FONT[" "])
            for ry, row in enumerate(rows):
                for rx, bit in enumerate(row):
                    if bit == "1":
                        c.px(gx + rx * scale, y + ry * scale, AMBER_HI)
            gx += 3 * scale + scale


def neon_sign(w, h, lines, bg=None, scale=2):
    c = canvas(w, h)
    if bg is not None:
        c.blit(bg, 0, 0)
    W, H = w * T, h * T
    c.rect(1, 1, W - 2, H - 2, "#26222b")
    c.frame(1, 1, W - 2, H - 2, "#3d3944")
    line_h = 5 * scale + 3
    total = len(lines) * line_h - 3
    y = (H - total) // 2
    for s in lines:
        _neon_text(c, W // 2, y, s, scale)
        y += line_h
    return c


def chalkboard(w, h, lines, bg=None, frame=WOOD, board="#2f2a2e", ink=CREAM):
    c = canvas(w, h)
    if bg is not None:
        c.blit(bg, 0, 0)
    W, H = w * T, h * T
    c.rect(1, 1, W - 2, H - 2, frame)
    c.rect(3, 3, W - 6, H - 6, board)
    line_h = 6
    total = len(lines) * line_h - 1
    y = (H - total) // 2
    for s in lines:
        c.text_center(W // 2, y, s, ink)
        y += line_h
    return c


def whiteboard(w=4, h=2):
    c = canvas(w, h)
    W, H = w * T, h * T
    c.rect(1, 0, W - 2, H - 3, "#8d8a90")
    c.rect(2, 1, W - 4, H - 5, "#f1e9da")
    c.hline(2, W - 3, H - 4, "#b9b6b3")
    c.text_center(W // 2 - 6, 6, "SMALL STEPS", "#4a5568")
    c.text_center(W // 2 - 6, 13, "BIG CHANGES", "#4a5568")
    c.text_center(W // 2 - 6, 20, ":)", "#4a5568")
    for i, col in enumerate(("#f7d774", "#f4a9b8", "#9fd0c1")):
        c.rect(W - 12 + (i % 2) * 5, 5 + i * 6, 4, 4, col)
    # 다리
    c.rect(4, H - 3, 2, 3, "#6b686f")
    c.rect(W - 6, H - 3, 2, 3, "#6b686f")
    return c


# ── 책장 ──────────────────────────────────────────────────────────────
_SPINES = ["#c96f6f", "#7fa4c4", "#e0c67b", "#8fa585", "#d9977a", "#a08bc4", "#f2ece2", "#6f8a9a"]


def bookshelf(w=2, h=2, seed=1):
    rnd = random.Random(seed)
    c = canvas(w, h)
    W, H = w * T, h * T
    c.rect(0, 0, W, H, WOOD_DK)
    c.rect(1, 1, W - 2, H - 3, "#4a3327")
    c.rect(0, H - 2, W, 2, "#3f2d22")
    shelves = [1, 9, 17, 25] if h == 2 else [1, 9]
    for sy in shelves:
        c.hline(1, W - 2, sy + 7, WOOD)
        x = 2
        while x < W - 3:
            bw = rnd.choice([2, 2, 3])
            bh = rnd.choice([5, 6, 6, 7])
            if rnd.random() < 0.12:
                x += 2
                continue
            col = rnd.choice(_SPINES)
            c.rect(x, sy + 7 - bh, bw, bh, col)
            c.px(x, sy + 7 - bh + 1, "#ffffff40")
            x += bw
    # 맨 위 작은 화분
    deco(c, "plant", W - 8, 0)
    return c


def sign_hanging(w, text, scale=1):
    c = canvas(w, 1)
    W = w * T
    c.rect(2, 3, W - 4, 11, "#26222b")
    c.frame(2, 3, W - 4, 11, "#3d3944")
    c.px(4, 1, "#3d3944")
    c.px(W - 5, 1, "#3d3944")
    c.px(4, 2, "#3d3944")
    c.px(W - 5, 2, "#3d3944")
    _neon_text(c, W // 2, 6, text, scale) if scale > 1 else c.text_center(W // 2, 6, text, AMBER)
    return c


# ── 유리 파티션 ───────────────────────────────────────────────────────
def glass_tile(conns, door=False, plaque=None):
    """conns: 'N','S','E','W' 조합 문자열. 가운데 4~11 밴드를 연결 방향으로 확장."""
    c = canvas(1, 1)
    mask = [[False] * 16 for _ in range(16)]

    def fill(x0, y0, x1, y1):
        for y in range(y0, y1 + 1):
            for x in range(x0, x1 + 1):
                mask[y][x] = True

    fill(5, 5, 10, 10)
    if "N" in conns:
        fill(5, 0, 10, 5)
    if "S" in conns:
        fill(5, 10, 10, 15)
    if "E" in conns:
        fill(10, 5, 15, 10)
    if "W" in conns:
        fill(0, 5, 5, 10)
    for y in range(16):
        for x in range(16):
            if not mask[y][x]:
                continue
            edge = False
            for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1), (2, 0), (-2, 0), (0, 2), (0, -2)):
                nx, ny = x + dx, y + dy
                if 0 <= nx < 16 and 0 <= ny < 16 and not mask[ny][nx]:
                    edge = True
            c.px(x, y, GLASS_FRAME if edge else GLASS)
    # 유리 하이라이트
    for i in range(3):
        c.px(6 + i, 6 + i, GLASS_HI)
    if door:
        # 가로 벽의 문: 가운데를 비우고 미닫이 문짝을 왼쪽으로 열어둔다
        c.rect(3, 4, 10, 8, (0, 0, 0, 0))
        c.rect(0, 5, 3, 6, GLASS_FRAME)
        c.rect(13, 5, 3, 6, GLASS_FRAME)
        c.rect(3, 6, 5, 4, GLASS)
        c.frame(3, 6, 5, 4, GLASS_FRAME_HI)
        c.px(6, 8, AMBER)
        c.hline(3, 12, 12, AMBER_HALO)  # 바닥 문틀 불빛
    if plaque:
        c.rect(1, 3, 14, 10, "#26222b")
        c.frame(1, 3, 14, 10, "#3d3944")
    return c


def glass_plaque(text):
    """2타일짜리 가로 유리벽 + 표지판."""
    c = canvas(2, 1)
    c.blit(glass_tile("EW"), 0, 0)
    c.blit(glass_tile("EW"), T, 0)
    c.rect(2, 3, 28, 10, "#26222b")
    c.frame(2, 3, 28, 10, "#3d3944")
    c.text_center(16, 5, text, AMBER)
    c.hline(4, 27, 11, AMBER_HALO)
    return c


# ── 카페 코너 ─────────────────────────────────────────────────────────
def backbar_upper(seed=0):
    rnd = random.Random(seed)
    c = canvas(1, 1, "#4a3327")
    c.rect(0, 0, 16, 16, "#4a3327")
    c.vline(0, 0, 15, WOOD_DK)
    c.vline(15, 0, 15, WOOD_DK)
    for sy in (6, 13):
        c.hline(1, 14, sy, WOOD)
        x = 2
        while x < 13:
            kind = rnd.choice(["cup", "jar", "jar", "gap"])
            if kind == "cup":
                c.rect(x, sy - 3, 3, 3, "#f2ece2")
                c.px(x + 3, sy - 2, "#f2ece2")
                x += 5
            elif kind == "jar":
                col = rnd.choice(["#c99175", "#8fa585", "#e0c67b", "#a08bc4"])
                c.rect(x, sy - 4, 3, 4, col)
                c.hline(x, x + 2, sy - 4, "#5a5660")
                x += 4
            else:
                x += 2
    return c


def backbar_lower():
    c = canvas(1, 1, "#4a3327")
    c.rect(1, 1, 6, 12, "#5e4331")
    c.rect(9, 1, 6, 12, "#5e4331")
    c.px(6, 7, "#d8b58f")
    c.px(9, 7, "#d8b58f")
    c.rect(0, 13, 16, 3, "#3f2d22")
    return c


def coffee_machine():
    c = canvas(1, 2)
    c.blit(backbar_upper(3), 0, 0)
    c.rect(3, 4, 10, 12, "#3d3a44")
    c.rect(3, 4, 10, 2, "#55515c")
    c.rect(4, 7, 8, 3, METAL_DK)
    c.px(11, 8, "#e35d5d")
    c.px(6, 8, "#7fd0a0")
    # 아래 타일: 카운터 위 본체 하부 + 트레이 + 컵
    c.rect(0, 16, 16, 12, "#e2d8c8")
    c.hline(0, 15, 16, "#efe8db")
    c.rect(0, 28, 16, 4, "#8a6f58")
    c.rect(3, 16, 10, 6, "#3d3a44")
    c.rect(5, 22, 6, 2, METAL)
    c.rect(6, 19, 4, 3, "#f2ece2")
    c.px(10, 20, "#f2ece2")
    c.px(7, 17, "#ffffff60")
    c.px(9, 16, "#ffffff40")
    return c


def beanbag(color, dark, hi):
    c = canvas(1, 1)
    c.ellipse(1, 3, 14, 12, dark)
    c.ellipse(1, 2, 14, 11, color)
    c.ellipse(4, 4, 6, 3, hi)
    c.hline(5, 10, 9, dark)
    c.px(7, 10, dark)
    return c


def rug(w, h, base="#e4d3b4", border="#cfb58f", inner="#dcc9a6", accent=None):
    c = canvas(w, h)
    W, H = w * T, h * T
    c.rect(0, 0, W, H, base)
    c.frame(0, 0, W, H, border)
    c.frame(1, 1, W - 2, H - 2, border)
    c.frame(4, 4, W - 8, H - 8, inner)
    if accent:
        for y in range(8, H - 8, 6):
            for x in range(8, W - 8, 6):
                c.px(x, y, accent)
                c.px(x + 1, y + 1, accent)
    # 술
    for y in range(2, H - 2, 3):
        c.px(0, y, "#c2a57e")
        c.px(W - 1, y, "#c2a57e")
    return c


def rug_round(w=3, h=3):
    c = canvas(w, h)
    W, H = w * T, h * T
    c.ellipse(1, 2, W - 2, H - 4, "#cfb58f")
    c.ellipse(1, 1, W - 2, H - 4, "#e6d6b8")
    c.ellipse(6, 5, W - 12, H - 12, "#d4bf9b")
    c.ellipse(9, 8, W - 18, H - 18, "#e6d6b8")
    c.ellipse(W // 2 - 4, H // 2 - 4, 8, 6, "#d9a98f")
    return c


def doormat(text="WELCOME"):
    c = canvas(2, 1)
    c.rect(1, 2, 30, 12, "#6b4a3a")
    c.frame(1, 2, 30, 12, "#a08466")
    c.text_center(16, 5, text, "#e4d3b4")
    return c


# ── 화분 ──────────────────────────────────────────────────────────────
def plant_tall(seed=0):
    rnd = random.Random(seed)
    c = canvas(1, 2)
    # 화분 (아래 타일)
    c.rect(4, 24, 8, 7, POT)
    c.rect(3, 23, 10, 2, POT_HI)
    c.hline(4, 11, 30, "#8f5e48")
    c.rect(5, 25, 6, 1, "#5a3e33")
    # 줄기 + 잎
    c.vline(7, 12, 23, "#4a6b47")
    c.vline(8, 14, 23, "#4a6b47")
    leaves = [(2, 6, 7, 5, LEAF), (8, 4, 7, 5, LEAF_LT), (1, 12, 6, 4, LEAF_LT), (9, 11, 6, 5, LEAF),
              (4, 1, 6, 4, LEAF_HI), (3, 16, 5, 4, LEAF), (9, 17, 5, 3, LEAF_LT)]
    for x, y, w, h, col in leaves:
        c.ellipse(x, y, w, h, col)
        c.px(x + w // 2, y + h // 2, "#3f5f3d")
    for _ in range(6):
        c.px(rnd.randint(2, 13), rnd.randint(2, 20), LEAF_HI)
    return c


def plant_hanging():
    """창문 위/벽에 거는 덩굴 (top 레이어용 1타일)."""
    c = canvas(1, 1)
    c.rect(5, 0, 6, 3, POT)
    c.hline(5, 10, 0, POT_HI)
    for x, ys in ((3, 3), (6, 5), (9, 4), (12, 3)):
        c.vline(x, 3, 3 + ys * 2, LEAF)
        for k in range(ys):
            c.px(x - 1 + (k % 2) * 2, 4 + k * 2, LEAF_LT)
    return c


# ── 입구 문 (하단 벽) ─────────────────────────────────────────────────
def entrance_door(w=4, h=2):
    c = canvas(w, h)
    W, H = w * T, h * T
    for i in range(w):
        for r in range(h):
            c.blit(wall_top(), i * T, r * T)
    # 문틀 + 유리 양문
    c.rect(T - 2, 0, 2 * T + 4, H, GLASS_FRAME)
    c.rect(T, 2, 2 * T, H - 4, "#9fbcc7")
    c.vline(2 * T - 1, 2, H - 3, GLASS_FRAME)
    c.vline(2 * T, 2, H - 3, GLASS_FRAME)
    for i in range(6):
        c.px(T + 3 + i, 4 + i, "#ffffff55")
        c.px(2 * T + 5 + i, 8 + i, "#ffffff44")
    c.hline(T + 1, 2 * T - 2, H // 2, AMBER)
    c.hline(2 * T + 1, 3 * T - 2, H // 2, AMBER)
    # 양옆 벽등
    for lx in (6, W - 7):
        c.rect(lx - 1, 3, 3, 4, "#2b2930")
        c.rect(lx, 4, 1, 2, "#ffe9b0")
        c.rect(lx - 1, 8, 3, 1, "#4a4752")
    return c
