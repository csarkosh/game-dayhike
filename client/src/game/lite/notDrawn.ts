/**
 * What the renderer built on Babylon Lite does not draw yet, in one list,
 * and what it answers the hike for each of them meanwhile.
 *
 * It draws the terrain, the forest's trees (the near rings of full geometry,
 * the dead trees with what grows on the fallen ones, and the far billboards
 * with their bakes), the ground clutter (the cards, the plants and the
 * stones), the blade grass, the duff, the cliffs' rock walls where the
 * field lays any and the chunk props' boxes, under the atmosphere and the
 * sky's dome, with the valley mist banks and the motes in the air and the
 * ground cloud marched through it on the tiers that march it, the post
 * chain on the tiers that have one (the far softening, the anti-aliasing,
 * the paint, the grade with its palettes, the chase's cast and the stare's
 * shade, the rain on the lens), the grade in the materials on the tiers
 * with none (the colour curves, the vignette, the dither), the Hollows'
 * figures in their mask, which the chain's grade reads and, with no chain,
 * the veil lays over the frame with the stare's shade, and the rain
 * (its streaks, and on the tiers that draw them the drips under the canopy,
 * the splashes and the cover map they are drawn under), lit by the sun, the
 * sky's fill and the sky's capture as the image-based light for the hour and
 * the weather, by the local player's headlamp and by the lamps the other
 * hikers wear, from the player's eye or the free camera; and in it the other
 * hikers' bodies, the Hollows' eyes, the dropped cap and the animals, on the
 * ground and in the air; and the lakes' water where a tier blends it over
 * what lies under it, calm by the hour and the weather's name, with the
 * skyline's shade for its shore and, on the tier that draws one, the
 * shore's panorama under it, the reeds and the lilies that grow in it,
 * and its midges and dragonflies, with its frogs to hear; and the sea
 * where a tier blends it: its swell, its wind sea (the ripple bump on low,
 * the baked loop above it, and the cascades computed each frame on the tier
 * that computes them, with the swept curl of its plunging lip and the surf's
 * spray) and its white water, the swash up the cove's face, and its surf to
 * hear; and the scenery a hike places once: the fingerposts at the junctions
 * with their lettering, the trailhead's car, the film's car in its place and
 * the patch under it, the board with its painted face, and the body at the
 * crest; and the scenes and the endings: a scene's camera (the summit's five
 * shots, the cap's turn) through its own lens, the local hiker's own body in
 * a shot with the lamp it wears there, a death's fall and its closing dark,
 * and the end scene with the car it drives, its headlamp and its tail lamps;
 * and, in a world with no forest, a hand-authored level's brushes. Every
 * other part of the world is absent, and the
 * members of `Renderer` that belong to an absent part are answered here as
 * nothing: a setter keeps what it was told (`held`), for the day its part is
 * drawn; a read-out returns nothing heard, nothing seen or nothing pending;
 * a promise is already resolved. `NOT_DRAWN` names each part with the members that
 * stand in for it, and the two are held to each other by the tests.
 */
import type { Renderer } from "../renderer.js";

/** A part of the world not drawn yet, and the members of `Renderer` answered as nothing for it. */
export type NotDrawn = { readonly what: string; readonly members: readonly (keyof Renderer)[] };

export const NOT_DRAWN: readonly NotDrawn[] = [
  { what: "the mirror a lake reflects its shore in on the tier that draws one, and the water, a lake's and the sea's, on the tier that reads what lies under it through the surface", members: [] },
  { what: "the skin's shading (`skin.ts`): no model the game ships has a surface that shows it", members: ["setSkinShading"] },
  { what: "the sun's cast shadows on a tier given a shadow map: no tier has one (`quality.ts`), so the game casts none either", members: [] },
  { what: "the wireframe view: Lite draws a material's triangles alone, and has no way to draw a mesh's edges through its own material", members: ["setWireframe"] },
  { what: "the shaders' compiles told as they happen, kept shaders, and the GPU's timings", members: ["onShaderCompiled", "keepShaders", "gpuTime"] },
];

/** What the setters of the absent parts were last told. */
export type NotDrawnHeld = {
  wireframe: boolean;
  skinShading: boolean;
};

/** The members answered as nothing: every member `NOT_DRAWN` names. */
export type NotDrawnMembers = Pick<
  Renderer,
  | "setSkinShading"
  | "setWireframe" | "onShaderCompiled" | "keepShaders" | "gpuTime"
>;

/**
 * The members answered as nothing, and what their setters hold. One of each
 * a renderer: `held` is that renderer's own.
 */
export function notDrawnMembers(): { members: NotDrawnMembers; held: NotDrawnHeld } {
  const held: NotDrawnHeld = {
    wireframe: false, skinShading: true,
  };
  const members: NotDrawnMembers = {
    setSkinShading(on) {
      held.skinShading = on;
    },
    setWireframe(on) {
      held.wireframe = on;
    },
    onShaderCompiled: () => () => undefined,
    keepShaders: () => undefined,
    gpuTime: null,
  };
  return { members, held };
}
