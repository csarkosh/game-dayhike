# Atmosphere restyle: browser verification

**Status:** gated 2026-09-15, against the gates `docs/rendering/2026-09-15-atmosphere-restyle-design.md`
§10 lists. Branch `worktree-atmosphere-restyle` at `8f3c940`, control `main` at the branch's
base, `434931f`.

## What was gated

**Rig.** Both builds served from their own worktrees: the branch on port 5173 (signaling on
8080), the control on port 5174 (signaling on 8081, a temporary Vite port and proxy edit,
reverted afterward). Chrome ran through the chrome-devtools CLI daemon, 1920×1080 pages, on
the real GPU: `ANGLE (Apple, ANGLE Metal Renderer: Apple M4)`, with `textureHalfFloatRender`
true.

**World.** Both builds ran the same script and seed: `?cmd=seed atmo;freecam;weather
<w>;time <h>`, spawned at (−276.11, 5.92, 0) looking +z — the trailhead, road on the left,
forest on the right.

**Pose.** One fixed freecam pose for every hero frame, so the four frames and the control
are directly comparable at a glance.

**Builds.** Pass 1 was taken at `7bb387c` and found the four defects below; pass 2 at
`8f3c940`, the tip of the branch, after the fixes.

## Pass-1 defects and their fixes

1. The scene rendered at quarter resolution on high: Babylon renders the scene into the
   first post-process's input texture, and that was the quarter-resolution halation
   extract. Fixed by heading the chain with a full-resolution `PassPostProcess("scene")`
   that the grade pass samples as the scene (`fix: render the scene at full resolution
   ahead of the halation extract`, `b4c0350`).
2. The vignette blacked out the frame edges at the eerie weight. The formula was replaced
   so it darkens only the corners: 0.40 at clear, 0.63 at full dread (`feat: tune the
   atmosphere restyle from the browser gates`, `8f3c940`).
3. The analytic split-tone was many times stronger than the `ColorCurves` grade it
   replaced — eerie at 17 h was a solid green wash. Added `SPLIT_TONE_DENSITY_SCALE = 0.35`
   and `SPLIT_TONE_SATURATION_SCALE = 0.5` (same commit).
4. The height fog at eerie put the camera 19 m below its reference level on top of the
   existing 12× mist density. `HEIGHT_MIST_GAIN` dropped 6→2, `LEVEL_MIST_RISE` 25→8,
   `LEVEL_DREAD_RISE` 20→6 (same commit).

## The four hero frames

**Sunny start** (`clear`, 12 h) — sharp, reads photographic: aerial perspective on the far
trees, a warm sun-side haze at the horizon, pollen motes in the air. The ground is paler
and the sky less saturated than the control, from AgX replacing ACES. PASS.

**Dawn** (`clear`, 6.5 h) — the near-black sky dome at low sun is pre-existing
`SkyMaterial` behaviour, present in the control too. The branch is brighter, with a warm
white point and a bright horizon band from the fog gradient's far end. It reads "artsy"
rather than wrong, but the sky dome and `skyColourAt`'s horizon disagree at low sun — open,
not a regression (see Open tuning items).

**The eerie turn** (`eerie`, 17 h) — legible and authored: green-grey fog, trees
silhouetted into mist, plum-brown ground, rain streaks, a subtle corner vignette. The
control's fog is flatter and teal by comparison. PASS.

**Night with headlamp** (`eerie`, 21 h) — comparable darkness to the control, road and
forest edge readable, cooler from the Purkinje term, rain streaks. Freecam carries no
headlamp, so halation on the lamp itself went unverified. PASS on what could be judged.

## The other gates

- **Banding** (night sky, top-left quarter at 4× brightness): a smooth gradient, only the
  fine dither pattern visible. PASS.
- **Tiers**: high attaches `scene, halationExtract, halationBlurX, halationBlurY, grade,
  chromaticAberration, fxaa, finish`; medium attaches `grade, chromaticAberration, fxaa,
  finish`; low attaches no passes, sets `toneMappingType` to Khronos Neutral (2) and
  `applyByPostProcess` to false. Low keeps the colour intent — green-teal mids, a cool sky
  — through Babylon's own operators, with a brighter sky than high. PASS, as the spec
  accepts for the low tier.
- **`/unsettle 0`** (eerie, 17 h): the world is unchanged and the frame is nearly identical
  to the default — the lens-side effects are subtle by design. The corner overlap (a 0.35
  gain times a 0.35 de-lit echo, ≈12%) is barely perceptible. PASS; the overlap's look at
  higher gains is unverified.
- **Dread fade** (`mist` → `eerie` over 12 s at 17 h, sampled every 0.5 s across the first
  ~7 s): the frame darkens slightly and the fog cools, but the three plateaus are not
  distinguishable by eye at this pose. The world-side dread terms — the fog pull (0.35),
  the exposure dip (−10%), the ambient collapse at the top plateau (−45%) — are small next
  to the mood grade's continuous mist/eerie share. Numerically stepped and unit-tested;
  visually subtle. Open tuning item for sub-project D, not blocking.

## Frame time

Measured at the eerie 21 h spawn pose, one fresh page at a time, hardware scaling 0.5 (so
both builds render at 3840×2160 and neither is capped by vsync), a 3 s warm-up and a 4 s
sample, with no other agents or test suites running.

| Round | Order | Build | n | mean ms | p95 ms |
| --- | --- | --- | --- | --- | --- |
| 1 | branch first | branch | 75 | 53.63 | 61.3 |
| 1 | | control | 70 | 56.34 | 61.5 |
| 2 | control first | control | 79 | 50.95 | 53.4 |
| 2 | | branch | 90 | 44.19 | 50.8 |
| — | | branch, motes stopped | 96 | 41.54 | 43.1 |

Branch minus control: −2.7 ms in round 1, −6.8 ms in round 2. The branch is faster than the
control in both orders. The retired outline pass took its own depth and g-buffer pre-pass
with it — a second full scene render on high — and that saving outweighs the cost of the
new post chain. Motes cost about 2.7 ms at 4× pixel count, roughly 0.7 ms at native
resolution. The design's ~2 ms post-chain budget (§2) is met by construction, since the net
change from `main` is negative. PASS.

## Open tuning items

- The dawn sky dome and the fog gradient's horizon colour disagree at low sun (see Dawn,
  above): not a regression, but not matched either.
- The corner overlap has only been seen at its default gain (0.35 × 0.35 ≈ 12%); its look
  at higher gains is untested.
- The dread fade's three plateaus are numerically exact but not visible by eye at the 17 h
  pose tested; their visibility from a darker pose is untested.
- Halation on the headlamp is untested: freecam carries no headlamp light.

## What went unverified

- Halation on the headlamp (freecam has no lamp) and on the low sun through the canopy.
- The overlap's look at higher gains, and the plateau steps' visibility from a darker pose.
- Frame time at native resolution under vsync — both builds cap at 16.7 ms there.

## Images

Screenshots are archived outside the repository at
`~/Projects/fps-sdd-archive/2026-09-15-atmosphere-restyle/shots/`: `branch-*` is pass 1,
`branch2-*` is pass 2, `control-*` is the control, `sheet-*.jpeg` are contact sheets, and
`branch2-eerie21-skycrop-x4.jpeg` is the banding crop.
