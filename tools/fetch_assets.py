"""외부 에셋 원본 다운로드 (tools/raw/ 는 git 에 올리지 않음).

    python tools/fetch_assets.py
    python tools/build_assets.py

라이선스는 모두 CC0 (public/assets/CREDITS.txt 참고).
"""
import io
import os
import sys
import urllib.request
import zipfile

RAW = os.path.join(os.path.dirname(os.path.abspath(__file__)), "raw")

SOURCES = [
    {
        "name": "kenney_roguelike_indoors",
        "url": "https://kenney.nl/media/pages/assets/roguelike-indoors/4d5b520b03-1702169567/kenney_roguelike-indoors.zip",
        "page": "https://kenney.nl/assets/roguelike-indoors",
        "check": "Tilesheets/roguelikeIndoor_transparent.png",
    },
    {
        "name": "oga_zelda",
        "url": "https://opengameart.org/sites/default/files/gfx_3.zip",
        "page": "https://opengameart.org/content/zelda-like-tilesets-and-sprites",
        "check": "gfx/character.png",
    },
]


def fetch(src):
    dest = os.path.join(RAW, src["name"])
    if os.path.exists(os.path.join(dest, src["check"])):
        print("skip (exists):", src["name"])
        return
    print("download:", src["url"])
    req = urllib.request.Request(src["url"], headers={"User-Agent": "Mozilla/5.0 (null-study-meta asset fetch)"})
    with urllib.request.urlopen(req, timeout=120) as r:
        data = r.read()
    os.makedirs(dest, exist_ok=True)
    with zipfile.ZipFile(io.BytesIO(data)) as z:
        z.extractall(dest)
    if not os.path.exists(os.path.join(dest, src["check"])):
        print("!! 예상 파일이 없습니다. 페이지에서 직접 받아 주세요:", src["page"])
        sys.exit(1)
    print("ok:", dest)


if __name__ == "__main__":
    for s in SOURCES:
        fetch(s)
