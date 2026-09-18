"""14단계 새 타일·오브젝트 미리보기 (검수용): tools/out/s14_tiles_preview.png
실행: python tools/preview_stage14.py
"""
import os
import sys

from PIL import Image, ImageDraw

sys.path.insert(0, os.path.dirname(__file__))
import build_assets as B  # noqa: E402

B.build_objects()
names = list(B.OBJECTS.keys())
start = names.index("telescope") + 1
items = [(n, B.OBJECTS[n]) for n in names[start:]]
T, S = B.T, B.SCALE
cell_w, cell_h = 5 * T * S + 8, 4 * T * S + 20
cols = 10
rows = (len(items) + cols - 1) // cols
im = Image.new("RGBA", (cols * cell_w, rows * cell_h), (60, 58, 66, 255))
d = ImageDraw.Draw(im)
grass = B.OBJECTS["grass2_0_0"]["img"].resize((T * S, T * S), Image.NEAREST)
for i, (name, o) in enumerate(items):
    x, y = (i % cols) * cell_w, (i // cols) * cell_h
    img = o["img"].resize((o["img"].width * S, o["img"].height * S), Image.NEAREST)
    for fy in range(0, min(img.height, 4 * T * S), T * S):
        for fx in range(0, min(img.width, 5 * T * S), T * S):
            im.alpha_composite(grass, (x + 4 + fx, y + 16 + fy))
    im.alpha_composite(img.crop((0, 0, min(img.width, 5 * T * S), min(img.height, 4 * T * S))), (x + 4, y + 16))
    d.text((x + 4, y + 2), name, fill=(255, 240, 200, 255))
    d.rectangle((x, y, x + cell_w - 1, y + cell_h - 1), outline=(90, 88, 100, 255))
out = os.path.join(B.PREVIEW_DIR, "s14_tiles_preview.png")
im.save(out)
print(out, len(items))
