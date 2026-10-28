# Scores an --exact capture folder: prints the shares and writes exact-map.png (frame with the
# second-difference map in magenta) beside it. python3 -I exactmap.py <dir> [<dir> ...]
import sys, json, numpy as np
from PIL import Image
for d in sys.argv[1:]:
    m = json.load(open(d + '/exact.json')); w, h, n = m['w'], m['h'], m['frames']
    hf = np.fromfile(d + '/hf.f32', np.float32).reshape(h, w)[::-1] / max(n - 2, 1)
    alt = np.fromfile(d + '/alt.u16', np.uint16).reshape(h, w)[::-1] / max(n - 2, 1)
    rgb = np.fromfile(d + '/first.rgba', np.uint8).reshape(h, w, 4)[::-1, :, :3].astype(float)
    up = slice(0, h // 2)
    print(d, 'frames', n, 'hf mean %.3f' % hf.mean(), 'hf>1 %.4f' % (hf > 1).mean(), 'hf>2 %.4f' % (hf > 2).mean(),
          'alt>5%% %.4f' % (alt > 0.05).mean(), 'upper hf>1 %.4f' % (hf[up] > 1).mean())
    o = rgb * 0.55; k = np.clip(hf * 60, 0, 255); o[..., 0] = np.maximum(o[..., 0], k); o[..., 2] = np.maximum(o[..., 2], k)
    Image.fromarray(o.astype(np.uint8)).save(d + '/exact-map.png')
    Image.fromarray(rgb.astype(np.uint8)).save(d + '/first.png')
