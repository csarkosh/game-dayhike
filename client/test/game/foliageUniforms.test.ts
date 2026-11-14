import { afterEach, describe, expect, it } from "vitest";
import { FADE_NONE_IN, FADE_NONE_OUT } from "../../src/game/distanceFade.js";
import {
  FOLIAGE_CANOPY_SUN, FOLIAGE_PLAYERS, FOLIAGE_PLAYER_PARKED, FOLIAGE_PROFILES, emptyFoliageUniforms, foliageLook, foliageMatched,
  foliageUniforms, setFoliageWind,
} from "../../src/game/foliageUniforms.js";
import type { WindRecord } from "../../src/game/windParams.js";

const STILL: WindRecord = { dirX: 1, dirZ: 0, speed: 0, lean: 0, gustAmp: 0, flutterAmp: 0, time: 0 };
const parked = (): Float32Array => {
  const players = new Float32Array(FOLIAGE_PLAYERS * 3);
  for (let i = 0; i < FOLIAGE_PLAYERS; i++) {
    players[i * 3] = FOLIAGE_PLAYER_PARKED;
    players[i * 3 + 2] = FOLIAGE_PLAYER_PARKED;
  }
  return players;
};

afterEach(() => setFoliageWind(STILL, parked()));

describe("a foliage material's look", () => {
  it("takes the canopy's cut of the sun unless its meshes are shadowed or it is matched to the ground", () => {
    expect(foliageLook("tree.crown", FOLIAGE_PROFILES.TREE, 12).canopySun).toBe(FOLIAGE_CANOPY_SUN);
    expect(foliageLook("tree.crown", FOLIAGE_PROFILES.TREE, 12, { sunShadowed: true }).canopySun).toBe(0);
    // The grass is matched by its profile, the understory's ferns by their material's name.
    expect(foliageLook("grass", FOLIAGE_PROFILES.GRASS, 0.5).canopySun).toBe(0);
    expect(foliageMatched({ name: "understory.fern.material0" }, FOLIAGE_PROFILES.UNDERSTORY)).toBe(true);
    expect(foliageLook("understory.fern.material0", FOLIAGE_PROFILES.UNDERSTORY, 1).canopySun).toBe(0);
    expect(foliageLook("understory.fern.material0", FOLIAGE_PROFILES.NURSE, 1).canopySun).toBe(FOLIAGE_CANOPY_SUN);
  });

  it("keeps its texture's contrast whole unless told a share, and fades nowhere until its shell says where", () => {
    const whole = foliageLook("a", FOLIAGE_PROFILES.TREE, 9);
    expect(whole.contrast).toBe(1);
    expect(whole.edges).toEqual(FADE_NONE_OUT);
    expect(whole.bladeEdges).toEqual([...FADE_NONE_IN, ...FADE_NONE_OUT]);
    expect(whole.meshHeight).toBe(9);
    expect(foliageLook("b", FOLIAGE_PROFILES.NURSE, 1, { contrast: 0.6 }).contrast).toBe(0.6);
  });
});

describe("the foliage's uniforms", () => {
  it("are the frame's wind and players, the eye, and the look's own numbers, by name", () => {
    const wind: WindRecord = { dirX: 0.6, dirZ: -0.8, speed: 0.5, lean: 0.02, gustAmp: 0.03, flutterAmp: 0.004, time: 12.5 };
    const players = parked();
    players.set([1, 2, 3], 0);
    setFoliageWind(wind, players);
    const look = foliageLook("tree.bark", FOLIAGE_PROFILES.TREE, 14.5);
    look.edges = [50, 70];
    const u = foliageUniforms(look, { x: 7, y: 8, z: 9 }, emptyFoliageUniforms());
    expect(u).toEqual({
      windDir: [0.6, -0.8], windLean: [0.02], windGust: [0.03], windFlutter: [0.004], windTime: [12.5], windEye: [7, 8, 9],
      windPlayers: players,
      foliageAmp: [FOLIAGE_PROFILES.TREE.amp], foliageHeight: [14.5], foliageTint: [0], foliageRootAO: [1],
      foliageCanopySun: [FOLIAGE_CANOPY_SUN], foliageContrast: [1], foliageNormalRoot: [0.6], foliageNormalUp: [0],
      foliageFlags: [0, 0], foliageEdges: [50, 70], foliageBladeEdges: [...FADE_NONE_IN, ...FADE_NONE_OUT],
    });
    expect(u.windPlayers).toHaveLength(FOLIAGE_PLAYERS * 3);
  });

  it("say a profile's tilt and bend as flags, and its blade edges as the shell set them", () => {
    const look = foliageLook("blades", FOLIAGE_PROFILES.BLADES, 0.4);
    look.bladeEdges = [2.5, 4, 6.5, 8];
    const u = foliageUniforms(look, null, emptyFoliageUniforms());
    expect(u.foliageFlags).toEqual([1, 1]);
    expect(u.foliageBladeEdges).toEqual([2.5, 4, 6.5, 8]);
    expect(u.foliageNormalUp).toEqual([1]);
    // No eye: the origin.
    expect(u.windEye).toEqual([0, 0, 0]);
  });

  it("fill one record again in place, the players the page's one array", () => {
    const out = emptyFoliageUniforms();
    const a = foliageUniforms(foliageLook("a", FOLIAGE_PROFILES.TREE, 5), null, out);
    const players = a.windPlayers;
    const b = foliageUniforms(foliageLook("b", FOLIAGE_PROFILES.GRASS, 1), { x: 1, y: 1, z: 1 }, out);
    expect(b).toBe(out);
    expect(b.windPlayers).toBe(players);
    expect(b.foliageHeight).toEqual([1]);
  });
});
