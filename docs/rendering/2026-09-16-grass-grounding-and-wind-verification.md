# Grass grounding and one wind: browser verification

**Status:** gated 2026-09-16, against the gates `docs/rendering/2026-09-15-grass-grounding-and-wind-design.md`
§10 lists. Branch `worktree-grass-wind` at `27eb827` (Tasks 1–8), control at the branch's base,
`a431e5d` on `main`.

## The rig

Both builds served from their own worktrees: the branch on port 5174 (signaling on 8081), the
control on port 5175 (signaling on 8082), each with a temporary Vite port and proxy edit and the
gate hooks (`__scene`, `__engine`, `__renderer`, `__fcSet`, `__fc`, `__lampOn`), all reverted
before commit. Chrome ran through the chrome-devtools CLI daemon
(`--isolated --allowUnrestrictedPaths --headless=false`), one game page at a time, on the real
GPU: `ANGLE (Apple, ANGLE Metal Renderer: Apple M4)`.

Both builds ran the same seeded world: `?cmd=seed atmo;freecam;weather <w>;time <h>`, seed
627994160, trailhead at (−276.1, 0). Four viewpoints were precomputed from the sim (a throwaway
vitest script) so every still is directly comparable:

- MEADOW: (−216.1, eye 22.38, 414), yaw 0.393, pitch 0.08 — open grass, no canopy, 418 m off the
  trail.
- EDGE: (231.9, eye 85.61, 54), yaw −1.571, pitch 0.05 — in the grass, looking 48 m into a full
  canopy.
- TRAIL: (263.9, eye 85.77, 118), yaw 1.571, pitch 0.12 — on the bed, canopy 0.03, looking along
  the trail, lamp forced on.
- DEEP: (159.9, eye 114.68, −234), yaw −1.078, pitch 0.05 — canopy 1.0, 79 m off the trail.

Branch page checks: the gate hooks all present, `__renderer.wind()` reads speed 0.25 on clear
(lean 0.0875, gust 0.0625), 17 materials carry `Foliage`, 9 carry `FoliageLight`, and every page
loaded with zero console errors.

## Gate 1: open meadow — PASS

Clear, noon, on the control: every tuft is a black cut-out with a hard edge on a flat pale-green
ground, trees dark. The flat, game-like read the spec set out to fix.

Clear, noon, on the branch: the tufts are green-grey, tinted to the ground at the base, with no
black cards; the field reads as one surface with the ground. Trees are unchanged (out of scope
for this package).

Clear, 17 h, on the branch (the backlight bonus frame): warm low sun, the tufts glow slightly
through from translucency, the ground reads warm; the frame reads photographic.

Rain, noon, on the branch: grey-green and wet, with streaks; the grass keeps its grounding under
the fog.

`/wind 100`, a six-frame strip 0.6 s apart at the meadow: the tufts shift visibly frame to frame.
Motion, not vibration. The amplitude is modest at this pose.

Tuning note: the blade cores stay darker than the ground — root darkening at 0.45 plus the
cards' own dark texture. A lighter `rootAO`, 0.55 to 0.6, is the first lever if the owner wants
paler tufts.

## Gate 2: forest edge, 14 h — PASS

Control: dark, near-black tufts under the treeline shadow.

Branch: the tufts read pale grey-green and lit; the meadow reads continuous up to the trunks;
canopy shadow still falls on the ground as before.

Tuning note: the tufts are on the pale side here, from the ground tint under the canopy palette
running light. Acceptable, worth an owner look.

## Gate 3: the trail at eerie 20 h, lamp on — PASS

Branch and control are near-identical: the lamp pool on the bed, the bush beside it, rain
streaks, the dark green-grey night. The eerie read survives the removal of the air bed. Visual
only — audio was not checked by ear in this rig.

## Gate 4: deep forest, clear 12 h — PASS (visual)

Branch and control are near-identical; the understory ferns read slightly lighter, from the
ground tint. Tree sway is not judged from a still frame — the frame-time pair below is the gate,
and it clears without the fallback ladder.

## /wind 0

`?cmd=…;wind 0` reports `wind().speed 0, lean 0, gustAmp 0`, and the meadow frame taken under it
is still. `setWindOverride(null)` restores speed 0.25 on clear.

## Frame time

Paired, one page at a time, hardware scaling 0.5 on a 2400×1472 page (about 14 Mpx), a 3 s
warm-up and a 4 s sample.

| Round | Order | View | Branch mean / p95 (ms) | Control mean / p95 (ms) | Branch − control |
| --- | --- | --- | --- | --- | --- |
| 1 | branch first | meadow | 102.8 / 115 | 51.0 / 56 | +51.9 |
| 1 | branch first | edge | 56.2 / 62 | 55.2 / 62 | +1.0 |
| 1 | branch first | trail (eerie 20 h, lamp) | 51.4 / 59 | 75.3 / 92 | −24.0 |
| 1 | branch first | deep forest | 59.3 / 65 | 56.5 / 60 | +2.8 |
| 2 | control first | meadow | 45.7 / 52 | 45.1 / 51 | +0.6 |
| 2 | control first | edge | 53.2 / 61 | 50.7 / 55 | +2.5 |
| 2 | control first | trail | 50.7 / 58 | 49.1 / 57 | +1.6 |
| 2 | control first | deep forest | 57.9 / 67 | 58.4 / 68 | −0.5 |
| 3 | branch first, idle machine | meadow | 53.0 / 67 | 48.1 / 55 | +4.9 |
| 3 | branch first, idle machine | trail | 52.5 / 61 | 51.6 / 62 | +0.9 |

Round 1's meadow pair (+51.9) is the first page of the run: shader compile plus other work on
the machine competing for the GPU at the same time. Round 1's trail pair (−24.0) is a
control-side outlier for the same reason. Both are superseded by rounds 2 and 3, run with the
machine otherwise idle, where every view sits within a few milliseconds of the control in both
orders.

Verdict: the branch costs about +1 to +5 ms at 14 Mpx on the fill-heaviest views (meadow, edge)
— the added fragment work on grass cards: the ground tint, the normal blend, the wrap diffuse.
Scaled to native 1080p (2 Mpx) that is well under 1 ms. The deep-forest pair — the tree-sway gate
— is within noise in both orders (+2.8, −0.5), so the fallback ladder in §8 is not needed. Both
builds sit far off the 16.7 ms cap only because of the 4x pixel load from hardware scaling; at
native resolution both are vsync-locked at this pose. PASS.

## Unverified in this rig

- The wind bed and the removed air tone by ear, at clear, mist and eerie. The rig took stills and
  frame-time samples only; the owner should confirm the audio.
- A 10 s motion clip at the forest edge — only the meadow got a `/wind 100` strip.
- The low tier's 1.5x hardware-scaling frame pair.

## Re-gate after the fix wave

- The understory now carries a real per-instance `foliage` buffer and the shader ignores tint
  data that is absent, so the understory was re-shot: a deep-forest pose at clear 12 h, pitched
  down at the shrubs and ferns, branch beside control. The shrub and fern cards match the
  control's tone; no darkened bases. Pass.
- Tree sway was re-shot in motion at `/wind 100` (six frames 0.6 s apart) because the sway
  amplitude is now a fraction of the drawn height rather than the model height. At the forest
  edge the crown silhouettes and the tufts shift visibly between frames. In deep forest the
  understory fronds move and the trunks stay planted; the canopy motion is subtle at that pose.
  Pass, with the owner's in-game read at `/wind 100` as the final word on the amplitude.
- The meadow `/wind 100` strip in gate 1 predates that change; grass cards draw at 0.74 to 1.49
  times model scale, so their amplitude changed by at most that factor.
- The full suite was green on an idle machine before the fix wave (client 1724 tests, server 92,
  tools 70) and is re-run after it; the result is recorded in the commit that lands the branch.
