# Flicker tools

The instruments behind the shadow-map and anti-aliasing work of 2026-10-27/28
(`docs/rendering/2026-10-27-shadow-cascade-flicker.md`,
`docs/rendering/2026-10-28-temporal-anti-aliasing.md`). Each opens the real game in a Chrome started
here through the frame-budget harness's `../frame-budget/lib/cdp.mjs`, against the dev server or
the live site, and catches the Babylon engine from the page (a production build has no module to
import), so they work on either.

| File | What it does |
|---|---|
| `probe.mjs` | The shadow map's stability: a fixed world point projected into the first cascade every frame, the texel phase and the cascade's radius printed, and a verdict. Exit 1 on re-phasing. |
| `capture.mjs` | Captures the frames of one page through its variants (below), as JPEG frames of DevTools' screencast or, with `--exact 1`, as per-pixel sums read from the canvas inside the page. |
| `console.mjs` | Prints a page's console errors, warnings and exceptions over N seconds (`--engine webgpu` for the WebGPU path). |
| `again.mjs` | WebGPU only: watches for a pipeline prepared a second time after a mode switch (`--switch explore`) and prints how its binding layout differs from a fresh one. |
| `score/still.py` | A still camera's flicker from JPEG frames: each pixel's residual about a 9-frame moving average, at half resolution, with `still-map.png`. |
| `score/fullres.py` | The same at full resolution, by band, with `full-map.png` and `full-overlay.png`. |
| `score/flick.py` | A turning camera's flicker: frames aligned for the yaw, a pixel counted where the middle of three frames differs from both neighbours the same way. |
| `score/trunks.py` | The trunk columns at the explore trailhead's spawn view, each one's mean over time. |
| `score/exactmap.py` | Scores an `--exact` capture: the share of pixels over 1 and 2 levels of second difference, and `exact-map.png`. |

The Python scripts need NumPy and Pillow. Run them with `python3 -I`.

## Captures

Write captures outside the repository (`--out`): a session is gigabytes of frames. Run them under
the owner's conditions, where the reports came from: medium tier, WebGL2, DPR 2, explore mode.

```bash
node tools/flicker/capture.mjs --base https://games.csarko.sh/dayhike --engine webgl2 --tier medium \
  --dpr 2 --settle 25 --seconds 4 --turn 0 --cmd "mode explore;time 12;wind 0" \
  --variants stillcam,stillcam+sunfix,stillcam+noshadow --exact 1 --out <dir>/noon
python3 -I tools/flicker/score/exactmap.py <dir>/noon/*/
```

Without `--exact` each variant's folder holds `f0000.jpg` onwards, scored by `still.py`,
`fullres.py` or `flick.py`. With it, each holds `hf.f32` (the summed second difference
`|L(t) - (L(t-1) + L(t+1)) / 2|` a pixel), `alt.u16` (sign alternations over 2 levels),
`first.rgba` (the first frame) and `exact.json` (size and frame count). A screencast's JPEG noise
on a dark trunk is a level or so, as large as the faint flicker it is looking for: use `--exact`
for that. The run's `log.json` holds a row a variant: engine, passes, shadow map, scale, the sun's
direction and strength, frame rates.

Variants, joined with `+`, each undone before the next:

| Variant | What it changes |
|---|---|
| `base` | Nothing. |
| `stillcam` | The camera held still (the default turns it `--turn` px of mouse a frame). |
| `walked` | A step forward and back to standing before the capture. |
| `sunfix` | The sun's direction held where it was. |
| `noshadow` | The sun casts no shadow. |
| `every` | The shadow map drawn every frame, not every second one. |
| `mapN`, `pcfhigh`, `pcfmed`, `blendN`, `lambdaN` | The shadow map's size, filtering, cascade blend (N %) and split lambda (N %). |
| `nobark` | The trunks' axis shading off. |
| `fullscale`, `scaleN` | The render scale held at full, or at 1/N. |
| `nopost` | Every post-process pass detached. |
| `notaa` | The anti-aliasing's two passes detached. The jitter keeps running, so this is not the look without the pass: compare against a build without it. |
| `nojitter`, `jitterN` | The anti-aliasing's jitter off, or scaled to N %. |
| `taablendN`, `clipN`, `nosharpen` | The anti-aliasing's blend (N %, held whatever the camera does), its history clip (N/100 deviations) and its sharpen off. |

Compare variants within one run. A fresh page spawns with another view, and in explore mode the
day's sun moves about a degree every five seconds, so run-to-run spread is large; repeat the base
variant between the others to see it.
