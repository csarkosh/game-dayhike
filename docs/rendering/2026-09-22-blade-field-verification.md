# Blade field: verification

What was measured on the blade field before it shipped, how, and what the
numbers were. The design is in
[`2026-09-22-blade-field-design.md`](2026-09-22-blade-field-design.md).

## 1. Method

Every reading below comes from a fresh page load with the console string
`seed atmo;freecam;weather clear;time 12`, posed through a freecam hook, on
the high tier. Two things about this rig are easy to get wrong and both cost
a wrong conclusion during the work:

- **The world clock keeps running.** `time 12` sets the hour at load and does
  not hold it. Stills taken minutes apart are lit by different suns — readings
  during this work drifted from a noon sun to one on the horizon without the
  build changing. Every colour figure here was taken promptly after a reload
  with the sun's direction and intensity recorded beside it, and only readings
  sharing a sun are compared.
- **Frame-time samples must be paired, both orders.** Unpaired readings drift
  far enough to invert the gate.

## 2. Frame time

The bar: no more than +2 ms native at the meadow on the high tier, against a
control built at the commit the branch starts from.

Native resolution, meadow, high tier, 4 s samples after a 3 s warm-up:

| order | control | branch | delta |
| --- | --- | --- | --- |
| branch first | 33.75 ms | 34.07 ms | +0.32 ms |
| control first | 32.44 ms | 33.66 ms | +1.22 ms |

Mean **+0.77 ms**, inside the bar. The absolute figures are high because the
machine was loaded and the display is retina; both builds pay that baseline
equally, which is why the gate is the delta and not the absolute.

The control already draws the blade clumps this work replaces, so +0.77 ms is
the cost of the wider, denser field over the narrower one it supersedes, not
the cost of blades over bare ground.

## 3. Colour

The near field should not read as a different material from the distance.
The first attempt measured it as the mean colour of a band near the bottom
of the frame against one a third of the way up, with the near/far ratio of
the green channel as the single number, and tuned `BLADE_ALBEDO` against
that. It settled on 0.16 and shipped. It was wrong, for reasons worth
keeping:

- **A band mean measures whatever fills the band.** Driving the albedo
  down kept "improving" the ratio, but only because the blades were going
  dark and the pale ground between them was what the band measured. The
  near field read as soil while the number said the colours matched.
- **The difference is not a brightness.** Isolating layers at one pose,
  cards-only and bare-ground-only came out pixel-identical: up close the
  frame is mostly ground between sparse blades, while the distant band is
  dense cover hiding its ground. The band the player sees as "darker" is
  brighter on every percentile; what the eye tracks is the dark tuft
  silhouettes against fog-brightened ground.
- **A match made at noon opens up in mist.** Under fog the bare ground
  itself brightens from 61 to 88 (green) between 8 m and 20 m, and the
  blades track their own ground within five either way. So a value matched
  under sun is far too dark under mist at the seam, and one matched under
  mist is too light at noon. Even at the exact card albedo the seam did
  not close in fog.

The colour that shipped, (0.03, 0.04, 0.013), was chosen by eye against
the far cards once the hand-off (section 6) was wide enough to hide the
texture change. It is dark; with the band a fade rather than a line, it
reads as continuous with the tufts under both sun and mist.

## 4. Seed heads

Close up, seed heads rendered as flat black triangles scattered over the
sward — debris rather than anything growing. The cause is an interaction
between the geometry and the shading, and it took a bisection to find:

Every strip vertex carries a normal lying flat in the horizontal plane, and
the foliage fragment block only tilts a normal toward up near the root
(`mix(vec3(0,1,0), normalW, vFoliageH)`). Geometry high on a blade therefore
meets an overhead sun edge-on. A blade survives that by being a sliver with
most of its area low down. A seed head sat at about nine tenths of its blade's
height and, at a base width of 2.5 times the blade's, was **wider than it was
long** — a broad face at grazing incidence, which crushes to black.

What ruled out the alternatives, in order: turning on two-sided lighting
changed nothing (so not winding); turning off shadow receiving changed nothing
(so not self-shadowing); a dump of the generated vertices showed correct
positions and straw-coloured vertex colours (so not the generator); hiding the
flower character alone changed nothing (so the seed heads, not the petals);
rendering the material unlit made the black vanish (so purely lighting); and
raising the normal-up bias made it vanish while still lit (so that bias is
live, just too weak to lift an exactly horizontal normal).

The fix is geometric: a head is now 1.2 times its blade's width and 6 cm long
rather than 2.5 times and 3 cm, making it a slender continuation of the blade,
which is what it was always meant to read as. The normal-up bias stays where
it was — raising it to 2 or 3 flattens blade shading and measurably worsens the
near/far ratio (1.32, then 1.34, then 1.35).

With the blades as dark as they now are, even the slender heads read as
dark spikes standing in rings, so the tussock ships with no head at all
(`tip: "none"`). The head geometry and its constants stay for a character
that can carry them.

## 5. The near field went bare

The field shipped with a regression the meadow stills could not show: walking
forward, the ground in front of the player emptied out to a hard line about
fourteen metres away that moved with the player.

The field had taken over the near field on the assumption that inside its
reach the blades are the grass. So the rebuild dropped every meadow near card
outright, and gave the grass near cards a fade that let them dither in only
beyond the meadow's seam. But the field only grows where the sim's grass gate
clears its floor — 8.4 % of the ground on a 6 m grid over 1.2 km square — and
everywhere else both card sets were suppressed and nothing replaced them.

The rule now is that the field may only add cover: a meadow near card is
dropped only where the field actually covers it, and the grass near cards
draw the whole way in. Measured at one pose against the build before the
field, the fixed build draws the same 2,944 card instances plus its 2,320
blade clumps.

Two things about how this got through. The test asserted the bug as a
guarantee — `expect(meadowNear.thinInstanceCount).toBe(0)` — so it passed
review; it now checks that every surviving card sits on uncovered ground. And
the meadow-card half of the fix is close to a no-op: the meadow and grass
gates track each other so nearly that no point on seed 1 has meadow cards the
field does not cover. The grass-card fade was the bug.

## 6. The hand-off reads as a line

With the near field restored, the join between blades and cards showed as a
line across the meadow, brighter or darker than the near field depending on
the weather. Blades and cards are not the same picture of grass — fine
strokes against chunky opaque tufts — and they handed over inside a band
4.2 m wide (13.8–18 m). At a hiker's eye height that band compresses to a
thin strip of screen, so the change of texture read as an edge. Section 3
records why no colour could hide it.

The meadow's near/far seam is the field's hand-off: the coarsest blade tier
thins out across it and the far cards dither in across it, and the collector
already duplicates instances through it. `CLUTTER_BLADE_HANDOFF` opens that
one seam to 10 m (8–18 m) and both sides follow; no other class's seam moved.
At the pose where the line was worst, mist and clear noon both now show tufts
sprinkled into the blades from mid-distance and thickening with distance.

Native frame time, meadow, high, paired both orders across two runs:

| pair | deltas (branch − control) | mean |
| --- | --- | --- |
| 1 | −0.92, +2.39 | +0.73 ms |
| 2 | +1.64, +1.00 | +1.32 ms |

About +1.0 ms against the +2 ms bar — measured with the machine's load
between 8 and 16, so both builds ran near 48 ms and the deltas, though
paired, deserve a repeat on a quiet machine. Density at 3× the shipped counts
gave the fullest near field and cost +3.74 ms; 2× cost +1.86 ms; the shipped
counts are 1×.

## 7. Known gaps

These were not measured and are open:

- Stills at the forest edge, on the trail, deep in the woods and trailside,
  and under the 16:00 and rain conditions. Mist and clear noon were shot at
  the meadow only.
- The three hand-off walks across the tier seams.
- Frame pairs at reduced hardware scaling, on the medium tier, and on low.
- The frame pair on a quiet machine.
