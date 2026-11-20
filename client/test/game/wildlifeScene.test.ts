import { describe, expect, it } from "vitest";
import "../../src/sim/passes/index.js";
import { elevationSampleAt, setActiveTerrainVariant } from "@csarkosh/engine/sim/terrain";
import { WEATHER_PRESETS } from "@csarkosh/engine/game/weather";
import { FIRST_BIRD_SPECIES, SPECIES_BUTTERFLY } from "../../src/game/wildlifeField.js";
import { createFirstBuilds } from "@csarkosh/engine/game/firstBuilds";
import {
  BIRD_ASSET, BIRD_PERCHED_ASSET, FOOT_LIFT, SLOT_STRIDE, SPECIES_ASSET, WILDLIFE_REBUILD_STEP, createWildlifeScene, creatureInView,
  type ViewPlane, type WildlifePorts,
} from "../../src/game/wildlifeScene.js";
import { timeLimit } from "../helpers/timeLimit.js";

setActiveTerrainVariant("olympic");

const SEED = 388817;
/** A place whose disc holds all four ground species at once. */
const CAM_X = 2000;
const CAM_Z = -500;
const FAR_AWAY = [{ x: 1e6, z: 1e6 }];
const CLEAR = WEATHER_PRESETS.clear;

/** Ports that give every asked body and record what was asked. */
function ports(has: (assetId: string) => boolean = () => true, planes?: readonly ViewPlane[]): WildlifePorts & { held: Map<number, string>; released: number[] } {
  const held = new Map<number, string>();
  const released: number[] = [];
  return {
    held,
    released,
    slot(key, assetId) {
      if (!has(assetId)) return false;
      held.set(key, assetId);
      return true;
    },
    release(key) {
      held.delete(key);
      released.push(key);
    },
    planes: () => planes,
  };
}

describe("the wildlife, a frame at a time, with no engine", () => {
  it("gives every ground member in the disc a body of its species' model and says where it stands, seated on the ground", () => {
    const p = ports();
    const scene = createWildlifeScene(SEED, p);
    scene.update(CAM_X, CAM_Z, 0, FAR_AWAY, CLEAR, 12);
    expect(scene.ground.length).toBeGreaterThan(4);
    expect(scene.ground.length).toBe(p.held.size);
    const species = new Set(scene.ground.map((g) => g.species));
    expect([...species].sort()).toEqual([0, 1, 2, 3]);
    let seated = 0;
    for (const g of scene.ground) {
      expect(p.held.get(g.key)).toBe(SPECIES_ASSET[g.species]);
      expect(g.species).toBeLessThan(FIRST_BIRD_SPECIES);
      expect(Math.hypot(g.qx, g.qy, g.qz, g.qw)).toBeCloseTo(1, 6);
      expect(g.scale).toBeGreaterThanOrEqual(0);
      // A member standing on the ground stands a foot lift over it; one whole in the disc is drawn at its size.
      if (Math.abs(g.y - (elevationSampleAt(SEED, g.x, g.z).h + FOOT_LIFT)) < 1e-9 && g.scale > 0.5) seated++;
    }
    expect(seated).toBeGreaterThan(4);
    scene.dispose();
    expect(p.held.size).toBe(0);
  }, timeLimit(30_000));

  it("asks again each frame for a body it was refused, and draws no member without one", () => {
    let landed = false;
    const p = ports(() => landed);
    const scene = createWildlifeScene(SEED, p);
    scene.update(CAM_X, CAM_Z, 0, FAR_AWAY, CLEAR, 12);
    expect(scene.ground.length).toBe(0);
    landed = true;
    scene.update(CAM_X, CAM_Z, 1, FAR_AWAY, CLEAR, 12);
    expect(scene.ground.length).toBeGreaterThan(4);
    scene.dispose();
  }, timeLimit(30_000));

  it("lets a unit's bodies go when the disc moves on, each once, and only after a step of travel", () => {
    const p = ports();
    const scene = createWildlifeScene(SEED, p);
    scene.update(CAM_X, CAM_Z, 0, FAR_AWAY, CLEAR, 12);
    const before = [...p.held.keys()];
    scene.update(CAM_X + WILDLIFE_REBUILD_STEP - 1, CAM_Z, 1, FAR_AWAY, CLEAR, 12);
    expect(p.released).toEqual([]);
    scene.update(CAM_X + 5000, CAM_Z + 5000, 2, FAR_AWAY, CLEAR, 12);
    expect([...p.released].sort((a, b) => a - b)).toEqual(before.filter((key) => !p.held.has(key)).sort((a, b) => a - b));
    expect(p.released.length).toBeGreaterThan(0);
    expect(new Set(p.released).size).toBe(p.released.length);
    for (const key of p.released) expect(Number.isInteger(key / SLOT_STRIDE) || key % SLOT_STRIDE < SLOT_STRIDE).toBe(true);
    scene.dispose();
  }, timeLimit(30_000));

  it("collects its field as a turn of the loader of first builds while one is open", () => {
    const firstBuilds = createFirstBuilds();
    const p = ports();
    const scene = createWildlifeScene(SEED, p, { firstBuilds });
    scene.update(CAM_X, CAM_Z, 0, FAR_AWAY, CLEAR, 12);
    expect(scene.ground.length).toBe(0);
    firstBuilds.close();
    scene.update(CAM_X, CAM_Z, 1, FAR_AWAY, CLEAR, 12);
    expect(scene.ground.length).toBeGreaterThan(4);
    scene.dispose();
  }, timeLimit(30_000));

  it("says a member's clip runs only where the view's planes hold it", () => {
    // One plane facing +x at x = 1e7: everything in this world is behind it.
    const behind: ViewPlane[] = [{ normal: { x: 1, y: 0, z: 0 }, d: -1e7 }];
    const p = ports(() => true, behind);
    const scene = createWildlifeScene(SEED, p);
    scene.update(CAM_X, CAM_Z, 0, FAR_AWAY, CLEAR, 12);
    const far = scene.ground.filter((g) => Math.hypot(g.x - CAM_X, g.z - CAM_Z) > 30);
    expect(far.length).toBeGreaterThan(0);
    for (const g of far) expect(g.animate).toBe(false);
    expect(creatureInView(behind, 0, 0, 0, 10)).toBe(true);
    scene.dispose();
  }, timeLimit(30_000));

  it("fills a flying model's instances once the model is adopted: a matrix, a wing and, for the butterfly alone, a tint each", () => {
    const p = ports();
    const scene = createWildlifeScene(SEED, p);
    const assets = new Set<string>([BIRD_PERCHED_ASSET]);
    for (let s = FIRST_BIRD_SPECIES; s < BIRD_ASSET.length; s++) assets.add(BIRD_ASSET[s] as string);
    const buckets = [...assets].map((asset) => scene.adoptBird(asset));
    expect(scene.buckets).toEqual(buckets);
    // Two frames: a bird is posed by its first step, and drawn from the one after its unit is made.
    let drawn = 0;
    for (const [x, z] of [[CAM_X, CAM_Z], [0, 0], [-275, -1], [600, -100]] as const) {
      for (let tick = 0; tick < 3; tick++) scene.update(x, z, tick + drawn * 10, FAR_AWAY, CLEAR, 12);
      for (const bucket of buckets) {
        drawn += bucket.count;
        expect(bucket.matrices.length).toBeGreaterThanOrEqual(bucket.count * 16);
        expect(bucket.wing.length * 8).toBe(bucket.matrices.length);
        expect(bucket.tint === null).toBe(bucket.asset !== BIRD_ASSET[SPECIES_BUTTERFLY]);
        for (let i = 0; i < bucket.count; i++) expect(bucket.matrices[i * 16 + 15]).toBe(1);
      }
    }
    expect(drawn).toBeGreaterThan(0);
    scene.dispose();
    expect(scene.buckets.length).toBe(0);
  }, timeLimit(60_000));
});
