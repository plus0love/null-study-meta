"""18단계 사람 NPC 시트 (매점 점원 · 바리스타) — 원본 캐릭터 화풍.

tools/avatar_parts.py 의 파츠(피부·상의·하의·신발·머리)를 그대로 합성한 뒤 앞치마(+모자)를 덧그린다.
프레임 32x64 (논리 16x32 의 2배). 캐릭터마다 6행 x 4프레임:
  0 down  1 right  2 up  3 left   (걷기 4프레임 — 지금은 idle 만 쓴다)
  4 act   f0/f1 손 흔들기 · f2/f3 컵 닦기
  5 act2  f0/f1 머신 조작(뒷모습) · f2/f3 잔 정리
프레임 인덱스 = (charIndex * 6 + row) * 4 + f  (Phaser spritesheet, 시트 폭 = 4프레임)
출력: public/assets/npcs.png, public/assets/npcs.json, tools/out/npcs_preview.png
실행: python tools/npc_sprites.py
"""
import json
import os
import sys

from PIL import Image

sys.path.insert(0, os.path.dirname(__file__))
import avatar_parts as AP  # noqa: E402

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "public", "assets")
FW, FH, SCALE = AP.FW, AP.FH, AP.SCALE
DIRS = AP.DIRS
ROWS = {"down": 0, "right": 1, "up": 2, "left": 3, "act": 4, "act2": 5}

CHARS = [
    # 매점 점원: 모자(cap) + 앰버 티셔츠 + 세이지 앞치마
    dict(id="clerk", name="사장님", avatar=dict(AP.DEFAULTS, skin="warm", hair="cap", hairColor="darkbrown", top="tshirt", topColor="amber", bottomColor="khaki", shoesColor="tan"),
         apron=("#7a986a", "#5c7850", "#a8c496"), strap="#5c7850"),
    # 바리스타: 똥머리 + 흰 셔츠 + 버건디 앞치마
    dict(id="barista", name="바리스타", avatar=dict(AP.DEFAULTS, skin="peach", hair="bun", hairColor="black", top="shirt", topColor="white", bottomColor="black", shoesColor="black"),
         apron=("#8c4a4f", "#5e2f33", "#a8696b"), strap="#e3d3b3"),
]
SKIN = {"warm": ("#e9c39a", "#c99a72"), "peach": ("#e8d4b2", "#bfa787")}
CUP = (0xf2, 0xec, 0xe2, 255)
CUP_DK = (0xb9, 0xb6, 0xb3, 255)
CLOTH = (0xd9, 0x97, 0x7a, 255)
OUTLINE = AP.rgba(AP.A)


def hexrgba(h):
    h = h.lstrip("#")
    return tuple(int(h[i:i + 2], 16) for i in (0, 2, 4)) + (255,)


def top_extent(layers_top, y):
    """행 y 에서 상의 픽셀의 x 범위 (없으면 None)."""
    px = layers_top.load()
    xs = [x for x in range(FW) if px[x, y][3]]
    return (min(xs), max(xs)) if xs else None


def draw_apron(im, layers, anchor, d, colors, strap):
    """상의 위에 앞치마: 상의 영역의 아래 2/3 + 무릎 위까지, 좌우 1px 안쪽. 뒷모습은 끈만."""
    base, dark, hi = (hexrgba(c) for c in colors)
    px = im.load()
    top = layers["top"]
    tpx = top.load()
    rows = [y for y in range(FH) if any(tpx[x, y][3] for x in range(FW))]
    if not rows:
        return
    t0, t1 = min(rows), max(rows)
    if d == "up":
        # 등: 끈 두 줄 + 허리 매듭
        for y in range(t0 + 1, t0 + 3):
            ext = top_extent(top, y)
            if ext:
                px[ext[0] + 2, y] = hexrgba(strap)
                px[ext[1] - 2, y] = hexrgba(strap)
        ext = top_extent(top, t1 - 1)
        if ext:
            for x in range(ext[0] + 2, ext[1] - 1):
                px[x, t1 - 1] = hexrgba(strap)
            px[ext[0] + 3, t1] = hexrgba(strap)
            px[ext[1] - 3, t1] = hexrgba(strap)
        return
    y_start = t0 + 2
    y_end = min(FH - 1, t1 + 5)
    for y in range(y_start, y_end + 1):
        ext = top_extent(top, min(y, t1))
        if not ext:
            continue
        x0, x1 = ext[0] + 1, ext[1] - 1
        if d in ("right", "left"):
            # 옆모습: 앞쪽 절반만
            if d == "right":
                x0 = max(x0, (x0 + x1) // 2 - 1)
            else:
                x1 = min(x1, (x0 + x1) // 2 + 1)
        for x in range(x0, x1 + 1):
            if y > t1 and px[x, y][3] == 0:
                continue  # 다리 사이 빈 곳
            col = base
            if x == x0 or y == y_end:
                col = dark
            elif y == y_start:
                col = hi
            px[x, y] = col
    # 가슴 끈 (앞모습만)
    if d == "down":
        ext = top_extent(top, t0)
        if ext:
            px[ext[0] + 2, t0] = hexrgba(strap)
            px[ext[1] - 2, t0] = hexrgba(strap)
            px[ext[0] + 2, t0 + 1] = hexrgba(strap)
            px[ext[1] - 2, t0 + 1] = hexrgba(strap)
    # 주머니
    if d == "down":
        ext = top_extent(top, t1)
        if ext:
            for x in range(ext[0] + 3, ext[1] - 2):
                px[x, t1 + 1] = dark


def arm_up(im, anchor, skin, side="right", lift=0):
    """손 흔들기: 몸 옆에 팔을 위로 올려 그린다 (외곽선 포함). lift 로 살짝 흔들림."""
    px = im.load()
    sk, sk_dk = hexrgba(skin[0]), hexrgba(skin[1])
    x = 13 if side == "right" else 2
    y0 = anchor - 4 - lift
    for y in range(y0, anchor + 3):
        px[x, y] = sk
        px[x + (1 if side == "right" else -1), y] = OUTLINE
    # 손 (두 픽셀 넓게)
    hx = x - 1 if side == "right" else x + 1
    px[hx, y0] = sk
    px[hx, y0 - 1] = sk
    px[x, y0 - 1] = sk_dk
    px[x, y0 - 2] = OUTLINE
    px[hx, y0 - 2] = OUTLINE
    px[hx - (1 if side == "right" else -1), y0 - 1] = OUTLINE


def hold(im, anchor, skin, what="cup", dx=0, cloth_dx=0):
    """가슴 앞에 컵을 들고(닦고) 있는 모습. cloth_dx 로 닦는 손 위치."""
    px = im.load()
    sk = hexrgba(skin[0])
    cx, cy = 7 + dx, anchor + 4
    # 컵 (3x3 흰색 + 손잡이)
    for y in range(cy, cy + 3):
        for x in range(cx, cx + 3):
            px[x, y] = CUP
    px[cx + 3, cy + 1] = CUP_DK
    px[cx + 1, cy + 2] = CUP_DK
    # 양손
    px[cx - 1, cy + 1] = sk
    px[cx - 1, cy + 2] = sk
    if what == "wipe":
        wx = cx + 2 + cloth_dx
        px[wx, cy - 1] = CLOTH
        px[wx + 1, cy - 1] = CLOTH
        px[wx + 1, cy] = sk
    else:
        px[cx + 4, cy + 1] = sk


def machine_arm(im, anchor, skin, out=True):
    """뒷모습에서 오른쪽으로 팔을 뻗어 머신을 만진다."""
    px = im.load()
    sk = hexrgba(skin[0])
    y = anchor + 2
    for x in range(12, 16 if out else 14):
        px[x, y] = sk
        px[x, y + 1] = OUTLINE
    if out:
        px[15, y - 1] = sk
        px[14, y - 1] = OUTLINE


def build():
    sheets, frames = AP.build()
    nchar = len(CHARS)
    sheet = Image.new("RGBA", (4 * FW, nchar * 6 * FH), (0, 0, 0, 0))
    meta_chars = {}
    for ci, ch in enumerate(CHARS):
        av = ch["avatar"]
        skin = SKIN[av["skin"]]

        def frame(d, f, apron=True):
            im = AP.compose(sheets, av, d, f)
            layers, anchor = frames[(d, f)]
            if apron:
                draw_apron(im, layers, anchor, d, ch["apron"], ch["strap"])
            return im, anchor

        def put(row, f, im):
            sheet.alpha_composite(im, (f * FW, (ci * 6 + row) * FH))

        for d in DIRS:
            for f in range(4):
                im, _ = frame(d, f)
                put(ROWS[d], f, im)
        # act: 손 흔들기 2 · 컵 닦기 2
        for f, lift in ((0, 0), (1, 1)):
            im, anchor = frame("down", 0)
            arm_up(im, anchor, skin, "right", lift)
            put(ROWS["act"], f, im)
        for f, cdx in ((2, 0), (3, 1)):
            im, anchor = frame("down", 0)
            hold(im, anchor, skin, "wipe", 0, cdx)
            put(ROWS["act"], f, im)
        # act2: 머신 조작(뒷모습) 2 · 잔 정리 2
        for f, out in ((0, True), (1, False)):
            im, anchor = frame("up", 0)
            machine_arm(im, anchor, skin, out)
            put(ROWS["act2"], f, im)
        for f, dx in ((2, -2), (3, 2)):
            im, anchor = frame("down", 0)
            hold(im, anchor, skin, "cup", dx)
            put(ROWS["act2"], f, im)
        meta_chars[ch["id"]] = dict(index=ci, name=ch["name"])

    out = sheet.resize((sheet.width * SCALE, sheet.height * SCALE), Image.NEAREST)
    os.makedirs(OUT, exist_ok=True)
    out.save(os.path.join(OUT, "npcs.png"), optimize=True)
    meta = dict(
        frameWidth=FW * SCALE, frameHeight=FH * SCALE, framesPerRow=4, rowsPerChar=6, framesPerChar=24,
        rows=ROWS,
        actions=dict(wave=[16, 17], wipe=[18, 19], machine=[20, 21], arrange=[22, 23]),
        chars=meta_chars,
    )
    with open(os.path.join(OUT, "npcs.json"), "w", encoding="utf-8") as fp:
        json.dump(meta, fp, ensure_ascii=False)
    prev = out.resize((out.width * 3, out.height * 3), Image.NEAREST)
    os.makedirs(os.path.join(ROOT, "tools", "out"), exist_ok=True)
    prev.save(os.path.join(ROOT, "tools", "out", "npcs_preview.png"))
    print("npcs:", out.size, list(meta_chars))


if __name__ == "__main__":
    build()
