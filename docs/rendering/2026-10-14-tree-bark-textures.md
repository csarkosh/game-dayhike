# Tree bark textures: the trees wear scanned bark

**Design, 2026-10-14.** Every tree file ships a 1024² colour JPEG and a 1024²
normal JPEG for its bark, no roughness, metalness or occlusion map, and the
conifers read a tenth of their atlas through a texture transform (offset 0.9,
scale 0.1 in `v`): a 1024 × 102 band tiled round the trunk, the squeezed bark of
`branding/previews/forest.png`. This design replaces every tree's bark, as its
model lands, with one of four scanned bark sets shipped as KTX2, tiled in
metres from the set's footprint and the trunk's measured size, with the set's
own occlusion and roughness; gives the giant pine two barks, mixed tree by
tree; and holds the far forest's billboards until the bark has loaded, so the
far trees wear the near trees' bark.

Renderer-only in effect: the simulation gains one draw a tree, a variant of
0 or 1 from a hash slot of its own, which the renderer reads to pick the
pine's bark and nothing in the world's shape reads, so the level id does not
move. No shader text changes: textures, uniforms and defines only (§7).

## 1. Decisions

| question | decision |
| --- | --- |
| The sets | Four, each a colour map, a normal map and an ARM map, at 2k (2048²) and 1k (1024²): `bark.pine`, `bark.metasequoia`, `bark.cedar`, `bark.alder` (§2) |
| Which tree wears which | The giant fir the pine set (a mature fir's plated bark; the tree's crown says fir); the giant pine the metasequoia set and the cedar set, mixed tree by tree; the alder the alder set; the fir sapling its giant's pine set, the pine sapling the metasequoia set (§3) |
| The snag | Left in its file's bark (§3.3) |
| The size by tier | High: 2k for the giants and the alder, which stand near, 1k for the saplings; medium and low: 1k everywhere (§5) |
| The repeat | In metres: so many plates up the trunk as it is tall over the plate's height, so many round it as it is wide over the plate's width, divided by the UV range the trunk spans; one literal a value, a starting value the look pass corrects (§4) |
| Where the plate stands | Up the trunk. The fir and the alder run `v` up the trunk and take the set as it is; the pine family runs `u` up the trunk and takes the set turned a quarter (§4.2) |
| The normal map's frame | The bark primitives lose their vertex tangents; the frame is built from the map's own coordinates, so it follows the turn (§4.3) |
| The occlusion | From the ARM map's red channel through `AOSTOREINMETALMAPRED`, at strength 1, with no ambient texture (§6) |
| The billboards | Each species' bake waits on its bark set as it waits on the sky; a map that fails to load settles the wait, so a missing file never blocks the forest (§8) |
| The pine's two barks | A second bucket set: clones of the pine's LOD meshes sharing the geometry and the crown's material, a clone of the bark material, its own billboard; trees go to a set by their variant. Seven more draw calls (§9) |

## 2. The sets

Each set is a scan of a plate of bark (`CREDITS.md` names each scan's source,
author and licence), shipped under `client/assets/textures/` through Git
LFS as `bark.<set>.<size>.ktx2`, `bark.<set>.<size>.normal.ktx2` and
`bark.<set>.<size>.arm.ktx2`, `<size>` 2k or 1k. Every file is square, UASTC in
KTX2 with zstd supercompression and a full mip chain, and carries no
orientation key: its origin is its top-left corner. The colour map is sRGB as
photographed; the normal map is OpenGL convention (+Y up), linear; the ARM map
is linear, red the ambient occlusion, green the roughness, blue the metalness
(0 everywhere). The 2k set of twelve files is 50.2 MB, the 1k set 13.2 MB;
`client/assets/catalog.json`'s `textures` section lists every file with its
bytes.

| set | footprint, width × height (m) | mean luminance (sRGB) | the plate |
| --- | --- | --- | --- |
| `bark.pine` | 2.00 × 2.00 | 0.33 | square |
| `bark.metasequoia` | 1.94 × 1.94 | 0.25 | square |
| `bark.cedar` | 1.00 × 2.00 | 0.21 | 1 : 2, squashed into the square file |
| `bark.alder` | about 0.50 × 1.00 (an estimate; no published footprint) | 0.59 | 1 : 2, squashed into the square file |

The cedar and the alder plates are twice as tall as wide, squashed into a
square file: on those two the repeat up the trunk covers twice the length the
repeat round it does, which the footprints carry (`BARK_FOOTPRINT` in
`client/src/game/barkParams.ts`) and the repeats follow.

## 3. Which tree wears which

`barkParams.ts` is Babylon-free and says, per model, the set, the axis the
trunk runs along, the two repeats and whether the model takes the 2k size on
the high tier (`BarkDressing`). `forestMeshes.ts` dresses each model's bark
material from it as the model lands.

### 3.1 The trees as measured

The shipped files, measured on the bark primitive of each (the trunk and the
branches share it, so its UV range is theirs together):

| model | bark material | file's transform | `u` / `v` of the primitive | the trunk | girth at the base |
| --- | --- | --- | --- | --- | --- |
| `tree.giant_fir` | `material0` | offset (0, 0.9), scale (1.2, 0.1) | 0–1.29 / 0–1.0 | 12.6 m | 3.4 m (1.19 × 0.96 m) |
| `tree.giant_pine` | `material0` | the same | 0–5.0 / 0.01–2.0 | 15.4 m | 3.75 m (1.21 × 1.18 m) |
| `tree.alder` | `material1` | none | 0–1.2 / 0–1.0 | 4.0 m | 0.5 m (0.16 m through) |
| `tree.conifer_a` | `material0` | the same as the giants' | 0–3.5 / −1.0–1.0 | 8.1 m | 0.9 m (0.26 × 0.32 m) |
| `tree.conifer_b` | `material0` | the same | 0–3.0 / −2.5–1.0 | 9.5 m | 1.0 m (0.35 × 0.29 m) |
| `deadwood.snag` | `material0` | none | 0–1 / 0–1 | 4.05 m long, 1.05 m across | — |

Which axis runs up the trunk was read off the trunk's own ring of vertices at
each height: the fir's `v` rises with the height (correlation 0.99) and its `u`
goes once round the trunk (0 to 1.0 at the base; the primitive's `u` reaches
1.29 on its branches); the alder's `v` rises at about 0.45 a metre and its
`u` goes round over 0.27. The pine's rings climb in `u` with the height (their
`u` reaching 0.7, 1.4, 2.0, 2.6, 3.2, 3.8, 4.3 and 4.6 as the height does, 5.0
at the top), and `v` spans its whole range at every height; both saplings
show the same, their `u` rising with the height at a correlation of 0.99
to 1.00. So two families: the fir and the alder run `v` up the trunk, the
pine and both saplings run `u` up it.

### 3.2 The dressings

| model | set | up the trunk | repeat up (per unit of that axis) | repeat round | the arithmetic (length / footprint / UV range) | 2k on high |
| --- | --- | --- | --- | --- | --- | --- |
| `tree.giant_fir` | pine | `v` | 6.3 | 1.7 | up 12.6 / 2.0 / 1.0; round 3.4 / 2.0 / 1.0 | yes |
| `tree.giant_pine`, bark 0 | metasequoia | `u` | 1.6 | 1.0 | up 15.4 / 1.94 / 5.0; round 3.75 / 1.94 / 2.0 | yes |
| `tree.giant_pine`, bark 1 | cedar | `u` | 1.5 | 1.9 | up 15.4 / 2.0 / 5.0; round 3.75 / 1.0 / 2.0 | yes |
| `tree.alder` | alder | `v` | 2.2 | 3.7 | up 4.0 / 1.0 / 1.8; round 0.5 / 0.5 / 0.27 | yes |
| `tree.conifer_a` | pine | `u` | 1.2 | 0.23 | up 8.1 / 2.0 / 3.5; round 0.9 / 2.0 / 2.0 | no |
| `tree.conifer_b` | metasequoia | `u` | 1.6 | 0.15 | up 9.5 / 1.94 / 3.0; round 1.0 / 1.94 / 3.5 | no |

The repeats are in the model's own metres. A giant is drawn at 2.8 to 4.1
times its model (`GIANT_SCALE_MIN`, `GIANT_SCALE_MAX`, and the valley's boost
over that), so the plate on a drawn giant is 2.8 to 5 times the scan's: a
2 m plate stands 6 to 10 m on a trunk. §10 says what to make of that.

### 3.3 The snag

The snag keeps its file's bark. Its trunk is unwrapped as islands that each
fill the 0–1 tile: at every place along its 4 m length the vertices span the
whole of `u` and of `v`, and neither axis follows the length (correlation
0.34 and 0.14) or the way round (0.05 and 0.32). A repeat in metres cannot be
read off such UVs: any scale would cut the plates at every island's edge. It
stays as it was, with its moss (`nurseLog.ts`).

## 4. How a material is dressed

`dressBark` (`forestMeshes.ts`) runs on each bark material of a model, the
opaque material of its LOD ladder (the rule `shadeTreeMaterial` tells bark
from crown by), before the billboard bakes and before the LOD2 split clones
it, so the bake and the mirror's LOD2 see the set.

### 4.1 The maps

- `albedoTexture`: the colour map. The KTX2 decoder reads the file's own
  transfer function into the texture (`internalTexture._gammaSpace`,
  `khronosTextureContainer2.js` line 331), so the colour map lands as sRGB
  and the other two as linear with nothing set; the colour map asks for an
  sRGB buffer (`useSRGBBuffer`), as the glTF loader's own colour textures
  do, so the GPU decodes it before filtering and the material reads it as
  linear (`baseTexture.pure.js` 241–250: `gammaSpace` is the file's and not
  an sRGB buffer's).
- `bumpTexture`: the normal map, `level` 1. The material's `invertNormalMapX`
  (true) and `invertNormalMapY` (false) stay as the glTF loader set them
  (`pbrMaterialLoadingAdapter.js` 1160–1161): the file's normal map was in the
  glTF convention, OpenGL's, and so is the set's.
- `metallicTexture`: the ARM map, with `useAmbientOcclusionFromMetallicTextureRed`,
  `useRoughnessFromMetallicTextureGreen` and `useMetallnessFromMetallicTextureBlue`
  on and `useRoughnessFromMetallicTextureAlpha` off; `metallic` and
  `roughness` at 1, so the map's values are the surface's (the files had no
  map, and a flat roughness of 1).
- Every map: `invertY` false (a compressed file cannot be flipped on upload,
  and the files' origin is the top-left corner the loader's JPEGs were read
  at), trilinear with mips, `uOffset` and `vOffset` 0 (the file's transform
  dropped), `uScale`, `vScale` and `wAng` from `barkTransform`, both wraps
  repeating.
- The file's own colour and normal textures are disposed once the maps are
  assigned, unless another material of the scene still reads one (none of
  the tree files shares a map between its bark and its crown).

### 4.2 The turn

`barkTransform` gives a dressing's texture transform. A scale applies to the
primitive's own axis before the turn, so `uScale` is the repeat along `u`
whichever way `u` runs. Where `v` runs up the trunk (the fir, the alder) the
set is laid as it is: `uScale` the round repeat, `vScale` the up repeat,
`wAng` 0. Where `u` runs up the trunk (the pine family) the set is turned a
quarter (`wAng` π/2) so the plate's height, the scan's vertical, lies along
`u`: `uScale` the up repeat, `vScale` the round repeat. Without the turn the
pine family's bark would show its grain running round the trunk.

### 4.3 The normal map's frame

Every tree file carries vertex tangents, laid along the file's `u`. Babylon
reads a normal map in the vertex tangents' frame where a mesh has them
(`TANGENT`), and otherwise in a frame built in the fragment stage from the
derivatives of the map's own coordinates. The quarter turn moves the map's
axes off the file's tangents, so a pine's relief read in the file's frame
would light from the wrong side. The dressing removes the tangents from
every bark primitive, the fir's and the alder's too, so every bark reads its
map the one way, in the frame of the turned coordinates, and every bark
compiles the one way (§7). The crowns keep theirs.

## 5. The size by tier

`barkSize(tier, dressing)`: 2k where the tier is high and the dressing is
fine (the giants and the alder, which stand near), 1k otherwise. A sapling is
never close enough for more, and the lower tiers keep their texture memory.
The renderer hands the forest its tier (`ForestMeshesOptions.tier`,
"medium" if unset); the forest resolves each set's three files by their
catalog outputs (`barkOutputs`) through `textureUrl` (`assetUrls.ts`), a
`?url` glob of `client/assets/textures/bark.*.ktx2`, so the files are
content-hashed and cached as the models are. The glob needs nothing of
`vite.config.ts`: `?url` imports any file as its served URL, and at over
900 KB a file none is near the inline limit.

## 6. The occlusion

With `useAmbientOcclusionFromMetallicTextureRed` set, `AOSTOREINMETALMAPRED`
is defined (`pbrBaseMaterial.pure.js` 1312) and the reflectivity block
mixes the red channel into the occlusion by `vReflectivityInfos.z`
(`pbrBlockReflectivity`, lines 59–60), which the material binds from
`ambientTextureStrength` (`pbrBaseMaterial.pure.js` 1623), whether or not an
ambient texture is set: without one the occlusion it mixes from is 1. So no
ambient texture is needed and `ambientTextureStrength` stays at Babylon's 1.
The occlusion cuts the sky's light alone, as Babylon's does.

## 7. What compiles

No shader text changes. On every dressed bark material the defines change
as follows, so each bark stage is a new variant of the PBR shader: on,
`REFLECTIVITY` with `REFLECTIVITYDIRECTUV 0`, `AOSTOREINMETALMAPRED`,
`ROUGHNESSSTOREINMETALMAPGREEN` and `METALLNESSSTOREINMETALMAPBLUE`; off,
`TANGENT` (§4.3). On the alder's bark, which read its file's maps with no
transform, `ALBEDODIRECTUV` and `BUMPDIRECTUV` go from 1 to 0 as well, since
the set tiles through a transform; the conifers' barks already read through
one. `METALLICWORKFLOW`, `ALBEDO` and `BUMP` were on; `GAMMAALBEDO` stays off,
the colour map on an sRGB buffer as the file's JPEG was. The crown materials
and the snag are untouched.

## 8. The billboards wait for the bark

The textures load asynchronously, and a billboard keeps whatever its bake
saw for the life of the page. `dressBark` returns a promise that resolves
once the material's three maps have loaded or failed to; a species' bucket
set's promise is its bark materials' together, and `adoptSpecies` hands it to
the set's bake as `BakeOptions.textures`. `defaultBakeImpostor` waits on the
sky and the textures both before its first poll, and its bounds count from
the later of the two; aborted while it waits, it disposes its target and
resolves null without a word, as for the sky. A map that fails to load
settles the wait, so a missing file costs the trees' bark, never the far
forest. The near trees simply show the file's bark until the set lands.

## 9. The pine's two barks

The giant pine wears the metasequoia set on half its trees and the cedar set
on the other half, by `TreeInstance.variant`: a draw of 0 or 1 from hash slot
10 of the tree's cell (`sim/vegetation.ts`), half and half, independent of
every other draw. The renderer's giants are bucket sets rather than species
(`GIANT_SETS` in `barkParams.ts`): the fir's one set takes every fir, the
pine's two take the pines of their variant. The second set is built from
clones of the pine's LOD meshes (`dressSpecies`), which share the geometry
and the crown's material and wear a clone of the bark material, made before
anything attaches to the original; the sets are adopted together, every bake
kicked before any plugin attaches to the shared crown, and the LOD2 split
made once across them, so the second set's LOD2 crown takes the one clone.
The second set has its own three LOD buckets, its own billboard (baked from
its cloned LOD1 once the cedar set has loaded), its LOD0 among the shadow
casters and its LOD2 among the lake mirror's trees, and goes with the forest
on dispose.

Draw calls: the pine's three LOD pairs and its billboard again, seven more,
so the forest's full inventory is 39 (18 for the three giant sets, 12 for the
two sapling species, 6 billboards, the deadwood bucket, the nurse logs'
fern and seedling), where it was 32. At the deep-forest camera the tests
measure, the buckets reached go from 23 to 30.

## 10. What the look pass should correct

The repeats are starting values, each one literal in `barkParams.ts`. In
the browser, first:

1. **The plate at the drawn scale.** The repeats are in the model's metres,
   and a giant is drawn at 2.8 to 5 times its model, so a 2 m plate stands 6
   to 10 m on a trunk. If a bark reads as a few huge plates, multiply the
   giants' up and round repeats by about 3.5 (the mean draw scale); the
   saplings, drawn at 0.8 to 1.6, need less.
2. **The pine family's turn.** The metasequoia's and the cedar's grain should
   run up the pine's trunk and the saplings'; if it runs round, the turn's
   sign or the axis read of §3.1 is wrong for that model.
3. **The pine's round repeat.** Its `v` spans 2.0 over the primitive but the
   rings' `v` was not read cleanly round the trunk; the round repeat of 1.0
   (metasequoia) and 1.9 (cedar) may want halving or doubling.
4. **The branches.** The branches share the primitive. On the fir their `u`
   runs past 1.0 to 1.29, so the set stretches a little across them; on the
   pine family they take the trunk's turned set at the trunk's repeats.
   Accepted for now.
5. **The alder's repeat up.** Read off the lower 1.6 m of trunk (0.45 a
   metre); above that the trunk is islands.
6. **The relief.** With the tangents gone the normal map's frame is the
   derivatives'; if the relief reads inside out on any bark, that bark's
   `invertNormalMapX` or `Y` wants flipping for the turned sets.
7. **The sheen.** The ARM map's roughness replaces a flat 1; the bark's
   specular weight (`TREE_SPECULAR_WEIGHT`) and its share of the sky
   (`BARK_SKY`) were set for a bark with none, and may want a look.
