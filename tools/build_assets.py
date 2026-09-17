"""타일 아틀라스 + 캐릭터 스프라이트 빌드.

입력:
  tools/raw/kenney_roguelike_indoors/Tilesheets/roguelikeIndoor_transparent.png  (CC0, 16px + 1px 여백)
  tools/raw/oga_zelda/gfx/character.png                                          (CC0, 16x32 4방향 걷기)
출력:
  public/assets/tiles.png   32px 타일 아틀라스 (16px 논리 → 2배 확대, nearest)
  public/assets/tiles.json  오브젝트 이름 → {w,h,layer,solid,top,tiles[[idx..]..],anim}
  public/assets/player.png  32x64 프레임, 4열(걷기) x 4행(down,right,up,left)
  public/assets/player.json
  tools/out/preview.png     오브젝트 미리보기 (검수용)

실행: python tools/build_assets.py
"""
import json
import os
import sys
from itertools import combinations

from PIL import Image, ImageDraw

sys.path.insert(0, os.path.dirname(__file__))
import props as P  # noqa: E402
import props_room as R  # noqa: E402
import props_v2 as V  # noqa: E402
import props_v3 as G  # noqa: E402
import props_outdoor as O  # noqa: E402
from pixel import Canvas  # noqa: E402
from recolor import recolor  # noqa: E402

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
RAW = os.path.join(ROOT, "tools", "raw")
OUT = os.path.join(ROOT, "public", "assets")
PREVIEW_DIR = os.path.join(ROOT, "tools", "out")
T = 16
SCALE = 2
COLUMNS = 16

KENNEY = Image.open(os.path.join(RAW, "kenney_roguelike_indoors", "Tilesheets", "roguelikeIndoor_transparent.png")).convert("RGBA")
ZELDA_CHAR = Image.open(os.path.join(RAW, "oga_zelda", "gfx", "character.png")).convert("RGBA")


def K(c, r, w=1, h=1, variant=None):
    """Kenney 시트에서 (c,r) 부터 w x h 타일을 잘라 리컬러한 Canvas."""
    out = Canvas(w * T, h * T)
    for dy in range(h):
        for dx in range(w):
            x, y = (c + dx) * 17, (r + dy) * 17
            out.paste(KENNEY.crop((x, y, x + T, y + T)), dx * T, dy * T)
    out.im = recolor(out.im, variant)
    out.px_ = out.im.load()
    return out


def stacked(top, bottom):
    c = Canvas(T, 2 * T)
    c.blit(top, 0, 0)
    c.blit(bottom, 0, T)
    return c


def over(bg, fg):
    c = Canvas(bg.w, bg.h)
    c.blit(bg, 0, 0)
    c.blit(fg, 0, 0)
    return c


# ── 오브젝트 레지스트리 ─────────────────────────────────────────────────
OBJECTS = {}


def add(name, cv, layer="furniture", solid=True, top=0, anim=None, seats=None, door=False, cycle=False):
    """seats: [(dx, dy, facing)] — 해당 셀은 통과 가능 + 앉기 가능.
    anim: 다음 프레임 오브젝트 이름. cycle=True 면 창문 깜빡임(무작위)이 아니라 일정 속도로 순환한다 (물·분수, cycleTiles)."""
    w, h = cv.w // T, cv.h // T
    OBJECTS[name] = dict(img=cv.im, w=w, h=h, layer=layer, solid=solid, top=top, anim=anim, seats=seats or [], door=door, cycle=cycle)


def build_objects():
    wf = V.wall_block

    # 바닥 (floor 레이어) — 널빤지 3톤 x 이음새 유무
    for v in range(3):
        add(f"floor_{v}", V.floor_plank(v), "floor", False)
        add(f"floor_{v}_seam", V.floor_plank(v, seam=[4, 11, 7][v]), "floor", False)
        add(f"floor_{v}_shadow", V.floor_shadow(V.floor_plank(v), "N"), "floor", False)
    add("facade", R.facade(), "floor", True)
    add("paver_0", R.paver(0), "floor", False)
    add("paver_1", R.paver(1), "floor", False)
    add("kerb", R.kerb(), "floor", False)
    add("grass_0", R.grass_strip(0), "floor", True)
    add("grass_1", R.grass_strip(1), "floor", True)
    # 러그 (테두리 + 패턴)
    add("rug_lounge", V.rug_fancy(12, 4, pattern="grid"), "floor", False)
    add("rug_pouf", V.rug_fancy(7, 6, base="#e0cfae", border="#b08a63", border2="#cdb38b", pattern="diamond", accent="#cbb58f"), "floor", False)
    add("rug_coffee", V.rug_fancy(4, 2, base="#c9a98b", border="#8f6a4c", border2="#b8967a", pattern="dots", accent="#bd9d7e"), "floor", False)
    add("rug_study", V.rug_fancy(5, 6, base="#ddd0b8", border="#b39470", border2="#cbb694", pattern="dots", accent="#cfc0a3"), "floor", False)
    add("rug_corridor", V.rug_fancy(3, 10, base="#dccab0", border="#a98a67", border2="#c8ae8a", pattern="diamond", accent="#cdb99c"), "floor", False)
    add("rug_meeting", V.rug_fancy(7, 9, base="#e3d3b3", border="#b08960", border2="#cfb48d", pattern="grid", accent="#d3bd97"), "floor", False)
    add("doormat_big", V.doormat_blank(), "floor", False)

    # 벽 (몰딩)
    add("wall_top", P.wall_top())
    add("wall_l", P.wall_side("l"))
    add("wall_r", P.wall_side("r"))
    add("wall_face", wf(1))
    add("wall_picture_a", over(wf(1), stacked(K(16, 12), Canvas(T, T))))
    add("wall_picture_b", over(wf(1), stacked(K(17, 12), Canvas(T, T))))
    add("wall_picture_c", over(wf(1), stacked(K(18, 12), Canvas(T, T))))
    add("wall_frames_a", V.wall_frames(0))
    add("wall_frames_b", V.wall_frames(1))
    add("wall_shelf", over(wf(1), stacked(Canvas(T, T), K(19, 17))))
    add("wall_lamp", R.wall_spot())
    add("wall_clock", V.wall_clock())
    add("wall_shelf_b", G.wall_shelf_b())

    # 창문 (5타일 높이, 3프레임 깜빡임: 이름_f0 → _f1 → _f2 → _f0) + 낮 버전(이름_day, 애니 없음)
    # 하늘은 투명 — 클라이언트가 room.windows 에 시간대별 그라데이션을 깐다
    def window_set(base, kind, lamp, seed):
        names = [f"{base}_f{f}" for f in range(3)]
        for f in range(3):
            add(names[f], V.window_big(kind, lamp, frame=f, seed=seed), anim=names[(f + 1) % 3])
        add(f"{base}_day", V.window_big(kind, lamp, frame=0, seed=seed, day=True))

    window_set("window_l", "l", False, 7)
    window_set("window_r", "r", False, 11)
    for s in range(4):
        window_set(f"window_m_{s}", "m", False, s)
        window_set(f"window_m_lamp_{s}", "m", True, 50 + s)

    # 상단 벽 보드류 (글자 없음 — 클라이언트 웹폰트)
    add("chalkboard_big", V.chalkboard_blank())
    add("cabinet_printer", R.cabinet_printer())
    add("board_focus_tall", V.board_tall_blank())
    add("bookshelf_big", R.bookshelf_big())
    add("music_panel", V.music_panel_blank())

    # 라운지
    add("sofa_wide", V.sofa_wide(), seats=[(1, 1, "down"), (2, 1, "down"), (3, 1, "down"), (4, 1, "down")])
    add("round_table", V.round_table())
    add("standing_lamp", P.standing_lamp(), top=1)
    add("cushion", V.sprite_png("cushion.png"))  # 강아지 쿠션 (1x1). 푸들은 NPC 스프라이트(tools/dog_sprite.py)로 움직인다

    # 카페 코너
    add("menu_board_cream", V.menu_board_blank())
    add("counter_cups", V.counter_dense(0))
    add("counter_bottles", V.counter_dense(1))
    add("counter_grinder", V.counter_dense(2))
    add("counter_plates", K(4, 12, variant="counter"))
    add("cup_shelf", V.cup_shelf())
    add("coffee_machine", P.coffee_machine())
    add("display_case", R.display_case())
    add("shelf_narrow_a", R.shelf_narrow(2, 1))
    add("shelf_narrow_b", R.shelf_narrow(2, 2))
    add("shelf_narrow_c", R.shelf_narrow(2, 3))
    add("ladder_shelf", R.ladder_shelf())

    # 푸프 / 작은 테이블
    add("pouf_cream", V.pouf_big("#e6cfa8", "#c9ae83", "#f4e3c6"), solid=False, seats=[(0, 1, "down")])
    add("pouf_green", V.pouf_big("#4f6a45", "#3b5234", "#6b8a5e"), solid=False, seats=[(0, 1, "down")])
    add("side_table_round", R.side_table_round())

    # 스터디룸
    add("desk_wide", V.desk_wide())
    add("desk_return", V.desk_return())
    add("nightstand", R.nightstand())
    # 유리 파티션: 두께감 있는 차콜 기둥(gpost_*) + 반투명 유리 판(glass_NS/EW) + 열린 문 자리(door_open)
    add("study_panel_1", G.sliding_door_panel("r"))  # 슬라이딩 문 패널 2x4 (통로가 오른쪽)
    add("study_panel_2", G.sliding_door_panel("l"))
    add("door_open", G.door_open(), solid=False, door=True)
    add("glass_NS", G.glass_pane("NS"))
    add("glass_EW", G.glass_pane("EW"))
    for n in (1, 2, 3, 4):
        for combo in combinations("NSEW", n):
            key = "".join(d for d in "NSEW" if d in combo)
            add(f"gpost_{key}", G.glass_post(key))

    # 회의 구역 / 의자
    add("whiteboard_big", V.whiteboard_blank())
    add("big_table_v", R.big_table_v())
    for f, facing in (("n", "up"), ("s", "down"), ("e", "right"), ("w", "left")):
        add(f"chair_{f}", V.chair_black(f), solid=False, seats=[(0, 0, facing)])

    # 화분 3종+
    add("plant_small_a", K(16, 0))
    add("plant_small_b", K(17, 0))
    for s in range(4):
        add(f"plant_tall_{s}", P.plant_tall(seed=s), top=1)
    for s in range(2):
        add(f"plant_palm_{s}", V.plant_palm(seed=s), top=1)
        add(f"plant_bush_{s}", V.plant_bush(seed=s))
    add("plant_hanging", P.plant_hanging(), "top", False)
    add("wall_vine", V.wall_vine(), "top", False)

    # 자잘한 소품
    add("coat_rack", V.coat_rack(), top=1)
    add("cabinet_small", G.cabinet_small())
    add("trash_bin", V.trash_bin())
    add("water_dispenser", V.water_dispenser(), top=1)

    # 입구 / 실외
    add("entrance_wide", R.entrance_wide())
    add("bollard", R.bollard(), top=1)
    add("hedge_0", R.hedge(0))
    add("hedge_1", R.hedge(1))
    add("hedge_flower_0", R.hedge_flower(2))
    add("hedge_flower_1", R.hedge_flower(3))
    add("bench", R.bench())
    add("sign_left", V.sign_outdoor_blank())
    add("sign_right", V.sign_outdoor_blank())

    # ── 12단계 야외 (기존 인덱스가 바뀌지 않도록 항상 맨 뒤에 추가) ──
    for tone in range(3):
        for seed in range(2):
            add(f"grass_{'abc'[tone]}{seed}", O.grass(tone, seed), "floor", False)
    add("hill_a", O.hill(0, 1), "floor", False)
    add("hill_b", O.hill(1, 2), "floor", False)
    add("hill_edge", O.hill_edge(3), "floor", False)
    add("dirt_a", O.dirt(0, 1), "floor", False)
    add("dirt_b", O.dirt(1, 2), "floor", False)
    for side in "NSEW":
        add(f"dirt_edge_{side}", O.dirt_edge(side), "floor", False)
    add("start_line", O.start_line(), "floor", False)
    add("stone_path_a", O.stone_path(0), "floor", False)
    add("stone_path_b", O.stone_path(1), "floor", False)
    add("plaza_a", O.plaza(0), "floor", False)
    add("plaza_b", O.plaza(1), "floor", False)
    add("plaza_ring", O.plaza_ring(), "floor", False)
    add("water_f0", O.water(0), "floor", True, anim="water_f1", cycle=True)
    add("water_f1", O.water(1), "floor", True, anim="water_f0", cycle=True)
    for sides in ("N", "S", "E", "W", "NE", "NW", "SE", "SW"):
        add(f"shore_{sides}", O.shore(sides), "floor", True)
    add("deck_a", O.deck(0), "floor", False)
    add("deck_b", O.deck(1), "floor", False)
    add("sky", O.sky_tile(), "floor", True)
    add("tree_round", O.tree_round(), top=2)
    add("tree_pine", O.tree_pine(), top=2)
    add("tree_small", O.tree_small(), top=1)
    for i in range(3):
        add(f"flower_{i}", O.flower(i), solid=False)
    add("rock_a", O.rock(False))
    add("rock_b", O.rock(True))
    for f in range(3):
        add(f"fountain_f{f}", O.fountain(f), anim=f"fountain_f{(f + 1) % 3}", cycle=True)
    add("lamp_post", O.lamp_post(), top=1)
    add("bench_park", O.bench_park(), solid=False, seats=[(0, 0, "down"), (1, 0, "down")])
    add("stand_bench", O.stand_bench(), solid=False, seats=[(0, 0, "left"), (1, 0, "left"), (2, 0, "left")])
    add("picnic_table", O.picnic_table())
    add("kart_stop", O.kart_stop(), top=1)
    add("scoreboard", O.scoreboard())
    add("railing_h", O.railing("H"))
    add("railing_v", O.railing("V"))
    add("telescope", O.telescope(), top=1)


# ── 아틀라스 패킹 ──────────────────────────────────────────────────────
def build_atlas():
    tiles = []  # 16px PIL 이미지 목록 (index = 아틀라스 인덱스)
    meta = {}
    for name, o in OBJECTS.items():
        grid = []
        for ty in range(o["h"]):
            row = []
            for tx in range(o["w"]):
                tile = o["img"].crop((tx * T, ty * T, tx * T + T, ty * T + T))
                row.append(len(tiles))
                tiles.append(tile)
            grid.append(row)
        meta[name] = dict(w=o["w"], h=o["h"], layer=o["layer"], solid=o["solid"], top=o["top"], tiles=grid)
        if o["anim"]:
            meta[name]["anim"] = o["anim"]
        if o["seats"]:
            meta[name]["seats"] = [dict(dx=dx, dy=dy, facing=f) for dx, dy, f in o["seats"]]
        if o["door"]:
            meta[name]["door"] = True
    rows = (len(tiles) + COLUMNS - 1) // COLUMNS
    atlas = Image.new("RGBA", (COLUMNS * T, rows * T), (0, 0, 0, 0))
    for i, tile in enumerate(tiles):
        atlas.alpha_composite(tile, ((i % COLUMNS) * T, (i // COLUMNS) * T))
    atlas = atlas.resize((atlas.width * SCALE, atlas.height * SCALE), Image.NEAREST)
    os.makedirs(OUT, exist_ok=True)
    atlas.save(os.path.join(OUT, "tiles.png"), optimize=True)
    # anim 을 타일 인덱스 쌍으로도 풀어둔다 (클라이언트 편의). cycle 오브젝트는 cycleTiles (일정 속도 순환), 나머지는 animTiles (창문 깜빡임)
    anim_tiles = {}
    cycle_tiles = {}
    for name, m in meta.items():
        if "anim" in m:
            other = meta[m["anim"]]
            target = cycle_tiles if OBJECTS[name]["cycle"] else anim_tiles
            for ty in range(m["h"]):
                for tx in range(m["w"]):
                    target[str(m["tiles"][ty][tx])] = other["tiles"][ty][tx]
    data = dict(tileSize=T * SCALE, columns=COLUMNS, count=len(tiles), image="tiles.png", objects=meta, animTiles=anim_tiles, cycleTiles=cycle_tiles)
    with open(os.path.join(OUT, "tiles.json"), "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, separators=(",", ":"))
    print(f"atlas: {len(tiles)} tiles, {atlas.size}, {len(meta)} objects")
    return meta


def build_preview():
    os.makedirs(PREVIEW_DIR, exist_ok=True)
    items = list(OBJECTS.items())
    cell_w, cell_h = 9 * T * SCALE + 8, 3 * T * SCALE + 22
    cols = 8
    rows = (len(items) + cols - 1) // cols
    im = Image.new("RGBA", (cols * cell_w, rows * cell_h), (60, 58, 66, 255))
    d = ImageDraw.Draw(im)
    for i, (name, o) in enumerate(items):
        x, y = (i % cols) * cell_w, (i // cols) * cell_h
        img = o["img"].resize((o["img"].width * SCALE, o["img"].height * SCALE), Image.NEAREST)
        # 바닥 위에 올려서 보이게
        floor = OBJECTS["floor_0"]["img"].resize((T * SCALE, T * SCALE), Image.NEAREST)
        for fy in range(0, img.height, T * SCALE):
            for fx in range(0, img.width, T * SCALE):
                im.alpha_composite(floor, (x + 4 + fx, y + 4 + fy))
        im.alpha_composite(img, (x + 4, y + 4))
        d.text((x + 4, y + cell_h - 16), name, fill=(255, 240, 200, 255))
    im.save(os.path.join(PREVIEW_DIR, "preview.png"))


# ── 캐릭터 ────────────────────────────────────────────────────────────
CHAR_MAP = {
    # 머리: 갈색 → 진한 흑발
    (0x43, 0x2e, 0x27): (0x2b, 0x25, 0x30),
    (0x6a, 0x48, 0x34): (0x3d, 0x35, 0x40),
    # 셔츠: 빨강 → 흰색 (목업의 흰 셔츠)
    (0xc4, 0x3c, 0x3c): (0xf1, 0xee, 0xe8),
    (0x88, 0x2e, 0x2e): (0xc9, 0xc4, 0xbb),
    (0x68, 0x1c, 0x1c): (0xa9, 0xa3, 0x9a),
    # 바지: 청바지 톤 유지하되 살짝 밝게
    (0x65, 0x65, 0x9b): (0x6d, 0x7f, 0xa8),
}


def build_player():
    """Zelda-like character.png 의 걷기 4행(각 4프레임, 16x32) 추출 → 2배."""
    src = ZELDA_CHAR
    frames_w, frames_h = 16, 32
    order = ["down", "right", "up", "left"]  # 원본 행 순서 (프리뷰로 확인)
    sheet = Image.new("RGBA", (4 * frames_w, 4 * frames_h), (0, 0, 0, 0))
    px = src.load()
    for row in range(4):
        for col in range(4):
            fr = src.crop((col * frames_w, row * frames_h, col * frames_w + frames_w, row * frames_h + frames_h))
            sheet.alpha_composite(fr, (col * frames_w, row * frames_h))
    # 리컬러
    out = Image.new("RGBA", sheet.size)
    sp, op = sheet.load(), out.load()
    for y in range(sheet.height):
        for x in range(sheet.width):
            r, g, b, a = sp[x, y]
            op[x, y] = CHAR_MAP.get((r, g, b), (r, g, b)) + (a,)
    out = out.resize((out.width * SCALE, out.height * SCALE), Image.NEAREST)
    out.save(os.path.join(OUT, "player.png"), optimize=True)
    with open(os.path.join(OUT, "player.json"), "w", encoding="utf-8") as f:
        json.dump(dict(frameWidth=frames_w * SCALE, frameHeight=frames_h * SCALE, framesPerRow=4, rows={d: i for i, d in enumerate(order)}), f)
    print("player:", out.size)


def main():
    build_objects()
    build_atlas()
    build_preview()
    build_player()


if __name__ == "__main__":
    main()
