# Ground cover: verification

What was measured against the ground-cover design before it shipped, how, and
what the numbers were, in the format of
[`2026-09-22-blade-field-verification.md`](2026-09-22-blade-field-verification.md).
The design is in
[`2026-09-23-ground-cover-design.md`](2026-09-23-ground-cover-design.md); its
gates are section 9.

## 1. Method

Frame-time readings come from 4× pixel ratio on the high tier, against a
control build at current `main`. Each view got six samples per build,
interleaved rather than run as two separate blocks: a fresh page per sample,
every game page blanked before the next one loads, 8 s of sampling after a
3 s warm-up, and the leading build alternated from one pair to the next. That
alternation matters on its own: a sibling branch's run earlier in this same
series of world-richness gates showed the *last* sample of a run reading
systematically slow, which — if the two builds were run back to back rather
than interleaved — loads the whole delta onto whichever build happens to go
last. Interleaving with the lead alternated is what keeps that skew out of
the number.

## 2. Frame time

The bar: no more than +2.0 ms at 4× pixels against current `main`
(`14bd4fc`, which already includes the shipped rock relief), at MEADOW
(the interior boost's worst case), DEEP (duff's worst case) and TRAILSIDE.

Six interleaved pairs per view, deltas as branch − control:

| view | per-pair deltas (ms) | median |
| --- | --- | --- |
| meadow | +0.24, +1.99, +14.79, −1.62, +2.41, +1.73 | **+1.86 ms** |
| deep | +5.23, −1.51, +5.95, −6.35, +0.67, +2.68 | **+1.68 ms** |
| trailside | −2.14, −1.07, −0.40, +17.57, −0.45, +1.23 | **−0.43 ms** |

All three medians sit inside the +2.0 ms bar, but the margin is smaller than
the scatter around it: individual pairs range from −6.35 ms to +17.57 ms, and
several samples in every view show p95 spikes near 100 ms that hit both
builds alike, not just one — a sign of a machine under load rather than a
per-build cost. The median is the only one of these numbers worth reading as
"the cost of this work"; a mean would be pulled around by whichever outlier
landed in that run's six samples, and is not reported here for that reason.

No fallback (design section 10) was needed: every view's median already
clears the bar without lowering `BOOST`, shortening duff's reach, or widening
the thin band further.

## 3. Native resolution and p95

Native p95 is **owed, not passed**. An attempt at 1× pixels swung both builds
between 17 and 47 fps, and at the deep pose the *control* — not the branch —
came out worst of all, at 59.3 ms mean and 78.7 ms p95: a contended machine,
not a result about either build, so it is not reported as one.

The attempt also surfaced a tier mismatch worth recording rather than
papering over: this gate ran the high tier by request, but the game's own
tier hook reads `navigator.deviceMemory`, which Chrome caps at 8 GB
regardless of the machine's real memory, and that cap lands the automatic
tier choice on **medium** here. "Native at high" is accordingly a condition
no player on this hardware actually meets by default; a native p95 reading
still owed here has to be taken at the tier the machine actually selects, not
the one the 4× gate above was run at.

## 4. Stills

§ **Meadow interior, clear noon and mist — the boost.** Not yet measured. No
before/after still exists yet at this pose under either condition, and no
blade or duff clump count has been read off it.

§ **A meadow edge running to sand, and one running to the trail — the
thinning, with no contour.** Not yet measured under either condition. These
are the two edge kinds the continuity test covers numerically; a visual
still confirming the same continuity at the eye has not been taken.

§ **The forest floor under canopy, clear noon and mist — duff fullness,
geometry and paint agreeing.** Not yet measured. This is the pose the design
calls DEEP's worst case for duff; the frame-time number above was read at
this pose, but no still or clump count was taken alongside it.

§ **Last week's seam pose, clear noon and mist — the far cards' density
moving with the near field.** Not yet measured. This is the pose the blade
field's own verification note (section 7) already logged as an open gap
before this work; it is still open.

§ **Blade and duff clump counts at each of the above.** Not yet measured, for
the same reason as the stills themselves: no page was driven to read them
off.

## 5. Known gaps

- The native p95 reading (section 3): both the contended-machine attempt and
  the tier mismatch it surfaced need a repeat on a quiet machine, at the
  tier that machine's own hook actually selects.
- Every still and clump count in section 4.
- The three hand-off walks and the medium- and low-tier frame gates, carried
  over as open from the blade field's own verification note and still open
  here.
