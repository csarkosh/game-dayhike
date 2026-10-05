import { describe, it, expect, afterEach, vi } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { NullEngine } from "@babylonjs/core/Engines/nullEngine.js";
import { Engine } from "@babylonjs/core/Engines/engine.js";
import { Scene } from "@babylonjs/core/scene.js";
import { PBRMaterial } from "@babylonjs/core/Materials/PBR/pbrMaterial.js";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial.js";
import { VertexBuffer } from "@babylonjs/core/Buffers/buffer.js";
import { EngineStore } from "@babylonjs/core/Engines/engineStore.js";
import type { TerrainTexturePlugin } from "../../src/game/terrainTexture.js";

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
// module boundary — same trick as the `groundMaps` mock above — so the wind
// test below (the one case that needs a whole `Renderer`, not one exported
// piece of it) can build one anyway.
vi.mock("@babylonjs/core/Engines/engine.js", async () => {
  const mod = await vi.importActual<typeof import("@babylonjs/core/Engines/nullEngine.js")>(
    "@babylonjs/core/Engines/nullEngine.js",
  );
  return { Engine: mod.NullEngine };
});

// The sky source a renderer starts when it is given no table: here the
// fixture's table, at once, so every renderer in this file lights itself as
// it is built, with a record of each source started and stopped.
const skySources = vi.hoisted(() => ({ started: [] as number[], stopped: 0 }));
vi.mock("../../src/game/skyWorker.js", async () => {
  const { skyFixture } = await import("./helpers/skyFixture.js");
  return {
    startSkySource: (startDeg: number) => {
      skySources.started.push(startDeg);
      return {
        table: skyFixture(),
        dispose: () => {
          skySources.stopped += 1;
        },
      };
    },
  };
});

// Every pose the renderer hands the blade field to cut to, recorded on the way
// through to the real shell (which still cuts), so a test can read what the
// renderer's per-frame cull hook measured.
const bladeCullPoses = vi.hoisted(() => [] as { aspect: number }[]);
vi.mock("../../src/game/bladeMeshes.js", async (importOriginal) => {
  const mod = await importOriginal<typeof import("../../src/game/bladeMeshes.js")>();
  return {
    ...mod,
    createBladeMeshes: (...args: Parameters<typeof mod.createBladeMeshes>) => {
      const blades = mod.createBladeMeshes(...args);
      const cull = blades.cull.bind(blades);
      blades.cull = (pose) => {
        if (pose !== null) bladeCullPoses.push({ ...pose });
        cull(pose);
      };
      return blades;
    },
  };
});

// Every update the renderer gives the mist banks and the motes, counted on the
// way through to the real shells.
const effectUpdates = vi.hoisted(() => ({ mist: 0, motes: 0 }));
vi.mock("../../src/game/mistMeshes.js", async (importOriginal) => {
  const mod = await importOriginal<typeof import("../../src/game/mistMeshes.js")>();
  return {
    ...mod,
    createMistMeshes: (...args: Parameters<typeof mod.createMistMeshes>) => {
      const mist = mod.createMistMeshes(...args);
      const update = mist.update.bind(mist);
      mist.update = (...at) => {
        effectUpdates.mist += 1;
        update(...at);
      };
      return mist;
    },
  };
});
vi.mock("../../src/game/motes.js", async (importOriginal) => {
  const mod = await importOriginal<typeof import("../../src/game/motes.js")>();
  return {
    ...mod,
    createMotes: (...args: Parameters<typeof mod.createMotes>) => {
      const motes = mod.createMotes(...args);
      if (motes === null) return null;
      const update = motes.update.bind(motes);
      motes.update = (...at) => {
        effectUpdates.motes += 1;
        update(...at);
      };
      return motes;
    },
  };
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

// The terrain field lives behind the variant registry, and `activeTerrainVariant`
// throws until something has registered one. `app.ts` gets that transitively
// through `forest.ts`; a renderer-only test has to ask for it.
import "../../src/sim/passes/index.js";
import {
  applyRingGeometry,
  applyWetness,
  createClipmap,
  createClipmapMesh,
  createPlayerSlots,
  createRenderer,
  GAME_FOV,
  pixelAtOneMetre,
  skyLumaOf,
  terrainMaterialFor,
  writeListenerPose,
} from "../../src/game/renderer.js";
import {
  createRingSamples,
  holeCellsFor,
  ringGeometry,
  ringSpacing,
  HOLE_CELLS,
  RING_CELLS,
  RING_COUNT,
  type RingSamples,
} from "../../src/game/clipmap.js";
import { WEATHER_PRESETS } from "../../src/game/weather.js";
import type { Level } from "../../src/sim/level.js";
import { AiState, Outcome, Phase, type EnemyState, type PlayerState, type WorldState } from "../../src/sim/types.js";
import { createForest } from "../../src/sim/forest.js";
import { elevationAt } from "../../src/sim/terrain.js";
import { timeLimit } from "../helpers/timeLimit.js";
import { createSkyTable } from "../../src/game/skyTable.js";
import { skyFixture } from "./helpers/skyFixture.js";
import { skyStateFor } from "../../src/game/skyState.js";
import { waterLifeLayout } from "../../src/game/waterLifeField.js";
import { MIDGE_NAME } from "../../src/game/midgeSwarms.js";
import { lakeOf } from "../sim/helpers/lakes.js";

let engine: NullEngine | null = null;

afterEach(() => {
  engine?.dispose();
  engine = null;
});

function scene(): Scene {
  engine = new NullEngine();
  return new Scene(engine);
}

describe("terrainMaterialFor", () => {
  it("returns a PBR material, not a StandardMaterial", () => {
    // Terrain materials are PBR, not Standard: a
    // StandardMaterial ignores the environment texture entirely, so image-based
    // lighting would silently do nothing.
    const s = scene();
    const mat = terrainMaterialFor(s, "terrain");
    expect(mat).toBeInstanceOf(PBRMaterial);
    expect(mat).not.toBeInstanceOf(StandardMaterial);
  });

  it("leaves terrain albedo white so vertex colours are the palette", () => {
    // PBR multiplies vertex colour into albedo. Tinting the material as well
    // would multiply the palette twice and darken everything.
    const s = scene();
    const mat = terrainMaterialFor(s, "terrain");
    expect(mat.albedoColor.r).toBeCloseTo(1, 6);
    expect(mat.albedoColor.g).toBeCloseTo(1, 6);
    expect(mat.albedoColor.b).toBeCloseTo(1, 6);
  });

  it("gives non-terrain materials their palette colour", () => {
    const s = scene();
    const mat = terrainMaterialFor(s, "platform");
    expect(mat.albedoColor.b).toBeGreaterThan(mat.albedoColor.r);
  });

  it("keeps world surfaces dielectric and rough", () => {
    // Metallic terrain is the classic PBR mistake and reads as wet plastic.
    const s = scene();
    for (const name of ["terrain", "concrete", "wall", "platform"]) {
      const mat = terrainMaterialFor(s, name);
      expect(mat.metallic).toBe(0);
      expect(mat.roughness).toBeGreaterThan(0.5);
    }
  });

  it("caches one material per name", () => {
    const s = scene();
    expect(terrainMaterialFor(s, "terrain")).toBe(terrainMaterialFor(s, "terrain"));
    expect(terrainMaterialFor(s, "terrain")).not.toBe(terrainMaterialFor(s, "concrete"));
  });
});

describe("clipmap meshes", () => {
  it("uploads positions, normals and stride-4 colours", () => {
    // The wiring bug this catches: building colours in clipmap.ts and never
    // putting them on the mesh — identical on screen to never computing them.
    const s = scene();
    const mesh = createClipmapMesh(s, "clipmap_test");
    applyRingGeometry(mesh, ringGeometry(createRingSamples(0x7e44a1, 5, 0, 0), null, null));
    expect(mesh.isVerticesDataPresent(VertexBuffer.PositionKind)).toBe(true);
    expect(mesh.isVerticesDataPresent(VertexBuffer.NormalKind)).toBe(true);
    expect(mesh.isVerticesDataPresent(VertexBuffer.ColorKind)).toBe(true);
    // `VertexData.applyToMesh` uploads colours with a hard-coded stride of 4.
    // A 3-component array would still leave `isVerticesDataPresent` above
    // `true` and then get reinterpreted as garbage — silently. Read the
    // buffer back off the mesh (not `ringGeometry`'s return value) so this
    // checks what actually reached the mesh.
    const positions = mesh.getVerticesData(VertexBuffer.PositionKind);
    const colors = mesh.getVerticesData(VertexBuffer.ColorKind);
    expect(positions).not.toBeNull();
    expect(colors).not.toBeNull();
    expect((colors as Float32Array).length).toBe(((positions as Float32Array).length / 3) * 4);
  });

  it("re-upload replaces every buffer, including the index count", () => {
    // Not "in place": `Geometry.setVerticesData` builds a new VertexBuffer and
    // disposes the old one on every call, whatever `updatable` says. What must
    // hold is that ALL FOUR buffers follow the second call — a ring that
    // scrolls its positions while keeping the first upload's normals or colours
    // would light and tint the new ground with the old ground's values.
    const s = scene();
    const mesh = createClipmapMesh(s, "clipmap_test");
    const read = (kind: string): Float32Array =>
      mesh.getVerticesData(kind) as Float32Array;

    applyRingGeometry(mesh, ringGeometry(createRingSamples(0x7e44a1, 5, 0, 0), null, null));
    const before = {
      position: read(VertexBuffer.PositionKind)[1] as number,
      normal: read(VertexBuffer.NormalKind)[0] as number,
      color: read(VertexBuffer.ColorKind)[1] as number,
      indices: mesh.getTotalIndices(),
    };
    expect(before.indices).toBe(RING_CELLS * RING_CELLS * 6);

    // Second upload carries a hole, which is the shape every ring but ring 0
    // actually uses — the first upload's solid index buffer is the exception.
    const ring = createRingSamples(0x7e44a1, 5, 5000, 5000);
    const finer = createRingSamples(0x7e44a1, 4, 5000, 5000);
    applyRingGeometry(mesh, ringGeometry(ring, holeCellsFor(ring, finer), null));

    expect(read(VertexBuffer.PositionKind)[1]).not.toBe(before.position);
    expect(read(VertexBuffer.NormalKind)[0]).not.toBe(before.normal);
    expect(read(VertexBuffer.ColorKind)[1]).not.toBe(before.color);
    expect(mesh.getTotalIndices()).toBe(
      (RING_CELLS * RING_CELLS - HOLE_CELLS * HOLE_CELLS) * 6,
    );
  });

  it("receives shadows and takes the white terrain material", () => {
    const s = scene();
    const mesh = createClipmapMesh(s, "clipmap_test");
    expect(mesh.receiveShadows).toBe(true);
    expect(mesh.material).toBe(terrainMaterialFor(s, "terrain"));
  });
});

describe("createClipmap", () => {
  const SEED = 0x7e44a1;

  /**
   * What each ring's mesh must be holding, built from scratch at this camera
   * position with no scrolling and no incremental state involved. Seven fresh
   * rings, reused across all levels, because each level needs the one inside it.
   */
  function expectedAt(camX: number, camZ: number): { positions: Float32Array; indices: Uint16Array }[] {
    const fresh: RingSamples[] = [];
    for (let level = 0; level < RING_COUNT; level++) {
      fresh.push(createRingSamples(SEED, level, camX, camZ));
    }
    return fresh.map((ring, level) =>
      ringGeometry(
        ring,
        level === 0 ? null : holeCellsFor(ring, fresh[level - 1]!),
        // The border blends to the coarser ring's samples, so this must be
        // the real neighbour ring, not a boolean —
        // createClipmap emits with exactly this ring, and the tests below
        // compare positions bit-for-bit against it.
        level < RING_COUNT - 1 ? fresh[level + 1]! : null,
      ),
    );
  }

  it("re-emits a ring whose hole moved even when the ring itself did not", () => {
    // THE test for the re-emit rule. `snapOrigin` puts ring L on a lattice of
    // 2^(L+1) m, so stepping the camera 2 m from the origin moves ring 0 (step
    // 2 m) and leaves ring 1 (step 4 m) exactly where it was. Ring 1 must still
    // re-emit: its index-buffer hole follows ring 0's footprint, which just
    // slid one coarse cell. Drop the `moved[level - 1]` clause in
    // `createClipmap` and ring 1 keeps a hole cut for ring 0's old position —
    // a tear in the terrain that nothing reports.
    const s = scene();
    const clipmap = createClipmap(s, SEED);
    expect(ringSpacing(0)).toBe(1); // ring 0 snaps every 2 m
    expect(ringSpacing(1)).toBe(2); // ring 1 snaps every 4 m, so it will not move

    clipmap.update(2, 0);

    const want = expectedAt(2, 0);
    // Ring 1's vertices are unchanged — only its index buffer is stale — so
    // indices are where the whole tell lives.
    expect(Array.from(clipmap.meshes[1]!.getIndices()!)).toEqual(Array.from(want[1]!.indices));
    expect(clipmap.meshes[0]!.getVerticesData(VertexBuffer.PositionKind)).toEqual(want[0]!.positions);
  });

  // Explicit 30 s timeout, not a smaller assertion: three camera moves × seven
  // rings × a from-scratch rebuild each already ran near vitest's 5000 ms
  // default, and the two extra per-vertex Float32Arrays the ground-texture
  // attributes added pushed it over under full-suite load. Several other
  // suites in this repo need `--testTimeout=30000` for the same reason.
  it("leaves every ring matching a from-scratch rebuild as the camera moves", () => {
    const s = scene();
    const clipmap = createClipmap(s, SEED);
    for (const [x, z] of [[2, 0], [37.5, -18.25], [-260.75, 96]] as const) {
      clipmap.update(x, z);
      const want = expectedAt(x, z);
      for (let level = 0; level < RING_COUNT; level++) {
        const mesh = clipmap.meshes[level]!;
        expect(
          Array.from(mesh.getIndices()!),
          `indices, ring ${level} at (${x}, ${z})`,
        ).toEqual(Array.from(want[level]!.indices));
        expect(
          mesh.getVerticesData(VertexBuffer.PositionKind),
          `positions, ring ${level} at (${x}, ${z})`,
        ).toEqual(want[level]!.positions);
      }
    }
  }, timeLimit(30000));

  it("builds one named mesh per ring and disposes them all", () => {
    const s = scene();
    const clipmap = createClipmap(s, SEED);
    expect(clipmap.meshes).toHaveLength(RING_COUNT);
    for (let level = 0; level < RING_COUNT; level++) {
      expect(s.getMeshByName(`clipmap_${level}`)).toBe(clipmap.meshes[level]);
    }
    clipmap.dispose();
    expect(s.getMeshByName("clipmap_0")).toBeNull();
  });
});

describe("applyWetness", () => {
  it("darkens and glosses cached materials, and restores exactly at clear", () => {
    const s = scene();
    const terrain = terrainMaterialFor(s, "terrain");
    const wall = terrainMaterialFor(s, "wall");
    const baseAlbedo = wall.albedoColor.r;
    const baseRough = terrain.roughness!;

    applyWetness(s, WEATHER_PRESETS.rain); // wetness 1
    expect(wall.albedoColor.r).toBeCloseTo(baseAlbedo * 0.62, 10);
    expect(terrain.roughness).toBeCloseTo(baseRough * 0.6, 10);

    applyWetness(s, WEATHER_PRESETS.clear); // wetness 0 — exact restore
    expect(wall.albedoColor.r).toBe(baseAlbedo);
    expect(terrain.roughness).toBe(baseRough);
  });
});

/** A hand-authored level with nothing in it: `forest: null` keeps the forest,
 * clutter and mist shells out of the renderer this fixture builds, so the
 * wind test below only has to reckon with what it actually reads. */
const EMPTY_LEVEL: Level = { id: "wind-test", brushes: [], playerSpawns: [], enemySpawns: [] };

function windTestPlayer(id: number): PlayerState {
  return {
    id,
    pos: { x: id, y: 0.9, z: 0 },
    vel: { x: 0, y: 0, z: 0 },
    yaw: 0,
    pitch: 0,
    health: 100,
    grounded: true,
    lastProcessedInput: 0,
    deathPos: null,
    lamp: { on: false, charge: 1 },
    stare: 0,
    safe: false,
  };
}

function windTestState(...players: PlayerState[]): WorldState {
  return {
    tick: 1,
    players: new Map(players.map((p) => [p.id, p])),
    enemies: new Map(),
    outcome: Outcome.Playing,
    phase: Phase.Climb,
    nextEntityId: 10,
    rngSeed: 1,
  };
}

describe("renderer.wind()", () => {
  it("is the weather-driven record until an override, then the override's speed", () => {
    const canvas = {} as unknown as HTMLCanvasElement;
    const renderer = createRenderer(canvas, EMPTY_LEVEL, null);
    const state = windTestState(windTestPlayer(1));
    try {
      renderer.setWeather(WEATHER_PRESETS.rain, 0);
      renderer.sync(state, 1, 0);
      expect(renderer.wind().speed).toBeCloseTo(0.9, 6);

      renderer.setWindOverride(0);
      renderer.sync(state, 1, 0);
      expect(renderer.wind().speed).toBe(0);
      expect(renderer.wind().lean).toBe(0);

      renderer.setWindOverride(null);
      renderer.sync(state, 1, 0);
      expect(renderer.wind().speed).toBeCloseTo(0.9, 6);
    } finally {
      renderer.dispose();
    }
  });
});

describe("the sea's clock", () => {
  it("runs the wind on the simulation's tick and its fraction, unless a scene hands in its own clock", () => {
    const canvas = {} as unknown as HTMLCanvasElement;
    const state = { ...windTestState(windTestPlayer(1)), tick: 7200 };
    const shared = createRenderer(canvas, EMPTY_LEVEL, null);
    try {
      shared.sync(state, 1, 0.5);
      // (7200 + 0.5) ticks at 60 Hz: the same on every peer at that tick.
      expect(shared.wind().time).toBeCloseTo(120.00833333333333, 9);
      expect(shared.wind().dirX).toBeCloseTo(0.335780920274179, 9);
      expect(shared.wind().dirZ).toBeCloseTo(0.9419401114613526, 9);
    } finally {
      shared.dispose();
    }
    const stepped = createRenderer(canvas, EMPTY_LEVEL, null, { clock: () => 5000 });
    try {
      stepped.sync(state, 1, 0.5);
      expect(stepped.wind().time).toBeCloseTo(5, 9);
    } finally {
      stepped.dispose();
    }
  });
});

describe("the renderer's sky", () => {
  it("starts a source of its own at the default hour's sun when it is given no table, and stops it with itself", () => {
    skySources.started.length = 0;
    skySources.stopped = 0;
    const renderer = createRenderer({} as unknown as HTMLCanvasElement, EMPTY_LEVEL, null, { tier: "low" });
    // Noon's sun, 75.96 degrees up the tilted arc.
    expect(skySources.started.length).toBe(1);
    expect(skySources.started[0]).toBeCloseTo(75.96375653207352, 10);
    expect(skySources.stopped).toBe(0);
    renderer.dispose();
    expect(skySources.stopped).toBe(1);
  });

  it("reads a table it is given, and starts and stops no source of its own", () => {
    skySources.started.length = 0;
    skySources.stopped = 0;
    const renderer = createRenderer({} as unknown as HTMLCanvasElement, EMPTY_LEVEL, null, { tier: "low", skyTable: skyFixture() });
    renderer.dispose();
    expect(skySources.started).toEqual([]);
    expect(skySources.stopped).toBe(0);
  });

  it("moves no mist bank or mote before the table holds its first slices, on either camera, and moves both once it does", () => {
    const table = createSkyTable();
    const renderer = createRenderer({} as unknown as HTMLCanvasElement, EMPTY_LEVEL, createForest(388817), { tier: "medium", skyTable: table });
    const state = windTestState(windTestPlayer(1));
    try {
      effectUpdates.mist = 0;
      effectUpdates.motes = 0;
      // The player's camera, then the free one: their colour would be the
      // empty gradient's black.
      renderer.sync(state, 1, 0);
      renderer.setFreecam({ x: 0, y: 50, z: 0, yaw: 0, pitch: 0 });
      renderer.sync(state, 1, 0);
      expect([effectUpdates.mist, effectUpdates.motes]).toEqual([0, 0]);
      const fixture = skyFixture();
      table.add(fixture.blendAt(74));
      table.add(fixture.blendAt(76));
      renderer.sync(state, 1, 0);
      renderer.setFreecam(null);
      renderer.sync(state, 1, 0);
      expect([effectUpdates.mist, effectUpdates.motes]).toEqual([2, 2]);
    } finally {
      renderer.dispose();
    }
  }, timeLimit(60_000));
});

describe("the renderer's view", () => {
  it("sets the hour and the weather together through the lighting, at once", () => {
    const renderer = createRenderer({} as unknown as HTMLCanvasElement, EMPTY_LEVEL, null, { tier: "low", skyTable: skyFixture() });
    try {
      renderer.setView(15, WEATHER_PRESETS.rain);
      const sun = renderer.scene.getLightByName("sun") as unknown as { direction: { x: number; y: number; z: number } };
      // The way 15:00's light travels, away from the sun.
      expect(sun.direction.x).toBeCloseTo(0.6859943405700353, 12);
      expect(sun.direction.y).toBeCloseTo(-0.6859943405700354, 12);
      expect(sun.direction.z).toBeCloseTo(0.24253562503633297, 12);
      // Rain's density at the forest's 4 km.
      expect(renderer.scene.fogDensity).toBeCloseTo(0.004932832390416513, 15);
    } finally {
      renderer.dispose();
    }
  });
});

describe("the low tier's exposure", () => {
  it("keeps the stare's dimming through a weather fade, frame after frame, as outside one", () => {
    const renderer = createRenderer({} as unknown as HTMLCanvasElement, EMPTY_LEVEL, null, { tier: "low", skyTable: skyFixture() });
    try {
      const image = renderer.scene.imageProcessingConfiguration;
      // Half a second a frame: a 3 s fade is a sixth further on at each.
      vi.spyOn(renderer.engine, "getDeltaTime").mockReturnValue(500);
      // A half stare leaves a quarter of the light: (1 - 0.5) squared.
      const state = windTestState({ ...windTestPlayer(1), stare: 0.5 });
      const frame = () => {
        renderer.sync(state, 1, 0);
        renderer.scene.render();
      };
      renderer.setView(12, WEATHER_PRESETS.clear);
      frame();
      // Clear noon's exposure, 0.91045012, times the quarter.
      expect(image.exposure).toBeCloseTo(0.22761253123728348, 12);
      // The fade toward eerie moves inside each render, after the frame's
      // sync: the exposure each frame draws with is the weather's then, still
      // times the quarter.
      renderer.setWeather(WEATHER_PRESETS.eerie, 3);
      frame();
      expect(image.exposure).toBeCloseTo(0.21822351432374554, 12);
      frame();
      expect(image.exposure).toBeCloseTo(0.209024174519572, 12);
      for (let i = 0; i < 4; i++) frame();
      // Eerie's noon exposure, 0.69649435, times the quarter: the fade has
      // ended with the stare's dimming as it began.
      expect(image.exposure).toBeCloseTo(0.17412358639652187, 12);
      frame();
      expect(image.exposure).toBeCloseTo(0.17412358639652187, 12);
    } finally {
      renderer.dispose();
    }
  }, timeLimit(60_000));
});

describe("the renderer's engine", () => {
  // `Engine` here is this file's module mock (NullEngine standing in for the
  // WebGL2 engine), so an instance of it is what the WebGL2 path constructs.
  it("makes the WebGL2 Engine itself when it is given none", () => {
    const before = EngineStore.Instances.length;
    const renderer = createRenderer({} as unknown as HTMLCanvasElement, EMPTY_LEVEL, null, { tier: "low" });
    try {
      expect(renderer.engine).toBeInstanceOf(Engine);
      expect(renderer.scene.getEngine()).toBe(renderer.engine);
      expect(EngineStore.Instances.length - before).toBe(1);
    } finally {
      renderer.dispose();
    }
  });

  it("hands out the forest's bake records, empty where there is no forest", () => {
    const renderer = createRenderer({} as unknown as HTMLCanvasElement, EMPTY_LEVEL, null, { tier: "low" });
    try {
      expect(renderer.impostorBakes()).toEqual([]);
    } finally {
      renderer.dispose();
    }
    const src = readFileSync(fileURLToPath(new URL("../../src/game/renderer.ts", import.meta.url)), "utf8");
    expect(src).toContain("return forestMeshes?.impostorBakes() ?? [];");
  });

  it("draws on an engine it is given, makes none of its own, and disposes it with itself", () => {
    const given = new NullEngine();
    const before = EngineStore.Instances.length;
    const renderer = createRenderer({} as unknown as HTMLCanvasElement, EMPTY_LEVEL, null, { tier: "low", engine: given });
    try {
      expect(renderer.engine).toBe(given);
      expect(renderer.scene.getEngine()).toBe(given);
      expect(EngineStore.Instances.length - before).toBe(0);
    } finally {
      renderer.dispose();
    }
    expect(given.isDisposed).toBe(true);
  });

  // The grass cull builds its planes from the aspect, so it has to be the
  // aspect of the engine actually drawing (WebGPU's, when one is handed in),
  // read every frame, never a canvas the renderer was passed. NullEngine's
  // render size is its options, so this proves the hook reads the given
  // engine's render size live; it cannot prove how WebGPUEngine or Engine size
  // their own drawing buffers against a real canvas.
  it("culls the grass to the given engine's aspect, read every frame, not the canvas's", () => {
    const LEVEL: Level = { id: "cull-aspect-test", brushes: [], playerSpawns: [], enemySpawns: [] };
    const given = new NullEngine({ renderWidth: 1600, renderHeight: 900, textureSize: 512, deterministicLockstep: false, lockstepMaxSteps: 1 });
    // A square canvas: its aspect is 1, and the mocked WebGL2 Engine would read it.
    const canvas = { width: 640, height: 640, renderWidth: 640, renderHeight: 640 } as unknown as HTMLCanvasElement;
    bladeCullPoses.length = 0;
    const renderer = createRenderer(canvas, LEVEL, createForest(388817), { tier: "high", engine: given });
    try {
      renderer.scene.render();
      expect(bladeCullPoses.map((p) => p.aspect)).toEqual([1.7777777777777777]);
      // The engine's drawing size changes (a resize); the next frame reads it.
      (given as unknown as { _options: { renderWidth: number } })._options.renderWidth = 1200;
      renderer.scene.render();
      expect(bladeCullPoses.map((p) => p.aspect)).toEqual([1.7777777777777777, 1.3333333333333333]);
    } finally {
      renderer.dispose();
    }
  }, timeLimit(60_000));
});

describe("world shell wiring", () => {
  // `createRenderer` needs a real canvas and a WebGL context; the wind test
  // above works around that with a `NullEngine` substitution (see the
  // top-of-file mock), but that fixture uses `forest: null` and so never
  // touches the forest, clutter or mist shells. Every case below still tests
  // an exported piece of the renderer instead of the whole thing. The forest,
  // clutter and mist shells therefore have no smoke test here at all, and
  // the failure they share is invisible to the unit suites:
  // a shell that is constructed and never updated, or updated on only one of
  // the two camera branches, renders a world frozen at frame zero. This reads
  // the source for that wiring — the architecture.test.ts precedent — because
  // it is the only place the wiring exists.
  const src = readFileSync(fileURLToPath(new URL("../../src/game/renderer.ts", import.meta.url)), "utf8");

  /** The source between two anchors, both of which must exist. */
  function slice(from: string, to: string): string {
    const a = src.indexOf(from);
    const b = src.indexOf(to, a + 1);
    expect(a, `anchor not found: ${from}`).toBeGreaterThanOrEqual(0);
    expect(b, `anchor not found: ${to}`).toBeGreaterThan(a);
    return src.slice(a, b);
  }

  it("creates wildlife under the forest guard, at the low tier's radius, with both shadow hooks", () => {
    const creation = slice("const wildlife =", "const wildlifePlayerPool");
    // Hand-authored levels have no forest and must get no animals; a renderer
    // asked for none (a scene recorded a frame at a time) gets none either.
    expect(creation).toMatch(/forest !== null && options\.wildlife !== false\s*\?\s*createWildlifeMeshes\(/);
    expect(creation).toContain('radiusScale: tier === "low" ? 0.6 : undefined');
    // Both halves of the shadow registry: an add with no remove leaks every
    // released animal into the shadow map (lighting.ts's own note).
    expect(creation).toContain("lighting.addShadowMesh");
    expect(creation).toContain("lighting.removeShadowMesh");
    // The same guard, published: `app.ts` builds no audio shell without it, so a
    // constant `true` here would fetch six clips for a world with no animals.
    expect(src).toContain("hasWildlife: wildlife !== null,");
  });

  it("updates wildlife in the freecam branch AND the player branch, with the same arguments", () => {
    // Counting `wildlife?.update(` over the whole file would pass with both
    // calls sitting in the freecam branch — the exact failure this guards.
    const freecamBranch = slice("if (freecam !== null) {", "const local = state.players.get(localId);");
    const playerBranch = slice("const local = state.players.get(localId);", "resize() {");
    expect(freecamBranch.match(/wildlife\?\.update\(/g)).toHaveLength(1);
    expect(playerBranch.match(/wildlife\?\.update\(/g)).toHaveLength(1);
    // Both branches pass a seventh, director argument — the sibling of this
    // exact trap in `wildlifeMeshes.ts`'s own `update`: without it the
    // director never runs at all, on that branch, for the life of the shell.
    expect(freecamBranch).toContain(
      "wildlife?.update(freecam.x, freecam.z, state.tick, playersOf(state), weather, lighting.hour, wildlifeDirectorArg);",
    );
    expect(playerBranch).toContain(
      "wildlife?.update(local.pos.x, local.pos.z, state.tick, playersOf(state), weather, lighting.hour, wildlifeDirectorArg);",
    );
    // Each branch builds that argument's `view` from its own camera-to-be —
    // the freecam's own fields, or the sim's local pos/yaw/pitch rather than
    // `camera`'s still-stale-this-frame transform — and both look up the
    // nearest Hollow before calling.
    expect(freecamBranch).toContain("wildlifeView.x = freecam.x;");
    expect(playerBranch).toContain("wildlifeView.x = local.pos.x;");
    expect(freecamBranch).toContain("findHollow(state, freecam.x, freecam.z);");
    expect(playerBranch).toContain("findHollow(state, local.pos.x, local.pos.z);");
    expect(src.match(/wildlife\?\.dispose\(\)/g)).toHaveLength(1);
  });

  it("drains the wildlife events by copying them out and emptying the shell's list", () => {
    // The contract `app.ts` relies on: one call per frame yields each
    // event exactly once. Handing back the live array without emptying it would
    // replay every call forever, which is inaudible in a unit test and deafening
    // in the game.
    const drain = slice("wildlifeEvents() {", "listener() {");
    expect(drain).toContain("source.length = 0;");
    expect(drain).toContain("wildlifeEventDrain[n++] = e;");
    // The reused array is truncated to this frame's count, not left holding the
    // previous frame's tail.
    expect(drain).toContain("wildlifeEventDrain.length = n;");
  });

  it("draws on an engine it is given, and makes WebGL2's own otherwise", () => {
    expect(src).toContain(
      "const engine = options.engine ?? new Engine(canvas, true, { stencil: true, loseContextOnDispose: true }, true);",
    );
    expect(src).toMatch(/engine: AbstractEngine;/);
    expect(src).not.toContain("function detectTier(");
  });

  it("creates the duff field beside the blade field, both guarded to the same tiers", () => {
    const creation = slice("const bladeMeshes =", "// Same late-registration story");
    // Hand-authored levels have no forest, and low tier cannot afford either
    // field — both guards must agree, or one draws where the other does not.
    expect(creation).toMatch(/forest !== null && tier !== "low" \? createBladeMeshes\(/);
    expect(creation).toMatch(/forest !== null && tier !== "low" \? createDuffMeshes\(/);
    expect(creation).toContain("createBladeMeshes(scene, forest.seed, { quality: tier, jobs })");
    expect(creation).toContain("createDuffMeshes(scene, forest.seed, { quality: tier, jobs })");
  });

  it("hands the terrain and the ground cover one scheduler, and runs its share once a frame in both branches", () => {
    // The rebuilds a crossing starts are jobs (`syncJobs.ts`): a shell built
    // without the scheduler rebuilds whole in the crossing's frame, and a
    // branch that never runs it leaves every job to wait out its lateness
    // bound and run at once.
    expect(src).toContain("const jobs = createSyncJobs(() => performance.now());");
    expect(src).toContain("createClipmap(scene, forest.seed, jobs, { deferred: options.deferClipmap })");
    expect(slice("const clutterMeshes =", "const bladeMeshes =")).toContain("jobs,");
    const freecamBranch = slice("if (freecam !== null) {", "const local = state.players.get(localId);");
    const playerBranch = slice("const local = state.players.get(localId);", "hasWildlife:");
    expect(freecamBranch.match(/jobs\.run\(\)/g)).toHaveLength(1);
    expect(playerBranch.match(/jobs\.run\(\)/g)).toHaveLength(1);
    // After every shell's update in each branch.
    expect(freecamBranch.indexOf("jobs.run()")).toBeGreaterThan(freecamBranch.indexOf("duffMeshes?.update("));
    expect(playerBranch.indexOf("jobs.run()")).toBeGreaterThan(playerBranch.indexOf("duffMeshes?.update("));
  });

  it("updates duff in the freecam branch AND the player branch, with the blades' own eye position", () => {
    // This file's head comment names the forest, clutter and mist shells as
    // having no smoke test here at all — the blade and duff shells share
    // that same gap (neither was named because neither existed when the
    // comment was written), so this is the first thing to catch a duff
    // update wired into only one of the two camera branches, or missing from
    // the dispose list — exactly the failure a shell "constructed and never
    // updated" produces.
    const freecamBranch = slice("if (freecam !== null) {", "const local = state.players.get(localId);");
    const playerBranch = slice("const local = state.players.get(localId);", "resize() {");
    expect(freecamBranch.match(/duffMeshes\?\.update\(/g)).toHaveLength(1);
    expect(playerBranch.match(/duffMeshes\?\.update\(/g)).toHaveLength(1);
    expect(freecamBranch).toContain("bladeMeshes?.update(freecam.x, freecam.z);\n        duffMeshes?.update(freecam.x, freecam.z);");
    expect(playerBranch).toContain("bladeMeshes?.update(local.pos.x, local.pos.z);\n        duffMeshes?.update(local.pos.x, local.pos.z);");
    expect(src.match(/duffMeshes\?\.dispose\(\)/g)).toHaveLength(1);
  });

  it("culls the blades and the grass class to the render camera's view once its pose is final, off the low tier", () => {
    const creation = slice("const clutterMeshes =", "const bladeMeshes =");
    expect(creation).toContain('cull: tier !== "low",');
    const hook = slice("const cullPose: CullPose =", "// Same late-registration story");
    // Before Babylon picks the active meshes, after the camera's transform
    // (the view bob, the freecam) is final for the frame.
    expect(hook).toContain("scene.onBeforeActiveMeshesEvaluationObservable.add(() => {");
    // The render camera's own pose, never a field's centre.
    expect(hook).toContain("const p = camera.globalPosition;");
    expect(hook).toContain("cullPose.yaw = camera.rotation.y;");
    expect(hook).toContain("cullPose.pitch = camera.rotation.x;");
    // The view bob's roll too, which the planes turn with.
    expect(hook).toContain("cullPose.roll = camera.rotation.z;");
    expect(hook).toContain("cullPose.fov = camera.fov;");
    expect(hook).toContain("cullPose.aspect = engine.getAspectRatio(camera);");
    expect(hook).toContain("bladeMeshes?.cull(cullPose);");
    expect(hook).toContain("clutterMeshes?.cull(cullPose);");
    // Once per frame, from the hook alone.
    expect(src.match(/\.cull\(/g)).toHaveLength(2);
  });

  it("creates the cliff field on every tier with the world seed", () => {
    const creation = slice("const duffMeshes =", "// Same late-registration story");
    // Every tier: the field has a ring set per tier (`CLIFF_RINGS`), and the
    // faces need their modules on the low tier as much as the high.
    expect(creation).toContain('const cliffMeshes = forest !== null ? createCliffMeshes(scene, forest.seed, { quality: tier }) : null;');
  });

  it("registers cliff casters late, updates cliffs in both camera branches after the forest, and disposes them", () => {
    const casters = slice("// Late caster registration", "applyWetness(scene, weather);");
    expect(casters).toContain("for (; cliffCastersRegistered < cliffMeshes.casterMeshes.length; cliffCastersRegistered++) {");
    // A near bucket is a shadow caster and hard cover for the rain, registered once as it lands.
    expect(casters).toContain("const bucket = cliffMeshes.casterMeshes[cliffCastersRegistered] as Mesh;");
    expect(casters).toContain("lighting.addShadowMesh(bucket);\n          rainMap?.register(bucket, \"hard\");");
    const freecamBranch = slice("if (freecam !== null) {", "const local = state.players.get(localId);");
    const playerBranch = slice("const local = state.players.get(localId);", "resize() {");
    expect(freecamBranch.match(/cliffMeshes\?\.update\(/g)).toHaveLength(1);
    expect(playerBranch.match(/cliffMeshes\?\.update\(/g)).toHaveLength(1);
    expect(freecamBranch).toContain("forestMeshes?.update(freecam.x, freecam.z);\n        cliffMeshes?.update(freecam.x, freecam.z);");
    expect(playerBranch).toContain("forestMeshes?.update(local.pos.x, local.pos.z);\n        cliffMeshes?.update(local.pos.x, local.pos.z);");
    expect(src.match(/cliffMeshes\?\.dispose\(\)/g)).toHaveLength(1);
  });

  it("lists the two inner clipmap rings in the rain map, makes the splashes after the rain over the same map, updates them in both camera branches and disposes them", () => {
    // Ring 0 alone covers the map's 96 m square; the outer rings would be clipped whole and still cost their draws.
    expect(src).toContain('for (const mesh of clipmap?.meshes.slice(0, 2) ?? []) rainMap.register(mesh, "terrain");');
    expect(src).toContain("  const rain = createRain(scene, tier);\n  partOf(rain);\n  rain.setMap(rainMap);");
    expect(src).toContain("  const rainSplash = createRainSplash(scene, tier);\n  partOf(rainSplash);\n  rainSplash?.setMap(rainMap);");
    expect(src).toContain("setEffectsGroup(effectsGroupFor(water), { rain, splash: rainSplash, motes, mist, waterLife });");
    const freecamBranch = slice("if (freecam !== null) {", "const local = state.players.get(localId);");
    const playerBranch = slice("const local = state.players.get(localId);", "resize() {");
    // After the rain's update, which fills the lamp the splashes read.
    const after = "lampForRain(localLamp, rainLamp));\n        rainSplash?.update(camera.position, weather, rainLamp, lighting.sunDirection, seconds);";
    expect(freecamBranch.match(/rainSplash\?\.update\(/g)).toHaveLength(1);
    expect(playerBranch.match(/rainSplash\?\.update\(/g)).toHaveLength(1);
    expect(freecamBranch).toContain(after);
    expect(playerBranch).toContain(after);
    expect(src.match(/rainSplash\?\.dispose\(\)/g)).toHaveLength(1);
    // The one canopy-water value, read by the drip sound through the renderer.
    expect(src).toContain("    canopyWater() {\n      return rain.canopyWater;\n    },");
    // And the one canopy over the camera, read for the lens and heard by the drips.
    expect(src).toContain("    canopyOver() {\n      return lensCanopy;\n    },");
  });

  it("makes the lake's life at the first lake under the animals' guard, steps it after the motes in both branches, and disposes it", () => {
    const creation = slice("const firstLake = lakes[0];", "partOf(waterLife);");
    // A world without a lake, a hand-authored level and a scene recorded a
    // frame at a time get none.
    expect(creation).toMatch(/forest !== null && firstLake !== undefined && options\.wildlife !== false\s*\?\s*createWaterLife\(scene, forest\.seed, firstLake, tier\)/);
    // Its insects draw among the see-through effects, in the water's group on high.
    expect(src).toContain("setEffectsGroup(effectsGroupFor(water), { rain, splash: rainSplash, motes, mist, waterLife });");
    const freecamBranch = slice("if (freecam !== null) {", "const local = state.players.get(localId);");
    const playerBranch = slice("const local = state.players.get(localId);", "resize() {");
    // After the motes, once the camera's place and lens are final for the frame.
    const after = "if (sky !== null) motes?.update(camera.position, weather, lighting.hour, atmosphere.nearColour(), wind);\n        updateWaterLife(state, frame.dt, oceanSeconds, weather, sky);";
    expect(freecamBranch).toContain(after);
    expect(playerBranch).toContain(after);
    expect(freecamBranch.match(/updateWaterLife\(/g)).toHaveLength(1);
    expect(playerBranch.match(/updateWaterLife\(/g)).toHaveLength(1);
    // The frame: each player in the slot they keep, the sky behind a swarm, a
    // pixel's size at a metre and the Hollow the branch looked up.
    const fill = slice("function updateWaterLife(", "waterLife.update(f);");
    expect(fill).toContain("f.camX = camera.position.x;");
    expect(fill).toContain("f.players = playerSlots.fill(state.players);");
    expect(fill).toContain("f.skyLuma = skyLumaOf(sky);");
    expect(fill).toContain("f.pixelAt1m = pixelAtOneMetre(camera.fov, engine.getRenderHeight());");
    expect(fill).toContain("f.hollowDistance = wildlifeMatch.hollowDistance;");
    expect(src).toContain("const playerSlots = createPlayerSlots(MAX_PLAYERS);");
    // Published: `app.ts` builds no audio for a world without it.
    expect(src).toContain("hasWaterLife: waterLife !== null,");
    expect(src).toContain("return waterLife?.sound() ?? SILENT_WATER_LIFE;");
    expect(src.match(/waterLife\?\.dispose\(\)/g)).toHaveLength(1);
  });

  it("hands the forest its sky, so no billboard bakes before the sky is held", () => {
    const forestOptions = slice("createForestMeshes(scene, forest.seed, {", "      })");
    expect(forestOptions).toContain("sky: skyReady(),");
    expect(src).toContain("skyWait ??= whenSkyHeld(skyTable, () => lighting.hour, { signal: disposal.signal }).then(() => {");
  });

  it("rings the water with the weather's rain each frame, beside the puddles", () => {
    const feed = slice("applyWetness(scene, weather);", "if (sky !== null) atmosphere.update(weather, sky);");
    expect(feed).toContain(
      "setTerrainRain(scene, terrainMaterialFor(scene, \"terrain\"), weather.rain, seconds);\n      water?.setRain(weather.rain);",
    );
    expect(src.match(/water\?\.setRain\(/g)).toHaveLength(1);
  });

  it("runs the sea's waves and the wind on the shared seconds, and keeps the page's clock for everything else", () => {
    expect(src).toContain('import { sharedSeconds } from "./oceanWindSea.js";');
    expect(src).toContain("update(camX: number, camZ: number, seconds: number, hour?: number): void;");
    const syncBlock = slice("sync(state, localId, alpha, frame = { dt: 0, sprinting: false }) {", "hasWildlife: wildlife !== null,");
    expect(syncBlock).toContain("const seconds = clock() / 1000;");
    expect(syncBlock).toContain(
      "const oceanSeconds = options.clock !== undefined ? seconds : sharedSeconds(state.tick, alpha);",
    );
    expect(syncBlock).toContain("wind = windRecordUnder(weather, oceanSeconds, windOverride ?? undefined);");
    const freecamBranch = slice("if (freecam !== null) {", "const local = state.players.get(localId);");
    const playerBranch = slice("const local = state.players.get(localId);", "resize() {");
    expect(freecamBranch.match(/water\?\.update\(/g)).toHaveLength(1);
    expect(playerBranch.match(/water\?\.update\(/g)).toHaveLength(1);
    expect(freecamBranch).toContain("water?.update(freecam.x, freecam.z, oceanSeconds, lighting.hour);");
    expect(playerBranch).toContain("water?.update(local.pos.x, local.pos.z, oceanSeconds, lighting.hour);");
    // The declaration, the wind, the two water updates and the lake's life's
    // two: nothing else in the frame moves clock.
    expect(syncBlock.match(/oceanSeconds/g)).toHaveLength(6);
    expect(syncBlock).toContain("const lampState = lampUnder(weather, seconds);");
    expect(syncBlock).toContain('setTerrainRain(scene, terrainMaterialFor(scene, "terrain"), weather.rain, seconds);');
    expect(syncBlock.match(/mist\?\.update\([^;]*, wind, seconds\);/g)).toHaveLength(2);
    expect(syncBlock.match(/rainSplash\?\.update\([^;]*, seconds\);/g)).toHaveLength(2);
  });
});

describe("the lake's life's frame", () => {
  it("reads the sky behind a swarm from the dome's horizon away from the sun, held at 1, and 0 before the sky", () => {
    const table = skyFixture();
    const clear = WEATHER_PRESETS.clear;
    expect(skyLumaOf(null)).toBe(0);
    expect(skyLumaOf(skyStateFor(table, 0, clear))).toBeCloseTo(0.03004000324483503, 12);
    expect(skyLumaOf(skyStateFor(table, 6, clear))).toBeCloseTo(0.5250530506882067, 12);
    expect(skyLumaOf(skyStateFor(table, 12, clear))).toBeCloseTo(0.7137754737861965, 12);
    // 1.22 a clear late afternoon, held at 1.
    expect(skyLumaOf(skyStateFor(table, 17, clear))).toBe(1);
    expect(skyLumaOf(skyStateFor(table, 18.25, clear))).toBeCloseTo(0.25418511448490166, 12);
    expect(skyLumaOf(skyStateFor(table, 12, WEATHER_PRESETS.mist))).toBeCloseTo(0.3241337701287073, 12);
  });

  it("gives a pixel's size a metre from the lens from the field of view and the render's height", () => {
    // 2·tan(0.7) over 900 rows.
    expect(pixelAtOneMetre(GAME_FOV, 900)).toBeCloseTo(0.0018717519565846208, 15);
    // A render with no height yet counts one row.
    expect(pixelAtOneMetre(GAME_FOV, 0)).toBeCloseTo(1.6845767609261588, 12);
  });
});

describe("the players' slots the lake's life keys by", () => {
  /** A player whose id is in its position: (id, id + 0.9, −id). */
  const at = (id: number) => ({ id, pos: { x: id, y: id + 0.9, z: -id } });
  const playersOf = (...ids: number[]) => new Map(ids.map((id) => [id, at(id)]));
  /** Each slot's player, by the id its position carries, or null. */
  const seated = (out: readonly ({ x: number } | undefined)[]) => out.map((p) => p?.x ?? null);

  it("keeps each player in their own slot while another leaves, with the sim's own height, in one array refilled", () => {
    const slots = createPlayerSlots(5);
    const players = playersOf(1, 2, 3);
    const out = slots.fill(players);
    expect(seated(out)).toEqual([1, 2, 3, null, null]);
    expect(out[1]).toEqual({ x: 2, y: 2.9, z: -2 });
    // The middle player leaves: the third keeps the third slot, which a
    // compacted list would have handed the second's swarm.
    players.delete(2);
    expect(slots.fill(players)).toBe(out);
    expect(seated(out)).toEqual([1, null, 3, null, null]);
    // A player moves: their slot's point follows.
    players.get(3)!.pos.x = 30;
    slots.fill(players);
    expect(out[2]).toEqual({ x: 30, y: 3.9, z: -3 });
  });

  it("seats a newcomer in the lowest slot already free, never one freed the same frame, and none past the last", () => {
    const slots = createPlayerSlots(5);
    const players = playersOf(1, 2, 3, 4);
    const out = slots.fill(players);
    players.delete(2);
    slots.fill(players);
    expect(seated(out)).toEqual([1, null, 3, 4, null]);
    // The fourth leaves as two join: they take the second and the fifth
    // slots, free since the last frame, and the fourth's stays empty a frame,
    // so no swarm or speed passes from one player to the next.
    players.delete(4);
    players.set(7, at(7));
    players.set(8, at(8));
    slots.fill(players);
    expect(seated(out)).toEqual([1, 7, 3, null, 8]);
    players.set(9, at(9));
    slots.fill(players);
    expect(seated(out)).toEqual([1, 7, 3, 9, 8]);
    // A sixth has no slot.
    players.set(10, at(10));
    slots.fill(players);
    expect(seated(out)).toEqual([1, 7, 3, 9, 8]);
  });
});

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

  it("draws its midges and its dragonflies last among the see-through effects and never casts a shadow with them", () => {
    shadowCasters.clear();
    const renderer = createRenderer(FAKE_CANVAS, LEVEL, createForest(SEED), { tier: "high", skyTable: skyFixture() });
    try {
      const life = renderer.scene.meshes.filter((m) => m.name === MIDGE_NAME || m.name.startsWith("dragonfly_"));
      expect(life.map((m) => m.name)).toEqual([MIDGE_NAME, "dragonfly_darner", "dragonfly_skimmer", "dragonfly_damselfly"]);
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
      // Three players standing 2 m out from the rim at dusk.
      const players = [0, 0.6, 1.2].map((angle, i) => {
        const x = lake.x + Math.cos(angle) * (lake.radius + 2);
        const z = lake.z + Math.sin(angle) * (lake.radius + 2);
        const p = windTestPlayer(i + 1);
        p.pos = { x, y: elevationAt(SEED, x, z) + 0.9, z };
        return p;
      });
      const state = windTestState(...players);
      renderer.setView(18.5, WEATHER_PRESETS.clear);
      const first = players[0]!.pos;
      renderer.setFreecam({ x: first.x, y: first.y + 0.7, z: first.z, yaw: 0, pitch: 0 });
      // Eleven seconds standing still: a swarm over each head.
      const frame = (): void => {
        state.tick += 15;
        renderer.sync(state, 1, 0, { dt: 0.25, sprinting: false });
      };
      for (let i = 0; i < 44; i++) frame();
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
      // The second player leaves: theirs goes, and the third's stays over
      // the third player, frame after frame.
      state.players.delete(2);
      for (let i = 0; i < 8; i++) frame();
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

describe("the wildlife director goes quiet near the Hollow", () => {
  // A real forest and a real renderer — the wind test's `forest: null` shortcut
  // skips exactly the branch this checks, so there is no way to stay on the
  // source-slicing side of this file for it.
  const SEED = 388817;
  // A point with no ground-species unit anywhere in any species' disc —
  // `wildlifeMeshes.test.ts`'s own quiet point, at the same seed. The
  // "stays empty" claim below needs this specifically: `observe`
  // (wildlifeDirector.ts) credits a sighting off whatever the camera can
  // already see, entirely independent of the Hollow gate, which only ever
  // stops the director ARRANGING something new — so at a real, populated
  // position a natural animal already in frame gets logged on its own
  // schedule regardless of any Hollow, and the test would be checking
  // nothing. Here, nothing is ever already in frame, so any log entry can
  // only be the director's own doing.
  const QUIET_X = -10000, QUIET_Z = -8000;
  // A real, populated point (`wildlifeMeshes.test.ts` uses the same one)
  // for the positive control, which does not care which of the two sources
  // — an already-visible natural animal or the director's own cue — is
  // what puts the first entry in the log.
  const BUSY_X = 2000, BUSY_Z = -500;
  const LEVEL: Level = { id: "wildlife-hollow-test", brushes: [], playerSpawns: [], enemySpawns: [] };
  // A bare `{}` canvas (the wind test's shortcut above) leaves
  // `engine.getRenderWidth`/`getRenderHeight` undefined, so
  // `engine.getAspectRatio(camera)` — and so `wildlifeView.aspect` — comes
  // out NaN. `inCone`'s horizontal bound is `boundY * aspect`, and every
  // comparison against a NaN bound is false, so nothing is ever on screen
  // however long the scene runs: not a bug either test below is checking
  // for, so both need a canvas shaped enough to give the camera a real one.
  const FAKE_CANVAS = { renderWidth: 1600, renderHeight: 900 } as unknown as HTMLCanvasElement;

  // `pos.y` is the sim's own absolute world height, not a height above the
  // ground — a literal small constant buries the player and its camera
  // however far under this point's real terrain, with every real animal's
  // ground-level position far outside the vertical frustum no matter how
  // long the scene runs.
  function standingPlayerAt(id: number, x: number, z: number): PlayerState {
    return {
      id, pos: { x, y: elevationAt(SEED, x, z), z }, vel: { x: 0, y: 0, z: 0 }, yaw: 0, pitch: 0,
      health: 100, grounded: true, lastProcessedInput: 0, deathPos: null,
      lamp: { on: false, charge: 1 }, stare: 0, safe: false,
    };
  }

  function huntingHollowNear(id: number, x: number, z: number): EnemyState {
    return {
      // 20 m from the player: within HOLLOW_QUIET (60 m) and well under 50 m.
      // `y` plays no part — `findHollow` (renderer.ts) measures on X/Z alone.
      id, pos: { x: x + 20, y: 0, z }, vel: { x: 0, y: 0, z: 0 }, yaw: 0, health: 100,
      ai: AiState.Hunt, targetId: 1, stateTimer: 0, attackCooldown: 0, lastDistSq: Infinity,
      stuckTimer: 0, unstickTimer: 0, route: [], routeAt: 0, approach: false, seen: false, emergeTo: null,
    };
  }

  it("logs nothing while a hunting Hollow stands within 50 m, however many frames pass", () => {
    const renderer = createRenderer(FAKE_CANVAS, LEVEL, createForest(SEED));
    renderer.setWeather(WEATHER_PRESETS.clear, 0);
    try {
      const player = standingPlayerAt(1, QUIET_X, QUIET_Z);
      const hollow = huntingHollowNear(2, QUIET_X, QUIET_Z);
      const state: WorldState = {
        tick: 0,
        players: new Map([[player.id, player]]),
        enemies: new Map([[hollow.id, hollow]]),
        outcome: Outcome.Playing,
        phase: Phase.Climb,
        nextEntityId: 10,
        rngSeed: 1,
      };
      // `relaxFor` (wildlifeDirector.ts) reads `hollowDistance < HOLLOW_QUIET`
      // OR `hollowHunting` as an unconditional "arrange nothing", and this
      // scene satisfies both at once (20 m, hunting) — so it does NOT tell
      // the two fields apart: a wiring defect that dropped just one of them
      // (say, `findHollow` always writing `hollowHunting = false`) would
      // leave this test passing regardless, since the other field alone
      // already forces quiet. What actually catches a whole call site's
      // wiring going missing is the source-slicing "world shell wiring" test
      // above (which requires the literal view/hollow-lookup lines in both
      // branches) and the positive control below (which would start logging
      // sightings if the whole director argument vanished). 1800 frames
      // (30 s) is comfortably past the ~12-14 s this exact point otherwise
      // takes to place its first animal (`wildlifeMeshes.test.ts`'s own
      // "places a unit" test, off the same shell, at the same point).
      for (let tick = 0; tick < 1800; tick++) {
        state.tick = tick;
        renderer.sync(state, 1, 0);
      }
      expect(renderer.wildlifeDirectorLog()).toHaveLength(0);
    } finally {
      renderer.dispose();
    }
  }, timeLimit(60000));

  it("logs a sighting within a reasonable window with no Hollow around", () => {
    // The positive control the test above needs and did not have: without
    // this, deleting the player branch's director argument entirely — no
    // `wildlifeDirectorArg`, no wiring at all — would ALSO log nothing near
    // the Hollow, and pass just the same. A still player at a real,
    // populated position relaxes the cadence by `STILL_RELAX`
    // (`wildlifeMeshes.test.ts`'s own "relaxed floor" test measures the same
    // shape of wait, off the same shell, at the same point), so 1800 frames
    // (30 s) is comfortably past even the relaxed floor and proves the
    // director is actually running when the scene gives it nothing to go
    // quiet for.
    const renderer = createRenderer(FAKE_CANVAS, LEVEL, createForest(SEED));
    renderer.setWeather(WEATHER_PRESETS.clear, 0);
    try {
      const player = standingPlayerAt(1, BUSY_X, BUSY_Z);
      const state: WorldState = {
        tick: 0,
        players: new Map([[player.id, player]]),
        enemies: new Map(),
        outcome: Outcome.Playing,
        phase: Phase.Climb,
        nextEntityId: 10,
        rngSeed: 1,
      };
      for (let tick = 0; tick < 1800 && renderer.wildlifeDirectorLog().length === 0; tick++) {
        state.tick = tick;
        renderer.sync(state, 1, 0);
      }
      expect(renderer.wildlifeDirectorLog().length).toBeGreaterThan(0);
    } finally {
      renderer.dispose();
    }
  }, timeLimit(60000));
});

describe("the sward floor follows the blade field's tiers", () => {
  // A real forest and a real renderer per tier, then one bind of the shared
  // terrain material, reading the pull's strength back from terrainSward.w.
  const LEVEL: Level = { id: "sward-tier-test", brushes: [], playerSpawns: [], enemySpawns: [] };
  const FAKE_CANVAS = { renderWidth: 1600, renderHeight: 900 } as unknown as HTMLCanvasElement;

  function boundSward(tier: "low" | "medium" | "high"): { sward: number[]; band: number[] } {
    const renderer = createRenderer(FAKE_CANVAS, LEVEL, createForest(388817), { tier });
    try {
      const scene = EngineStore.LastCreatedScene!;
      const plugin = scene.getMaterialByName("mat_terrain")!.pluginManager!.getPlugin("TerrainTexture") as TerrainTexturePlugin;
      const values: Record<string, number[]> = {};
      const ubo = {
        updateFloat: (name: string, x: number) => { values[name] = [x]; },
        updateFloat2: (name: string, x: number, y: number) => { values[name] = [x, y]; },
        updateFloat3: (name: string, x: number, y: number, z: number) => { values[name] = [x, y, z]; },
        updateFloat4: (name: string, x: number, y: number, z: number, w: number) => { values[name] = [x, y, z, w]; },
        setTexture: () => {},
      };
      plugin.bindForSubMesh(ubo as never, scene, undefined as never, undefined as never);
      return { sward: values.terrainSward!, band: values.terrainSwardBand! };
    } finally {
      renderer.dispose();
    }
  }

  it("binds no pull on the low tier, which draws no blades, and the full pull on the others", () => {
    expect(boundSward("low")).toEqual({ sward: [0.05, 0.065, 0.03, 0], band: [0.05, 0.5, 12, 18] });
    expect(boundSward("medium")).toEqual({ sward: [0.05, 0.065, 0.03, 0.6], band: [0.05, 0.5, 12, 18] });
    expect(boundSward("high")).toEqual({ sward: [0.05, 0.065, 0.03, 0.6], band: [0.05, 0.5, 12, 18] });
  }, timeLimit(60_000));
});

describe("writeListenerPose", () => {
  // The audio listener's pose, in Babylon's left-handed world:
  // `wildlifeAudio.ts` is what mirrors it into Web Audio's. A sign error here
  // swaps front for back or left for right, which no other test in the suite
  // can see.
  const pose = () => ({ x: 0, y: 0, z: 0, fx: 0, fy: 0, fz: 0, ux: 0, uy: 0, uz: 0 });
  // `+ 0` normalises a negative zero: cos(pi/2) is not exactly 0, and toEqual
  // treats -0 and 0 as different values.
  const round = (n: number) => Math.round(n * 1e6) / 1e6 + 0;

  it("copies the position and faces +Z at yaw 0, level", () => {
    const out = pose();
    writeListenerPose(out, 3, 4, 5, 0, 0);
    expect([out.x, out.y, out.z]).toEqual([3, 4, 5]);
    expect([round(out.fx), round(out.fy), round(out.fz)]).toEqual([0, 0, 1]);
    expect([out.ux, out.uy, out.uz]).toEqual([0, 1, 0]);
  });

  it("turns right with yaw, matching the camera's own convention", () => {
    // viewBob.ts already encodes it: at yaw 0 the camera faces +Z, so a quarter
    // turn of yaw must face +X, not -X.
    const out = pose();
    writeListenerPose(out, 0, 0, 0, Math.PI / 2, 0);
    expect([round(out.fx), round(out.fy), round(out.fz)]).toEqual([1, 0, 0]);
  });

  it("looks DOWN at positive pitch, and keeps forward a unit vector", () => {
    const out = pose();
    writeListenerPose(out, 0, 0, 0, 0, Math.PI / 2);
    expect(round(out.fy)).toBe(-1);
    for (const [yaw, pitch] of [[0.3, 0.2], [2.1, -0.9], [-1.4, 1.1]]) {
      writeListenerPose(out, 0, 0, 0, yaw!, pitch!);
      expect(round(Math.hypot(out.fx, out.fy, out.fz))).toBe(1);
    }
  });
});

describe("a part the renderer disposes is also torn down when a build fails", () => {
  // `dispose` names every part it disposes, and `buildRenderer` registers each
  // part it makes (`partOf`, or `made` for the brushes) so a build that throws
  // part-way disposes them too. Two lists of one set: a part added to one and
  // not the other would outlive a failed build, or never be disposed at all.
  const src = readFileSync(fileURLToPath(new URL("../../src/game/renderer.ts", import.meta.url)), "utf8");

  it("names the same parts in the dispose list and in the failed build's teardown", () => {
    const start = src.indexOf("    dispose() {\n      views.dispose();");
    const end = src.indexOf("releaseEngine(engine);", start);
    expect(start, "the dispose list's anchor").toBeGreaterThanOrEqual(0);
    expect(end, "the dispose list's end").toBeGreaterThan(start);
    const disposeList = src.slice(start, end);
    const disposed = new Set(
      [...disposeList.matchAll(/(\w+)\??\.dispose\(\)/g)].map((m) => (m[1] === "m" ? "brushMeshes" : m[1]!)),
    );
    // The atmosphere is released by `releaseAtmosphere` in `createRenderer`'s
    // catch, and the scene goes with the engine in both.
    disposed.delete("atmosphere");
    const registered = new Set([...src.matchAll(/partOf\((\w+)\);/g)].map((m) => m[1]!));
    if (/made\(\(\) => \{\s*for \(const m of brushMeshes\) m\.dispose\(\);/.test(src)) registered.add("brushMeshes");
    expect([...registered].sort()).toEqual([...disposed].sort());
    expect(disposed.size).toBe(23);
  });
});
