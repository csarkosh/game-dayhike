# Forest floor: verification

What was measured against the forest-floor amendment before it shipped, how,
and what the numbers were, in the format of
[`2026-09-24-trail-neglect-verification.md`](2026-09-24-trail-neglect-verification.md).
The amendment is section 12 of
[`2026-09-23-ground-cover-design.md`](2026-09-23-ground-cover-design.md),
dated 2026-09-24; its gates are the amendment's last paragraph.

## 1. Method

Two builds, each from its own checkout on its own port: the branch at its
final commit, and a control at the `main` it branched from (`f276f25`, which
carries the trail's neglect). Every still and every frame sample opens a
fresh page with the world seeded by token, so both builds generate the same
floor, and with the clock pinned (`time 12`). Every game page is blanked
before the next loads.

The poses are the two cells the defect was diagnosed at, found from the
simulation rather than by flying: a full-canopy floor cell beside the trail
(canopy 1.0, where the old floor drew grass at 15 % cover and a third of its
height), and an interior grass cell (cover 1.5, no canopy, no litter) that
this work must not change. A third pose looks along the trail bed at its
strongest litter drift, where the trail's own paint expects pieces to lie.

## 2. The invariants

The interior grass cell is the control for "nothing else moved": its blade
count within 10 m is **2,752 on both builds**, and its two stills are
pixel-alike. At the canopy cell the duff count within 10 m is **548 on both**
(the field's placement is unchanged; the pieces on it are what changed) and
the blade count rises from 2,294 to 2,399 — the canopy floor's higher cover
admitting a few more cells above the strength floor, not a different field.
At the drift, 552 / 552 duff and 2,272 → 2,382 blades, the same way.

## 3. Stills

Seed `ypeqauxk`. Six paired stills, control beside branch, brightened
identically before judging because the canopy scenes are dark.

- **The litter is visible.** Looking down at the canopy floor, the control
  shows dappled ground and nothing on it; the branch shows pieces across
  the margins and the bed — many, at leaf size — and at eye level they run
  along the trail's margins to mid-distance under mist with no edge line
  where the old 8 m reach would have ended. At the drift the bed now has
  pieces lying on it, which is the trail design's "paint and pieces agree"
  with both halves present for the first time.
- **The floor grass stands.** In the canopy stills the near field is no
  longer bare: wisps stand at the feet where the control shows ground.
  The measured ring density is in section 4.
- **Nothing else moved.** The interior grass cell, eye level and floor, is
  the same picture on both builds.
- **The leaves read as dark flat triangles.** This is the one look finding.
  The leaf is a tapered strip, which reads as a triangle at 12–20 cm, and
  its albedo — the shared duff albedo times the leaf tint, about (0.18,
  0.09, 0.03) — is far darker than dry litter, so under canopy shade the
  pieces read near-black. Coverage is achieved; the colour and the profile
  are look calls and are not changed here.

## 4. The near field

Read from the instance buffers on each page after the teleport, with the
hooks and the high tier confirmed and the camera's position read back at
the pose. Blade clumps per square metre by distance ring from the eye, then
the clump sizes within 10 m, the mean height scale of those clumps, and the
litter within 8 m as a count and as the share of ground its pieces' boxes
cover:

| | 0–2 m | 2–4 | 4–6 | 6–8 | 8–10 | 10–15 | 15–20 | thin / base / full | height | litter, share |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| canopy, control | 3.42 | 5.31 | 9.26 | 7.36 | 7.27 | 3.80 | 3.83 | 2,294 / 0 / 0 | 0.342 | 384, 0.27 |
| canopy, branch | 4.30 | 5.89 | 9.87 | 7.54 | 7.43 | 3.86 | 3.87 | 233 / 2,166 / 0 | **0.727** | 384, **0.92** |
| interior, control | 7.72 | 8.01 | 11.44 | 8.16 | 8.10 | 4.06 | 3.99 | 0 / 222 / 2,530 | 0.833 | 0, 0 |
| interior, branch | 7.72 | 8.01 | 11.44 | 8.16 | 8.10 | 4.06 | 3.99 | 0 / 220 / 2,532 | 0.997 | 0, 0 |

Under the canopy every clump the control drew was the thin size at a third
of its height; the branch draws 94 % of them at the base size at nearly
three-quarter height, with 26 % more clumps in the ring at the feet. The
near ring is still lower than the 4–6 m ring at this pose on both builds —
the pose stands beside the trail bed, which carries no grass, and the 4–6 m
ring is where the near and mid tiers overlap — so that is the trail and the
tiering, not a hand-off dip; the interior cell, with no bed near it, shows
the same ring profile on both builds to the hundredth. The litter's
placement is unchanged (384 pieces within 8 m on both) and its footprint
share of the ground rises from about a quarter to about nine tenths; the
box measure overstates cover for scattered pieces, so the honest reading
is "most of the ground now has a piece on it", not a percentage.

At the interior cell the height scale rises from 0.833 to 0.997 with no
other change: the canopy's own height multiplier is gone, so grass under
partial shade stands as tall as its strength allows. That is the
amendment's intent, and it is the one effect of this work that reaches
beyond the closed canopy.

## 5. Frame time

The bar: no more than +2.0 ms at 4× pixels against the control at DEEP (the
litter's worst case) and MEADOW, paired both orders; native reported. Four
pairs per view at 4× (two runs of both orders) and two at native, each a
fresh page per build, 3 s warm-up, 8 s sample, the leading build alternated.
Deltas as branch − control, in the order taken:

| view | 4× per-pair deltas (ms) | 4× median | native pairs (ms) |
| --- | --- | --- | --- |
| meadow | −0.50, +3.77, +1.12, +0.21 | **+0.67 ms** | −0.07, −0.12 |
| deep | +0.47, +2.02, +2.57, +1.37 | **+1.70 ms** | +1.63, +1.64 |

Both views clear the 4× bar; DEEP does so with little to spare, and two of
its four pairs sit over 2.0 on their own. At native, MEADOW is unchanged
and DEEP costs **about 1.6 ms**, the two pairs agreeing to a hundredth —
consistent enough to be read as a real cost rather than noise. It is the
cost of the design's own choices: litter to 24 m where it reached 12, and
a canopy floor drawing base clumps at half cover where it drew thin ones at
a sixth. The samples were taken with another browser and an editor active;
the means (48–64 ms at 4×, 20–31 ms at native, on both builds alike) say
the machine was loaded, so the absolute frame times are not the game's,
but the paired deltas are.

If that native cost has to come out, the knobs are the reach (24 → 20 m
on high takes the far annulus down by a third) and the far tier's clump
count; neither was moved here.

## 6. Fallbacks

None taken.

## 7. Gaps

- The leaf's colour and profile (section 3) are recorded, not fixed.
- The wider reach's cost at native on a quiet machine is owed if the 4×
  pairs here were taken under load; the pairs list their conditions.
