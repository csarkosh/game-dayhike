"""Full-resolution blink map: per-pixel residual std about a 9-frame moving average, no downscale.
python3 -I fullres.py <dir> ...  -> <dir>/full-map.png (std x 48), <dir>/full-overlay.png (frame with blinking pixels in red),
and the share of pixels over 6 levels in three horizontal bands (top/middle/bottom thirds of the viewport)."""
import sys, glob, os
import numpy as np
from PIL import Image
for d in sys.argv[1:]:
    fs = sorted(glob.glob(os.path.join(d, "f*.jpg")))
    A = np.stack([np.asarray(Image.open(f).convert("L"), dtype=np.float32) for f in fs])
    keep = [0] + [i for i in range(1, len(A)) if np.abs(A[i] - A[i-1]).mean() > 0.02]
    A = A[keep]; T, H, W = A.shape
    k = 9; pad = np.pad(A, ((k//2, k//2), (0, 0), (0, 0)), mode="edge"); cs = np.cumsum(np.concatenate([np.zeros((1, H, W), dtype=np.float32), pad]), axis=0)
    ma = (cs[k:] - cs[:-k]) / k
    R = A - ma[:T]; s = R.std(axis=0)
    v = s[int(H*0.08):int(H*0.94)]
    bands = [(v[i*len(v)//3:(i+1)*len(v)//3] > 6).mean()*100 for i in range(3)]
    print(f"{d}: frames {T} share>6 all {(v>6).mean()*100:.2f}%  top {bands[0]:.2f}%  mid {bands[1]:.2f}%  bottom {bands[2]:.2f}%  share>3 {(v>3).mean()*100:.2f}%")
    Image.fromarray(np.clip(s*48, 0, 255).astype(np.uint8)).save(os.path.join(d, "full-map.png"))
    rgb = np.asarray(Image.open(fs[len(fs)//2]).convert("RGB")).copy()
    rgb[s > 6] = [255, 0, 0]
    Image.fromarray(rgb).save(os.path.join(d, "full-overlay.png"))
