"""Still-camera flicker metric: how much each pixel moves about its own short-term mean.

python3 -I still.py <dir> [<dir> ...]   (each dir holds f0000.jpg ... or g_0001.png ...)

Repeated capture frames (the game under the compositor's rate) are dropped. Each pixel's
luminance is detrended by a 9-frame moving average (slow drifts: fog, the day) and the
residual's std is reported: the mean over the viewport, the mean over the 2 % most active
pixels, and the share of pixels whose residual std exceeds 1.5 levels. A map of the residual
std is written beside the frames as still-map.png.
"""
import sys, glob, os
import numpy as np
from PIL import Image

def load(d):
    fs = sorted(glob.glob(os.path.join(d, "f*.jpg"))) or sorted(glob.glob(os.path.join(d, "g_*.png")))
    A = []
    for f in fs:
        im = Image.open(f).convert("L")
        w, h = im.size
        im = im.resize((w // 2, h // 2))  # half res: the metric is about areas, not edges
        A.append(np.asarray(im, dtype=np.float32))
    A = np.stack(A)
    keep = [0] + [i for i in range(1, len(A)) if np.abs(A[i] - A[i - 1]).mean() > 0.02]
    return A[keep], len(A)

def main():
    for d in sys.argv[1:]:
        B, n = load(d)
        T, H, W = B.shape
        # viewport: drop the top 8 % (browser chrome / HUD) and bottom 6 %
        B = B[:, int(H * 0.08):int(H * 0.94), :]
        k = 9
        pad = np.pad(B, ((k // 2, k // 2), (0, 0), (0, 0)), mode="edge")
        cs = np.cumsum(pad, axis=0)
        ma = (cs[k:] - cs[:-k]) / k
        ma = np.concatenate([pad[:1] * 0 + B[:1], ma], axis=0)[:T] if ma.shape[0] < T else ma[:T]
        R = B - ma
        s = R.std(axis=0)
        top = np.percentile(s, 98)
        print(f"{d}: frames {T}/{n} residual-std mean {s.mean():.3f} top2% {s[s >= top].mean():.3f} share>1.5 {(s > 1.5).mean() * 100:.2f}%  share>3 {(s > 3).mean() * 100:.2f}%")
        m = np.clip(s / 4 * 255, 0, 255).astype(np.uint8)
        Image.fromarray(m).save(os.path.join(d, "still-map.png"))

main()
