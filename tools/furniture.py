"""9단계 가구 상점 스프라이트 (오리지널, 16px 논리 해상도 → 2배).

출력:
  public/assets/furniture.png   아틀라스 (2배 확대, nearest)
  public/assets/furniture.json  Phaser JSON-hash 아틀라스 (frames[key].frame = {x,y,w,h})
  tools/out/furniture_icons.png 아이콘 23개 한 장 (검수용) · tools/out/furniture_preview.png 방 스프라이트 전부

프레임 키 (server/game/shop.js frameKey/iconKey 와 같은 규칙):
  icon/<id>                    32x32 아이콘 (변형이 있으면 icon/<id>/<variant> 도)
  <id>|<variant|->|r<rot>|f<n> 방 안 스프라이트 (rot 1 = 시계 90°, n = 애니 프레임)
  ...|top                      아바타 위에 그리는 오버레이 (침대 이불)

실행: python tools/furniture.py
"""
import json
import os
import sys

from PIL import Image, ImageDraw

sys.path.insert(0, os.path.dirname(__file__))
import props as P  # noqa: E402
import props_v2 as V  # noqa: E402
from pixel import Canvas  # noqa: E402

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "public", "assets")
PREVIEW_DIR = os.path.join(ROOT, "tools", "out")
T = 16
SCALE = 2

WHITE = "#f2ece2"
WHITE_DK = "#cfc8bd"
INK = P.INK
INK_LT = "#5a5460"
METAL = P.METAL
METAL_DK = P.METAL_DK
SHADOW = "#00000040"

MUG = {"red": ("#d9655f", "#b04a45", "#ea8a84"), "blue": ("#6d8fc4", "#4f6f9f", "#8fb0dc"), "green": ("#7fa585", "#5f8565", "#9dc4a0"),
       "yellow": ("#e5c56a", "#c0a04a", "#f2da93"), "pink": ("#e59ab2", "#c47592", "#f2bcd0")}
CUSHION = {"cream": ("#eedcbd", "#d2be98", "#f7ead0"), "sage": ("#8fa585", "#6f8567", "#a8bd9e"), "terra": ("#d9977a", "#b8765c", "#e8b09a"),
           "navy": ("#4f5f88", "#3a4767", "#6c7ea8"), "mustard": ("#d8b04f", "#b08c36", "#e8c877"), "plum": ("#8d6a9c", "#6e4f7c", "#a888b6")}
BED = {"sage": ("#8fa585", "#6f8567", "#a8bd9e"), "blue": ("#8fb3d4", "#6c91b4", "#aecbe6"), "rose": ("#d99aa8", "#b87787", "#e8b8c3")}
LAMP = {"brass": ("#c9a35a", "#9a7a3c", "#e6c88a"), "black": ("#2e2b33", "#1d1b22", "#4a4652"), "white": ("#efe6d6", "#c9c0b0", "#ffffff")}

FRAMES = {}  # key → PIL 이미지 (논리 해상도)
ICON_ORDER = []  # (id, name, variant) — 아이콘 한 장 순서


def add(key, cv):
    FRAMES[key] = cv.im if isinstance(cv, Canvas) else cv


def canvas(w=1, h=1):
    return Canvas(w * T, h * T)


def key(item, variant=None, rot=0, frame=0, suffix=""):
    return f"{item}|{variant or '-'}|r{rot}|f{frame}" + (f"|{suffix}" if suffix else "")


# ── 책상 소품 (1x1) ─────────────────────────────────────────────────────
def mug(color):
    base, dk, hi = MUG[color]
    c = canvas()
    c.rect(4, 7, 7, 7, base)
    c.hline(4, 10, 13, dk)
    c.vline(4, 7, 13, dk)
    c.hline(5, 10, 7, hi)
    c.rect(5, 8, 5, 1, "#5a3a2a")  # 커피 수면
    c.px(6, 8, "#7a5238")
    c.vline(12, 8, 11, dk)  # 손잡이
    c.px(11, 8, dk)
    c.px(11, 11, dk)
    c.px(13, 9, dk)
    c.px(13, 10, dk)
    c.px(6, 5, "#ffffff50")  # 김
    c.px(7, 4, "#ffffff40")
    c.px(8, 5, "#ffffff50")
    c.hline(4, 11, 14, SHADOW)
    return c


def plant_mini():
    c = canvas()
    c.rect(5, 10, 6, 4, P.POT)
    c.hline(5, 10, 10, P.POT_HI)
    c.hline(5, 10, 13, "#8e5c45")
    c.rect(6, 9, 4, 1, "#5a3a2a")
    for x, y, col in [(7, 5, P.LEAF), (8, 5, P.LEAF_LT), (6, 6, P.LEAF_LT), (9, 6, P.LEAF), (7, 7, P.LEAF), (8, 7, P.LEAF_HI), (5, 7, P.LEAF), (10, 7, P.LEAF_LT), (7, 8, P.LEAF_LT), (8, 8, P.LEAF), (8, 4, P.LEAF_HI), (6, 8, P.LEAF), (9, 8, P.LEAF)]:
        c.px(x, y, col)
    c.hline(5, 11, 14, SHADOW)
    return c


def pencil_cup():
    c = canvas()
    pens = [(5, "#e0c67b", "#f0b4a4"), (7, "#c96f6f", "#3b3540"), (9, "#7fa4c4", "#3b3540"), (6, "#8fa585", "#f0b4a4")]
    for x, col, tip in pens:
        c.vline(x, 4, 9, col)
        c.px(x, 3, tip)
    c.px(8, 5, "#5a5460")  # 자
    c.px(8, 6, "#5a5460")
    c.px(8, 7, "#9c9aa0")
    c.rect(4, 8, 8, 6, "#3d3a44")
    c.hline(4, 11, 8, "#55515c")
    c.vline(4, 8, 13, "#2b2930")
    c.rect(5, 10, 6, 2, "#4d4954")
    c.hline(4, 12, 14, SHADOW)
    return c


def sticky_notes():
    c = canvas()
    c.rect(4, 8, 7, 6, "#7fd0b8")
    c.hline(4, 10, 13, "#5fae98")
    c.rect(7, 5, 7, 6, "#f2a9c4")
    c.hline(7, 13, 10, "#d488a6")
    c.rect(3, 4, 7, 6, "#f4d35e")
    c.hline(3, 9, 9, "#d4b23e")
    c.hline(4, 8, 5, "#fbe38a")
    c.hline(4, 7, 6, "#c9a53a")
    c.hline(4, 8, 7, "#c9a53a")
    c.hline(4, 13, 14, SHADOW)
    return c


def desk_lamp(style):
    base, dk, hi = LAMP[style]
    c = canvas()
    # 빛 웅덩이
    c.ellipse(3, 9, 10, 5, "#ffe6b340")
    c.rect(6, 12, 5, 2, dk)  # 받침
    c.hline(6, 10, 12, base)
    c.vline(8, 6, 11, dk)  # 기둥
    c.px(9, 5, dk)
    c.rect(5, 2, 8, 3, base)  # 갓
    c.hline(5, 12, 2, hi)
    c.hline(5, 12, 4, dk)
    c.hline(6, 11, 5, "#fff1c8")
    c.hline(7, 10, 6, "#ffe9b080")
    c.hline(6, 11, 14, SHADOW)
    return c


def figure():
    c = canvas()
    c.rect(5, 12, 6, 2, WHITE_DK)  # 받침
    c.hline(5, 10, 12, WHITE)
    c.rect(6, 8, 4, 4, "#6d8fc4")  # 몸
    c.px(5, 9, "#f2d3b8")  # 팔
    c.px(10, 9, "#f2d3b8")
    c.rect(6, 4, 4, 4, "#f2d3b8")  # 얼굴
    c.rect(6, 3, 4, 1, "#3d3540")  # 머리
    c.px(5, 4, "#3d3540")
    c.px(10, 4, "#3d3540")
    c.px(7, 6, INK)
    c.px(9, 6, INK)
    c.px(8, 2, "#e35d5d")  # 리본
    c.hline(5, 11, 14, SHADOW)
    return c


def desk_frame():
    c = canvas()
    c.rect(3, 4, 10, 9, P.WOOD)
    c.hline(3, 12, 4, P.WOOD_HI)
    c.vline(3, 4, 12, P.WOOD_HI)
    c.rect(4, 5, 8, 7, "#9fc6e6")
    c.rect(4, 9, 8, 3, "#7fa585")
    c.px(6, 8, P.LEAF_LT)
    c.px(9, 8, P.LEAF_LT)
    c.px(10, 6, "#fff1c8")  # 해
    c.px(12, 13, P.WOOD_DK)  # 받침 다리
    c.px(13, 13, P.WOOD_DK)
    c.hline(3, 13, 14, SHADOW)
    return c


def candle(frame):
    c = canvas()
    c.rect(5, 7, 6, 7, "#efe6d6")
    c.vline(5, 7, 13, WHITE_DK)
    c.hline(5, 10, 13, WHITE_DK)
    c.rect(6, 9, 4, 3, "#d9977a")  # 라벨
    c.hline(6, 9, 10, "#e8b09a")
    c.rect(5, 7, 6, 1, "#f7f0e4")
    c.px(8, 6, INK)  # 심지
    if frame == 0:
        c.px(8, 5, "#ffb85c")
        c.px(8, 4, "#ffe6b3")
        c.px(8, 3, "#ffd08a")
        c.px(7, 4, "#ffb85c80")
    else:
        c.px(8, 5, "#ffb85c")
        c.px(9, 4, "#ffe6b3")
        c.px(8, 3, "#ffd08a")
        c.px(9, 3, "#ffb85c80")
    c.rect(6, 1, 4, 1, "#ffe6b320")
    c.hline(5, 11, 14, SHADOW)
    return c


def dual_monitor():
    c = canvas()
    for mx in (0, 8):
        c.rect(mx + 1, 3, 7, 6, V.MONITOR if hasattr(V, "MONITOR") else "#3b3f4c")
        c.rect(mx + 2, 4, 5, 4, "#8fb8d9")
        c.hline(mx + 2, mx + 4, 4, "#c8e2f3")
        c.hline(mx + 3, mx + 5, 6, "#a9d6f2")
        c.rect(mx + 3, 9, 3, 1, INK)
    c.rect(2, 10, 12, 2, INK_LT)  # 받침 바
    c.rect(6, 12, 4, 1, INK)
    c.rect(4, 13, 8, 1, "#9c9aa0")  # 키보드
    c.hline(4, 11, 14, SHADOW)
    return c


def keyboard(frame):
    rgb = ["#ff6b6b", "#f4d35e", "#7fd0b8", "#7fa4c4"]
    c = canvas()
    glow = rgb[frame % 4]
    c.rect(1, 7, 14, 6, "#2e2b33")
    c.hline(1, 14, 7, "#4a4652")
    for row, y in enumerate((8, 10)):
        for i in range(6):
            col = rgb[(i + row + frame) % 4]
            c.rect(2 + i * 2, y, 1, 1, col)
    c.rect(3, 12, 10, 1, "#4a4652")
    c.hline(1, 14, 13, glow)  # 언더글로우
    c.hline(1, 14, 14, glow + "70")
    return c


def speaker():
    c = canvas()
    c.rect(4, 4, 8, 10, "#3d3a44")
    c.hline(4, 11, 4, "#55515c")
    c.vline(4, 4, 13, "#2b2930")
    c.ellipse(6, 6, 4, 4, "#8a8590")  # 유닛
    c.px(7, 7, "#2b2930")
    c.px(8, 7, "#2b2930")
    c.ellipse(6, 10, 4, 3, "#6a6570")
    c.px(10, 12, "#7fd0b8")  # LED
    c.hline(4, 12, 14, SHADOW)
    return c


def fishbowl(frame):
    c = canvas()
    c.ellipse(3, 4, 10, 10, "#c9e6f2")
    c.ellipse(4, 6, 8, 7, "#8fc4e0")
    c.rect(6, 3, 4, 1, WHITE)
    c.rect(5, 12, 6, 2, "#d9c29d")  # 자갈
    c.px(6, 12, "#b8a27a")
    c.px(9, 12, "#b8a27a")
    c.px(4, 5, "#ffffff80")
    c.px(5, 4, "#ffffff60")
    fx = [5, 7, 9][frame % 3]
    fy = [8, 9, 8][frame % 3]
    c.rect(fx, fy, 2, 1, "#f2a04a")  # 물고기
    c.px(fx + 2, fy, "#e07a2a")
    c.px(fx - 1, fy - 1 if frame % 2 else fy + 1, "#f2a04a")
    c.px(11, 7, P.LEAF_LT)  # 수초
    c.px(11, 8, P.LEAF)
    c.hline(4, 12, 14, SHADOW)
    return c


# ── 공용 가구 ────────────────────────────────────────────────────────────
def poster(style):
    c = canvas()
    c.rect(2, 1, 12, 14, "#efe6d6")
    c.frame(2, 1, 12, 14, "#c9c0b0")
    if style == "mountain":
        c.rect(3, 2, 10, 12, "#9fc6e6")
        for i, (x, h) in enumerate([(3, 4), (5, 6), (7, 8), (9, 6), (11, 4)]):
            c.rect(x, 14 - h, 2, h, "#6f8567" if i % 2 else "#8fa585")
        c.px(7, 6, "#f7f0e4")
        c.px(8, 6, "#f7f0e4")
        c.px(11, 3, "#fff1c8")
    elif style == "plant":
        c.rect(6, 10, 4, 3, P.POT)
        for x, y, col in [(7, 5, P.LEAF), (8, 5, P.LEAF_LT), (6, 6, P.LEAF), (9, 6, P.LEAF_LT), (7, 7, P.LEAF_HI), (8, 8, P.LEAF), (5, 7, P.LEAF_LT), (10, 7, P.LEAF), (8, 4, P.LEAF_HI), (7, 9, P.LEAF), (8, 9, P.LEAF_LT)]:
            c.px(x, y, col)
        c.text_center(8, 2, "GROW", "#8fa585", 1, 1)
    elif style == "coffee":
        c.rect(3, 2, 10, 12, "#d9c29d")
        c.rect(5, 6, 5, 5, "#b57a5f")
        c.hline(5, 9, 6, "#cc957a")
        c.vline(10, 7, 9, "#b57a5f")
        c.rect(6, 4, 3, 1, "#ffffff60")
        c.px(6, 3, "#ffffff40")
        c.text_center(8, 12, "CAFE", "#7a4f2c", 1, 1)
    elif style == "moon":
        c.rect(3, 2, 10, 12, "#2e3f6b")
        c.ellipse(7, 4, 5, 5, "#fff1c8")
        c.ellipse(9, 4, 4, 4, "#2e3f6b")
        for x, y in [(4, 4), (5, 9), (11, 10), (10, 3), (6, 12)]:
            c.px(x, y, "#e6ecf7")
    else:  # quote
        c.rect(3, 2, 10, 12, "#f7f0e4")
        c.text_center(8, 4, "DO", "#3b3540", 1, 1)
        c.text_center(8, 10, "IT", "#d9655f", 1, 1)
        c.hline(4, 11, 8, "#c9c0b0")
    c.vline(14, 2, 15, SHADOW)
    c.hline(3, 14, 15, SHADOW)
    return c


def cushion(color):
    base, dk, hi = CUSHION[color]
    c = canvas()
    c.ellipse(2, 9, 12, 5, SHADOW)
    c.rect(3, 3, 10, 9, base)
    c.rect(2, 4, 12, 7, base)
    c.hline(4, 11, 3, hi)
    c.vline(2, 5, 9, hi)
    c.hline(3, 12, 11, dk)
    c.vline(13, 5, 10, dk)
    c.px(7, 7, dk)  # 단추
    c.px(8, 7, dk)
    c.px(3, 4, hi)
    c.px(12, 10, dk)
    return c


def rug_small(w=3, h=2):
    return V.rug_fancy(w, h, base="#d6b8b2", border="#9b6a66", border2="#c19a95", pattern="diamond", accent="#c6a5a0")


def floor_lamp():
    c = canvas(1, 2)
    # 삼각대
    c.vline(8, 9, 23, INK)
    for i in range(7):  # 삼각대 다리
        c.px(8 - i, 23 + i, INK)
        c.px(8 + i, 23 + i, INK)
        c.px(8, 23 + i, INK_LT)
    c.hline(2, 14, 30, "#00000050")
    # 갓 (패브릭 크림)
    c.rect(4, 2, 9, 7, "#efe6d6")
    c.hline(4, 12, 2, "#f7f0e4")
    c.vline(4, 2, 8, "#f7f0e4")
    c.hline(4, 12, 8, "#cfc8bd")
    c.vline(12, 3, 8, "#cfc8bd")
    c.hline(5, 11, 9, "#ffe6b3")
    c.rect(6, 10, 5, 1, "#ffe6b380")
    c.rect(7, 11, 3, 1, "#ffe6b340")
    return c


def wall_clock(style):
    c = canvas()
    if style == "round":
        c.ellipse(3, 2, 10, 10, INK)
        c.ellipse(4, 3, 8, 8, "#efe6d6")
        c.px(7, 4, INK)
        c.px(8, 4, INK)
        c.px(7, 9, INK)
        c.px(4, 6, INK)
        c.px(11, 6, INK)
        c.vline(7, 5, 7, INK)  # 시침
        c.hline(8, 9, 7, "#d9655f")  # 분침
        c.px(8, 12, INK)
    elif style == "square":
        c.rect(3, 2, 10, 11, P.WOOD)
        c.hline(3, 12, 2, P.WOOD_HI)
        c.rect(4, 3, 8, 8, "#f7f0e4")
        c.px(7, 4, P.WOOD_DK)
        c.px(7, 10, P.WOOD_DK)
        c.px(4, 7, P.WOOD_DK)
        c.px(11, 7, P.WOOD_DK)
        c.vline(7, 5, 7, INK)
        c.hline(8, 10, 7, "#d9655f")
        c.rect(5, 11, 6, 1, P.WOOD_DK)
    else:  # cat
        c.ellipse(4, 3, 8, 8, "#2e2b33")
        c.px(4, 2, "#2e2b33")  # 귀
        c.px(5, 2, "#2e2b33")
        c.px(10, 2, "#2e2b33")
        c.px(11, 2, "#2e2b33")
        c.ellipse(5, 4, 6, 6, "#efe6d6")
        c.px(6, 6, INK)
        c.px(9, 6, INK)
        c.vline(7, 5, 7, INK)
        c.hline(8, 9, 7, "#d9655f")
        c.vline(8, 11, 14, "#2e2b33")  # 꼬리 추
        c.px(9, 14, "#2e2b33")
        c.px(7, 12, "#2e2b33")
    return c


def bookshelf_fill():
    c = canvas()
    spines = ["#c96f6f", "#7fa4c4", "#e0c67b", "#8fa585", "#d9977a", "#a08bc4", "#f2ece2", "#6f8a9a"]
    x = 1
    i = 0
    while x < 15:
        w = 2 if i % 3 else 1
        h = 9 + (i * 5) % 4
        c.rect(x, 15 - h, w, h, spines[i % len(spines)])
        c.hline(x, x + w - 1, 15 - h, "#ffffff40")
        c.px(x, 15 - h + 2, "#00000030")
        x += w
        i += 1
    c.hline(1, 14, 15, "#00000050")
    return c


def blanket(w=2):
    c = canvas(w, 1)
    W = w * T
    base, dk, hi = "#d9977a", "#b8765c", "#e8b09a"
    c.rect(2, 5, W - 4, 9, base)
    c.hline(3, W - 4, 5, hi)
    c.hline(2, W - 3, 13, dk)
    c.vline(W - 3, 6, 13, dk)
    for y in (7, 10):  # 주름
        c.hline(4, W - 5, y, dk + "80")
    for x in range(3, W - 3, 3):  # 술
        c.px(x, 14, dk)
    c.hline(2, 12, 3, base)  # 접힌 귀퉁이
    c.rect(2, 3, 10, 2, hi)
    return c


def coffee_upgrade(frame):
    c = canvas(1, 2)
    c.blit(P.backbar_upper(3), 0, 0)
    # 크롬 에스프레소 머신 (위 타일: 본체 상부 + 김, 아래 타일: 하부 + 그룹헤드 + 컵 2개)
    c.rect(2, 5, 12, 11, "#8a8590")
    c.rect(2, 5, 12, 2, "#b8b4bf")
    c.vline(2, 5, 15, "#d6d3da")
    c.vline(13, 6, 15, "#5a5660")
    c.rect(4, 8, 8, 3, "#3d3a44")  # 패널
    c.px(5, 9, "#7fd0a0")
    c.px(7, 9, "#e35d5d")
    c.rect(9, 9, 2, 1, "#ffe6b3")
    c.rect(0, 16, 16, 12, "#e2d8c8")
    c.hline(0, 15, 16, "#efe8db")
    c.rect(0, 28, 16, 4, "#8a6f58")
    c.rect(2, 16, 12, 5, "#8a8590")
    c.rect(2, 16, 12, 1, "#b8b4bf")
    c.rect(4, 21, 2, 2, "#5a5660")  # 그룹헤드
    c.rect(10, 21, 2, 2, "#5a5660")
    c.rect(3, 23, 4, 3, WHITE)  # 컵
    c.rect(9, 23, 4, 3, WHITE)
    c.px(7, 24, WHITE)
    c.px(13, 24, WHITE)
    c.rect(2, 26, 12, 1, "#b8b4bf")  # 트레이
    # 김 (프레임마다 다르게)
    puffs = [[(5, 3), (6, 2), (11, 3)], [(6, 2), (7, 1), (10, 2), (11, 1)], [(5, 2), (7, 0), (10, 1), (12, 2)]][frame % 3]
    for x, y in puffs:
        c.px(x, y, "#ffffff90")
        c.px(x + 1, y - 1, "#ffffff50")
    return c


def beanbag(frame=0):
    base, dk, hi = "#7c8fbf", "#5a6b96", "#9cadd6"
    c = canvas(1, 2)
    c.ellipse(1, 22, 14, 8, SHADOW)
    c.ellipse(1, 8, 14, 20, dk)
    c.ellipse(1, 6, 14, 20, base)
    c.ellipse(3, 8, 10, 6, hi)  # 등받이 하이라이트
    c.ellipse(3, 16, 10, 8, dk + "80")  # 앉는 자리 눌림
    c.ellipse(4, 17, 8, 6, base)
    c.px(2, 12, hi)
    c.px(12, 24, dk)
    return c


def massage_chair(frame):
    dy = 1 if frame else 0
    c = canvas(1, 2)
    body, dk, hi = "#3d3a44", "#26232b", "#55515c"
    c.rect(2, 29, 12, 2, INK)  # 받침
    c.hline(2, 13, 31, "#00000050")
    y0 = 2 + dy
    c.rect(3, y0, 10, 12, body)  # 등받이
    c.hline(3, 12, y0, hi)
    c.rect(5, y0 + 1, 6, 3, dk)  # 헤드레스트
    c.hline(5, 10, y0 + 1, hi)
    c.rect(4, y0 + 5, 8, 6, dk + "80")  # 안마 볼 자국
    c.px(6, y0 + 6, hi)
    c.px(9, y0 + 6, hi)
    c.px(6, y0 + 9, hi)
    c.px(9, y0 + 9, hi)
    c.rect(1, y0 + 12, 14, 10, body)  # 좌석
    c.hline(1, 14, y0 + 12, hi)
    c.rect(1, y0 + 10, 3, 12, dk)  # 팔걸이
    c.rect(12, y0 + 10, 3, 12, dk)
    c.hline(1, 3, y0 + 10, hi)
    c.hline(12, 14, y0 + 10, hi)
    c.rect(12, y0 + 12, 2, 3, "#7fd0a0")  # 조작 패널
    c.px(13, y0 + 13, "#e35d5d")
    c.rect(4, y0 + 22, 8, 5, dk)  # 발받침
    c.hline(4, 11, y0 + 22, body)
    return c


def bed(color, top=False):
    base, dk, hi = BED[color]
    c = canvas(1, 2)
    if not top:
        c.rect(0, 1, 16, 30, P.WOOD)  # 프레임
        c.hline(0, 15, 1, P.WOOD_HI)
        c.rect(0, 0, 16, 2, P.WOOD_DK)  # 헤드보드
        c.hline(0, 15, 0, P.WOOD_LT)
        c.rect(1, 3, 14, 27, WHITE)  # 매트리스
        c.vline(14, 3, 29, WHITE_DK)
        c.hline(1, 14, 29, WHITE_DK)
        c.rect(3, 4, 10, 5, "#f7f0e4")  # 베개
        c.frame(3, 4, 10, 5, "#e2d8c8")
        c.px(4, 5, "#ffffff")
        c.hline(0, 15, 31, "#00000050")
    # 이불 (아래 절반 — 누운 아바타의 얼굴·어깨는 보이고 몸은 덮인다). top 프레임은 이불만 → 아바타 위에 그린다
    # 아바타는 머리가 큰 치비라(얼굴이 프레임 가운데) 이불은 아래 1/3 만 덮는다
    c.rect(1, 21, 14, 8, base)
    c.hline(1, 14, 21, hi)
    c.hline(2, 13, 22, hi + "80")
    c.vline(14, 22, 28, dk)
    c.hline(1, 14, 28, dk)
    c.hline(3, 12, 25, dk + "60")
    c.rect(1, 19, 14, 2, hi)  # 접힌 윗단
    c.hline(1, 14, 20, dk + "60")
    return c


def rotated(cv, rot):
    """시계 방향 90° x rot 회전 (픽셀 손실 없음)"""
    im = cv.im if isinstance(cv, Canvas) else cv
    return im.rotate(-90 * rot, expand=True)


# ── 등록 ────────────────────────────────────────────────────────────────
def build():
    desk_items = [
        ("mug", "머그컵", {v: mug(v) for v in MUG}),
        ("plant_mini", "작은 화분", {None: plant_mini()}),
        ("pencil_cup", "연필꽂이", {None: pencil_cup()}),
        ("sticky_notes", "포스트잇 뭉치", {None: sticky_notes()}),
        ("desk_lamp", "탁상 램프", {v: desk_lamp(v) for v in LAMP}),
        ("figure", "미니 피규어", {None: figure()}),
        ("desk_frame", "탁상 액자", {None: desk_frame()}),
        ("candle", "향초", {None: [candle(0), candle(1)]}),
        ("dual_monitor", "듀얼 모니터", {None: dual_monitor()}),
        ("keyboard", "기계식 키보드", {None: [keyboard(i) for i in range(4)]}),
        ("speaker", "미니 스피커", {None: speaker()}),
        ("fishbowl", "어항", {None: [fishbowl(i) for i in range(3)]}),
    ]
    shared_items = [
        ("poster", "벽 포스터", {v: poster(v) for v in ("mountain", "plant", "coffee", "moon", "quote")}),
        ("cushion", "쿠션", {v: cushion(v) for v in CUSHION}),
        ("rug_small", "작은 러그", {None: rug_small()}),
        ("floor_lamp", "스탠드 조명", {None: floor_lamp()}),
        ("wall_clock", "벽시계", {v: wall_clock(v) for v in ("round", "square", "cat")}),
        ("bookshelf_fill", "책장 채우기", {None: bookshelf_fill()}),
        ("blanket", "라운지 담요", {None: blanket()}),
        ("coffee_upgrade", "커피머신 업그레이드", {None: [coffee_upgrade(i) for i in range(3)]}),
        ("beanbag", "빈백 소파", {None: beanbag()}),
        ("massage_chair", "안마의자", {None: [massage_chair(0), massage_chair(1)]}),
        ("bed", "1인용 침대", {v: bed(v) for v in BED}),
    ]
    rotatable = {"rug_small", "bed"}
    for item_id, name, variants in desk_items + shared_items:
        first = True
        for variant, frames in variants.items():
            frames = frames if isinstance(frames, list) else [frames]
            for fi, cv in enumerate(frames):
                add(key(item_id, variant, 0, fi), cv)
                if item_id in rotatable:
                    add(key(item_id, variant, 1, fi), rotated(cv, 1))
            if item_id == "bed":
                add(key(item_id, variant, 0, 0, "top"), bed(variant, top=True))
                add(key(item_id, variant, 1, 0, "top"), rotated(bed(variant, top=True), 1))
            icon = make_icon(frames[0])
            if variant:
                add(f"icon/{item_id}/{variant}", icon)
            if first:
                add(f"icon/{item_id}", icon)
                ICON_ORDER.append((item_id, name, variant))
                first = False


def make_icon(cv):
    """32x32 아이콘: 1x1 은 2배, 그보다 크면 1배(논리 픽셀)로 가운데, 32 를 넘으면 축소"""
    im = cv.im if isinstance(cv, Canvas) else cv
    out = Image.new("RGBA", (32, 32), (0, 0, 0, 0))
    if im.width <= 16 and im.height <= 16:
        im2 = im.resize((im.width * 2, im.height * 2), Image.NEAREST)
    elif im.width <= 32 and im.height <= 32:
        im2 = im
    else:
        k = min(32 / im.width, 32 / im.height)
        im2 = im.resize((max(1, int(im.width * k)), max(1, int(im.height * k))), Image.LANCZOS)
    out.alpha_composite(im2, ((32 - im2.width) // 2, (32 - im2.height) // 2))
    return out


def pack():
    """선반(shelf) 패킹: 높이순 정렬, 폭 512 (2배 스케일 픽셀 기준)"""
    items = sorted(FRAMES.items(), key=lambda kv: (-kv[1].height, -kv[1].width, kv[0]))
    MAXW = 512
    x = y = row_h = 0
    placed = {}
    scale_of = lambda k: 1 if k.startswith("icon/") else SCALE  # 아이콘은 이미 32x32 완성본
    for k, im in items:
        w, h = im.width * scale_of(k), im.height * scale_of(k)
        if x + w > MAXW:
            x = 0
            y += row_h
            row_h = 0
        placed[k] = (x, y, w, h)
        x += w
        row_h = max(row_h, h)
    H = y + row_h
    atlas = Image.new("RGBA", (MAXW, H), (0, 0, 0, 0))
    frames = {}
    for k, im in FRAMES.items():
        px, py, w, h = placed[k]
        atlas.alpha_composite(im if (w, h) == im.size else im.resize((w, h), Image.NEAREST), (px, py))
        frames[k] = {"frame": {"x": px, "y": py, "w": w, "h": h}, "rotated": False, "trimmed": False, "spriteSourceSize": {"x": 0, "y": 0, "w": w, "h": h}, "sourceSize": {"w": w, "h": h}}
    os.makedirs(OUT, exist_ok=True)
    atlas.save(os.path.join(OUT, "furniture.png"), optimize=True)
    data = {"frames": frames, "meta": {"app": "tools/furniture.py", "image": "furniture.png", "format": "RGBA8888", "size": {"w": MAXW, "h": H}, "scale": "1", "tileSize": T * SCALE}}
    with open(os.path.join(OUT, "furniture.json"), "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, separators=(",", ":"))
    print(f"furniture atlas: {len(frames)} frames, {atlas.size}")


def preview():
    os.makedirs(PREVIEW_DIR, exist_ok=True)
    # 아이콘 23개 한 장 (4배)
    cols = 6
    cell = 36 * 4
    rows = (len(ICON_ORDER) + cols - 1) // cols
    im = Image.new("RGBA", (cols * cell, rows * (cell + 24)), (30, 27, 36, 255))
    d = ImageDraw.Draw(im)
    for i, (item_id, name, variant) in enumerate(ICON_ORDER):
        x, y = (i % cols) * cell, (i // cols) * (cell + 24)
        d.rectangle([x + 6, y + 6, x + cell - 6, y + cell - 6], fill=(44, 40, 52, 255), outline=(90, 84, 100, 255))
        ic = FRAMES[f"icon/{item_id}"].resize((128, 128), Image.NEAREST)
        im.alpha_composite(ic, (x + 8, y + 8))
        d.text((x + 8, y + cell - 2), f"{i + 1:02d} {item_id}", fill=(241, 230, 210, 255))
    im.save(os.path.join(PREVIEW_DIR, "furniture_icons.png"))
    # 방 스프라이트 전부 (2배)
    keys = [k for k in FRAMES if not k.startswith("icon/")]
    cols = 10
    cw, ch = 3 * T * SCALE + 8, 3 * T * SCALE + 20
    rows = (len(keys) + cols - 1) // cols
    im = Image.new("RGBA", (cols * cw, rows * ch), (60, 58, 66, 255))
    d = ImageDraw.Draw(im)
    floor = V.floor_plank(0).im.resize((T * SCALE, T * SCALE), Image.NEAREST)
    for i, k in enumerate(keys):
        x, y = (i % cols) * cw, (i // cols) * ch
        fr = FRAMES[k]
        big = fr.resize((fr.width * SCALE, fr.height * SCALE), Image.NEAREST)
        for fy in range(0, big.height, T * SCALE):
            for fx in range(0, big.width, T * SCALE):
                im.alpha_composite(floor, (x + 4 + fx, y + 4 + fy))
        im.alpha_composite(big, (x + 4, y + 4))
        d.text((x + 4, y + ch - 14), k[:22], fill=(255, 240, 200, 255))
    im.save(os.path.join(PREVIEW_DIR, "furniture_preview.png"))


if __name__ == "__main__":
    build()
    pack()
    preview()
