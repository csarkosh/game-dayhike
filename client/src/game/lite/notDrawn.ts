/**
 * What the renderer built on Babylon Lite does not draw yet, in one list,
 * and what it answers the hike for each of them meanwhile.
 *
 * It draws the terrain, the forest's trees (the near rings of full geometry
 * and the dead trees), the ground clutter (the cards, the plants and the
 * stones) and the blade grass under the atmosphere, lit by the sun and the
 * sky's fill for the hour and the weather, from the player's eye or the free
 * camera. Every other part of the world is absent, and the members of
 * `Renderer` that belong to an absent part are answered here as nothing: a
 * setter keeps what it was told (`held`), for the day its part is drawn; a
 * read-out returns nothing heard, nothing seen or nothing pending; a promise
 * is already resolved. `NOT_DRAWN` names each part with the members that
 * stand in for it, and the two are held to each other by the tests.
 */
import type { PaintPaletteName } from "../gradeParams.js";
import type { EndSceneSetup, Renderer } from "../renderer.js";
import { STARE_LENS_REST } from "../stareLens.js";
import { SILENT_SURF_SOUND } from "../surfSound.js";
import type { WaterLifeSound } from "../waterLifeAudio.js";
import type { WeatherPresetName } from "../weather.js";

/** A part of the world not drawn yet, and the members of `Renderer` answered as nothing for it. */
export type NotDrawn = { readonly what: string; readonly members: readonly (keyof Renderer)[] };

export const NOT_DRAWN: readonly NotDrawn[] = [
  { what: "the forest's far billboards and their bakes, and what grows on its nurse logs", members: ["impostorBakes", "abandon"] },
  { what: "the cliffs, the duff of dead leaves and twigs, and the props", members: ["canopyOver"] },
  { what: "the sea, the lakes, their plants and reflections, the surf and its spray", members: ["hasSea", "surfSound"] },
  { what: "the lakes' insects and frogs", members: ["hasWaterLife", "waterLifeSound"] },
  { what: "the animals", members: ["hasWildlife", "wildlifeEvents", "wildlifeDirectorLog"] },
  { what: "the players' bodies and lamps, the Hollow and the dropped cap", members: ["setSkinShading"] },
  { what: "the sky's dome, its capture as the image-based light, and the cast shadows", members: [] },
  { what: "the mist banks, the motes and the ground cloud", members: ["setHaunt", "setMist", "setMistIn"] },
  { what: "the rain, its splashes and its cover", members: ["canopyWater"] },
  { what: "the post chain: the grade and its palettes, the anti-aliasing, the far softening, the rain on the lens, the stare's shade, the chase's cast, depth of field", members: ["setPalette", "setChase", "setUnsettle", "setDepthOfField", "stare"] },
  { what: "the lakes' calm by the weather's name", members: ["setWeatherName"] },
  { what: "the scenes and the endings: their cameras, their stage and the end scene's car", members: ["setEnding", "endScene", "setScene", "clearEnding"] },
  { what: "the hand-authored levels' brushes, and the wireframe view", members: ["setWireframe"] },
  { what: "the shaders' compiles told as they happen, kept shaders, and the GPU's timings", members: ["onShaderCompiled", "keepShaders", "gpuTime"] },
  { what: "the junction posts, the trailhead's car and board, and the body at the crest (`hikeScenery.ts`)", members: [] },
];

/** What the setters of the absent parts were last told. */
export type NotDrawnHeld = {
  chase: number;
  haunt: number;
  mist: number | null;
  mistIn: number;
  unsettle: number;
  palette: PaintPaletteName | null;
  weatherName: WeatherPresetName | null;
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
  | "impostorBakes" | "abandon" | "canopyOver"
  | "hasSea" | "surfSound" | "hasWaterLife" | "waterLifeSound"
  | "hasWildlife" | "wildlifeEvents" | "wildlifeDirectorLog"
  | "setSkinShading" | "setHaunt" | "setMist" | "setMistIn" | "canopyWater"
  | "setPalette" | "setChase" | "setUnsettle" | "setDepthOfField" | "stare"
  | "setWeatherName" | "setEnding" | "endScene" | "setScene" | "clearEnding"
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

const NO_EVENTS: readonly never[] = Object.freeze([]);

/**
 * The members answered as nothing, and what their setters hold. One of each
 * a renderer: `held` is that renderer's own.
 */
export function notDrawnMembers(): { members: NotDrawnMembers; held: NotDrawnHeld } {
  const held: NotDrawnHeld = {
    chase: 0, haunt: 0, mist: null, mistIn: 1, unsettle: 1, palette: null, weatherName: null,
    wireframe: false, skinShading: true, depthOfField: false, ending: null, endScene: null, scene: null,
  };
  const members: NotDrawnMembers = {
    impostorBakes: () => NO_EVENTS,
    abandon: () => undefined,
    canopyOver: () => 0,
    hasSea: false,
    surfSound: () => SILENT_SURF_SOUND,
    hasWaterLife: false,
    waterLifeSound: () => NO_WATER_LIFE,
    hasWildlife: false,
    wildlifeEvents: () => NO_EVENTS,
    wildlifeDirectorLog: () => NO_EVENTS,
    setSkinShading(on) {
      held.skinShading = on;
    },
    setHaunt(level) {
      held.haunt = clamp01(level);
    },
    setMist(density) {
      held.mist = density === null ? null : clamp01(density);
      // The density now drawn: no cloud is.
      return 0;
    },
    setMistIn(level) {
      held.mistIn = clamp01(level);
    },
    canopyWater: () => 0,
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
    setWeatherName(name) {
      held.weatherName = name;
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
