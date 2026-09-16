"""팔레트 리컬러 도구.

Kenney Roguelike Indoors 팩(채도 높은 주황/초록)을 목업(design/studyroom.png)의
따뜻한 파스텔 톤으로 옮긴다. 정확히 아는 색은 표(PALETTE)로 1:1 매핑하고,
표에 없는 색은 HSL 기반 폴백(채도 낮추고 살짝 밝히고 난색 쪽으로 이동)으로 처리한다.

단독 실행:  python tools/recolor.py in.png out.png [--variant sofa]
빌드에서:   from recolor import recolor
"""
import colorsys
import sys

from PIL import Image

# ── 기본 팔레트: Kenney 원색 → 파스텔 목표색 ─────────────────────────────
PALETTE = {
    # 나무
    "#c8a480": "#d8b58f",   # 밝은 나무
    "#b98b5e": "#b88a66",   # 중간 나무
    "#8f673f": "#7c5a44",   # 어두운 나무
    "#b69575": "#c4a184",
    "#a87e54": "#a37b5c",
    "#a17d52": "#9f7a58",
    "#98601e": "#8a5f3a",
    "#c9a786": "#d3b394",
    "#a18163": "#a3866a",
    "#7e7258": "#867a64",
    # 주황 → 더스티 테라코타 / 살구
    "#c66527": "#d9977a",
    "#b45c24": "#c4806a",
    "#a35422": "#a96c58",
    "#df9131": "#e8b68e",
    "#d08020": "#d9a577",
    "#d27134": "#d6926f",
    # 초록 → 세이지
    "#4ba86d": "#8fae88",
    "#409c62": "#7a9a75",
    "#307e4d": "#5f7d5c",
    "#5eb780": "#a5c19d",
    "#639535": "#7f9a60",
    "#648c32": "#6f8a52",
    "#79b742": "#9bbb74",
    # 크림 / 베이지
    "#e6dabf": "#efe3cc",
    "#fff4c9": "#fff6da",
    "#ffe6af": "#ffe9c2",
    "#d9caa9": "#dfd2b7",
    "#ece2cd": "#f2ead9",
    "#e0d1af": "#e6d9bf",
    "#b4a78c": "#bfb39b",
    "#a69c70": "#b0a882",
    # 회색 → 따뜻한 회색
    "#c2c2c2": "#cfc8c1",
    "#999999": "#a6a09a",
    "#757575": "#7e7974",
    "#5c5c5c": "#5a5660",
    "#494949": "#46434c",
    "#dfdfdf": "#e6e1dc",
    "#959595": "#a19b95",
    "#838790": "#8a8c94",
    "#878787": "#918c87",
    "#e9e9e9": "#ece8e3",
    "#ebebeb": "#eeeae5",
    "#e1e1e1": "#e5e0db",
    "#dedede": "#e2ddd8",
    "#f7f7f7": "#f8f6f3",
    # 청록 → 파스텔 민트
    "#30a19b": "#7fb3ad",
    "#39b0aa": "#8cc0ba",
    "#287d79": "#5f8f8a",
    "#37aaa5": "#86bcb6",
    "#44bbb6": "#96c8c2",
    # 노랑
    "#ffc90e": "#ffd464",
    "#c69900": "#d1a93a",
}

# ── 변형: 특정 오브젝트에만 덧씌우는 매핑 ───────────────────────────────
VARIANTS = {
    # 소파: 주황 → 크림 천, 초록 → 올리브 쿠션
    "sofa": {
        "#c66527": "#ecd3ad", "#b45c24": "#d8b98f", "#a35422": "#c4a479",
        "#4ba86d": "#8a9a6c", "#409c62": "#75855b", "#307e4d": "#5c6a47",
    },
    # 안락의자: 세이지
    "sage": {
        "#c66527": "#9fb494", "#b45c24": "#86997c", "#a35422": "#6f8266",
    },
    # 의자: 어두운 나무 + 올리브 쿠션 (목업의 진한 의자)
    "chair": {
        "#c66527": "#8a9a6c", "#b45c24": "#75855b", "#a35422": "#5c6a47",
        "#c8a480": "#a37d5e", "#b98b5e": "#7d5a41", "#8f673f": "#4e3727",
    },
    # 카운터: 회색 상판 → 크림 대리석
    "counter": {
        "#c2c2c2": "#e2d8c8", "#dfdfdf": "#efe8db", "#999999": "#c2b6a3",
    },
}


def _hex(c):
    c = c.lstrip("#")
    return tuple(int(c[i:i + 2], 16) for i in (0, 2, 4))


def _fallback(rgb):
    """표에 없는 색: 채도 -30%, 명도 +6%, 색상은 난색(주황 30도) 쪽으로 8% 이동."""
    r, g, b = (v / 255 for v in rgb)
    h, l, s = colorsys.rgb_to_hls(r, g, b)
    target_h = 30 / 360
    dh = (target_h - h + 0.5) % 1.0 - 0.5
    h = (h + dh * 0.08) % 1.0
    s = max(0.0, s * 0.7)
    l = min(1.0, l + (1 - l) * 0.06)
    r, g, b = colorsys.hls_to_rgb(h, l, s)
    return tuple(int(round(v * 255)) for v in (r, g, b))


def build_map(variant=None):
    m = {_hex(k): _hex(v) for k, v in PALETTE.items()}
    if variant:
        for k, v in VARIANTS[variant].items():
            m[_hex(k)] = _hex(v)
    return m


def recolor(img, variant=None, fallback=True):
    """RGBA PIL 이미지를 리컬러한 새 이미지를 돌려준다."""
    img = img.convert("RGBA")
    table = build_map(variant)
    cache = {}
    out = Image.new("RGBA", img.size)
    src = img.load()
    dst = out.load()
    w, h = img.size
    for y in range(h):
        for x in range(w):
            r, g, b, a = src[x, y]
            if a == 0:
                dst[x, y] = (0, 0, 0, 0)
                continue
            key = (r, g, b)
            if key not in cache:
                if key in table:
                    cache[key] = table[key]
                elif fallback:
                    cache[key] = _fallback(key)
                else:
                    cache[key] = key
            dst[x, y] = cache[key] + (a,)
    return out


def main(argv):
    if len(argv) < 3:
        print(__doc__)
        return 1
    variant = None
    if "--variant" in argv:
        variant = argv[argv.index("--variant") + 1]
    recolor(Image.open(argv[1]), variant).save(argv[2])
    print("saved", argv[2])
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
