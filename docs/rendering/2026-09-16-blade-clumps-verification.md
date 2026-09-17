# Blade clumps near the eye: verification

**Spec:** [2026-09-16-blade-clumps-design](2026-09-16-blade-clumps-design.md). **Plan:** [2026-09-16-blade-clumps-plan](2026-09-16-blade-clumps-plan.md).

## Tests

`npm test`'s three roots, all green: client 156 files / 1,888 tests, server 6 files / 92 tests,
tools 8 files / 70 tests. New: `bladeClump.test.ts` (9), and the blade cases in
`clutterField.test.ts` (6), `foliagePlugin.test.ts` (two new cases, three existing cases
extended), `clutterMeshes.test.ts` (5), `post.test.ts` (2).

## Browser gates

The branch merged after `dd8c6fb` against control `dd8c6fb` (the branch base), same seed
(`atmo`), weather and hour on both.

| Gate | Result |
| --- | --- |
| Stills at MEADOW, EDGE, TRAIL, DEEP, noon and 16 h; rain on the trail | PASS. The near field is full, splayed blade clumps that match the card's height; the trail's blades splay beside the bench; DEEP has no meadow and is unchanged. One seam noted: beyond 12 m the meadow cards read darker than the blades because the card texture reads dark once minified (see the spec's amendments). |
| The hand-off: floor crop across 7.5–12 m; two stills 3 m apart; the `/wind 100` strip | PASS. No pop between the two crops; blades and cards lean with the one wind. |
| Frame pairs, high tier native, all four poses, both orders, p95 | At 3× pixels: meadow control 16.67 ms (on the vsync cap) against the branch's 22.0–25.0 ms; edge 21.9 against 26.5–28.4 ms; deep (no meadow, so MSAA alone) 24.9 against 28.4–29.1 ms. Both orders agree within 0.4 ms. |
| Frame pairs, medium tier native, MEADOW and DEEP | At 4× pixels: meadow 33.7 against 41.2 ms; deep 37.1 against 41.1 ms. |
| Low tier sanity pair at MEADOW | At 4× pixels: 30.9 against 30.8 ms, unchanged. |
| Console errors, both builds, both paths | Zero on all 26 gate pages; the scene pass reports 4 samples on every branch page. |

Fill-bound costs scale with the pixel count: at native resolution the package costs about
0.9 ms for the multisampling and 1.0–1.5 ms for the blades with shadow receiving at the meadow,
on hardware whose native frame there runs about 6 ms. The fill saving expected from replacing
cards with opaque blades did not appear, because the cards inside 7.5 m still run their vertex
work and early discard while the clumps add opaque fill on top. The fallbacks if a target GPU
objects are `MSAA_SAMPLES` to 2, `BLADE_COUNT` to 28 and `BLADE_RADIUS` to 10, one constant
each.

## Retunes

- `BLADE_COUNT` 24 → 40: 24 thin blades per cell read as sparse wisps against the cards' dense
  tufts.
- `BLADE_HEIGHT` [0.35, 0.6] → [0.2, 0.45] m: the card model is 0.35 m tall; the hand-off needs
  matching heights.
- `BLADE_WIDTH` 0.02 → 0.012 m: it is a half-width, so 0.02 drew 4 cm reeds.
- `BLADE_DROOP` [0.1, 0.5] → [0.3, 0.9] rad: straight blades read as reeds; a stronger
  parabolic droop splays the clump.
- `BLADE_ROUND` 0.5 → 0.3 rad: the full roll gave every blade a black side under a side-lit
  sun.
- `BLADE_TIP_TINT` (1.05, 1.0, 0.8) → (0.95, 0.95, 0.75) and `BLADE_LUMA` 0.2 → 0.3: the tips
  read too pale; more per-blade variation reads better.
- The foliage profile gained `normalUp` (1.0 for the blades; 0 for every card profile).
- The blade mesh receives shadows (never casts): under the canopy an unshadowed clump glowed
  against a shadowed floor.
