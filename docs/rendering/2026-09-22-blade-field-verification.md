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

The near field should not read as a different material from the distance. The
measure is the mean colour of a band near the bottom of the frame against one
a third of the way up, at eye level in open meadow, with the near/far ratio of
the green channel as the single number.

With the sun pinned identically across every rung:

| `BLADE_ALBEDO` | near | far | near / far |
| --- | --- | --- | --- |
| 0.30 | (117, 122, 89) | (80, 85, 77) | 1.44 |
| 0.22 | (111, 116, 84) | (79, 85, 76) | 1.36 |
| **0.16 (shipped)** | **(106, 111, 81)** | (79, 84, 76) | **1.32** |
| 0.075 | (97, 102, 75) | (78, 83, 76) | 1.23 |
| the shipped game, same spot | (101, 106, 80) | (74, 79, 74) | 1.34 |

The ratio keeps improving below 0.16, and that is a trap rather than a result:
past that point the blades are going dark and the ratio closes because the
pale ground between them is what the band measures. The near field reads as
soil, not grass, while the number says the colours match. 0.16 puts the near
field on the same brightness the game already shipped and still beats its
near/far ratio, with the grass still reading as grass.

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

## 5. Known gaps

These were not measured and are open:

- Stills at the forest edge, on the trail, deep in the woods and trailside, and
  under the 16:00, mist and rain conditions. Only the meadow was shot.
- The three hand-off walks across the tier seams.
- Frame pairs at reduced hardware scaling, on the medium tier, and on low.
- Coverage where the grass gate falls between 0.025 and 0.05: the meadow's near
  cards are unfilled there while the field's own strength floor draws nothing,
  and meadow density can run to twice the grass density inside a flat. If a
  bare band shows up in that range, the fix is to floor on the meadow gate or
  to lower the field's floor.
