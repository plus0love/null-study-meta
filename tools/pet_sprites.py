"""10단계 펫 스프라이트 + 펫 꾸미기 아틀라스 (오리지널, 강아지 규격 16x24 논리 → 2배).

출력:
  public/assets/pets.png / pets.json   12종 x (6행 x 2프레임). 한 장에 가로로 이어 붙임: 프레임 = row*24 + species*2 + frame
                                       행: 0 down 1 right 2 up 3 left 4 sit 5 sleep. species 0 = 기존 갈색 푸들(dog_sprite.py)
                                       pets.json 에 종별 앵커(head/face/neck/back — 프레임 안 논리 px, 행마다)
  public/assets/petdeco.png / .json    꾸미기 8종 (색 변형 포함) x 3 뷰(front/side/back) [x 2프레임(날개)] Phaser 아틀라스
                                       키: deco/<id>[/<variant>]/<view>/f<n>
  tools/out/pets_row.png               12종 한 줄 (검수용) · tools/out/petdeco_preview.png
실행: python tools/pet_sprites.py
"""
import json
import os
import sys

from PIL import Image, ImageDraw

sys.path.insert(0, os.path.dirname(__file__))
import dog_sprite as DOG  # noqa: E402
from pixel import Canvas  # noqa: E402

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "public", "assets")
PREVIEW_DIR = os.path.join(ROOT, "tools", "out")
W, H, SCALE = 16, 24, 2
ROWS = ["down", "right", "up", "left", "sit", "sleep"]
EYE = "#3b3540"
Z = "#f1e6d2"

# 종 목록 (index 순서 = 시트 순서)
SPECIES = ["dog", "hamster", "chick", "turtle", "rabbit", "cat", "maltese", "poodle_black", "shiba", "parrot", "slime", "fish"]
NAMES = {"dog": "푸들", "hamster": "햄스터", "chick": "병아리", "turtle": "거북이", "rabbit": "토끼", "cat": "고양이", "maltese": "말티즈",
         "poodle_black": "검정 푸들", "shiba": "시바", "parrot": "앵무새", "slime": "슬라임", "fish": "물고기"}


def canvas():
    return Canvas(W, H)


def mirror_canvas(c):
    out = canvas()
    out.im = c.im.transpose(Image.FLIP_LEFT_RIGHT)
    out.px_ = out.im.load()
    return out


def zz(c, x, y):
    c.px(x, y, Z)
    c.px(x + 1, y - 1, Z)
    c.px(x + 2, y - 2, Z)


# ── 문자 격자 기반 (푸들 계열: 팔레트만 바꾼다) ────────────────────────
def grid_frames(pal):
    rows = DOG.frame_rows()
    out = []
    for frames in rows:
        fr = []
        for f in frames:
            c = canvas()
            for y, row in enumerate(f):
                for x, ch in enumerate(row):
                    if ch != ".":
                        c.px(x, y, pal.get(ch, DOG.PAL[ch]))
            fr.append(c)
        out.append(fr)
    return out


POODLE_ANCHORS = {
    "down": {"head": (8, 1), "face": (8, 6), "neck": (8, 13), "back": (8, 15)},
    "right": {"head": (8, 5), "face": (11, 9), "neck": (9, 12), "back": (7, 14)},
    "up": {"head": (8, 1), "face": (8, 6), "neck": (8, 13), "back": (8, 15)},
    "left": {"head": (8, 5), "face": (5, 9), "neck": (7, 12), "back": (9, 14)},
    "sit": {"head": (8, 1), "face": (8, 6), "neck": (8, 13), "back": (8, 15)},
    "sleep": {"head": (7, 13), "face": (4, 18), "neck": (8, 17), "back": (10, 16)},
}

MALTESE = {"F": "#f2ece2", "H": "#ffffff", "D": "#cfc8bd", "L": "#f7f0e4", "l": "#ffffff", "R": "#e59ab2", "y": "#f2bcd0", "P": "#e9a8a8"}
POODLE_BLACK = {"F": "#3a3540", "H": "#524b58", "D": "#26232b", "L": "#6a6270", "l": "#5a5460", "R": "#7fa4c4", "y": "#c9e6f2", "E": "#0d0912", "N": "#0d0912"}


# ── 절차 그리기 (작은 동물) ───────────────────────────────────────────
class Quad:
    """작은 네발 동물 템플릿. 종마다 색·귀·꼬리·무늬를 바꾼다. 앵커도 같이 만든다."""

    def __init__(self, fur, hi, dk, belly, ear="pointy", ear_in="#e9a8a8", tail="long", nose="#3b3540", stripes=None, mask=None, cheek=None):
        self.fur, self.hi, self.dk, self.belly = fur, hi, dk, belly
        self.ear, self.ear_in, self.tail, self.nose, self.stripes, self.mask, self.cheek = ear, ear_in, tail, nose, stripes, mask, cheek
        self.anchors = {}

    def ears(self, c, cx, top, view):
        e = self.ear
        if e == "pointy":
            for sx in (-4, 3):
                c.px(cx + sx, top - 1, self.fur)
                c.rect(cx + sx, top, 2, 2, self.fur)
                if view != "up":
                    c.px(cx + sx + (1 if sx < 0 else 0), top + 1, self.ear_in)
        elif e == "round":
            for sx in (-5, 3):
                c.rect(cx + sx, top - 1, 3, 3, self.fur)
                c.px(cx + sx + 1, top, self.ear_in if view != "up" else self.hi)
        elif e == "long":
            for sx in (-4, 3):
                c.rect(cx + sx, top - 6, 2, 7, self.fur)
                c.vline(cx + sx + (1 if sx < 0 else 0), top - 5, top - 1, self.ear_in if view != "up" else self.hi)
        elif e == "floppy":
            for sx in (-6, 5):
                c.rect(cx + sx, top + 1, 2, 5, self.dk)
                c.px(cx + sx, top, self.fur)
        elif e == "fold":  # 시바: 세모 귀, 안쪽 크림
            for sx in (-5, 3):
                c.px(cx + sx + 1, top - 2, self.fur)
                c.rect(cx + sx, top - 1, 3, 2, self.fur)
                if view != "up":
                    c.px(cx + sx + 1, top, self.belly)

    def face(self, c, cx, cy):
        c.px(cx - 2, cy, EYE)
        c.px(cx + 2, cy, EYE)
        if self.mask:
            c.rect(cx - 2, cy + 1, 5, 3, self.mask)
        c.px(cx, cy + 2, self.nose)
        if self.cheek:
            c.px(cx - 4, cy + 1, self.cheek)
            c.px(cx + 4, cy + 1, self.cheek)

    def pattern(self, c, x0, y0, w, h):
        if self.stripes:
            for i in range(0, w, 3):
                c.vline(x0 + i + 1, y0 + 1, y0 + h - 2, self.stripes)

    def front(self, frame, back=False):
        c = canvas()
        # 몸 (아래) 8x7, 머리(위) 10x9
        c.ellipse(4, 12, 8, 8, self.fur)
        c.hline(5, 10, 19, self.dk)
        if not back:
            c.ellipse(6, 14, 4, 4, self.belly)
        legs = [(4, 18), (9, 18)] if frame == 0 else [(4, 18), (9, 17)]
        for lx, ly in legs:
            c.rect(lx, ly, 3, 24 - ly, self.dk)
            c.px(lx + 1, ly, self.fur)
        if back and self.tail != "none":
            if self.tail == "curl":
                c.rect(7, 11, 2, 2, self.hi)
                c.px(9, 10, self.hi)
            elif self.tail == "puff":
                c.ellipse(6, 11, 4, 3, self.hi)
            else:
                c.vline(8, 9, 12, self.hi)
                c.px(9, 8, self.hi)
        c.ellipse(3, 4, 10, 9, self.fur)
        c.hline(5, 10, 4, self.hi)
        self.pattern(c, 4, 5, 8, 6)
        self.ears(c, 8, 4, "up" if back else "down")
        if not back:
            self.face(c, 8, 8)
        return c

    def side(self, frame):
        """왼쪽을 본다."""
        c = canvas()
        # 몸 12x7 (y 13..19), 머리 8x8 왼쪽 위 (x 0..7, y 7..14)
        c.ellipse(4, 12, 12, 8, self.fur)
        c.hline(5, 13, 19, self.dk)
        c.ellipse(6, 15, 6, 3, self.belly)
        self.pattern(c, 6, 13, 9, 6)
        legs = [(5, 18), (11, 18)] if frame == 0 else [(4, 18), (12, 17)]
        for lx, ly in legs:
            c.rect(lx, ly, 3, 24 - ly, self.dk)
        if self.tail == "curl":
            c.rect(13, 10, 2, 3, self.hi)
            c.px(15, 11, self.hi)
        elif self.tail == "puff":
            c.ellipse(13, 11, 3, 3, self.hi)
        elif self.tail == "long":
            c.vline(14, 9, 13, self.hi)
            c.px(15, 8, self.hi)
            c.px(15, 7, self.hi)
        c.ellipse(0, 6, 9, 8, self.fur)
        c.hline(2, 7, 6, self.hi)
        self.ears(c, 4, 6, "side")
        c.px(2, 9, EYE)
        if self.mask:
            c.rect(0, 10, 3, 3, self.mask)
        c.px(0, 11, self.nose)
        if self.cheek:
            c.px(4, 11, self.cheek)
        return c

    def sit(self, frame):
        c = canvas()
        c.ellipse(4, 13, 8, 9, self.fur)
        c.ellipse(6, 16, 4, 5, self.belly)
        c.hline(5, 10, 21, self.dk)
        c.rect(4, 20, 3, 3, self.dk)
        c.rect(9, 20, 3, 3, self.dk)
        tx = 12 if frame == 0 else 3
        if self.tail == "curl":
            c.rect(tx, 17, 2, 2, self.hi)
        elif self.tail == "puff":
            c.ellipse(tx, 18, 3, 3, self.hi)
        elif self.tail == "long":
            c.hline(tx, tx + 2, 21, self.hi)
            c.px(tx + (3 if frame == 0 else -1), 20, self.hi)
        c.ellipse(3, 5, 10, 9, self.fur)
        c.hline(5, 10, 5, self.hi)
        self.pattern(c, 4, 6, 8, 6)
        self.ears(c, 8, 5, "down")
        self.face(c, 8, 9)
        return c

    def sleep(self, frame):
        c = canvas()
        y0 = 15 if frame == 0 else 14
        c.ellipse(2, y0, 13, 8, self.fur)
        c.hline(3, 13, y0 + 7, self.dk)
        self.pattern(c, 5, y0 + 1, 8, 5)
        c.ellipse(0, y0 - 1, 8, 7, self.fur)
        c.hline(2, 5, y0 - 1, self.hi)
        self.ears(c, 4, y0 - 1, "side")
        c.hline(1, 2, y0 + 2, EYE)  # 감은 눈
        c.px(0, y0 + 3, self.nose)
        if frame == 1:
            zz(c, 9, 12)
        return c

    def build(self):
        rows = {
            "down": [self.front(0), self.front(1)],
            "up": [self.front(0, back=True), self.front(1, back=True)],
            "left": [self.side(0), self.side(1)],
            "sit": [self.sit(0), self.sit(1)],
            "sleep": [self.sleep(0), self.sleep(1)],
        }
        rows["right"] = [mirror_canvas(x) for x in rows["left"]]
        top = 4 - (6 if self.ear == "long" else 1 if self.ear in ("pointy", "fold") else 1)
        anchors = {
            "down": {"head": (8, top), "face": (8, 8), "neck": (8, 12), "back": (8, 13)},
            "up": {"head": (8, top), "face": (8, 8), "neck": (8, 12), "back": (8, 13)},
            "left": {"head": (4, top + 2), "face": (2, 9), "neck": (6, 13), "back": (10, 12)},
            "right": {"head": (11, top + 2), "face": (13, 9), "neck": (9, 13), "back": (5, 12)},
            "sit": {"head": (8, top + 1), "face": (8, 9), "neck": (8, 13), "back": (8, 14)},
            "sleep": {"head": (4, 13 - (6 if self.ear == "long" else 1)), "face": (2, 17), "neck": (6, 17), "back": (9, 15)},
        }
        return rows, anchors


def hamster():
    def blob(frame, view):
        c = canvas()
        fur, hi, dk, belly = "#d9a066", "#e8bb85", "#b8804a", "#f2ddb8"
        dy = 0 if frame == 0 else -1
        c.ellipse(2, 12 + dy, 12, 10, fur)
        c.hline(3, 13, 21 + dy, dk)
        if view in ("down", "sit", "left"):
            c.ellipse(5, 16 + dy, 6, 5, belly)
        c.rect(4, 21, 3, 2, dk)
        c.rect(9, 21, 3, 2, dk)
        for sx in (3, 11):
            c.rect(sx, 10 + dy, 3, 3, fur)
            c.px(sx + 1, 11 + dy, "#e9a8a8" if view != "up" else hi)
        if view == "down" or view == "sit":
            c.px(6, 15 + dy, EYE)
            c.px(10, 15 + dy, EYE)
            c.px(8, 16 + dy, "#e9a8a8")
            c.px(4, 17 + dy, "#f2c4c4")  # 볼
            c.px(12, 17 + dy, "#f2c4c4")
        elif view == "left":
            c.px(4, 15 + dy, EYE)
            c.px(2, 16 + dy, "#e9a8a8")
            c.px(4, 17 + dy, "#f2c4c4")
        return c

    def sleep(frame):
        c = canvas()
        fur, dk = "#d9a066", "#b8804a"
        c.ellipse(2, 15, 12, 8, fur)
        c.hline(3, 13, 22, dk)
        c.rect(3, 13, 3, 3, fur)
        c.hline(5, 6, 18, EYE)
        c.px(3, 19, "#e9a8a8")
        if frame == 1:
            zz(c, 10, 13)
        return c
    rows = {"down": [blob(0, "down"), blob(1, "down")], "up": [blob(0, "up"), blob(1, "up")], "left": [blob(0, "left"), blob(1, "left")],
            "sit": [blob(0, "sit"), blob(0, "sit")], "sleep": [sleep(0), sleep(1)]}
    rows["right"] = [mirror_canvas(x) for x in rows["left"]]
    a = {"head": (8, 10), "face": (8, 15), "neck": (8, 19), "back": (8, 13)}
    anchors = {"down": a, "up": a, "sit": a, "left": {"head": (7, 10), "face": (4, 15), "neck": (6, 19), "back": (9, 13)},
               "right": {"head": (8, 10), "face": (11, 15), "neck": (9, 19), "back": (6, 13)}, "sleep": {"head": (5, 13), "face": (5, 18), "neck": (7, 21), "back": (9, 16)}}
    return rows, anchors


def chick():
    Y, YH, YD, BEAK, LEG = "#f4d35e", "#fbe38a", "#d4b23e", "#f2a04a", "#e07a2a"

    def body(frame, view):
        c = canvas()
        dy = 0 if frame == 0 else -1
        c.ellipse(4, 11 + dy, 9, 9, Y)
        c.hline(5, 11, 19 + dy, YD)
        c.ellipse(5, 7 + dy, 7, 6, Y)
        c.hline(6, 10, 7 + dy, YH)
        c.px(8, 6 + dy, YD)  # 머리 깃
        # 날개
        wx = (3, 12) if frame == 0 else (2, 13)
        c.rect(wx[0], 13 + dy, 2, 3, YD)
        c.rect(wx[1], 13 + dy, 2, 3, YD)
        # 다리
        c.vline(6, 20, 23, LEG)
        c.vline(10, 20, 23, LEG)
        c.px(5, 23, LEG)
        c.px(11, 23, LEG)
        if view == "down":
            c.px(7, 9 + dy, EYE)
            c.px(10, 9 + dy, EYE)
            c.rect(8, 10 + dy, 2, 1, BEAK)
        elif view == "left":
            c.px(6, 9 + dy, EYE)
            c.rect(4, 10 + dy, 2, 1, BEAK)
        return c

    def sleep(frame):
        c = canvas()
        c.ellipse(3, 14, 10, 8, Y)
        c.hline(4, 11, 21, YD)
        c.ellipse(4, 12, 6, 5, Y)
        c.hline(5, 6, 14, EYE)
        c.rect(3, 15, 2, 1, BEAK)
        if frame == 1:
            zz(c, 10, 12)
        return c
    rows = {"down": [body(0, "down"), body(1, "down")], "up": [body(0, "up"), body(1, "up")], "left": [body(0, "left"), body(1, "left")],
            "sit": [body(0, "down"), body(0, "down")], "sleep": [sleep(0), sleep(1)]}
    rows["right"] = [mirror_canvas(x) for x in rows["left"]]
    a = {"head": (8, 6), "face": (8, 9), "neck": (8, 12), "back": (8, 13)}
    anchors = {"down": a, "up": a, "sit": a, "left": {"head": (7, 6), "face": (5, 9), "neck": (7, 12), "back": (9, 13)},
               "right": {"head": (8, 6), "face": (10, 9), "neck": (8, 12), "back": (6, 13)}, "sleep": {"head": (6, 11), "face": (5, 14), "neck": (7, 17), "back": (9, 15)}}
    return rows, anchors


def turtle():
    S, SH, SD, SK, SKD = "#6f8567", "#8fa585", "#4f6349", "#a8bd7a", "#7f9455"

    def top(frame, view):
        c = canvas()
        dx = 0 if frame == 0 else 1
        # 다리 4개 (프레임마다 앞뒤 교대)
        for (lx, ly) in ((2, 12 + dx), (12, 12 - dx), (2, 19 - dx), (12, 19 + dx)):
            c.rect(lx, ly, 3, 3, SKD)
        c.ellipse(3, 10, 10, 11, SD)
        c.ellipse(3, 9, 10, 11, S)
        c.ellipse(5, 11, 6, 7, SH)
        c.frame(6, 12, 4, 5, S)
        if view == "down":
            c.rect(6, 6, 4, 5, SK)
            c.px(6, 8, EYE)
            c.px(9, 8, EYE)
        elif view == "up":
            c.rect(6, 6, 4, 4, SK)
            c.rect(7, 20, 2, 2, SK)
        return c

    def side(frame):
        c = canvas()
        dx = 0 if frame == 0 else 1
        c.rect(4 + dx, 19, 3, 4, SKD)
        c.rect(10 - dx, 19, 3, 4, SKD)
        c.ellipse(3, 12, 11, 8, SD)
        c.ellipse(3, 11, 11, 8, S)
        c.ellipse(5, 12, 7, 5, SH)
        c.rect(0, 15, 5, 4, SK)
        c.px(1, 16, EYE)
        c.px(14, 16, SK)
        return c

    def sleep(frame):
        c = canvas()
        c.ellipse(3, 13, 11, 8, SD)
        c.ellipse(3, 12, 11, 8, S)
        c.ellipse(5, 13, 7, 5, SH)
        c.rect(1, 17, 3, 3, SK)  # 머리 살짝
        c.hline(1, 2, 18, EYE)
        if frame == 1:
            zz(c, 11, 11)
        return c
    rows = {"down": [top(0, "down"), top(1, "down")], "up": [top(0, "up"), top(1, "up")], "left": [side(0), side(1)],
            "sit": [top(0, "down"), top(0, "down")], "sleep": [sleep(0), sleep(1)]}
    rows["right"] = [mirror_canvas(x) for x in rows["left"]]
    a = {"head": (8, 5), "face": (8, 8), "neck": (8, 10), "back": (8, 13)}
    anchors = {"down": a, "up": a, "sit": a, "left": {"head": (2, 13), "face": (1, 16), "neck": (4, 16), "back": (8, 13)},
               "right": {"head": (13, 13), "face": (14, 16), "neck": (11, 16), "back": (7, 13)}, "sleep": {"head": (2, 15), "face": (2, 18), "neck": (4, 18), "back": (8, 14)}}
    return rows, anchors


def parrot():
    G, GH, GD, R, YB, BEAK, LEG = "#5f9e5c", "#8ac785", "#3f7a3f", "#d9655f", "#f4d35e", "#f2a04a", "#7a5238"

    def stand(frame, view):
        c = canvas()
        dy = 0 if frame == 0 else -1
        c.ellipse(4, 10 + dy, 8, 10, G)
        c.hline(5, 10, 19 + dy, GD)
        if view != "up":
            c.ellipse(6, 13 + dy, 4, 5, YB)
        # 날개 (프레임 1 은 살짝 들림)
        c.rect(3, 12 + dy - (1 if frame else 0), 2, 5, GD)
        c.rect(11, 12 + dy - (1 if frame else 0), 2, 5, GD)
        c.rect(6, 20 + dy, 4, 3, R)  # 꼬리 (아래로)
        c.ellipse(5, 5 + dy, 6, 6, G)
        c.rect(6, 5 + dy, 4, 2, R)  # 붉은 머리깃
        if view == "down":
            c.px(6, 8 + dy, EYE)
            c.px(9, 8 + dy, EYE)
            c.rect(7, 9 + dy, 2, 2, BEAK)
        elif view == "left":
            c.px(6, 8 + dy, EYE)
            c.rect(4, 9 + dy, 2, 2, BEAK)
        c.vline(6, 22, 23, LEG)
        c.vline(9, 22, 23, LEG)
        return c

    def sleep(frame):
        c = canvas()
        c.ellipse(4, 13, 8, 9, G)
        c.hline(5, 10, 21, GD)
        c.ellipse(5, 10, 6, 5, G)
        c.rect(6, 10, 4, 1, R)
        c.hline(6, 7, 12, EYE)
        c.rect(4, 13, 2, 2, BEAK)
        if frame == 1:
            zz(c, 11, 10)
        return c
    rows = {"down": [stand(0, "down"), stand(1, "down")], "up": [stand(0, "up"), stand(1, "up")], "left": [stand(0, "left"), stand(1, "left")],
            "sit": [stand(0, "down"), stand(0, "down")], "sleep": [sleep(0), sleep(1)]}
    rows["right"] = [mirror_canvas(x) for x in rows["left"]]
    a = {"head": (8, 4), "face": (8, 8), "neck": (8, 11), "back": (8, 12)}
    anchors = {"down": a, "up": a, "sit": a, "left": {"head": (8, 4), "face": (5, 8), "neck": (7, 11), "back": (9, 12)},
               "right": {"head": (7, 4), "face": (10, 8), "neck": (8, 11), "back": (6, 12)}, "sleep": {"head": (8, 9), "face": (6, 12), "neck": (8, 15), "back": (9, 14)}}
    return rows, anchors


def slime():
    B, BH, BD = "#7fd0b8", "#b3ebd9", "#4fae94"

    def blob(frame, view):
        c = canvas()
        if frame == 0:
            c.ellipse(2, 12, 12, 11, BD)
            c.ellipse(2, 11, 12, 11, B)
            c.ellipse(4, 12, 5, 3, BH)
        else:  # 찌그러짐 (착지)
            c.ellipse(1, 15, 14, 8, BD)
            c.ellipse(1, 14, 14, 8, B)
            c.ellipse(3, 15, 6, 2, BH)
        ey = 16 if frame == 0 else 17
        if view == "down":
            c.px(5, ey, EYE)
            c.px(10, ey, EYE)
            c.hline(7, 8, ey + 2, BD)
        elif view == "left":
            c.px(4, ey, EYE)
        return c

    def sleep(frame):
        c = canvas()
        c.ellipse(1, 16, 14, 7, BD)
        c.ellipse(1, 15, 14, 7, B)
        c.hline(4, 5, 18, EYE)
        c.hline(10, 11, 18, EYE)
        if frame == 1:
            zz(c, 11, 13)
        return c
    rows = {"down": [blob(0, "down"), blob(1, "down")], "up": [blob(0, "up"), blob(1, "up")], "left": [blob(0, "left"), blob(1, "left")],
            "sit": [blob(0, "down"), blob(0, "down")], "sleep": [sleep(0), sleep(1)]}
    rows["right"] = [mirror_canvas(x) for x in rows["left"]]
    a = {"head": (8, 11), "face": (8, 16), "neck": (8, 20), "back": (8, 14)}
    anchors = {"down": a, "up": a, "sit": a, "left": {"head": (7, 11), "face": (4, 16), "neck": (7, 20), "back": (9, 14)},
               "right": {"head": (8, 11), "face": (11, 16), "neck": (8, 20), "back": (6, 14)}, "sleep": {"head": (8, 15), "face": (8, 18), "neck": (8, 21), "back": (8, 17)}}
    return rows, anchors


def fish():
    """어항 속 금붕어 (어항은 프레임에 포함, 물고기는 프레임/방향마다 자리가 다르다)."""
    GL, WATER, WHI, F, FD, SAND = "#c9e6f2", "#8fc4e0", "#f2ece2", "#f2a04a", "#e07a2a", "#d9c29d"

    def bowl(fx, fy, flip, tail_up):
        c = canvas()
        c.ellipse(2, 8, 12, 14, GL)
        c.ellipse(3, 10, 10, 11, WATER)
        c.rect(5, 7, 6, 2, WHI)
        c.rect(4, 19, 8, 2, SAND)
        c.px(4, 11, "#ffffff80")
        c.px(5, 10, "#ffffff60")
        c.px(11, 15, "#7fa585")  # 수초
        c.px(11, 16, "#5f8a5c")
        # 물고기 (4x3) + 꼬리
        c.rect(fx, fy, 3, 2, F)
        c.px(fx + (3 if not flip else -1), fy + (0 if tail_up else 1), FD)
        c.px(fx + (0 if not flip else 2), fy, EYE)
        return c
    left = [bowl(5, 13, False, False), bowl(5, 14, False, True)]
    right = [mirror_canvas(x) for x in left]
    rows = {"left": left, "right": right, "down": [bowl(6, 12, False, False), bowl(6, 13, True, True)], "up": [bowl(6, 15, True, False), bowl(6, 14, False, True)],
            "sit": [bowl(6, 14, False, False), bowl(6, 14, False, True)], "sleep": [bowl(6, 17, False, False), bowl(6, 17, False, False)]}
    a = {"head": (8, 7), "face": (8, 13), "neck": (8, 16), "back": (8, 12)}
    anchors = {k: a for k in ROWS}
    return rows, anchors


def build_species():
    out = {}
    out["dog"] = (dict(zip(ROWS, grid_frames({}))), POODLE_ANCHORS)
    out["maltese"] = (dict(zip(ROWS, grid_frames(MALTESE))), POODLE_ANCHORS)
    out["poodle_black"] = (dict(zip(ROWS, grid_frames(POODLE_BLACK))), POODLE_ANCHORS)
    out["hamster"] = hamster()
    out["chick"] = chick()
    out["turtle"] = turtle()
    out["rabbit"] = Quad("#efe6d6", "#ffffff", "#cfc8bd", "#ffffff", ear="long", ear_in="#f2c4c4", tail="puff", nose="#e9a8a8", cheek="#f2c4c4").build()
    out["cat"] = Quad("#d9a066", "#e8bb85", "#b8804a", "#f2ddb8", ear="pointy", ear_in="#e9a8a8", tail="long", nose="#e9a8a8", stripes="#b8804a").build()
    out["shiba"] = Quad("#e0964f", "#f0b070", "#b8722f", "#f7ead0", ear="fold", tail="curl", nose="#3b3540", mask="#f7ead0").build()
    out["parrot"] = parrot()
    out["slime"] = slime()
    out["fish"] = fish()
    return out


# ── 꾸미기 (front / side(왼쪽 보기) / back) ─────────────────────────────
RIBBON = {"red": ("#d9655f", "#ea8a84"), "pink": ("#e59ab2", "#f2bcd0"), "blue": ("#6d8fc4", "#8fb0dc"), "yellow": ("#e5c56a", "#f2da93")}
COLLAR = {"red": ("#c94f4f", "#e0c67b"), "blue": ("#4f6f9f", "#c9e6f2"), "green": ("#5f8565", "#e0c67b"), "purple": ("#8d6a9c", "#f2bcd0")}
SCARF = {"red": ("#d9655f", "#b04a45"), "navy": ("#4f5f88", "#3a4767"), "mustard": ("#d8b04f", "#b08c36"), "sage": ("#8fa585", "#6f8567")}
DECO_ITEMS = ["ribbon", "collar", "scarf", "straw_hat", "beanie", "glasses", "crown", "wings"]
DECO_SLOT = {"ribbon": "head", "collar": "neck", "scarf": "neck", "straw_hat": "head", "beanie": "head", "glasses": "face", "crown": "head", "wings": "back"}
DECO_VARIANTS = {"ribbon": list(RIBBON), "collar": list(COLLAR), "scarf": list(SCARF)}


def deco_canvas(w=16, h=12):
    return Canvas(w, h)


def deco_frames(item, variant=None):
    """{ view: [Canvas...] } — 캔버스 가운데(8,6) 가 앵커 위치."""
    c3 = lambda: (deco_canvas(), deco_canvas(), deco_canvas())
    if item == "ribbon":
        base, hi = RIBBON[variant]
        f, s, b = c3()
        for c, cx in ((f, 8), (s, 6), (b, 8)):
            c.rect(cx - 3, 4, 3, 3, base)
            c.rect(cx + 1, 4, 3, 3, base)
            c.px(cx, 5, hi)
            c.px(cx - 2, 4, hi)
            c.px(cx + 2, 4, hi)
        return {"front": [f], "side": [s], "back": [b]}
    if item == "collar":
        base, gem = COLLAR[variant]
        f, s, b = c3()
        f.rect(3, 5, 10, 2, base)
        f.px(8, 7, gem)
        s.rect(4, 5, 7, 2, base)
        s.px(5, 7, gem)
        b.rect(3, 5, 10, 2, base)
        return {"front": [f], "side": [s], "back": [b]}
    if item == "scarf":
        base, dk = SCARF[variant]
        f, s, b = c3()
        f.rect(3, 4, 10, 3, base)
        f.hline(3, 12, 6, dk)
        f.rect(9, 7, 2, 4, base)
        f.px(10, 10, dk)
        s.rect(4, 4, 7, 3, base)
        s.hline(4, 10, 6, dk)
        s.rect(3, 6, 2, 4, base)
        b.rect(3, 4, 10, 3, base)
        b.hline(3, 12, 6, dk)
        return {"front": [f], "side": [s], "back": [b]}
    if item == "straw_hat":
        f, s, b = c3()
        for c in (f, s, b):
            c.rect(1, 6, 14, 2, "#d9c29d")
            c.hline(1, 14, 7, "#b8a27a")
            c.rect(4, 2, 8, 4, "#e5c56a")
            c.hline(4, 11, 2, "#f2da93")
            c.hline(4, 11, 5, "#d9655f")
        return {"front": [f], "side": [s], "back": [b]}
    if item == "beanie":
        f, s, b = c3()
        for c in (f, s, b):
            c.rect(3, 3, 10, 5, "#d8b04f")
            c.hline(4, 11, 2, "#d8b04f")
            c.hline(3, 12, 7, "#b08c36")
            c.rect(7, 0, 2, 2, "#f2da93")
        return {"front": [f], "side": [s], "back": [b]}
    if item == "glasses":
        f, s, b = c3()
        for cx in (5, 11):
            f.frame(cx - 2, 4, 4, 4, "#3b3540")
            f.px(cx, 6, "#c9e6f280")
        f.hline(7, 8, 5, "#3b3540")
        s.frame(3, 4, 4, 4, "#3b3540")
        s.px(4, 6, "#c9e6f280")
        s.hline(7, 12, 5, "#3b3540")
        return {"front": [f], "side": [s], "back": [b]}
    if item == "crown":
        f, s, b = c3()
        for c in (f, s, b):
            c.rect(4, 4, 8, 3, "#e5c56a")
            for x in (4, 7, 11):
                c.px(x, 3, "#e5c56a")
                c.px(x, 2, "#f2da93")
            c.px(6, 5, "#d9655f")
            c.px(9, 5, "#6d8fc4")
        return {"front": [f], "side": [s], "back": [b]}
    if item == "wings":
        def wing(c, cx, up, side_only=None):
            for sgn in ((-1, 1) if side_only is None else (side_only,)):
                x0 = cx + sgn * 2
                for i in range(5):
                    yy = 6 - (i if up else i // 2) + (0 if up else 2)
                    x = x0 + sgn * i
                    c.px(x, yy, "#f7f0e4")
                    c.px(x, yy + 1, "#f2ece2")
                    if i < 4:
                        c.px(x, yy + 2, "#cfc8bd")
        out = {"front": [], "side": [], "back": []}
        for up in (False, True):
            f, s, b = c3()
            wing(f, 8, up)
            wing(b, 8, up)
            wing(s, 7, up, side_only=1)
            out["front"].append(f)
            out["side"].append(s)
            out["back"].append(b)
        return out
    raise KeyError(item)


# ── 조립 · 출력 ────────────────────────────────────────────────────────
def build():
    species = build_species()
    per_row = len(SPECIES) * 2
    sheet = Image.new("RGBA", (per_row * W, len(ROWS) * H), (0, 0, 0, 0))
    meta_species = {}
    for si, name in enumerate(SPECIES):
        rows, anchors = species[name]
        for ri, row in enumerate(ROWS):
            for fi, cv in enumerate(rows[row]):
                sheet.alpha_composite(cv.im, ((si * 2 + fi) * W, ri * H))
        meta_species[name] = {"index": si, "name": NAMES[name], "anchors": {row: {k: list(v) for k, v in anchors[row].items()} for row in ROWS}}
    out = sheet.resize((sheet.width * SCALE, sheet.height * SCALE), Image.NEAREST)
    os.makedirs(OUT, exist_ok=True)
    out.save(os.path.join(OUT, "pets.png"), optimize=True)
    meta = {"frameWidth": W * SCALE, "frameHeight": H * SCALE, "framesPerRow": per_row, "framesPerSpecies": 2,
            "rows": {r: i for i, r in enumerate(ROWS)}, "species": meta_species}
    with open(os.path.join(OUT, "pets.json"), "w", encoding="utf-8") as f:
        json.dump(meta, f, ensure_ascii=False, separators=(",", ":"))
    print(f"pets: {len(SPECIES)} species, {out.size}")

    # 꾸미기 아틀라스
    frames = {}
    imgs = {}
    for item in DECO_ITEMS:
        for variant in DECO_VARIANTS.get(item, [None]):
            fr = deco_frames(item, variant)
            for view, lst in fr.items():
                for fi, cv in enumerate(lst):
                    key = f"deco/{item}" + (f"/{variant}" if variant else "") + f"/{view}/f{fi}"
                    imgs[key] = cv.im
    cols = 12
    cw, ch = 16 * SCALE, 12 * SCALE
    rows_n = (len(imgs) + cols - 1) // cols
    atlas = Image.new("RGBA", (cols * cw, rows_n * ch), (0, 0, 0, 0))
    for i, (key, im) in enumerate(imgs.items()):
        x, y = (i % cols) * cw, (i // cols) * ch
        atlas.alpha_composite(im.resize((cw, ch), Image.NEAREST), (x, y))
        frames[key] = {"frame": {"x": x, "y": y, "w": cw, "h": ch}, "rotated": False, "trimmed": False, "spriteSourceSize": {"x": 0, "y": 0, "w": cw, "h": ch}, "sourceSize": {"w": cw, "h": ch}}
    atlas.save(os.path.join(OUT, "petdeco.png"), optimize=True)
    with open(os.path.join(OUT, "petdeco.json"), "w", encoding="utf-8") as f:
        json.dump({"frames": frames, "meta": {"image": "petdeco.png", "size": {"w": atlas.width, "h": atlas.height}, "scale": "1", "slots": DECO_SLOT, "variants": DECO_VARIANTS, "anchorCenter": [8 * SCALE, 6 * SCALE]}}, f, ensure_ascii=False, separators=(",", ":"))
    print(f"petdeco: {len(frames)} frames, {atlas.size}")

    # 검수용: 12종 한 줄 (앞·옆·앉기·자기)
    os.makedirs(PREVIEW_DIR, exist_ok=True)
    K = 4
    cell_w, cell_h = 4 * W * K + 12, H * K + 26
    row_im = Image.new("RGBA", (len(SPECIES) * cell_w, cell_h), (30, 27, 36, 255))
    d = ImageDraw.Draw(row_im)
    for si, name in enumerate(SPECIES):
        rows, _ = species[name]
        for vi, view in enumerate(("down", "left", "sit", "sleep")):
            im = rows[view][0].im.resize((W * K, H * K), Image.NEAREST)
            row_im.alpha_composite(im, (si * cell_w + 6 + vi * W * K, 4))
        d.text((si * cell_w + 8, H * K + 8), f"{si} {name}", fill=(241, 230, 210, 255))
    row_im.save(os.path.join(PREVIEW_DIR, "pets_row.png"))
    dp = atlas.resize((atlas.width * 3, atlas.height * 3), Image.NEAREST)
    bg = Image.new("RGBA", dp.size, (60, 58, 66, 255))
    bg.alpha_composite(dp)
    bg.save(os.path.join(PREVIEW_DIR, "petdeco_preview.png"))


if __name__ == "__main__":
    build()
