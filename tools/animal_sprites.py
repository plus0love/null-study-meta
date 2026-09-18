"""14단계 동물 스프라이트 시트 (오리지널, 32x32 논리 → 2배 = 64px 프레임).

출력:
  public/assets/animals.png / animals.json  12종 x 6프레임. 프레임 = species.index * 6 + f
      f 0 walk_a · 1 walk_b · 2 idle · 3 eat · 4 sleep · 5 sit (새·나비는 fly)
      전부 왼쪽을 본다 — 오른쪽은 클라이언트가 flipX. 위/아래도 옆모습으로 그린다 (종별 2~3프레임 규격).
  tools/out/s14_animals_row.png  12종 한 줄 (검수용 · README)
동물원: panda lion giraffe penguin guinea_pig flamingo monkey elephant / 자유 동물: duck squirrel pigeon butterfly
(토끼·고양이는 10단계 펫 시트(pets.png)의 것을 그대로 쓴다)
실행: python tools/animal_sprites.py
"""
import json
import os
import sys

from PIL import Image, ImageDraw

sys.path.insert(0, os.path.dirname(__file__))
from pixel import Canvas  # noqa: E402

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "public", "assets")
PREVIEW_DIR = os.path.join(ROOT, "tools", "out")
S = 32
SCALE = 2
FRAMES = ["walk_a", "walk_b", "idle", "eat", "sleep", "sit"]
EYE = "#2b2530"
Z = "#f1e6d2"
GROUND = 30  # 발바닥 y

SPECIES = ["panda", "lion", "giraffe", "penguin", "guinea_pig", "flamingo", "monkey", "elephant", "duck", "squirrel", "pigeon", "butterfly"]
NAMES = {"panda": "판다", "lion": "사자", "giraffe": "기린", "penguin": "펭귄", "guinea_pig": "기니피그", "flamingo": "플라밍고", "monkey": "원숭이",
         "elephant": "코끼리", "duck": "오리", "squirrel": "다람쥐", "pigeon": "비둘기", "butterfly": "나비"}


def canvas():
    return Canvas(S, S)


def zz(c, x, y):
    c.px(x, y, Z)
    c.px(x + 1, y - 1, Z)
    c.px(x + 2, y - 2, Z)
    c.px(x + 3, y - 3, Z)


def legs(c, xs, y_top, h, col, frame, spread=0):
    """다리: frame 0/1 은 앞뒤로 엇갈림, 2 는 나란히."""
    for i, x in enumerate(xs):
        dx = 0
        if frame == 0:
            dx = -spread if i % 2 == 0 else spread
        elif frame == 1:
            dx = spread if i % 2 == 0 else -spread
        c.rect(x + dx, y_top, 2, h, col)


# ── 종별 그리기 ─────────────────────────────────────────────────────────
def panda(f):
    W, B = "#f2eee6", "#2b2530"
    c = canvas()
    if f == 4:  # 잠: 옆으로 누움
        c.ellipse(6, 18, 20, 11, W)
        c.ellipse(4, 16, 10, 9, W)
        c.rect(3, 15, 3, 3, B)
        c.rect(10, 15, 3, 3, B)
        c.hline(5, 7, 20, B)
        c.ellipse(8, 22, 14, 6, B)
        c.rect(16, 25, 5, 3, B)
        zz(c, 20, 14)
        return c
    if f == 5:  # 앉아서 대나무
        c.ellipse(9, 13, 16, 16, W)
        c.ellipse(10, 20, 14, 8, B)
        c.ellipse(13, 19, 8, 6, W)
        c.rect(7, 22, 5, 6, B)
        c.rect(20, 22, 5, 6, B)
        c.ellipse(8, 5, 14, 12, W)
        c.rect(7, 3, 4, 4, B)
        c.rect(19, 3, 4, 4, B)
        c.rect(9, 9, 3, 3, B)
        c.rect(17, 9, 3, 3, B)
        c.px(10, 10, Z)
        c.px(18, 10, Z)
        c.rect(13, 12, 3, 2, B)
        c.vline(5, 8, 20, "#6fa04a")
        c.px(4, 9, "#8fbf62")
        c.px(6, 12, "#8fbf62")
        c.rect(6, 17, 4, 3, B)
        return c
    # 옆모습 (왼쪽): 몸통 흰색 + 검은 다리·어깨띠, 머리 흰 + 검은 귀·눈
    dy = 1 if f == 1 else 0
    c.ellipse(9, 13 + dy, 19, 13, W)
    c.rect(11, 14 + dy, 6, 11, B)  # 어깨 띠
    legs(c, [10, 14, 20, 24], 24 + dy, GROUND - 24 - dy, B, f if f < 2 else 2, spread=1)
    hy = 8 if f != 3 else 12
    c.ellipse(2, hy, 13, 11, W)
    c.rect(3, hy - 1, 3, 3, B)
    c.rect(11, hy - 1, 3, 3, B)
    c.rect(4, hy + 3, 3, 3, B)
    c.px(5, hy + 4, Z)
    c.rect(2, hy + 7, 3, 2, B)
    if f == 3:
        c.vline(1, 14, 28, "#6fa04a")
        c.px(0, 16, "#8fbf62")
    return c


def lion(f):
    F, M, D = "#d9a35e", "#9c5a2a", "#b8823f"
    c = canvas()
    if f == 4:
        c.ellipse(8, 18, 20, 10, F)
        c.ellipse(1, 12, 15, 14, M)
        c.ellipse(4, 15, 9, 8, F)
        c.hline(5, 7, 19, EYE)
        c.px(4, 20, "#5e3a26")
        c.rect(24, 22, 5, 3, F)
        c.rect(27, 20, 3, 3, M)
        zz(c, 21, 13)
        return c
    if f == 5:
        c.ellipse(8, 14, 16, 14, F)
        c.rect(8, 24, 4, 5, D)
        c.rect(20, 24, 4, 5, D)
        c.ellipse(3, 2, 18, 17, M)
        c.ellipse(6, 5, 12, 11, F)
        c.px(8, 9, EYE)
        c.px(14, 9, EYE)
        c.rect(10, 12, 3, 2, "#5e3a26")
        c.rect(24, 16, 3, 8, F)
        c.rect(25, 14, 3, 3, M)
        return c
    dy = 1 if f == 1 else 0
    c.ellipse(10, 14 + dy, 18, 11, F)
    legs(c, [11, 15, 21, 25], 23 + dy, GROUND - 23 - dy, D, f if f < 2 else 2, spread=1)
    c.rect(27, 12 + dy, 3, 10, F)  # 꼬리
    c.rect(28, 10 + dy, 3, 3, M)
    hy = 6 if f != 3 else 11
    c.ellipse(0, hy - 2, 16, 15, M)  # 갈기
    c.ellipse(3, hy + 1, 10, 9, F)
    c.px(5, hy + 4, EYE)
    c.rect(3, hy + 7, 3, 2, "#5e3a26")
    return c


def giraffe(f):
    Y, D, H = "#e8c27a", "#b0763a", "#c9a25c"
    c = canvas()
    if f == 4:
        c.ellipse(8, 20, 20, 9, Y)
        for x, y in ((11, 22), (17, 24), (23, 22)):
            c.rect(x, y, 3, 2, D)
        c.rect(6, 12, 3, 10, Y)
        c.ellipse(2, 9, 9, 6, Y)
        c.hline(3, 5, 11, EYE)
        c.px(4, 6, D)
        c.px(8, 6, D)
        zz(c, 20, 14)
        return c
    dy = 1 if f == 1 else 0
    c.ellipse(11, 16 + dy, 16, 9, Y)
    for x, y in ((13, 17), (18, 19), (22, 17), (16, 22)):
        c.rect(x, y + dy, 3, 2, D)
    legs(c, [12, 16, 21, 25], 24 + dy, GROUND - 24 - dy, H, f if f < 2 else 2, spread=1)
    c.rect(26, 14 + dy, 2, 6, D)  # 꼬리
    # 목 + 머리 (먹기 프레임은 목을 앞으로 숙임)
    if f == 3:
        for i in range(10):
            c.rect(9 - i, 12 + i, 3, 3, Y)
        c.ellipse(0, 20, 9, 6, Y)
        c.px(2, 22, EYE)
        c.px(0, 19, D)
        c.rect(6, 16, 2, 2, D)
    elif f == 5:
        c.rect(9, 6 + dy, 4, 12, Y)
        c.rect(10, 8, 2, 2, D)
        c.rect(10, 12, 2, 2, D)
        c.ellipse(5, 2, 10, 7, Y)
        c.px(7, 5, EYE)
        c.px(6, 1, D)
        c.px(10, 1, D)
        c.px(4, 6, "#8a5a2a")
    else:
        c.rect(9, 3 + dy, 4, 15, Y)
        c.rect(10, 6 + dy, 2, 2, D)
        c.rect(10, 11 + dy, 2, 2, D)
        c.ellipse(4, 0 + dy, 10, 7, Y)
        c.px(6, 3 + dy, EYE)
        c.px(5, -1 + dy, D)
        c.px(10, -1 + dy, D)
        c.px(5, 0 + dy, D)
        c.px(10, 0 + dy, D)
        c.px(3, 4 + dy, "#8a5a2a")
    return c


def penguin(f):
    K, W2, O = "#2b2d3a", "#f4f1ea", "#f2a04a"
    c = canvas()
    if f == 4:  # 배 깔고 자기
        c.ellipse(6, 20, 20, 8, K)
        c.ellipse(9, 22, 14, 5, W2)
        c.ellipse(2, 18, 9, 8, K)
        c.hline(3, 5, 22, EYE)
        c.rect(0, 23, 3, 2, O)
        zz(c, 22, 14)
        return c
    if f == 5:  # 미끄러지기 (배)
        c.ellipse(4, 20, 24, 8, K)
        c.ellipse(8, 23, 16, 4, W2)
        c.ellipse(0, 17, 9, 8, K)
        c.px(3, 20, EYE)
        c.rect(0, 22, 3, 2, O)
        c.rect(6, 17, 6, 2, K)
        return c
    dy = 1 if f == 1 else 0
    c.ellipse(9, 8 + dy, 14, 20, K)
    c.ellipse(11, 12 + dy, 9, 14, W2)
    c.rect(20, 12 + dy, 3, 9, K)  # 날개
    lx = [11, 17]
    for i, x in enumerate(lx):
        dx = 0 if f == 2 else (-1 if (i + f) % 2 else 1)
        c.rect(x + dx, 27, 4, 2, O)
    c.px(13, 10 + dy, EYE)
    by = 12 if f != 3 else 15
    c.rect(7, by + dy, 4, 2, O)
    if f == 3:
        c.ellipse(2, 24, 5, 4, "#7fb0d0")  # 물고기
    return c


def guinea_pig(f):
    F, D, W2 = "#c98a55", "#8a5a30", "#f3e6d0"
    c = canvas()
    if f == 4:
        c.ellipse(7, 19, 19, 10, F)
        c.ellipse(4, 20, 9, 8, W2)
        c.hline(6, 8, 23, EYE)
        c.px(4, 24, "#e9a8a8")
        zz(c, 21, 13)
        return c
    dy = 1 if f == 1 else 0
    c.ellipse(6, 15 + dy, 20, 13, F)
    c.ellipse(4, 16 + dy, 9, 11, W2)
    c.ellipse(14, 17 + dy, 8, 8, D)
    for i, x in enumerate([9, 14, 20]):
        dx = 0 if f >= 2 else (-1 if (i + f) % 2 else 1)
        c.rect(x + dx, 27, 3, 3, D)
    ey = 19 if f != 3 else 21
    c.px(6, ey + dy, EYE)
    c.px(3, ey + 2 + dy, "#e9a8a8")
    c.rect(8, 13 + dy, 3, 3, F)  # 귀
    c.px(9, 14 + dy, "#e9a8a8")
    if f == 3:
        c.rect(1, 25, 4, 2, "#8fbf62")
    return c


def flamingo(f):
    P, PD, K = "#f08aa0", "#d86a86", "#2b2530"
    c = canvas()
    if f == 4:  # 한 다리로 서서 머리를 날개에
        c.ellipse(9, 12, 15, 9, P)
        c.rect(15, 21, 2, 9, PD)
        c.ellipse(11, 9, 7, 5, P)
        c.rect(9, 11, 3, 2, K)
        zz(c, 22, 8)
        return c
    dy = 1 if f == 1 else 0
    c.ellipse(9, 12 + dy, 15, 9, P)
    c.ellipse(12, 12 + dy, 9, 5, PD)
    if f == 5:
        c.rect(15, 21, 2, 9, PD)
    else:
        legs(c, [13, 18], 21 + dy, GROUND - 21 - dy, PD, f if f < 2 else 2, spread=1)
    if f == 3:
        for i in range(8):
            c.rect(9 - i, 12 + i, 2, 2, P)
        c.ellipse(0, 20, 7, 5, P)
        c.rect(0, 24, 3, 2, K)
        c.px(2, 22, EYE)
    else:
        for i in range(9):
            c.rect(10 - i // 2, 12 - i, 2, 2, P)
        c.ellipse(3, 1, 8, 6, P)
        c.rect(1, 4, 3, 2, K)
        c.px(5, 3, EYE)
    return c


def monkey(f):
    B, L, D = "#8a5a3a", "#e8c8a8", "#5e3a26"
    c = canvas()
    if f == 4:
        c.ellipse(7, 19, 19, 10, B)
        c.ellipse(3, 16, 11, 10, B)
        c.ellipse(5, 19, 7, 5, L)
        c.hline(6, 8, 20, EYE)
        c.rect(24, 16, 2, 8, B)
        c.px(25, 15, B)
        zz(c, 21, 12)
        return c
    if f == 5:  # 앉아서 바나나
        c.ellipse(9, 14, 14, 13, B)
        c.ellipse(11, 18, 9, 7, L)
        c.rect(8, 24, 4, 5, D)
        c.rect(19, 24, 4, 5, D)
        c.ellipse(8, 4, 13, 11, B)
        c.ellipse(10, 7, 9, 7, L)
        c.px(12, 9, EYE)
        c.px(16, 9, EYE)
        c.rect(6, 6, 3, 3, B)
        c.rect(19, 6, 3, 3, B)
        c.rect(22, 12, 2, 12, B)
        c.px(23, 11, B)
        c.rect(3, 12, 4, 2, "#f4d35e")
        c.px(2, 13, "#f4d35e")
        return c
    dy = 1 if f == 1 else 0
    c.ellipse(9, 15 + dy, 15, 10, B)
    c.ellipse(11, 18 + dy, 9, 5, L)
    legs(c, [11, 20], 24 + dy, GROUND - 24 - dy, D, f if f < 2 else 2, spread=1)
    c.rect(24, 8 + dy, 2, 12, B)  # 꼬리
    c.px(25, 7 + dy, B)
    c.px(26, 8 + dy, B)
    hy = 7 if f != 3 else 11
    c.ellipse(2, hy, 12, 10, B)
    c.ellipse(3, hy + 3, 8, 6, L)
    c.px(5, hy + 5, EYE)
    c.rect(11, hy + 2, 3, 3, B)
    c.px(12, hy + 3, L)
    if f == 3:
        c.rect(0, 25, 4, 2, "#f4d35e")
    return c


def elephant(f):
    G, GD, T2 = "#9a9fb0", "#767b8c", "#e8e0d0"
    c = canvas()
    if f == 4:
        c.ellipse(5, 15, 24, 13, G)
        c.ellipse(1, 14, 12, 11, G)
        c.rect(0, 20, 3, 8, G)
        c.hline(4, 6, 18, EYE)
        c.rect(6, 21, 6, 2, GD)
        zz(c, 24, 9)
        return c
    dy = 1 if f == 1 else 0
    c.ellipse(9, 9 + dy, 21, 15, G)
    legs(c, [11, 15, 22, 26], 22 + dy, GROUND - 22 - dy, GD, f if f < 2 else 2, spread=1)
    c.rect(29, 12 + dy, 2, 7, GD)  # 꼬리
    c.ellipse(1, 7 + dy, 13, 12, G)
    c.ellipse(0, 9 + dy, 6, 8, GD)  # 귀
    c.px(6, 12 + dy, EYE)
    c.rect(6, 17 + dy, 4, 1, T2)  # 상아
    # 코 (먹기: 앞으로 뻗어 물웅덩이/풀)
    if f == 3:
        for i in range(8):
            c.rect(2 - i // 3, 17 + i, 3, 2, G)
        c.ellipse(0, 26, 8, 3, "#7fa4c4")
    elif f == 5:
        for i in range(6):
            c.rect(2 + i // 2, 17 + i, 3, 2, G)
        c.px(5, 24, "#7fa4c4")
        c.px(6, 22, "#7fa4c4")
    else:
        for i in range(9):
            c.rect(2, 17 + i + dy, 3, 2, G)
        c.px(3, 26 + dy, GD)
    return c


def duck(f):
    Y, O, W2 = "#f4d35e", "#f2a04a", "#fbe38a"
    c = canvas()
    if f == 4:
        c.ellipse(8, 18, 16, 9, Y)
        c.ellipse(6, 16, 8, 7, Y)
        c.hline(7, 9, 19, EYE)
        c.rect(4, 20, 3, 2, O)
        zz(c, 20, 12)
        return c
    dy = 1 if f == 1 else 0
    c.ellipse(8, 15 + dy, 17, 10, Y)
    c.ellipse(11, 16 + dy, 9, 5, W2)
    c.rect(22, 14 + dy, 4, 3, Y)  # 꼬리
    if f == 5:  # 물 위 (다리 없음, 물결)
        c.hline(4, 26, 25, "#8fb8d4")
        c.hline(6, 24, 26, "#c9e2ef")
    else:
        for i, x in enumerate([11, 16]):
            dx = 0 if f >= 2 else (-1 if (i + f) % 2 else 1)
            c.rect(x + dx, 25, 3, 4, O)
    hy = 8 if f != 3 else 13
    c.ellipse(4, hy + dy, 9, 8, Y)
    c.px(6, hy + 3 + dy, EYE)
    c.rect(1, hy + 4 + dy, 4, 2, O)
    return c


def squirrel(f):
    B, L, D = "#b8743a", "#e8c8a8", "#8a5028"
    c = canvas()
    if f == 4:
        c.ellipse(8, 20, 16, 9, B)
        c.ellipse(5, 18, 8, 8, B)
        c.hline(6, 8, 21, EYE)
        c.ellipse(18, 12, 12, 10, D)
        zz(c, 22, 8)
        return c
    if f == 5:  # 앉아서 도토리
        c.ellipse(8, 15, 12, 13, B)
        c.ellipse(10, 19, 8, 7, L)
        c.rect(8, 25, 4, 4, D)
        c.rect(16, 25, 4, 4, D)
        c.ellipse(6, 6, 11, 10, B)
        c.px(9, 10, EYE)
        c.rect(6, 4, 2, 3, B)
        c.rect(14, 4, 2, 3, B)
        c.ellipse(17, 4, 12, 16, D)
        c.ellipse(19, 6, 8, 12, B)
        c.rect(3, 13, 4, 4, "#9c6b3a")
        c.rect(4, 12, 2, 1, "#5e3a26")
        return c
    dy = 1 if f == 1 else 0
    c.ellipse(7, 17 + dy, 15, 9, B)
    c.ellipse(9, 20 + dy, 9, 4, L)
    legs(c, [9, 17], 25 + dy, GROUND - 25 - dy, D, f if f < 2 else 2, spread=1)
    c.ellipse(17, 6 + dy, 13, 16, D)  # 풍성한 꼬리
    c.ellipse(19, 8 + dy, 9, 12, B)
    hy = 11 if f != 3 else 15
    c.ellipse(1, hy + dy, 10, 9, B)
    c.px(3, hy + 3 + dy, EYE)
    c.rect(4, hy - 2 + dy, 2, 3, B)
    c.rect(8, hy - 2 + dy, 2, 3, B)
    if f == 3:
        c.rect(0, 27, 3, 2, "#9c6b3a")
    return c


def pigeon(f):
    G, GD, W2, O = "#8c8f9c", "#5f6270", "#c9ccd6", "#e07a2a"
    c = canvas()
    if f == 4:
        c.ellipse(9, 20, 14, 8, G)
        c.ellipse(7, 18, 7, 6, G)
        c.hline(8, 9, 20, EYE)
        zz(c, 21, 13)
        return c
    if f == 5:  # 날기: 날개 펼침
        c.ellipse(9, 12, 14, 7, G)
        c.rect(4, 6, 8, 3, GD)
        c.rect(2, 4, 4, 3, GD)
        c.rect(19, 6, 8, 3, GD)
        c.rect(25, 4, 4, 3, GD)
        c.rect(22, 13, 5, 2, GD)
        c.ellipse(5, 9, 7, 6, G)
        c.px(7, 11, EYE)
        c.rect(3, 12, 3, 1, O)
        return c
    dy = 1 if f == 1 else 0
    c.ellipse(9, 17 + dy, 14, 8, G)
    c.ellipse(12, 16 + dy, 8, 5, GD)
    c.rect(22, 18 + dy, 5, 2, GD)
    for i, x in enumerate([12, 17]):
        dx = 0 if f >= 2 else (-1 if (i + f) % 2 else 1)
        c.rect(x + dx, 25, 2, 4, O)
    hy = 12 if f != 3 else 16
    c.ellipse(5, hy + dy, 7, 6, G)
    c.px(7, hy + 2 + dy, EYE)
    c.rect(3, hy + 3 + dy, 3, 1, O)
    c.px(8, hy + 5 + dy, "#7fa4c4")  # 목 깃 (보라빛)
    return c


def butterfly(f):
    W1, W2, B = "#f4c37a", "#f08aa0", "#3b3540"
    c = canvas()
    # 날개 각도: walk_a/idle 펼침, walk_b/fly 접음
    fold = f in (1, 5)
    if fold:
        c.ellipse(11, 8, 6, 12, W1)
        c.ellipse(16, 8, 6, 12, W1)
        c.ellipse(12, 10, 4, 6, W2)
        c.ellipse(17, 10, 4, 6, W2)
    else:
        c.ellipse(4, 6, 12, 11, W1)
        c.ellipse(17, 6, 12, 11, W1)
        c.ellipse(6, 14, 9, 8, W2)
        c.ellipse(18, 14, 9, 8, W2)
        c.px(8, 9, W2)
        c.px(23, 9, W2)
        c.px(9, 17, W1)
        c.px(21, 17, W1)
    c.rect(15, 8, 3, 13, B)
    c.px(14, 6, B)
    c.px(18, 6, B)
    c.px(13, 5, B)
    c.px(19, 5, B)
    if f == 4:  # 꽃 위에서 쉬기 (날개 접고 아래에 꽃)
        c.rect(12, 22, 9, 3, "#5f8a5c")
        c.ellipse(11, 19, 11, 5, "#f2a0b0")
    return c


DRAW = {"panda": panda, "lion": lion, "giraffe": giraffe, "penguin": penguin, "guinea_pig": guinea_pig, "flamingo": flamingo, "monkey": monkey,
        "elephant": elephant, "duck": duck, "squirrel": squirrel, "pigeon": pigeon, "butterfly": butterfly}


def build():
    cols = len(FRAMES)
    sheet = Image.new("RGBA", (cols * S, len(SPECIES) * S), (0, 0, 0, 0))
    for si, sp in enumerate(SPECIES):
        for fi in range(cols):
            fr = DRAW[sp](fi)
            sheet.alpha_composite(fr.im, (fi * S, si * S))
    big = sheet.resize((sheet.width * SCALE, sheet.height * SCALE), Image.NEAREST)
    os.makedirs(OUT, exist_ok=True)
    big.save(os.path.join(OUT, "animals.png"), optimize=True)
    meta = {
        "frameWidth": S * SCALE, "frameHeight": S * SCALE, "framesPerSpecies": cols, "frames": {n: i for i, n in enumerate(FRAMES)},
        "species": {sp: {"index": i, "name": NAMES[sp], "fly": sp in ("pigeon", "butterfly")} for i, sp in enumerate(SPECIES)},
    }
    with open(os.path.join(OUT, "animals.json"), "w", encoding="utf-8") as f:
        json.dump(meta, f, ensure_ascii=False, separators=(",", ":"))
    # 검수용 한 줄 (idle 프레임 + 이름), 잔디 배경
    os.makedirs(PREVIEW_DIR, exist_ok=True)
    cell = S * SCALE + 16
    row = Image.new("RGBA", (len(SPECIES) * cell + 16, S * SCALE + 44), (125, 156, 102, 255))
    d = ImageDraw.Draw(row)
    for i, sp in enumerate(SPECIES):
        fr = DRAW[sp](2).im.resize((S * SCALE, S * SCALE), Image.NEAREST)
        row.alpha_composite(fr, (8 + i * cell, 6))
        d.text((8 + i * cell + 8, S * SCALE + 14), NAMES[sp], fill=(30, 26, 34, 255))
    row.save(os.path.join(PREVIEW_DIR, "s14_animals_row.png"))
    # 전체 프레임 미리보기 (검수용)
    full = big.copy()
    full.save(os.path.join(PREVIEW_DIR, "s14_animals_sheet.png"))
    print("animals:", big.size, len(SPECIES), "species x", cols, "frames")


if __name__ == "__main__":
    build()
