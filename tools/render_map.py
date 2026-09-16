"""서버의 방 데이터를 아틀라스로 합성해 PNG 로 렌더 (배치 검수용, 조명 없음). --day 로 낮 창문 레이어, --collision 로 충돌 오버레이.
사용: node -e "console.log(JSON.stringify(require('./server/rooms/studyroom').getStudyRoom()))" > tools/out/room.json
      python tools/render_map.py tools/out/room.json tools/out/map_render.png
"""
import json
import sys

from PIL import Image

room = json.load(open(sys.argv[1], encoding="utf-8"))
atlas = Image.open("public/assets/tiles.png").convert("RGBA")
meta = json.load(open("public/assets/tiles.json", encoding="utf-8"))
TS, COLS = meta["tileSize"], meta["columns"]
W, H = room["width"] * TS, room["height"] * TS
out = Image.new("RGBA", (W, H), (20, 18, 24, 255))


def tile(idx):
    x, y = (idx % COLS) * TS, (idx // COLS) * TS
    return atlas.crop((x, y, x + TS, y + TS))


# 창밖 하늘 (타일에는 없음 — 클라이언트 daylight.js 와 같은 밤 그라데이션)
SKY_NIGHT = ["#141a30", "#171e38", "#1b2442", "#202b4d", "#263457", "#2d3e63", "#35496f", "#3f557c", "#4a6189", "#566d94"]
for win in room.get("windows", []):
    for y in range(win["h"]):
        col = SKY_NIGHT[min(len(SKY_NIGHT) - 1, y * len(SKY_NIGHT) // win["h"])]
        rgb = tuple(int(col[i:i + 2], 16) for i in (1, 3, 5))
        out.paste(rgb + (255,), (win["x"], win["y"] + y, win["x"] + win["w"], win["y"] + y + 1))

layers = ("floor", "furniture", "top") if "--day" not in sys.argv else ("floor", "furniture", "windowDay", "top")
for layer in layers:
    for ty, row in enumerate(room["layers"][layer]):
        for tx, idx in enumerate(row):
            if idx >= 0:
                out.alpha_composite(tile(idx), (tx * TS, ty * TS))
if "--collision" in sys.argv:
    ov = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    for ty, row in enumerate(room["collision"]):
        for tx, c in enumerate(row):
            if c:
                ov.paste((255, 0, 0, 70), (tx * TS, ty * TS, tx * TS + TS, ty * TS + TS))
    for s in room["seats"]:
        ov.paste((0, 200, 255, 110), (s["x"] * TS, s["y"] * TS, s["x"] * TS + TS, s["y"] * TS + TS))
    for d in room["doors"]:
        ov.paste((0, 255, 0, 110), (d["x"] * TS, d["y"] * TS, d["x"] * TS + TS, d["y"] * TS + TS))
    out.alpha_composite(ov)
out.save(sys.argv[2])
print("saved", sys.argv[2], out.size)
