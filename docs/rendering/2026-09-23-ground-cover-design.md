# Ground cover: grass everywhere the floor is grass, litter where it thins

The near field grows grass only where a noise gate says "meadow", so most grass
ground reads as bare floor, and the forest floor under the canopy is bare. This
design makes grass grow wherever the floor is grass, thins it smoothly toward
every non-grass neighbour, thickens it in the open interior, and fills what the
thinning takes away with dead leaves, twigs and small branches — so the ground
reads full everywhere, at one frame budget.

It is the first of four concurrent world-richness sub-projects (ground cover,
the unkempt trail, wildlife on a sighting cadence, rock relief). It owns the
grass gate in `sim/clutter.ts` and the new litter files; the trail sub-project
consumes its litter generator.

## 1. Rulings

| question | ruling |
| --- | --- |
| Where grass grows | Wherever the floor is grass — the `patch` noise stops being a gate |
| Under the canopy | Yes, thinner — and the thinning is paid back with dead leaves, twigs and small branches so the floor reads as full as open grass |
| Where the 3D litter comes from | Built in code from strips and a lattice hash, like the blade clumps; no textures, no asset dependency |
| Density shape | Lighter near non-grass terrain (sand, rock, trail, road, canopy), 1.5–2× denser in the open interior, and every transition smooth |
| Frame budget | The same bar, re-based: +2.0 ms at 4× pixels against current `main`, paired both orders |
| Approach | One ground-cover field in the sim that the blades, the cards and the terrain paint all read |

## 2. Goals and non-goals

Goals:

- Grass wherever the floor is grass, at every distance the cards and blades
  already cover.
- Density that falls smoothly toward every non-grass neighbour and rises in the
  interior, with no visible contour anywhere: not at an edge, not at a tier
  seam, not at a cost trick.
- A forest floor that reads as full as open grass: where blades thin, leaves
  and twigs take their place, in geometry near the eye and in paint everywhere.
- Inside the frame bar, with the fallbacks written down.

Non-goals:

- The trail's own look (dead leaves and needles on the bed, overgrowth, dirt
  patches). That is sub-project 2; it reuses the litter generator here.
- Wildlife, rocks.
- New assets. Everything here is code-built or paint.
- Any change to the low tier's cost. Low draws no blades and no litter; it gets
  the paint coupling only.

## 3. Architecture

| unit | layer | does | reads | read by |
| --- | --- | --- | --- | --- |
| `groundCover` (`sim/clutter.ts`) | sim | the ground-cover field: `{ grass, litter }` in [0, 1] at a point | the terrain sample, forest density, road and trail distance, the patch noise | the grass and meadow classes, the blade field, the litter field, the terrain paint |
| `litterClump.ts` | game | builds twig, branch and leaf-cluster clumps as vertex arrays | a lattice hash | `litterMeshes.ts`, sub-project 2, tests |
| `litterField.ts` | game | walks the litter lattice out to its reach, two tiers, with strength | `groundCover().litter` | `litterMeshes.ts` |
| `litterMeshes.ts` | game | six thin-instance buckets on two tier materials, rebuilt on a cadence, collapsing at the outer band | `litterField`, `litterClump`, the foliage plugin's collapse | the renderer |
| `bladeMeshes.ts` (changed) | game | a thin cell buys a thin clump: bucket by tier and strength band, dithered | `groundCover().grass` via the blade field | — |
| `classifySurface` (`terrainSurface.ts`, changed) | game | the forest-floor paint weight follows `litter` | `groundCover().litter` | the terrain texture plugin |

The dependency direction is unchanged: `game/ → sim/`. `litterClump.ts` imports
nothing from Babylon and nothing from the sim.

## 4. The field

```ts
export function groundCover(seed: number, x: number, z: number, sample?: TerrainSample): { grass: number; litter: number }
```

Replaces `grassGateProduct` as what the grass and meadow classes read; the
meadow class keeps its own lattice and density constant.

- **`edge`** is the product of the five ramps that exist today, unchanged:
  sand altitude, slope, canopy, road distance, trail distance. Each is a
  smoothstep, so `edge` is 1 in the open and falls continuously toward every
  non-grass neighbour. This is the "distance to non-grass" — no distance
  transform is built.
- **`patch`** becomes a modulator: `mix(PATCH_FLOOR, 1, smoothstep(lo, hi, noise))`
  with `PATCH_FLOOR = 0.6`, so the meadow-shaped variation survives but no
  longer switches grass off.
- **`grass = edge · patch · (1 + (BOOST − 1) · smoothstep(0.5, 1, edge))`**,
  `BOOST` 1.5 targeted, 2.0 ceiling, 1.25 floor. The boost engages only where
  every ramp is near 1: a point cannot be both thinned and boosted.
- **`litter = onGrass · (1 − grass / BOOST) · mix(LITTER_OPEN, 1, canopy)`**,
  where `onGrass` is the altitude and slope product (so litter is zero on sand
  and rock), `canopy` is the forest density, and `LITTER_OPEN = 0.15` keeps a
  little litter in thin open grass without covering the interior. Under dense
  canopy, where grass is thinnest, litter is strongest.
- **Fullness** `grass / BOOST + litter` stays within a band wherever `onGrass`
  is near 1 — the test pins the band.
- **Smoothness** is inherited: every term is a product of smoothsteps of
  continuous fields. Nothing decides per cell.

The blade field reads `grass` as its strength exactly as it reads the grass
gate today; `BLADE_STRENGTH_FLOOR` stays. The meadow and grass card densities
follow it, so the far field rises with the near one and the 18 m hand-off stays
matched on both sides.

**Release.** Card placement is part of the deterministic world, so this ships
as a level-id bump through the clutter pass's tunables, as the trail bench did.
A client on an older build cannot join a newer host.

## 5. The litter generator

`litterClump.ts`, Babylon-free, built from the blade clumps' strip generator
and lattice hash. Three characters, one clump each per cell, chosen by the
cell's draw and weighted twig 0.55, leaf cluster 0.35, branch 0.10:

- **Twig** — two or three bent strips, 10–25 cm, half-width 4–6 mm, bark
  brown with per-piece luma spread, lying flat with a slight lift at one end.
- **Small branch** — one thicker strip 30–60 cm with a single fork, half-width
  8–12 mm, darker brown. Rare.
- **Leaf cluster** — four to six lobed flat shapes 4–7 cm across, ochre to
  brown per vertex, lying on the ground with a small random tilt.

Every piece lies within a 0.6 m disc and 12 cm of the ground, tilted to the
ground normal through the `TILTED` path rocks and driftwood already use. The
vertex budget over the reach is a test.

`litterField.ts` walks a 1 m lattice to a 12 m reach on high (8 m on medium),
in two tiers (edge at 6 m, band 1.5 m), reading `litter` as strength with a
0.05 floor; it is the blade field's walk with different constants and no
character-by-strength rule. `litterMeshes.ts` draws six buckets (three
characters × two tiers) on two tier materials, rebuilt on the 1 m cadence, each
piece collapsing to its root across the outer band through the same four-edge
collapse the blades use, so litter never pops. Litter takes no wind.

Sub-project 2 calls `litterClump` with its own strength and palette for the
trail bed's leaves and needles; the interface it depends on is
`litterClumpGeometry(character, count)` and the `LITTER_CHARACTERS` table.

## 6. The paint coupling

`classifySurface` keeps its leaf-litter/grass mottle on gentle ground and
gains one term: the forest-floor weight rises with `groundCover().litter` at
the vertex. Where the field says litter, the floor under the twigs paints as
leaf litter and humus; where it says grass, as grass. The gaps between pieces
then read as full rather than as painted grass with twigs on it.

Needle drifts under conifers are paint only: a darker, browner variant of the
floor weighted by canopy. No needle geometry.

This is the whole of the fullness on the low tier, and what medium degrades to
beyond its 8 m litter reach.

## 7. Tiers and the budget

The bill at 4× pixels against current `main`, bar +2.0 ms:

| item | estimate | basis |
| --- | --- | --- |
| interior boost 1.5× at the meadow | ~+1.1 ms | interpolated from measured 1× +0.52 / 2× +1.77 |
| meadow cards ×1.5 in the far field | +0.2–0.4 ms | cheap alpha-test fill |
| grass on ground that had none | +0.3–0.6 ms | a collapsed blade still runs its vertex shader |
| litter field, 12 m, two tiers | +0.3–0.5 ms | few hundred vertices per clump, canopy only |

That sums past the bar, so the design pays:

- **A cell buys the clump size its cover earns.** `bladeMeshes.ts` chooses a
  cell's bucket by tier *and* a size — thin, base or full — that its own
  cover picks. Below a thin band a cell draws a thinner clump (roughly 0.4×
  the blades), so a nearly bare cell no longer submits a full clump only to
  collapse most of it. Above a full band — inside the interior boost — a
  cell draws a fuller clump instead (1.5× the blades): the boost raises the
  field's own density there, and the third size is what makes that read on
  screen as fuller clumps standing in richer ground, rather than only more
  of the same clump crowding the same spot. A cell inside either band picks
  by comparing its own random against a smoothstep of its cover, so neither
  choice ever forms a visible contour across the field.
- **Coarse counts trimmed:** `BLADE_TIER_COUNTS.high` coarse column
  16/12/4/12 → 10/8/4/8 (the base-size table the sizes above scale). It is
  the tier the 10 m hand-off already fades out.

| tier | blades | litter | paint coupling |
| --- | --- | --- | --- |
| high | full counts, boost per the gate | 12 m, two tiers | yes |
| medium | half counts | 8 m | yes |
| low | none | none | yes — the whole of its fullness |

## 8. Tests

Pure and Babylon-free unless named otherwise.

- **`groundCover`** — continuity: straight lines crossing each edge kind (sand,
  slope, canopy, trail, road) sampled at 0.25 m, the largest step in `grass`
  and in `litter` under `0.06`; fullness: `grass/BOOST + litter` within
  `[0.45, 1.05]` wherever `onGrass > 0.9`; boost only inside: `grass ≤ edge ·
  patch` wherever `edge < 0.5`; litter zero where altitude or slope gate is
  zero; determinism across two runs; census: on seed 1's 6 m grid over 1.2 km
  square, the share of ground at or above `BLADE_STRENGTH_FLOOR` is at least
  35 % (it is 8.4 % today).
- **`litterClump`** — vertex count per character and count; every piece
  inside its disc and height bound; tilt within limit; colours inside the
  palette range; the vertex budget over the reach at full strength.
- **`litterField`** — the walk, the floor, the two tiers, the collector's
  reuse, nearest-first order — the blade field's tests with the litter
  constants.
- **`litterMeshes`** (NullEngine) — six buckets, capacity, the cadence, the
  collapse driven through `bladeAlive`.
- **`bladeMeshes`** — the thin-cell remap is statistically smooth across the
  band: over many cells the mid-clump share rises monotonically and
  continuously with strength, and a mutation that hard-thresholds at 0.5 fails.
- **`classifySurface`** — the floor weight is monotone in `litter`; existing
  expectations updated to the new field.
- **Level id** — the tunables change moves the id.

## 9. Gates

Every still from a fresh load with the sun pinned and recorded; frame pairs on
the repaired rig (every game page blanked before each sample, 8 s samples).

Visual, before/after against `main`, clear noon and mist:

- meadow interior — the boost;
- a meadow edge running to sand and one running to the trail — the thinning,
  with no contour;
- the forest floor under canopy — litter fullness, geometry and paint agreeing;
- last week's seam pose — the far cards' density now moves with the near field;
- blade and litter clump counts at each.

Frame: 4× pixels, paired both orders, two pairs, at MEADOW (boost worst case),
DEEP (litter worst case) and TRAILSIDE, against current `main`, mean ≤ +2.0 ms;
native p95 under 17.5 ms.

## 10. Fallbacks

In order, each a constant: `BOOST` 2 → 1.5 → 1.25; litter reach 12 → 8;
coarse blade counts; the thin band widened. If the litter field alone cannot
fit, it degrades to the paint coupling (section 6) on high as well.

## 11. Concurrency and merge order

This sub-project owns the grass gate in `sim/clutter.ts` and the `litter*`
files. Rock relief and wildlife touch neither and run in parallel from the
start. The trail sub-project consumes `litterClump`, so its spec fixes that
interface now and its run merges after this one.

**Merge order: ground cover → trail; rocks and wildlife at any point.**

## 12. Amendments

Made after the trail's own design settled what it needs from this field, so
the two are built once:

- **Encroachment.** The grass trail ramp's reach varies along the trail: a
  9 m value noise scales the ramp between 0.35 and 1.3 of its default, so in
  places grass (and with it the cards and the duff) creeps across the margin
  and stands in islands on the bed, and elsewhere hangs well back. The inner
  `CLUTTER_GRASS_TRAIL_CORE = 0.35` m never opens, so the path always reads.
  The scale is continuous, so the grass stays continuous.
- **Bed litter.** `duff` gains a bed term: a 6 m drift noise, defined in the
  sim, raises duff on the bed and its margins in drifts, combined with the
  off-bed duff by `max`. The paint reads the same `duff` at the vertex (§6),
  so a painted drift always has pieces lying on it.
- **Naming.** In code the layer is `duff`, because `CLUTTER_LITTER` already
  names the trail-margin pebble class.

## 13. Follow-ups

- Litter that responds to the player: pieces disturbed underfoot, as the grass
  is trampled.
- A mid-tier of litter between 12 m and the fog, as paint density rather than
  geometry, if the far floor reads bare in stills.
- Seasonal palettes for the leaf clusters.
