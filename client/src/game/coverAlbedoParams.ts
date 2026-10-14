/**
 * The ground cover in one green. Babylon-free and on the architecture
 * test's BABYLON_FREE_FILES list; `clutterMeshes.ts` and `forestMeshes.ts`
 * apply it as the models land, and the foliage plugin's shader holds the
 * green, the contrast and the albedo's floor (`foliagePlugin.ts`,
 * `shaders/foliage.fragment.fx`); the light plugin holds the cover's shadow
 * floor (`foliageLightPlugin.ts`).
 *
 * The cards (the clutter tufts, meadow, flowers and bushes, and the
 * understory fern) are lit alike, yet their textures' exposures are
 * unrelated and their greens too: the main tuft's and the
 * fern's sit at 0.7 of the floor's own grass colour (`terrainSurface.ts`
 * `GRASS`, Y 0.131) and the pale tuft's at 2.2 times it, and the tuft's is
 * a yellow green where the fern's is a blue one. The ground textures follow
 * one rule for this already (the terrain divides each by its own mean,
 * `terrainTexture.ts` `LAYER_MEAN_RGB`); this is the cards'. Every green
 * card's mean colour is brought to one green, `COVER_GREEN`, by a gain on
 * each channel of its albedo; a card whose colour is its own (the flowers)
 * is brought to the green's luminance alone, by one grey gain; and the
 * shade baked into every texture's dark texels, which no gain lifts, is
 * compressed toward the green in the shader (`FOLIAGE_CARD_CONTRAST`).
 *
 * The measurement: the model's base colour texture as shipped, the texels
 * its alpha mask keeps (alpha ≥ 0.5), each channel linear, averaged; the
 * luminance is `Y = 0.2126 R + 0.7152 G + 0.0722 B` of that mean. A model
 * whose texture changes is measured again the same way and its rows
 * replaced; the values are measurements, so they stay as these literals.
 */
import type { Rgb } from "./colour.js";

/** The luminance (linear Y) every card is brought to: the green's own,
 * 0.85 of the main tuft's texture (`COVER_ALBEDO_Y`, 0.0942). */
export const COVER_ALBEDO_TARGET = 0.0801;

/** The ground cover's one green, linear: the main tuft's own colour (its
 * texture's mean, `COVER_ALBEDO_RGB` `clutter.grass_a`, (0.1001, 0.0989,
 * 0.0297), Y 0.0942) at 0.85 of its luminance, so the tufts and the meadow
 * keep their colour, a little darker, and the ferns, the bushes and the pale
 * tuft take it. The green every green card's mean is brought to, and the
 * colour the cards' contrast compresses toward (`FOLIAGE_CARD_GREEN` in
 * `shaders/foliage.fragment.fx`, pinned to this at four decimals). */
export const COVER_GREEN: Rgb = { r: 0.0851, g: 0.0841, b: 0.0252 };

/** The darkest a ground-cover fragment's albedo may be, linear: five
 * eighths of the green, applied after the root darkening and the tint, so a
 * blade's tip, a card's baked-dark pixel or a root in the turf never goes to
 * black (`FOLIAGE_ALBEDO_FLOOR` in `shaders/foliage.fragment.fx`, pinned to
 * this at four decimals). */
export const FOLIAGE_ALBEDO_FLOOR: Rgb = { r: 0.0532, g: 0.0525, b: 0.0158 };

/** The least of the sun's light a ground-cover fragment keeps in a cast
 * shadow, 0 to 1: the shadow generator's darkness applies to every receiver,
 * and on the cover the blades' and cards' own shade stacks on top of it, so
 * the cover's shadows are held above this where the floor's keep the
 * weather's darkness (`foliageLightPlugin.ts`). */
export const FOLIAGE_SHADOW_FLOOR = 0.75;

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

/** Mean linear colour of each green card model's base colour texture over
 * the texels its alpha mask keeps, by catalog id: the models whose colour is
 * the cover's green and not their own. The flowers are not here, since their
 * petals keep their colour and take the grey gain of `COVER_ALBEDO_Y`. */
export const COVER_ALBEDO_RGB: Readonly<Record<string, Rgb>> = {
  "clutter.grass_a": { r: 0.1001, g: 0.0989, b: 0.0297 },
  "clutter.meadow": { r: 0.1001, g: 0.0989, b: 0.0297 },
  "clutter.grass_b": { r: 0.3108, g: 0.3001, b: 0.1415 },
  "clutter.bush_a": { r: 0.1802, g: 0.153, b: 0.0899 },
  "clutter.bush_b": { r: 0.1802, g: 0.153, b: 0.0899 },
  "understory.fern": { r: 0.07, g: 0.1035, b: 0.0165 },
};

/** The gain is held within this range: a texture far from the target is a
 * texture to replace, not to push through a fourfold factor. */
export const COVER_ALBEDO_GAIN_MIN = 0.4;
export const COVER_ALBEDO_GAIN_MAX = 2.0;

/** A channel's gain is held within this range, wider than the grey gain's:
 * a texture's blue is small and noisy. The pale tuft reaches the floor on
 * every channel and the bushes' blue reaches it; the cap is not reached. */
export const COVER_TINT_MIN = 0.3;
export const COVER_TINT_MAX = 3.0;

/** The contrast the green cards' textures keep in the foliage shader, 1 the
 * texture as it is: the albedo is mixed this far from the green toward the
 * texture, so a texel at the mean (which the tint puts at the green) stays,
 * a black one becomes 0.4 of the green and a white one 0.4 of white over
 * 0.6 of the green. The blade clumps, the duff, the reeds and the trees
 * keep 1. */
export const FOLIAGE_CARD_CONTRAST = 0.6;

/** The factor a card model's albedo is multiplied by to bring its texture to
 * `COVER_ALBEDO_TARGET`; 1 for a model that is not in the table. */
export function coverAlbedoGain(id: string): number {
  const y = COVER_ALBEDO_Y[id];
  if (y === undefined) return 1;
  return Math.min(COVER_ALBEDO_GAIN_MAX, Math.max(COVER_ALBEDO_GAIN_MIN, COVER_ALBEDO_TARGET / y));
}

/** The factors a card model's albedo is multiplied by, per channel: for a
 * green card, `COVER_GREEN` over its texture's mean colour, each channel
 * clamped to [`COVER_TINT_MIN`, `COVER_TINT_MAX`], so its mean lands on the
 * green; for a card with a luminance alone (the flowers), the grey gain
 * `coverAlbedoGain` on all three; 1 for a model in neither table. */
export function coverAlbedoTint(id: string): Rgb {
  const mean = COVER_ALBEDO_RGB[id];
  if (mean === undefined) {
    const gain = coverAlbedoGain(id);
    return { r: gain, g: gain, b: gain };
  }
  const channel = (target: number, measured: number): number => Math.min(COVER_TINT_MAX, Math.max(COVER_TINT_MIN, target / measured));
  return { r: channel(COVER_GREEN.r, mean.r), g: channel(COVER_GREEN.g, mean.g), b: channel(COVER_GREEN.b, mean.b) };
}
