"""목업(design/studyroom.png)과 실제 렌더(screenshots/s3_full_night.png)를 나란히 붙여 한 장으로.
사용: python tools/compare_mockup.py [render.png] [out.png]
"""
import os
import sys

from PIL import Image, ImageDraw

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
render_path = sys.argv[1] if len(sys.argv) > 1 else os.path.join(ROOT, "screenshots", "s3_full_night.png")
out_path = sys.argv[2] if len(sys.argv) > 2 else os.path.join(ROOT, "screenshots", "compare_mockup.png")

mock = Image.open(os.path.join(ROOT, "design", "studyroom.png")).convert("RGB")
render = Image.open(render_path).convert("RGB")
H = 1088
mock = mock.resize((round(mock.width * H / mock.height), H), Image.LANCZOS)
render = render.resize((round(render.width * H / render.height), H), Image.NEAREST)
GAP, TOP = 24, 40
out = Image.new("RGB", (mock.width + render.width + GAP * 3, H + TOP + GAP), (20, 17, 26))
d = ImageDraw.Draw(out)
d.text((GAP, 14), "design/studyroom.png (mockup)", fill=(255, 224, 173))
d.text((mock.width + GAP * 2, 14), "in-game (3단계, 밤)", fill=(255, 224, 173))
out.paste(mock, (GAP, TOP))
out.paste(render, (mock.width + GAP * 2, TOP))
out.save(out_path)
print("saved", out_path, out.size)
