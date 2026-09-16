# The trail as a bench: browser verification

**Status:** gated 2026-09-16, against the gates `docs/rendering/2026-09-16-trail-bench-design.md`
§8 lists. Branch `worktree-trail-bench-impl` first at `ad9fa02`, then retuned at `427f2a3`;
control at the branch base `3a5a89a` on `main`.

## The rig

Both builds served from their own worktrees: the branch on port 5174 (signaling 8081), the
control on port 5175 (signaling 8082), each with a temporary Vite port and proxy edit and the
gate hooks (`__scene`, `__engine`, `__renderer`, `__fcSet`, `__fc`, `__lampOn`), all reverted
before commit. Chrome ran through the chrome-devtools CLI daemon
(`--isolated --allowUnrestrictedPaths --headless=false`), one game page at a time, on the real
GPU: `ANGLE (Apple, ANGLE Metal Renderer: Apple M4)`.

Both builds ran the same seeded world: `?cmd=seed atmo;freecam;weather <w>;time <h>`. The six
viewpoints:

- TRAIL: (263.9, eye 85.77, 118), yaw 1.571, pitch 0.12 — on the bed, looking along the trail;
  the down pose is the same point at pitch 0.6.
- JUNCTION: at a degree-3 node near (151, −108); camera (144.0, 112.06, −108.0), yaw 1.571,
  pitch 0.25.
- TRAILHEAD: near the pad at (−276.1, 0); camera (−267.9, 6.55, −5.8), yaw −0.957, pitch 0.2,
  looking back at the pad.
- SIDEHILL: a stem edge whose cross-slope rises 0.39 m over 6 m, the steepest side-hill the
  route takes; camera (−81.3, 75.03, −80.0), yaw 1.998, pitch 0.15.
- ONBENCH: (263.9, eye 85.07, 118), yaw 1.571, pitch 0.35 — eye about a metre above the sunk
  bed.
- MEADOW: (−216.1, eye 22.38, 414), yaw 0.393, pitch 0.08 — the frame-pair control view.

Before-stills of the shipped trail at the branch base (noon, 16 h and rain, along and down)
gave the baseline the gates below compare against.

## Console and compile

All eighteen gate pages (nine poses on each of the two builds) loaded with zero console errors;
the two-row segment table, the along-length wear noise, the hex include's noise functions and
the `terrainWet` uniform all compiled on the real GPU.

## Gate 1: the trail at noon, 16 h and in rain

**As first built: two faults.** The 3 m ruled gravel band was gone, replaced by a narrow
footpath whose edge wanders and whose width varies along its length, the core darkening and
glossing in rain and pebbles sitting on the core — but the loose margin read as a bright chalk
line flanking the dark core (margin albedo about 0.36 against the core's about 0.11), and the
trampled band beside it read as a saturated yellow ribbon rather than dried, stained grass.

**Retuned: PASS.** Two tuning variants were tried. Taking the ground's full vertex colour
removed the chalk line but drove the bench near-black under canopy and lost the core/margin
contrast entirely. Taking 60% of the vertex colour, with the margin retuned to `(0.40, 0.36,
0.30)` at a gain of 0.75, the core to `(0.30, 0.26, 0.21)` at a gain of 0.5, and the trampled
tint to `(0.90, 0.88, 0.80)`, gave a pale grey margin at about twice the core's brightness that
still darkens under canopy, and a light olive trampled band in place of the yellow ribbon; this
is what shipped, as `TRAIL_BENCH_SHADE = 0.6`. A re-gate against the retuned build, across the
trail at noon and in rain, the junction and the side-hill at 16 h, confirmed the same read: a
pale grey margin at about twice the core's brightness, a textured grey-brown core, both
darkening under canopy, the core going dark and glossy inside pale margins in rain, and the
trampled band staying a light olive. Zero console errors.

## Gate 2: junction and trailhead — PASS

The bench scuffs wide into the junction, with pebbles sitting on the widened core; at the
trailhead the core lands on the sand pad with its ragged edge intact, while the margin merges
into the sand rather than standing out against it.

## Gate 3: side-hill, 16 h — PASS (visual)

The route's steepest side-hill rises only 0.39 m over 6 m, so the face this stretch shows is
slight: the bench reads as a dark path under canopy, and the lip is not distinguishable at this
pose. No shimmer showed on the edge noise or the lip in any of the stills.

## Gate 4: on the bench — PASS

With the eye at the sunk tread, the cards beside the bench are visibly shorter and lean
outward, away from the bed; there is no floating-feet artifact, because the sim's walk height
is the height the bench is drawn at.

## Frame time

4× pixels, both orders, on the pre-final-retune build:

| view | Δ mean, branch-first | Δ mean, control-first |
| --- | --- | --- |
| meadow | +0.40 | −0.35 |
| trail | −0.11 | −0.29 |

Both deltas sit within noise in both orders: the paint's added work is confined to the 7 m
corridor and buys nothing measurable at 4× pixels. The low tier at 1.5× hardware scaling, on
the trail: 16.68 ms against 16.67 ms, n = 239 on each build, both riding the 60 Hz vsync cap.
Frame time was not re-measured after the final colour retune, which changes five constants and
one `mix` and touches no control flow.

Verdict: the trail bench stays inside the 60 Hz contract on both the fill-heavy meadow and the
trail itself, at every tier tested.

## The level id

A client on an older build refuses to join a newer host running the trail bench release, with
the existing level-mismatch message — the level id moved through the trail and litter tunables
as designed.

## Unverified in this rig

- The wet core's puddles were judged in stills at rain only; mist and the eerie weather state
  were not screened.
- The lip under a low sun on a real side-hill: the route this world offers has none steep
  enough to test it against.
- The trampled band's lean, seen only in stills rather than in motion.
