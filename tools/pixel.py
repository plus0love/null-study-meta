"""16px 논리 해상도용 픽셀 드로잉 도우미 + 3x5 픽셀 폰트."""
from PIL import Image


def hexc(c, a=255):
    """'#rrggbb' / '#rrggbbaa' / 튜플 → RGBA 튜플."""
    if isinstance(c, tuple):
        return c if len(c) == 4 else c + (a,)
    c = c.lstrip("#")
    if len(c) == 8:
        return tuple(int(c[i:i + 2], 16) for i in (0, 2, 4, 6))
    return tuple(int(c[i:i + 2], 16) for i in (0, 2, 4)) + (a,)


# 3x5 대문자/숫자/기호 폰트 (행 문자열, 1 이 켜진 픽셀)
FONT = {
    "A": ["010", "101", "111", "101", "101"],
    "B": ["110", "101", "110", "101", "110"],
    "C": ["011", "100", "100", "100", "011"],
    "D": ["110", "101", "101", "101", "110"],
    "E": ["111", "100", "110", "100", "111"],
    "F": ["111", "100", "110", "100", "100"],
    "G": ["011", "100", "101", "101", "011"],
    "H": ["101", "101", "111", "101", "101"],
    "I": ["111", "010", "010", "010", "111"],
    "J": ["001", "001", "001", "101", "010"],
    "K": ["101", "101", "110", "101", "101"],
    "L": ["100", "100", "100", "100", "111"],
    "M": ["101", "111", "111", "101", "101"],
    "N": ["110", "101", "101", "101", "101"],
    "O": ["010", "101", "101", "101", "010"],
    "P": ["110", "101", "110", "100", "100"],
    "Q": ["010", "101", "101", "111", "011"],
    "R": ["110", "101", "110", "101", "101"],
    "S": ["011", "100", "010", "001", "110"],
    "T": ["111", "010", "010", "010", "010"],
    "U": ["101", "101", "101", "101", "111"],
    "V": ["101", "101", "101", "101", "010"],
    "W": ["101", "101", "111", "111", "101"],
    "X": ["101", "101", "010", "101", "101"],
    "Y": ["101", "101", "010", "010", "010"],
    "Z": ["111", "001", "010", "100", "111"],
    "0": ["111", "101", "101", "101", "111"],
    "1": ["010", "110", "010", "010", "111"],
    "2": ["110", "001", "010", "100", "111"],
    "3": ["111", "001", "011", "001", "111"],
    "4": ["101", "101", "111", "001", "001"],
    "5": ["111", "100", "111", "001", "111"],
    "6": ["011", "100", "111", "101", "111"],
    "7": ["111", "001", "010", "010", "010"],
    "8": ["111", "101", "111", "101", "111"],
    "9": ["111", "101", "111", "001", "110"],
    " ": ["000", "000", "000", "000", "000"],
    "!": ["010", "010", "010", "000", "010"],
    "-": ["000", "000", "111", "000", "000"],
    ":": ["000", "010", "000", "010", "000"],
    ".": ["000", "000", "000", "000", "010"],
    ")": ["100", "010", "010", "010", "100"],
    "(": ["001", "010", "010", "010", "001"],
    "&": ["010", "101", "010", "101", "011"],
    "+": ["000", "010", "111", "010", "000"],
    "*": ["101", "111", "111", "010", "000"],  # 하트 대용
}


def text_width(s, scale=1, spacing=1):
    return len(s) * (3 * scale + spacing * scale) - spacing * scale


class Canvas:
    """RGBA 캔버스. 좌표는 논리 픽셀."""

    def __init__(self, w, h, bg=None):
        self.im = Image.new("RGBA", (w, h), hexc(bg) if bg else (0, 0, 0, 0))
        self.px_ = self.im.load()
        self.w, self.h = w, h

    def px(self, x, y, c):
        if 0 <= x < self.w and 0 <= y < self.h:
            c = hexc(c)
            if c[3] == 255:
                self.px_[x, y] = c
            elif c[3] > 0:  # 알파 블렌드
                r, g, b, a = self.px_[x, y]
                fa = c[3] / 255
                if a == 0:
                    self.px_[x, y] = c
                else:
                    self.px_[x, y] = (
                        int(r * (1 - fa) + c[0] * fa),
                        int(g * (1 - fa) + c[1] * fa),
                        int(b * (1 - fa) + c[2] * fa),
                        max(a, c[3]),
                    )

    def rect(self, x, y, w, h, c):
        for yy in range(y, y + h):
            for xx in range(x, x + w):
                self.px(xx, yy, c)

    def frame(self, x, y, w, h, c):
        self.hline(x, x + w - 1, y, c)
        self.hline(x, x + w - 1, y + h - 1, c)
        self.vline(x, y, y + h - 1, c)
        self.vline(x + w - 1, y, y + h - 1, c)

    def hline(self, x0, x1, y, c):
        for x in range(min(x0, x1), max(x0, x1) + 1):
            self.px(x, y, c)

    def vline(self, x, y0, y1, c):
        for y in range(min(y0, y1), max(y0, y1) + 1):
            self.px(x, y, c)

    def ellipse(self, x, y, w, h, c):
        """(x,y) 에서 w x h 박스에 내접하는 꽉 찬 타원."""
        cx, cy = x + (w - 1) / 2, y + (h - 1) / 2
        rx, ry = w / 2, h / 2
        for yy in range(y, y + h):
            for xx in range(x, x + w):
                if ((xx - cx) / rx) ** 2 + ((yy - cy) / ry) ** 2 <= 1.0:
                    self.px(xx, yy, c)

    def text(self, x, y, s, c, scale=1, spacing=1):
        cx = x
        for ch in s.upper():
            rows = FONT.get(ch, FONT[" "])
            for ry, row in enumerate(rows):
                for rx, bit in enumerate(row):
                    if bit == "1":
                        self.rect(cx + rx * scale, y + ry * scale, scale, scale, c)
            cx += 3 * scale + spacing * scale
        return cx

    def text_center(self, cx, y, s, c, scale=1, spacing=1):
        w = text_width(s, scale, spacing)
        return self.text(cx - w // 2, y, s, c, scale, spacing)

    def paste(self, img, x, y):
        self.im.alpha_composite(img.convert("RGBA"), (x, y))

    def blit(self, other, x, y):
        self.paste(other.im, x, y)

    def image(self):
        return self.im
