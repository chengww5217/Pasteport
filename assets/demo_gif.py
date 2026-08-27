#!/usr/bin/env python3
"""Regenerates assets/demo.gif, the animation at the top of the READMEs.

Two scenes, synthetic but faithful:
  A. dragging out a screenshot selection on a mock desktop (macOS-style:
     crosshair, marching-ants rect, shutter flash, corner thumbnail)
  B. a VS Code remote terminal where pressing Cmd+V runs the upload (the
     ProgressLocation.Window message format from src/remote/transfer.ts) and
     the remote path lands at the prompt.

Text is drawn large relative to the canvas because the Extensions view and the
Marketplace render README media in a narrow pane.

Not part of the build — run it by hand when the demo changes:

    pip install pillow
    python3 assets/demo_gif.py

The fonts are Menlo, so this runs on macOS; swap the path for any monospace
font elsewhere.
"""

from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

OUT = Path(__file__).with_name("demo.gif")

W, H = 640, 300
TAB_H = 30          # panel tab strip ("TERMINAL")
STATUS_H = 22       # VS Code status bar
TERM_TOP = TAB_H
TERM_BOTTOM = H - STATUS_H

BG = "#1e1e1e"
TAB_BG = "#252526"
TAB_FG = "#969696"
STATUS_BG = "#007acc"
STATUS_FG = "#ffffff"
PROMPT_GREEN = "#23d18b"
TEXT = "#d4d4d4"

WALL_TOP = (143, 176, 221)
WALL_BOTTOM = (109, 143, 196)

MENLO = "/System/Library/Fonts/Menlo.ttc"
font_term = ImageFont.truetype(MENLO, 16, index=0)
font_status = ImageFont.truetype(MENLO, 12, index=0)
font_tab = ImageFont.truetype(MENLO, 11, index=0)
font_key = ImageFont.truetype(MENLO, 24, index=0)
font_win = ImageFont.truetype(MENLO, 11, index=0)

PATH = "/tmp/pasteport/9f2c1a4b7e0d3856/clipboard.png "
REMOTE = ">< SSH: devbox"
SPINNER = "|/-\\"

PAD = 12
LINE_Y = TERM_TOP + 16
CHAR_W = font_term.getlength("x")

# --- timeline (ms) -------------------------------------------------------------
T_DRAG_START = 400
T_DRAG_END = 1300
T_FLASH_END = 1450
T_THUMB_END = 2450
T_TERM_AT = 2650                     # cut to the terminal
T_PRESS_AT = T_TERM_AT + 500         # Cmd+V badge appears
T_UPLOAD_START = T_PRESS_AT + 250
T_UPLOAD_END = T_UPLOAD_START + 1200
T_BADGE_GONE = T_PRESS_AT + 800
T_PATH_END = T_UPLOAD_END + (len(PATH) // 4 + 1) * 30
T_END = T_PATH_END + 2500

# selection geometry on the desktop scene
SEL_A = (96, 24)     # drag anchor
SEL_B = (544, 252)   # drag target
WIN = (110, 42, 530, 238)  # the window being screenshotted


KEY = 46  # keycap edge, px


def elapsed_fmt(ms: int) -> str:
    s = ms / 1000
    return "<1s" if s < 1 else f"{round(s)}s"


def draw_key_hint(d: ImageDraw.ImageDraw, mod: str, key: str, cx: int, cy: int) -> None:
    """A centred ⌘+V hint, drawn as physical keycaps so it reads as a keypress."""

    def keycap(right: int, label: str) -> int:
        box = [right, cy - KEY // 2, right + KEY, cy + KEY // 2]
        d.rounded_rectangle(box, radius=8, fill="#f2f2f2", outline="#b8b8b8", width=1)
        # the darker bottom edge is what makes it read as a key, not a dialog
        d.line([(box[0] + 8, box[3] - 2), (box[2] - 8, box[3] - 2)], fill="#a9a9a9", width=3)
        d.text((right + KEY / 2, cy - 1), label, font=font_key, fill="#2b2b2b", anchor="mm")
        return box[2]

    plus_w = font_key.getlength("+") + 20
    left = cx - (KEY * 2 + plus_w) // 2
    right = keycap(left, mod)
    d.text((right + plus_w / 2, cy - 1), "+", font=font_key, fill="#9d9d9d", anchor="mm")
    keycap(round(right + plus_w), key)


def wallpaper() -> Image.Image:
    img = Image.new("RGB", (W, H))
    d = ImageDraw.Draw(img)
    for y in range(H):
        f = y / H
        d.line(
            [(0, y), (W, y)],
            fill=tuple(round(a + (b - a) * f) for a, b in zip(WALL_TOP, WALL_BOTTOM)),
        )
    return img


def draw_window(d: ImageDraw.ImageDraw) -> None:
    x0, y0, x1, y1 = WIN
    # shadow, then body
    d.rounded_rectangle([x0 + 4, y0 + 6, x1 + 4, y1 + 6], radius=8, fill=(0, 0, 0, 60))
    d.rounded_rectangle([x0, y0, x1, y1], radius=8, fill="#ffffff")
    # title bar with traffic lights and a title
    d.rounded_rectangle([x0, y0, x1, y0 + 24], radius=8, fill="#f0f0f0")
    d.rectangle([x0, y0 + 12, x1, y0 + 24], fill="#f0f0f0")
    for i, c in enumerate(("#ff5f57", "#febc2e", "#28c840")):
        cx = x0 + 16 + i * 16
        d.ellipse([cx - 5, y0 + 7, cx + 5, y0 + 17], fill=c)
    title = "Build Report"
    tw = font_win.getlength(title)
    d.text(((x0 + x1 - tw) / 2, y0 + 6), title, font=font_win, fill="#666666")
    # body: an error banner and some content lines
    bx, by = x0 + 20, y0 + 40
    d.rounded_rectangle([bx, by, x1 - 20, by + 30], radius=5, fill="#fde8e8", outline="#f0b8b8")
    d.text((bx + 10, by + 8), "ERROR: render failed", font=font_win, fill="#c62828")
    for i, wpx in enumerate((330, 285, 355)):
        ly = by + 48 + i * 20
        d.rounded_rectangle([bx, ly, bx + wpx, ly + 8], radius=4, fill="#dcdcdc")
    # a tiny bar chart with one offending bar
    base = y1 - 24
    for i, hpx in enumerate((34, 52, 26, 44)):
        cx = bx + 8 + i * 30
        color = "#d05a5a" if i == 2 else "#7aa7e8"
        d.rectangle([cx, base - hpx, cx + 18, base], fill=color)


def dashed_rect(d: ImageDraw.ImageDraw, box, color) -> None:
    x0, y0, x1, y1 = box
    dash, gap = 6, 4
    x = x0
    while x < x1:  # top and bottom edges
        d.line([(x, y0), (min(x + dash, x1), y0)], fill=color)
        d.line([(x, y1), (min(x + dash, x1), y1)], fill=color)
        x += dash + gap
    y = y0
    while y < y1:  # left and right edges
        d.line([(x0, y), (x0, min(y + dash, y1))], fill=color)
        d.line([(x1, y), (x1, min(y + dash, y1))], fill=color)
        y += dash + gap


def render_desktop(t: int) -> Image.Image:
    img = wallpaper()
    draw_window(ImageDraw.Draw(img))

    if T_DRAG_START <= t < T_DRAG_END:
        f = (t - T_DRAG_START) / (T_DRAG_END - T_DRAG_START)
        cx = SEL_A[0] + (SEL_B[0] - SEL_A[0]) * f
        cy = SEL_A[1] + (SEL_B[1] - SEL_A[1]) * f
        box = (SEL_A[0], SEL_A[1], round(cx), round(cy))

        dim = Image.new("RGBA", (W, H), (0, 0, 0, 0))
        dd = ImageDraw.Draw(dim)
        dd.rectangle([0, 0, W, box[1]], fill=(0, 0, 0, 70))
        dd.rectangle([0, box[3], W, H], fill=(0, 0, 0, 70))
        dd.rectangle([0, box[1], box[0], box[3]], fill=(0, 0, 0, 70))
        dd.rectangle([box[2], box[1], W, box[3]], fill=(0, 0, 0, 70))
        img = Image.alpha_composite(img.convert("RGBA"), dim).convert("RGB")
        d = ImageDraw.Draw(img)

        dashed_rect(d, box, "#ffffff")
        d.line([(cx - 14, cy), (cx + 14, cy)], fill="#ffffff")
        d.line([(cx, cy - 14), (cx, cy + 14)], fill="#ffffff")
    elif T_DRAG_END <= t < T_FLASH_END:
        flash = Image.new("RGBA", (W, H), (255, 255, 255, 160))
        img = Image.alpha_composite(img.convert("RGBA"), flash).convert("RGB")
    elif t < T_THUMB_END:
        # the macOS corner thumbnail of what just landed on the clipboard
        shot = img.crop((*SEL_A, *SEL_B))
        tw = 132
        th = round(shot.height * tw / shot.width)
        thumb = shot.resize((tw, th), Image.LANCZOS)
        tx, ty = W - tw - 16, H - th - 16
        d = ImageDraw.Draw(img)
        d.rectangle([tx - 2, ty - 1, tx + tw + 4, ty + th + 5], fill=(0, 0, 0))
        img.paste(thumb, (tx, ty))
        d.rectangle([tx - 1, ty - 1, tx + tw, ty + th], outline="#ffffff", width=2)

    return img


def render_terminal(t: int) -> Image.Image:
    img = Image.new("RGB", (W, H), BG)
    d = ImageDraw.Draw(img)

    d.rectangle([0, 0, W, TAB_H], fill=TAB_BG)
    d.text((PAD, 8), "TERMINAL", font=font_tab, fill=TAB_FG)

    d.rectangle([0, TERM_BOTTOM, W, H], fill=STATUS_BG)
    d.text((PAD, TERM_BOTTOM + 5), REMOTE, font=font_status, fill=STATUS_FG)

    x = PAD
    d.text((x, LINE_Y), "$", font=font_term, fill=PROMPT_GREEN)
    x += CHAR_W * 2

    typed = ""
    if t > T_UPLOAD_END:
        n = min(len(PATH), (t - T_UPLOAD_END) // 30 * 4 + 4)
        typed = PATH[:n]
    d.text((x, LINE_Y), typed, font=font_term, fill=TEXT)
    cursor_x = x + font_term.getlength(typed)

    typing = T_UPLOAD_END < t < T_PATH_END
    if typing or (t // 530) % 2 == 0:
        d.rectangle([cursor_x, LINE_Y + 1, cursor_x + CHAR_W, LINE_Y + 20], fill=TEXT)

    if T_PRESS_AT <= t < T_BADGE_GONE:
        draw_key_hint(d, "⌘", "V", cx=W // 2, cy=(TERM_TOP + TERM_BOTTOM) // 2)

    if T_UPLOAD_START <= t <= T_UPLOAD_END:
        e = t - T_UPLOAD_START
        spin = SPINNER[(e // 120) % len(SPINNER)]
        msg = (
            f"{spin} Pasteport: clipboard.png (1.2 MB) — "
            f"{elapsed_fmt(e)} elapsed, ~{elapsed_fmt(max(0, 1200 - e))} left"
        )
        rx = PAD + font_status.getlength(REMOTE) + 18
        d.text((rx, TERM_BOTTOM + 5), msg, font=font_status, fill=STATUS_FG)

    return img


def render(t: int) -> Image.Image:
    if t < T_TERM_AT:
        return render_desktop(t)
    return render_terminal(t)


def main() -> None:
    frames: list[Image.Image] = []
    durations: list[int] = []
    last_bytes: bytes | None = None
    last_t = 0

    t = 0
    while t < T_END:
        img = render(t)
        data = img.tobytes()
        if data != last_bytes and frames:
            durations.append(min(t - last_t, 30000))
            frames.append(img)
            last_bytes = data
            last_t = t
        elif not frames:
            frames.append(img)
            last_bytes = data
            last_t = t
        t += 40
    durations.append(T_END - last_t)

    # Build the palette from frames across both scenes: an adaptive palette from
    # the first frame alone starves the terminal scene of dark grays.
    step = max(1, len(frames) // 8)
    samples = frames[::step]
    montage = Image.new("RGB", (W, H * len(samples)))
    for i, f in enumerate(samples):
        montage.paste(f, (0, H * i))
    palette = montage.convert("P", palette=Image.ADAPTIVE, colors=256)
    frames_p = [f.quantize(palette=palette, dither=Image.NONE) for f in frames]
    frames_p[0].save(
        OUT,
        save_all=True,
        append_images=frames_p[1:],
        duration=durations,
        loop=0,
        optimize=True,
        disposal=1,
    )
    print(f"{len(frames)} frames -> {OUT}")


if __name__ == "__main__":
    main()
