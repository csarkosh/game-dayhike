# The blade field: design

**Status:** design, ruled 2026-09-22. Implementation plan to follow.

**What this is.** The fourth pass of the grass series, after the grass floor
([2026-09-16-grass-floor-design](2026-09-16-grass-floor-design.md)), the trail bench
([2026-09-16-trail-bench-design](2026-09-16-trail-bench-design.md)) and the blade clumps
([2026-09-16-blade-clumps-design](2026-09-16-blade-clumps-design.md)), all shipped. The blade
clumps put real blade geometry inside 12 m, but only where a meadow-lattice instance stands,
40 dark blades per clump: walking toward a hillside, the wide dark cards beyond 12 m become thin
clumps on a quarter-occupied lattice and the grass reads as vanishing. This document replaces
that placement with a near field of its own: dense blade grass wherever the ground is grass,
continuous rather than a coin flip per cell, in three distance tiers, of several characters
with wildflowers among them, coloured like a meadow, handing off to the cards at the carpet's
own 18 m seam.

Renderer-only: no sim change, no level id. Every value is a starting point; the browser gates
tune them and the tests pin the shapes.

## 1. Rulings

| Question | Ruling |
| --- | --- |
| Where does the dense grass appear? | Wherever the floor is grass: a near-field lattice gated by the sim's own grass gate (`clutterDensity(seed, CLUTTER_GRASS, x, z)`, read-only). Dense on meadows, fields and roadsides; short and thin under canopy; absent on rock, sand, the trail bed and above the grass line. |
| How is a thin spot drawn? | Continuously: a cell's gate sets how much grass it draws (blade count and height), not whether it draws. Only cells under a small floor draw nothing. |
| Colour | A real meadow green, base albedo (0.30, 0.40, 0.12), darker roots, paler yellower tips, per-blade and per-cell variation; the weather and hour grade still mute it. |
| Character and height | Shin-high, mixed: 0.2–0.45 m fine grass, taller tussocks with seed heads, short broad-leaf weeds, and flower-bearing clumps with wildflower heads. |
| Budget | At most +2 ms native at the meadow over the shipped build on the high tier, paired both orders; medium draws the same tiers with fewer blades; low keeps the cards. |
| The far cards | The coarse tier runs to the carpet's own 18 m seam, so the dark far cards begin where they are a few pixels tall. The card textures are untouched. |
| Placement architecture | A near-field blade lattice of its own (a `clutterField.ts`-style walk), not the meadow lattice and not GPU-placed sheets. |

## 2. Goals and non-goals

**Goals.**

- Inside 18 m, on grassy ground, the field reads as a continuous sward: fine grass with
  tussocks, weeds and wildflowers, shin-high, no bare lattice gaps, thinner and shorter where
  the ground's gate is low, gone where it is zero.
- Nothing pops: three geometric hand-offs (fine → mid → coarse → cards) over bands where the
  inner tier's blades collapse and the outer tier's grow.
- The near field costs at most +2 ms native at the meadow on high.
- One wind, the trample band, the canopy shade and the sun-only translucency carry over
  unchanged.

**Non-goals.** Blades on the low tier; any change to the card models or their textures;
any sim or level-id change; GPU-driven placement; trampling memory; flowers as a new sim class
(the existing flower cards keep their lattice beyond the blade reach).

## 3. Architecture

| File | Role |
| --- | --- |
| `client/src/game/bladeField.ts` (new, Babylon-free) | The near-field lattice walk: cells within the reach, each with its gate strength, terrain sample, trail distance, character and hash; tier membership with hand-off duplication; a memoising collector on its own 1 m rebuild cadence. |
| `client/src/game/bladeClump.ts` | Grows from one clump to a table of characters × tiers: `bladeClumpGeometry(character, tier)`, the tip features (seed head, flower head, leaf), the per-tier blade counts by quality tier, `bladeAlive` with the grow-in. |
| `client/src/game/bladeMeshes.ts` (new) | The Babylon shell: three tier meshes per character set, one material per tier, the buckets, the fill from the field, dispose. Split out of `clutterMeshes.ts`, which loses its blade bucket and keeps the cards. |
| `client/src/game/clutterMeshes.ts`, `clutterField.ts` | Remove the blade bucket, `createBladeMesh`, the `blades` list, `bladeReach`, `BLADE_RADIUS` and `BLADE_PAD` (the field owns placement now); the meadow near card bucket is not filled on tiers that draw blades; the grass class's near cards take an in-band at the outer hand-off. |
| `client/src/game/foliagePlugin.ts`, `shaders/foliage.vertex.fx`, `foliageWorldPos.vertex.fx` | `foliageEdges` becomes four edges for the blades profile (grow-in start/end, collapse start/end); the collapse multiplies a grow-in term; the strength-driven per-blade hiding. |
| `client/src/game/renderer.ts` | Creates the blade meshes on high and medium with the tier's counts, updates them every frame (they rebuild on their own 1 m crossing). |
| `ARCHITECTURE.md` | The rendering paragraph's blade sentence is rewritten for the field. |

Nothing touches `sim/`, `windParams.ts`, the distance-fade plugin, the fragment stage of the
foliage plugin, or any asset.

## 4. The blade field

**The lattice.** Cells of `BLADE_CELL = 0.5` m on a fixed world grid (cell indices `ci, cj`),
walked around the eye out to `BLADE_REACH = 18` m (the meadow's near/far split,
`CLUTTER_RADII[CLUTTER_MEADOW] · CLUTTER_FAR_SPLIT`, asserted equal) plus the pad below. The
walk is `clutterField.ts`'s: the cell square circumscribing the disc, squared distances from
a snapped origin, a memoising collector keyed by cell.

**The rebuild cadence.** The field rebuilds on every `BLADE_REBUILD_CELL = 1` m crossing of the
eye (not the clutter's 3 m), so the stale-origin offset between rebuilds is at most
`BLADE_PAD = √2·(1 + 0.5) ≈ 2.1` m and a tier's clumps past its edge — collapsed, costing
vertices only — stay few. The collector's per-cell memo makes the extra rebuilds cheap: a
1 m crossing samples about 2·π·18·1/0.25 ≈ 450 new cells and reuses the rest.

**The cell record.** For each lattice point the walk samples, once and memoised:

- `strength = clutterDensity(seed, CLUTTER_GRASS, x, z)` in [0, 1] — the sim's grass gate:
  altitude, slope, canopy, road, trail clearing and patch noise. Cells with
  `strength < BLADE_STRENGTH_FLOOR = 0.05` emit nothing.
- the terrain sample (`groundH`, `groundDx`, `groundDz`) from the active variant;
- the trail distance `rt` (Infinity without a trail) for the trample frame;
- the canopy `forestDensity(seed, x, z)` for the shade and the height;
- a per-cell hash `latticeHash(ci, cj)` → jitter inside the cell (±0.4 · cell), yaw, character,
  luma.

`BladeCell = { x, z, groundH, groundDx, groundDz, strength, canopy, rt, character, hash }`.

**Continuous density.** The strength is written per instance (a second per-instance vec4
beside `foliage`, `bladeCell = (strength, heightScale, cellLuma, characterTint)`), and the
shader hides every blade whose random exceeds the strength (`alive *= step(random, strength)`
folded into the collapse), so a cell at 0.25 draws a quarter of its blades at
`heightScale = mix(0.5, 1, strength)`. One mesh per tier serves every strength; the field
never chooses presence by a coin flip.

**Characters by hash.** Weights by strength: fine grass 60 %, tussock 20 %, weed 12 %,
flower-bearing 8 %, the flower share applying only above `strength > 0.5` (its share goes to
fine grass below). The character is a small integer in the cell record and selects the tier
meshes' bucket.

**Tiers and bands.** Three tiers by distance from the snapped origin:

| tier | draws | hand-off band (true eye distance) |
| --- | --- | --- |
| fine | 0 – `BLADE_TIER_EDGE[0] = 4` m | fine collapses / mid grows over [2.5, 4] |
| mid | 4 – `BLADE_TIER_EDGE[1] = 8` m | mid collapses / coarse grows over [6.5, 8] |
| coarse | 8 – `BLADE_REACH = 18` m | coarse collapses / cards dither in over [13.5, 18] |

A cell inside a band, padded by `BLADE_PAD`, is emitted to both tiers, as the clutter seam
duplicates. Each list is sorted nearest-first. Every band is at least `BLADE_PAD` wide; the
outer band equals the meadow's `clutterSeamEdges` so the cards' dither-in and the coarse
tier's collapse share one pair of numbers.

## 5. The clump meshes

`bladeClumpGeometry(character, tier)` builds one mesh from a `BladeCharacter` and a
`BladeTierCounts` entry. The strip generator is the shipped one (rings plus a tip, rolled
normals, root/random/height attribute) with `BLADE_RINGS = 3` (7 vertices, 5 triangles per
blade) and a tip feature switch.

| character | blades (high: fine / mid / coarse) | height (m) | half-width | droop (rad) | tip | tint |
| --- | --- | --- | --- | --- | --- | --- |
| fine grass | 100 / 40 / 16 | 0.2 – 0.45 | 0.010 | 0.3 – 0.9 | none | (1, 1, 1) |
| tussock | 80 / 28 / 12 | 0.35 – 0.5 | 0.008 | 0.2 – 0.6 | seed head: a 3 cm diamond quad at the tip, straw (1.1, 1.0, 0.7) | (1.05, 1.0, 0.85) |
| broad-leaf weed | 12 / 8 / 4 | 0.15 – 0.25 | 0.030 | 0.6 – 1.1 | none (the wide leaf is the strip) | (0.8, 0.9, 1.0) |
| flower-bearing | 100 / 32 / 12 fine blades + 1–3 heads | as fine grass; heads at 0.3 – 0.45 | 0.010; stem 0.003 | as fine grass | flower head: a 5-quad rosette 3–4 cm across on a stem | head colour from `FLOWER_PALETTE` = white (1.0, 1.0, 0.95), yellow (1.0, 0.9, 0.3), violet (0.6, 0.45, 0.9), red (0.9, 0.25, 0.2), by hash |

Medium tier counts are half of high's, rounded (60 / 20 / 8 for fine grass and so on);
`BLADE_TIER_COUNTS[qualityTier][character][tier]` is one table. The roots lie on a disc of
`BLADE_CLUMP_RADIUS = 0.35` m so neighbouring clumps on the 0.5 m lattice overlap slightly.

**Vertex colour** carries root-to-tip (`(1, 1, 1)` at the root to `BLADE_TIP_TINT
= (0.95, 0.95, 0.75)` at the tip), the per-blade luma spread `BLADE_LUMA = 0.3`, and the
character tint; the seed heads and flower heads carry their own colour. The `bladeCell`
attribute's `cellLuma` (±10 % by hash) breaks the lattice's regularity per cell in the
shader.

**Material** per tier: opaque `PBRMaterial`, `albedoColor = BLADE_ALBEDO = (0.30, 0.40, 0.12)`,
metallic 0, roughness 0.8, two-sided, no texture, no alpha, never the distance-fade plugin;
`receiveShadows = true` on every tier mesh; casts nothing.

**Budget as a test.** `BLADE_VERTEX_BUDGET = 1_000_000`: the test computes, for the high tier
at full strength, the clumps per tier from the reach and pad (fine π·(4+2.1)²/0.25, mid the
annulus to 8+2.1, coarse the annulus to 18+2.1) times the fine-grass vertices per clump and
asserts the sum is under the budget (about 0.98 M at the starting counts: fine 467 clumps ×
700, mid 815 × 280, coarse 3,795 × 112). A retune that doubles the field fails in the suite
before it reaches a browser.

## 6. The hand-offs in the shader

The blades profile's `foliageEdges` becomes a `vec4` `(inStart, inEnd, outStart, outEnd)`:

```
grow  = smoothstep(inStart, inEnd, dist)        // 0 inside inStart, 1 past inEnd
thin  = smoothstep(outStart, outEnd, dist)      // 0 inside outStart, 1 past outEnd
aliveIn  = clamp((random − (1 − grow)·(1 + SOFT)) / SOFT + 1, 0, 1)
aliveOut = clamp((random − thin·(1 + SOFT)) / SOFT + 1, 0, 1)
alive = aliveIn · aliveOut · step(random, strength)
worldPos = root + (worldPos − root) · alive
```

with `FOLIAGE_BLADE_SOFT = 0.15` as shipped. The fine tier has no in-band
(`inStart, inEnd` = the no-op pair, as `FADE_NONE_IN`); the coarse tier's out-band is the
meadow seam. Because both tiers hide blades in the order of the same per-blade random and
the same per-cell strength, the density across a band is the inner tier's survivors plus the
outer tier's arrivals, which sum to one clump's worth at every distance. The root is still
taken through `finalWorld` with no displacement and the collapse is still the block's last
displacement. `bladeAlive(random, strength, grow, thin)` in `bladeClump.ts` mirrors it.

The card side: the meadow's near card bucket is not filled on high and medium (every one of
its instances lies inside the blade reach, so its fill would be pure waste); the meadow's far
bucket dithers in over the seam as today. The grass class's near cards (the 3 m lattice) get
the in-band `[13.5, 18]` on those tiers, their far cards are unchanged. On low, nothing here
changes.

## 7. Shading, wind, trample, shadows

- Each tier material attaches the foliage plugin with the `BLADES` profile (`normalUp 1.0`,
  root darkening, ground tint from the `foliage` attribute the field writes exactly as the
  cards' rebuild does, canopy shade, tilt, the five-player bend, one wind) and the
  foliage-light plugin. The fragment stage is untouched.
- The height also follows the canopy: `heightScale *= mix(1, 0.6, canopy)`, so forest-floor
  grass is short as well as thin.
- **Trample:** the field's `rt` feeds `trampleAt(rt)`; the matrix writer applies the height
  scale and the lean about `(az, 0, −ax)` (the trail bench's convention, pinned by its
  matrix-level test) and the stain tint multiplies the ground tint.
- **Shadows:** all three tiers receive; none cast.
- **Wind:** unchanged; flutter is phased per vertex.

## 8. Tiers

| tier | blades | notes |
| --- | --- | --- |
| high | full counts | the +2 ms gate |
| medium | half counts | its own frame pair at the meadow |
| low | none | cards as shipped, including the meadow's near cards |

`createBladeMeshes(scene, seed, { tier })` is called from `renderer.ts` for high and medium
only; its `update(camX, camZ)` runs every frame and rebuilds on its own 1 m crossing.

## 9. Tests

- `bladeField.test.ts`: the cell set is exactly the lattice points within the reach whose
  gate clears the floor (against `clutterDensity` directly); `strength` equals the gate; a cell
  is identical across rebuilds and between the pure walk and the collector; tier membership by
  distance with band duplication; each list nearest-first; the pad property for every eye
  inside a 1 m rebuild cell; `BLADE_REACH` equals the meadow's split and the outer band equals
  `clutterSeamEdges(CLUTTER_MEADOW)`; the character weights by hash at low and high strength.
- `bladeClump.test.ts`: for every character × tier: counts, roots at y = 0 inside the disc,
  heights in range, the tip feature present or absent with its colour, unit normals,
  determinism; the vertex-budget assertion; `bladeAlive` at all four band edges and against the
  strength.
- `foliagePlugin.test.ts`: the four-edge collapse text, its lockstep constants, both shader
  paths with the blades profile; the `bladeCell` attribute declared only under the gate.
- `bladeMeshes.test.ts`: three tier buckets per character on high and medium, none on low;
  matrices carry the trample; the `foliage` and `bladeCell` attributes uploaded; `receiveShadows`
  true on every blade mesh; every blade material carries Foliage and FoliageLight and never
  DistanceFade; dispose frees meshes and materials.
- `clutterMeshes.test.ts`: the meadow near bucket is unfilled on high and medium and filled on
  low; the grass class's near cards carry the in-band on high and medium and none on low;
  no blade bucket remains.
- `architecture.test.ts`: `bladeField.ts` and `bladeClump.ts` Babylon-free.

## 10. Browser gates

Against the shipped build at the branch base, seed `atmo`, the trail-bench rig with the tier
hook: MEADOW, EDGE, TRAIL, DEEP, plus **TRAILSIDE** (263.9, 85.77, 118) yaw 0.6 pitch 0.25
under `weather mist`, the pose that reproduced the report, and any pose reproduced from a
`/snapshot` JSON the owner supplies.

1. **Stills** at noon, 16 h, mist and rain: a continuous sward on grassy ground, thin and
   short under canopy, gone on the trail bed and rock; tussocks, weeds and flowers visible
   near the eye; no lattice regularity; the far cards begin at 18 m.
2. **Hand-offs:** three stills 1.5 m apart across each band; no pop, no density step.
3. **Frame pairs**, both orders, vsync checked, p95: native and 3× on high at all five poses;
   native and 3× on medium at MEADOW and TRAILSIDE; one native pair on low.
4. **Pass bar:** high ≤ +2 ms native at the meadow over the shipped build; medium within its
   own 60 Hz on this machine; low unchanged; zero console errors on both shader paths.

## 11. Fallbacks

Each is one constant.

- Over budget on high: medium's counts for the coarse tier first, then `BLADE_TIER_EDGE[1]`
  8 → 6 m, then the fine tier's counts.
- Medium over 60 Hz: its counts halve again.
- A visible band: widen the band to 2 m by moving its start.
- The field too uniform: raise the cell luma spread and the character weights' hash mixing.
- The flowers too many or too few: the flower share and its strength threshold.

## 12. Follow-ups this design creates

- Brighten the card textures through the pipeline (fill their transparent texels with grass
  colour) so the far cards match the near field; then the far tier can shorten.
- Cards receiving shadows, so the far field under canopy stops glowing.
- A tier with GPU-placed sheets if the vertex budget ever binds.
- Trampling memory for the near field, once a render-target subsystem exists.
