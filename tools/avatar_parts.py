"""아바타 파츠 빌드 (5단계).

원본 캐릭터 시트(tools/raw/oga_zelda/gfx/character.png, CC0, 16x32 4방향 걷기 4프레임)를
팔레트·위치 기준으로 레이어별로 분리하고, 새 머리 모양·상의·안경을 코드로 그려서
레이어별 PNG(4열 걷기 x 4행 down/right/up/left, 32x64 프레임 = 논리 16x32 의 2배)와 catalog.json 을 만든다.

레이어 (그리는 순서): body(피부, 민머리 두상 포함) → top(상의) → bottom(하의) → shoes(신발) → hair(머리) → acc(액세서리)
색상은 클라이언트가 런타임에 팔레트 치환(기준 톤 → 목표 톤)으로 바꾼다. 각 레이어 PNG 는 기준 팔레트로 저장된다.

출력:
  public/assets/avatar/catalog.json
  public/assets/avatar/{body,hair,top,bottom,shoes,acc}/<id>.png
  screenshots/s5_hair_row.png   머리 모양 한 줄 미리보기
  tools/out/avatar_preview.png  모든 파츠 검수용

실행: python tools/avatar_parts.py
"""
import json
import os
import sys

from PIL import Image, ImageDraw

sys.path.insert(0, os.path.dirname(__file__))
from pixel import hexc  # noqa: E402

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
RAW = os.path.join(ROOT, "tools", "raw", "oga_zelda", "gfx", "character.png")
OUT = os.path.join(ROOT, "public", "assets", "avatar")
PREVIEW_DIR = os.path.join(ROOT, "tools", "out")
SHOT_DIR = os.path.join(ROOT, "screenshots")

FW, FH = 16, 32  # 논리 프레임
SCALE = 2
DIRS = ["down", "right", "up", "left"]  # 시트 행 순서
FRAMES = 4

# ── 원본 팔레트 (character.png) ────────────────────────────────────────
A = (0x17, 0x17, 0x17)  # 외곽선
B = (0x43, 0x2e, 0x27)  # 머리 어두운 톤 / 벨트 / 뒤쪽 신발
C = (0x6a, 0x48, 0x34)  # 머리 밝은 톤 / 신발
D = (0xe8, 0xd4, 0xb2)  # 피부
E = (0x2a, 0x2b, 0x35)  # 발밑 그림자 (시트에 구워져 있음)
F = (0xbf, 0xa7, 0x87)  # 피부 그늘
G = (0xc4, 0x3c, 0x3c)  # 상의
H = (0x88, 0x2e, 0x2e)  # 상의 그늘
I = (0x65, 0x65, 0x9b)  # 하의
J = (0x55, 0x86, 0xb9)  # 하의 밝은 톤
K = (0x68, 0x1c, 0x1c)  # 상의 가장 어두운 톤
L = (0xf8, 0xf8, 0xf8)  # 흰색 (버클 · 단추 · 안경 반사)
HL = (0x8c, 0x6a, 0x4e)  # 머리 하이라이트 (새 톤 — 새 머리 모양에서만 사용)

# 레이어별 기준 팔레트 (catalog.palette 순서와 같아야 한다: 클라이언트가 인덱스로 치환)
PALETTE = {
    "body": [D, F],
    "hair": [C, B, HL],
    "top": [G, H, K],
    "bottom": [I, J],
    "shoes": [C, B],
}
# 고정색 (리컬러 대상 아님): 모자·비니·안경
CAP_N, CAP_M = (0x3b, 0x4a, 0x78), (0x27, 0x32, 0x54)
BEANIE_N, BEANIE_M = (0xd7, 0xa4, 0x4a), (0xa5, 0x76, 0x2c)
SUN = (0x1e, 0x22, 0x30)
GLASS_HI = (0xdd, 0xe6, 0xf2)


def rgba(c, a=255):
    return (c[0], c[1], c[2], a)


# ── 원본 시트 읽기 ───────────────────────────────────────────────────────
SRC = Image.open(RAW).convert("RGBA")


def src_frame(d, f):
    row = DIRS.index(d)
    return SRC.crop((f * FW, row * FH, f * FW + FW, row * FH + FH))


def classify(px, x, y, torso_top, pants_y):
    """원본 픽셀 → 레이어 이름 ('outline' 은 이웃을 보고 나중에 정한다)."""
    c = px[x, y][:3]
    if px[x, y][3] == 0:
        return None
    if c == A:
        return "outline"
    if c in (D, F):
        return "body"
    if c == E:
        return "body"
    if c in (G, H, K, L):
        return "top"
    if c in (I, J):
        return "bottom"
    if c in (B, C):
        if y < torso_top:
            return "hair"
        if y < pants_y:
            return "top"  # 벨트
        return "shoes"
    raise ValueError(f"알 수 없는 색 {c} at {x},{y}")


PRIORITY = ["body", "top", "bottom", "shoes", "hair"]


def split_frame(d, f):
    """원본 프레임 하나를 레이어별 16x32 RGBA 로 분리. 반환 (layers dict, torso_top)."""
    im = src_frame(d, f)
    px = im.load()
    ys_torso = [y for y in range(FH) for x in range(FW) if px[x, y][3] and px[x, y][:3] in (G, H, K)]
    ys_pants = [y for y in range(FH) for x in range(FW) if px[x, y][3] and px[x, y][:3] in (I, J)]
    torso_top, pants_y = min(ys_torso), min(ys_pants)
    cls = {}
    for y in range(FH):
        for x in range(FW):
            k = classify(px, x, y, torso_top, pants_y)
            if k:
                cls[(x, y)] = k

    def neighbors(x, y, diag):
        for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1)) + (((1, 1), (1, -1), (-1, 1), (-1, -1)) if diag else ()):
            k = cls.get((x + dx, y + dy))
            if k and k != "outline":
                yield k

    # 외곽선: 이웃 레이어 중 우선순위가 높은 쪽 (피부 > 상의 > 하의 > 신발 > 머리)
    for (x, y), k in list(cls.items()):
        if k != "outline":
            continue
        near = set(neighbors(x, y, False)) or set(neighbors(x, y, True))
        cls[(x, y)] = next((p for p in PRIORITY if p in near), "body")

    layers = {k: Image.new("RGBA", (FW, FH), (0, 0, 0, 0)) for k in PRIORITY}
    for (x, y), k in cls.items():
        layers[k].putpixel((x, y), px[x, y])
    return layers, torso_top


# ── 민머리 두상 템플릿 (앵커 = torso_top, r 은 앵커 기준 행) ───────────────
# 글자: A 외곽선, D 피부, F 피부 그늘, . 투명
SKULL = {
    "down": (-10, [
        ".....AAAAAA.....",
        "....AFDDDDFA....",
        "...AFDDDDDDFA...",
        "..AFDDDDDDDDFA..",
        ".AFDDDDDDDDDDFA.",
        ".AFDDDDDDDDDDFA.",
        ".AFDDADDDDADDFA.",
        "..ADDADDDDADDA..",
        "..AFDDDDDDDDFA..",
        "...AFDDDDDDFA...",
    ]),
    "right": (-10, [
        "......AAAAAA....",
        ".....AFDDDDA....",
        "....AFDDDDDDA...",
        "...AFDDDDDDDDA..",
        "..AFDDDDDDDDDDA.",
        "..AFDDDDDDDDDDA.",
        "..AFDDDDDDADDDA.",
        "...AFDDDDDADDA..",
        "...AFFDDDDDDDA..",
        "....AFFFFDDDA...",
    ]),
    "up": (-10, [
        ".....AAAAAA.....",
        "....AFDDDDFA....",
        "...AFDDDDDDFA...",
        "..AFDDDDDDDDFA..",
        ".AFDDDDDDDDDDFA.",
        ".AFDDDDDDDDDDFA.",
        ".AFDDDDDDDDDDFA.",
        "..ADDDDDDDDDDA..",
        "..AFDDDDDDDDFA..",
        "...AFDDDDDDFA...",
    ]),
}
SKULL_COLORS = {"A": A, "D": D, "F": F}


def mirror_rows(rows):
    return [r[::-1] for r in rows]


SKULL["left"] = (SKULL["right"][0], mirror_rows(SKULL["right"][1]))


def skull_skin(d):
    """방향별 피부(D/F) 좌표 집합 (앵커 기준)."""
    r0, rows = SKULL[d]
    return {(x, r0 + i) for i, row in enumerate(rows) for x, ch in enumerate(row) if ch in "DF"}


def paste_skull(body, d, anchor):
    """body 레이어의 머리 영역(앵커 위 12행)을 지우고 민머리 두상을 넣는다."""
    for y in range(max(0, anchor - 13), anchor):
        for x in range(FW):
            body.putpixel((x, y), (0, 0, 0, 0))
    r0, rows = SKULL[d]
    for i, row in enumerate(rows):
        for x, ch in enumerate(row):
            if ch != ".":
                body.putpixel((x, anchor + r0 + i), rgba(SKULL_COLORS[ch]))


# ── 마스크 기반 드로잉 (머리·모자·안경) ────────────────────────────────────
# 글자 → (채움색, 어두운 톤). '#' 머리 기본, 'b' 머리 어두운 톤 강제, 'h' 하이라이트 강제, 'c' 기본 톤 강제(자동 음영 없음)
# 'N'/'M' 모자·비니 고정색, 'A' 외곽선 강제, 'S' 선글라스 렌즈, 'L' 흰 반사
def mask_colors(extra):
    base = {
        "#": (C, B), "c": (C, None), "b": (B, None), "h": (HL, None), "A": (A, None),
        "L": (L, None), "S": (SUN, None),
    }
    base.update(extra or {})
    return base


def render_mask(r0, rows, skin, extra=None, outline=True):
    """마스크 → {(x, r): RGB}. 자동 외곽선: 오른쪽/아래 가장자리는 A(피부 위면 어두운 톤), 왼쪽/위 가장자리는 어두운 톤."""
    colors = mask_colors(extra)
    cells = {}
    for i, row in enumerate(rows):
        assert len(row) == FW, f"행 길이 {len(row)} != 16: {row!r}"
        for x, ch in enumerate(row):
            if ch != ".":
                cells[(x, r0 + i)] = ch
    out = {}
    for (x, r), ch in cells.items():
        fill, dark = colors[ch]
        col = fill
        if outline and dark is not None:
            right, down = (x + 1, r) not in cells, (x, r + 1) not in cells
            left, up = (x - 1, r) not in cells, (x, r - 1) not in cells
            if right or down:
                over_skin = (right and (x + 1, r) in skin) or (down and (x, r + 1) in skin)
                col = dark if over_skin else A
            elif left or up:
                col = dark
        out[(x, r)] = col
    return out


def blit_cells(im, cells, anchor):
    for (x, r), col in cells.items():
        y = anchor + r
        if 0 <= x < FW and 0 <= y < FH:
            im.putpixel((x, y), rgba(col))


def mirror_cells(cells):
    return {(FW - 1 - x, r): col for (x, r), col in cells.items()}


# ── 머리 모양 정의 (down / right / up; left 는 right 의 좌우 반전) ────────────
# 각 항목: dict(down=(r0, rows), right=(r0, rows), up=(r0, rows), extra={글자: (색, 어두운톤)})
HAIR_STYLES = {}


def hair(id_, label, down, right, up, extra=None):
    HAIR_STYLES[id_] = dict(label=label, down=down, right=right, up=up, extra=extra or {})


hair("short", "짧은 머리",
     down=(-11, [
         ".....######.....",
         "....########....",
         "...##########...",
         "..############..",
         ".##############.",
         ".###........###.",
         ".##..........##.",
     ]),
     right=(-11, [
         "......######....",
         "....##########..",
         "...###########..",
         "..#############.",
         "..#############.",
         "..####..........",
         "..###...........",
         "..##............",
     ]),
     up=(-11, [
         ".....######.....",
         "....########....",
         "...##########...",
         "..############..",
         ".##############.",
         ".##############.",
         ".##############.",
         ".##############.",
         "..############..",
         "...###....###...",
     ]))

hair("part", "가르마",
     down=(-12, [
         ".....######.....",
         "...##########...",
         "..###h########..",
         "..##h##########.",
         ".###h##########.",
         ".###h##########.",
         ".##b....#######.",
         ".##.........###.",
         ".#...........#..",
     ]),
     right=(-12, [
         "......######....",
         "....##########..",
         "...###########..",
         "..#############.",
         "..#############.",
         "..#############.",
         "..#####......###",
         "..####........#.",
         "..###...........",
         "...##...........",
     ]),
     up=(-12, [
         ".....######.....",
         "...##########...",
         "..############..",
         ".##############.",
         ".##############.",
         ".##############.",
         ".##############.",
         ".##############.",
         ".##############.",
         "..############..",
         "...##########...",
         ".....######.....",
     ]))

hair("curly", "곱슬",
     down=(-13, [
         "....##..##..##..",
         "..###b####b###..",
         ".##############.",
         "###b###b###b####",
         "################",
         "##b####b###b####",
         "################",
         ".##b#####b####b.",
         ".##.#.....#.###.",
         "##...........##.",
         "##...........##.",
         ".#...........#..",
     ]),
     right=(-13, [
         "....##.##.##....",
         "..####b####b##..",
         ".##############.",
         ".###b###b###b###",
         "################",
         "##b####b###b###.",
         ".###############",
         ".#####b....b###.",
         ".#####.......#..",
         "######..........",
         "######..........",
         ".####...........",
         "..##............",
     ]),
     up=(-13, [
         "....##..##..##..",
         "..###b####b###..",
         ".##############.",
         "###b###b###b####",
         "################",
         "##b####b###b####",
         "################",
         "###b####b###b###",
         "################",
         "################",
         ".#b####b###b###.",
         ".##############.",
         "..############..",
     ]))

hair("spiky", "뾰족머리",
     down=(-13, [
         "...#....#....#..",
         "..##...##...##..",
         ".####h####h####.",
         ".##############.",
         ".##############.",
         ".##############.",
         ".##############.",
         ".###.###.###.##.",
         ".##..........##.",
     ]),
     right=(-13, [
         "....#....#...#..",
         "...##...##..##..",
         "..####h####h###.",
         "..#############.",
         "..#############.",
         "..#############.",
         "..#############.",
         "..####....#..##.",
         "..###...........",
         "..##............",
     ]),
     up=(-13, [
         "...#....#....#..",
         "..##...##...##..",
         ".####h####h####.",
         ".##############.",
         ".##############.",
         ".##############.",
         ".##############.",
         ".##############.",
         ".##############.",
         "..############..",
         "...##.#..#.##...",
     ]))

hair("bob", "단발",
     down=(-12, [
         ".....######.....",
         "...##########...",
         "..############..",
         ".####h#########.",
         ".##############.",
         ".##############.",
         ".##############.",
         ".###........###.",
         ".###........###.",
         ".###........###.",
         ".###........###.",
         "..##........##..",
     ]),
     right=(-12, [
         "......######....",
         "....##########..",
         "...####h######..",
         "..#############.",
         "..#############.",
         "..#############.",
         "..#############.",
         ".######.........",
         ".######.........",
         ".######.........",
         ".######.........",
         "..#####.........",
     ]),
     up=(-12, [
         ".....######.....",
         "...##########...",
         "..############..",
         ".####h#########.",
         ".##############.",
         ".##############.",
         ".##############.",
         ".##############.",
         ".##############.",
         ".##############.",
         ".##############.",
         ".##############.",
     ]))

hair("long", "장발",
     down=(-12, [
         ".....######.....",
         "...##########...",
         "..############..",
         ".####h#########.",
         ".##############.",
         ".##############.",
         ".##############.",
         ".###........###.",
         ".###........###.",
         ".###........###.",
         ".###........###.",
         ".###........###.",
         ".###........###.",
         ".###........###.",
         "..##........##..",
     ]),
     right=(-12, [
         "......######....",
         "....##########..",
         "...####h######..",
         "..#############.",
         "..#############.",
         "..#############.",
         "..#############.",
         ".######.........",
         ".######.........",
         ".######.........",
         ".######.........",
         ".######.........",
         ".#####..........",
         ".#####..........",
         "..####..........",
     ]),
     up=(-12, [
         ".....######.....",
         "...##########...",
         "..############..",
         ".####h#########.",
         ".###h##########.",
         ".##############.",
         ".##############.",
         ".####h####h####.",
         ".####h####h####.",
         ".##############.",
         ".##############.",
         ".##############.",
         ".##############.",
         ".##############.",
         "..############..",
         "...##########...",
     ]))

hair("ponytail", "포니테일",
     down=(-11, [
         ".....######.....",
         "....########....",
         "...##########...",
         "..############..",
         ".####h#########.",
         ".###........###.",
         ".##..........##.",
     ]),
     right=(-11, [
         "......######....",
         "....##########..",
         "...####h######..",
         "..#############.",
         "..#############.",
         ".b####..........",
         "###.............",
         "###.............",
         "###.............",
         ".###............",
         ".###............",
         "..##............",
     ]),
     up=(-11, [
         ".....######.....",
         "....########....",
         "...##########...",
         "..############..",
         ".####h#########.",
         ".##############.",
         ".######bb######.",
         "..####.####.##..",
         "......####......",
         "......####......",
         "......####......",
         "......####......",
         ".......###......",
     ]))

hair("twintail", "트윈테일",
     down=(-12, [
         ".....######.....",
         "...##########...",
         "..############..",
         ".####h#########.",
         ".##############.",
         ".##############.",
         "b##############b",
         "###..........###",
         "###..........###",
         "###..........###",
         "###..........###",
         "###..........###",
         "###..........###",
         ".##..........##.",
     ]),
     right=(-12, [
         "......######....",
         "....##########..",
         "...####h######..",
         "..#############.",
         "..#############.",
         "..#############.",
         "..#############.",
         "..###.b##.......",
         "..##..###.......",
         "......###.......",
         "......###.......",
         "......###.......",
         "......###.......",
         ".......##.......",
     ]),
     up=(-12, [
         ".....######.....",
         "...##########...",
         "..############..",
         ".####h#########.",
         ".##############.",
         ".##############.",
         "b##############b",
         "###.########.###",
         "###..######..###",
         "###...####...###",
         "###..........###",
         "###..........###",
         "###..........###",
         ".##..........##.",
     ]))

hair("bun", "똥머리",
     down=(-14, [
         "......####......",
         ".....######.....",
         ".....##h###.....",
         "....########....",
         "...##########...",
         "..############..",
         ".##############.",
         ".##############.",
         ".##..........##.",
         ".##..........##.",
     ]),
     right=(-14, [
         "....####........",
         "...######.......",
         "...###h##.......",
         "....##########..",
         "...###########..",
         "..#############.",
         "..#############.",
         "..#############.",
         "..####..........",
         "..###...........",
         "..##............",
     ]),
     up=(-14, [
         "......####......",
         ".....######.....",
         ".....##h###.....",
         "....########....",
         "...##########...",
         "..############..",
         ".##############.",
         ".##############.",
         ".##############.",
         ".##############.",
         "..############..",
         "...###....###...",
     ]))

hair("cap", "모자",
     down=(-12, [
         ".....NNNNNN.....",
         "...NNNNNNNNNN...",
         "..NNNNNNNNNNNN..",
         ".NNNNNNNNNNNNNN.",
         ".NNNNNNNNNNNNNN.",
         ".NNNNNNNNNNNNNN.",
         "MMMMMMMMMMMMMMMM",
         ".##..........##.",
         ".#............#.",
     ]),
     right=(-12, [
         "......NNNNNN....",
         "....NNNNNNNNNN..",
         "...NNNNNNNNNNN..",
         "..NNNNNNNNNNNNN.",
         "..NNNNNNNNNNNNN.",
         "..NNNNNNNNNNNNN.",
         "..NNNNNNNMMMMMMM",
         "..###...........",
         "..##............",
     ]),
     up=(-12, [
         ".....NNNNNN.....",
         "...NNNNNNNNNN...",
         "..NNNNNNNNNNNN..",
         ".NNNNNNNNNNNNNN.",
         ".NNNNNNNNNNNNNN.",
         ".NNNNNNNNNNNNNN.",
         ".MMMMMMMMMMMMMM.",
         ".##############.",
         "..############..",
         "...###....###...",
     ]),
     extra={"N": (CAP_N, CAP_M), "M": (CAP_M, CAP_M)})

hair("beanie", "비니",
     down=(-13, [
         ".......NN.......",
         ".....NNNNNN.....",
         "...NNNNNNNNNN...",
         "..NNNNNNNNNNNN..",
         ".NNNNNNNNNNNNNN.",
         ".NNNNNNNNNNNNNN.",
         ".MNMNMNMNMNMNMN.",
         ".MNMNMNMNMNMNMN.",
         ".##..........##.",
         ".#............#.",
     ]),
     right=(-13, [
         "........NN......",
         "......NNNNNN....",
         "....NNNNNNNNNN..",
         "...NNNNNNNNNNN..",
         "..NNNNNNNNNNNNN.",
         "..NNNNNNNNNNNNN.",
         "..MNMNMNMNMNMNM.",
         "..MNMNMNMNMNMNM.",
         "..###...........",
         "..##............",
     ]),
     up=(-13, [
         ".......NN.......",
         ".....NNNNNN.....",
         "...NNNNNNNNNN...",
         "..NNNNNNNNNNNN..",
         ".NNNNNNNNNNNNNN.",
         ".NNNNNNNNNNNNNN.",
         ".MNMNMNMNMNMNMN.",
         ".MNMNMNMNMNMNMN.",
         ".##############.",
         "..############..",
         "...###....###...",
     ]),
     extra={"N": (BEANIE_N, BEANIE_M), "M": (BEANIE_M, BEANIE_M)})


# ── 안경 (외곽선 자동 없음: 그린 대로) ────────────────────────────────────
ACC_STYLES = {}


def acc(id_, label, down, right, up):
    ACC_STYLES[id_] = dict(label=label, down=down, right=right, up=up)


acc("glasses_round", "동그란 안경",
    down=(-5, [
        ".....A....A.....",
        "...AA.AAAA.AA...",
        "....A.A..A.A....",
    ]),
    right=(-5, [
        "..........A.....",
        "....AAAAA.A.....",
        ".........A.A....",
    ]),
    up=(-5, []))

acc("glasses_square", "각진 안경",
    down=(-5, [
        "....AAA..AAA....",
        "...AA.AAAA.AA...",
        "....A.A..A.A....",
        "....AAA..AAA....",
    ]),
    right=(-5, [
        ".........AAA....",
        "....AAAAA..A....",
        ".........A.A....",
        ".........AAA....",
    ]),
    up=(-5, []))

acc("sunglasses", "선글라스",
    down=(-5, [
        "....AAA..AAA....",
        "...ALSSAASSLA...",
        "....SSS..SSS....",
        ".....A....A.....",
    ]),
    right=(-5, [
        ".........AAA....",
        "....AAAAASLA....",
        ".........SSS....",
        "..........A.....",
    ]),
    up=(-5, []))


# ── 상의 변형 (원본 상의 레이어를 프레임별로 가공) ───────────────────────────
# ops: (dx, r, 색, force)  force=False 면 그 자리에 상의 픽셀(G/H/K)이 있을 때만 칠한다
TOP_STYLES = {
    "basic": dict(label="기본 튜닉", belt=True, ops={}),
    "tshirt": dict(label="티셔츠", belt=False, ops={}),
    "shirt": dict(label="셔츠", belt=False, ops={
        "down": [(4, 0, H, False), (5, 0, L, False), (10, 0, L, False), (11, 0, H, False), (8, 1, L, False), (8, 2, H, False), (8, 3, L, False)],
        "right": [(8, 0, L, False), (10, 1, H, False), (10, 2, L, False), (10, 3, H, False)],
        "up": [(4, 0, H, False), (5, 0, L, False), (10, 0, L, False), (11, 0, H, False)],
    }),
    "hoodie": dict(label="후드", belt=False, ops={
        "down": [(3, -1, A, True), (4, -1, H, True), (5, -1, G, True), (6, -1, G, True), (7, -1, G, True), (8, -1, G, True), (9, -1, G, True), (10, -1, G, True), (11, -1, H, True), (12, -1, A, True),
                 (6, 1, L, False), (9, 1, L, False), (6, 2, L, False), (9, 2, L, False),
                 (5, 2, H, False), (10, 2, H, False), (5, 3, H, False), (6, 3, H, False), (7, 3, H, False), (8, 3, H, False), (9, 3, H, False), (10, 3, H, False)],
        "right": [(3, -1, A, True), (4, -1, G, True), (5, -1, G, True), (6, -1, H, True), (7, -1, A, True), (3, 0, A, True), (4, 0, G, True), (5, 0, H, True),
                  (9, 3, H, False), (10, 3, H, False), (10, 1, L, False)],
        "up": [(4, -1, A, True), (5, -1, G, True), (6, -1, G, True), (7, -1, G, True), (8, -1, G, True), (9, -1, G, True), (10, -1, G, True), (11, -1, A, True),
               (4, 0, A, True), (5, 0, G, True), (6, 0, G, True), (7, 0, G, True), (8, 0, G, True), (9, 0, G, True), (10, 0, G, True), (11, 0, A, True),
               (5, 1, H, False), (6, 1, G, False), (7, 1, G, False), (8, 1, G, False), (9, 1, G, False), (10, 1, H, False),
               (5, 2, H, False), (6, 2, H, False), (7, 2, H, False), (8, 2, H, False), (9, 2, H, False), (10, 2, H, False)],
    }),
    "knit": dict(label="니트", belt=False, ops={
        "down": [(6, 0, G, True), (7, 0, G, True), (8, 0, G, True), (9, 0, G, True), (5, 0, H, False), (10, 0, H, False),
                 (6, 1, H, False), (9, 1, H, False), (6, 2, H, False), (9, 2, H, False), (6, 3, H, False), (9, 3, H, False),
                 (5, 4, K, False), (7, 4, K, False), (9, 4, K, False)],
        "right": [(9, 0, G, True), (10, 0, G, True), (9, 2, H, False), (9, 3, H, False), (8, 4, K, False), (10, 4, K, False)],
        "up": [(6, 0, G, True), (7, 0, G, True), (8, 0, G, True), (9, 0, G, True), (5, 0, H, False), (10, 0, H, False),
               (6, 1, H, False), (9, 1, H, False), (6, 2, H, False), (9, 2, H, False), (6, 3, H, False), (9, 3, H, False),
               (5, 4, K, False), (7, 4, K, False), (9, 4, K, False)],
    }),
}


def make_top(base, d, anchor, style):
    im = base.copy()
    px = im.load()
    st = TOP_STYLES[style]
    if not st["belt"]:
        for y in range(FH):
            for x in range(FW):
                if px[x, y][3] and px[x, y][:3] in (B, C, L):
                    px[x, y] = rgba(G)
    ops = st["ops"].get("left" if d == "left" else d)
    if d == "left":
        ops = [(FW - 1 - dx, r, col, force) for dx, r, col, force in st["ops"].get("right", [])]
    for dx, r, col, force in ops or []:
        y = anchor + r
        if not (0 <= y < FH):
            continue
        cur = px[dx, y]
        if force or (cur[3] and cur[:3] in (G, H, K)):
            px[dx, y] = rgba(col)
    return im


# ── 색상 옵션 (catalog.colors) ───────────────────────────────────────────
def hx(c):
    return "#%02x%02x%02x" % c


COLORS = {
    "skin": [
        ("peach", "복숭아", ["#e8d4b2", "#bfa787"]),
        ("fair", "밝은 살구", ["#f6e3cf", "#d9b9a0"]),
        ("warm", "따뜻한 베이지", ["#e9c39a", "#c99a72"]),
        ("tan", "탄", ["#d4a274", "#a97a52"]),
        ("brown", "브라운", ["#a5673f", "#7d4b2c"]),
        ("deep", "딥 브라운", ["#6e4128", "#4d2b19"]),
    ],
    "hairColor": [
        ("black", "흑발", ["#3d3540", "#2b2530", "#544a58"]),
        ("darkbrown", "다크 브라운", ["#6a4834", "#432e27", "#8c6a4e"]),
        ("brown", "브라운", ["#8b5a3c", "#5e3a26", "#a9775a"]),
        ("auburn", "적갈색", ["#a0522d", "#6f3519", "#c47a52"]),
        ("blonde", "금발", ["#e2c27a", "#b08f4a", "#f2dca3"]),
        ("ash", "애쉬", ["#d9d3c8", "#a49d92", "#f0ece5"]),
        ("red", "레드", ["#d3653b", "#9a4222", "#eb8f66"]),
        ("pink", "핑크", ["#e88fb5", "#b95f88", "#f5b6d0"]),
        ("blue", "블루", ["#5a7fc4", "#3a5590", "#86a5dd"]),
        ("purple", "퍼플", ["#8e6bc4", "#62468f", "#b394dd"]),
    ],
    "topColor": [
        ("white", "화이트", ["#f1eee8", "#c9c4bb", "#a9a39a"]),
        ("amber", "앰버", ["#ffc46e", "#d69846", "#b27834"]),
        ("sage", "세이지", ["#a8c496", "#7a986a", "#5c7850"]),
        ("blue", "블루", ["#96b4dc", "#6886b8", "#4e6896"]),
        ("charcoal", "차콜", ["#4a4650", "#332f38", "#221f26"]),
        ("red", "레드", ["#d9534f", "#a33632", "#7a2422"]),
        ("navy", "네이비", ["#3e4d78", "#2b3556", "#1c2340"]),
        ("mint", "민트", ["#8fd3c1", "#5ea895", "#3f7d6d"]),
        ("lavender", "라벤더", ["#c0a6e0", "#8f74b3", "#674f86"]),
        ("pink", "핑크", ["#f2b3c6", "#c9819a", "#9a5c73"]),
        ("mustard", "머스터드", ["#d9b24c", "#a8842f", "#7b5f1f"]),
        ("brown", "브라운", ["#a0764e", "#775535", "#543a22"]),
    ],
    "bottomColor": [
        ("denim", "데님", ["#65659b", "#5586b9"]),
        ("black", "블랙", ["#2f2c36", "#4a4652"]),
        ("navy", "네이비", ["#2c3e6e", "#3f5a95"]),
        ("khaki", "카키", ["#b7a47a", "#cdbb90"]),
        ("gray", "그레이", ["#8a8a95", "#a8a8b2"]),
        ("brown", "브라운", ["#7a5236", "#98693f"]),
        ("olive", "올리브", ["#6b7a4b", "#889a60"]),
        ("cream", "크림", ["#e8e2d4", "#f6f2e8"]),
    ],
    "shoesColor": [
        ("brown", "브라운", ["#6a4834", "#432e27"]),
        ("black", "블랙", ["#2b2830", "#1a171e"]),
        ("white", "화이트", ["#e9e6e0", "#b5b0a8"]),
        ("red", "레드", ["#c0392b", "#7e2419"]),
        ("navy", "네이비", ["#34456e", "#22304d"]),
        ("tan", "탄", ["#c39a6b", "#8e6b45"]),
    ],
}

DEFAULTS = dict(skin="peach", hair="basic", hairColor="black", top="basic", topColor="white", bottom="pants", bottomColor="denim", shoes="boots", shoesColor="brown", acc="none")
LEGACY_SHIRT = ["white", "amber", "sage", "blue"]  # 4단계까지의 avatar(0..3) = 셔츠 색


# ── 시트 조립 ─────────────────────────────────────────────────────────────
def new_sheet():
    return Image.new("RGBA", (FRAMES * FW, len(DIRS) * FH), (0, 0, 0, 0))


def put(sheet, d, f, im):
    sheet.alpha_composite(im, (f * FW, DIRS.index(d) * FH))


def build():
    frames = {}  # (d, f) → (layers, anchor)
    for d in DIRS:
        for f in range(FRAMES):
            frames[(d, f)] = split_frame(d, f)

    sheets = {}  # 'hair/basic' → sheet
    # 기본 레이어 (원본에서 분리) + 민머리 두상
    for key in ("body/base", "hair/basic", "top/basic", "bottom/pants", "shoes/boots"):
        sheets[key] = new_sheet()
    for (d, f), (layers, anchor) in frames.items():
        body = layers["body"].copy()
        paste_skull(body, d, anchor)
        put(sheets["body/base"], d, f, body)
        put(sheets["hair/basic"], d, f, layers["hair"])
        put(sheets["bottom/pants"], d, f, layers["bottom"])
        put(sheets["shoes/boots"], d, f, layers["shoes"])
    # 상의 변형
    for sid in TOP_STYLES:
        key = f"top/{sid}"
        sheets[key] = new_sheet()
        for (d, f), (layers, anchor) in frames.items():
            put(sheets[key], d, f, make_top(layers["top"], d, anchor, sid))
    # 새 머리 모양
    for hid, st in HAIR_STYLES.items():
        key = f"hair/{hid}"
        sheets[key] = new_sheet()
        cells = {d: render_mask(st[d][0], st[d][1], skull_skin(d), st["extra"]) for d in ("down", "right", "up")}
        cells["left"] = mirror_cells(cells["right"])
        for (d, f), (_layers, anchor) in frames.items():
            im = Image.new("RGBA", (FW, FH), (0, 0, 0, 0))
            blit_cells(im, cells[d], anchor)
            put(sheets[key], d, f, im)
    # 안경
    for aid, st in ACC_STYLES.items():
        key = f"acc/{aid}"
        sheets[key] = new_sheet()
        cells = {d: render_mask(st[d][0], st[d][1], set(), None, outline=False) for d in ("down", "right", "up")}
        cells["left"] = mirror_cells(cells["right"])
        for (d, f), (_layers, anchor) in frames.items():
            im = Image.new("RGBA", (FW, FH), (0, 0, 0, 0))
            blit_cells(im, cells[d], anchor)
            put(sheets[key], d, f, im)
    return sheets, frames


def write_sheets(sheets):
    for key, sheet in sheets.items():
        path = os.path.join(OUT, key + ".png")
        os.makedirs(os.path.dirname(path), exist_ok=True)
        sheet.resize((sheet.width * SCALE, sheet.height * SCALE), Image.NEAREST).save(path, optimize=True)


def write_catalog():
    def items(styles, first=None):
        out = []
        if first:
            out.append(first)
        out += [dict(id=k, label=v["label"]) for k, v in styles.items()]
        return out

    catalog = dict(
        version=1,
        frame=dict(width=FW * SCALE, height=FH * SCALE, framesPerRow=FRAMES, rows={d: i for i, d in enumerate(DIRS)}),
        order=["body", "top", "bottom", "shoes", "hair", "acc"],
        layers=dict(
            body=dict(label="피부", field=None, item="base", colorField="skin", palette=[hx(c) for c in PALETTE["body"]], items=[dict(id="base", label="기본")]),
            top=dict(label="상의", field="top", colorField="topColor", palette=[hx(c) for c in PALETTE["top"]], items=items(TOP_STYLES)),
            bottom=dict(label="하의", field="bottom", colorField="bottomColor", palette=[hx(c) for c in PALETTE["bottom"]], items=[dict(id="pants", label="바지")]),
            shoes=dict(label="신발", field="shoes", colorField="shoesColor", palette=[hx(c) for c in PALETTE["shoes"]], items=[dict(id="boots", label="부츠")]),
            hair=dict(label="머리", field="hair", colorField="hairColor", palette=[hx(c) for c in PALETTE["hair"]], items=items(HAIR_STYLES, dict(id="basic", label="기본"))),
            acc=dict(label="액세서리", field="acc", colorField=None, palette=[], items=[dict(id="none", label="없음", file=None)] + [dict(id=k, label=v["label"]) for k, v in ACC_STYLES.items()]),
        ),
        colors={k: [dict(id=i, label=l, tones=t) for i, l, t in v] for k, v in COLORS.items()},
        defaults=DEFAULTS,
        legacyShirt=LEGACY_SHIRT,
    )
    with open(os.path.join(OUT, "catalog.json"), "w", encoding="utf-8") as fp:
        json.dump(catalog, fp, ensure_ascii=False, indent=1)
    return catalog


# ── 미리보기 (검수용, 파이썬 쪽 합성) ──────────────────────────────────────
def recolor(im, src, dst):
    out = im.copy()
    px = out.load()
    table = {s: hexc(d)[:3] for s, d in zip(src, dst)}
    for y in range(out.height):
        for x in range(out.width):
            p = px[x, y]
            if p[3] and p[:3] in table:
                px[x, y] = rgba(table[p[:3]])
    return out


def compose(sheets, av, d="down", f=0):
    """catalog 기준으로 한 프레임 합성 (16x32)."""
    colors = {k: {i: t for i, _l, t in v} for k, v in COLORS.items()}
    order = [("body", "body/base", "skin"), ("top", f"top/{av['top']}", "topColor"), ("bottom", "bottom/pants", "bottomColor"),
             ("shoes", "shoes/boots", "shoesColor"), ("hair", f"hair/{av['hair']}", "hairColor"), ("acc", f"acc/{av['acc']}", None)]
    im = Image.new("RGBA", (FW, FH), (0, 0, 0, 0))
    for layer, key, cf in order:
        if key not in sheets:
            continue
        fr = sheets[key].crop((f * FW, DIRS.index(d) * FH, f * FW + FW, DIRS.index(d) * FH + FH))
        if cf:
            fr = recolor(fr, PALETTE[layer], colors[cf][av[cf]])
        im.alpha_composite(fr)
    return im


def preview(sheets):
    os.makedirs(PREVIEW_DIR, exist_ok=True)
    os.makedirs(SHOT_DIR, exist_ok=True)
    hairs = ["basic"] + list(HAIR_STYLES)
    hair_colors = [c[0] for c in COLORS["hairColor"]]
    S = 4
    # 1) 머리 모양 한 줄 (down, 각기 다른 머리색)
    pad = 6
    w = len(hairs) * (FW * S + pad) + pad
    row = Image.new("RGBA", (w, FH * S + 26), (0x1c, 0x18, 0x24, 255))
    dr = ImageDraw.Draw(row)
    for i, hid in enumerate(hairs):
        av = dict(DEFAULTS, hair=hid, hairColor=hair_colors[i % len(hair_colors)], topColor=COLORS["topColor"][i % 12][0])
        fr = compose(sheets, av).resize((FW * S, FH * S), Image.NEAREST)
        x = pad + i * (FW * S + pad)
        row.alpha_composite(fr, (x, 2))
        dr.text((x + 2, FH * S + 8), hid, fill=(255, 224, 173, 255))
    row.save(os.path.join(SHOT_DIR, "s5_hair_row.png"))

    # 2) 전체 검수: 머리 x 4방향 x 4프레임, 상의/안경/색
    cols = 16
    cell = FW * S + 2
    rows_n = len(hairs) + len(TOP_STYLES) + len(ACC_STYLES) + 3
    im = Image.new("RGBA", (cols * cell + 120, rows_n * (FH * S + 4) + 10), (0x1c, 0x18, 0x24, 255))
    dr = ImageDraw.Draw(im)
    y = 5
    def line(label, avs):
        nonlocal y
        dr.text((4, y + 40), label, fill=(255, 224, 173, 255))
        for i, (av, d, f) in enumerate(avs):
            fr = compose(sheets, av, d, f).resize((FW * S, FH * S), Image.NEAREST)
            im.alpha_composite(fr, (120 + i * cell, y))
        y += FH * S + 4
    for hid in hairs:
        av = dict(DEFAULTS, hair=hid, hairColor="darkbrown")
        line(hid, [(av, d, f) for d in DIRS for f in range(FRAMES)])
    for tid in TOP_STYLES:
        av = dict(DEFAULTS, top=tid, topColor="amber", hair="short")
        line(tid, [(av, d, f) for d in DIRS for f in range(FRAMES)])
    for aid in ACC_STYLES:
        av = dict(DEFAULTS, acc=aid, hair="bob")
        line(aid, [(av, d, f) for d in DIRS for f in range(FRAMES)])
    line("skin", [(dict(DEFAULTS, skin=c[0], hair="ponytail"), "down", 0) for c in COLORS["skin"]])
    line("hair colors", [(dict(DEFAULTS, hairColor=c[0], hair="long"), "down", 0) for c in COLORS["hairColor"]])
    line("top/bottom/shoes", [(dict(DEFAULTS, topColor=COLORS["topColor"][i][0], bottomColor=COLORS["bottomColor"][i % 8][0], shoesColor=COLORS["shoesColor"][i % 6][0], hair="curly"), "down", 0) for i in range(12)])
    im.save(os.path.join(PREVIEW_DIR, "avatar_preview.png"))


def main():
    sheets, _frames = build()
    os.makedirs(OUT, exist_ok=True)
    write_sheets(sheets)
    catalog = write_catalog()
    preview(sheets)
    print(f"avatar: {len(sheets)} sheets, hair {len(catalog['layers']['hair']['items'])}, top {len(catalog['layers']['top']['items'])}, acc {len(catalog['layers']['acc']['items'])}")


if __name__ == "__main__":
    main()
