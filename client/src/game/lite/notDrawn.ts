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
 * ground cloud marched through it on the tiers that march it, and the rain
 * (its streaks, and on the tiers that draw them the drips under the canopy,
 * the splashes and the cover map they are drawn under), lit by the sun, the
 * sky's fill and the sky's capture as the image-based light for the hour and
 * the weather, by the local player's headlamp and by the lamps the other
 * hikers wear, from the player's eye or the free camera; and in it the other
 * hikers' bodies, the Hollows' eyes, the dropped cap and the animals, on the
 * ground and in the air; and the lakes' water where a tier blends it over
 * what lies under it, calm by the hour and the weather's name, with the
 * skyline's shade for its shore. Every other part of the world is absent, and the
 * members of `Renderer` that belong to an absent part are answered here as
 * nothing: a setter keeps what it was told (`held`), for the day its part is
 * drawn; a read-out returns nothing heard, nothing seen or nothing pending;
 * a promise is already resolved. `NOT_DRAWN` names each part with the members that
 * stand in for it, and the two are held to each other by the tests.
 */
import type { PaintPaletteName } from "../gradeParams.js";
import type { EndSceneSetup, Renderer } from "../renderer.js";
import { STARE_LENS_REST } from "../stareLens.js";
import { SILENT_SURF_SOUND } from "../surfSound.js";
import type { WaterLifeSound } from "../waterLifeAudio.js";

/** A part of the world not drawn yet, and the members of `Renderer` answered as nothing for it. */
export type NotDrawn = { readonly what: string; readonly members: readonly (keyof Renderer)[] };

export const NOT_DRAWN: readonly NotDrawn[] = [
  { what: "the sea, the surf and its spray", members: ["hasSea", "surfSound"] },
  { what: "the lakes' plants, the shore a lake reflects beyond its skyline's shade (the panorama, the mirror), and a lake's water on the tier that reads what lies under it through the surface", members: [] },
  { what: "the lakes' insects and frogs", members: ["hasWaterLife", "waterLifeSound"] },
  { what: "the Hollow's figure in the silhouette mask (its eyes are drawn), and with it the skin's shading, which has no other surface to show on", members: ["setSkinShading"] },
  { what: "the sun's cast shadows", members: [] },
  { what: "the post chain: the grade and its palettes, the anti-aliasing, the far softening, the rain on the lens, the stare's shade, the chase's cast, depth of field", members: ["setPalette", "setChase", "setUnsettle", "setDepthOfField", "stare"] },
  { what: "the scenes and the endings: their cameras, their stage, the local hiker's own body in them and the end scene's car", members: ["setEnding", "endScene", "setScene", "clearEnding"] },
  { what: "the hand-authored levels' brushes, and the wireframe view", members: ["setWireframe"] },
  { what: "the shaders' compiles told as they happen, kept shaders, and the GPU's timings", members: ["onShaderCompiled", "keepShaders", "gpuTime"] },
  { what: "the junction posts, the trailhead's car and board, and the body at the crest (`hikeScenery.ts`)", members: [] },
];

/** What the setters of the absent parts were last told. */
export type NotDrawnHeld = {
  /** The chase's cast. The post chain's to grade by; the ground cloud, which is drawn, reads its density from it. */
  chase: number;
  unsettle: number;
  palette: PaintPaletteName | null;
  wireframe: boolean;
  skinShading: boolean;
  depthOfField: boolean;
  ending: "died" | "won" | null;
  endScene: EndSceneSetup | null;
  scene: { kind: "summit" | "cap"; at: { x: number; y: number; z: number } } | null;
};

/** The members answered as nothing: every member `NOT_DRAWN` names. */
export type NotDrawnMembers = Pick<
  Renderer,
  | "hasSea" | "surfSound" | "hasWaterLife" | "waterLifeSound"
  | "setSkinShading"
  | "setPalette" | "setChase" | "setUnsettle" | "setDepthOfField" | "stare"
  | "setEnding" | "endScene" | "setScene" | "clearEnding"
  | "setWireframe" | "onShaderCompiled" | "keepShaders" | "gpuTime"
>;

const clamp01 = (x: number): number => Math.max(0, Math.min(1, x));

/** No insect, no frog: the lake's life as heard where there is none. */
const NO_WATER_LIFE: WaterLifeSound = Object.freeze({
  hums: [],
  hums_n: 0,
  pitch: 0,
  rustles: Object.freeze([]),
  frogCalls: Object.freeze([]),
  bed: Object.freeze({
    level: 0,
    duck: [1, 1] as [number, number],
    points: [Object.freeze({ x: 0, y: 0, z: 0 }), Object.freeze({ x: 0, y: 0, z: 0 })] as const,
  }),
});

/**
 * The members answered as nothing, and what their setters hold. One of each
 * a renderer: `held` is that renderer's own.
 */
export function notDrawnMembers(): { members: NotDrawnMembers; held: NotDrawnHeld } {
  const held: NotDrawnHeld = {
    chase: 0, unsettle: 1, palette: null,
    wireframe: false, skinShading: true, depthOfField: false, ending: null, endScene: null, scene: null,
  };
  const members: NotDrawnMembers = {
    hasSea: false,
    surfSound: () => SILENT_SURF_SOUND,
    hasWaterLife: false,
    waterLifeSound: () => NO_WATER_LIFE,
    setSkinShading(on) {
      held.skinShading = on;
    },
    setPalette(name) {
      held.palette = name;
    },
    setChase(cast) {
      held.chase = clamp01(cast);
    },
    setUnsettle(level) {
      held.unsettle = clamp01(level);
    },
    setDepthOfField(on) {
      held.depthOfField = on;
    },
    stare: () => STARE_LENS_REST,
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
