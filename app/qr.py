"""A tiny QR-code generator (no third-party packages, no network).

Used to draw the UPI payment QR on your own server, so the UPI ID and amount are never sent to an
outside QR service. Byte mode, error-correction level M, versions 1-10 (up to 213 characters).
"""
from __future__ import annotations

from typing import List

# ECC level M: (data codewords of each block, error-correction codewords per block)
_BLOCKS = {
    1: ([16], 10), 2: ([28], 16), 3: ([44], 26), 4: ([32] * 2, 18), 5: ([43] * 2, 24),
    6: ([27] * 4, 16), 7: ([31] * 4, 18), 8: ([38] * 2 + [39] * 2, 22),
    9: ([36] * 3 + [37] * 2, 22), 10: ([43] * 4 + [44], 26),
}
_ALIGN = {1: [], 2: [6, 18], 3: [6, 22], 4: [6, 26], 5: [6, 30], 6: [6, 34],
          7: [6, 22, 38], 8: [6, 24, 42], 9: [6, 26, 46], 10: [6, 28, 50]}
MAX_VERSION = 10

# --- Reed-Solomon over GF(256) -------------------------------------------------
_EXP = [0] * 512
_LOG = [0] * 256
_x = 1
for _i in range(255):
    _EXP[_i] = _x
    _LOG[_x] = _i
    _x <<= 1
    if _x & 0x100:
        _x ^= 0x11D
for _i in range(255, 512):
    _EXP[_i] = _EXP[_i - 255]


def _gmul(a: int, b: int) -> int:
    return 0 if a == 0 or b == 0 else _EXP[_LOG[a] + _LOG[b]]


def _generator(degree: int) -> List[int]:
    g = [1]
    for i in range(degree):
        nxt = [0] * (len(g) + 1)
        for j, c in enumerate(g):
            nxt[j] ^= c
            nxt[j + 1] ^= _gmul(c, _EXP[i])
        g = nxt
    return g


def _remainder(data: List[int], degree: int) -> List[int]:
    gen = _generator(degree)
    rem = [0] * degree
    for byte in data:
        factor = byte ^ rem[0]
        rem = rem[1:] + [0]
        if factor:
            for i in range(degree):
                rem[i] ^= _gmul(gen[i + 1], factor)
    return rem


# --- encoding -------------------------------------------------------------------
def _pick_version(length: int) -> int:
    for version in range(1, MAX_VERSION + 1):
        capacity = sum(_BLOCKS[version][0]) * 8
        count_bits = 8 if version < 10 else 16
        if 4 + count_bits + 8 * length <= capacity:
            return version
    raise ValueError(f"Text is too long for a payment QR code ({length} bytes).")


def _codewords(data: bytes, version: int) -> List[int]:
    blocks, ec_len = _BLOCKS[version]
    capacity = sum(blocks)
    bits: List[int] = []

    def put(value: int, width: int) -> None:
        bits.extend((value >> (width - 1 - i)) & 1 for i in range(width))

    put(0b0100, 4)
    put(len(data), 8 if version < 10 else 16)
    for byte in data:
        put(byte, 8)
    put(0, min(4, capacity * 8 - len(bits)))
    while len(bits) % 8:
        bits.append(0)
    words = [int("".join(map(str, bits[i:i + 8])), 2) for i in range(0, len(bits), 8)]
    pad = (0xEC, 0x11)
    while len(words) < capacity:
        words.append(pad[(len(words) - len(bits) // 8) % 2])

    split, pos = [], 0
    for size in blocks:
        split.append(words[pos:pos + size])
        pos += size
    ecs = [_remainder(block, ec_len) for block in split]
    out: List[int] = []
    for i in range(max(len(b) for b in split)):
        out.extend(block[i] for block in split if i < len(block))
    for i in range(ec_len):
        out.extend(ec[i] for ec in ecs)
    return out


# --- matrix ---------------------------------------------------------------------
class _Grid:
    def __init__(self, version: int):
        self.size = 17 + 4 * version
        self.mod = [[False] * self.size for _ in range(self.size)]
        self.fixed = [[False] * self.size for _ in range(self.size)]

    def setf(self, row: int, col: int, dark: bool) -> None:
        self.mod[row][col] = dark
        self.fixed[row][col] = True


def _draw_function_patterns(g: _Grid, version: int) -> None:
    n = g.size
    for r0, c0 in ((0, 0), (0, n - 7), (n - 7, 0)):
        for dr in range(-1, 8):
            for dc in range(-1, 8):
                r, c = r0 + dr, c0 + dc
                if 0 <= r < n and 0 <= c < n:
                    inside = 0 <= dr <= 6 and 0 <= dc <= 6
                    dark = inside and (dr in (0, 6) or dc in (0, 6) or (2 <= dr <= 4 and 2 <= dc <= 4))
                    g.setf(r, c, dark)
    for i in range(8, n - 8):
        g.setf(6, i, i % 2 == 0)
        g.setf(i, 6, i % 2 == 0)
    pos = _ALIGN[version]
    for r in pos:
        for c in pos:
            if (r == 6 and c == 6) or (r == 6 and c == pos[-1]) or (r == pos[-1] and c == 6):
                continue
            for dr in range(-2, 3):
                for dc in range(-2, 3):
                    g.setf(r + dr, c + dc, max(abs(dr), abs(dc)) != 1)
    _draw_format(g, 0)  # reserve the area; real bits are written per mask
    if version >= 7:
        rem = version
        for _ in range(12):
            rem = (rem << 1) ^ ((rem >> 11) * 0x1F25)
        bits = (version << 12) | rem
        for i in range(18):
            bit = bool((bits >> i) & 1)
            a, b = n - 11 + i % 3, i // 3
            g.setf(b, a, bit)
            g.setf(a, b, bit)


def _draw_format(g: _Grid, mask: int) -> None:
    n = g.size
    data = mask  # error-correction level M has indicator bits 00
    rem = data
    for _ in range(10):
        rem = (rem << 1) ^ ((rem >> 9) * 0x537)
    bits = ((data << 10) | rem) ^ 0x5412

    def bit(i: int) -> bool:
        return bool((bits >> i) & 1)

    for i in range(6):
        g.setf(i, 8, bit(i))
    g.setf(7, 8, bit(6))
    g.setf(8, 8, bit(7))
    g.setf(8, 7, bit(8))
    for i in range(9, 15):
        g.setf(8, 14 - i, bit(i))
    for i in range(8):
        g.setf(8, n - 1 - i, bit(i))
    for i in range(8, 15):
        g.setf(n - 15 + i, 8, bit(i))
    g.setf(n - 8, 8, True)


def _place_data(g: _Grid, words: List[int]) -> None:
    n, i = g.size, 0
    total = len(words) * 8
    for right in range(n - 1, 0, -2):
        if right <= 6:
            right -= 1
        for vert in range(n):
            for j in range(2):
                col = right - j
                upward = ((right + 1) & 2) == 0
                row = (n - 1 - vert) if upward else vert
                if not g.fixed[row][col] and i < total:
                    g.mod[row][col] = bool((words[i >> 3] >> (7 - (i & 7))) & 1)
                    i += 1


_MASKS = (
    lambda x, y: (x + y) % 2 == 0,
    lambda x, y: y % 2 == 0,
    lambda x, y: x % 3 == 0,
    lambda x, y: (x + y) % 3 == 0,
    lambda x, y: (x // 3 + y // 2) % 2 == 0,
    lambda x, y: x * y % 2 + x * y % 3 == 0,
    lambda x, y: (x * y % 2 + x * y % 3) % 2 == 0,
    lambda x, y: ((x + y) % 2 + x * y % 3) % 2 == 0,
)


def _penalty(mod: List[List[bool]]) -> int:
    n = len(mod)
    score = 0
    lines = [row for row in mod] + [[mod[r][c] for r in range(n)] for c in range(n)]
    finder_a, finder_b = "10111010000", "00001011101"
    for line in lines:
        run = 1
        for k in range(1, n):
            if line[k] == line[k - 1]:
                run += 1
            else:
                if run >= 5:
                    score += 3 + run - 5
                run = 1
        if run >= 5:
            score += 3 + run - 5
        text = "".join("1" if v else "0" for v in line)
        for pattern in (finder_a, finder_b):
            start = text.find(pattern)
            while start != -1:
                score += 40
                start = text.find(pattern, start + 1)
    for r in range(n - 1):
        for c in range(n - 1):
            if mod[r][c] == mod[r][c + 1] == mod[r + 1][c] == mod[r + 1][c + 1]:
                score += 3
    dark = sum(v for row in mod for v in row)
    total = n * n
    score += ((abs(dark * 20 - total * 10) + total - 1) // total - 1) * 10
    return score


def make_matrix(text: str, mask: int = -1) -> List[List[bool]]:
    """Return the QR modules (True = dark) for `text`, without the quiet zone.

    `mask` (0-7) forces one mask pattern; by default the best-scoring one is chosen."""
    data = text.encode("utf-8")
    version = _pick_version(len(data))
    words = _codewords(data, version)
    best, best_score = None, None
    for mask in (range(8) if mask < 0 else [mask]):
        g = _Grid(version)
        _draw_function_patterns(g, version)
        _place_data(g, words)
        fn = _MASKS[mask]
        for r in range(g.size):
            for c in range(g.size):
                if not g.fixed[r][c] and fn(c, r):
                    g.mod[r][c] = not g.mod[r][c]
        _draw_format(g, mask)
        score = _penalty(g.mod)
        if best_score is None or score < best_score:
            best, best_score = g.mod, score
    return best


def make_svg(text: str, border: int = 4, dark: str = "#000000", light: str = "#ffffff") -> str:
    """The QR code as a standalone SVG document (white background, quiet zone included)."""
    modules = make_matrix(text)
    n = len(modules)
    size = n + 2 * border
    cells = "".join(f"M{c + border},{r + border}h1v1h-1z"
                    for r in range(n) for c in range(n) if modules[r][c])
    return (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {size} {size}" '
            f'shape-rendering="crispEdges"><rect width="{size}" height="{size}" fill="{light}"/>'
            f'<path d="{cells}" fill="{dark}"/></svg>')
