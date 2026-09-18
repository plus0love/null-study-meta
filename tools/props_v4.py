"""15단계 소품: 2인 스터디룸(긴 책상·2인 소파·코르크보드·작은 책장·협탁 소품·커튼·슬리퍼)
+ 실내 밀도(무늬 러그 3종·통로 러너·라운지/회의/커피/푸프/복도 소품·벽 소품)
+ 쪽지·머그 아이콘.

모든 함수는 16px 논리 해상도 Canvas 를 돌려준다. 글자는 그리지 않는다 (클라이언트 웹폰트).
"""
from pixel import Canvas
from props import (AMBER, AMBER_HALO, AMBER_HI, CREAM, INK, LEAF, LEAF_HI, LEAF_LT, METAL, METAL_DK, POT, POT_HI, T,
                   WALL_DK, WOOD, WOOD_DK, WOOD_HI, WOOD_LT, _SPINES, canvas, deco)
from props_room import CUSHION, CUSHION_DK, CUSHION_HI, MONITOR, SCREEN, SOFA, SOFA_DK, SOFA_HI
from props_v2 import wall_block

DESK_TOP = "#efe6d6"
DESK_TOP_HI = "#f8f2e6"
DESK_TOP_DK = "#e3d9c7"
DESK_EDGE = "#b9b6b3"
DESK_APRON = "#5a5660"
DESK_APRON_HI = "#6d6873"
DESK_LEG = "#3d3a44"
KEY = "#d8d3cc"
KEY_DK = "#b9b6b3"
PAPER = "#f5efe3"
BURG = "#8c4a4f"
SAGE_RUG = "#9fb59a"

# 러그 팔레트 3종 (크림 · 세이지 · 버건디): base, border(바깥 두 줄), border2(안쪽 띠), accent(패턴), accent2(밝은 점)
RUG_PALETTES = {
    "cream": dict(base="#e3d3b3", border="#a98462", border2="#cfb48d", accent="#c4ad86", accent2="#8f6f4f"),
    "sage": dict(base="#9fb59a", border="#4f6a4c", border2="#7c9878", accent="#8aa585", accent2="#d3ddc0"),
    "burgundy": dict(base="#8c4a4f", border="#4e262b", border2="#a8696b", accent="#9a5a5f", accent2="#dcae94"),
}


# ── 러그 ─────────────────────────────────────────────────────────────
def _rug_body(c, x0, y0, W, H, p, pattern):
    """테두리 2겹(바깥 2px + 안쪽 띠) + 중앙 패턴. (x0, y0) 부터 W x H."""
    base, border, border2, accent, accent2 = p["base"], p["border"], p["border2"], p["accent"], p["accent2"]
    c.rect(x0, y0, W, H, base)
    c.frame(x0, y0, W, H, border)
    c.frame(x0 + 1, y0 + 1, W - 2, H - 2, border)
    c.frame(x0 + 3, y0 + 3, W - 6, H - 6, border2)
    c.frame(x0 + 4, y0 + 4, W - 8, H - 8, border2)
    # 안쪽 띠의 점무늬
    for x in range(x0 + 6, x0 + W - 6, 4):
        c.px(x, y0 + 3, accent2)
        c.px(x, y0 + H - 4, accent2)
    for y in range(y0 + 6, y0 + H - 6, 4):
        c.px(x0 + 3, y, accent2)
        c.px(x0 + W - 4, y, accent2)
    ix0, iy0, iw, ih = x0 + 6, y0 + 6, W - 12, H - 12
    if pattern == "medallion":
        # 다이아 격자 + 가운데 큰 마름모
        for y in range(iy0 + 1, iy0 + ih - 1, 6):
            for x in range(ix0 + 1 + (((y - iy0) // 6) % 2) * 3, ix0 + iw - 1, 6):
                c.px(x, y, accent)
                c.px(x - 1, y + 1, accent)
                c.px(x + 1, y + 1, accent)
                c.px(x, y + 2, accent)
        cx, cy = x0 + W // 2, y0 + H // 2
        r = min(iw, ih) // 2 - 2
        for i in range(r + 1):
            for sx in (-1, 1):
                for sy in (-1, 1):
                    c.px(cx + sx * i, cy + sy * (r - i), border2)
        r2 = max(2, r - 4)
        for i in range(r2 + 1):
            for sx in (-1, 1):
                for sy in (-1, 1):
                    c.px(cx + sx * i, cy + sy * (r2 - i), accent2)
        c.rect(cx - 1, cy - 1, 3, 3, accent2)
    elif pattern == "lattice":
        for y in range(iy0, iy0 + ih):
            for x in range(ix0, ix0 + iw):
                if (x + y) % 8 == 0 or (x - y) % 8 == 0:
                    c.px(x, y, accent)
        for y in range(iy0 + 4, iy0 + ih - 2, 8):
            for x in range(ix0 + 4, ix0 + iw - 2, 8):
                c.px(x, y, accent2)
    elif pattern == "stripes":
        # 러너용: 가로 띠 + 셰브런
        for y in range(iy0 + 2, iy0 + ih - 2, 5):
            c.hline(ix0 + 1, ix0 + iw - 2, y, accent)
        for x in range(ix0 + 3, ix0 + iw - 3, 8):
            for k in range(3):
                c.px(x + k, iy0 + ih // 2 - 1 - k, accent2)
                c.px(x + k, iy0 + ih // 2 + 1 + k, accent2)
    elif pattern == "dots":
        for y in range(iy0 + 2, iy0 + ih - 1, 4):
            for x in range(ix0 + 2 + ((y // 4) % 2) * 2, ix0 + iw - 1, 4):
                c.px(x, y, accent)
    for y in range(y0 + 2, y0 + H - 2, 3):
        c.px(x0, y, border2)
        c.px(x0 + W - 1, y, border2)


def rug_v4(w, h, palette="cream", pattern="medallion", fringe=False):
    """무늬 러그. fringe=True 면 양 끝(좌우)에 술 3px."""
    p = RUG_PALETTES[palette]
    c = canvas(w, h)
    W, H = w * T, h * T
    if fringe:
        _rug_body(c, 3, 0, W - 6, H, p, pattern)
        for y in range(1, H - 1, 2):
            c.hline(0, 2, y, p["border2"])
            c.hline(W - 3, W - 1, y, p["border2"])
            c.px(0, y, p["accent2"])
            c.px(W - 1, y, p["accent2"])
    else:
        _rug_body(c, 0, 0, W, H, p, pattern)
    return c


# ── 2인 스터디룸 ─────────────────────────────────────────────────────
def desk_long(w=7):
    """긴 책상 7x2: 뒷줄(모니터 2 · 스탠드 2 · 가운데 공유 화분+시계) + 앞줄(키보드·마우스·노트·머그)."""
    c = canvas(w, 2)
    W = w * T
    c.rect(0, 1, W, 27, DESK_TOP)
    c.hline(0, W - 1, 1, DESK_TOP_HI)
    c.hline(0, W - 1, 0, DESK_EDGE)
    c.rect(0, 2, W, 3, DESK_TOP_DK)  # 뒤쪽 선반 띠
    c.hline(0, W - 1, 5, "#d9cfbd")
    c.rect(0, 28, W, 3, DESK_APRON)
    c.hline(0, W - 1, 28, DESK_APRON_HI)
    for lx in (2, W // 2 - 1, W - 5):
        c.rect(lx, 31, 3, 1, DESK_LEG)
    # 모니터 2 (2·4번째 타일)
    for mx in (31, 63):
        c.rect(mx, 1, 18, 10, MONITOR)
        c.rect(mx + 1, 2, 16, 8, SCREEN)
        c.rect(mx + 2, 3, 7, 1, "#b5dcd3")
        c.rect(mx + 2, 5, 10, 1, "#a9d3c9")
        c.rect(mx + 2, 7, 5, 1, "#a9d3c9")
        c.rect(mx + 8, 11, 2, 2, MONITOR)
        c.rect(mx + 5, 13, 8, 1, MONITOR)
        c.rect(mx + 4, 14, 10, 1, DESK_EDGE)
        # 키보드 · 마우스
        c.rect(mx + 2, 19, 14, 4, KEY)
        c.hline(mx + 3, mx + 14, 20, KEY_DK)
        c.hline(mx + 3, mx + 14, 21, "#c9c5bf")
        c.rect(mx + 18, 20, 3, 4, "#e9e4dc")
        c.px(mx + 19, 21, KEY_DK)
    # 스탠드 2 (양 끝)
    deco(c, "lamp", 4, 3)
    deco(c, "lamp", W - 11, 3)
    # 공유 소품: 화분 + 탁상시계 (가운데 타일)
    px0 = 49
    c.rect(px0 + 8, 8, 6, 5, POT)
    c.hline(px0 + 8, px0 + 13, 8, POT_HI)
    for x, y, col in ((px0 + 9, 5, LEAF), (px0 + 10, 4, LEAF_LT), (px0 + 11, 5, LEAF_HI), (px0 + 8, 6, LEAF_LT), (px0 + 12, 6, LEAF),
                      (px0 + 9, 7, LEAF), (px0 + 12, 7, LEAF_LT), (px0 + 10, 6, LEAF_HI), (px0 + 7, 7, LEAF_HI), (px0 + 13, 7, LEAF)):
        c.px(x, y, col)
    c.rect(px0, 7, 6, 6, "#3b3540")
    c.rect(px0 + 1, 8, 4, 4, "#f5efe3")
    c.px(px0 + 2, 9, INK)
    c.px(px0 + 3, 10, INK)
    # 앞줄 소품: 노트 + 연필, 머그, 종이
    deco(c, "paper", 18, 18)
    deco(c, "pencil", 24, 19)
    deco(c, "cup", 86, 19)
    deco(c, "books", 96, 18)
    return c


def nightstand_books():
    """협탁 위 책 더미 + 머그."""
    c = canvas(1, 1)
    c.rect(1, 3, 14, 11, "#4a3327")
    c.rect(1, 3, 14, 3, "#6b4c36")
    c.hline(1, 14, 3, "#8a6a52")
    c.rect(3, 8, 10, 2, "#3f2d22")
    c.rect(3, 11, 10, 2, "#3f2d22")
    c.px(8, 9, "#d8b58f")
    c.px(8, 12, "#d8b58f")
    c.rect(2, 1, 6, 1, _SPINES[0])
    c.rect(3, 0, 6, 1, _SPINES[2])
    c.rect(2, 2, 7, 1, _SPINES[4])
    deco(c, "cup", 11, 0)
    return c


def nightstand_lamp():
    """협탁 위 작은 스탠드."""
    c = canvas(1, 1)
    c.rect(1, 5, 14, 9, "#4a3327")
    c.rect(1, 5, 14, 3, "#6b4c36")
    c.hline(1, 14, 5, "#8a6a52")
    c.rect(3, 10, 10, 2, "#3f2d22")
    c.px(8, 11, "#d8b58f")
    c.rect(5, 0, 7, 3, "#e9c98a")
    c.hline(5, 11, 0, "#f3dba6")
    c.hline(6, 10, 3, "#fff1c8")
    c.vline(8, 3, 5, INK)
    c.rect(6, 5, 5, 1, INK)
    return c


def sofa_love(w=4, h=2):
    """2인 소파 4x2 (좌석은 가운데 두 칸): 쿠션 2개 + 오른팔에 걸친 담요."""
    c = canvas(w, h)
    W, H = w * T, h * T
    c.rect(2, 4, W - 4, 10, SOFA_DK)
    c.rect(2, 3, W - 4, 9, SOFA)
    c.hline(3, W - 4, 3, SOFA_HI)
    for ax in (0, W - 8):
        c.rect(ax, 8, 8, H - 12, SOFA_DK)
        c.rect(ax + 1, 7, 6, H - 12, SOFA)
        c.hline(ax + 2, ax + 5, 7, SOFA_HI)
    seat_w = (W - 16) // 2
    for i in range(2):
        sx = 8 + i * seat_w
        c.rect(sx, 13, seat_w - 1, H - 18, SOFA)
        c.frame(sx, 13, seat_w - 1, H - 18, SOFA_DK)
        c.hline(sx + 1, sx + seat_w - 3, 14, SOFA_HI)
    # 쿠션 2개 (세이지 · 테라코타)
    for cx, (dk, mid, hi) in ((11, (CUSHION_DK, CUSHION, CUSHION_HI)), (W - 24, ("#b8765c", "#d9977a", "#efb59a"))):
        c.rect(cx, 5, 13, 10, dk)
        c.rect(cx + 1, 4, 11, 10, mid)
        c.rect(cx + 3, 6, 5, 3, hi)
        c.px(cx + 6, 9, dk)
    # 담요 (버건디, 오른팔에 걸침)
    c.rect(W - 9, 9, 9, 12, "#6f3a40")
    c.rect(W - 8, 8, 8, 12, BURG)
    for y in range(9, 20, 3):
        c.hline(W - 7, W - 2, y, "#a86a6b")
    c.hline(W - 8, W - 1, 20, "#5a2b30")
    for x in range(W - 8, W, 2):
        c.px(x, 21, "#dcae94")
    c.rect(2, H - 4, W - 4, 2, "#00000030")
    return c


def corkboard(w=3, h=2):
    """벽 코르크보드 3x2 (벽 배경 포함): 나무 프레임 + 코르크 + 색색 포스트잇. 가운데는 클라이언트가 목표 팻말 2장을 그린다."""
    c = canvas(w, h)
    c.blit(wall_block(w, h), 0, 0)
    W, H = w * T, h * T
    c.rect(2, 5, W - 4, H - 9, "#6b4c36")
    c.frame(2, 5, W - 4, H - 9, "#8a6a52")
    c.rect(4, 7, W - 8, H - 13, "#c9a06a")
    for y in range(7, H - 6, 2):
        for x in range(4 + (y % 4) // 2, W - 4, 3):
            c.px(x, y, "#b98d5a")
    notes = [(6, 9, "#f2d66b"), (11, 9, "#f0a3b5"), (W - 10, 9, "#9fc6ea"), (W - 15, 9, "#a9d69a"), (6, H - 12, "#9fc6ea"), (W - 10, H - 12, "#f2d66b"), (W - 15, H - 13, "#f0a3b5")]
    for x, y, col in notes:
        c.rect(x, y, 4, 4, col)
        c.px(x + 1, y, "#e2605e")
        c.hline(x + 1, x + 2, y + 2, "#00000028")
    # 압정 4개
    for x, y in ((3, 6), (W - 4, 6), (3, H - 5), (W - 4, H - 5)):
        c.px(x, y, "#e2605e")
    return c


def bookcase_small():
    """작은 책장 2x2: 3단 책 + 위에 화분·상자."""
    c = canvas(2, 2)
    W, H = 2 * T, 2 * T
    c.rect(0, 2, W, H - 2, WOOD_DK)
    c.rect(1, 3, W - 2, H - 5, "#4a3327")
    spines = _SPINES
    k = 0
    for sy in (12, 21, 30):
        c.hline(1, W - 2, sy, WOOD)
        x = 2
        while x < W - 3:
            bw = 2 if k % 3 else 3
            hh = 6 if k % 2 else 7
            c.rect(x, sy - hh, bw, hh, spines[k % len(spines)])
            c.px(x, sy - hh + 1, "#ffffff40")
            x += bw + (1 if k % 4 == 0 else 0)
            k += 1
    c.rect(1, H - 2, W - 2, 1, "#2f2016")
    deco(c, "plant", 3, -1)
    c.rect(20, 0, 8, 3, "#c9a98b")
    c.frame(20, 0, 8, 3, "#a08466")
    return c


def coat_rack_cardigan():
    """옷걸이에 가디건 (1x2, 위 타일은 top 레이어)."""
    c = canvas(1, 2)
    c.rect(7, 2, 2, 26, "#4a3327")
    c.rect(4, 28, 8, 3, "#3f2d22")
    c.hline(3, 12, 2, "#4a3327")
    for x in (3, 12):
        c.vline(x, 2, 5, "#4a3327")
    # 가디건 (버건디) — 팔 늘어짐
    c.rect(1, 5, 7, 12, "#7a3f45")
    c.rect(2, 6, 5, 11, BURG)
    c.vline(4, 6, 16, "#6f3a40")
    c.px(3, 8, "#dcae94")
    c.px(3, 11, "#dcae94")
    c.rect(1, 17, 2, 4, BURG)
    # 가방 (겨자)
    c.rect(10, 6, 5, 7, "#b8902e")
    c.rect(11, 7, 3, 5, "#d9ad3b")
    c.hline(11, 13, 5, "#7a5f1c")
    return c


def slippers(kind=0):
    """바닥 슬리퍼 두 켤레 (1x1, 통과 가능). kind 0: 크림·세이지, 1: 버건디·회색."""
    c = canvas(1, 1)
    cols = [("#f0e2c6", "#cdb48c"), ("#6b8a5e", "#4f6a45")] if kind == 0 else [("#a86a6b", "#8c4a4f"), ("#b8b4bf", "#8f8b96")]
    for i, (mid, dk) in enumerate(cols):
        x = 1 + i * 8
        c.rect(x, 3, 6, 10, dk)
        c.rect(x + 1, 4, 4, 8, mid)
        c.rect(x + 1, 5, 4, 3, dk)
        c.hline(x + 2, x + 3, 6, mid)
    return c


def curtain(part="top"):
    """세로 유리벽 안쪽의 얇은 커튼 (top 레이어, 1x1). 위에서 본 모습: 왼쪽에 레일(세로선), 그 옆에 주름진 천 띠.
    part: 'rail'(레일만) | 'top'(레일+커튼 시작, 고리) | 'body'(커튼) | 'end'(커튼 끝, 반쯤 걷혀 뭉침)."""
    c = canvas(1, 1)
    rail = "#b8b4bf"
    c.vline(1, 0, 15, rail)
    if part == "rail":
        c.px(0, 4, METAL_DK)
        c.px(0, 11, METAL_DK)
        c.px(2, 4, METAL_DK)
        c.px(2, 11, METAL_DK)
        return c
    x0 = 2
    x1 = 8 if part != "end" else 10
    y0 = 3 if part == "top" else 0
    for y in range(y0, 16):
        fold = (y // 2) % 2
        col = "#f4ecdd" if fold else "#e2d7c2"
        c.hline(x0, x1, y, col + "d8")
        if part == "end":
            c.px(x1, y, "#cbb694c0")
    for x in range(x0, x1 + 1, 3):
        c.px(x, y0, "#cbb694")
    if part == "top":
        for y in range(3, 16, 4):
            c.px(0, y, METAL_DK)
            c.px(2, y, METAL_DK)
        c.hline(0, 3, 1, METAL)
    if part == "end":
        c.hline(x0, x1, 15, "#cbb694c0")
        c.vline(x1 + 1, 6, 15, "#e2d7c280")
    return c


# ── 라운지 ───────────────────────────────────────────────────────────
def magazines():
    """바닥 잡지 더미 (1x1)."""
    c = canvas(1, 1)
    c.rect(3, 9, 10, 2, "#c96f6f")
    c.rect(2, 7, 10, 2, "#7fa4c4")
    c.rect(4, 5, 10, 2, "#e0c67b")
    c.rect(3, 3, 10, 2, "#8fa585")
    c.hline(5, 11, 3, "#f5efe3")
    c.px(6, 4, INK)
    c.px(7, 4, INK)
    c.rect(3, 11, 10, 1, "#00000030")
    return c


def table_lamp():
    """사이드 테이블 램프 (1x2, 위 타일 top): 작은 원탁 + 갓."""
    c = canvas(1, 2)
    c.ellipse(2, 20, 12, 10, "#3f2d22")
    c.ellipse(2, 18, 12, 9, "#6b5040")
    c.rect(7, 22, 2, 6, "#4a3327")
    c.rect(4, 28, 8, 2, "#3f2d22")
    c.rect(7, 12, 2, 7, INK)
    for i, w in enumerate((6, 8, 10, 10)):
        x = (16 - w) // 2
        c.hline(x, x + w - 1, 6 + i, "#f0dcb0" if i else "#f7e6c0")
    c.hline(3, 12, 10, "#d9bf8c")
    c.hline(4, 11, 11, "#fff3d0")
    deco(c, "cup", 2, 15)
    return c


def wall_frames_c():
    """액자 3개 묶음 (벽 배경 포함 2x2)."""
    c = canvas(2, 2)
    c.blit(wall_block(2, 2), 0, 0)
    c.rect(2, 6, 12, 9, "#6b4c36")
    c.rect(3, 7, 10, 7, "#e6d9bf")
    c.rect(4, 9, 8, 3, "#8fa585")
    c.rect(5, 10, 3, 1, "#d9977a")
    c.rect(17, 5, 12, 12, "#a08466")
    c.rect(19, 7, 8, 8, "#d9c2a0")
    c.rect(20, 10, 6, 4, "#7fa4c4")
    c.rect(21, 8, 4, 2, "#f0dcb0")
    c.rect(4, 18, 10, 8, "#3d3944")
    c.rect(5, 19, 8, 6, "#f5efe3")
    c.rect(6, 21, 6, 2, "#c96f6f")
    c.rect(18, 20, 9, 7, "#6b4c36")
    c.rect(19, 21, 7, 5, "#e6d9bf")
    c.px(21, 23, "#8fa585")
    c.px(23, 22, "#8fa585")
    return c


def dog_bowl():
    c = canvas(1, 1)
    c.ellipse(3, 8, 10, 6, "#8a3b3b")
    c.ellipse(3, 6, 10, 6, "#c96f6f")
    c.ellipse(5, 7, 6, 3, "#e9a06b")
    c.px(7, 8, "#c47a45")
    c.px(9, 8, "#c47a45")
    c.rect(3, 13, 10, 1, "#00000030")
    return c


def dog_toy():
    """뼈다귀 + 공."""
    c = canvas(1, 1)
    c.rect(4, 7, 8, 2, "#f0e2c6")
    for x in (3, 11):
        c.rect(x, 6, 2, 4, "#f0e2c6")
        c.px(x, 6, "#faf1dc")
    c.hline(5, 10, 8, "#cdb48c")
    c.ellipse(9, 10, 5, 5, "#e2605e")
    c.px(10, 11, "#ff8a7a")
    c.rect(4, 13, 9, 1, "#00000030")
    return c


# ── 회의 구역 ─────────────────────────────────────────────────────────
def chair_e_bag():
    """동쪽을 보는 검정 의자 + 등받이에 걸린 가방."""
    from props_v2 import chair_black
    c = chair_black("e")
    c.rect(0, 6, 4, 7, "#5b7fb0")
    c.rect(1, 7, 2, 5, "#7fa4c4")
    c.hline(0, 3, 6, "#3f5f8a")
    c.px(1, 4, "#3f5f8a")
    c.px(2, 5, "#3f5f8a")
    return c


def projector_screen():
    """내려온 프로젝터 스크린 2x3 (윗줄은 top 레이어)."""
    c = canvas(2, 3)
    W, H = 2 * T, 3 * T
    c.rect(2, 2, W - 4, 3, "#3d3944")
    c.hline(2, W - 3, 2, "#5a5660")
    c.rect(4, 5, W - 8, H - 12, "#f4f1ea")
    c.frame(4, 5, W - 8, H - 12, "#d8d3cc")
    c.rect(6, 8, W - 12, 3, "#c8dcf0")
    c.rect(6, 13, W - 14, 2, "#d8d3cc")
    c.rect(6, 17, W - 16, 2, "#d8d3cc")
    c.rect(6, 21, W - 13, 2, "#d8d3cc")
    c.rect(6, 25, W - 18, 2, "#d8d3cc")
    c.rect(4, H - 7, W - 8, 2, "#3d3944")
    c.rect(W // 2 - 1, H - 5, 2, 3, "#5a5660")
    c.rect(W // 2 - 5, H - 2, 10, 2, "#3d3944")
    return c


def wall_calendar():
    """벽 달력 (벽 배경 포함 1x2)."""
    c = canvas(1, 2)
    c.blit(wall_block(1, 2), 0, 0)
    c.rect(3, 6, 10, 13, "#f5efe3")
    c.rect(3, 6, 10, 4, "#c96f6f")
    c.px(5, 5, METAL_DK)
    c.px(10, 5, METAL_DK)
    for y in range(11, 18, 2):
        for x in range(4, 12, 2):
            c.px(x, y, "#b9b6b3")
    c.px(8, 13, "#e2605e")
    c.px(9, 13, "#e2605e")
    return c


def cable_box():
    """바닥 케이블 정리함 (1x1)."""
    c = canvas(1, 1)
    c.rect(2, 6, 12, 7, "#3d3944")
    c.rect(3, 5, 10, 2, "#5a5660")
    c.rect(4, 8, 8, 3, "#26232b")
    c.hline(1, 3, 12, "#8f8b96")
    c.hline(12, 15, 11, "#8f8b96")
    c.px(0, 13, "#8f8b96")
    c.rect(2, 13, 12, 1, "#00000030")
    return c


# ── 커피 코너 · 푸프 구역 ───────────────────────────────────────────
def counter_menu():
    """카운터 위 메뉴판·냅킨·시럽병·머그 진열 (1x1, counter_dense 톤)."""
    from props_v2 import counter_dense
    c = counter_dense(0)
    c.rect(0, 0, 16, 9, "#00000000")
    # 상판 다시: 메뉴 카드
    c.rect(1, 0, 6, 7, "#f5efe3")
    c.frame(1, 0, 6, 7, "#d8d3cc")
    c.hline(2, 5, 2, "#3b3540")
    c.hline(2, 4, 4, "#b9b6b3")
    # 냅킨 스택
    c.rect(8, 4, 5, 3, "#f5efe3")
    c.hline(8, 12, 4, "#ffffff")
    c.hline(8, 12, 6, "#d8d3cc")
    # 시럽병 2
    c.rect(13, 1, 2, 6, "#c47a45")
    c.rect(13, 0, 2, 1, INK)
    c.px(13, 3, "#f5efe3")
    return c


def bean_shelf():
    """벽 선반 + 원두 봉지 (2x2, 벽 배경 없음 — 선반 뒷판 포함)."""
    c = canvas(2, 2)
    W = 2 * T
    c.rect(1, 0, W - 2, 30, "#3a3741")
    for y in (10, 22):
        c.rect(1, y, W - 2, 2, WOOD_DK)
        c.hline(1, W - 2, y, WOOD)
    bags = [(2, 3, "#7a5233", "#c9a98b"), (9, 2, "#4f3a2d", "#d9977a"), (17, 3, "#8c4a4f", "#f0dcb0"), (25, 4, "#5e4331", "#a9d69a")]
    for x, y, col, tag in bags:
        c.rect(x, y, 6, 10 - y + 2, col)
        c.rect(x + 1, y + 3, 4, 3, tag)
        c.hline(x, x + 5, y, "#00000040")
    c.rect(3, 14, 5, 8, "#8c4a4f")
    c.rect(4, 17, 3, 2, "#f0dcb0")
    c.rect(10, 15, 6, 7, "#5e4331")
    c.rect(11, 17, 4, 3, "#c9a98b")
    deco(c, "cup", 19, 18)
    deco(c, "cup", 24, 17)
    c.rect(1, 30, W - 2, 2, "#2b2930")
    return c


def milk_crate():
    """바닥 우유 상자 (1x1)."""
    c = canvas(1, 1)
    c.rect(2, 5, 12, 9, "#5b7fb0")
    c.rect(3, 6, 10, 7, "#7fa4c4")
    for x in range(4, 12, 3):
        c.vline(x, 7, 12, "#5b7fb0")
    c.rect(4, 2, 3, 4, "#f5efe3")
    c.rect(8, 1, 3, 5, "#f5efe3")
    c.px(5, 3, "#7fa4c4")
    c.px(9, 2, "#7fa4c4")
    c.rect(2, 14, 12, 1, "#00000030")
    return c


def side_table_games():
    """푸프 테이블: 보드게임 + 간식 접시 (2x2)."""
    c = canvas(2, 2)
    c.ellipse(3, 7, 26, 18, "#2f2016")
    c.ellipse(3, 5, 26, 17, "#5a4232")
    c.ellipse(6, 7, 20, 12, "#6b5040")
    # 보드게임 판 (격자)
    c.rect(7, 8, 9, 9, "#f0dcb0")
    for i in range(0, 9, 2):
        for j in range(0, 9, 2):
            if (i + j) % 4 == 0:
                c.rect(7 + i, 8 + j, 2, 2, "#3b3540")
    c.px(9, 10, "#e2605e")
    c.px(13, 14, "#7fa4c4")
    # 간식 접시
    c.ellipse(17, 10, 8, 6, "#f5efe3")
    c.ellipse(18, 11, 6, 4, "#e9e4dc")
    c.px(19, 12, "#e0c67b")
    c.px(21, 12, "#c96f6f")
    c.px(20, 13, "#8fa585")
    deco(c, "cup", 20, 5)
    return c


def book_cart():
    """작은 책 수레 (1x2)."""
    c = canvas(1, 2)
    c.rect(2, 2, 12, 2, METAL)
    c.rect(2, 4, 1, 24, METAL_DK)
    c.rect(13, 4, 1, 24, METAL_DK)
    for sy in (12, 22):
        c.rect(3, sy, 10, 1, METAL)
        for k, col in enumerate(_SPINES[(sy // 10) % 3:][:4]):
            c.rect(4 + k * 2, sy - 6 + (k % 2), 2, 6 - (k % 2), col)
    c.rect(3, 26, 10, 1, METAL_DK)
    for x in (3, 11):
        c.ellipse(x, 27, 3, 3, INK)
    return c


# ── 벽 · 복도 ─────────────────────────────────────────────────────────
def wall_poster():
    """포스터 (벽 배경 포함 1x2)."""
    c = canvas(1, 2)
    c.blit(wall_block(1, 2), 0, 0)
    c.rect(2, 5, 12, 15, "#f0dcb0")
    c.rect(3, 6, 10, 6, "#5b7fb0")
    c.rect(4, 8, 8, 3, "#8fa585")
    c.rect(4, 13, 6, 1, INK)
    c.rect(4, 15, 8, 1, INK)
    c.rect(4, 17, 4, 1, INK)
    c.px(2, 5, METAL_DK)
    c.px(13, 5, METAL_DK)
    return c


def wall_hook_bag():
    """후크에 걸린 가방 (벽 배경 포함 1x2)."""
    c = canvas(1, 2)
    c.blit(wall_block(1, 2), 0, 0)
    c.rect(4, 6, 8, 1, WOOD_DK)
    c.px(5, 7, METAL)
    c.px(10, 7, METAL)
    c.rect(4, 8, 7, 10, "#5e4331")
    c.rect(5, 9, 5, 8, "#7c5a44")
    c.rect(5, 9, 5, 2, "#5e4331")
    c.px(7, 12, "#b08a6a")
    c.vline(6, 7, 8, "#3f2d22")
    c.vline(8, 7, 8, "#3f2d22")
    return c


def wall_switch():
    """콘센트 + 스위치 (벽 배경 포함 1x2)."""
    c = canvas(1, 2)
    c.blit(wall_block(1, 2), 0, 0)
    c.rect(4, 8, 6, 6, "#e9e4dc")
    c.frame(4, 8, 6, 6, "#c9c5bf")
    c.rect(6, 10, 2, 2, "#b9b6b3")
    c.rect(4, 20, 6, 6, "#e9e4dc")
    c.frame(4, 20, 6, 6, "#c9c5bf")
    c.px(6, 22, INK)
    c.px(8, 22, INK)
    c.px(7, 24, INK)
    return c


def fire_extinguisher():
    c = canvas(1, 1)
    c.rect(5, 3, 6, 11, "#a83232")
    c.rect(6, 3, 4, 11, "#e2605e")
    c.rect(6, 6, 4, 2, "#f5efe3")
    c.rect(7, 1, 2, 2, INK)
    c.rect(9, 1, 3, 1, INK)
    c.vline(11, 2, 6, "#3b3540")
    c.rect(5, 14, 6, 1, "#00000040")
    return c


def umbrella_stand():
    c = canvas(1, 1)
    c.rect(4, 7, 8, 8, "#5a5660")
    c.rect(5, 8, 6, 6, "#3d3a44")
    c.rect(6, 1, 1, 7, "#c96f6f")
    c.rect(8, 0, 1, 8, "#5b7fb0")
    c.rect(10, 2, 1, 6, "#e0c67b")
    c.px(6, 0, INK)
    c.px(8, 8, INK)
    c.rect(4, 15, 8, 1, "#00000030")
    return c


def shoe_rack():
    """신발장 2x1 (2단, 신발 4켤레)."""
    c = canvas(2, 1)
    W = 2 * T
    c.rect(1, 2, W - 2, 12, WOOD_DK)
    c.rect(2, 3, W - 4, 10, "#4a3327")
    for sy in (7, 12):
        c.hline(2, W - 3, sy, WOOD)
    shoes = [("#f5efe3", 3, 3), ("#e2605e", 10, 3), ("#3b3540", 18, 3), ("#7fa4c4", 25, 3), ("#8fa585", 3, 8), ("#c96f6f", 12, 8), ("#e0c67b", 21, 8)]
    for col, x, y in shoes:
        c.rect(x, y + 1, 5, 3, col)
        c.px(x + 4, y, col)
    c.rect(1, 14, W - 2, 1, "#00000030")
    return c


def info_sign():
    """안내판 (1x2, 위 타일은 top): 스탠드 위 보드. 글자는 클라이언트."""
    c = canvas(1, 2)
    c.rect(2, 1, 12, 14, "#3d3944")
    c.rect(3, 2, 10, 12, "#f5efe3")
    c.rect(4, 3, 8, 3, "#5b7fb0")
    for y in (8, 10, 12):
        c.hline(4, 11 - (y == 12) * 3, y, "#b9b6b3")
    c.rect(7, 15, 2, 12, METAL_DK)
    c.rect(4, 27, 8, 2, INK)
    return c


# ── 쪽지 · 머그 아이콘 (책상 위 표시용 1x1) ─────────────────────────
def note_icon():
    """접힌 쪽지 (책상 위)."""
    c = canvas(1, 1)
    c.rect(3, 6, 10, 7, "#f5efe3")
    c.frame(3, 6, 10, 7, "#d8d3cc")
    for i in range(5):
        c.px(3 + i, 6 + i, "#e9e4dc")
        c.px(12 - i, 6 + i, "#e9e4dc")
    c.hline(4, 11, 10, "#c9c5bf")
    c.px(8, 8, "#e2605e")
    c.rect(3, 13, 10, 1, "#00000030")
    return c


def mug_icon(kind="americano"):
    """머그 (책상 위) — 아메리카노 · 라떼 · 코코아."""
    c = canvas(1, 1)
    body = {"americano": "#f5efe3", "latte": "#f0dcb0", "cocoa": "#c96f6f"}[kind]
    liquid = {"americano": "#3b2416", "latte": "#c9a06a", "cocoa": "#5a2b1e"}[kind]
    c.rect(4, 5, 7, 8, body)
    c.rect(11, 7, 2, 4, body)
    c.px(12, 8, "#00000000")
    c.rect(5, 6, 5, 1, liquid)
    c.hline(4, 10, 12, "#00000030")
    if kind == "latte":
        c.px(7, 6, "#f5efe3")
    if kind == "cocoa":
        c.px(6, 6, "#f5efe3")
        c.px(8, 6, "#f5efe3")
    # 김
    c.px(6, 3, "#ffffff70")
    c.px(8, 2, "#ffffff60")
    c.px(7, 4, "#ffffff50")
    c.rect(4, 13, 8, 1, "#00000030")
    return c
