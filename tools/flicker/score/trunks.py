"""Trunk-wide flicker in a still-camera capture of the explore trailhead (2600x2070 jpgs).
python3 -I trunks.py <dir> ...   Regions are trunk columns in 1300x890 still-map coordinates."""
import sys, glob, os
import numpy as np
from PIL import Image, ImageDraw
REG = {"trunk L":(40,20,62,380),"trunk 300":(290,20,312,330),"trunk 650":(640,20,660,280),"trunk 850":(845,20,865,310),"trunk big R":(905,20,945,320),"trunk 1110":(1100,20,1120,230),
       "table":(490,330,580,420),"path":(500,600,800,800)}
def load(d):
    fs = sorted(glob.glob(os.path.join(d, "f*.jpg")))
    A = np.stack([np.asarray(Image.open(f).convert("L").resize((1300,1035)), dtype=np.float32) for f in fs])
    keep=[0]+[i for i in range(1,len(A)) if np.abs(A[i]-A[i-1]).mean()>0.02]
    return A[keep]
draw_once = True
for d in sys.argv[1:]:
    B = load(d); T = B.shape[0]; off = int(1035*0.08)
    out = []
    for name,(x0,y0,x1,y1) in REG.items():
        r = B[:, y0+off:y1+off, x0:x1]
        ts = r.mean(axis=(1,2))
        k=9; ma = np.convolve(ts, np.ones(k)/k, mode="same"); res = ts - ma
        step = np.abs(np.diff(ts)).mean()
        out.append(f"{name} {res[k:-k].std():.2f}/{step:.2f}")
    print(f"{os.path.basename(os.path.dirname(d)) or d}/{os.path.basename(d)} ({T}f): " + "  ".join(out))
    if draw_once:
        im = Image.fromarray(B[0].astype(np.uint8)).convert("RGB"); dr = ImageDraw.Draw(im)
        for (x0,y0,x1,y1) in REG.values(): dr.rectangle((x0,y0+off,x1,y1+off), outline=(255,0,255), width=2)
        im.save("trunk_regions.png"); draw_once = False
