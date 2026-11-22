/**
 * A renderer's side for a game with no parts of its own: the renderer draws
 * the world (the terrain, the forest, the water, the sky, the weather, the
 * animals) and nothing is added to it. The look is held at rest, no scene
 * takes the camera or the lamp, the dark never closes on the frame, and the
 * animals are told where the players are and of no match. It is what the
 * empty game is drawn with, and what a new game starts from before it has a
 * body, a light or a scene to add.
 */
import type { RenderGame, RenderLook, RenderPlayer, RenderShot, RenderSide, RenderState } from "./renderGame.js";
import { STARE_LENS_REST } from "../stareLens.js";
import { createWildlifeInputs } from "../wildlifeInputs.js";

/** What a renderer made with no parts wears beside its own: the one level the page's console holds and puts back after a swap. */
export type NoPartsApi = {
  /** How far dread reaches the lens, 0 to 1. */
  setUnsettle(level: number): void;
};

/** What a shot asks where no scene plays: nothing. One record, never written. */
const NO_SHOT: RenderShot = { fov: null, centre: null, coverAtEye: false };
/** What a fault report says of a game with no scene, no ending and no dark. */
const NO_FACTS = { scene: false, ending: false, dark: 0 };

export const noParts: RenderGame<RenderState<RenderPlayer>, RenderPlayer, NoPartsApi> = () => {
  const look: RenderLook = { cast: 0, unsettle: 1, dim: 1, haunt: 0, mistIn: 0 };
  const side: RenderSide<RenderState<RenderPlayer>, RenderPlayer> = {
    look,
    wildlife: createWildlifeInputs<RenderState<RenderPlayer>>(),

    lights: () => undefined,
    early: () => undefined,
    masked: () => undefined,
    late: () => undefined,
    stood: () => undefined,
    releaseBodies: () => undefined,
    release: () => undefined,
    ready: () => undefined,
    waiting: () => 0,
    rebuilding: () => false,

    begin: () => undefined,
    lampOn: () => false,
    shot: () => NO_SHOT,
    lamp: () => undefined,
    afterAir: () => undefined,
    bodies: () => undefined,
    seen: () => undefined,
    cloudPath: () => null,
    stare: () => STARE_LENS_REST,
    haze: () => undefined,
    facts: () => NO_FACTS,
  };
  const api: NoPartsApi = {
    setUnsettle(level) {
      look.unsettle = Math.max(0, Math.min(1, level));
    },
  };
  return { side, api };
};
