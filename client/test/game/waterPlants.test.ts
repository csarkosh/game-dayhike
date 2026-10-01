import { describe, expect, it, afterEach } from "vitest";
import { NullEngine } from "@babylonjs/core/Engines/nullEngine.js";
import { Scene } from "@babylonjs/core/scene.js";
import { Vector3 } from "@babylonjs/core/Maths/math.vector.js";
import "../../src/sim/olympic.js";
import { elevationAt } from "../../src/sim/terrain.js";
import { firstPondWorld, lakeOf } from "../sim/helpers/lakes.js";
import { BLADE_VERTS, bladeClumpGeometry, bladeVertexCount } from "../../src/game/bladeClump.js";
import {
  REED_CHARACTERS, REED_BLADES, reedGeometry, lilyPadGeometry, lilyFlowerGeometry, lilyFlowers,
  createWaterPlants, LILY_LIFT, LILY_FLOWER_PATCHES,
} from "../../src/game/waterPlants.js";
import { CLUTTER_LILY_PATCH_WAVE } from "../../src/sim/clutter.js";
import { timeLimit } from "../helpers/timeLimit.js";

let engine: NullEngine | null = null;
afterEach(() => { engine?.dispose(); engine = null; });

describe("the reeds and cattails", () => {
  it("stand 1.2 to 2 m tall across the class's 0.9 to 1.1 scale", () => {
    for (const c of REED_CHARACTERS) {
      expect(c.height[0] * 0.9).toBeGreaterThanOrEqual(1.2 - 1e-9);
      expect(c.height[1] * 1.1).toBeLessThanOrEqual(2 + 1e-9);
    }
  });

  it("give the cattail a brown head below every stalk's tip", () => {
    const stalks = REED_BLADES[2]!;
    // the layout the heads rely on: each blade's strip ends in its tip
    const raw = bladeClumpGeometry(REED_CHARACTERS[2]!, stalks);
    for (let b = 0; b < stalks; b++) expect(raw.blade[(b * BLADE_VERTS + BLADE_VERTS - 1) * 4 + 3]).toBe(1);
    const g = reedGeometry(2);
    const strip = bladeVertexCount(REED_CHARACTERS[2]!, stalks);
    const heads = g.positions.length / 3 - strip;
    expect(heads).toBe(stalks * 14);
    for (let b = 0; b < stalks; b++) {
      const tipY = g.positions[(b * BLADE_VERTS + BLADE_VERTS - 1) * 3 + 1]!;
      const headY = g.positions[(strip + b * 14 + 12) * 3 + 1]!; // the head's lower cap centre
      expect(headY).toBeLessThan(tipY);
      expect(headY).toBeGreaterThan(0.6 * tipY);
    }
    expect(reedGeometry(0).positions.length / 3).toBe(bladeVertexCount(REED_CHARACTERS[0]!, REED_BLADES[0]!));
  });
});

describe("the pond-lilies", () => {
  it("are notched discs lying flat", () => {
    const g = lilyPadGeometry();
    for (let i = 0; i < g.positions.length / 3; i++) {
      expect(g.positions[i * 3 + 1]).toBe(0);
      expect(Math.hypot(g.positions[i * 3]!, g.positions[i * 3 + 2]!)).toBeLessThanOrEqual(1 + 1e-6);
    }
    // nothing in the notch, along +x
    for (let i = 1; i < g.positions.length / 3; i++) {
      expect(Math.abs(Math.atan2(g.positions[i * 3 + 2]!, g.positions[i * 3]!))).toBeGreaterThan(0.24);
    }
    expect(lilyFlowerGeometry().indices.length).toBe(18);
  });

  it("flower in about a third of the patches", () => {
    let patches = 0, flowering = 0;
    for (let px = 0; px < 60; px++) {
      for (let pz = 0; pz < 60; pz++) {
        patches++;
        const inst = { cls: 10, x: (px + 0.5) * CLUTTER_LILY_PATCH_WAVE, z: (pz + 0.5) * CLUTTER_LILY_PATCH_WAVE, groundH: 0, groundDx: 0, groundDz: 0, scale: 0.15, variant: 0, hash: 0 };
        if (lilyFlowers(0x5eed, inst)) flowering++;
      }
    }
    expect(flowering / patches).toBeGreaterThan(LILY_FLOWER_PATCHES - 0.05);
    expect(flowering / patches).toBeLessThan(LILY_FLOWER_PATCHES + 0.05);
  });
});

describe("a lake's plants in the scene", { timeout: timeLimit(120_000) }, () => {
  it("stand a murky lake's reeds on its ground and float its pads on its water", () => {
    const { seed } = firstPondWorld((f) => (f.murk ?? 0) >= 0.8);
    const lake = lakeOf(seed);
    engine = new NullEngine();
    const scene = new Scene(engine);
    const plants = createWaterPlants(scene, seed, [lake]);
    expect(plants.meshes.map((m) => m.name)).toEqual(["water_reeds_0", "water_reeds_1", "water_reeds_2", "water_lily_pads", "water_lily_flowers"]);
    const reeds = plants.meshes.slice(0, 3).reduce((n, m) => n + m.thinInstanceCount, 0);
    expect(reeds).toBeGreaterThan(100);
    const t = new Vector3();
    for (const m of plants.meshes[0]!.thinInstanceGetWorldMatrices().slice(0, 20)) {
      m.getTranslationToRef(t);
      expect(t.y).toBeCloseTo(elevationAt(seed, t.x, t.z), 3);
    }
    const pads = plants.meshes[3]!;
    expect(pads.thinInstanceCount).toBeGreaterThan(20);
    for (const m of pads.thinInstanceGetWorldMatrices().slice(0, 20)) {
      m.getTranslationToRef(t);
      expect(t.y).toBeCloseTo(lake.level + LILY_LIFT, 3);
    }
    plants.dispose();
    expect(scene.getMeshByName("water_reeds_0")).toBeNull();
  });

  it("gives a clear lake none", () => {
    const { seed } = firstPondWorld((f) => (f.murk ?? 1) <= 0.5);
    engine = new NullEngine();
    const scene = new Scene(engine);
    const plants = createWaterPlants(scene, seed, [lakeOf(seed)]);
    for (const m of plants.meshes) {
      expect(m.thinInstanceCount).toBe(0);
      expect(m.isEnabled()).toBe(false);
    }
    plants.dispose();
  });
});
