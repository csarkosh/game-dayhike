/**
 * The ground cover's cards at one albedo. Babylon-free and on the
 * architecture test's BABYLON_FREE_FILES list; `clutterMeshes.ts` and
 * `forestMeshes.ts` apply it as the models land.
 *
 * The cards (the clutter tufts, meadow, flowers and bushes, and the
 * understory fern) are lit alike, yet their textures were photographed at
 * unrelated exposures: the main tuft's and the fern's sit at 0.7 of the
 * floor's own grass colour (`terrainSurface.ts` `GRASS`, Y 0.131) and the
 * pale tuft's at 2.2 times it, so one tuft in three glowed and the rest sank.
 * The ground textures follow one rule for this already (the terrain divides
 * each by its own mean, `terrainTexture.ts` `LAYER_MEAN_RGB`); this is the
 * cards'. Every card material is brought to one target luminance by a gain
 * on its albedo, from a table measured on the shipped models.
 *
 * The measurement: the model's base colour texture as shipped, the texels
 * its alpha mask keeps (alpha ≥ 0.5), linear luminance
 * `Y = 0.2126 R + 0.7152 G + 0.0722 B` of each, averaged. A model whose
 * texture changes is measured again the same way and its row replaced;
 * the values are measurements, so they stay as these literals.
 */

/** The luminance (linear Y) every card is brought to. A sunlit clump of
 * blades is brighter than the floor's mean grass colour (0.131), because the
 * eye sees its lit and backlit faces, not the shaded turf under them; a
 * little over the pale flowers' own. */
export const COVER_ALBEDO_TARGET = 0.18;

/** Mean linear luminance of each card model's base colour texture over the
 * texels its alpha mask keeps, by catalog id (`client/assets/catalog.json`).
 * The meadow ships the main tuft's texture and the two bushes share one. */
export const COVER_ALBEDO_Y: Readonly<Record<string, number>> = {
  "clutter.grass_a": 0.0942,
  "clutter.meadow": 0.0942,
  "clutter.grass_b": 0.2909,
  "clutter.flower_a": 0.1796,
  "clutter.flower_b": 0.184,
  "clutter.bush_a": 0.1543,
  "clutter.bush_b": 0.1543,
  "understory.fern": 0.0901,
};

/** The gain is held within this range: a texture far from the target is a
 * texture to replace, not to push through a fourfold factor. */
export const COVER_ALBEDO_GAIN_MIN = 0.4;
export const COVER_ALBEDO_GAIN_MAX = 2.0;

/** The factor a card model's albedo is multiplied by to bring its texture to
 * `COVER_ALBEDO_TARGET`; 1 for a model that is not in the table. */
export function coverAlbedoGain(id: string): number {
  const y = COVER_ALBEDO_Y[id];
  if (y === undefined) return 1;
  return Math.min(COVER_ALBEDO_GAIN_MAX, Math.max(COVER_ALBEDO_GAIN_MIN, COVER_ALBEDO_TARGET / y));
}
