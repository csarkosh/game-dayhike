# The grass floor: browser verification

**Status:** gated 2026-09-16, against the gates `docs/rendering/2026-09-16-grass-floor-design.md`
§9 lists. Branch `worktree-grass-floor-impl` first at `7f25772` (Tasks 1–4), then at the retuned
commit `0fa9be4`; control at the branch base `9de010d` on `main`.

## The rig

Both builds served from their own worktrees: the branch on port 5174 (signaling on 8081), the
control on port 5175 (signaling on 8082), each with a temporary Vite port and proxy edit and the
gate hooks (`__scene`, `__engine`, `__renderer`, `__fcSet`, `__fc`, `__lampOn`), all reverted
before commit. Chrome ran through the chrome-devtools CLI daemon
(`--isolated --allowUnrestrictedPaths --headless=false`), one game page at a time, on the real
GPU: `ANGLE (Apple, ANGLE Metal Renderer: Apple M4)`.

Both builds ran the same seeded world: `?cmd=seed atmo;freecam;weather <w>;time <h>`. The four
viewpoints are the same ones the previous verification round used:

- MEADOW: (−216.1, eye 22.38, 414), yaw 0.393, pitch 0.08 — open grass, no canopy, 418 m off the
  trail.
- EDGE: (231.9, eye 85.61, 54), yaw −1.571, pitch 0.05 — in the grass, looking 48 m into a full
  canopy.
- TRAIL: (263.9, eye 85.77, 118), yaw 1.571, pitch 0.12 — on the bed, canopy 0.03, looking along
  the trail, lamp forced on.
- DEEP: (159.9, eye 114.68, −234), yaw −1.078, pitch 0.05 — canopy 1.0, 79 m off the trail.

Plus the floor crop at the meadow viewpoint: the same pose at pitch 0.55 for the near floor
(3–6 m), and a mid-distance look at pitch 0.25 for the band from 5 to 20 m. Zero console errors
on every branch page; the ground shader compiles on the real GPU with `dFdx`, `textureGrad` and
the hex include.

## Gate 1: open meadow

**As first built (7f25772): FAIL.** The near floor was indistinguishable from the control at any
strength of the detail term; live overrides of the plugin's uniforms at one pose showed the term
only appears at absurd weights, because the grass maps are 512 px over 2 m (±3 % visible albedo
contrast at a 3–6 m footprint) and the occlusion curve sat near 1 over the 0.5-centred height
channel. The horizon tint brightened the far field (row-mean brightness rose from 92 to 102 of
255 at the 20 % row) while the tufted band sits at 66–71, i.e. the wrong direction; darker
targets converged on the control because the far field's brightness is atmosphere-bound. The
macro range was not visible. The repeat was not visible in either build at these poses (the
tufts cover the 2 m period).

**Retuned: PASS.** With the centred occlusion curve at 1 m and weight 0.7: a soft mottle with
depth between the clumps at 3–6 m and visible ground structure across 5–20 m against the
control's flat plane; weight 1.0 read as stains and was rejected. Faint lush/dry patches in the
far field, no pale band, the far slope a touch greener.

## Gate 2: forest edge, 14 h — PASS

Branch and control read near-identical: tufts and floor agree, no seam at the treeline. After
the retune the meadow-side floor is slightly patchier than the control; nothing else changes.

## Gate 3: the trail at eerie 20 h, lamp on — PASS

Read on both builds, `7f25772` and the retuned `0fa9be4`: no sparkle, no banding in the lamp pool
with the detail term under the near light. The two builds read identical apart from the rain's
own frame-to-frame variance.

## Gate 4: deep forest — PASS (visual)

Branch and control read identical under the canopy; the gate here is the frame pair below, since
the ground carries a small non-zero grass weight at this pose.

## Frame time

First, the run at `7f25772` (4× pixels, both orders), before the retune:

| view | branch mean/p95 (ms) | control mean/p95 (ms) | Δ mean |
| --- | --- | --- | --- |
| meadow | 19.97 / 22.2 | 17.00 / 18.9 | +2.97 |
| edge | 26.63 / 28.2 | 22.95 / 24.5 | +3.68 |
| trail | 24.06 / 25.7 | 20.89 / 22.8 | +3.17 |
| deep | 28.59 / 30.5 | 26.82 / 28.4 | +1.77 |

The control-first order agrees within 0.1 ms on every view.

Then the retuned run, Δ mean by order:

| view | branch-first | control-first |
| --- | --- | --- |
| meadow | +2.98 | +2.29 |
| edge | +2.93 | +2.91 |
| trail | +2.61 | +2.65 |
| deep | +1.68 | +1.59 |

And the low tier at 1.5× hardware scaling, meadow only: 16.68 ms vs 16.68 ms, n = 239 in every
sample, both builds on the vsync cap.

Verdict: about +0.75 ms implied at native resolution (the 4× delta divided by four; the 1.5×
pair stays on the cap) on the fill-heaviest view, inside the 60 Hz contract. The deep-forest
ground carries a small non-zero grass weight under the canopy, so the
vertex-weight gate saves only where grass is exactly zero (coast, rock); the fallback ladder in
§10 was not needed.

## The coast

The sand/pebble beach at the trailhead is the one ground with zero grass weight where the height
blend can still hand grass a small share, so it is where the plain fallback fetch carries the
blend. Three headings at (−321, eye 3.3, 5), pitch 0.5, on `0fa9be4`: clean sand, no dark
speckles, zero console errors.

## Unverified in this rig

- The retuned constants were judged at noon, at 14 h and under the lamp at 20 h; not under a low
  sun (17 h).
