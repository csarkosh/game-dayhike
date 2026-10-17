# Trunk moss: moss on the wet side of the trees

**Design, 2026-10-14.** Old growth: moss on the trunks. Each giant and
sapling and the alder wears its bark set
(`docs/rendering/2026-10-14-tree-bark-textures.md`); over the bark a layer of
moss grows on the wet side of the trunk, low on the trunk, in the bark's
fissures, more on some trees than others. This design adds one material
plugin on every bark material the forest dresses, one colour map shared by
all of them, one varying and one sampler, and no uniform: every constant is a
literal, settled in the browser.

Renderer-only: nothing in the world's shape reads it, and the level id does
not move.

## 1. Decisions

| question | decision |
| --- | --- |
| The map | The colour map of a moss-over-wood scan alone, `textures/moss.wood.1k.ktx2` (sRGB, a 1.00 × 1.00 m plate at 1024 px, in the bark sets' KTX2 form); its normal and ARM maps ship beside it and are not read (§2) |
| The mask | Four terms, multiplied, then an edge: the band up the trunk, the side, the tree's own amount, and the map's own growth (§3) |
| The height | The vertex's height above the tree's foot in the model's own metres, written by the vertex stage from the model position, so no instance scale divides it (§3.1) |
| The side | The geometric normal's dot with one wet-side vector, not the bumped normal (§3.2) |
| The tree | A draw hashed from the tree's foot in world space, in the vertex stage (§3.3) |
| What the moss changes | The albedo, mixed toward the map's colour under a tint, and the roughness, mixed toward a constant; the bark's relief and roughness maps stay under it (§4) |
| The roughness | Written into the reflectivity block's output before Babylon's roughness line, since the wet plugin rewrites that line and two rewrites of one line would declare `roughness` twice (§4.2) |
| Where it attaches | In the forest's plugin loop on every LOD's bark material, after the LOD2 split and never in `dressSpecies`; the billboards' bake clones through a hook of the bake's (§5) |
| The wait | Every set's bake waits on the moss map with its bark maps (§5.3) |
| The cost | One sampler, one varying (a vec2, one location), one texture for the forest, no uniform (§6) |

## 2. The map

`client/assets/textures/moss.wood.1k.ktx2` is the colour map of a scan of
moss grown over wood (`CREDITS.md` names its source, author and licence),
in the bark sets' form: UASTC in KTX2 with a full mip chain and no key/value
data, its origin its top-left corner, sRGB as photographed. Its normal map
(`moss.wood.1k.normal.ktx2`) and ARM map (`moss.wood.1k.arm.ktx2`) ship with
it, listed in `client/assets/catalog.json`'s `textures` and credited, and
are not read: the moss sits in the bark's fissures, so the bark's own relief
and roughness map stay under it, and the moss's roughness is a constant
(§4.2). `MOSS_OUTPUT` in `client/src/game/mossParams.ts` names the colour
map; `textureUrl` (`assetUrls.ts`) resolves it through the bark's glob,
widened to `moss.*.ktx2`, so the file is content-hashed and cached as the
bark's are.

The map is loaded once for the forest (`loadMoss` in `forestMeshes.ts`),
through the bark's own loader as a colour map (an sRGB buffer, decoded by
the sampler as the bark's colour map is), tiling on both axes, kept with the
bark maps and disposed with them. Every bark material's plugin shares the
one texture and never disposes it.

## 3. The mask

`shaders/mossLights.fragment.fx`, at `CUSTOM_FRAGMENT_BEFORE_LIGHTS`, where
`surfaceAlbedo` is the bark's colour under its tone and no light has run:

```glsl
float mossBand = 1.0 - smoothstep(MOSS_BAND.x, MOSS_BAND.y, vMoss.x);
float mossSide = smoothstep(0.0, MOSS_SIDE_EDGE, dot(normalize(vNormalW), MOSS_SIDE));
float mossTree = mix(MOSS_AMOUNT.x, MOSS_AMOUNT.y, vMoss.y);
vec3 mossColour = texture2D(mossSampler, vAlbedoUV * MOSS_TILE).rgb;
float mossLuma = dot(mossColour, MOSS_LUMA);
float mossRaw = mossBand * mossSide * mossTree;
mossW = smoothstep(MOSS_EDGE.x, MOSS_EDGE.y, mossRaw * (0.5 + mossLuma));
surfaceAlbedo = mix(surfaceAlbedo, mossColour * MOSS_TINT, mossW);
```

Four terms, each for one thing the ask says, multiplied so that each alone
can take the moss away, then an edge so the moss ends where it thins rather
than fading to a tint. `mossWeight` in `mossParams.ts` is the same
arithmetic on the CPU, for the tests.

### 3.1 Low on the trunk: the band

`vMoss.x` is the vertex's height above the tree's foot in the model's own
metres: the vertex stage writes `positionUpdated.y` at
`CUSTOM_VERTEX_MAIN_END` (`shaders/mossFoot.vertex.fx`), the model position
before the world transform, whose origin every tree model puts at its
footprint base. The band is full below `MOSS_BAND.x` and gone above
`MOSS_BAND.y`. In the model's metres and not the world's, so one constant
serves every size a tree is drawn at: a giant drawn at 3.5 times its model
carries the band 3.5 times as far up its trunk, as the ground conform's
ramp does (`groundConformPlugin.ts`). The world height over the foot divided
by the instance's scale would give the same number; the model height is
that number directly, without reading the instance's matrix in the
fragment stage.

### 3.2 The wet side: the side

The dot of the geometric normal (`vNormalW`, the vertex normal in world
space) with `MOSS_SIDE`, a unit vector, blended in from 0 to `MOSS_SIDE_EDGE`:
a face turned within about 53° of the wet side carries the full side
weight, one turned square to it none, and the back of the trunk none. The
geometric normal and not the bumped `normalW`, so the bark's relief does not
speckle the mask: the relief shows through the moss as the bark's own light
and shade, which is what puts the moss in the fissures.

### 3.3 More on some trees: the tree's draw

`vMoss.y` is a draw in [0, 1) hashed in the vertex stage from the tree's
foot in world space, the translation column of `finalWorld` (the thin
instance's own matrix where there are instances, the mesh's world matrix
where not, as under the billboards' bake). The hash is the one the wet
plugin's speckle uses (`wet.fragment.fx`), without sine, which loses
precision at world coordinates; the far cover's lattice hash lives inside
the terrain plugin's own guard and is not reachable from a tree's material.
The draw sets the tree's amount between `MOSS_AMOUNT.x` and `MOSS_AMOUNT.y`.

### 3.4 In the fissures: the map's own growth

The moss map is moss grown over wood: bright green where the moss is, dark
where the wood shows through. Its luminance, read where the map is sampled,
scales the raw mask by half plus itself, so the moss comes in the map's own
patches and the bare wood between them falls under the edge. The map is
read on the bark's own tiled UVs (`vAlbedoUV`, the albedo's, which every
dressed bark reads through a transform) at `MOSS_TILE` repeats of the bark's
plate, so it follows the bark round the trunk and up it, turned where the
bark is turned.

## 4. What the moss changes

### 4.1 The albedo

Mixed from the toned bark toward the map's colour under `MOSS_TINT` by the
mask, before the reflectivity block, so the metallic workflow and the
weather's wetting (`wetWeather.fragment.fx`) read the mossed colour, and the
wet plugin's own darkening (`wetLights.fragment.fx`, after this block)
darkens the moss with the bark. The map is decoded as the bark's colour map
is: by the sampler where the engine gives the map an sRGB buffer, and by
Babylon's gamma helper where it does not, the one case the albedo's own
gamma define marks (`GAMMAALBEDO`), since the moss map is loaded with the
bark's flags and so shares its state.

### 4.2 The roughness

`reflectivityOut.roughness=mix(reflectivityOut.roughness,MOSS_ROUGHNESS,mossW);`
under `MOSS`, written into the reflectivity block's output before Babylon's
`float roughness=reflectivityOut.roughness;`. The anchor is the statement
before that line on the same line of Babylon's PBR fragment,
`float microSurface=reflectivityOut.microSurface;`, matched once by a
regular-expression injection (`MOSS_ROUGHNESS_INJECTION_POINT` in
`mossPlugin.ts`) and re-emitted after the write; the code begins with a
newline, since the anchor sits mid-line and a directive must begin its own.

Not on Babylon's roughness line itself: the wet plugin rewrites that line
(`WET_ROUGHNESS_ANCHOR`, `wetPlugin.ts`), and the plugin manager
concatenates every plugin's code for one injection point, so a second
rewrite of the same line would declare `roughness` twice on a trunk, which
wears both plugins. Written before it, the moss's roughness is what
Babylon's line, or the wet plugin's rewrite of it, reads: a wet trunk
glosses over its moss as it does over its bark. `microSurface`, which only
the alpha fresnel reads, is left as the bark's, as the wet plugin leaves it.

## 5. Where the plugin attaches

### 5.1 The near trees

`attachMoss` runs in `adoptSpecies`'s plugin loop (`forestMeshes.ts`), on
every LOD's material that does not alpha-test, the rule `shadeTreeMaterial`
tells bark from crown by, with the forest's one moss texture: the giants'
three LODs, the pine's second set's clones, the saplings and the alder.
Never the crowns, the snag (which keeps its file's bark and its own moss,
`nurseLog.ts`), the billboards' own material or the nurse plants.

*Since 2026-10-15:* the snag and the logs wear a plugin of their own with
this one's mask and constants and the same map
(`client/src/game/deadwoodPlugin.ts`); the vertex-colour moss of
`nurseLog.ts` is gone, and the snag's bake dresses its clone as the trees'
do. `ARCHITECTURE.md` has the shape. *Since 2026-10-17:* the bake's clone
gets geometry of its own with the role as a vertex attribute of zeros, a
snag's (`bakeDeadwoodRole`). It shared its source's geometry, on which the
bucket later puts the role per instance, sized to the dead trees in range:
none at the beach or in the title's view, an empty buffer, and WebGPU
refuses a draw against one, an uncaptured error the hike answers by
rebuilding its renderer on WebGL2 (WebGL2 drew on regardless). Live from
the far field's deploy of 2026-10-16 to the fix.

In the loop with the ground conform, the distance fade and the wet, and not
in `dressSpecies` where the bark is dressed, because the LOD2 split in
`adoptSpecies` clones the bark material before any plugin is on it: a
material clone rebuilds only the plugins Babylon's own class registry knows
and drops the forest's, so a plugin attached before the split would be
missing from LOD2's clone, which the lake's mirror draws. In the loop every
LOD's material takes it, the pine's second set's clones and the LOD2 clones
among them.

### 5.2 The far trees

The billboards bake from a clone of LOD1 whose materials `defaultBakeImpostor`
clones at once, before the loop above runs (so the bake never renders a
swaying crown), and a clone carries none of the forest's plugins: the bake's
clones would wear no moss, and the far trees would hand over at the seam to
mossless billboards. So the bake takes a hook, `BakeOptions.dress`, run on
each bake mesh's own material clone once it is made, and the trees' bakes
are given one that puts the moss on an opaque material and leaves an
alpha-tested one. The snag's bake is given none. In the bake the mesh has
no instances, so the vertex stage reads the foot from the mesh's own world
matrix and the model height from the model: the band stands on the
billboard at the model's metres, as on the near tree it stands for.

### 5.3 The wait

A billboard keeps what its bake saw for the life of the page, so every
set's bake waits on the moss map as it waits on the set's bark maps:
`loadMoss` settles a promise once the map has loaded or failed to, and
`dressSpecies` joins it to each set's `BakeOptions.textures`. A map that
fails to load settles the wait, so a missing file never costs the far
forest; the trunks then sample an empty map, which darkens the mask's area
by half toward black, the same outcome as a failed bark colour map.

## 6. What it costs

One sampler on the bark's fragment stage (`mossSampler`), one varying
(`vMoss`, a vec2, one location) and one texture for the forest, no uniform.
The giants' bark materials go from 15 inter-stage locations to 16 of the
device's 19 on the high tier (`interStage.test.ts`), and their fragment
stage from 7 to 8 sampled textures of 16 with the sun's shadow map
(`stageBindings.test.ts`). Per bark fragment: one texture read, two
smoothsteps and a few multiplies.

The bark's defines gain `MOSS`; nothing else of the bark's variant moves.
The crowns and the snag compile as they did.

## 7. The constants

All in `mossParams.ts`, each one literal, mirrored in `moss.fragment.fx` and
pinned by the lockstep test:

| constant | value | what |
| --- | --- | --- |
| `MOSS_SIDE` | (−0.5486, 0.2494, 0.798) | The wet side, a unit vector: toward −x and +z, a little up |
| `MOSS_SIDE_EDGE` | 0.6 | The dot the side term reaches 1 at |
| `MOSS_BAND` | (1.0, 2.5) | The band up the trunk, model metres: full below, gone above |
| `MOSS_AMOUNT` | (0.25, 1.0) | The least and the most a tree carries, by its draw |
| `MOSS_EDGE` | (0.35, 0.65) | The edge the mask is blended over |
| `MOSS_TILE` | 3.0 | Moss plates per bark plate |
| `MOSS_TINT` | (0.40, 0.47, 0.35) | On the map's colour, linear: under half the map's own light, so the moss reads as damp growth, darker than the toned bark |
| `MOSS_ROUGHNESS` | 0.95 | The moss's roughness |

## 8. What the browser should settle

Nothing here has been seen in a browser. In order:

1. **The side.** `MOSS_SIDE` is a start: the moss should face away from the
   sun's noon and toward where the weather comes from, and the vector's
   up-lean should read as moss on a trunk's upper flanks, not as a cap.
2. **The band.** `MOSS_BAND` in model metres is 3.5 to 9 m up a giant and
   1 to 2.5 m up a sapling drawn at 1; if the giants read mossed too high
   or the saplings too low, the band wants a term on the drawn scale, or a
   value per cohort.
3. **The amount.** `MOSS_AMOUNT` and `MOSS_EDGE` together: how many trees
   carry moss at all (a quarter of the mask falls under the edge, so the
   barest tree today carries none but where the map is brightest), and how
   hard the edge is.
4. **The tile and the tint.** Whether three moss plates to a bark plate
   reads at the giants' drawn scale, and whether the tint sits with
   `BARK_TONE` under the canopy.
5. **The fissures.** The side term reads the geometric normal, so the
   relief is the bark's own; if the moss wants to sit deeper in the
   fissures, a term on the bark's own darkness (its albedo's luminance)
   is the next thing to try.
6. **The billboards.** The bake looks along one axis, so a billboard shows
   the moss of one side of the tree; whether that side is the mossed one
   at the seam.

## 9. As built (2026-10-14)

Built as above; nothing seen in a browser yet. The roughness went before
Babylon's line and not on it (§4.2) once the wet plugin's anchor on that
line was found: the one point two plugins may not share. The billboards
take the moss through `BakeOptions.dress` (§5.2), since the bake's material
clones carry none of the forest's plugins. The varying is a vec2 and not a
vec4: the foot and the scale served only to derive the model height, which
the vertex stage has directly (§3.1).
