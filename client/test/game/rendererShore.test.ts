// What a whole renderer makes by the water: the lake's life (its swarms, its
// frogs and its dragonflies, heard and drawn) and the sea's surf. Apart from
// `renderer.test.ts` and the lake's reflection's two files because vitest
// hands out files, not tests: as one file of about 290 s on a CI runner they
// were one of the floors under the client suite.
import { describe, it, expect, vi } from "vitest";

// `terrainTexture.ts`'s plugin constructor calls the real `loadGroundArrays`
// whenever it isn't handed a factory, and `renderer.ts`'s own
// `attachTerrainTexture(scene, mat)` call site never passes one — so the real
// loader would fetch the ground's layer images and decode them, which a suite
// under Node cannot (`groundMaps.test.ts` hands the loader its own decoder).
// Mocked here, at the module boundary, rather than by touching `renderer.ts`.
vi.mock("../../src/game/groundMaps.js", () => ({
  reportLayer: () => undefined,
  loadGroundArrays: () => ({
    normals: { isReady: () => true, dispose() {} },
    // `getSize` mirrors the real `BaseTexture` surface `bindForSubMesh` reads
    // (`terrainReliefOn`'s placeholder-vs-real signature) — present here so a
    // future test that exercises binding fails on the plugin code, not on a
    // mock that is missing a method the real texture always has.
    rah: { isReady: () => true, dispose() {}, getSize: () => ({ width: 1, height: 1 }) },
    ready: Promise.resolve(),
    dispose() {},
  }),
}));

// `createRenderer` builds a real WebGL `Engine`, which needs a canvas and a
// context this suite does not have. Substituted with `NullEngine` at the
// module boundary — same trick as the `groundMaps` mock above — so the tests
// below can build whole renderers anyway.
vi.mock("@babylonjs/core/Engines/engine.js", async () => {
  const mod = await vi.importActual<typeof import("@babylonjs/core/Engines/nullEngine.js")>(
    "@babylonjs/core/Engines/nullEngine.js",
  );
  return { Engine: mod.NullEngine };
});

// Every mesh the renderer hands the shadows, recorded on the way through to
// the real lighting: the lake's life is never among them.
const shadowCasters = vi.hoisted(() => new Set<unknown>());
vi.mock("../../src/game/lighting.js", async (importOriginal) => {
  const mod = await importOriginal<typeof import("../../src/game/lighting.js")>();
  return {
    ...mod,
    createLighting: (...args: Parameters<typeof mod.createLighting>) => {
      const lighting = mod.createLighting(...args);
      const add = lighting.addShadowMesh.bind(lighting);
      lighting.addShadowMesh = (mesh) => {
        shadowCasters.add(mesh);
        add(mesh);
      };
      return lighting;
    },
  };
});

// What the sea's edge hands the wet ground's module, recorded on the way
// through to the real setters.
const wetCalls = vi.hoisted(() => ({ cove: [] as number[][], swash: [] as Float32Array[] }));
vi.mock("../../src/game/wetPlugin.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/game/wetPlugin.js")>();
  return {
    ...actual,
    setWetCove: (...args: Parameters<typeof actual.setWetCove>) => {
      wetCalls.cove.push([...args]);
      actual.setWetCove(...args);
    },
    setWetSwash: (data: Float32Array) => {
      wetCalls.swash.push(data);
      actual.setWetSwash(data);
    },
  };
});

// The terrain field lives behind the variant registry, and `activeTerrainVariant`
// throws until something has registered one. `app.ts` gets that transitively
// through `forest.ts`; a renderer-only test has to ask for it.
import "../../src/sim/passes/index.js";
import { createRenderer } from "../../src/game/renderer.js";
import { WEATHER_PRESETS } from "../../src/game/weather.js";
import type { Level } from "../../src/sim/level.js";
import { createForest } from "../../src/sim/forest.js";
import { elevationAt } from "../../src/sim/terrain.js";
import { timeLimit } from "../helpers/timeLimit.js";
import { skyFixture } from "./helpers/skyFixture.js";
import { EMPTY_LEVEL, windTestPlayer, windTestState } from "./helpers/rendererWorld.js";
import { waterLifeLayout } from "../../src/game/waterLifeField.js";
import { MIDGE_NAME } from "../../src/game/midgeSwarms.js";
import { lakeOf } from "../sim/helpers/lakes.js";
import { rayToShore } from "../../src/sim/lakeShape.js";
import { SILENT_SURF_SOUND } from "../../src/game/surfSound.js";

describe("the lake's life in a renderer", () => {
  const SEED = 388817;
  const LEVEL: Level = { id: "water-life-test", brushes: [], playerSpawns: [], enemySpawns: [] };
  const FAKE_CANVAS = { renderWidth: 1600, renderHeight: 900 } as unknown as HTMLCanvasElement;

  it("is silent before its first frame and hums by a swarm at dusk in a world with a lake", () => {
    const renderer = createRenderer(FAKE_CANVAS, LEVEL, createForest(SEED), { tier: "medium", skyTable: skyFixture() });
    try {
      expect(renderer.hasWaterLife).toBe(true);
      expect(renderer.waterLifeSound().hums_n).toBe(0);
      const marker = waterLifeLayout(SEED, lakeOf(SEED)).markers[0]!;
      renderer.setView(18.5, WEATHER_PRESETS.clear);
      renderer.setFreecam({ x: marker.x, y: marker.y, z: marker.z + 1, yaw: 0, pitch: 0 });
      renderer.sync(windTestState(), 1, 0, { dt: 1 / 60, sprinting: false });
      const sound = renderer.waterLifeSound();
      // A hum a swarm: the first marker's own, present, beside the camera.
      expect(sound.hums_n).toBe(30);
      expect(sound.hums[0]!.presence).toBe(1);
      expect(Math.hypot(sound.hums[0]!.x - marker.x, sound.hums[0]!.z - marker.z)).toBeLessThan(2 * marker.radius);
      // 230 Hz at 15 °C and 10 Hz a degree: 19.04 °C at 18:30 under a clear sky.
      expect(sound.pitch).toBeCloseTo(270.43807145043604, 9);
      // The same object, refilled each frame.
      renderer.sync(windTestState(), 1, 0, { dt: 1 / 60, sprinting: false });
      expect(renderer.waterLifeSound()).toBe(sound);
    } finally {
      renderer.dispose();
    }
  }, timeLimit(120_000));

  it("is heard as silence from a frame that does not step it, never as the last frame's calls again", () => {
    const renderer = createRenderer(FAKE_CANVAS, LEVEL, createForest(SEED), { tier: "low", skyTable: skyFixture() });
    try {
      // At night on the shore, stepped until a frame brings frog calls (the
      // first within ten seconds).
      const lake = lakeOf(SEED);
      const x = lake.x + rayToShore(lake.shape, lake.x, lake.z, 1, 0, 0, lake.bound) + 2;
      const at = { x, y: elevationAt(SEED, x, lake.z) + 1.6, z: lake.z, yaw: 0, pitch: 0 };
      renderer.setView(22, WEATHER_PRESETS.clear);
      renderer.setFreecam(at);
      const state = windTestState();
      const frame = (): void => {
        state.tick += 15;
        renderer.sync(state, 1, 0, { dt: 0.25, sprinting: false });
      };
      for (let i = 0; i < 60 && renderer.waterLifeSound().frogCalls.length === 0; i++) frame();
      const stepped = renderer.waterLifeSound();
      const calls = stepped.frogCalls.length;
      expect(calls).toBeGreaterThan(0);
      expect(stepped.bed.level).toBe(1);
      // The player's branch with no local player steps nothing: the frame is
      // silent, and the calls are not handed out a second time.
      renderer.setFreecam(null);
      frame();
      const unstepped = renderer.waterLifeSound();
      expect(unstepped).not.toBe(stepped);
      expect([unstepped.hums_n, unstepped.rustles.length, unstepped.frogCalls.length, unstepped.bed.level]).toEqual([0, 0, 0, 0]);
      frame();
      expect(renderer.waterLifeSound()).toBe(unstepped);
      // One silent object for every caller, frozen through.
      for (const part of [unstepped, unstepped.hums, unstepped.rustles, unstepped.frogCalls, unstepped.bed, unstepped.bed.duck, unstepped.bed.points, ...unstepped.bed.points]) {
        expect(Object.isFrozen(part)).toBe(true);
      }
      // A frame that steps it again is heard again, from its own record.
      renderer.setFreecam(at);
      frame();
      expect(renderer.waterLifeSound()).toBe(stepped);
      expect(stepped.bed.level).toBe(1);
    } finally {
      renderer.dispose();
    }
  }, timeLimit(120_000));

  it("draws its midges and its dragonflies last among the see-through effects and never casts a shadow with them", () => {
    shadowCasters.clear();
    const renderer = createRenderer(FAKE_CANVAS, LEVEL, createForest(SEED), { tier: "high", skyTable: skyFixture() });
    try {
      const life = renderer.scene.meshes.filter((m) => m.name === MIDGE_NAME || m.name.startsWith("dragonfly_"));
      expect(life.map((m) => m.name)).toEqual([MIDGE_NAME, "dragonfly_darner", "dragonfly_skimmer", "dragonfly_damselfly"]);
      // The midges are toned as the dome is: the NullEngine has no float
      // targets, so even the high tier draws on the material path here.
      const floats = (name: string) => (renderer.scene.getMaterialByName(name) as unknown as { _floats: Record<string, number> })._floats;
      expect([floats(MIDGE_NAME)["midgeToneMap"], floats("skyDome")["skyToneMap"]]).toEqual([1, 1]);
      // At noon on the shore, so the dragonflies are out, over a few frames
      // that register the casters that land late.
      const marker = waterLifeLayout(SEED, lakeOf(SEED)).markers[0]!;
      renderer.setView(12, WEATHER_PRESETS.clear);
      renderer.setFreecam({ x: marker.x, y: marker.y, z: marker.z + 1, yaw: 0, pitch: 0 });
      for (let i = 0; i < 3; i++) renderer.sync(windTestState(), 1, 0, { dt: 1 / 60, sprinting: false });
      // The terrain's rings at least went to the shadows; nothing of the lake's life did.
      expect(shadowCasters.size).toBeGreaterThan(0);
      for (const mesh of life) {
        expect(shadowCasters.has(mesh)).toBe(false);
        expect(mesh.receiveShadows).toBe(false);
        // Its bounds sit at the origin: last in the blended sort, whatever the
        // camera's distance from there.
        expect(mesh.alphaIndex).toBe(Number.POSITIVE_INFINITY);
      }
    } finally {
      renderer.dispose();
    }
  }, timeLimit(120_000));

  it("keeps each player's swarm over their own head when a player before them leaves", () => {
    const renderer = createRenderer(FAKE_CANVAS, LEVEL, createForest(SEED), { tier: "low", skyTable: skyFixture() });
    try {
      const lake = lakeOf(SEED);
      // Three players standing 2 m out from the shore at dusk.
      const players = [0, 0.6, 1.2].map((angle, i) => {
        const out = rayToShore(lake.shape, lake.x, lake.z, Math.cos(angle), Math.sin(angle), 0, lake.bound) + 2;
        const x = lake.x + Math.cos(angle) * out;
        const z = lake.z + Math.sin(angle) * out;
        const p = windTestPlayer(i + 1);
        p.pos = { x, y: elevationAt(SEED, x, z) + 0.9, z };
        return p;
      });
      const state = windTestState(...players);
      renderer.setView(18.5, WEATHER_PRESETS.clear);
      const first = players[0]!.pos;
      renderer.setFreecam({ x: first.x, y: first.y + 0.7, z: first.z, yaw: 0, pitch: 0 });
      // Thirteen seconds standing still: a swarm over each head, formed at
      // ten and gathered whole three seconds on.
      const frame = (): void => {
        state.tick += 15;
        renderer.sync(state, 1, 0, { dt: 0.25, sprinting: false });
      };
      for (let i = 0; i < 52; i++) frame();
      const sound = renderer.waterLifeSound();
      /** The head swarm's hum of slot h: its presence and how far it is from player p. */
      const head = (h: number, p: number): [number, number] => {
        const hum = sound.hums[25 + h]!;
        const at = players[p]!.pos;
        return [hum.presence, Math.hypot(hum.x - at.x, hum.z - at.z)];
      };
      for (let h = 0; h < 3; h++) {
        const [presence, off] = head(h, h);
        expect(presence).toBe(1);
        expect(off).toBeLessThan(1);
      }
      // The second player leaves: theirs thins out over three seconds and
      // goes, and the third's stays over the third player, frame after frame.
      state.players.delete(2);
      for (let i = 0; i < 12; i++) frame();
      expect(head(1, 1)[0]).toBe(0);
      const [presence, off] = head(2, 2);
      expect(presence).toBe(1);
      expect(off).toBeLessThan(1);
    } finally {
      renderer.dispose();
    }
  }, timeLimit(120_000));

  it("has none in a world without a lake, without a forest, or with the animals turned off, and is silent there", () => {
    // 4242's world has no lake.
    const dry = createRenderer(FAKE_CANVAS, LEVEL, createForest(4242), { tier: "low", skyTable: skyFixture() });
    try {
      expect(dry.hasWaterLife).toBe(false);
      dry.sync(windTestState(windTestPlayer(1)), 1, 0, { dt: 1 / 60, sprinting: false });
      expect(dry.waterLifeSound().hums_n).toBe(0);
    } finally {
      dry.dispose();
    }
    const bare = createRenderer(FAKE_CANVAS, EMPTY_LEVEL, null, { tier: "low", skyTable: skyFixture() });
    try {
      expect(bare.hasWaterLife).toBe(false);
      bare.sync(windTestState(windTestPlayer(1)), 1, 0, { dt: 1 / 60, sprinting: false });
      const sound = bare.waterLifeSound();
      expect([sound.hums_n, sound.rustles.length, sound.frogCalls.length]).toEqual([0, 0, 0]);
    } finally {
      bare.dispose();
    }
    const off = createRenderer(FAKE_CANVAS, LEVEL, createForest(SEED), { tier: "low", skyTable: skyFixture(), wildlife: false });
    try {
      expect(off.hasWaterLife).toBe(false);
    } finally {
      off.dispose();
    }
  }, timeLimit(120_000));
});

describe("the surf in a renderer", () => {
  const SEED = 388817;
  const LEVEL: Level = { id: "surf-test", brushes: [], playerSpawns: [], enemySpawns: [] };
  const FAKE_CANVAS = { renderWidth: 1600, renderHeight: 900 } as unknown as HTMLCanvasElement;

  it("has no sea in a hand-authored level, and is silent and frozen there", () => {
    const bare = createRenderer(FAKE_CANVAS, EMPTY_LEVEL, null, { tier: "low", skyTable: skyFixture() });
    try {
      expect(bare.hasSea).toBe(false);
      bare.sync(windTestState(windTestPlayer(1)), 1, 0, { dt: 1 / 60, sprinting: false });
      const sound = bare.surfSound();
      expect(sound).toBe(SILENT_SURF_SOUND);
      expect(Object.isFrozen(sound)).toBe(true);
      expect([sound.present, sound.plunges.count, sound.backwash.count]).toEqual([false, 0, 0]);
    } finally {
      bare.dispose();
    }
  }, timeLimit(120_000));

  it("in a world with a sea is silent before its first frame, heard from a frame that steps it, the same record each frame, and silent again from one that does not", () => {
    wetCalls.cove.length = 0;
    wetCalls.swash.length = 0;
    const renderer = createRenderer(FAKE_CANVAS, LEVEL, createForest(SEED), { tier: "medium", skyTable: skyFixture() });
    try {
      expect(renderer.hasSea).toBe(true);
      expect(renderer.surfSound()).toBe(SILENT_SURF_SOUND);
      expect(wetCalls.swash).toHaveLength(0);
      // Above the cove's waterline at its centre (z = 0, x = −472.26 for this seed).
      renderer.setFreecam({ x: -480, y: 6, z: 0, yaw: Math.PI / 2, pitch: 0 });
      renderer.sync(windTestState(), 1, 0, { dt: 1 / 60, sprinting: false });
      const sound = renderer.surfSound();
      expect(sound).not.toBe(SILENT_SURF_SOUND);
      expect(Object.isFrozen(sound)).toBe(false);
      // The wet ground was handed the cove and the table's 512 columns, once this frame.
      expect(wetCalls.cove).toEqual([[0, 163.4167872555554, -24, 1 / 12]]);
      expect(wetCalls.swash).toHaveLength(1);
      expect(wetCalls.swash[0]!.length).toBe(2048);
      renderer.sync(windTestState(), 1, 0, { dt: 1 / 60, sprinting: false });
      expect(renderer.surfSound()).toBe(sound);
      // And once again the next, the same table.
      expect(wetCalls.cove).toHaveLength(2);
      expect(wetCalls.swash).toHaveLength(2);
      expect(wetCalls.swash[1]).toBe(wetCalls.swash[0]);
      // No local player and no free camera: the sea's edge is not stepped, and nothing is heard.
      renderer.setFreecam(null);
      renderer.sync(windTestState(), 1, 0, { dt: 1 / 60, sprinting: false });
      expect(renderer.surfSound()).toBe(SILENT_SURF_SOUND);
      expect(wetCalls.swash).toHaveLength(2);
    } finally {
      renderer.dispose();
    }
  }, timeLimit(120_000));
});
