# The trail as a bench: design

**Status:** design, ruled 2026-09-16. Implementation plan to follow.

**What this is.** The second of three sub-projects that follow the grass grounding and wind pass
([2026-09-15-grass-grounding-and-wind-design](2026-09-15-grass-grounding-and-wind-design.md)):
the grass floor ([2026-09-16-grass-floor-design](2026-09-16-grass-floor-design.md), shipped),
then the trail as a bench, then blade clumps near the eye. This one changes what the hiking trail
is and how it reads. Today it is a flat 3 m band of one pebble texture at one scale, painted
with a ruled edge where the grass simply stops: a gravel road, not a footpath. The research is
in [2026-09-15-grass-and-trail-realism](2026-09-15-grass-and-trail-realism.md) §5 and §8
(package C); this document records the decisions and the design, not the evidence.

It carries the one level-id release of the series: the tread narrows and sinks in the sim, and a
ninth clutter class puts litter along the margin. Everything else is renderer-only. Every value
is a starting point; the browser gates tune them and the tests pin the shapes.

## 1. Rulings

| Question | Ruling |
| --- | --- |
| Does the sim carry the bench? | Yes. The tread narrows to a footpath and sinks 6 cm with a short ramp, so feet, the clipmap and the paint agree. The level id moves once, through the tunables the digest already covers. |
| Where do the litter meshes come from? | Existing models scaled down: `clutter.rock_a`/`rock_b` at pebble scale, `clutter.driftwood` at twig scale. A dedicated model can replace them later without touching the level id. |
| Where do the trail's coordinates live for the paint? | Per fragment from the segment table, as today, with a second row on the same sampler for the along-trail parameter and the junction widths. Not vertex attributes (the 1 m ring cannot resolve a 0.3 m margin), not a mask texture (the terrain material is at its sampler ceiling). |
| Which treatments ship? | The ragged edge, along-length wear, the wet trail with puddles, and the trampled band on the cards. All four. |
| The bank | Today's uphill bank band stays as it is, with the ragged edge applied to it. The bench's face is the sink ramp in the sim plus the lip in the paint; the 1 m clipmap cannot show more. |
| Snow | Unchanged: above the snow line the bed is packed snow and the bank fades with the soil. |

## 2. Goals and non-goals

**Goals.**

- The trail reads as a walked footpath: a dark compacted core about 0.9 m wide, a pale loose
  margin with pebbles and twigs, trampled grass leaning away from it, and full vegetation at a
  ragged boundary.
- It varies along its length: boot-narrow on some stretches, scuffed wide at junctions and the
  trailhead, and darker where it is worn.
- It sits a few centimetres below the turf, with a lip a low sun can draw.
- It goes dark and glossy in rain and mist, with puddles in the low spots.
- Frame time within the 60 Hz contract at the trail and the meadow.

**Non-goals.** New textures or models; a bank taller than the sink ramp; braiding or
side-hill re-routing of the graph; the trail's slope or route (untouched); blade geometry (the
next sub-project).

## 3. Architecture

| File | Role |
| --- | --- |
| `client/src/sim/trail.ts` | `TRAIL_BED_HALF` 1 → 0.75; the sink (`TRAIL_SINK`, `TRAIL_SINK_RAMP`) applied after the corridor blend as a saturating union across edges, with analytic derivatives. Both in `TRAIL_TUNABLES`. |
| `client/src/sim/clutter.ts` | `CLUTTER_GRASS_TRAIL_NEAR/FAR` retuned; the ninth class `CLUTTER_LITTER` with its cell, density, band, salt, scales and `variants: 3`; every constant in `CLUTTER_TUNABLES`. |
| `client/src/game/trailPaint.ts` | The table's second row (`uA, uB, wA, wB` per segment); the band function and its TypeScript mirror; wear, ragged edge, height-aware boundaries, the lip, wetness and puddles in the GLSL. |
| `client/src/game/trailBenchParams.ts` (new, Babylon-free) | The paint's constants and the pure mirrors the tests and the clutter rebuild share: `trailBands(d, u, w, noise, h)`, `trailWear(u)`, `trampleAt(rt)`. On `BABYLON_FREE_FILES`. |
| `client/src/game/terrainTexture.ts` | Uploads the two-row table; binds `terrainWet` from the weather; no new sampler. |
| `client/src/game/renderer.ts` | Feeds the weather's wetness to the terrain plugin each frame, beside the existing wet-surface material scaling. |
| `client/src/game/clutterMeshes.ts` | The trampled band at rebuild for the grass, meadow and flower classes (height scale, lean, stained tint); the litter class's model table and per-variant base scales; litter draws rigid, near band only. |
| `client/src/game/shaders/groundHex.fragment.fx` | Unchanged; the paint calls its `latticeHash` and `macroValueNoise`, which are spliced before the paints. |

## 4. The bench in the sim

**Width.** `TRAIL_BED_HALF = 0.75` m: a 0.9 m compacted core plus a 0.3 m loose margin on each
side is the flat bench the corridor blend already produces. `TRAIL_CORRIDOR_HALF = 7` and every
other trail constant stay as they are; the corridor's shoulder aliasing lesson (2026-09-10)
holds because the blend from the bench edge to plain ground is not shortened.

**Sink.** After `trailCorridorD` has blended the bed, the bench sinks:

```
s_i = 1 − smootherstep(TRAIL_BED_HALF, TRAIL_BED_HALF + TRAIL_SINK_RAMP, d_i)   per edge
S   = 1 − Π(1 − s_i)                                                            union
h   = h_corridor − TRAIL_SINK · S
```

with `TRAIL_SINK = 0.06` m and `TRAIL_SINK_RAMP = 0.5` m, carried with the same analytic
`dx, dz` the corridor returns (`smootherstepD` and `∇d = q/d`, exactly as the weights). The
union is saturating, so a junction sinks once. On a side-hill the uphill half of the ramp is
the bench's face: the ground's own rise over 0.5 m plus the 6 cm. The walk height is this
height, so the player stands on the bench; the clipmap draws it; the paint's lip (§5) bends
the normal over the same ramp.

**The fine check.** The route's walkability check evaluates the composed field along
centrelines at d = 0, where the sink is a constant offset, so slopes there are unchanged and
the seed sweeps stay green by construction. The ramp adds a cross-slope of at most
0.06 / 0.5 = 0.12 at the bench edge, below the hard-slope cap.

**Grass gate.** `CLUTTER_GRASS_TRAIL_NEAR = 0.75`, `CLUTTER_GRASS_TRAIL_FAR = 2.5`: no grass on
the bench, thin grass through the band the renderer tramples (§6), full grass from 2.5 m.
Boulder and fungus clearances are untouched; rocks stay ungated (a rock on the bench reads as
a stone in the path).

**Litter.** `CLUTTER_LITTER = 8`, `CLUTTER_CLASS_COUNT = 9`, cell 1 m, `variants: 3`,
`trailClear: 0`. Its density is a band of the trail distance `rt`, times the same altitude gate
the grass uses below the snow line, and zero above `CLUTTER_GRASS_ALT_HI`:

```
band(rt) = LITTER_CORE                          rt < 0.45          a few proud stones
         = 1                                    0.45 ≤ rt < 0.9    the margin and its lip
         = 1 − smoothstep(0.9, 1.6, rt)         beyond              gone by 1.6 m
```

with `LITTER_CORE = 0.15` and a density constant tuned so the margin carries about one piece
per 1.5 m per side. Scale runs 0.25–0.6 of the model's own unit; the renderer applies a
per-variant base scale (§6). The class is pure per cell like every other, in `sim/`, and its
constants sit in `CLUTTER_TUNABLES`.

**Level id.** `TRAIL_TUNABLES` and `CLUTTER_TUNABLES` feed the pass digest, so the id changes
without touching `GEN_VERSION`. A client on an older build refuses to join a newer host with
the existing level-mismatch message; that is what a level-id release means.

## 5. The paint

**Two coordinates.** The nearest-segment search over the bucketed table is unchanged. The
`trailSegs` texture becomes 512 × 2: row 0 `(ax, az, bx, bz)` as today, row 1
`(uA, uB, wA, wB)`: the two nodes' along-trail parameter `u` (the graph already carries it per
node, so `u` is continuous across every node; a loop has one seam where `u` jumps, which the
wear noise makes into one more change of width) and their width factors, `TRAIL_JUNCTION_W =
1.35` at a node of degree three or more and at the trailhead, 1 elsewhere. The fragment ends
the search with `d` (across), `t` (along the best segment) and reads row 1 once for that
segment: `u = mix(uA, uB, t)`, `wj = mix(wA, wB, t)`. Same sampler, one more fetch.

**Wear.** `wear(u) = 0.6·noise1(u / 12) + 0.4·noise1(u / 3)` in [0, 1], a 1-D value noise on
`latticeHash(cell, 0)` with the smoothstep fade the macro noise uses. It scales the bands and
the core's darkness:

```
widthK = mix(TRAIL_WEAR_W0, TRAIL_WEAR_W1, wear) · wj      (0.8, 1.25)
darkK  = mix(TRAIL_WEAR_D0, TRAIL_WEAR_D1, wear)           (0.85, 1.10)
```

**The ragged edge.** `dN = d + TRAIL_EDGE_NOISE · (2·n(xz) − 1)` with `TRAIL_EDGE_NOISE = 0.25` m
and `n = 0.6·noise2(xz / 1.5) + 0.4·noise2(xz / 0.4)` from `macroValueNoise`. Every band
threshold below reads `dN / widthK`; the bank band reads it too.

**Height-aware boundaries.** The pebble layer's height `hP` (the RAH `.b` the paint already
fetches) shifts each threshold: `dB = dN / widthK − TRAIL_HEIGHT_SHIFT · (hP − 0.5)` with
`TRAIL_HEIGHT_SHIFT = 0.3` (±0.15 m), so a stone breaks through the compacted core and the edge
breaks around the stones.

**Four bands from the centre**, each boundary a smoothstep over `max(0.08, fwidth)`:

| band | `dB` | albedo | relief | roughness |
| --- | --- | --- | --- | --- |
| core | < 0.45 | pebble at `TRAIL_CORE_GAIN = 0.45` under `TRAIL_CORE_TINT = (0.26, 0.22, 0.18) · darkK`, times its AO | gravel normal at 0.5 | pebble layer's |
| margin | 0.45–0.75 | pebble at `TRAIL_MARGIN_GAIN = 0.85` under `TRAIL_MARGIN_TINT = (0.42, 0.37, 0.30)` | gravel normal at 1 | pebble layer's |
| trampled | 0.75–1.35 | the ground blend times `mix(TRAIL_TRAMPLE_TINT, 1, smoothstep(0.75, 1.35, dB))`, `TRAIL_TRAMPLE_TINT = (0.82, 0.78, 0.66)` | the ground's | the ground's |
| beyond | ≥ 1.35 | the ground, and the uphill bank band as today with `dN` in place of `d` | | |

`TRAIL_DIRT_TINT`, `TRAIL_GRAVEL_GAIN` and `TRAIL_PAINT_MARGIN` are retired; `TRAIL_PAINT_EDGE`
becomes the 0.08 m boundary softness. Above the snow line the bands collapse to today's packed
snow.

**The lip.** Over `dN` in `[0.75, 0.75 + TRAIL_SINK_RAMP]` the normal bends outward and down by
the ramp's slope, `atan(TRAIL_SINK / TRAIL_SINK_RAMP)` scaled by the ramp's own derivative, so
a low sun draws the bench edge as a light and dark line even where the 1 m ring cannot show
the step. The sink constants are read from `trail.ts` (renderer reading sim constants is
allowed; the reverse is not).

**Wet.** `terrainWet` is the weather's `wetness` (clear 0, overcast 0.3, mist 0.5, eerie 0.6,
rain 1), bound every frame like the wind. On the core:

```
albedo    *= 1 − TRAIL_WET_DARK · wet             TRAIL_WET_DARK = 0.35
roughness *= 1 − TRAIL_WET_GLOSS · wet            TRAIL_WET_GLOSS = 0.5
puddle     = smoothstep(0.55, 0.8, wet) · smoothstep(0.62, 0.75, 1 − noise2(xz / 6)) · core
albedo     = mix(albedo, albedo · 0.5, puddle);  roughness = mix(roughness, 0.05, puddle);
normal     = mix(normal, up, puddle)
```

The margin takes half the darkening and no puddles. The existing material-wide wet scaling
(`applyWetness`) stays; this is on top of it, on the trail only.

**Cost.** The paint runs only inside the 7 m corridor, as today. Added per corridor fragment:
one table fetch, the 1-D and 2-D lattice noise (about ten hashes) and the band arithmetic;
no new texture fetch beyond the row. The 80–140 m `tk` fade applies to the relief and the
bands' contrast as it does now.

## 6. The tufts and the litter meshes

**Trampled band, at rebuild.** For the grass, meadow and flower classes the clutter rebuild
reads `trailDistance(seed, x, z)` at each card through the terrain variant, and for `rt` in
[0.75, 1.6]:

```
s = smoothstep(0.75, 1.6, rt)
heightScale = mix(TRAMPLE_HEIGHT, 1, s)                 TRAMPLE_HEIGHT = 0.55
lean        = mix(TRAMPLE_LEAN, 0, s)                   TRAMPLE_LEAN = 0.35 rad, away from the bed
tint       *= mix(TRAMPLE_TINT, 1, s)                   TRAMPLE_TINT = (0.85, 0.80, 0.65)
```

The away direction is the finite difference of the trail distance at ±0.25 m; the lean is a
tilt about the horizontal axis perpendicular to it, composed with the card's yaw the way seated
boulders already tilt. The height scale is the instance matrix's y scale; the tint multiplies
the foliage attribute's ground colour. No shader change. `trampleAt(rt)` lives in
`trailBenchParams.ts` so the test pins it.

**Litter meshes.** The litter class draws through the rigid clutter path like rocks: no
foliage plugin, no sway, the distance-fade plugin, near band only (the class's far band is
empty; nothing that small reads past about 40 m). Its model table is
`[rock_a, rock_b, driftwood]` with `LITTER_VARIANT_SCALE = [1, 1, 0.3]` applied on top of the
sim's instance scale, so a pebble is 8–18 cm and a twig 12–27 cm. Each piece sinks the
ordinary `CLUTTER_SINK` to break coplanarity.

## 7. Tests

- `client/test/sim/trail.test.ts` (and `trailBed.test.ts`): the bench height on the
  centreline equals the corridor height minus `TRAIL_SINK`; at `TRAIL_BED_HALF +
  TRAIL_SINK_RAMP` and beyond it equals the corridor height; the analytic `dx, dz` match a
  central difference to 1e-6 across the ramp; two edges meeting at a node sink once (the union
  never exceeds `TRAIL_SINK`); the existing walk scans and seed sweeps stay green;
  `TRAIL_TUNABLES` lists the two new constants.
- `client/test/sim/clutter.test.ts`: the litter density follows `band(rt)` (core value inside
  0.45, 1 over the margin, 0 beyond 1.6); no litter instance above the snow line; `variants`
  is 3; `CLUTTER_CLASS_COUNT` is 9 and every new constant appears in `CLUTTER_TUNABLES`; the
  grass gate is 0 at 0.75 m and 1 at 2.5 m.
- `client/test/sim/forest.test.ts`: the level id differs from the one a pinned pre-release
  tunables digest produces (the id must move).
- `client/test/game/trailBenchParams.test.ts`: `trailWear` is bounded and continuous;
  `trailBands` returns weights that sum to one across `dB`, with the core at 0, the margin at
  0.6, the trampled band at 1.0 and nothing at 1.5; `trampleAt` is the identity at 1.6 and
  beyond and reaches the trample constants at 0.75.
- `client/test/game/trailPaint.test.ts`: the table's second row carries each segment's node
  `u` and the junction factors (degree ≥ 3 and the trailhead at 1.35, else 1); the GLSL
  constants equal the TypeScript prints token for token; the paint text contains the wear,
  ragged-edge, height-shift, lip and puddle terms and no `TRAIL_DIRT_TINT`; `terrainWet` is
  declared on both shader paths and bound from the weather; the plugin compiles on the
  forced-WebGL2 NullEngine with the trail enabled.
- `client/test/game/clutterMeshes.test.ts`: a grass card at `rt = 0.9` has a y scale, a tilt
  and a tint that match `trampleAt`; a card at 2 m is untouched; the litter model table and
  per-variant scales map as specified; litter instances land in the near band only.
- `client/test/architecture.test.ts` lists `trailBenchParams.ts` as Babylon-free;
  `shaderHygiene.test.ts` unchanged.

## 8. Browser gates

Branch beside a control build at the base, paired in both orders, one page at a time, the
gate hooks reverted before commit. The control stills for the trail are the daylight set
taken on 2026-09-16 at the TRAIL viewpoint (noon, 16 h, rain; along and down).

1. **The trail at noon, 16 h and in rain**, along and down: the four bands, the ragged edge,
   the wear along the length, the wet core and its puddles, the lip under the 16 h sun.
2. **A junction and the trailhead**: the scuffed width.
3. **A side-hill stretch**: the face, the bank, the lip.
4. **Standing on the bench**: the player at the tread with the eye low, for the sink and the
   trampled cards leaning away.
5. **Frame pairs** at the trail and the meadow, at 4× pixels and at the low tier's 1.5×.

Success is the owner's read of the pairs plus no regression on any pair.

## 9. Fallbacks

If the trail pair regresses: the puddle term goes first (it is the only extra noise inside the
core), then the 0.4 m edge octave. If the sink reads as a trench at the 1 m ring:
`TRAIL_SINK` to 0.04. If pebbles read as boulders: the litter scale range narrows.

## 10. Follow-ups this design creates

- Dedicated litter models (pebbles, twigs, torn turf) replacing the scaled rocks and driftwood,
  a renderer-only swap.
- A wear map along the stem weighted by distance from the trailhead (the near end is walked
  most), once the graph exposes a walked-count per edge.
- Blade clumps (sub-project 3) should respect the trampled band the same way the cards do.

## 12. Amendments (from the browser gates)

**§5, the bench colours.** The core and margin colours take the ground's vertex colour at
`TRAIL_BENCH_SHADE = 0.6` (`mix(1, vertexColour, 0.6)`) instead of the material's white constant:
at 1 the bench went black under canopy and the core/margin contrast was lost, at 0 the margin
read as a chalk line in the open. Retuned tints: `TRAIL_MARGIN_TINT = (0.40, 0.36, 0.30)` at
`TRAIL_MARGIN_GAIN = 0.75`, `TRAIL_CORE_TINT = (0.30, 0.26, 0.21)` at `TRAIL_CORE_GAIN = 0.5`, so
the margin sits at about twice the core's brightness; `TRAIL_TRAMPLE_TINT = (0.90, 0.88, 0.80)`
(the original read as a yellow ribbon).

**§6, the lean axis.** The lean is a rotation about `(az, 0, −ax)`, the axis for which the card's
top moves along the away direction `(ax, az)`; the opposite axis leans the grass into the bed. A
matrix-level test pins it.

**§6, litter distance.** The class radius is 40 m in the clutter field's radius table, so litter
has the field's ordinary near and far bands out to 40 m rather than a near band only. A litter
instance can jitter up to about 0.5 m past the 1.6 m fade because its gate is evaluated at the
cell centre and, unlike boulders, it rejects nothing at the instance — a pebble at 2.1 m is fine.

**§4, the level id.** The `passHash` pin in the tests moved twice (the sink and width; then the
litter class and the grass gate) and is re-pinned with the reasons; a test also pins that the id
differs from the pre-release one.

**§7, cost.** Frame time at 4× pixels is within ±0.4 ms of the base on the trail and the meadow
in both orders; the low tier at 1.5× scaling stays on the 60 Hz cap.
