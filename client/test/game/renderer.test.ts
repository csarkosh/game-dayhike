import { describe, it, expect, afterEach, vi } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { NullEngine } from "@babylonjs/core/Engines/nullEngine.js";
import { Scene } from "@babylonjs/core/scene.js";
import { PBRMaterial } from "@babylonjs/core/Materials/PBR/pbrMaterial.js";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial.js";
import { VertexBuffer } from "@babylonjs/core/Buffers/buffer.js";

// `terrainTexture.ts`'s plugin constructor calls the real `loadGroundArrays`
// whenever it isn't handed a factory, and `renderer.ts`'s own
// `attachTerrainTexture(scene, mat)` call site never passes one — so the real
// loader builds a `RawTexture2DArray`, which NullEngine cannot create (the
// same gap `groundMaps.test.ts` documents and works around with its own
// factory injection). Mocked here, at the module boundary, rather than by
// touching `renderer.ts`.
vi.mock("../../src/game/groundMaps.js", () => ({
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

// The terrain field lives behind the variant registry, and `activeTerrainVariant`
// throws until something has registered one. `app.ts` gets that transitively
// through `forest.ts`; a renderer-only test has to ask for it.
import "../../src/sim/passes/index.js";
import {
  applyRingGeometry,
  applyWetness,
  createClipmap,
  createClipmapMesh,
  createRenderer,
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
  }, 30000);

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
    // Hand-authored levels have no forest and must get no animals.
    expect(creation).toMatch(/forest !== null\s*\?\s*createWildlifeMeshes\(/);
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

  it("creates the duff field beside the blade field, both guarded to the same tiers", () => {
    const creation = slice("const bladeMeshes =", "// Same late-registration story");
    // Hand-authored levels have no forest, and low tier cannot afford either
    // field — both guards must agree, or one draws where the other does not.
    expect(creation).toMatch(/forest !== null && tier !== "low" \? createBladeMeshes\(/);
    expect(creation).toMatch(/forest !== null && tier !== "low" \? createDuffMeshes\(/);
    expect(creation).toContain("createBladeMeshes(scene, forest.seed, { quality: tier })");
    expect(creation).toContain("createDuffMeshes(scene, forest.seed, { quality: tier })");
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

  it("creates the cliff field on every tier with the world seed", () => {
    const creation = slice("const duffMeshes =", "// Same late-registration story");
    // Every tier: the field has a ring set per tier (`CLIFF_RINGS`), and the
    // faces need their modules on the low tier as much as the high.
    expect(creation).toContain('const cliffMeshes = forest !== null ? createCliffMeshes(scene, forest.seed, { quality: tier }) : null;');
  });

  it("registers cliff casters late, updates cliffs in both camera branches after the forest, and disposes them", () => {
    const casters = slice("// Late caster registration", "applyWetness(scene, weather);");
    expect(casters).toContain("for (; cliffCastersRegistered < cliffMeshes.casterMeshes.length; cliffCastersRegistered++) {");
    expect(casters).toContain("lighting.addShadowMesh(cliffMeshes.casterMeshes[cliffCastersRegistered] as Mesh);");
    const freecamBranch = slice("if (freecam !== null) {", "const local = state.players.get(localId);");
    const playerBranch = slice("const local = state.players.get(localId);", "resize() {");
    expect(freecamBranch.match(/cliffMeshes\?\.update\(/g)).toHaveLength(1);
    expect(playerBranch.match(/cliffMeshes\?\.update\(/g)).toHaveLength(1);
    expect(freecamBranch).toContain("forestMeshes?.update(freecam.x, freecam.z);\n        cliffMeshes?.update(freecam.x, freecam.z);");
    expect(playerBranch).toContain("forestMeshes?.update(local.pos.x, local.pos.z);\n        cliffMeshes?.update(local.pos.x, local.pos.z);");
    expect(src.match(/cliffMeshes\?\.dispose\(\)/g)).toHaveLength(1);
  });
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
      stuckTimer: 0, unstickTimer: 0, route: [], routeAt: 0, approach: false, seen: false,
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
  }, 60000);

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
  }, 60000);
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
