# The trunk shaded as one, and the cover matched to the ground

**Status:** built 2026-10-27, after the shadow cascade was made stable
(`2026-10-27-shadow-cascade-flicker.md`). Two things the owner marked on a screenshot of the forest.

## The trunks

The canopy's shadow fell across a trunk in hard-edged patches: the shadow map's texels, about 5 cm in
the forest, resolved on a surface that curves away a few centimetres at a time, so a trunk read half
lit and half dark down a sharp line, and the patches crawled as the sun or the player moved.

`barkShadePlugin.ts`, on every bark material (attached with the moss, after the LOD2 split's clones):
at the end of the vertex stage, each cascade's shadow coordinate (`vPositionFromLight`, from
Babylon's `shadowsVertex`) is written again for the point on the trunk's axis at the vertex's own
height, through the instance's `finalWorld`; the depth it compares (`z`, `vDepthMetric`) stays the
vertex's own. So every pixel of the trunk at a given height reads the one texel over the axis, and
the trunk is lit or shaded whole around; along it the canopy's shade crosses softly, the
percentage-closer filter's width. The lit side is as near the sun as the map's own record of it and
never shadows itself; the dark side, deeper, is dark by its normal already. No cost: the same
shadow reads, at another texel, and no uniform of its own. Every light's cascades are written,
guarded by the light's `SHADOWCSM` define, so the plugin reads no light index (the sun is light 1 in
the game, light 0 in a bake), and `lightMatrix{X}` is a plain uniform on both of Babylon's paths,
which is why the depth, whose `depthValues` is named differently on each, is left alone.

A first version sampled at the axis itself, depth and all: a trunk's axis is inside the trunk, so
every trunk shadowed itself.

## The cover

The grass and fern cards read lighter than the terrain they stood on. A card's texture is its own
green, lit under a flat cut of the sun (`FOLIAGE_CANOPY_SUN`, 0.4), where the ground beside it stood
in the canopy's real cast shadow and kept 0.17 of the sun at most. The owner chose the shadowed,
matte cover over the flat cut on the preview branch (2026-10-26, "option B"), ferns included.

`FOLIAGE_MATCH` (`foliagePlugin.ts`, `foliageMatched`): the grass, the meadow and the blades, and the
ferns of the understory. A matched card's meshes receive the trees' cast shadows, so its canopy cut is
the shadow's (`foliageCanopySun` 0) and the light plugin holds no shadow floor on it; it is matte
(`metallicF0Factor` 0); and its colour is drawn `FOLIAGE_MATCH_WEIGHT` (0.7) of the way to the
ground's at its root over its whole height, the root darkening normalised so the card's mean is the
ground's. The card keeps its own texture and normal. The preview replaced the colour and the normal
outright, and darkened the near cards toward a sward colour by distance: on the Air that made the
near cover one flat carpet, ending in a line across the slope at the blade field's edge. The nurse
log's fern, the same material name under its own profile, is not matched: it receives no cast shadow.

Every WebGL2 shader text and plugin interface is pinned (`webglIdentity.test.ts`); both are re-pinned
here. The WebGPU corpus (`client/shaders/corpus/`) is recorded separately, as a `chore(shaders)`
commit, once the look is settled.
