"""3단계 소품: 두께감 있는 유리 파티션(프레임 기둥 + 유리 판), 슬라이딩 문 패널, 문턱, 작은 수납장, 벽 선반.

유리벽은 타일 가운데 8px 띠(x 4..11)를 쓴다.
  - 판(pane): 양쪽 2px 차콜 레일 + 가운데 4px 반투명 하늘빛 유리(바닥이 비쳐 보임) + 흰 하이라이트 1줄
  - 기둥(post): 띠 전체가 차콜. 위·왼쪽 모서리 하이라이트, 오른쪽·아래에 바닥 그림자 → 두께감
스터디룸 안쪽의 유리 틴트·사선 반사는 타일이 아니라 클라이언트가 zones 로 그린다.
"""
from pixel import Canvas
from props import (AMBER, AMBER_HALO, GLASS_FRAME, GLASS_FRAME_HI, INK, LEAF, LEAF_HI, LEAF_LT, METAL, POT, POT_HI, T,
                   _SPINES, canvas)
from props_v2 import wall_block

FRAME = GLASS_FRAME  # "#2b2830"
FRAME_HI = GLASS_FRAME_HI  # "#4d4954"
FRAME_HI2 = "#3f3b46"
FRAME_DK = "#1c1a20"
PANE = "#d6ecfa5c"
PANE_HI = "#ffffff58"
SHADOW = "#00000030"
BAND0, BAND1 = 4, 11  # 띠 범위 (포함)


def _band_mask(conns):
    """기둥용: 가운데 8x8 + 연결 방향 팔."""
    m = [[False] * 16 for _ in range(16)]

    def fill(x0, y0, x1, y1):
        for y in range(y0, y1 + 1):
            for x in range(x0, x1 + 1):
                m[y][x] = True

    fill(BAND0, BAND0, BAND1, BAND1)
    if "N" in conns:
        fill(BAND0, 0, BAND1, BAND0)
    if "S" in conns:
        fill(BAND0, BAND1, BAND1, 15)
    if "E" in conns:
        fill(BAND1, BAND0, 15, BAND1)
    if "W" in conns:
        fill(0, BAND0, BAND0, BAND1)
    return m


def glass_post(conns):
    """차콜 프레임 기둥/모서리. conns: 'N','S','E','W' 조합."""
    c = canvas(1, 1)
    m = _band_mask(conns)
    for y in range(16):
        for x in range(16):
            if not m[y][x]:
                continue
            up = y > 0 and m[y - 1][x]
            left = x > 0 and m[y][x - 1]
            down = y < 15 and m[y + 1][x]
            if not up:
                col = FRAME_HI
            elif not left:
                col = FRAME_HI2
            elif not down:
                col = FRAME_DK
            else:
                col = FRAME
            c.px(x, y, col)
    # 바닥 그림자 (오른쪽·아래 1px)
    for y in range(16):
        for x in range(16):
            if m[y][x]:
                if x < 15 and not m[y][x + 1]:
                    c.px(x + 1, y, SHADOW)
                if y < 15 and not m[y + 1][x]:
                    c.px(x, y + 1, SHADOW)
    return c


def glass_pane(axis):
    """유리 판. axis 'NS'(세로) 또는 'EW'(가로)."""
    c = canvas(1, 1)
    if axis == "NS":
        c.rect(BAND0, 0, 2, 16, FRAME)
        c.vline(BAND0, 0, 15, FRAME_HI2)
        c.rect(BAND1 - 1, 0, 2, 16, FRAME)
        c.rect(BAND0 + 2, 0, 4, 16, PANE)
        c.vline(BAND0 + 2, 0, 15, PANE_HI)
        c.vline(BAND1 + 1, 0, 15, SHADOW)
    else:
        c.rect(0, BAND0, 16, 2, FRAME)
        c.hline(0, 15, BAND0, FRAME_HI)
        c.rect(0, BAND1 - 1, 16, 2, FRAME)
        c.rect(0, BAND0 + 2, 16, 4, PANE)
        c.hline(0, 15, BAND0 + 2, PANE_HI)
        c.hline(0, 15, BAND1 + 1, SHADOW)
    return c


def door_open():
    """미닫이문 열린 자리(통과 가능): 바닥 레일 + 앰버 조명 라인."""
    c = canvas(1, 1)
    c.rect(0, 9, 16, 2, FRAME)
    c.hline(0, 15, 9, FRAME_HI2)
    c.hline(0, 15, 12, AMBER)
    c.hline(0, 15, 13, AMBER_HALO + "90")
    c.hline(0, 15, 14, AMBER_HALO + "40")
    return c


def sliding_door_panel(side="r", w=2, h=4):
    """프레임과 같은 톤의 슬라이딩 문 패널 (2x4). side 는 문이 열린 통로 쪽 ('r' 이면 오른쪽에 통로)."""
    c = canvas(w, h)
    W, H = w * T, h * T
    body = "#2f2c34"
    c.rect(0, 0, W, H, body)
    c.hline(0, W - 1, 0, FRAME_HI)
    c.vline(0, 0, H - 1, FRAME_HI2)
    c.vline(W - 1, 0, H - 1, FRAME_DK)
    c.hline(0, W - 1, H - 1, FRAME_DK)
    c.frame(1, 1, W - 2, H - 2, "#26232b")
    # 이름 플라크 (글자는 클라이언트 웹폰트)
    c.rect(4, 10, W - 8, 14, "#1c1a21")
    c.frame(4, 10, W - 8, 14, "#3d3944")
    # 아래쪽 레일 + 바닥 조명
    c.rect(0, H - 4, W, 2, FRAME_DK)
    c.hline(2, W - 3, H - 5, AMBER)
    c.hline(2, W - 3, H - 4, AMBER_HALO + "a0")
    # 세로 손잡이 + 앰버 조명 라인 (통로 쪽)
    if side == "r":
        hx, lx = W - 9, W - 3
    else:
        hx, lx = 7, 2
    c.rect(hx, 34, 2, 16, METAL)
    c.vline(hx, 34, 49, "#d9d6dc")
    c.vline(hx + 2, 35, 50, FRAME_DK)
    c.vline(lx, 30, H - 7, AMBER)
    c.vline(lx + (-1 if side == "r" else 1), 32, H - 9, AMBER_HALO)
    return c


def cabinet_small():
    """낮은 2x2 수납장 (책·상자·작은 화분 올려둠)."""
    c = canvas(2, 2)
    W = 2 * T
    c.rect(1, 12, W - 2, 18, "#4a3327")
    c.rect(1, 10, W - 2, 4, "#6b4c36")
    c.hline(1, W - 2, 10, "#8a6a52")
    c.rect(2, 15, 13, 6, "#3f2d22")
    c.rect(17, 15, 13, 6, "#3f2d22")
    c.rect(2, 23, 13, 5, "#3f2d22")
    c.rect(17, 23, 13, 5, "#3f2d22")
    for x, y in ((8, 17), (23, 17), (8, 25), (23, 25)):
        c.px(x, y, "#d8b58f")
    c.rect(2, 30, 3, 1, "#2f2016")
    c.rect(W - 5, 30, 3, 1, "#2f2016")
    # 위 소품: 책 더미, 상자, 작은 화분
    for i, col in enumerate(_SPINES[:3]):
        c.rect(3 + i, 4 + i * 2, 9, 2, col)
    c.rect(15, 5, 7, 5, "#c9a98b")
    c.frame(15, 5, 7, 5, "#a08466")
    c.rect(25, 6, 4, 4, POT)
    c.hline(25, 28, 6, POT_HI)
    c.px(26, 4, LEAF)
    c.px(27, 4, LEAF_LT)
    c.px(26, 3, LEAF_HI)
    c.px(28, 5, LEAF)
    return c


def wall_shelf_b():
    """벽 선반 (벽 배경 포함 1x2): 널빤지 2단에 책·작은 화분."""
    c = canvas(1, 2)
    c.blit(wall_block(1, 2), 0, 0)
    for y in (9, 21):
        c.rect(1, y, 14, 2, "#5e4331")
        c.hline(1, 14, y, "#7c5a44")
    for i, col in enumerate(_SPINES[1:5]):
        c.rect(2 + i * 3, 4, 2, 5, col)
    c.px(3, 5, "#f5efe3")
    c.rect(11, 5, 3, 4, "#c9a98b")
    c.rect(2, 16, 4, 5, POT)
    c.hline(2, 5, 16, POT_HI)
    c.px(3, 14, LEAF_LT)
    c.px(4, 14, LEAF)
    c.px(2, 15, LEAF)
    c.px(5, 15, LEAF_HI)
    c.px(3, 13, LEAF_HI)
    for i, col in enumerate((_SPINES[6], _SPINES[7], _SPINES[0])):
        c.rect(8 + i * 2, 15 + (i % 2), 2, 6 - (i % 2), col)
    c.px(9, 19, INK)
    return c


def preview():
    """검수용: 각 소품을 한 장에."""
    from PIL import Image
    items = [glass_post("NS"), glass_post("EW"), glass_post("NE"), glass_post("NW"), glass_post("E"), glass_pane("NS"),
             glass_pane("EW"), door_open(), sliding_door_panel("r"), sliding_door_panel("l"), cabinet_small(), wall_shelf_b()]
    W = sum(i.w for i in items) + 8 * len(items)
    im = Image.new("RGBA", (W, 64), (150, 110, 90, 255))
    x = 4
    for it in items:
        im.alpha_composite(it.im, (x, 0))
        x += it.w + 8
    return im.resize((im.width * 4, im.height * 4), Image.NEAREST)


if __name__ == "__main__":
    import os
    out = os.path.join(os.path.dirname(os.path.abspath(__file__)), "out", "props_v3_preview.png")
    preview().save(out)
    print("saved", out)
