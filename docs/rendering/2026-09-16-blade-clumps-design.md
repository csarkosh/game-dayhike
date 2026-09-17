# Blade clumps near the eye: design

**Status:** design, ruled 2026-09-16. Implementation plan to follow.

**What this is.** The third and last of the sub-projects that follow the grass grounding and
wind pass ([2026-09-15-grass-grounding-and-wind-design](2026-09-15-grass-grounding-and-wind-design.md)):
the grass floor ([2026-09-16-grass-floor-design](2026-09-16-grass-floor-design.md), shipped),
the trail as a bench ([2026-09-16-trail-bench-design](2026-09-16-trail-bench-design.md),
shipped), then this one. The first two grounded the cards and gave the trail a bed; the grass
near the eye is still a set of flat, alpha-tested cards, and at arm's length a card is a card.
This document puts real blade geometry where a blade is wider than a pixel and hands off to
the cards where it is not. The research is in
[2026-09-15-grass-and-trail-realism](2026-09-15-grass-and-trail-realism.md) §6 ("Geometry
without compute"), §7 and §8 (package D); this document records the decisions and the design,
not the evidence.

It is renderer-only: no sim change, no level id. It is also the one package of the series that
can regress the frame, so it ships only behind the paired frame-time gate in §8. Every value is
a starting point; the browser gates tune them and the tests pin the shapes.

## 1. Rulings

| Question | Ruling |
| --- | --- |
| How far must the volume hold? | The near field: blades to 12 m, the cards beyond. A 2 cm blade cluster still resolves at 12 m at 1080p; past that a blade costs more than a card and looks no better. |
| Which tiers draw blades? | High and medium. Low keeps today's cards: its 1.5× scaling is where blades resolve worst, and it has no post chain to carry MSAA. |
| Does MSAA land in this pass? | Yes, 4× on high and medium, on the first post-process of the chain, gated by the same frame pairs. Opaque blade edges are exactly what MSAA fixes and the blades earn back the fill that pays for it. |
| Where does the mesh come from? | Built in code at load: a pure module generates the clump from constants and a seeded hash. No asset, no LFS object, no catalog entry, and every constant can be retuned live. |
| How do blades fit the clutter? | A third, renderer-only bucket of the meadow class on the same 0.7 m lattice and the same instances. Not a new sim class (a level-id release for a cosmetic feature) and not blades over untouched cards (nothing saved, two grasses at the eye). |
| The hand-off | Geometric on the blade side, dither on the card side, over one shared band: each blade shrinks to its root in its own order across the last 4.5 m of the blade disc while the card at the same cell dithers in. Same instance, same yaw, same scale, same trample on both sides. |

## 2. Goals and non-goals

**Goals.**

- Inside about 8 m the grass is blades: individual, tapered, drooping, shaded as thin
  half-cylinders, moving with the one wind, bent by the players, trampled beside the trail.
- Between 7.5 and 12 m the blades give way to today's cards with no pop, no seam and no change
  of colour or motion.
- No card fragment is shaded inside 7.5 m; the fill that pays for the blades comes from there.
- Blade edges are multisampled on high and medium.
- Frame time inside the 60 Hz contract at the meadow, the forest edge, the trail and the deep
  forest, native, on both tiers that draw blades.

**Non-goals.** Blades on the low tier; blades on the grass, flower or bush classes; a blade
texture; blade shadows (cast or received); trampling memory; alpha-to-coverage; a depth
pre-pass; any change to the wind field, the sim, or the level id.

## 3. Architecture

| File | Role |
| --- | --- |
| `client/src/game/bladeClump.ts` (new, Babylon-free) | The clump's constants and `bladeClumpGeometry()`: positions, normals, vertex colours, indices and the per-vertex `blade` attribute as plain arrays. The mirrored `bladeAlive(random, thin)`. On `BABYLON_FREE_FILES`. |
| `client/src/game/clutterField.ts` | `BLADE_RADIUS`, `BLADE_PAD`, `bladeEdges()`; the meadow entry of `ClutterBands` gains a `blades` list, filled by the same walk and sorted nearest-first, empty when blades are off. |
| `client/src/game/clutterMeshes.ts` | The blade material and mesh built from the geometry; the meadow class's third bucket; the `blades` option; the card near bucket's in-band when blades are on. |
| `client/src/game/foliagePlugin.ts` | The `BLADES` profile and its `blades` flag → `FOLIAGE_BLADES` define; the `blade` attribute; the collapse constants. |
| `client/src/game/shaders/foliage.vertex.fx`, `foliageWorldPos.vertex.fx` | The attribute declaration and the collapse block; the blade motion weight without the edge term. |
| `client/src/game/postParams.ts`, `post.ts` | `MSAA_SAMPLES`; set on the first pass of the chain. |
| `client/src/game/renderer.ts` | `blades: tier !== "low"` into `createClutterMeshes`. |
| `ARCHITECTURE.md` | One sentence on the blade bucket under the rendering section. |

Nothing touches `sim/`, `windParams.ts`, the fragment stage of the foliage plugin, or the
distance-fade plugin.

## 4. Placement and reach

The meadow class already places one instance per 0.7 m cell, deterministically, with a yaw
from the instance's hash, a scale of 0.59–1.07, a ground height and gradient, and (since the
trail bench) a trample frame. The blade bucket draws those instances, so a clump and the card
that replaces it are the same object at the same place.

- `BLADE_RADIUS = 12` m. The hand-off band is the disc's last 4.5 m, `bladeEdges() = [7.5, 12]`,
  wider than the 4.24 m snap floor `CLUTTER_FADE_MIN_RAMP`. Blades exist only at
  `radiusScale = 1`, so the edges do not scale with the tier.
- **Membership is the field's.** `collectClutterCore` takes a `bladeReach` (0 when blades are
  off); for the meadow class an instance with `d2 < bladeReach²` is also pushed to the
  `blades` list, which is then sorted by `d2` ascending, nearest-first, so a single-draw bucket
  resolves its overdraw by the depth test. About 1,900 clumps at the reach below.
- **No pop at the eye.** The bucket is rebuilt only on a 3 m grass-cell crossing and its origin
  is floored to the meadow's 0.7 m cell, so between rebuilds the true eye can sit up to
  `BLADE_PAD = √2·(3 + 0.7) ≈ 5.23` m from the origin the distances were measured against.
  `bladeReach = BLADE_RADIUS + BLADE_PAD`: every clump whose true distance is under 12 m is in
  the buffer, and a clump between 12 and 17.2 m is fully collapsed and costs vertices only.
- The blade bucket writes the same matrix as the cards through `instanceMatrixFor` (yaw,
  scale, trample lean about `(az, 0, −ax)` and trample height) and the same `foliage` attribute
  through `writeFoliage` (ground colour × macro tint × trample stain, canopy shade in `.a`). It
  writes no `fadeBands`: nothing dithers it, and its material never carries the fade plugin.
- Where the meadow has no instance (the trail bed, rock, the coast, above the grass line) there
  is no clump; the sim's gates already decide that.

## 5. The clump mesh

`bladeClump.ts` is pure: `bladeClumpGeometry()` returns `{ positions, normals, colors, indices,
blade }` as `Float32Array`/`Uint16Array` from the constants below and `latticeHash`-style
arithmetic on the blade index, so two calls are identical and a test can check every vertex.
`clutterMeshes.ts` wraps it in one `Mesh` through `VertexData` at load, calls `prepBucketMesh`
on it and gives it the blade material.

| Constant | Value | Meaning |
| --- | --- | --- |
| `BLADE_COUNT` | 24 | Blades per clump. |
| `BLADE_RINGS` | 4 | Cross-sections per blade below the tip: 9 vertices and 7 triangles per blade, 216 vertices and 168 triangles per clump (a card is 290). |
| `BLADE_CLUMP_RADIUS` | 0.3 m | Roots lie on a disc of this radius at y = 0, the model convention (origin at the base). |
| `BLADE_HEIGHT` | [0.35, 0.6] m | A blade's height by its random. The instance scale then varies the clump 0.59–1.07×, as it does the card. |
| `BLADE_WIDTH` | 0.02 m | Half-width at the root; the strip tapers as `(1 − h)` to a point at the tip. |
| `BLADE_DROOP` | [0.1, 0.5] rad | Outward lean from the clump centre, applied as a parabolic curve `h²` so the blade arcs rather than tilts. |
| `BLADE_ROUND` | 0.5 rad | The face normal rolled about the blade's axis, `+` on one side and `−` on the other, so a blade shades as a half-cylinder rather than a ribbon. |
| `BLADE_TIP_TINT` | (1.05, 1.0, 0.8) | Vertex colour at the tip, from (1, 1, 1) at the root: paler and yellower where the blade thins. |
| `BLADE_LUMA` | 0.2 | Per-blade luminance spread, `1 + BLADE_LUMA·(random − 0.5)`, so a flat albedo reads as many blades. |

- Each blade has a random yaw about its own root, so the strips face every way and the
  clump has no preferred direction.
- **The attribute** `blade = (rootX, rootZ, random, heightFraction)`: the root in model space
  (its y is 0 by convention), the blade's random in [0, 1) that orders the thinning, and the
  vertex's fraction of its own blade's height for the plugin's later use.
- **The material:** an opaque `PBRMaterial`, `albedoColor = TUFT_ALBEDO` (0.18, 0.22, 0.11),
  metallic 0, roughness 0.8, `backFaceCulling = false`, no texture, no alpha, no `discard`. The
  vertex colours multiply the albedo through Babylon's own `VERTEXCOLOR` path. The foliage and
  foliage-light plugins attach to it exactly as to the card materials; the distance-fade plugin
  never does (`attachDistanceFade` refuses an opaque material by design, and no code forces it).

## 6. The hand-off

Two things happen across `bladeEdges = [7.5, 12]` m of true eye distance, and both are tied to
it in code so they cannot drift apart.

**Blades thin per blade.** The foliage profile gains a `blades: boolean` (false on every
existing profile); `prepareDefines` turns it into `FOLIAGE_BLADES`, `getAttributes` adds
`blade` under it. In `foliageWorldPos.vertex.fx`, under the define, the block ends with a
collapse in place of the far sink:

```
thin  = smoothstep(foliageEdges.x, foliageEdges.y, fDist)
alive = clamp((blade.z − thin · (1 + FOLIAGE_BLADE_SOFT)) / FOLIAGE_BLADE_SOFT + 1, 0, 1)
root  = (finalWorld · vec4(blade.x, 0, blade.y, 1)).xyz
worldPos.xyz = root + (worldPos.xyz − root) · alive
```

with `FOLIAGE_BLADE_SOFT = 0.15`. `alive` is 1 for every blade at `thin = 0` and 0 for every
blade at `thin = 1`; between, each blade shrinks toward its root over a short window in the
order of its random, so the clump loses blades one at a time rather than shrinking as a whole.
A collapsed blade is a point: zero area, no fragments, no `discard`. The collapse is the last
line of the block, after the wind, so the vertices of a collapsed blade coincide exactly; the
root is taken through `finalWorld` without any displacement. `bladeAlive(random, thin)` in
`bladeClump.ts` mirrors it for the tests.

Two adjustments under the same define: the motion weight `fM` drops its
`(1 − smoothstep(foliageEdges…))` factor, so blades in the band move with the same wind as the
cards taking over; and the far sink line is skipped (the collapse owns the edge). `setFoliageEdges`
on the blade material is called with `bladeEdges()`.

**Cards dither in over the same band.** When blades are on, the meadow near card bucket's bands
become `fadeBands([7.5, 12], [seam.start, seam.end])` in place of today's
`fadeBands(null, [seam.start, seam.end])`; the far bucket is unchanged. The in-band uses the
partitioned dither the plugin already has, so a card is fully discarded inside 7.5 m, at
`CUSTOM_FRAGMENT_MAIN_BEGIN` before any texture fetch. The card vertices inside 7.5 m (about
360 instances) still run; that is too few to be worth a collector change.

**Draw order.** The blade bucket is opaque, so Babylon draws it before the alpha-tested card
buckets; inside the bucket the instances are nearest-first. With early depth rejection on
(no `discard` in the material) the cards and later blades behind a near blade are rejected
before shading.

## 7. Shading and wind

- `FOLIAGE_PROFILES.BLADES = { amp: 1.0, groundTint: 0.7, rootAO: 0.5, normalRoot: 0, tilt: true,
  bend: true, blades: true }`: the meadow card's numbers plus the flag. The fragment stage is
  untouched and gives the blades everything the cards have: root darkening by height, the
  ground tint from the `foliage` attribute, the canopy shade, the per-clump luma nudge, the
  normal blended to the ground's up at the root, `faceforward`, and the sun-only wrap
  translucency from `attachFoliageLight`.
- The wind block is unchanged for blades: lean and gust phased at the clump origin, flutter
  phased at the vertex so blades within a clump break up, the camera tilt, the five-player
  bend. A blade is a strip displaced by `fH²`, so it bends as an arc where a card shears.
  `foliageHeight` is the clump mesh's bounding height, as for every other material.
- Trample is free: the same matrix and the same tint as the card at that cell.
- Blades neither cast nor receive shadows, like every clutter class; canopy darkening arrives
  through `foliage.a`.

## 8. MSAA and tiers

- `postParams.ts`: `MSAA_SAMPLES = 4`. `post.ts` sets `samples = MSAA_SAMPLES` on the first pass
  of the chain: the scene pass on high (it belongs to halation), the grade on medium. Babylon's
  setter clamps to `caps.maxMSAASamples` and the pass's input target is created with that
  count, so the scene render is multisampled and resolved before the chain. A capped engine
  reads 1 and nothing else changes. FXAA stays: MSAA does nothing for the cards' `discard`
  edges. No `game/` code reads a depth renderer, so there is no consumer to break.
- Low tier is untouched end to end: no chain, so no MSAA; `blades: false`, so no blade bucket,
  no `bladeReach`, and the card near bucket keeps today's bands.

## 9. Tests

NullEngine, with the WebGL2 forcing the atmosphere test established wherever a shader is
compiled, so both the uniform-buffer and the non-UBO paths are exercised.

- `bladeClump.test.ts`: 216 vertices and 168 triangles; every root at y = 0 within
  `BLADE_CLUMP_RADIUS`; tip heights within `BLADE_HEIGHT`; unit normals; `blade.w` rises
  monotonically up each strip from 0 to 1; two calls are identical; `bladeAlive` is 1 for every
  random at `thin = 0` and 0 for every random at `thin = 1`, and non-increasing in `thin`.
- `clutterField.test.ts`: the `blades` list holds exactly the meadow instances within
  `bladeReach` of the snapped origin, sorted nearest-first; it is empty for every other class
  and when `bladeReach` is 0; for any eye inside the rebuild cell, every instance under
  `BLADE_RADIUS` of the true eye is present (the pad property); `bladeEdges()` spans at least
  `CLUTTER_FADE_MIN_RAMP` and ends at `BLADE_RADIUS`.
- `foliagePlugin.test.ts`: the lockstep constants (`FOLIAGE_BLADE_SOFT` and the edge use)
  match the GLSL; both shader paths compile with `FOLIAGE_BLADES` on a thin-instanced mesh;
  the `blade` attribute is declared only under the define; no existing profile sets `blades`.
- `clutterMeshes.test.ts`: the blade bucket exists only with `blades: true`; its matrices equal
  the near card bucket's for the same instance; the card near bucket's in-band equals
  `bladeEdges()` with blades on and is absent with them off; the blade material carries
  `Foliage` and `FoliageLight` and never `DistanceFade`; the mirrored collapse through
  `instanceMatrixFor` puts all nine vertices of a blade at one point at `alive = 0`.
- `post.test.ts`: with `caps.maxMSAASamples` raised to 4, the first pass carries
  `MSAA_SAMPLES` (the scene pass on high, the grade on medium); low has no pass.
- `architecture.test.ts`: `bladeClump.ts` on `BABYLON_FREE_FILES`; `shaderHygiene.test.ts`
  covers the two `.fx` files as before.

## 10. Browser gates

Controller-run, against a control build at the branch base, with the trail-bench rig (the
gate hooks, branch on :5174/:8081, control on :5175/:8082) and its poses: MEADOW
(−216.1, 22.38, 414) yaw 0.393 pitch 0.08 and the floor crop at pitch 0.55; EDGE
(231.9, 85.61, 54) yaw −1.571; TRAIL (263.9, 85.77, 118) yaw 1.571; DEEP (159.9, 114.68, −234)
yaw −1.078. Same seed, same weather and hour on both builds.

1. **Stills** at all four poses at noon and 16 h, plus rain on the trail: blades read as
   individual, drooping, rounded blades at eye height; the colour of a clump matches the card
   behind it; blades are trampled beside the bench; no console errors on either build.
2. **The hand-off:** the MEADOW floor crop shows no seam across 7.5–12 m; two MEADOW stills
   3 m apart along the view (across the band) show no pop; a `/wind 100` strip shows blades and
   cards moving as one.
3. **Frame pairs,** both orders, vsync checked, p95: high tier native at all four poses;
   medium tier native at MEADOW and DEEP (the grade carries the MSAA there); one MEADOW pair on
   low to confirm nothing moved.
4. **Pass bar:** no pose regresses beyond noise at p95 on either tier; the meadow reads fuller
   at eye height in the stills. A regression at DEEP (already nearest the 16.7 ms cliff) is
   the one that can send the whole package back.

## 11. Fallbacks

Each is one constant, and none crosses a module boundary.

- The frame regresses on high: `BLADE_COUNT` 24 → 16, then `BLADE_RADIUS` 12 → 10.
- MSAA alone costs more than the blades save: `MSAA_SAMPLES` 4 → 2; the blades stay.
- Medium regresses and high does not: `blades` becomes `tier === "high"` in `renderer.ts`.
- The band shows a step in density: widen `bladeEdges` to [6, 12] (the card in-band follows).
- The clumps read too dark or too uniform: `BLADE_LUMA`, `BLADE_TIP_TINT`, and the profile's
  `rootAO`, all live-tunable with the rig's uniform override.

## 12. Follow-ups this design creates

- A per-instance blade density (fewer blades where the meadow noise is dry) once the `blade`
  attribute's `.w` or a fourth `foliage` channel is worth spending on it.
- Blades on the grass class (the wider 3 m lattice) if the meadow's blade band proves the cost.
- The low tier, if a measurement at 1.5× shows blades resolving well enough there.
- Trampling memory (a camera-following render target) remains the research doc's parked item.

## 13. Amendments (2026-09-16)

**§5, the constants.** The browser gates retuned six of the mesh constants: `BLADE_COUNT` 24 →
40 (24 blades per clump read as sparse wisps against the cards' dense tufts); `BLADE_HEIGHT`
[0.35, 0.6] → [0.2, 0.45] m (the card model is 0.35 m tall, and the hand-off needs matching
heights); `BLADE_WIDTH` 0.02 → 0.012 m (it is a half-width, so 0.02 drew 4 cm reeds);
`BLADE_DROOP` [0.1, 0.5] → [0.3, 0.9] rad (straight blades read as reeds; a stronger parabolic
droop splays the clump); `BLADE_ROUND` 0.5 → 0.3 rad (the full roll gave every blade a black
side under a side-lit sun); `BLADE_TIP_TINT` (1.05, 1.0, 0.8) → (0.95, 0.95, 0.75) together with
`BLADE_LUMA` 0.2 → 0.3 (the tips read too pale; more per-blade variation reads better).

**§5, the normals.** `BLADE_ROUND` is 0.3 rad, per the retune above. The up bias is not baked
into the mesh: it is a foliage-plugin profile value, `normalUp`, applied to the world normal in
the vertex block, so it is independent of the trample lean. Added to the §7 profile line:
`normalUp: 1.0`.

**§7, shadows.** The blade mesh receives shadows and still never casts. Left unshadowed, a
clump glowed against a shadowed floor under the canopy; receiving fixes it, at the cost
measured in §10.

**§6, the seam.** Beyond 12 m the cards read darker than the blades. The cause is the card
albedo texture reading dark once minified — its transparent texels bleed dark into the mips —
compounded by the root darkening and the ground tint; nothing on the blade side closes it.
Recorded as a follow-up alongside §12's list: dilate the card albedo into its transparent
texels, or move the blade radius out to the carpet's own 18 m seam.

**§10, the pass bar.** Fill-bound costs scale with the pixel count: at native resolution the
package costs about 0.9 ms for the multisampling and 1.0–1.5 ms for the blades with shadow
receiving at the meadow, on hardware whose native frame there runs about 6 ms — about 2 ms at
the worst pose on that 6 ms frame. The fill saving expected from replacing cards with opaque
blades did not appear: the cards inside 7.5 m still run their vertex work and early discard
while the clumps add opaque fill on top. The low tier is unchanged. The fallbacks stand.

**§8, tiers.** Tier detection on this class of machine yields `high` (16 GB, 10 cores); Chrome
on some platforms caps `deviceMemory` at 8 and lands on `medium` instead.
