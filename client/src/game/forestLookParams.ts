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
 */

/** A trunk's share (the opaque bark): the canopy hides most of the sky from it. */
export const BARK_SKY = 0.35;
/** A crown's share (the alpha-tested cards): it stands in the canopy, open to more of the sky than a trunk below it. */
export const CROWN_SKY = 0.6;
/** A billboard's share of the live sky: it relights a bake already taken under the near trees' shares, and is mostly crown. */
export const IMPOSTOR_SKY = 0.6;

/**
 * The specular weight (`metallicF0Factor`) of every tree's bark, a snag's
 * included, and of every billboard. On the PBR path the trees compile, the
 * weight sets both F0 (× 0.04) and F90, the reflectance at grazing angles.
 * The conifers' bark ships at 0.04 to 0.047; the alder's bark and the snag
 * ship none, so they took Babylon's 1, and so did the billboards, made in
 * code: an F90 of 1 rims every silhouette with the sky. The crowns keep the
 * weights their files carry.
 */
export const TREE_SPECULAR_WEIGHT = 0.04;
