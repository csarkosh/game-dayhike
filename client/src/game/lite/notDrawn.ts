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
 * skyline's shade for its shore, the reeds and the lilies that grow in it,
 * and its midges and dragonflies, with its frogs to hear; and the sea
 * where a tier blends it: its swell, its wind sea (the ripple bump on low,
 * the baked loop above it) and its white water, the swash up the cove's
 * face, and its surf to hear; and the scenery a hike places once: the
 * fingerposts at the junctions with their lettering, the trailhead's car,
 * the film's car in its place and the patch under it, the board with its
 * painted face, and the body at the crest. Every other part of the world is absent, and the
 * members of `Renderer` that belong to an absent part are answered here as
 * nothing: a setter keeps what it was told (`held`), for the day its part is
 * drawn; a read-out returns nothing heard, nothing seen or nothing pending;
 * a promise is already resolved. `NOT_DRAWN` names each part with the members that
 * stand in for it, and the two are held to each other by the tests.
 */
import type { EndSceneSetup, Renderer } from "../renderer.js";

/** A part of the world not drawn yet, and the members of `Renderer` answered as nothing for it. */
export type NotDrawn = { readonly what: string; readonly members: readonly (keyof Renderer)[] };

export const NOT_DRAWN: readonly NotDrawn[] = [
  { what: "the sea's wind waves by the FFT on the tier that runs one (the baked loop is drawn there meanwhile), the swept curl of its plunging lip and the surf's spray", members: [] },
  { what: "the shore a lake reflects beyond its skyline's shade (the panorama, the mirror), and the water, a lake's and the sea's, on the tier that reads what lies under it through the surface", members: [] },
  { what: "the skin's shading (`skin.ts`): no model the game ships has a surface that shows it", members: ["setSkinShading"] },
  { what: "the sun's cast shadows on a tier given a shadow map: no tier has one (`quality.ts`), so the game casts none either", members: [] },
  { what: "the scenes and the endings: their cameras, their stage, the local hiker's own body in them and the end scene's car", members: ["setEnding", "endScene", "setScene", "clearEnding"] },
  { what: "the hand-authored levels' brushes, and the wireframe view", members: ["setWireframe"] },
  { what: "the shaders' compiles told as they happen, kept shaders, and the GPU's timings", members: ["onShaderCompiled", "keepShaders", "gpuTime"] },
];

/** What the setters of the absent parts were last told. */
export type NotDrawnHeld = {
  wireframe: boolean;
  skinShading: boolean;
  ending: "died" | "won" | null;
  endScene: EndSceneSetup | null;
  scene: { kind: "summit" | "cap"; at: { x: number; y: number; z: number } } | null;
};

/** The members answered as nothing: every member `NOT_DRAWN` names. */
export type NotDrawnMembers = Pick<
  Renderer,
  | "setSkinShading"
  | "setEnding" | "endScene" | "setScene" | "clearEnding"
  | "setWireframe" | "onShaderCompiled" | "keepShaders" | "gpuTime"
>;

/**
 * The members answered as nothing, and what their setters hold. One of each
 * a renderer: `held` is that renderer's own.
 */
export function notDrawnMembers(): { members: NotDrawnMembers; held: NotDrawnHeld } {
  const held: NotDrawnHeld = {
    wireframe: false, skinShading: true, ending: null, endScene: null, scene: null,
  };
  const members: NotDrawnMembers = {
    setSkinShading(on) {
      held.skinShading = on;
    },
    setEnding(kind: "died" | "won", scene?: EndSceneSetup) {
      if (held.ending !== null) return;
      held.ending = kind;
      held.endScene = scene ?? null;
    },
    endScene: () => null,
    setScene(kind, at) {
      held.scene = { kind, at: { x: at.x, y: at.y, z: at.z } };
    },
    clearEnding() {
      if (held.ending === "died") held.ending = null;
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
