/**
 * How the trees take the sky's image-based light. Babylon-free and on the
 * architecture test's BABYLON_FREE_FILES list; `forestMeshes.ts` sets them on
 * every tree, sapling and snag material and on the billboards. All four are
 * material values Babylon binds as uniforms (`environmentIntensity` into the
 * lighting infos, `metallicF0Factor` into the reflectance factors), not
 * mirrored GLSL literals, so no shader text carries them.
 *
 * The scene's image-based light is a probe of the sky dome alone, and nothing
 * occludes it: every PBR material takes the diffuse irradiance and the grazing
 * reflection of the whole open sky. A trunk in deep forest sees little of
 * that sky through the canopy, so at full share it reads pale, cool and
 * faintly sheened. A material's own `environmentIntensity` multiplies the
 * scene's, so each share below is the part of the open sky's light that kind
 * of surface takes.
 *
 * The billboards were the exception until 2026-10-15: a billboard's colour
 * was its bake, a lit render of the tree's LOD1 under the bark's and the
 * crown's shares, so the canopy's cut was already in the baked colour, and
 * the billboard lit that colour again with the live sky at full share so the
 * cut landed once. Now the bake is the species' colour unlit, with its
 * normal map (`impostorBakePlugin.ts`), and the billboard lights it once,
 * live, as a crown (`CROWN_SKY`): the cut lands once on the far trees as on
 * the near, and the two meet at the seam under the same light.
 */

/** A trunk's share (the opaque bark): the canopy hides most of the sky from it. */
export const BARK_SKY = 0.35;
/** A crown's share (the alpha-tested cards): it stands in the canopy, open to more of the sky than a trunk below it. */
export const CROWN_SKY = 0.6;
/** A billboard's share of the live sky before its bake lands: full. Since
 * 2026-10-15 the bake is the species' colour unlit (`impostorBakePlugin.ts`),
 * and a billboard whose bake has landed takes the crown's share, `CROWN_SKY`,
 * so the cut lands once, live, on the far trees as on the near ones. */
export const IMPOSTOR_SKY = 1;

/**
 * The specular weight (`metallicF0Factor`) of every tree's bark, a snag's
 * included, of every billboard, and of a crown whose file gives it none. On
 * the PBR path the trees compile, the weight sets both F0 (× 0.04) and F90,
 * the reflectance at grazing angles. The conifers' bark ships at 0.04 to
 * 0.047 and their crowns at 0 to 0.045; the alder's bark and crown and the
 * snag ship none, so they took Babylon's 1, and so did the billboards, made
 * in code: an F90 of 1 rims every silhouette with the sky, the alder's crown
 * cards and their bake included. A crown that ships a weight keeps it.
 */
export const TREE_SPECULAR_WEIGHT = 0.04;
