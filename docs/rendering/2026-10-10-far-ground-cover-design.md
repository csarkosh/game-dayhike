# The far ground's cover: design

**Spec, 2026-10-10.** Past about 25 m the ground between the trunks reads as a
flat, even grey-green with nothing on it: every layer that makes the near field
full ends by 40 m, and the terrain beyond was tuned for open meadow. This design
makes the terrain carry the cover from where the meadow cards thin out to the
fog. In one block of the terrain's fragment stage the ground under any cover the
near field draws takes the colour and value the cover renders at, a clump
pattern that shades with the sun, the lush and dry tint the cards carry, the
cards' response to the sun, and half the grazing sky reflection it has today.

It builds the far sward the
[grass frame reclaim design](2026-09-26-grass-frame-reclaim-design.md) §6
designed and never built, changed where the code and a measurement made on
2026-10-09 say it must be (§3.2). The research behind it is
[A full far ground without drawing it](https://csarko.sh/research/a-full-far-ground-without-drawing-it).

Renderer-only. Nothing in `sim/` changes, so the level id does not move. The
new code reads literals, the per-vertex data the clipmap already carries and
the view, so every peer draws the same ground for the same view. No uniform is
added, nothing is allocated a frame, and no CPU work is added a frame.

## 1. The far ground today

**What stands on it.** On the high tier:

| Layer | Spacing | Ends |
| --- | --- | --- |
| Blade clumps | 0.5 m cells | 18 m (none on low) |
| Leaf litter pieces | 1 m cells | 24 m, 16 m on medium (none on low) |
| Meadow cards | 0.7 m cells | dither out and sink over [28, 40] m |
| Sword ferns | 2 m cells, in patches | 56 to 70 m |
| Grass-class tufts | 3 m cells, at most one per 9 m² | 88 to 110 m |

Under a closed canopy the meadow cards stand at 1.1 to 1.9 per m² and the
grass-class tufts at 0.07 to 0.11 per m², so across 28 to 40 m the number of
things standing on the ground drops more than tenfold. The low tier draws every
class at 0.6 of its radius: its meadow cards dither out over [16.8, 24] m.

**What the terrain does with it** (`terrainTexture.ts`, `TERRAIN_FRAGMENT_BLEND`):

- The colour is the clipmap's per-vertex palette (`terrainSurface.ts`): a 34 m
  mottle between forest floor (0.11, 0.09, 0.06) and grass (0.09, 0.15, 0.06),
  pulled toward `CANOPY` (0.045, 0.085, 0.05) by up to 0.85ρ, ρ the forest
  density, and toward the needle bed (0.15, 0.105, 0.06) by 0.75 of the litter
  weight. Five tiled textures are multiplied over it, each divided by its own
  mean colour, fading out with the relief over [80, 140] m.
- The macro tint (lush to dry, 18 m and 6 m octaves) is weighted by the grass
  *texture* weight `w0`, a mottle, and fades out with the relief.
- The sward pull toward `SWARD_FLOOR` is keyed on the per-vertex cover and gone
  by 18 m.
- The horizon pull toward `TUFT_ALBEDO` (0.18, 0.22, 0.11), up to 0.5 over
  [35, 90] m, is weighted by `w0` too. Under trees litter turns the ground
  toward the forest-floor layer, so there it moves the colour a few percent.
- Grass and forest floor have roughness 1 and half the dielectric F0. The
  compiled terrain stages take Babylon 9.18's legacy path
  (`LEGACY_SPECULAR_ENERGY_CONSERVATION`), where the material's specular weight,
  `metallicReflectanceFactors.a`, sets both F0 and the grazing reflectance F90
  (`reflectanceF90 = vec3(specularWeight)`). The per-layer F0 halving goes
  through `vReflectivityColor.a` and does not reach F90, which stays 1.

The data the far ground needs already rides on every clipmap vertex, at 1 m
spacing to 64 m and 2 m to 128 m: `vTerrainCover` (the ground cover's grass,
clamped to 1), `vTerrainW2.z` (its litter, `duff`) and `vTerrainW2.w` (the
forest density ρ).

**How the cards are lit.** `FoliageLightPlugin` replaces each light's diffuse
line and changes only light index 0, with a wrap of `FOLIAGE_WRAP` 0.35 and a
backlight. In the game the local headlamp is made before the sun
(`renderer.ts`: `createHeadlamp`, then `createLighting`), so in all 23 recorded
fragment stages that carry the plugin light 0 is the headlamp (`SPOTLIGHT0`)
and the sun is light 1 (`DIRLIGHT1`); the test that pins "the sun is light 0"
builds a scene with no headlamp. The cards therefore take the sun through
Babylon's own diffuse, on their own normals turned to face the viewer
(`faceforward` in `foliage.fragment.fx`), blended to straight up at the root
(`normalRoot` 0 for the meadow profile). The meadow card's vertex normals
average 0.63 in y; turned toward the viewer and blended from the root, the
cards' mean normal leans about 17° from up toward the eye. The headlamp's range
is 25 m, so past the hand-off the wrap acts on nothing.

**The measurement.** 2026-10-09, seed `room-3`, free camera at
(140, 69.58, 400), yaw 4.712 (facing −x), pitch 0.15; forest interior, canopy
0.86 at the eye and 0.99 along 70 m ahead; high tier, WebGPU, 1920 × 1080 at
device pixel ratio 1. `mat_terrain.metallicF0Factor` set from 1 to 0 on the live
page (it is a uniform, so the whole material's specular weight goes to 0), stills
3 s apart. Crops are percentages of the frame, rows then columns. Linear
luminance Y and chroma (max − min) / Y of the crop's mean colour.

| Scene | Crop | Y, F0 on | Y, F0 off | ΔY | chroma on → off |
| --- | --- | --- | --- | --- | --- |
| Noon, bright | far, middle (38–47, 45–70) | 0.0353 | 0.0332 | −6 % | 0.077 → 0.075 |
| Noon, bright | far, right (37–45, 83–99) | 0.0455 | 0.0427 | −6 % | 0.102 → 0.129 |
| Noon, bright | card band (47–54, 40–68) | 0.0263 | 0.0250 | −5 % | 0.177 → 0.181 |
| Noon, bright | near (60–80, 0–45) | 0.0294 | 0.0281 | −4 % | 0.185 → 0.214 |
| Noon, mist | far, middle | 0.0738 | 0.0714 | −3 % | 0.152 → 0.148 |
| Noon, mist | far, right | 0.0721 | 0.0689 | −4 % | 0.159 → 0.159 |
| Noon, mist | card band | 0.0169 | 0.0154 | −9 % | 0.223 → 0.214 |
| Noon, mist | near | 0.0192 | 0.0173 | −10 % | 0.102 → 0.113 |
| 16:00, clear (sun 29° up, from +x) | far, middle | 0.0841 | 0.0636 | −24 % | 0.269 → 0.293 |
| 16:00, clear | far, right | 0.0579 | 0.0504 | −13 % | 0.325 → 0.363 |
| 16:00, clear | card band | 0.0733 | 0.0547 | −25 % | 0.295 → 0.339 |
| 16:00, clear | near | 0.0961 | 0.0831 | −14 % | 0.311 → 0.333 |

The same stills at a meadow, seed `room-5`, free camera at (−66.5, 43.17,
243.6), yaw 1.571 (facing +x), pitch 0.12, the meadow's west edge looking east
across it, at noon:

| Crop | Y, F0 on | Y, F0 off | ΔY | chroma on → off |
| --- | --- | --- | --- | --- |
| far, left (40–45, 0–25) | 0.1207 | 0.1121 | −7 % | 0.233 → 0.275 |
| far, right (41–45, 75–100) | 0.0955 | 0.0839 | −12 % | 0.128 → 0.180 |
| card band (47–52, 20–80) | 0.0383 | 0.0379 | −1 % | 0.214 → 0.216 |
| near (60–80, 0–45) | 0.0497 | 0.0490 | −1 % | 0.293 → 0.304 |

What it says:

- Under a high sun or mist the specular term is a few percent of the far
  floor and the colour carries the look. At a low sun it is a quarter of the far
  floor, and the near floor loses 14 % with it when the whole material is cut, so
  a whole cut would put the far ground under the near. The cut is partial,
  `FAR_SPEC_CUT` 0.5, and weighted by distance so the near floor keeps its own.
- The far floor is brighter and greyer than the cards in every scene. Under the
  canopy at noon the card band reads at 0.75 of the far floor (0.0263 against
  0.0353), with about twice its chroma; in the open meadow at 0.32 to 0.40 of
  it (0.0383 against 0.1207 and 0.0955). The far ground must be darkened and
  saturated, not only tinted.
- The open meadow asks for more than twice the darkening the canopy does. Its
  far floor is in the sun, and the cards' sunlit faces turn away from a high sun
  while the ground faces it; under the canopy both are lit by the sky. The
  difference is the sun's, so the sun's term carries it (§6), and the colour
  stays one colour.
- Under mist the far crop is fog: 0.0738 against a card band of 0.0169. No
  ground colour moves it much.

**The corpus.** `client/shaders/corpus/tiers.json` lists 1,303 stages. Twenty
of them declare the terrain's uniform block (`terrainTuft` among its members),
and the counts the research gave hold: 2 fragment stages (one listed for medium
and high, one for low, both recorded with uniformity analysis off) and 18 vertex
stages (14 listed for medium and high, 4 for low). The vertex stages differ by
the wet line's define and the light count (3, 4 and 7 lights).

## 2. What the far ground must do

1. **Read as the cover it stands in for.** Past the band where the cards thin
   out, ground under grass or litter takes the mean colour the near cover renders
   at, as fitted from stills (§7), on every tier.
2. **Hand over without a line.** The colour ramps in under the cards' dither, so
   the stipple shows the same tone through its holes as around them; a walk
   toward the band shows no step.
3. **Break up and shade with the sun.** Clumps at tussock and patch scale, lit
   on their sun side and darker in their troughs, fading to their mean where
   their cells fall under two pixels, so nothing shimmers.
4. **Answer the sun as the cards do.** Darker than bare ground when the sun is
   high or ahead, close to it when the sun is behind the eye.
5. **Reflect less grey sky,** by half, and as much as today once the ground is
   wet.
6. **Leave the trail, the road and the near field alone.** The trail and the
   road keep their colours, normals and reflectance; the ground inside 24 m
   (14.4 m on low) is unchanged.
7. **Stay cheap and deterministic.** No texture read, no uniform, no per-frame
   CPU work; literals and per-vertex data only.

## 3. Approach

One block in the terrain's fragment stage, branched on its own weight so only
far-band fragments pay, with its constants as literals in a new shader include
beside the grass floor's, a CPU twin and a lockstep test. Three small rewrites
carry it into the lighting: the specular weight, the sun's diffuse line, and
the normal, applied after the paints so the trail and the road keep their own.

### 3.1 The pieces

- **The weight** (§4): any cover, grass or litter, ramped in over a band of eye
  distance that starts before the cards' dither and is full early in it.
- **The colour** (§5): a sward colour and a litter colour mixed by the litter
  weight, the macro tint carried over from the near field, a canopy shade, and
  the clumps' trough darkening, pulled in by up to `FAR_SWARD_MAX` 0.8.
- **The light** (§6): the clumps' normal on every light; the cards' mean
  normal and their self-shadowing on the sun's diffuse; the specular weight cut
  by half.
- **The fit** (§7): the colours, the canopy shade and the self-shadow fitted to
  linear crops of stills at a forest pose and a meadow pose, and checked at a
  low sun.

### 3.2 What changes against the far sward design (reclaim design §6)

| | Far sward design §6 | This design |
| --- | --- | --- |
| Key | `vTerrainCover` over [0.05, 0.5] | cover plus litter, clamped, over the same [0.05, 0.5]: under trees much of the near field is litter |
| Band | [24, 30] m, off on low | [24, 30] m; on low [14.4, 18] m, 0.6 of it, chosen by a define |
| Colour | `FAR_SWARD` (0.11, 0.135, 0.065), a uniform | `FAR_SWARD` (0.049, 0.081, 0.032) and `FAR_LITTER` (0.081, 0.057, 0.032) to start, literals, fitted; the measurement puts the old value about 1.8 times too bright (§5) |
| Pull | `FAR_SWARD_MAX` 0.8 | the same |
| Mottle | a constant per 1.5 m cell, which would draw a grid of squares at 40 m | interpolated value noise at 0.8 m and 3 m with its gradient, band-limited (§5.3) |
| Canopy | none | `FAR_CANOPY_SHADE`, the cards' own 1 − 0.5ρ to start, fitted |
| Macro tint | none past the 80 to 140 m fade, keyed on `w0` | carried in the far colour, so keyed on cover, band-limited instead of faded |
| Reflectance | unchanged | specular weight × (1 − 0.5 w), which lowers F0 and F90 together |
| Light | a grazing darkening, `FAR_SWARD_GRAZE` 0.3 | the cards' mean normal and self-shadowing on the sun (§6) |
| Wind | a shimmer from the gust field, two new uniforms | none: a uniform would change every terrain stage, and a shimmer on flat paint at 40 m does not read as grass moving |
| Cards | far bucket trimmed, dither [26, 30] | unchanged, dither [28, 40] |
| CPU twin | `farSwardWeight(cover, dist)` | `farCoverWeight(cover, duff, dist, low)` and five more (§9) |

### 3.3 Rejected

- **Uniforms for the constants.** A plugin uniform lands in the material's
  uniform block, which every one of the 20 terrain stages declares, so it
  changes all 20; literals change only the fragment stages, and nothing needs to
  move at run time.
- **A wrapped diffuse on the sun for the ground.** The cards do not wrap the
  sun in the game (§1); wrapping the ground's sun would part the two across the
  hand-off rather than join them.
- **The cards' eye-ward normal on every light.** Tilting the shading normal
  17° toward the eye raises N·V at 30 m from 0.053 to 0.338 and with it takes
  most of the grazing reflection away, uncontrolled by `FAR_SPEC_CUT`. The tilt
  goes to the sun's diffuse alone (§6.2).
- **A whole specular cut.** At 16:00 it takes the far floor to 0.66 of the near
  floor before any colour change.

## 4. The weight

```
key  = clamp(cover + duff, 0, 1)
w    = smoothstep(0.05, 0.5, key) × smoothstep(FAR_COVER_BAND.x, FAR_COVER_BAND.y, dist)
```

`cover` is `vTerrainCover`, `duff` is `vTerrainW2.z`, `dist` the eye distance the
blend already computes from `terrainEye`. `FAR_SWARD_COVER` [0.05, 0.5] is the
near pull's band: nothing where the blade field stops growing, full from half
cover, which every closed canopy's sward is above (grass 0.94 there). Rock,
sand, pebbles, snow and a lake's bare shore carry neither grass nor litter and
take no weight; so the wet line, which sits on bare shore, keeps its gloss.

**The band.** `FAR_COVER_BAND` is [24, 30] m on high and medium: it starts 4 m
before the cards begin to dither at 28 m and is full 2 m into the dither,
where 17 % of the dither's span has passed. On the low tier every clutter edge
comes at 0.6 of its distance, and so does this one: [14.4, 18] m against the
low cards' [16.8, 24] m dither, starting 2.4 m before it and full 17 % into it.
The ground under the dissolving cards is most of the way to the far colour
before they thin, so the stipple shows one tone.

The low tier compiles its own fragment stage, so a define picks its band:
`TERRAINFARLOW`, declared false by the plugin and set true on the low tier. A
false boolean define writes nothing into a stage's text (`MaterialDefines`
writes `#define NAME` only for a true one), so medium and high are unchanged by
it; on low the line lands in the vertex stages too, since Babylon hands one
define list to both (§8.4).

At the edge of the September mid crop (26 m) the weight is 0.259: that crop's
mean must move by less than 1 % (§11.3).

## 5. The colour

### 5.1 The target

```
target = mix(FAR_SWARD, FAR_LITTER, clamp(duff, 0, 1))
       × macroTint(band-limited macro noise, 1 − n.y)
       × (1 − FAR_CANOPY_SHADE × clamp(ρ, 0, 1))
       × mix(FAR_CLUMP_AO, 1, clump)
albedo = mix(albedo, target, FAR_SWARD_MAX × w)
```

It runs after the horizon pull and the near sward pull and before the road,
feature and trail paints, so the trail keeps its own colours (its trampled band
is this ground, darkened toward the bench, and takes the cover's colour, as it
should).

### 5.2 The numbers

| Constant | Value | Meaning |
| --- | --- | --- |
| `FAR_SWARD` | (0.049, 0.081, 0.032) | the sward as the cards render it, linear albedo. Start: the grass palette (0.09, 0.15, 0.06) × 0.54, its hue kept and its value set by §5.4. Fitted (§7) |
| `FAR_LITTER` | (0.081, 0.057, 0.032) | the litter, linear albedo. Start: the needle bed (0.15, 0.105, 0.06) × the same 0.54. Fitted only where litter fills the crop (§7.3) |
| `FAR_SWARD_MAX` | 0.8 | the pull at full weight, the far sward design's |
| `FAR_CANOPY_SHADE` | 0.5 | the target × (1 − 0.5ρ), the cards' own shade (`writeFoliage`). Fitted in [0, 0.5] (§7.3) |
| `FAR_CLUMP_AO` | 0.65 | the clumps' troughs at 0.65 of the target, their crowns at 1; mean 0.824 over the world (§5.3) |

### 5.3 The clumps

Two octaves of value noise on the macro noise's lattice hash (`latticeHash`,
`groundHexNoise.fragment.fx`), interpolated with the smoothstep curve, with
their analytic gradient:

| Constant | Value | Meaning |
| --- | --- | --- |
| `FAR_CLUMP_CELL` | (0.8, 3.0) m | tussocks and patches |
| `FAR_CLUMP_WEIGHT` | (0.6, 0.4) | the octaves' shares |
| `FAR_CLUMP_SALT` | (41, 17) | lattice offset of the 3 m octave, so the two are not aligned |
| `FAR_CLUMP_WRAP` | 97 | cells per repeat: the hash's product term `0.0113·ci·cj` stays under 96² = 9,216, inside the 10⁴ where float32 and the CPU twin's float64 agree, anywhere in the world. The 0.8 m octave repeats every 77.6 m, the 3 m one every 291 m |
| `FAR_CLUMP_TILT` | 0.67 | the clumps' slope per unit of gradient (in cell units) |

Over 200,000 points the combined value has mean 0.496, 5th and 95th
percentiles 0.243 and 0.750; its gradient's root mean square is 0.398 and its
99th percentile 0.854 (cell units), so at `FAR_CLUMP_TILT` 0.67 the normal leans
15° on average and 30° at the 99th percentile.

**Band-limiting.** Each octave is faded to its mean, value 0.5 and gradient 0,
by `1 − smoothstep(0.5, 1.0, foot / cell)`, where `foot` is the larger
component of `fwidth(vPositionW.xz)`: full while a cell spans two pixels or more,
gone at one. The trough darkening then settles to its mean instead of rising
toward 1, so the far floor does not brighten with distance. From a 1.6 m eye
with the 1.4 rad vertical field of view, by rendered rows:

| Rendered rows | 0.8 m octave full / gone | 3 m octave full / gone |
| --- | --- | --- |
| 2,160 (high, 4K) | 31 / 44 m | 61 / 86 m |
| 1,080 (medium) | 22 / 31 m | 43 / 61 m |
| 480 (low: 720 rows at hardware scaling 1.5) | 15 / 21 m | 29 / 41 m |

The fine octave is a 4K detail; the patches carry the break-up on medium and
low.

**The macro tint.** The cards multiply their ground colour by the macro tint
(`writeFoliage`), past the floor's 80 to 140 m fade too. The far target carries
it, keyed on cover by the weight, and band-limited the same way: the 18 m and
6 m octaves are taken apart in the existing line (`macroN18`, `macroN6`, the
same arithmetic as `macroNoise`) and each is faded to 0.5 by its own footprint.
On high the 6 m octave holds to 86 m and the 18 m one to 149 m.

### 5.4 Why the start values are darker than the far sward design's

At the meadow pose at noon the card band reads at 0.32 to 0.40 of the far
floor. With the sun term of §6 taking the sun's share (about 0.65 of the open
ground's light at noon) to half and the cover normal leaving it at about 0.85,
the light factor is about 0.65 × 0.5 × 0.85 + 0.35 = 0.63; then
(0.2 + 0.8 × 0.824 × x) × 0.63 = 0.35 gives an albedo ratio x of 0.54 against
the bare grass palette. `FAR_SWARD` starts there: luminance 0.071, against
0.125 for the far sward design's value. The fit sets the committed value.

## 6. The light

### 6.1 The clumps' normal

The clumps tilt the shading normal as a height field: `normalW + (−g.x, 0,
−g.z) × FAR_CLUMP_TILT`, normalised, mixed in by the weight. Every light and the
image-based light see it, so a tussock is lit on its sun side and its trough
lies in its own shade. Its mean is up, so it leaves the grazing reflection
nearly as it was.

### 6.2 The sun: the cards' mean normal and their self-shadowing

On the sun's diffuse line only, the diffuse is scaled by

```
f = min(sat(dot(nCover, L)) / NdotL, FAR_SUN_GAIN_MAX) × mix(FAR_SELF_SHADOW, 1, sat(dot(V, L)))
diffuse × mix(1, f, w)
```

- `nCover` is the shading normal leaned toward the eye by `FAR_COVER_TILT` 0.3
  of its horizontal: 16.7°, the meadow cards' mean normal turned to the viewer
  (§1). Its gain over the ground's own N·L is 1.48 with a 29° sun behind the
  eye, 1.09 with a 65° sun behind it, 0.82 with a 65° sun ahead, 0.44 with a
  29° sun ahead. `FAR_SUN_GAIN_MAX` 2.0 caps it where the sun grazes the
  ground and N·L is near 0.
- `mix(FAR_SELF_SHADOW, 1, dot(V, L))` is the share of the cover's sunlit
  surface the eye sees: the hot spot of a vegetation canopy, where blades hide
  their own shadows with the sun behind the viewer (Hapke et al. 1996). V
  points to the eye and L to the sun. `FAR_SELF_SHADOW` starts at 0.5 and is
  fitted at the meadow pose with the sun ahead of the eye, where the term is
  `FAR_SELF_SHADOW` alone (§7.3). With a 29° sun behind the eye the term is
  0.950; with a 65° sun behind it 0.735; with the sun to the side or ahead 0.5.

Every other light, the fill and the image-based light are Babylon's own. The
cards' backlight runs on the headlamp, not the sun (§1), so the ground gets no
backlight either.

**Selecting the sun.** The plugin's regular-expression keys run after the
light include is unrolled per light and before the preprocessor resolves which
light type each is, so the text of every light holds the directional branch.
The rewrite therefore carries its own conditional on the light's digit,
`DIRLIGHT$2`: the factor is compiled into the directional light's line and no
other. It does not depend on the order lights were made in.

### 6.3 The specular weight

`terrainSpecW = 1 − FAR_SPEC_CUT × w × (1 − terrainWet)`, with `FAR_SPEC_CUT`
0.5, multiplies `metallicReflectanceFactors.a` through a second rewrite beside
the existing reflectivity one. In the legacy path that `.a` is the specular
weight, so F0 and F90 fall together. `terrainWet` is the weather's wetness: rain
gives the reflection back; in the mist preset (wetness 0.5) the cut is 0.25.

### 6.4 The paints step aside

The normal, the sun's factor and the cut are applied in a short block after the
road, feature and trail paints (`TERRAIN_FRAGMENT_FAR_LIGHT`), its weight
multiplied by `1 − terrainPaintW`. The road writes its gravel shoulder's weight
(`rGravel`, which contains the asphalt) to `terrainPaintW`, the trail the larger
of its bank (`tBank`) and its bench (`tOnBench`, core and margin). Inside them
the weight is 0, so the trail's puddles, its bench normals and the asphalt keep
everything they set, and at their soft edges the hand-off is continuous. The
feature paint only multiplies the colour and needs no line.

### 6.5 At a low sun

The bar (§11.2) comes from the September luminance ratio, 0.8 to 1.25: at
16:00 at the canopy pose the far floor sits under the near floor and within that
window of it, far over near in [0.8, 1.0]. Today it is 0.875 (0.0841 over 0.0961). What
holds it:

- **The cut is far-only.** The weight is 0 inside 24 m, so the near floor keeps
  its specular. The 14 % the near floor lost in the measurement came from
  cutting the whole material.
- **The cut is half.** A whole cut, far-only, gives 0.0636: 0.66 of the near
  floor. At 0.5 the far floor keeps 0.0739, 0.77.
- **The sun from behind gives back light.** The colour fitted at noon darkens
  the far floor's diffuse; at 16:00 with the sun behind the eye the cover's
  gain (1.48) and the near-full hot spot (0.950) lift its sunlit share by 1.40.
- **The worked range.** With the noon fit's darkening of 0.745 falling all on
  the albedo, as it would if the noon far floor were lit by the sky alone, and a
  sunlit share s of the far floor's diffuse at 16:00: s = 0.6 gives
  0.0636 × 0.745 × 1.24 + 0.0103 = 0.0691, 0.72 of the near; s = 0.8 gives 0.76.
  If the sun is 40 % of the noon far floor's light, `FAR_SELF_SHADOW` carries a
  quarter of the noon darkening, the albedo's share is 0.955, and s = 0.6 gives
  0.0856, 0.89.
- **The ladder.** If far over near is under 0.8 at 16:00, `FAR_SPEC_CUT` steps
  down by 0.125, to 0.375 and then 0.25, and no lower, since the measurement asks
  for a partial cut; each step gives back 0.125 × 0.0205 = 0.0026 at this pose (2.7 % of
  the near).
  If it is still under 0.8 at 0.25, the noon fit is moved to its +10 % edge and
  the low sun read again. If it is over 1.0, `FAR_SPEC_CUT` steps up instead.
  The colour is never fitted to a low sun.

## 7. The fit

### 7.1 The stills

1920 × 1080 at device pixel ratio 1, high tier on WebGPU, the free camera
pinned, every field updated at the free camera. The world clock runs while a
page is open, so each still is a fresh page and its sun altitude is recorded.
An uncommitted build reads `FAR_SWARD`, `FAR_LITTER`, `FAR_CANOPY_SHADE` and
`FAR_SELF_SHADOW` from the page's console in place of the literals, for the fit
alone.

| Pose | World | Free camera (x, y, z, yaw, pitch) | Ground in view |
| --- | --- | --- | --- |
| canopy | `room-3` | (140, 69.58, 400, 4.712, 0.15) | forest interior, canopy 0.86 at the eye, 0.99 along 70 m ahead, facing −x |
| meadow | `room-5` | (−66.5, 43.17, 243.6, 1.571, 0.12) | a meadow of 60 m radius from its west edge, facing +x |
| second meadow | `room-6` | (214.2, 100.69, 260, 1.571, 0.12) | a meadow of 77 m radius; looked at, not fitted |

September's canopy pose (seed `atmo`) is not used for the fit: its ground
crests 22 to 27 m out and no far ground is in view.

Crops, rows then columns in percent: at the canopy pose far middle (38–47,
45–70), far right (37–45, 83–99), card band (47–54, 40–68), near (60–80, 0–45);
at the meadow far left (40–45, 0–25), far right (41–45, 75–100), card band
(47–52, 20–80), near (60–80, 0–45). Before the fit each is drawn back onto the
control still and checked to lie on ground, clear of trunks, the lake and props;
with the cards hidden the card band's mean must rise, showing the cards fill it.
Each pixel is decoded from sRGB to linear; the crop's mean colour is the mean
per channel, its Y is 0.2126 R + 0.7152 G + 0.0722 B, its chroma
(max − min) / Y. A pose's two far crops are pooled for the fit, pixel-weighted,
and reported apart.

### 7.2 The linear fit

The near-grass method: under fixed light and fog a crop's mean in one channel is
affine in that channel's albedo, `c = a + b × albedo`. Two stills, the value
under fit at its start and at 0.5 of it, give a and b per channel; the albedo
that puts the far crop on its target is `(target − a) / b`. A third still at the
solved value confirms it; if it misses by more than the tolerance, the solve is
repeated from the last two stills. A scalar (`FAR_CANOPY_SHADE`,
`FAR_SELF_SHADOW`) is fitted the same way on Y.

**Targets, on the branch's own still:**

| Quantity | Target |
| --- | --- |
| Far crop Y | within ±10 % of the card band's Y |
| Far crop chroma | at least 0.75 of the card band's |
| Far crop G / R | within ±10 % of the card band's |

### 7.3 The order

1. **Meadow, noon:** `FAR_SWARD` per channel, `FAR_SELF_SHADOW` at 0.5. Its
   ground has no canopy and next to no litter.
2. **Meadow, 16:00:** the sun is ahead of the eye, so the sun's term is
   `FAR_SELF_SHADOW` alone; fitted as a scalar in [0.3, 0.8] on Y. Then step 1
   once more.
3. **Canopy, noon:** `FAR_CANOPY_SHADE` as a scalar in [0, 0.5] on Y. The
   canopy-tinted palette is already 0.63 of the open one in value, and the
   arithmetic of §5.4 applied to the canopy's 0.745 expects the fit near 0 to
   0.1, under the cards' own 0.5. Then `FAR_LITTER` per channel, only if the far
   crop's mean litter weight, read from the simulation along the crop's rays, is
   at least 0.3; otherwise it keeps its start.
4. **Canopy, 16:00:** the low-sun check and its ladder (§6.5).

The committed literals carry the fit's numbers beside them in the include's
comments and in the twin's.

## 8. The code

### 8.1 The include: `client/src/game/shaders/groundFarCover.fragment.fx`

Spliced at `CUSTOM_FRAGMENT_DEFINITIONS` after the hex include, inside the
`TERRAINTEX` guard, by `terrainFarCoverDefs()` in `terrainTexture.ts`. The
three hex files are not touched, so their pinned join holds.

```glsl
// The far ground's cover: the constants and functions the terrain's far
// cover reads, spliced by TerrainTexturePlugin at CUSTOM_FRAGMENT_DEFINITIONS
// after the hex include, inside its TERRAINTEX guard, so latticeHash is in
// scope. Every constant mirrors groundHexParams.ts and a lockstep test
// asserts they agree.
//
// The clump noise is the macro noise's lattice hash on cells wrapped to
// FAR_CLUMP_WRAP, so the hash's product term stays under the bound where the
// CPU twin agrees with it, anywhere in the world.
//
// COMMENT RULES: no semicolon inside a trailing comment on a code line, no
// hashed preprocessor keyword in comment prose.

#ifdef TERRAINFARLOW
const vec2 FAR_COVER_BAND = vec2(14.4, 18.0);
#else
const vec2 FAR_COVER_BAND = vec2(24.0, 30.0);
#endif
const vec2 FAR_SWARD_COVER = vec2(0.05, 0.5);
const float FAR_SWARD_MAX = 0.8;
const vec3 FAR_SWARD = vec3(0.049, 0.081, 0.032);
const vec3 FAR_LITTER = vec3(0.081, 0.057, 0.032);
const float FAR_CANOPY_SHADE = 0.5;
const vec2 FAR_CLUMP_CELL = vec2(0.8, 3.0);
const vec2 FAR_CLUMP_WEIGHT = vec2(0.6, 0.4);
const vec2 FAR_CLUMP_SALT = vec2(41.0, 17.0);
const float FAR_CLUMP_WRAP = 97.0;
const float FAR_CLUMP_AO = 0.65;
const float FAR_CLUMP_TILT = 0.67;
const float FAR_COVER_TILT = 0.3;
const float FAR_SPEC_CUT = 0.5;

// The far cover's weight in [0, 1]: any cover the near field draws, grass or
// litter, ramped in over the tier's band of eye distance. Mirrors
// farCoverWeight.
float farCoverWeight(float cover, float duff, float dist) {
  float key = clamp(cover + duff, 0.0, 1.0);
  return smoothstep(FAR_SWARD_COVER.x, FAR_SWARD_COVER.y, key) * smoothstep(FAR_COVER_BAND.x, FAR_COVER_BAND.y, dist);
}

// One octave of value noise and its gradient in cell units: xy the
// gradient, z the value in [0, 1]. Mirrors farClumpOctave.
vec3 farClumpOctave(vec2 p, float cell, vec2 salt) {
  vec2 q = p / cell;
  vec2 c = floor(q);
  vec2 f = q - c;
  vec2 u = f * f * (3.0 - 2.0 * f);
  vec2 du = 6.0 * f * (1.0 - f);
  vec2 c0 = mod(c + salt, FAR_CLUMP_WRAP);
  vec2 c1 = mod(c + salt + 1.0, FAR_CLUMP_WRAP);
  float a = latticeHash(c0);
  float b = latticeHash(vec2(c1.x, c0.y));
  float d = latticeHash(vec2(c0.x, c1.y));
  float e = latticeHash(c1);
  float k = a - b - d + e;
  float n = a + (b - a) * u.x + (d - a) * u.y + k * u.x * u.y;
  return vec3(du.x * (b - a + k * u.y), du.y * (d - a + k * u.x), n);
}

// The two octaves, each faded to its mean where its cell spans under two
// pixels. foot is the pixel's footprint on the ground in metres. Mirrors
// farClump.
vec3 farClump(vec2 p, float foot) {
  vec3 o1 = farClumpOctave(p, FAR_CLUMP_CELL.x, vec2(0.0));
  vec3 o2 = farClumpOctave(p, FAR_CLUMP_CELL.y, FAR_CLUMP_SALT);
  float b1 = FAR_CLUMP_WEIGHT.x * (1.0 - smoothstep(0.5, 1.0, foot / FAR_CLUMP_CELL.x));
  float b2 = FAR_CLUMP_WEIGHT.y * (1.0 - smoothstep(0.5, 1.0, foot / FAR_CLUMP_CELL.y));
  return vec3(b1 * o1.xy + b2 * o2.xy, 0.5 + b1 * (o1.z - 0.5) + b2 * (o2.z - 0.5));
}
```

The band-limit is written `1.0 - smoothstep(0.5, 1.0, x)` because GLSL leaves
`smoothstep` undefined for a first edge above the second.

### 8.2 The terrain plugin: `client/src/game/terrainTexture.ts`

**`TERRAIN_FRAGMENT_MAIN_BEGIN`** gains four unconditional locals, for the same
reason the two it has are unconditional (the rewrites read them whatever the
defines say):

```glsl
float terrainRough = 1.0;
float terrainF0 = 1.0;
float terrainSpecW = 1.0;
float terrainFarW = 0.0;
float terrainPaintW = 0.0;
vec3 terrainFarN = vec3(0.0, 1.0, 0.0);
```

**`TERRAIN_FRAGMENT_BLEND`.** The macro line is taken apart into its octaves,
with the same arithmetic and result as `macroNoise`:

```glsl
  float macroN18 = macroValueNoise(vPositionW.xz, MACRO_WAVE.x);
  float macroN6 = macroValueNoise(vPositionW.xz, MACRO_WAVE.y);
  vec3 macroRgb = macroTint(MACRO_WEIGHT.x * macroN18 + MACRO_WEIGHT.y * macroN6, 1.0 - terrainN.y);
  surfaceAlbedo *= mix(vec3(1.0), macroRgb, w0 * terrainMacroOn * (1.0 - smoothstep(terrainFade.x, terrainFade.y, dist)));
```

and after the sward pull, before the roughness lines, the far block. The
footprint is taken before the branch, in uniform control flow:

```glsl
  // Far cover: past the band where the meadow cards thin out, ground under
  // any cover the near field draws, grass or litter, takes the colour the
  // cover renders at, clumps darker in their troughs, and the lush and dry
  // tint the cards carry. Its normal and reflectance are applied after the
  // paints, in TERRAIN_FRAGMENT_FAR_LIGHT, so the road and the trail keep
  // their own. Constants in the far-cover include.
  vec2 fcFw = fwidth(vPositionW.xz);
  float fcFoot = max(fcFw.x, fcFw.y);
  terrainFarW = farCoverWeight(vTerrainCover, vTerrainW2.z, dist);
  if (terrainFarW > 0.0) {
    vec3 fcClump = farClump(vPositionW.xz, fcFoot);
    float fcB18 = 1.0 - smoothstep(0.5, 1.0, fcFoot / MACRO_WAVE.x);
    float fcB6 = 1.0 - smoothstep(0.5, 1.0, fcFoot / MACRO_WAVE.y);
    vec3 fcMacro = macroTint(MACRO_WEIGHT.x * mix(0.5, macroN18, fcB18) + MACRO_WEIGHT.y * mix(0.5, macroN6, fcB6), 1.0 - terrainN.y);
    vec3 fcTarget = mix(FAR_SWARD, FAR_LITTER, clamp(vTerrainW2.z, 0.0, 1.0))
      * fcMacro
      * (1.0 - FAR_CANOPY_SHADE * clamp(vTerrainW2.w, 0.0, 1.0))
      * mix(FAR_CLUMP_AO, 1.0, fcClump.z);
    surfaceAlbedo = mix(surfaceAlbedo, fcTarget, FAR_SWARD_MAX * terrainFarW);
    terrainFarN = normalize(normalW + vec3(-fcClump.x, 0.0, -fcClump.y) * FAR_CLUMP_TILT);
  }
```

**`TERRAIN_FRAGMENT_FAR_LIGHT`**, a new string appended to
`CUSTOM_FRAGMENT_BEFORE_LIGHTS` after `TRAIL_FRAGMENT_PAINT`:

```glsl
#ifdef TERRAINTEX
{
  // The far cover's light, after the paints: its weight steps aside wherever
  // the road or the trail painted its own surface. The clumps' normal goes to
  // every light, and the specular weight, which sets the grazing reflectance
  // as well as F0, is cut by FAR_SPEC_CUT and given back as the ground wets.
  // The sun's diffuse line reads terrainFarN and terrainFarW again for the
  // cover's own answer to the sun.
  terrainFarW *= 1.0 - terrainPaintW;
  if (terrainFarW > 0.0) {
    normalW = normalize(mix(normalW, terrainFarN, terrainFarW));
    vec3 fcEye = vec3(viewDirectionW.x, 0.0, viewDirectionW.z);
    fcEye /= max(length(fcEye), 1e-4);
    terrainFarN = normalize(normalW + fcEye * FAR_COVER_TILT);
    terrainSpecW = 1.0 - FAR_SPEC_CUT * terrainFarW * (1.0 - terrainWet);
  }
}
#endif
```

Where the weight is 0 nothing is written, so the ground inside the band is
byte for byte what it was, and the sun's factor below is exactly 1.

**Two new regular-expression keys** in `getCustomCode("fragment")`, beside the
reflectivity one:

- `TERRAIN_SPEC_INJECTION_POINT`,
  `"!vec4 metallicReflectanceFactors=vMetallicReflectanceFactors;"`, replaced by
  `"vec4 metallicReflectanceFactors=vec4(vMetallicReflectanceFactors.rgb,vMetallicReflectanceFactors.a*terrainSpecW);"`.
  It matches once in Babylon 9.18's PBR fragment, inside its metallic-workflow
  branch, which the terrain compiles.
- `FOLIAGE_LIGHT_INJECTION_POINT`, imported from `foliageLightPlugin.ts` (the
  terrain never carries that plugin, so the key is not applied twice), replaced
  by `TERRAIN_SUN_INJECTION_CODE`, built from the twin's constants:

```glsl
#ifdef DIRLIGHT$2
info.diffuse=computeDiffuseLighting(preInfo,$1)*mix(1.0,min(clamp(dot(terrainFarN,preInfo.L),0.0,1.0)/preInfo.NdotL,2.0)*mix(0.5,1.0,clamp(dot(viewDirectionW,preInfo.L),0.0,1.0)),terrainFarW);
#else
info.diffuse=computeDiffuseLighting(preInfo,$1);
#endif
```

The pattern matches only the plain diffuse line, not the translucency or
hemispheric ones, so the inserted conditional nests inside that line's own
`else` branch. `preInfo.NdotL` is never 0 (Babylon's `saturateEps`), and the
gain is capped at `FAR_SUN_GAIN_MAX` 2.0, so the factor is finite and
`mix(1.0, f, 0.0)` is exactly 1.

**The define.** The constructor declares `TERRAINFARLOW: false`;
`prepareDefines` sets it from `_farLow`; `setFarLow(low: boolean)` sets that and
marks the defines dirty when it changes; and a module function
`setTerrainFarBand(_scene: Scene, material: PBRMaterial, low: boolean): void`,
defensive on a bare material like `setTerrainSward`, is called once by
`renderer.ts` beside it: `setTerrainFarBand(scene, terrainMaterialFor(scene,
"terrain"), tier === "low")`.

### 8.3 The paints

- `roadPaint.ts`, `ROAD_FRAGMENT_PAINT`, after the asphalt's F0 line:
  `terrainPaintW = max(terrainPaintW, rGravel);`
- `trailPaint.ts`, `TRAIL_FRAGMENT_PAINT`, after `float tGravel = …`:
  `terrainPaintW = max(terrainPaintW, max(tBank, tOnBench));`

Both run only where their road or trail is, and both are fragment text.

### 8.4 What the corpus changes by

- The terrain's fragment stage on medium and high: new text (the include, the
  far block, the macro line, the far-light block, the rewrites, the paints'
  lines). One stage.
- The terrain's fragment stage on low: the same, and `#define TERRAINFARLOW`.
  One stage.
- The terrain's four low vertex stages: the define's line only; their code is
  otherwise byte for byte the same.
- The 14 medium and high vertex stages: unchanged, since a false define writes
  nothing and no uniform is added.

Six stages are recorded again on their tiers (`?wgsl=record` pages at the
canopy and meadow poses and the corpus's usual poses, then
`tools/wgsl/merge-corpus.mjs`), and the six they replace leave the corpus, as no
page can ask for them again; `tiers.json` is rewritten by the merge. A uniform
would have changed all 20.

## 9. The CPU twin: `client/src/game/groundHexParams.ts`

Beside `swardWeight`, Babylon-free, every constant exported with the include's
value:

```ts
export const FAR_COVER_BAND: readonly [number, number] = [24, 30];
export const FAR_COVER_BAND_LOW: readonly [number, number] = [14.4, 18];
export const FAR_SWARD_COVER: readonly [number, number] = [0.05, 0.5];
export const FAR_SWARD_MAX = 0.8;
export const FAR_SWARD: Rgb = { r: 0.049, g: 0.081, b: 0.032 };
export const FAR_LITTER: Rgb = { r: 0.081, g: 0.057, b: 0.032 };
export const FAR_CANOPY_SHADE = 0.5;
export const FAR_CLUMP_CELL: readonly [number, number] = [0.8, 3];
export const FAR_CLUMP_WEIGHT: readonly [number, number] = [0.6, 0.4];
export const FAR_CLUMP_SALT: readonly [number, number] = [41, 17];
export const FAR_CLUMP_WRAP = 97;
export const FAR_CLUMP_AO = 0.65;
export const FAR_CLUMP_TILT = 0.67;
export const FAR_COVER_TILT = 0.3;
export const FAR_SELF_SHADOW = 0.5;
export const FAR_SUN_GAIN_MAX = 2;
export const FAR_SPEC_CUT = 0.5;

/** The far cover's weight in [0, 1] at a fragment. Mirrors farCoverWeight. */
export function farCoverWeight(cover: number, duff: number, dist: number, low = false): number;
/** One octave: value in [0, 1] and its gradient in cell units. The wrap is
 * GLSL's mod, never negative. Mirrors farClumpOctave term for term. */
export function farClumpOctave(x: number, z: number, cell: number, salt: readonly [number, number]): { n: number; gx: number; gz: number };
/** The two octaves band-limited by the pixel footprint `foot` (m). */
export function farClump(x: number, z: number, foot: number): { n: number; gx: number; gz: number };
/** The far target before the pull: litter weight, ρ, the macro tint, the clump value. */
export function farCoverTarget(duff: number, canopy: number, macro: Rgb, clump: number): Rgb;
/** The sun's diffuse factor: mix(1, gain × visibility, w). */
export function farSunFactor(coverNdotL: number, groundNdotL: number, vDotL: number, w: number): number;
/** The specular weight: 1 − FAR_SPEC_CUT × w × (1 − wet). */
export function farSpecWeight(w: number, wet: number): number;
```

`TERRAIN_SUN_INJECTION_CODE` interpolates `FAR_SELF_SHADOW` and
`FAR_SUN_GAIN_MAX` as GLSL float literals, so those two live in the twin and the
injection, not the include.

## 10. Tiers, costs and shaders

| Tier | Window, rendered | Band | Clumps | Sun factor and cut |
| --- | --- | --- | --- | --- |
| high | 3840 × 2160 (a 1080p window at hardware scaling 0.5) | [24, 30] m | both octaves | yes |
| medium | 1920 × 1080 | [24, 30] m | the 3 m octave mostly; the 0.8 m one only to 31 m | yes |
| low | a 1280 × 720 window at hardware scaling 1.5 | [14.4, 18] m, `TERRAINFARLOW` | the 3 m octave | yes |

Low has no blades, litter pieces or sward pull, and its cards end at 24 m: it
gains the most.

**Cost.** Estimates scaled from the game's own measurements (the grass floor's
hex tiling, about +3 ms at four times the pixels for six to twelve fetches and
nine to eighteen sine hashes a fragment), not measured. The far block is
branched on its weight, so only far-band fragments pay its 8 lattice hashes and
30 to 40 instructions, with no texture read. The sun's factor is about 10
instructions on every terrain fragment, inside the sun's line.

| Tier | Far block | Sun factor | Together |
| --- | --- | --- | --- |
| High, 4K | +0.1 to +0.3 ms | +0.02 to +0.06 ms | +0.12 to +0.36 ms |
| Medium, 1080p | +0.03 to +0.08 ms | under +0.02 ms | +0.03 to +0.10 ms |
| Low, 720p | +0.02 to +0.04 ms | under +0.02 ms | +0.02 to +0.06 ms |

**Shaders.** The fragment stages change on every tier and the four low vertex
stages by one line (§8.4). On WebGL2, `webglIdentity.test.ts` re-pins
`terrain.fragment` (new text) and `terrain.interface` (the new define); the
foliage, foliage-light and every other pin hold.

## 11. Tests and checks

### 11.1 Tests

Pure tests run under vitest's default limit. Each test that compiles a
material on a `NullEngine` and waits for it to be ready is given
`timeLimit(20_000)`.

- **`groundHexParams.test.ts`, "the far cover":**
  - The constants as literals, every one in §9, `FAR_SWARD` and `FAR_LITTER`
    at their committed (fitted) values.
  - `farCoverWeight(1, 0, 30)` is 1; `(1, 0, 24)` is 0; `(1, 0, 27)` is 0.5
    (to 10 places); `(1, 0, 26)` is 0.25925925925925924; `(0.275, 0, 40)` is
    0.5; `(0.2, 0.075, 40)` is 0.5 (litter counts as cover); `(0.03, 0.01, 40)`
    is 0; `(1, 0, 18)` is 0; low: `(1, 0, 14.4, true)` is 0, `(1, 0, 16.2,
    true)` is 0.5, `(1, 0, 18, true)` is 1.
  - `farClumpOctave(0, 0, 0.8, [41, 17])` has `n` 0.708916 (to 9 places) and
    gradient 0, a lattice corner; `farClumpOctave(1.0, 0.3, 0.8, [0, 0])` is
    `n` 0.41637451416015636, `gx` −0.06973240429687515, `gz`
    −0.6310102148437498 (to 12 places), and the same at x = 1.0 + 97 × 0.8 (the
    wrap); its gradient matches a central difference of `n` to 1e-4 at five
    points.
  - `farClump(x, z, 3.0)` is `n` 0.5 and gradient 0 at any point (both octaves
    gone); at `foot` 0.4 it is the full weighted sum.
  - `farCoverTarget(0, 0, white, 1)` is `FAR_SWARD`; `(1, 1, white, 1)` is
    `FAR_LITTER` × (1 − `FAR_CANOPY_SHADE`); `(0, 0, white, 0)` is `FAR_SWARD`
    × 0.65.
  - `farSunFactor(0.716, 0.485, 0.899, 1)` is 1.4017360824742269 (to 9
    places), the 29° sun behind the eye; `(0.716, 0.485, −0.848, 1)` is
    0.7381443298969073; `(0.37, 0.087, 0.9, 1)` is 1.9, the cap; any arguments
    with `w` 0 give exactly 1.
  - `farSpecWeight(1, 0)` is 0.5; `(1, 1)` is 1; `(0.5, 0.5)` is 0.875;
    `(0, 0)` is 1.
- **`groundFarCover.test.ts`, the lockstep:** the include carries every
  constant verbatim (`const vec3 FAR_SWARD = vec3(0.049, 0.081, 0.032);` and
  the rest, built from the twin's values), both bands under the define, the
  hash called as `latticeHash(c0)` with `mod(c + salt, FAR_CLUMP_WRAP)`, the
  band-limit as `1.0 - smoothstep(0.5, 1.0,`, and no `texture`, `discard` or
  `uniform`; `TERRAIN_SUN_INJECTION_CODE` carries `mix(0.5,1.0,` and
  `,2.0)` from `FAR_SELF_SHADOW` and `FAR_SUN_GAIN_MAX`. Through Babylon's
  `Process`, the include with `TERRAINFARLOW` defined keeps
  `vec2(14.4, 18.0)` and drops `vec2(24.0, 30.0)`, and without it the reverse.
- **`terrainTexture.test.ts`:**
  - The splice order: the include after the hex include and before
    `ROAD_FRAGMENT_DEFS`; `CUSTOM_FRAGMENT_BEFORE_LIGHTS` is the blend, the road,
    feature and trail paints, then `TERRAIN_FRAGMENT_FAR_LIGHT`;
    `TERRAIN_FRAGMENT_MAIN_BEGIN` declares the six locals of §8.2.
  - The far block's lines pinned as substrings, after the sward pull; the macro
    line's split form.
  - `TERRAIN_SPEC_INJECTION_POINT` matches `ShaderStore.ShadersStore.pbrPixelShader`
    exactly once; the light key matches the `lightFragment` include once, on
    `diffuse{X}.rgb`.
  - No uniform is added: the UBO list is the 22 names it has today, as
    literals.
  - `TERRAINFARLOW` is false after construction and true after
    `setTerrainFarBand(scene, material, true)`.
  - Compiled fragment source on both paths (a default `NullEngine` without
    uniform buffers, and one with them), each `timeLimit(20_000)`: it contains
    `farCoverWeight(`, `vMetallicReflectanceFactors.a*terrainSpecW` and the
    sun factor inside `DIRLIGHT1`'s line and in no other light's.
- **`trailPaint` and `roadPaint` tests:** the two `terrainPaintW` lines pinned.
- **`webglIdentity.test.ts`:** the two re-pins, and a test that strips the
  far-cover text (the include, the far block, the far-light block, the four
  locals, the two paint lines, the two rewrites, and the macro line back to its
  one-line form) and gets the old `terrain.fragment` hash, so the far cover is
  the whole difference.
- **`shaderHygiene.test.ts`** lints the new `.fx` file as it does every other:
  no semicolon in a trailing comment, no hashed keyword in comment prose, its
  functions still declared once processed with `TERRAINFARLOW` on.

### 11.2 The fit and the look

The fit of §7 at noon bright, with these bars on the branch's own stills:

| Pose, scene | Bar |
| --- | --- |
| canopy, noon bright | far Y within ±10 % of the card band's; chroma ≥ 0.75 of it; G / R within ±10 % |
| meadow, noon bright | the same |
| canopy, 16:00 clear (sun behind the eye) | far middle over near in [0.8, 1.0], by the ladder of §6.5; far right reported (0.60 of the near today) |
| meadow, 16:00 clear (sun ahead) | far Y within ±10 % of the card band's (the self-shadow's fit) |
| both, noon mist | reported; the far crop's Y does not rise and its chroma does not fall |
| second meadow, noon, mist, 16:00 | reported beside the others |

Stills at noon, in mist and at a low sun at all three poses, the sun pinned
and its altitude recorded, beside controls from `main` taken back to back. A
walk at each fit pose on the free camera, 0.5 m steps from 40 m short of a
painted patch to 20 m short of it, a still at each: no line at the band, nothing
appears or vanishes between stills. A turn in place through a full circle in
sixteen steps at the canopy pose at 16:00: the far ground brightens toward the
sun's back and darkens toward the sun smoothly, as the cards do. The trail
seen across the band keeps its colour and its edge. Zero console errors on
every page.

### 11.3 Regressions

- September's near-grass bars at its two poses (seed `atmo`, 1200 × 2029, mist,
  noon): near over mid luminance 1.25 (canopy) and 0.96 (meadow) and cover
  ratios 0.62 and 0.94, each within 0.01; the mid crop's mean moved by under
  1 %; the meadow pose's far crop (`240:16:480:708`, 0.0621 today) reported.
- The floor-look bed over beside ratio at `meadow-trail-along`, against its 0.9
  to 1.3 window.

### 11.4 Frame time

Paired pages against `main`, at the canopy and meadow poses, on high at
3840 × 2160 (a 1080p window at hardware scaling 0.5, WebGPU), on medium at
1920 × 1080 and on low in a 1280 × 720 window. Fresh pages in the order A B B A
and B A A B, every other page blanked, 3 s to settle and three 5 s samples a
page, mean and p95; a same-build pair beside them shows the noise; the load
average is recorded at each start, and no dev server of other work or test suite
runs meanwhile. On this Mac the frames present on vsync, and a pair of pages on
one build reads about 0.5 ms apart, so the estimates of §10 are under what the
pairs resolve: the check is that each tier's mean difference sits inside the
same-build pair's spread, and a pair above +0.5 ms on high is followed up with
the far block's branch and the sun factor taken out one at a time.

### 11.5 The corpus

After the six stages are recorded again (§8.4), `tools/wgsl/check-build.mjs`
checks the built maps, and one fresh page a tier at the canopy pose at noon
and at 16:00 asks for no terrain stage the maps lack, on WebGPU, with no console
error.

## 12. Out of scope

**Sparse far tuft cards, wider as they thin.** What paint cannot give: a broken
line where cover meets trunks and the trail, and things standing in the ground
to 80 m. A renderer-only fill like the forest's off-lattice impostor fill,
reading `groundCover` from the sim: a lattice walk across 28 to 80 m starting at
0.5 per m² and thinned fourfold per doubling of distance by a per-instance hash,
so an instance that survives at 60 m also exists at 30 m and walking in only
adds cards, about 2,600 instances, 500 to 700 drawn after `grassCull.ts`; one new
bucket on the meadow card's 20-vertex LOD1, its ground colour and canopy shade
from `writeFoliage`, fading in over the meadow's out-band and out by sinking
over 70 to 80 m; widened in the vertex stage by `1 + 1.5 × smoothstep(28, 80, d)`
under a new `FOLIAGE_WIDEN` define. Estimated +0.1 to +0.25 ms on high at 4K,
+0.05 to +0.15 ms on medium, off on low or about +0.05 ms at 0.6 of its
distances. New stages for the new variant on each tier, and the 35 recorded
foliage fragment stages must keep their hashes. It comes after this design,
fitted to its colour, or the cards read as spots on a mismatched floor.

**Trunk-base grounding.** Past 25 m the trunks meet the ground in clean lines.
The lowest 0.3 to 0.5 m of bark tinted toward the far-cover colour with a noisy
upper edge, by `smoothstep(0.5, 0.2, h + noise) × smoothstep(20, 30, d) ×
(1 − smoothstep(100, 120, d))`, h the height above the instance origin passed as
a varying under a new define on the bark materials only (the foliage plugin's
tree profile), fading out before the 120 m impostor seam, where 0.4 m is about
4 pixels at 4K. It discards nothing, so the bark stays opaque. Under +0.05 ms at
4K, negligible on medium and low; the near tree buckets' bark stages recorded
again on each tier.

**The cards' sun.** `FoliageLightPlugin` meets the sun at light 1 in the game
and wraps the headlamp instead (§1). Choosing the sun by the same `DIRLIGHT$2`
conditional this design uses would change the 23 recorded fragment stages that
carry it and the `foliageLight.fragment` pin, and would change how every card
and blade is lit at every distance; the far ground's sun factor would then be
fitted again to match.

Also left: a backlit glow on the far ground toward a low sun (the cards have
none on the sun); a wind shimmer on the paint; the trail's banks, which take
the vertex colour and so stay pale through the band; and the lake's mirror,
which draws the shore with its own cheap terrain material and keeps today's far
colour in the reflection.

## 13. As built (2026-10-10)

The build followed §4 to §9 with the departures below, each from what the fit's stills showed.

**The pull is whole (§5.2).** `FAR_SWARD_MAX` is 1.0, not the far sward design's 0.8. At 0.8 a fifth of the ground's own colour stays under the paint, and at the meadow pose at noon that fifth with the sky's and the fog's light already read as the card band's luminance (0.039 against 0.038), so the luminance bar was met with the colour at its floor while chroma and G/R failed: halving the colour closed about half the gap. At 1.0 the fit lands within 1 % of the band. The start values quoted in §6.2, §6.3, §8.2 and in §11.1's expectations are the start set; the committed set is this section's.

**The fitted values (§7).** Meadow, noon: `FAR_SWARD` solved at (0.0066, 0.0235, 0.005), where the far crops read 1.01 of the band's Y, 0.99 of its chroma and 1.00 of its G/R, and committed at its +10 % edge, (0.0073, 0.0258, 0.0055), which the low-sun ladder asked for and which bought 0.001 of far over near at 16:00. At the committed colour the far crops read Y 0.0418 against the band's 0.0381 (1.10, the bar's top), chroma 0.210 against 0.213 and G/R 1.00 of the band's. Meadow, 16:00: `FAR_SELF_SHADOW` at its 0.8 ceiling, the far crops at Y 0.0573 against the band's 0.0733, 0.78 of it with the sun ahead of the eye; the fit wanted 3.8, so the sun's term as designed cannot lift the far floor to the cards at a low sun. Canopy, noon: `FAR_CANOPY_SHADE` 0.4615, the far crops at Y 0.0263 against the band's 0.0257 (1.02), their chroma 0.26 of the band's and G/R 0.85: the canopy's far crops carry trunks and fog, so the chroma bar is not reachable by that crop. `FAR_LITTER` keeps its start; the litter share along the crops was not read from the simulation. Canopy, 16:00: far over near 0.72 at a cut of 0.5, 0.74 at 0.375, 0.77 at 0.25 and 0.77 with the colour at its edge, under the 0.8 bar; `FAR_SPEC_CUT` is 0.25. The readings of the committed set were taken at the sun's altitude 76° at noon and 29° at 16:00, bright, 1920 × 1080 on the high tier. The stills at both poses read as the cover continuing past the cards where the control's floor was a pale plane.

**The corpus (§8.4, §11.5).** Nine stages were recorded on the three tiers at the canopy and meadow poses and, on the low tier, at the sea, the dawn cove, the lake and the trailhead in four weathers: the terrain's fragment stage on medium and high and its fragment stage on low, each in its uniformity-off form, one of its low vertex variants, and six low stages of other materials the corpus never held: a plain PBR pair that carries only the atmosphere and two distance-fade wet pairs, a fragment and a vertex stage each. Six old stages are retired: the two fragment stages the far cover's text replaced, the one low vertex variant with a recorded successor, and three low vertex variants from before the atmosphere's cloud uniforms, which no page could produce any more. The corpus holds 1,306 stages, 423 on low, 832 on medium, 872 on high; §8.4 counted six changed stages, two fragment and four low vertex, but only one low vertex variant was live.

**Checks.** The fit's stills at noon and 16:00 at both poses, 1920 × 1080 on the high tier; with the cards hidden the band's mean rose at both poses (meadow 0.0382 → 0.0399, canopy 0.0257 → 0.0270), so the band lies on cards. §11.5: a fresh page a tier at each fit pose, on WebGPU with the shipped maps, asked for no stage the maps lack (0 misses of the 176 to 232 stages each page met). Still owed before the merge: §11.2's walks, turn and mist stills, §11.3's September bars and the mid crop, §11.4's frame-time pairs, and the stills on medium and low.

## References

- [A full far ground without drawing it](https://csarko.sh/research/a-full-far-ground-without-drawing-it),
  the research page: what the code draws past 18 m, what shipped engines
  document, the ground-side, silhouette and lighting tricks.
- [Grass frame reclaim](2026-09-26-grass-frame-reclaim-design.md), §6, the far
  sward designed and not built; its [verification](2026-09-26-grass-frame-reclaim-verification.md),
  §2 and §3.1, the far crop and why September's canopy pose has none.
- [Near grass fullness](2026-09-25-near-grass-fullness-design.md), §4.2 (linear
  crops and the 0.8 to 1.25 luminance ratio) and §5.2 (the sward pull and the
  per-vertex cover).
- [The lake's mirror and ripples](2026-10-07-lake-mirror-design.md), its cost
  section: the A B B A pairs and what they resolve on vsync.
- B. Hapke, D. DiMucci, R. Nelson, W. Smythe, "The cause of the hot spot in
  vegetation canopies and soils: shadow-hiding versus coherent backscatter,"
  Remote Sensing of Environment, 1996.
- I. Quilez, "Value noise derivatives," https://iquilezles.org/articles/morenoise/,
  and "Bandlimiting," https://iquilezles.org/articles/bandlimiting/.
- J. Andersson, "Terrain Rendering in Frostbite Using Procedural Shader
  Splatting," SIGGRAPH 2007 course notes: the grass and the ground under it
  share colour and lighting.
