"""강아지 NPC 스프라이트 시트 빌드 (오리지널, tools/sprites/poodle_cushion.png 의 푸들 기준).

팩에 4방향 걷기 강아지가 없어서 쿠션 위 푸들 그림의 머리·팔레트를 그대로 쓰고 몸통·다리·꼬리를 직접 그린다.
16x24 논리 픽셀 → 2배(32x48). 행(row)마다 2프레임:
  0 down  1 right  2 up  3 left   (걷기 2프레임, 첫 프레임이 정지 프레임)
  4 sit   (꼬리 왼쪽 / 오른쪽 → 번갈아 틀면 꼬리 흔들기)
  5 sleep (엎드려 자기 / 숨 쉬는 프레임)
출력: public/assets/dog.png, public/assets/dog.json
실행: python tools/dog_sprite.py
"""
import json
import os

from PIL import Image

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, "tools", "sprites", "poodle_cushion.png")
OUT = os.path.join(ROOT, "public", "assets")
W, H, SCALE = 16, 24, 2

PAL = {
    "F": (162, 106, 55, 255),   # 털 기본
    "H": (196, 140, 82, 255),   # 털 하이라이트
    "D": (125, 78, 36, 255),    # 털 그림자
    "L": (227, 185, 133, 255),  # 주둥이
    "l": (221, 190, 157, 255),  # 이마 하이라이트
    "E": (59, 53, 64, 255),     # 눈
    "N": (59, 42, 36, 255),     # 코
    "R": (201, 79, 79, 255),    # 목걸이
    "P": (217, 151, 122, 255),  # 혀/볼
    "y": (224, 198, 123, 255),  # 목걸이 장식
    "Z": (241, 230, 210, 255),  # 'z' 글자
    ".": (0, 0, 0, 0),
}
INV = {v[:3]: k for k, v in PAL.items() if k != "."}


def load_head():
    """원본 푸들의 머리(원본 6..19행, 목걸이 포함) → 14행 문자열."""
    im = Image.open(SRC).convert("RGBA")
    px = im.load()
    rows = []
    for y in range(6, 20):
        rows.append("".join("." if px[x, y][3] == 0 else INV[px[x, y][:3]] for x in range(16)))
    return rows


def head_back(head):
    """뒷모습 머리: 얼굴(눈·코·주둥이·혀)을 털 무늬로 덮고 목걸이는 뒤쪽만 살짝."""
    fur = "FHFDFHFFHFDFHFFH"
    out = []
    for y, row in enumerate(head):
        cells = []
        for x, c in enumerate(row):
            if c in "ELNPl":
                c = fur[(x * 3 + y * 5) % len(fur)]
            cells.append(c)
        out.append("".join(cells))
    out[13] = "......RRRR......"
    return out


def frame(rows):
    """행 문자열 목록(높이 H 이하) → 아래 정렬된 16x24 프레임."""
    rows = list(rows)
    while len(rows) < H:
        rows.insert(0, "." * W)
    assert len(rows) == H, len(rows)
    for r in rows:
        assert len(r) == W, (len(r), r)
    return rows


def mirror(rows):
    return [r[::-1] for r in rows]


HEAD = load_head()
HEAD_BACK = head_back(HEAD)

# 서 있는 몸통 (앞/뒤 공용): 가슴 4행 + 다리 6행 = 10행. 다리 두 프레임.
BODY_FRONT = [
    "....FHFFDHFFHF..",
    "....FFHFFFHFFF..",
    "....FHFFFDHFHF..",
    "....HFFHFFFFFF..",
]
LEGS_A = [
    "....FFFF..FFFF..",
    "....FHFF..FHFF..",
    "....FFFF..FFFF..",
    "....FDFF..FDFF..",
    "....DFFD..DFFD..",
    "....DDDD..DDDD..",
]
LEGS_B = [
    "....FFFF..FFFF..",
    "....FHFF..FHFF..",
    "....FFFF..FFFF..",
    "....FDFF..FDFF..",
    "....DFFD..DDDD..",
    "....DDDD........",
]
# 뒷모습: 꼬리가 몸통 가운데 아래로 보인다
BODY_BACK = [
    "....FHFFDHFFHF..",
    "....FFHFFFHFFF..",
    "....FHFFHFHFHF..",
    "....HFFHDHFFFF..",
]
TAIL_BACK = ["......FHF.......", ".......HF.......", ".......F........"]

# 옆모습 (왼쪽을 본다): 머리 + 몸통 + 다리, 19행
SIDE_A = [
    "......HFDH......",
    ".....HDFHFF.....",
    ".....FFHFDHF....",
    "....FHFFFFDHF...",
    "...FHEFHFFHFFF..",
    "..LLFFFFDHFFFHF.",
    ".NLLFFHFFFFFHFDH",
    "..LFFFFRRFFHFFFH",
    "...FHFFRFHFFHFFF",
    ".....FFHFDHFFHFF",
    ".....FHFFFHFFDFH",
    ".....HFFDHFFFHF.",
    ".....FFFFFFHFF..",
    ".....FHFF.FDFF..",
    ".....FFFF.FFFF..",
    ".....FDFF.FDFF..",
    ".....DFFD.DFFD..",
    ".....DDDD.DDDD..",
]
SIDE_B = SIDE_A[:13] + [
    ".....FHFF.FDFF..",
    "....FFFF..FFFFF.",
    "....FDFF..FDFFF.",
    "....DFFD...DFFD.",
    "....DDDD....DDD.",
]

# 앉기: 원본(머리 + 앉은 몸통 20..24행) + 꼬리
SIT_BODY = [
    ".....DFHyFH.FF..",
    "....FFHFDHFFHFF.",
    "....FHDFHFFFFDF.",
    "....HFFHFDHFFF..",
    "....FFHDFHFF....",
    "....DDDD..DDDD..",
]
SIT_TAIL_L = ["..FH............", ".HF.............", ".F.............."]
SIT_TAIL_R = ["............HF..", ".............FH.", "..............F."]

# 자기: 엎드려서 눈 감고 (옆모습 낮게), 두 번째 프레임은 몸통이 살짝 부풀고 z
SLEEP_A = [
    "......HFDHFF....",
    ".....FHFFHFDHF..",
    "....FFFFHFFFFFH.",
    "...FDFFFFFDHFFFH",
    "..LLFHFFRRFFHFFF",
    ".NLLFFFHFFFHFDFH",
    "..LFDFFFHFFFFHFF",
    "...FFFFFDHFFHFF.",
    "....DDDDDDDDDD..",
]
SLEEP_B = [
    ".............Z..",
    "............Z...",
    "......HFDHFFZ...",
    ".....FHFFHFDHF..",
    "....FFFFHFFFFFH.",
    "...FDFFFFFDHFFFH",
    "..LLFHFFRRFFHFFF",
    ".NLLFFFHFFFHFDFH",
    "..LFDFFFHFFFFHFF",
    "...FFFFFDHFFHFF.",
    "....DDDDDDDDDD..",
]


def build():
    down = [frame(HEAD + BODY_FRONT + LEGS_A), frame(HEAD + BODY_FRONT + LEGS_B)]
    up = [frame(HEAD_BACK + BODY_BACK + LEGS_A), frame(HEAD_BACK + BODY_BACK + LEGS_B)]
    # 뒷모습 꼬리 겹치기
    for f in up:
        for i, tr in enumerate(TAIL_BACK):
            y = 14 + 4 + i - 2
            f[y] = "".join(t if t != "." else c for t, c in zip(tr, f[y]))
    left = [frame(SIDE_A), frame(SIDE_B)]
    right = [mirror(f) for f in left]
    sit_l = frame(HEAD + SIT_BODY)
    sit_r = [r for r in sit_l]
    for i, tr in enumerate(SIT_TAIL_L):
        y = H - 3 + i
        sit_l[y] = "".join(t if t != "." else c for t, c in zip(tr, sit_l[y]))
    for i, tr in enumerate(SIT_TAIL_R):
        y = H - 3 + i
        sit_r[y] = "".join(t if t != "." else c for t, c in zip(tr, sit_r[y]))
    sleep = [frame(SLEEP_A), frame(SLEEP_B)]
    rows = [down, right, up, left, [sit_l, sit_r], sleep]

    sheet = Image.new("RGBA", (2 * W, len(rows) * H), (0, 0, 0, 0))
    px = sheet.load()
    for ry, frames in enumerate(rows):
        for fx, f in enumerate(frames):
            for y, row in enumerate(f):
                for x, c in enumerate(row):
                    if c != ".":
                        px[fx * W + x, ry * H + y] = PAL[c]
    out = sheet.resize((sheet.width * SCALE, sheet.height * SCALE), Image.NEAREST)
    os.makedirs(OUT, exist_ok=True)
    out.save(os.path.join(OUT, "dog.png"), optimize=True)
    meta = dict(
        frameWidth=W * SCALE, frameHeight=H * SCALE, framesPerRow=2,
        rows={"down": 0, "right": 1, "up": 2, "left": 3, "sit": 4, "sleep": 5},
    )
    with open(os.path.join(OUT, "dog.json"), "w", encoding="utf-8") as f:
        json.dump(meta, f)
    prev = out.resize((out.width * 4, out.height * 4), Image.NEAREST)
    os.makedirs(os.path.join(ROOT, "tools", "out"), exist_ok=True)
    prev.save(os.path.join(ROOT, "tools", "out", "dog_preview.png"))
    print("dog:", out.size)


if __name__ == "__main__":
    build()
