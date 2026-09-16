# The grass floor: design

**Status:** design, ruled 2026-09-16. Implementation plan to follow.

**What this is.** The first of three sub-projects that follow the grass grounding and wind pass
([2026-09-15-grass-grounding-and-wind-design](2026-09-15-grass-grounding-and-wind-design.md)):
the grass floor, then the trail as a bench, then blade clumps near the eye. This one changes
the ground under the tufts, which today is one 2 m photo texture tiled flat over the palette
colour. The research is in
[2026-09-15-grass-and-trail-realism](2026-09-15-grass-and-trail-realism.md); this document
records the decisions and the design, not the evidence.

The owner named four faults and all four are in scope: the texture repeats visibly, the ground
is flat and smooth, its colour is uniform, and past the tufts' reach the field turns to bare
texture. Every fix here is renderer-only, in the ground plugin, with no new sampler (the
terrain material sits at WebGL2's ceiling of sixteen) and no new asset. Every value is a
starting point; the browser gates tune them and the tests pin the shapes.

## 1. Rulings

| Question | Ruling |
| --- | --- |
| Order of the three sub-projects | Floor first (cheapest, and it changes what the trail and the blades sit on), then the trail as a bench carrying the one level-id release, then blade clumps gated on frame time. |
| New textures | None. The terrain material has twelve plugin samplers plus the PBR material's own; the floor comes from sampling the bound textures differently. |
| Which layers get hex tiling | The grass layer only. Forest floor lives under canopy where the repeat is hidden; rock is triplanar; sand and pebble are small areas. |
| Parallax on grass | No. The rock parallax swam underfoot at 3 cm and blades are too fine for a march to help; depth comes from a finer second scale and an occlusion term. |
| Drainage and hollows | Out. A hollow needs curvature the renderer has no per-vertex value for; a sim field is a level-id change and belongs to the trail release. |
| The horizon colour | A constant tuft albedo, not a per-hour value: it is an albedo and the grade already handles the hour. |
| Level id | Unchanged. Nothing here touches `sim/`. |

## 2. Goals and non-goals

**Goals.**

- The 2 m grass texture never reads as a repeat, at any distance it is visible.
- The floor near the eye reads as a mat of blades with depth, not a painted plane.
- The meadow has lush and dry patches that follow the land; the tufts and the floor under them
  agree on colour.
- The far meadow keeps the near meadow's density; the tufts' 110 m horizon is not a line.
- Frame time within the 60 Hz contract at the meadow, the fill-heaviest view.

**Non-goals.** New ground textures, parallax on grass, a runtime ground colour render target,
the trail edge (next sub-project), blade geometry (the one after).

## 3. Architecture

Everything lands in the ground plugin (`client/src/game/terrainTexture.ts`) and one new GLSL
include, with a Babylon-free mirror of the noise for the tufts.

| File | Role |
| --- | --- |
| `client/src/game/shaders/groundHex.fragment.fx` (new) | The hex lattice, the lattice hash, the three-sample weights, the two-octave macro noise, the lush/dry tint. Spliced at the plugin's fragment definitions. |
| `client/src/game/groundHexParams.ts` (new, Babylon-free) | The constants and the TypeScript mirrors: `hexWeights(uv)`, `latticeHash(ci, cj)`, `macroNoise(x, z)`, `macroTint(x, z, slope)`. On `BABYLON_FREE_FILES`. |
| `client/src/game/terrainTexture.ts` | The blend block samples the grass layer through the hex function, adds the detail scale and the between-blades occlusion, applies the macro tint and the horizon tint; binds the new uniforms. |
| `client/src/game/clutterMeshes.ts` | `writeFoliage` multiplies the tuft's ground colour by `macroTint` so tuft and floor agree. |
| `client/src/game/foliagePlugin.ts` | Unchanged this pass. `TUFT_ALBEDO` lives in `groundHexParams.ts`; the blade-clump sub-project reads it from there later. |

## 4. The repeat: hex tiling of the grass layer

Burley's hex-tiling in its LUT-free form. For a planar UV `p` (world XZ × 1/2 m):

1. Map `p` to a triangular lattice with a 60° skew; take the three nearest lattice vertices
   and their barycentric weights `w1, w2, w3`.
2. Each vertex `v` hashes to an offset `o(v)` in [0, 1)² and a rotation `r(v)` in [0, 2π)
   through the lattice hash (multiply-add-fract on the integer cell indices, the same family
   the wind's ragged term uses, so the TypeScript mirror agrees to 1e-3).
3. Sample the texture three times at `rotate(p − v, r(v)) + o(v)`.
4. Blend with sharpened weights `w_i^HEX_SHARPNESS / Σ` (`HEX_SHARPNESS = 8`), which keeps
   the texture's contrast without a histogram LUT: two of the three samples dominate at any
   point and the blend seam is a soft band a few centimetres wide.

The grass albedo is hex-tiled everywhere the grass weight is non-zero (three fetches instead of
one). Inside the existing relief fade (80–140 m) the grass normal and height fetches use the
same three offsets and weights, so the relief agrees with the colour. The forest floor, rock,
sand and pebble layers are unchanged.

## 5. The flatness: a finer second scale

Inside a nearer fade `DETAIL_FADE = [8, 20]` m the grass albedo, normal and height are sampled
again at `DETAIL_TILING = 0.5` m (four repeats per macro repeat), through the same hex function
so the detail does not repeat either, and folded in with `detailStrength = (1 − smoothstep(8, 20,
dist)) · grassWeight`:

- `albedo *= mix(1, detailAlbedo / mean, DETAIL_STRENGTH · detailStrength)` with
  `DETAIL_STRENGTH = 0.5`.
- The detail normal's XY is added to the perturbation at `DETAIL_NORMAL = 0.5` weight before the
  normalise.
- Between-blades occlusion: `ao *= mix(1, smoothstep(0, 0.6, detailHeight), DETAIL_AO ·
  detailStrength)` with `DETAIL_AO = 0.6`, so the fine troughs between blades darken and the
  floor reads as a mat with depth.

Three more fetches inside 20 m, none beyond.

## 6. Colour: macro variation and the horizon

**Macro variation.** `macro = 0.65·noise(p / 18) + 0.35·noise(p / 6)` in [0, 1], a value noise on
the lattice hash (two octaves, 18 m and 6 m wavelengths), plus a slope push
`macro = clamp(macro + MACRO_SLOPE · (1 − terrainN.y), 0, 1)` with `MACRO_SLOPE = 0.6`, so
steeper ground reads drier. The tint is `mix(MACRO_LUSH, MACRO_DRY, macro)` with
`MACRO_LUSH = (0.92, 1.03, 0.90)` and `MACRO_DRY = (1.08, 1.00, 0.82)`, multiplied over the
palette colour and weighted by the grass weight, at full strength near and fading with the
80–140 m relief fade so the far palette stays as tuned.

**The tufts agree.** `writeFoliage` in `clutterMeshes.ts` multiplies its `surfaceAlbedo` result
by `macroTint(x, z, slope)` from the TypeScript mirror, using the same slope it already
computes. A lockstep test pins the GLSL constants and the hash to the TypeScript.

**Horizon tint.** `surfaceAlbedo = mix(surfaceAlbedo, TUFT_ALBEDO, grassWeight ·
HORIZON_MAX · smoothstep(HORIZON_START, HORIZON_END, dist))` with `TUFT_ALBEDO = (0.36, 0.42,
0.24)` (linear), `HORIZON_START = 35`, `HORIZON_END = 90`, `HORIZON_MAX = 0.5`. Applied after
the blend and before the lights, so the tint takes the scene's light like the tufts do. The
tufts already tint toward the ground with distance; the two meet in the middle and the 110 m
card horizon stops reading as a line.

## 7. Cost and tiers

Per grass fragment: +2 albedo fetches everywhere; +4 map fetches inside 140 m; +3 fetches
inside 20 m; the noise and tint are ALU (two hashed lattice lookups). The ground is the
fill-heaviest surface after the grass cards, so the meadow pair is the gate. All tiers run the
same code; the low tier's 1.5× hardware scaling already halves its fill.

## 8. Tests

- `groundHexParams.test.ts`: the three hex weights sum to one and are non-negative on a 64×64
  grid of UVs; the sharpened weights sum to one; the lattice hash is in [0, 1) and differs
  between neighbouring cells; `macroNoise` is bounded in [0, 1] and continuous (no jump larger
  than 0.05 between samples 0.1 m apart); `macroTint` is exactly `MACRO_LUSH` at noise 0 and
  `MACRO_DRY` at noise 1 on flat ground.
- `groundHex.fragment.fx` lockstep: every constant (`HEX_SHARPNESS`, `DETAIL_TILING`, the fade
  edges, `MACRO_LUSH`/`MACRO_DRY`, `MACRO_SLOPE`, `TUFT_ALBEDO`, the horizon edges) appears in
  the GLSL as `${value}` prints; the hash expression matches token for token.
- `terrainTexture.test.ts`: the blend text hex-samples `terrainGrass` and no other layer; the
  detail block is gated on `DETAIL_FADE`; the new uniforms bind; the plugin compiles on both
  shader paths under the forced-WebGL2 NullEngine.
- `clutterMeshes.test.ts`: a tuft's written ground colour equals `surfaceAlbedo × macroTint`
  at its position.
- `shaderHygiene.test.ts` covers the new `.fx` by its glob; `architecture.test.ts` lists
  `groundHexParams.ts` as Babylon-free.

## 9. Browser gates

Branch beside a control build at the base, paired in both orders, one page at a time, the
gate hooks reverted before commit.

1. **Open meadow, noon.** A crop of the floor at 5–15 m for the repeat and the blade mat, and the
   same pose looking 60–110 m out for the horizon. The frame-time gate, sampled at native and
   at the low tier's 1.5× scaling.
2. **Forest edge, 14 h.** The macro patches against the tufts, and the tuft/floor agreement.
3. **The trail at eerie 20 h, lamp on.** The detail scale and the occlusion term under a near
   light: no sparkle, no banding.
4. **Deep forest, 12 h.** Frame pair only.

Success is the owner's read of the paired frames plus no regression on any pair.

## 10. Fallbacks

If the meadow pair regresses: `DETAIL_FADE` shortens to [8, 12]; then hex tiling drops to the
relief fade only (plain tiling beyond 140 m); the horizon tint stays regardless (it is free).

## 11. Follow-ups this design creates

- The trail sub-project reuses the lattice hash and the macro noise for its noise-broken edge.
- Blade clumps reuse `TUFT_ALBEDO` as their base colour.
- A drainage term, once the trail release adds its sim field.

## 12. Amendments (from the browser gates)

- **§5, the detail scale.** The detail albedo term is gone. The grass maps are 512 px over 2 m;
  at a 3–6 m footprint their albedo carries about ±3 % visible contrast, so a second copy of it
  at any weight could not be seen. The detail scale is 1 m (`DETAIL_TILING = 1.0`), and it
  contributes a normal (`DETAIL_NORMAL = 0.5`) and a between-blades occlusion `ao *= mix(1,
  smoothstep(DETAIL_AO_RANGE[0], DETAIL_AO_RANGE[1], detailHeight), DETAIL_AO ·
  detailStrength)` with `DETAIL_AO_RANGE = [0.3, 0.7]` and `DETAIL_AO = 0.7`: the packed height
  channel is centred on 0.5, and the original `smoothstep(0, 0.6, h)` sat near 1 across it, so
  the occlusion had no contrast. Two fetches inside 20 m, not three.
- **§6, macro variation.** `MACRO_LUSH = (0.82, 1.06, 0.84)`, `MACRO_DRY = (1.18, 0.98, 0.70)`;
  the original ±8 % range was not visible across a meadow.
- **§6, horizon tint.** `TUFT_ALBEDO = (0.18, 0.22, 0.11)`. The far field is already brighter
  than the tufted band (its brightness is set by the atmosphere, not the albedo), so a bright
  target widened the step instead of closing it; the darker value matches what a lit tuft card
  reads at and turns the tint into a hue nudge.
- **§4 and §7, cost.** The 2 m hex lattice and its three-tap fetches run only where the grass
  vertex weight is non-zero; elsewhere one plain fetch of each grass map keeps the height blend
  intact (the blend can still hand grass a small share where two other layers split the
  weight). Measured cost at the meadow: about +0.75 ms at native resolution (+3 ms at 4×
  pixels); the low tier at 1.5× scaling stays on the 60 Hz cap.
