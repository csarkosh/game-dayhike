# Trail neglect: verification

What was measured against the trail-neglect design before it shipped, how,
and what the numbers were, in the format of
[`2026-09-22-blade-field-verification.md`](2026-09-22-blade-field-verification.md).
The design is in
[`2026-09-23-trail-neglect-design.md`](2026-09-23-trail-neglect-design.md);
its gates are section 6.

## 1. Method

Both builds run from their own checkout on their own port: the branch at its
final commit, and a control at the `main` it branched from (`f5cebdc`, which
already carries the ground cover and the wildlife director — the trail's cost
is measured on top of those, not folded into them). Every still and every
frame sample opens a fresh page, with the world seeded by token so the
control and the branch generate the identical trail, and with the clock
pinned (`time 12`) so two stills minutes apart are lit the same. Every game
page is blanked before the next one loads.

The poses are found from the simulation rather than by flying: the bed's
distance field and the ground-cover field are sampled offline at the seed
the pages use, so a still at "a drift" is at a point where the field says
the bed carries one, and the walk follows the bed's own tangent.

## 2. The invariants

This work changes the bed's paint, the pebble-litter density and the trample
beside the bed. It does not move where duff pieces or grass blades stand, so
the instance counts within 10 m of every pose must be identical on the two
builds before any picture is judged. They are:

| pose | duff within 10 m | blades within 10 m |
| --- | --- | --- |
| the drift, looking down and along, clear and mist | 532 / 532 | 2,344 / 2,344 |
| trailside | 233 / 233 | 1,975 / 1,975 |
| walk 0 m / 20 m / 40 m | 532, 547, 540 (both) | 2,344, 2,378, 2,274 (both) |

Pebble litter reuses the rock and driftwood meshes at small scale, so it is
counted as those meshes' instances under 0.65 scale rather than by name. At
the drift pose: **20 pieces within 10 m on the control, 38 on the branch**;
210 loaded against 305 (1.45×, the 0.6 → 0.9 density); the full-size rocks
in the same meshes 3 and 3. The litter rose and nothing else moved.

## 3. Stills

Seed `atmo`. The drift pose is the strongest bed drift within reach of the
earlier gates' trail pose: bed margin at (283, 134), 0.74 m from the
centreline, duff 1.00. Eight paired stills, control beside branch, brightened
identically before judging because the scenes are dark.

- **The core is traceable from the near edge to the far fade in every
  still**, clear and mist alike. This is the design's one pass/fail by eye,
  and it passes.
- **The bed reads as neglected.** The control's bed is a crisp, pale, evenly
  pebbled band with a sharp ragged edge — a maintained path. On the branch
  the margins carry warm, dirt-toned patches where the pebble relief has
  faded out, loose stone lies along the bed in greater number, and at
  trailside the grass beside the bed stands visibly taller at the edge.
- **Along the 40 m walk the patches vary rather than repeat.** Each frame is
  aimed along the bed's local heading. At 0 m a full drift on the margin; at
  20 m, under shade, a partial one; at 40 m, out of the canopy, a wash-out —
  the bed goes smooth and pebble-free across its full width for some ten to
  fifteen metres, then the gravel resumes. The field says the drift half:
  22 of the 41 metres sit above the drift ceiling. Nothing repeats.
- **The wash-outs read as smooth pale dirt.** Brightened for judging, they
  lean toward sand rather than the darker packed earth the design describes;
  the raw frames are darker. Whether that is right is a look call, and the
  knob is `TRAIL_WASH_DARK` (0.7) with the band `TRAIL_WASH_BAND`; neither
  was moved here.
- **The drifts do not read as leaves.** They read as smooth packed dirt. The
  drift tint as first written carried the forest floor's own hue rather than
  the needle bed's, and is now derived from `NEEDLE_BED` instead; re-shot at
  the same pose, the drift reads as needle-brown where it read as dimmed
  floor, at the same brightness. Beyond that, it is the litter pieces meant
  to lie on a painted drift that cannot
  be seen, because the ground cover's duff characters are millimetres wide
  (a twig is 5 mm, a leaf cluster 2.2 cm): sub-pixel at a few metres. That is
  a defect in the ground cover, not in this paint, and it is recorded here
  as the reason the bed currently reads "dirty" rather than "leafy". The
  drift tint was deliberately not pushed to fake litter with paint alone;
  the design's goal is paint and pieces agreeing, and that is what the
  vertex channel guarantees once the pieces are visible.

## 4. Frame time

The bar: no more than +0.5 ms at 4× pixels (hardware scaling 0.5) against
the control, at TRAIL and TRAILSIDE, paired both orders. The design asked for
two pairs; the first two came back with the control alone swinging 20 ms
between runs, so four more were run and all six are listed. Each pair is
a fresh page per build, 3 s warm-up, 8 s sample, the leading build
alternated. Deltas as branch − control, in the order taken:

| view | per-pair deltas (ms) | median |
| --- | --- | --- |
| trail | −6.63, −0.61, −0.54, +1.93, +6.13, +0.32 | **−0.11 ms** |
| trailside | +14.43, +5.65, −0.74, +3.50, +0.19, +0.23 | **+1.87 ms** |

TRAIL clears the bar. **TRAILSIDE does not, as measured.** Two things are
true about that number at once, and both are reported rather than one
chosen:

- It tracks the machine's load. The three trailside pairs taken while the
  control itself was fastest (≤ 54 ms) read −0.74, +0.19 and +0.23 ms —
  inside the bar; the three taken while it was slower read +3.5 to +14.4.
  Pairs are meant to cancel load, but they cancel it only when the load is
  steady across the two 8 s samples, and it was not: another browser was
  active on the machine throughout.
- There is a real mechanism for a cost here. The wash-out samples a second
  `macroValueNoise` — a four-tap hash — on every bed fragment, on top of the
  puddle's existing one, and at trailside under mist the bed fills much of
  a grazing view at four times the pixels. A cost of a millisecond or two at
  4× is plausible from that alone, and would be a quarter of it at native.

So the 4× trailside figure is not claimed as a pass. The native pair below
is the number the 60 Hz contract actually depends on. If a paint cost has to
come out, the wash-out noise can move from the fragment to the vertex stage:
a 4 m noise sampled at the clipmap's near vertex spacing and interpolated is
smooth to the eye, and it removes the per-fragment hash entirely. That is a
follow-up, not a change made here.

## 5. Native resolution and p95

The same two views at 1× pixels, two pairs each, both orders. Means as
branch / control, deltas as branch − control:

| view | pair 1 (branch first) | pair 2 (control first) | median delta |
| --- | --- | --- | --- |
| trail | 18.23 / 18.03, +0.20 ms | 19.73 / 19.10, +0.63 ms | **+0.42 ms** |
| trailside | 17.79 / 17.93, −0.14 ms | 20.54 / 20.20, +0.34 ms | **+0.10 ms** |

At native the branch costs a fraction of a millisecond on both views — the
4× trailside figure scaled down by the pixel count, as section 4 expected.

The p95 bar of 17.5 ms is **not met by either build**: p95 ran 21.5–25.2 ms
on the branch and 21.6–24.9 ms on the control, with means of 18–20 ms. The
control is current `main`, so at these views, on this machine with another
browser active, `main` itself is over the line before this work is added.
The branch moves p95 by −0.1 to +1.1 ms across the four pairs. That bar is a
statement about the game's total budget, and this note cannot close it; it
is recorded as a pre-existing miss to be measured on a quiet machine, not
as a cost of the trail.

## 6. Fallbacks

None taken. The drift and wash-out bands, `CLUTTER_DUFF_BED_MAX` and the
encroachment floor are all at their design values.

## 7. Gaps

- The drifts' litter pieces are invisible for the reason in section 3; the
  paired stills therefore verify the paint and the pebble litter, not the
  design's "a painted drift has pieces lying on it" as it will finally look.
- Numeric agreement between the shader's wash-out noise and its TypeScript
  mirror is not provable in the test suite, which cannot execute GLSL; the
  tests pin the literals, and the stills are the check that the wash-outs
  land where the mirror says.
