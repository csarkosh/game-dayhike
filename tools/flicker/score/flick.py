"""Flicker metric over a captured turn. For each frame triple (a, b, c), a and c are aligned to b by
the integer horizontal shift that minimises their difference (the camera's yaw), then a pixel
'blinks' when b differs from BOTH a and c by more than T in the same direction: a one-frame spike,
which motion (monotonic over three frames) does not make. Reported as % of pixels, whole frame and
per band, plus a blink-count heatmap and a crop sheet.

python3 -I flick.py <run dir> <variant>... [--T 24] [--crop x,y,w,h] [--sheet]
"""
import sys, glob, os, json
import numpy as np
from PIL import Image

args = [a for a in sys.argv[1:] if not a.startswith("--")]
opts = {a.split("=")[0][2:]: (a.split("=")[1] if "=" in a else True) for a in sys.argv[1:] if a.startswith("--")}
run = args[0]; variants = args[1:]
T = float(opts.get("T", 24)); MAXS = 16
crop = tuple(int(v) for v in opts["crop"].split(",")) if "crop" in opts else None

def load(d):
    fs = sorted(glob.glob(os.path.join(d, "f*.jpg")) + glob.glob(os.path.join(d, "f*.png")))
    out = []
    prev = None
    for f in fs:
        im = Image.open(f).convert("L")
        im = im.resize((im.width // 2, im.height // 2), Image.BOX)
        g = np.asarray(im, dtype=np.float32)
        if prev is not None and np.abs(g - prev).mean() < 0.15:
            continue  # a repeated compositor frame
        out.append(g); prev = g
    return out

def shift(img, dx):
    return np.roll(img, dx, axis=1)

def best_shift(a, b):
    h, w = a.shape
    ys, xs = slice(h // 8, h * 7 // 8), slice(w // 6, w * 5 // 6)
    best, bd = 0, 1e18
    for dx in range(-MAXS, MAXS + 1):
        d = np.abs(shift(a, dx)[ys, xs] - b[ys, xs]).mean()
        if d < bd: bd, best = d, dx
    return best, bd

def analyse(frames):
    h, w = frames[0].shape
    blink = np.zeros((h, w), dtype=np.float32)
    rows = []
    n = 0
    for i in range(1, len(frames) - 1):
        a, b, c = frames[i - 1], frames[i], frames[i + 1]
        da, _ = best_shift(a, b); dc, _ = best_shift(c, b)
        aa, cc = shift(a, da), shift(c, dc)
        m = MAXS
        A, B, C = aa[:, m:-m], b[:, m:-m], cc[:, m:-m]
        up = (B - A > T) & (B - C > T)
        dn = (A - B > T) & (C - B > T)
        bl = (up | dn).astype(np.float32)
        blink[:, m:-m] += bl
        rows.append(bl); n += 1
    if n == 0: return None
    bl = np.stack(rows)  # n x h x w-2m
    H = bl.shape[1]
    res = {
        "frames": len(frames), "triples": n,
        "whole": float(100 * bl.mean()),
        "trees(top 60%)": float(100 * bl[:, : int(H * 0.6)].mean()),
        "ground(bottom 40%)": float(100 * bl[:, int(H * 0.6):].mean()),
    }
    if crop:
        x, y, cw, ch = (v // 2 for v in crop)
        res["crop"] = 100 * bl[:, y:y + ch, max(0, x - MAXS):x - MAXS + cw].mean()
    return res, blink / n

summary = {}
for v in variants:
    frames = load(os.path.join(run, v))
    if len(frames) < 3:
        print(v, "too few frames", len(frames)); continue
    r = analyse(frames)
    if r is None: continue
    res, heat = r
    summary[v] = res
    print(f"{v:12s} frames={res['frames']:4d}  blink% whole={res['whole']:.3f}  trees={res['trees(top 60%)']:.3f}  ground={res['ground(bottom 40%)']:.3f}" + (f"  crop={res['crop']:.3f}" if 'crop' in res else ""))
    hm = np.clip(heat / max(heat.max(), 1e-6) * 255, 0, 255).astype(np.uint8)
    Image.fromarray(hm).save(os.path.join(run, f"heat_{v}.png"))
    if opts.get("sheet") and crop:
        x, y, cw, ch = crop
        tiles = []
        for f in sorted(glob.glob(os.path.join(run, v, "f*.jpg")))[20:32]:
            tiles.append(Image.open(f).crop((x, y, x + cw, y + ch)))
        sheet = Image.new("RGB", (cw * 4, ch * 3))
        for i, t in enumerate(tiles[:12]): sheet.paste(t, ((i % 4) * cw, (i // 4) * ch))
        sheet.save(os.path.join(run, f"sheet_{v}.png"))
json.dump(summary, open(os.path.join(run, "summary.json"), "w"), indent=1)
