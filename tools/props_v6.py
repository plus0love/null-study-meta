"""18단계 소품 (16px 논리, 오리지널).

실내: 세로 슬라이딩 유리문 패널(1x2, 좌우 벽 문용) · 세로 벽 열린 문 자리(1x1)
야외: 동물원 매점 건물(4x3, 위 줄 어닝은 top) · 매점 메뉴판(1x2, 글자는 클라이언트 웹폰트) ·
      파라솔 테이블(2x2, 위 줄 파라솔은 top) · 카페 의자 2방향(앉기 가능)

모든 함수는 Canvas 를 돌려준다.
"""
from pixel import Canvas
from props import AMBER, AMBER_HALO, CREAM, CREAM_DK, CREAM_HI, INK, METAL, METAL_DK, T, WOOD, WOOD_DK, WOOD_HI, WOOD_LT, canvas
from props_outdoor import POST, POST_HI
from props_outdoor2 import AWNING, AWNING_DK, AWNING_LT, WHITE
from props_v3 import BAND0, BAND1, FRAME, FRAME_DK, FRAME_HI, FRAME_HI2, SHADOW

PANEL_BODY = "#2f2c34"
BOARD_DK = "#2b2a2e"
BOARD = "#3a393f"
CONE = "#e2c47a"
CONE_DK = "#b9955a"
CHURRO = "#c9843a"
SUGAR = "#f2e2b0"
BUN = "#e8c48a"
SAUSAGE = "#c96a5a"
MUSTARD = "#f0c94a"
LEMON = "#f7e28a"
CUP = "#dff1f7"
CUP_DK = "#a9cbd8"
CHAIR = "#4a4752"
CHAIR_HI = "#6b6875"


# ── 실내: 좌우 벽 슬라이딩 문 ────────────────────────────────────────────
def study_panel_v(side="s"):
    """세로 슬라이딩 문 패널 1x2 (유리벽과 같은 8px 띠 안). side: 통로가 아래('s')/위('n')."""
    c = canvas(1, 2)
    H = 2 * T
    c.rect(BAND0 - 1, 0, BAND1 - BAND0 + 3, H, PANEL_BODY)
    c.vline(BAND0 - 1, 0, H - 1, FRAME_HI2)
    c.vline(BAND1 + 1, 0, H - 1, FRAME_DK)
    c.hline(BAND0 - 1, BAND1 + 1, 0, FRAME_HI)
    c.hline(BAND0 - 1, BAND1 + 1, H - 1, FRAME_DK)
    c.frame(BAND0, 1, BAND1 - BAND0 + 1, H - 2, "#26232b")
    # 반투명 유리 창 (가운데)
    c.rect(BAND0 + 1, 4, BAND1 - BAND0 - 1, 12, "#d6ecfa40")
    c.vline(BAND0 + 1, 4, 15, "#ffffff40")
    # 손잡이 + 통로 쪽 앰버 라인
    hy = H - 12 if side == "s" else 4
    c.rect(BAND1 - 2, hy, 2, 6, METAL)
    c.vline(BAND1 - 2, hy, hy + 5, "#d9d6dc")
    ly = H - 3 if side == "s" else 1
    c.hline(BAND0, BAND1, ly, AMBER)
    c.hline(BAND0, BAND1, ly + (1 if side == "s" else -1), AMBER_HALO + "a0")
    for x in range(BAND1 + 2, 16):
        c.px(x, 0, SHADOW)
    return c


def door_open_v():
    """세로 벽의 열린 문 자리 (통과 가능): 세로 레일 + 앰버 조명 라인."""
    c = canvas(1, 1)
    c.rect(BAND0 + 2, 0, 2, 16, FRAME)
    c.vline(BAND0 + 2, 0, 15, FRAME_HI2)
    c.vline(BAND0 + 5, 0, 15, AMBER)
    c.vline(BAND0 + 6, 0, 15, AMBER_HALO + "90")
    c.vline(BAND0 + 7, 0, 15, AMBER_HALO + "40")
    return c


# ── 야외: 매점 건물 ────────────────────────────────────────────────────────
def _icecream(c, x, y):
    c.rect(x + 1, y + 5, 3, 5, CONE)
    c.px(x + 2, y + 7, CONE_DK)
    c.px(x + 1, y + 9, CONE_DK)
    c.ellipse(x, y + 1, 5, 5, "#f7c3cc")
    c.ellipse(x, y - 1, 5, 4, "#fff0cc")
    c.px(x + 1, y, "#ffffff")


def _churros(c, x, y):
    c.rect(x, y + 1, 2, 9, CHURRO)
    c.rect(x + 3, y, 2, 10, CHURRO)
    for yy in (y + 2, y + 5, y + 8):
        c.px(x, yy, SUGAR)
        c.px(x + 4, yy - 1, SUGAR)


def _hotdog(c, x, y):
    c.rect(x, y + 3, 8, 5, BUN)
    c.hline(x, x + 7, y + 3, "#f4d9a8")
    c.rect(x, y + 4, 8, 2, SAUSAGE)
    for xx in range(x + 1, x + 7, 2):
        c.px(xx, y + 4, MUSTARD)


def _lemonade(c, x, y):
    c.rect(x, y + 1, 5, 8, CUP_DK)
    c.rect(x + 1, y + 2, 3, 6, LEMON)
    c.rect(x + 1, y + 2, 3, 2, CUP)
    c.px(x + 3, y, METAL)
    c.px(x + 3, y - 1, "#e04c5a")
    c.px(x + 2, y + 5, "#ffffff90")


def snack_shop(w=4, h=2):
    """매점 건물 4x2: 위 줄 = 줄무늬 어닝(top, 통과 가능) + 간판 조명, 아래 줄 = 크림 판자 벽 · 창구(점원 자리) · 메뉴판 · 작은 창.
    카운터는 snack_counter (4x1, top 레이어) 로 따로 놓아 점원의 다리를 가린다."""
    c = canvas(w, h)
    W = w * T
    # 뒷벽 (크림 판자)
    c.rect(1, 12, W - 2, 20, CREAM_DK)
    c.rect(2, 13, W - 4, 19, CREAM)
    for y in range(16, 32, 6):
        c.hline(2, W - 3, y, CREAM_DK)
    c.vline(2, 13, 31, CREAM_HI)
    # 창구 (어두운 안쪽) — 점원은 이 앞에 선다
    c.rect(18, 16, 28, 16, BOARD_DK)
    c.rect(19, 17, 26, 15, BOARD)
    c.hline(19, 44, 17, "#4a4952")
    c.frame(17, 15, 30, 17, WOOD_DK)
    c.hline(18, 45, 15, WOOD_HI)
    # 메뉴판 (왼쪽 벽, 아이콘 + 가격 점)
    c.rect(3, 16, 13, 15, BOARD_DK)
    c.frame(3, 16, 13, 15, WOOD_DK)
    c.hline(4, 14, 17, "#4a4952")
    _icecream(c, 5, 19)
    c.px(13, 20, AMBER)
    c.hline(10, 13, 25, CHURRO)
    c.px(14, 25, AMBER)
    c.hline(5, 9, 28, SAUSAGE)
    c.px(13, 28, AMBER)
    # 오른쪽 벽 작은 창 + 화분
    c.rect(50, 18, 9, 9, "#8fb3c2")
    c.frame(50, 18, 9, 9, WOOD_DK)
    c.px(52, 20, "#ffffff90")
    c.rect(51, 29, 7, 3, "#b57a5f")
    c.rect(52, 27, 5, 2, "#7fae76")
    # 어닝 (위 줄): 줄무늬 + 스캘럽 가장자리 + 위쪽 지지대 + 간판 조명
    c.rect(0, 4, W, 9, AWNING)
    for x in range(0, W, 8):
        c.rect(x, 4, 4, 9, AWNING_LT)
    c.hline(0, W - 1, 4, "#f6d3ba")
    for x in range(0, W, 4):
        col = AWNING_DK if (x // 4) % 2 else AWNING
        c.rect(x, 13, 4, 2, col)
        c.px(x + 1, 15, col)
        c.px(x + 2, 15, col)
    c.rect(1, 1, W - 2, 3, WOOD_DK)
    c.hline(2, W - 3, 1, WOOD_HI)
    for lx in (14, W - 18):
        c.rect(lx, 0, 4, 2, POST)
        c.px(lx + 1, 2, "#ffe6b3")
        c.px(lx + 2, 2, "#ffe6b3")
        c.px(lx + 1, 3, AMBER + "80")
        c.px(lx + 2, 3, AMBER + "80")
    return c


def snack_counter(w=4):
    """매점 카운터 4x1 (top 레이어 — 뒤에 선 점원의 다리를 가린다, 충돌은 서버 setSolid): 상판 + 앞판 + 진열 4종."""
    c = canvas(w, 1)
    W = w * T
    c.rect(1, 1, W - 2, 6, WOOD_HI)
    c.rect(1, 0, W - 2, 2, "#c9a37e")
    c.hline(1, W - 2, 0, "#dcb994")
    c.rect(1, 7, W - 2, 8, WOOD)
    c.hline(1, W - 2, 7, WOOD_LT)
    for x in range(6, W - 4, 12):
        c.vline(x, 8, 13, WOOD_DK)
    c.rect(0, 14, W, 2, "#1f1d23")
    # 진열: 상판 위 (위 줄에 걸치지 않게 작게)
    c.rect(7, 2, 3, 4, CONE)
    c.px(8, 4, CONE_DK)
    c.ellipse(6, -1, 5, 4, "#f7c3cc")
    c.rect(20, 1, 2, 5, CHURRO)
    c.rect(23, 0, 2, 6, CHURRO)
    c.px(20, 3, SUGAR)
    c.px(23, 2, SUGAR)
    c.rect(31, 2, 8, 4, BUN)
    c.rect(31, 3, 8, 2, SAUSAGE)
    c.px(33, 3, MUSTARD)
    c.px(36, 3, MUSTARD)
    c.rect(46, 0, 5, 6, CUP_DK)
    c.rect(47, 1, 3, 4, LEMON)
    c.px(48, 1, CUP)
    for x0, x1 in ((6, 11), (20, 24), (31, 38), (46, 50)):
        c.hline(x0, x1, 6, "#00000030")
    return c


def snack_menu():
    """메뉴판 1x2 (기둥 위 칠판, 글자는 클라이언트 라벨)."""
    c = canvas(1, 2)
    c.rect(1, 1, 14, 18, WOOD_DK)
    c.rect(2, 2, 12, 16, BOARD)
    c.hline(2, 13, 2, "#4a4952")
    c.hline(4, 11, 4, AMBER)
    c.rect(7, 19, 2, 11, POST)
    c.px(7, 20, POST_HI)
    c.rect(5, 30, 6, 2, POST)
    c.rect(4, 31, 8, 1, "#1f1d23")
    return c


# ── 야외: 파라솔 테이블 · 카페 의자 ───────────────────────────────────────
def parasol_table():
    """파라솔 테이블 2x2: 위 줄 = 줄무늬 파라솔(top), 아래 줄 = 둥근 테이블 + 기둥 + 컵."""
    c = canvas(2, 2)
    W = 2 * T
    # 파라솔 (반원 줄무늬)
    c.ellipse(0, 2, W, 14, AWNING_DK)
    c.ellipse(1, 1, W - 2, 13, AWNING)
    for x in range(3, W - 3, 6):
        c.rect(x, 3, 3, 8, WHITE)
    for y in range(9, 16):  # 반원만 남긴다 (알파 0 은 px() 가 무시하니 직접 지운다)
        for x in range(W):
            c.px_[x, y] = (0, 0, 0, 0)
    c.hline(1, W - 2, 8, AWNING_DK)
    for x in range(1, W - 1, 3):
        c.px(x, 9, AWNING_DK)
    c.px(W // 2 - 1, 0, POST)
    c.px(W // 2, 0, POST)
    c.rect(W // 2 - 1, 1, 2, 22, POST)
    c.vline(W // 2 - 1, 1, 22, POST_HI)
    # 테이블 (둥근 상판)
    c.ellipse(3, 20, W - 6, 9, WOOD_DK)
    c.ellipse(3, 19, W - 6, 8, WOOD_LT)
    c.hline(6, W - 7, 19, WOOD_HI)
    c.rect(W // 2 - 1, 27, 2, 3, POST)
    c.rect(W // 2 - 4, 29, 8, 2, POST)
    c.rect(W // 2 - 5, 30, 10, 2, "#1f1d23")
    # 컵 2개
    c.rect(8, 20, 3, 3, CUP)
    c.px(8, 20, LEMON)
    c.rect(20, 21, 3, 3, "#f2ece2")
    c.hline(20, 22, 21, "#8b5e3c")
    return c


def cafe_chair(facing="right"):
    """카페 의자 1x1 (앉기 가능, 통과 가능). facing 은 앉았을 때 보는 방향 — 등받이는 반대쪽."""
    c = canvas(1, 1)
    # 좌석
    c.rect(3, 5, 10, 7, CHAIR)
    c.frame(3, 5, 10, 7, "#3a3742")
    c.hline(4, 11, 6, CHAIR_HI)
    # 다리
    c.rect(4, 12, 2, 3, "#3a3742")
    c.rect(10, 12, 2, 3, "#3a3742")
    c.hline(3, 12, 15, "#00000030")
    # 등받이 (보는 방향의 반대)
    if facing == "right":
        c.rect(2, 3, 2, 10, CHAIR)
        c.vline(2, 3, 12, CHAIR_HI)
        c.rect(3, 3, 3, 1, CHAIR_HI)
    elif facing == "left":
        c.rect(12, 3, 2, 10, CHAIR)
        c.vline(13, 3, 12, "#3a3742")
        c.rect(10, 3, 3, 1, CHAIR_HI)
    elif facing == "down":
        c.rect(3, 2, 10, 3, CHAIR)
        c.hline(3, 12, 2, CHAIR_HI)
    else:
        c.rect(3, 11, 10, 3, CHAIR)
        c.hline(3, 12, 11, CHAIR_HI)
    return c


def park_bin():
    """야외 쓰레기통 1x1 (초록 철제)."""
    c = canvas(1, 1)
    c.rect(4, 3, 8, 12, "#4f6a45")
    c.rect(5, 4, 6, 10, "#6b8a5e")
    c.vline(5, 4, 13, "#8aa578")
    c.rect(3, 2, 10, 2, "#3b5234")
    c.hline(3, 12, 2, "#6b8a5e")
    c.rect(6, 0, 4, 2, "#3b5234")
    c.rect(3, 15, 10, 1, "#00000030")
    return c
