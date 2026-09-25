# Floor look: a tan leaf carpet and a trail of earth

The forest floor and the trail are both in the game now — the litter is
leaf-sized and dense enough to see, the trail is drifted over and washed
out — but neither looks like the reference photographs the look is judged
against. Under the canopy the floor paint is near-black and the leaf
pieces are too red, so the carpet reads as dark rust on a black ground
instead of the pale tan and brown carpet of a real hardwood floor. On the
trail, the bed is a pale grey gravel band 1.5–2.5× brighter than the
ground beside it; in the photographs the trail is packed earth of the same
hue family as its surroundings, at 0.8–1.4× their brightness, with no
gravel texture at all. An abandoned trail blends in; this one sticks out.

This design moves colour and one material mix. No geometry, no field, no
`sim/` change, no level-id move.

## 1. Rulings

| question | ruling |
| --- | --- |
| Reference | The four photographs the direction gave: two hardwood-canopy trails (a continuous tan/rust leaf carpet, the trail as packed brown earth), a coastal grassland trail and a subalpine one (a smooth dirt ribbon, darker or lighter than the grass by at most ~30 %, soft edges) |
| Leaf colour | Hue first, then brightness: leaf pieces go from red-brown (g/r 0.48 in linear) to tan (g/r ≈ 0.67, b/r ≈ 0.35), the photographs' litter in linear terms |
| Floor paint | The canopy floor paint lifts ~1.5× to the photographs' litter floor — linear ≈ (0.15, 0.10, 0.06) — and no further; the paint carries the carpet, the pieces add relief |
| Trail bed | Earth, not gravel: the bed's texture becomes the forest-floor texture at 70 % over the pebble texture, and the bed takes 80 % of the bank's shade instead of 60 %, so it wears the colour of whatever it runs through |
| Trail brightness | Bed / beside luminance ratio in the range 0.9–1.3 in every still, measured on the linear render; today 1.5–2.5 |
| Readability | The core stays traceable in every still — the neglect design's rule holds; earth is not invisibility |
| Cost | No new per-fragment work: one extra `mix` on a texture already sampled. 4× pixel pairs at TRAIL and TRAILSIDE within noise |

## 2. Goals and non-goals

Goals:

- Under the canopy: a continuous carpet in tans, rusts and browns on a
  mid-brown floor, never black, never sparse — side by side with the two
  canopy photographs it reads as the same kind of floor.
- The trail: an earth ribbon in the hue of its surroundings, 0.9–1.3× their
  brightness, no gravel texture, soft edges from the encroachment that
  already exists.
- The meadow trail: the same earth, darker than the grass beside it by the
  same rule.

Non-goals:

- Leaf shape (the lobed profile is a follow-up), litter density, reach or
  the clump budget — all as shipped.
- The trail's geometry, its bench, its drifts and wash-outs — the neglect
  design's mechanisms stay; only their colours move.
- Anything under `sim/`.

## 3. Changes

### 3.1 Leaves and the floor paint (`duffClump.ts`, `terrainSurface.ts`)

- `DUFF_CHARACTERS` leaf tint `(1.15, 0.80, 0.45)` → `(1.05, 1.05, 0.90)`,
  spread 0.3 kept. With `DUFF_ALBEDO` (0.16, 0.11, 0.06) that is a leaf of
  (0.17, 0.12, 0.05): g/r 0.69, b/r 0.32 — the photographs' litter. The
  twig tint `(1.0, 0.85, 0.65)` and the branch tint stay: they are the
  darker wood in the carpet.
- `NEEDLE_BED` (0.10, 0.07, 0.04) → `(0.15, 0.105, 0.06)`: the same hue,
  1.5× the luminance, the photographs' floor. `FOREST_FLOOR` (0.11, 0.09,
  0.06) is the open forest's ground and stays; the litter paint mixes
  between the two by canopy as before.
- `foliagePlugin.ts` `DUFF` profile `groundTint` 0.7 → 0.5: pieces were
  pulled 70 % toward a near-black floor; on the lifted floor half is enough
  to seat them.
- `TRAIL_DRIFT_TINT` is derived from `NEEDLE_BED` at a fixed luminance, so
  the drifts on the trail keep their brightness and take the new hue with
  no change of their own.

### 3.2 The trail as earth (`trailPaint.ts`, `trailBenchParams.ts`)

- A new constant `TRAIL_BED_EARTH = 0.7`: the bed texture becomes
  `mix(tGravelTex, tFloorTex, TRAIL_BED_EARTH)` for the core and margin
  colours. Both textures are already sampled for the bank and the drifts,
  so this is one `mix` per fragment inside the trail and nothing outside
  it. The pebble texture survives at 30 % as the grit in the earth.
- `TRAIL_BENCH_SHADE` 0.6 → 0.8: the bed takes 80 % of the bank's shade
  (the ground colour it runs through), so under the canopy the earth is
  brown and in the meadow it is tan.
- `TRAIL_CORE_GAIN` 0.45 → 0.32 and `TRAIL_MARGIN_GAIN` 0.75 → 0.55: the
  bed's own brightness comes down to where the ratio gate says it belongs;
  these two are the tuning levers if the first measurement misses, and
  the plan's gate task may move them within ±0.08 to land the range.
- `TRAIL_WASH_DARK` 0.7 → 0.55: wash-outs read as pale sand today; darker,
  they read as bare earth the drift has left.
- `TRAIL_TRAMPLE_TINT` and the trample frame are untouched.

## 4. Tests

- `duffClump.test.ts`: the leaf character's tint pinned as literals; the
  leaf albedo's g/r within [0.6, 0.8] and b/r within [0.25, 0.45].
- `terrainSurface.test.ts`: `NEEDLE_BED` pinned; the litter paint under
  full canopy at full duff has luminance ≥ 1.4× the previous value (a
  literal 0.0742 → ≥ 0.104) and ≤ 0.13.
- `trailPaint.test.ts`: `plugin.getCustomCode` carries the earth mix with
  the literal 0.7 in both the core and the margin colour lines; the bench
  shade literal 0.8; the gains as literals.
- `duffMeshes.test.ts`: the litter profile's `groundTint` pinned at 0.5.
- The level-id pin (`groundGradient.test.ts`) unchanged.

## 5. Gates

Paired stills, `main` against the branch, seed `atmo` clear noon and seed
`ypeqauxk`, at the canopy litter pose, the meadow trail pose and the
canopy trail pose. For each trail still, the bed / beside luminance ratio
is measured on the linear render (mean of a bed crop over a beside crop,
both on the same side of the sun) and must land in 0.9–1.3; the core must
be traceable; and the canopy stills are laid beside the two canopy
photographs in one image for the look call. Frame: 4× pixel pairs at TRAIL
and TRAILSIDE within noise (≤ +0.3 ms).

If the ratio misses: gains first (±0.08), then `TRAIL_BENCH_SHADE` (0.8 →
0.9), never the textures.

## 6. Follow-ups

- The leaf's lobed profile.
- Leaves lying on the trail itself, as the canopy photographs show (the
  drift mechanism carries paint only; pieces on the bed are a field change).

## 7. Amendment (2026-09-24, after the first gate)

The first stills (`2026-09-24-floor-look-verification.md`) missed the ratio
gate in both directions: canopy beds 0.63–0.86, meadow beds 1.38–1.46. The
two ends move for different reasons, and the levers §5 allowed move every
bed by the same factor, so no permitted retune could close both. Two
mechanisms, two levers of their own:

- **The canopy beds are mostly drift.** Under the canopy the litter drift
  covers most of the bed, and the drift's brightness is pinned by
  `TRAIL_DRIFT_LUM` — so when §3.1 lifted the floor paint 1.5× the ground
  beside the bed rose and the bed did not. §3.1's claim that the drifts
  "keep their brightness" was the wrong call: a drift is the same litter as
  the floor beside it and must rise with it. `TRAIL_DRIFT_LUM` 0.5154 →
  0.77 (×1.5, the floor's own lift).
- **The meadow beds still read as cobbles.** The colour mix of §3.2 left the
  bed's relief — its normal map, ambient occlusion and roughness — on the
  pebble texture, so the cobble mosaic still shades as cobbles under a
  brown tint. The same `TRAIL_BED_EARTH` share now mixes the normal
  (`tGravelN` → `tFloorN`), the RAH occlusion and the roughness toward the
  floor texture's, so the bed's relief is earth too. And the open end's
  brightness comes down by the allowance §5 named: `TRAIL_CORE_GAIN` 0.32 →
  0.24, `TRAIL_MARGIN_GAIN` 0.55 → 0.47.

The gate stands as written; the measurement is repeated at the same crops.
The canopy floor's other miss — the carpet reads sparse and the pieces dark
against the photographs — is a lighting and density matter (the canopy shade
on the ground, the litter's 15 % coverage) outside this design; it is
recorded for the next one.
