import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import type { Renderer } from "../../../src/game/rendererTypes.js";
import { cameraAxes, restAxes, restPlanes, viewPlanes, type CameraPose } from "../../../src/game/lite/cameraPose.js";
import {
  FILM_CAR_WARM_FRAMES, SCENERY_REACH_M, SIGN_REACH_M, boxInSight, deferredScenery, inSight, liteSceneryOf, sightBox, type LiteCar, type LiteScenery,
  type LiteTrailhead, type SceneryView,
} from "../../../src/game/lite/sceneryMeshes.js";
import {
  CAR_PART_ATTRIBUTE, CAR_TURNS_BLOCK, carTurnsFields, carTurnsPlugin, carTurnsWgsl, factorByte, farthestFirst, listPanes, partsByMaterial, placeMatrix, placed, readsTangents,
  type SceneryPart,
} from "../../../src/game/lite/sceneryModels.js";
import { carPartTurn, partMatrix, poseVertices, restTurns, writeTurnRows } from "../../../src/game/carParts.js";
import type { ModelPart } from "../../../src/game/lite/forestModels.js";

function viewFrom(eye: CameraPose, cover: SceneryView["cover"] = null): SceneryView {
  return { planes: viewPlanes(eye, cameraAxes(eye.yaw, eye.pitch, eye.roll, restAxes()), 1.4, 1.5, 0.05, 10_000, restPlanes()), eye, cover };
}

describe("what of the scenery a view holds", () => {
  const eye: CameraPose = { x: 0, y: 2, z: 0, yaw: 0, pitch: 0, roll: 0 };

  it("is what stands ahead of the eye within its reach: nothing behind it, to one side or past the reach", () => {
    const view = viewFrom(eye);
    expect(inSight(view, 0, 1, 50, 2, SIGN_REACH_M, false)).toBe(true);
    expect(inSight(view, 0, 1, -50, 2, SIGN_REACH_M, false)).toBe(false);
    expect(inSight(view, 500, 1, 50, 2, SIGN_REACH_M, false)).toBe(false);
    expect(inSight(view, 0, 1, SIGN_REACH_M + 3, 2, SIGN_REACH_M, false)).toBe(false);
    expect(inSight(view, 0, 1, SIGN_REACH_M + 1, 2, SIGN_REACH_M, false)).toBe(true);
    // The car and the board are seen from further than a post.
    expect(inSight(view, 0, 1, SIGN_REACH_M + 3, 2, SCENERY_REACH_M, false)).toBe(true);
  });

  it("holds cover behind the eye on a frame that draws the cover map over it, and nothing else there", () => {
    const view = viewFrom(eye, { x: 0, z: 0, half: 32 });
    expect(inSight(view, 0, 1, -20, 2, SIGN_REACH_M, true)).toBe(true);
    expect(inSight(view, 0, 1, -20, 2, SIGN_REACH_M, false)).toBe(false);
    expect(inSight(view, 0, 1, -40, 2, SIGN_REACH_M, true)).toBe(false);
    expect(inSight(viewFrom(eye), 0, 1, -20, 2, SIGN_REACH_M, true)).toBe(false);
  });

  it("leaves the car out of the frame a player arrives in: it stands behind them, and its own box does not reach into the view", () => {
    // The atmo world's trailhead: the eye a stride in front of the car, looking up the trail, away from it.
    const start: CameraPose = { x: -275, y: 5.9, z: -1, yaw: Math.PI / 2, pitch: 0, roll: 0 };
    const car = sightBox(-278.2, 4.32, 0, 0, { x: -0.94, y: 0, z: -2.18 }, { x: 0.94, y: 1.7, z: 2.18 });
    expect(boxInSight(viewFrom(start), car, SCENERY_REACH_M, false)).toBe(false);
    // A sphere that holds the car and the patch under it reaches past the lens and would have it drawn.
    expect(inSight(viewFrom(start), -278.2, 5.17, 0, 3.4, SCENERY_REACH_M, false)).toBe(true);
    // Turned to face it, the player sees it; and it is cover wherever it stands in the cover map's square.
    expect(boxInSight(viewFrom({ ...start, yaw: -1.3 }), car, SCENERY_REACH_M, false)).toBe(true);
    expect(boxInSight(viewFrom(start, { x: -275, z: -1, half: 32 }), car, SCENERY_REACH_M, true)).toBe(true);
    expect(boxInSight(viewFrom({ ...start, yaw: -1.3, x: -275 + SCENERY_REACH_M + 10 }), car, SCENERY_REACH_M, false)).toBe(false);
  });

  it("stands a box about the middle of its own geometry, turned with the thing it holds", () => {
    // A thing whose geometry lies ahead of its own place: turned a quarter turn, ahead is +x.
    const box = sightBox(10, 2, 20, Math.PI / 2, { x: -1, y: 0, z: 2 }, { x: 1, y: 4, z: 6 });
    expect([box.x, box.y, box.z].map((v) => Math.round(v * 1e6) / 1e6)).toEqual([14, 4, 20]);
    expect([box.hx, box.hy, box.hz]).toEqual([1, 2, 2]);
    const eye: CameraPose = { x: 0, y: 4, z: 20, yaw: Math.PI / 2, pitch: 0, roll: 0 };
    expect(boxInSight(viewFrom(eye), box, 100, false)).toBe(true);
    expect(boxInSight(viewFrom({ ...eye, x: 17 }), box, 100, false)).toBe(false);
    // Its far end still in the view while its middle is behind the lens.
    expect(boxInSight(viewFrom({ ...eye, x: 15 }), box, 100, false)).toBe(true);
  });

  it("is under a pixel of the frame past its reach", () => {
    // A pixel's angle at the game's lens on a frame 956 rows tall: a post 0.11 m across and a car 4.6 m long.
    const pixel = (2 * Math.tan(1.4 / 2)) / 956;
    expect(0.11 / SIGN_REACH_M).toBeLessThan(pixel / 5);
    expect(4.6 / SCENERY_REACH_M).toBeLessThan(pixel * 2);
  });
});

describe("the scenery asked for before its renderer stands", () => {
  type Made = { kind: string; disposed: boolean; film: AbortSignal[]; alone: ({ darkness: number } | undefined)[]; poses: string[] };
  /** The car a trailhead of the fixture hands out once its film's car is asked for, and whether that car is in its first frames. */
  const CAR: LiteCar = { stage: () => undefined, leave: () => undefined, tailLamps: () => undefined };
  let warm = false;
  function fakeScenery(log: Made[]): LiteScenery {
    const piece = (kind: string): Made & { dispose(): void } => {
      const made = { kind, disposed: false, film: [] as AbortSignal[], alone: [] as ({ darkness: number } | undefined)[], poses: [] as string[], dispose() { made.disposed = true; } };
      log.push(made);
      return made;
    };
    return {
      signs: () => piece("signs"),
      body: () => piece("body"),
      trailhead: () => {
        const made = piece("trailhead");
        const trailhead: LiteTrailhead = {
          filmCar: (signal, alone) => {
            made.film.push(signal);
            made.alone.push(alone);
            return Promise.resolve();
          },
          filmCarIn: () => made.film.length > 0, car: () => (made.film.length > 0 ? CAR : null), warm: () => warm,
          dispose: () => made.dispose(),
        };
        return trailhead;
      },
      actor: (url) => {
        const made = piece(`actor ${url}`);
        return {
          settled: Promise.resolve(), stage: (pose) => void made.poses.push(`${pose.clip}@${pose.clipTime}`),
          joint: (name, out) => (name === "hand_r" ? out.fill(7) : null), dispose: () => made.dispose(),
        };
      },
      streaming: () => log.length > 3,
      update: () => undefined,
      shown: 0,
      dispose: () => undefined,
    };
  }
  const BOARD = { x: 0, z: 0, fx: 0, fz: 1, ax: 1, az: 0 };
  const DRAWING = { seed: 1, text: { title: "", distance: "", mapHeading: "", poster: { title: "", name: "", lines: [] }, rules: { heading: "", lines: [], small: [] } }, map: { nodes: [], edges: [], road: [], features: [], places: [], summitName: "" }, urls: { paper: null, portrait: null } };

  it("answers each ask when the renderer stands, and hands the film's car on to the trailhead made then", async () => {
    const log: Made[] = [];
    let stand: () => void = () => undefined;
    const ready = new Promise<void>((resolve) => { stand = resolve; });
    const host = deferredScenery(ready, () => fakeScenery(log));
    host.signs([], () => 0);
    const trailhead = host.trailhead({ board: BOARD }, () => 0, DRAWING);
    const film = new AbortController();
    trailhead.filmCar(film.signal);
    expect(log).toEqual([]);
    expect(trailhead.filmCarIn()).toBe(false);
    // No car to drive and no first frames before the trailhead stands.
    expect(trailhead.car()).toBeNull();
    expect(trailhead.warm()).toBe(false);
    stand();
    await ready;
    await Promise.resolve();
    expect(log.map((made) => made.kind)).toEqual(["signs", "trailhead"]);
    expect(log[1]?.film).toEqual([film.signal]);
    expect(trailhead.filmCarIn()).toBe(true);
    // The car the end scene drives is the made trailhead's own, and its first frames are told as that trailhead tells them.
    expect(trailhead.car()).toBe(CAR);
    warm = true;
    expect(trailhead.warm()).toBe(true);
    warm = false;
    // Lite makes a draw's pipeline in the frame that first draws it: a first frame to make them, a second drawn with them.
    expect(FILM_CAR_WARM_FRAMES).toBe(2);
    trailhead.dispose();
    expect(log[1]?.disposed).toBe(true);
    expect(log[0]?.disposed).toBe(false);
  });

  it("stands a staged scene's own car and its actor when the renderer stands: the car alone on its patch, the actor in the last pose asked for", async () => {
    const log: Made[] = [];
    let stand: () => void = () => undefined;
    const ready = new Promise<void>((resolve) => { stand = resolve; });
    const host = deferredScenery(ready, () => fakeScenery(log));
    const trailhead = host.trailhead({ board: BOARD }, () => 0, DRAWING);
    const film = new AbortController();
    let landed = false;
    void trailhead.filmCar(film.signal, { darkness: 0.5 }).then(() => { landed = true; });
    const actor = host.actor("ranger.glb");
    let settled = false;
    void actor.settled.then(() => { settled = true; });
    const pose = (clip: string, clipTime: number) => ({ id: "a", x: 0, y: 0, z: 0, yaw: 0, clip, clipTime, visible: true });
    actor.stage(pose("drive", 1));
    actor.stage(pose("drive", 2));
    // Nothing stands yet: no joint to read, and neither wait is over.
    expect(actor.joint("hand_r", new Float64Array(16))).toBeNull();
    await Promise.resolve();
    expect([landed, settled]).toEqual([false, false]);
    stand();
    await ready;
    for (let i = 0; i < 4; i++) await Promise.resolve();
    expect(log.map((made) => made.kind)).toEqual(["trailhead", "actor ranger.glb"]);
    expect(log[0]?.alone).toEqual([{ darkness: 0.5 }]);
    expect([landed, settled]).toEqual([true, true]);
    // The actor lands in the last pose asked for, and takes each one after.
    expect(log[1]?.poses).toEqual(["drive@2"]);
    actor.stage(pose("talk", 0.5));
    expect(log[1]?.poses).toEqual(["drive@2", "talk@0.5"]);
    expect(actor.joint("hand_r", new Float64Array(16))?.[0]).toBe(7);
    expect(actor.joint("chest", new Float64Array(16))).toBeNull();
    actor.dispose();
    expect(log[1]?.disposed).toBe(true);
  });

  it("ends the waits of a staged scene on a renderer that never has scenery", async () => {
    const host = deferredScenery(Promise.resolve(), () => null);
    const trailhead = host.trailhead({ board: BOARD }, () => 0, DRAWING);
    let landed = false, settled = false;
    void trailhead.filmCar(new AbortController().signal, { darkness: 0.5 }).then(() => { landed = true; });
    const actor = host.actor("ranger.glb");
    void actor.settled.then(() => { settled = true; });
    for (let i = 0; i < 4; i++) await Promise.resolve();
    expect([landed, settled]).toEqual([true, true]);
    actor.stage({ id: "a", x: 0, y: 0, z: 0, yaw: 0, clip: "drive", clipTime: 0, visible: true });
    expect(actor.joint("hand_r", new Float64Array(16))).toBeNull();
  });

  it("says the world streams in only once the renderer stands, and then as its scenery says", async () => {
    const log: Made[] = [];
    let stand: () => void = () => undefined;
    const ready = new Promise<void>((resolve) => { stand = resolve; });
    let stood = false;
    const scenery = fakeScenery(log);
    const host = deferredScenery(ready, () => (stood ? scenery : null));
    expect(host.streaming()).toBe(false);
    stood = true;
    stand();
    await ready;
    // The fixture's scenery streams once it has been asked for more than three pieces.
    expect(host.streaming()).toBe(false);
    for (let i = 0; i < 4; i++) scenery.body({ pos: { x: 0, y: 0, z: 0 }, yaw: 0 });
    expect(host.streaming()).toBe(true);
  });

  it("never makes a piece let go before the renderer stood, and leaves every ask unanswered by a renderer with no scenery", async () => {
    const log: Made[] = [];
    let stand: () => void = () => undefined;
    const ready = new Promise<void>((resolve) => { stand = resolve; });
    const host = deferredScenery(ready, () => fakeScenery(log));
    host.body({ pos: { x: 0, y: 0, z: 0 }, yaw: 0 }).dispose();
    const kept = host.body({ pos: { x: 1, y: 0, z: 0 }, yaw: 0 });
    stand();
    await ready;
    await Promise.resolve();
    expect(log.map((made) => made.kind)).toEqual(["body"]);
    kept.dispose();
    expect(log[0]?.disposed).toBe(true);
    const none = deferredScenery(Promise.resolve(), () => null);
    const signs = none.signs([], () => 0);
    await Promise.resolve();
    await Promise.resolve();
    expect(() => signs.dispose()).not.toThrow();
    expect(none.trailhead({ board: BOARD }, () => 0, DRAWING).filmCarIn()).toBe(false);
  });

  it("is found on the hike's own renderer and on no other", () => {
    const host = deferredScenery(Promise.resolve(), () => null);
    expect(liteSceneryOf({ scenery: host } as unknown as Renderer)).toBe(host);
    expect(liteSceneryOf({} as unknown as Renderer)).toBeNull();
  });
});

describe("a model placed once on Babylon Lite", () => {
  const material = (name: string, blended = false): ModelPart["material"] => ({ name, alphaBlend: blended }) as unknown as ModelPart["material"];
  const part = (worn: ModelPart["material"], at: number, tangents: boolean): ModelPart => ({
    facts: { material: (worn as unknown as { name: string }).name, alphaMask: false, alphaCutoff: 0.5, doubleSided: true, specularWeight: null, ior: null, vertices: 3, tangents: null },
    positions: new Float32Array([at, 0, 0, at + 1, 0, 0, at, 1, 0]), normals: new Float32Array([0, 0, 1, 0, 0, 1, 0, 0, 1]), uvs: new Float32Array([0, 0, 1, 0, 0, 1]),
    tangents: tangents ? new Float32Array([1, 0, 0, 1, 1, 0, 0, 1, 1, 0, 0, 1]) : null, indices: new Uint32Array([0, 1, 2]),
    min: { x: at, y: 0, z: 0 }, max: { x: at + 1, y: 1, z: 0 }, colour: undefined, normal: undefined, factor: [1, 1, 1], material: worn,
    nodes: ["model", "LOD0", `node${at}`], local: STOOD,
  });
  /** The frame every primitive of the fixture was stood by. */
  const STOOD = new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);

  it("gathers a file's primitives a material, in the order the materials first come: one draw a material", () => {
    const glass = material("glass", true);
    const paint = material("paint");
    const parts = partsByMaterial([part(glass, 0, false), part(paint, 10, true), part(glass, 20, false), part(paint, 30, false)]);
    expect(parts.map((p) => [p.name, p.blended, p.positions.length / 3])).toEqual([["glass", true, 6], ["paint", false, 6]]);
    expect([...(parts[0] as SceneryPart).indices]).toEqual([0, 1, 2, 3, 4, 5]);
    // Each primitive is a pane of its part: its run of the triangles, and the middle of its box.
    // And its run of the vertices, the nodes it hangs under and its own frame, for a part that is turned in place.
    expect((parts[0] as SceneryPart).panes).toEqual([
      { first: 0, count: 3, x: 0.5, y: 0.5, z: 0, vertexFirst: 0, vertexCount: 3, nodes: ["model", "LOD0", "node0"], local: STOOD },
      { first: 3, count: 3, x: 20.5, y: 0.5, z: 0, vertexFirst: 3, vertexCount: 3, nodes: ["model", "LOD0", "node20"], local: STOOD },
    ]);
    expect((parts[0] as SceneryPart).positions[9]).toBe(20);
    // A material one of whose primitives has no tangents is drawn with none.
    expect((parts[1] as SceneryPart).tangents).toBeNull();
    const both = partsByMaterial([part(paint, 0, true), part(paint, 5, true)])[0]?.tangents as Float32Array;
    expect(both).toHaveLength(24);
    // A tangent's handedness is turned with the loader's mirror, which the bake carried its direction across: the
    // frame Lite makes of a baked normal and tangent is then the file's, not its mirror image.
    expect([...both].filter((_, i) => i % 4 === 3)).toEqual([-1, -1, -1, -1, -1, -1]);
    expect([...both].filter((_, i) => i % 4 === 0)).toEqual([1, 1, 1, 1, 1, 1]);
  });

  it("lists a glass's panes farthest first from the eye, as Babylon.js orders its blended meshes, and writes the triangles in that order", () => {
    // Three panes along x: the eye beyond the last sees the first farthest.
    const centres = [0, 1, 0, 10, 1, 0, 20, 1, 0];
    const order: number[] = [];
    expect(farthestFirst(centres, { x: 30, y: 1, z: 0 }, order)).toEqual([0, 1, 2]);
    expect(farthestFirst(centres, { x: -5, y: 1, z: 0 }, order)).toEqual([2, 1, 0]);
    expect(farthestFirst(centres, { x: 12, y: 1, z: 0 }, order)).toEqual([0, 2, 1]);
    // Two panes as far as each other keep the file's order, so the list is the same from frame to frame.
    expect(farthestFirst(centres, { x: 10, y: 1, z: 7 }, order)).toEqual([0, 2, 1]);
    expect(order).toHaveLength(3);
    const panes = [{ first: 0, count: 3, x: 0, y: 0, z: 0 }, { first: 3, count: 6, x: 0, y: 0, z: 0 }, { first: 9, count: 3, x: 0, y: 0, z: 0 }];
    const indices = new Uint32Array([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]);
    const out = new Uint32Array(12);
    expect([...listPanes(indices, panes, [2, 0, 1], out)]).toEqual([9, 10, 11, 0, 1, 2, 3, 4, 5, 6, 7, 8]);
    // Every triangle is listed once, whatever the order.
    expect([...listPanes(indices, panes, [1, 2, 0], out)].sort((a, b) => a - b)).toEqual([...indices]);
  });

  it("packs a factor into a map's byte as the loader packs its own: rounded, and held to a byte", () => {
    expect([0, 0.17690762518707168, 0.5, 1, 1.4, -0.2].map(factorByte)).toEqual([0, 45, 128, 255, 255, 0]);
  });

  it("carries a see-through part to its place in the world, its faces still turned the way they were", () => {
    const [glass] = partsByMaterial([part(material("glass", true), 0, false)]) as [SceneryPart];
    const world = placed(glass, placeMatrix(100, 5, -40, Math.PI / 2));
    // A quarter turn about the vertical carries +x to -z and +z to +x.
    expect([...world.positions].map((v) => Math.round(v * 1e4) / 1e4)).toEqual([100, 5, -40, 100, 5, -41, 100, 6, -40]);
    expect([...world.normals].map((v) => Math.round(v * 1e4) / 1e4)).toEqual([1, 0, 0, 1, 0, 0, 1, 0, 0]);
    expect([...world.indices]).toEqual([0, 1, 2]);
    // The part's own geometry is left as it was.
    expect([...glass.positions]).toEqual([0, 0, 0, 1, 0, 0, 0, 1, 0]);
  });
});

describe("the parts of a car a pose turns, on Babylon Lite", () => {
  const source = readFileSync(new URL("../../../src/game/lite/sceneryMeshes.ts", import.meta.url), "utf8");
  /** Lite's own PBR vertex stage and its tangent frame, as installed. */
  const lite = (file: string): string => readFileSync(new URL(`../../../../node_modules/@babylonjs/lite/lib/material/pbr/${file}`, import.meta.url), "utf8");

  it("sends the rows of the turns the pose has moved, in one write, and no vertex: a door that swings on a car that stands sends no wheel's", () => {
    // Which turns a pose has moved is `carParts.ts`'s to say (`writeTurns`, held by its own tests): the run of the block's floats it names is the one sent.
    expect(source).toContain("if (!writeTurns(turns.slots, stood.turn, pose, turns.rows, turnsMoved)) return;");
    expect(source).toContain("writePluginUniformBlock(engine, turns.block, first + turnsMoved.from * 4, first + turnsMoved.to * 4);");
    // No vertex of a turned part is carried on the processor or sent: the one run still carried there is the handset's.
    expect(source).not.toContain("turned.mesh");
    expect(source.match(/poseVertices\(/g)).toHaveLength(1);
    expect(source).toContain("for (const run of handset.runs) poseVertices(carryScratch, holder.rest, posed, run.first, run.count);");
    expect(source.match(/updateMeshPositions\(engine, [a-z.]+, posed\.positions/g)).toEqual(["updateMeshPositions(engine, holder.mesh, posed.positions"]);
  });

  it("numbers a turned mesh's vertices once, when the mesh is made, and stands the mesh in the rain's cover map under the same turns", () => {
    expect(source).toContain("mesh.pluginVertexData = numbers;");
    expect(source).toContain("if (turns !== null && turns.numbers[n] !== null) part.material.plugins = [...(part.material.plugins ?? []), carTurnsPlugin(turns.block, readsTangents(part))];");
    expect(source).toContain("if (cover) options.cover?.add(mesh, numbers === null || turns === null ? undefined : carTurnsPlugin(turns.block, false));");
    const renderer = readFileSync(new URL("../../../src/game/lite/renderer.ts", import.meta.url), "utf8");
    expect(renderer).toContain('{ add: (mesh, place) => rainMap.register(mesh, "hard", place), remove: (mesh) => rainMap.unregister(mesh) }');
  });

  it("lays a car's turns out as a table of rows, three a turn, and names a vertex's turn by one float", () => {
    expect(carTurnsFields(6)).toEqual([{ name: "rows", type: "array<vec4<u32>,18>" }]);
    const block = { name: CAR_TURNS_BLOCK } as unknown as Parameters<typeof carTurnsPlugin>[0];
    const plugin = carTurnsPlugin(block, false);
    expect(plugin.getVertexAttributes?.()).toEqual([{ name: CAR_PART_ATTRIBUTE, type: "f32", format: "float32", stride: 4, offset: 0 }]);
    expect(plugin.getUniformBlocks?.()).toEqual([block]);
    // Nothing of the material's own: no uniform, no write, and nothing in the fragment.
    expect(plugin.getUniforms).toBeUndefined();
    expect(plugin.writeUbo).toBeUndefined();
    expect(plugin.getCustomCode?.("fragment")).toBeNull();
    expect(Object.keys(plugin.getCustomCode?.("vertex") ?? {})).toEqual(["CUSTOM_VERTEX_MAIN_END"]);
    // A material's pipeline differs by whether its tangents are turned, and by nothing of a pose.
    expect([carTurnsPlugin(block, false).defines, carTurnsPlugin(block, true).defines]).toEqual([{ tangents: false }, { tangents: true }]);
  });

  it("hands on a turned vertex through Lite's own statements, so it goes the way a vertex sent already turned went", () => {
    const template = lite("pbr-template.js");
    const lites = "let worldPos4=finalWorld*vec4<f32>(${posVar},1.0);out.worldPos=worldPos4.xyz;out.clipPos=scene.viewProjection*worldPos4;out.worldNormal=(finalWorld*vec4<f32>(normalize(${normVar}),0.0)).xyz;";
    expect(template).toContain(lites);
    const mine = lites.replaceAll("worldPos4", "ctWorld4").replace("${posVar}", "ctPosition").replace("${normVar}", "ctNormal");
    expect(carTurnsWgsl(false)).toContain(mine);
    expect(carTurnsWgsl(true)).toContain(mine);
    // The tangent frame, where the material reads its normals' map through the mesh's tangents: Lite's again, on the turned normal and tangent.
    const frame = "let N_local=normalize(${normVar});let T_local=normalize(tangent.xyz);let B_local=cross(N_local,T_local)*tangent.w;out.worldTangent=(finalWorld*vec4<f32>(T_local,0.0)).xyz;out.worldBitangent=(finalWorld*vec4<f32>(B_local,0.0)).xyz;";
    expect(lite("fragments/pbr-normal-tangent-wgsl.js")).toContain(frame);
    const turned = frame.replace("normalize(${normVar})", "normalize(ctNormal)").replace("normalize(tangent.xyz)", "normalize(ctTangent)").replaceAll("N_local", "ctNl").replaceAll("T_local", "ctTl").replaceAll("B_local", "ctBl");
    expect(carTurnsWgsl(true)).toContain(turned);
    expect(carTurnsWgsl(false)).not.toContain("tangent");
    // A vertex that names no turn is left as the stage made it: everything is inside the one test of its number.
    expect(carTurnsWgsl(true).startsWith("{let ctN=u32(carPart);if(ctN>0u){let ctAt=(ctN-1u)*3u;")).toBe(true);
    expect(carTurnsWgsl(true).endsWith("}}")).toBe(true);
    // Lite's rule for the tangent's attribute: a mesh with tangents under a material with a map of normals.
    const part = (tangents: boolean, map: boolean): SceneryPart => ({ tangents: tangents ? new Float32Array(4) : null, material: map ? { normalTexture: {} } : {} }) as unknown as SceneryPart;
    expect([readsTangents(part(true, true)), readsTangents(part(true, false)), readsTangents(part(false, true))]).toEqual([true, false, false]);
  });

  it("carries a position, a normal and a tangent by the rows where the processor's carrying put them: the stage's own sums, read as arithmetic", () => {
    // The three sums of the stage's text, as functions of a vertex and a turn's three rows.
    const wgsl = carTurnsWgsl(true);
    const sums = (name: string): ((...vectors: object[]) => number[]) => {
      const text = new RegExp(`let ${name}=vec3<f32>\\(([^;]*)\\);`).exec(wgsl)?.[1];
      expect(text, name).toBeDefined();
      // The stage's own text, which is arithmetic alone.
      return new Function("position", "normal", "tangent", "ctX", "ctY", "ctZ", `return [${text}];`) as (...vectors: object[]) => number[];
    };
    const call = (name: string, v: number[], rows: Float32Array, slot: number): number[] => {
      const vec = { x: v[0], y: v[1], z: v[2] };
      const row = (k: number): object => ({ x: rows[slot * 12 + k * 4], y: rows[slot * 12 + k * 4 + 1], z: rows[slot * 12 + k * 4 + 2], w: rows[slot * 12 + k * 4 + 3] });
      return sums(name)(vec, vec, vec, row(0), row(1), row(2));
    };
    // The door's frame under a mirrored root, swung; a turn at rest beside it.
    const local = new Float32Array([0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 0, -0.752, 0.897, 0.875, 1]);
    const pose = { x: 0, y: 0, z: 0, yaw: 0, wheelSpin: 0, doorOpen: 0.7, wheelTurn: 0, steer: 0, handset: "cradle" as const };
    const matrix = partMatrix(local, carPartTurn("door_driver", pose, { x: 0, y: 0, z: 0, w: 1 }) as NonNullable<ReturnType<typeof carPartTurn>>, new Float32Array(16));
    const rows = restTurns(2);
    writeTurnRows(matrix, rows, 1);
    const rest = { positions: new Float32Array([-0.7, 1.2, 0.4]), normals: new Float32Array([0.6, 0, 0.8]), tangents: new Float32Array([0.8, 0, -0.6, -1]) };
    const sent = { positions: new Float32Array(3), normals: new Float32Array(3), tangents: new Float32Array(4) };
    poseVertices(matrix, rest, sent, 0, 1);
    for (let k = 0; k < 3; k++) {
      expect(call("ctPosition", [...rest.positions], rows, 1)[k]).toBeCloseTo(sent.positions[k] as number, 6);
      expect(call("ctNormal", [...rest.normals], rows, 1)[k]).toBeCloseTo(sent.normals[k] as number, 6);
      expect(call("ctTangent", [...rest.tangents], rows, 1)[k]).toBeCloseTo(sent.tangents[k] as number, 6);
    }
    // The door moved the vertex; a turn at rest carries it nowhere, exactly.
    expect(Math.hypot(...[0, 1, 2].map((k) => (sent.positions[k] as number) - (rest.positions[k] as number)))).toBeGreaterThan(0.3);
    expect(call("ctPosition", [...rest.positions], rows, 0)).toEqual([...rest.positions]);
    expect(call("ctNormal", [...rest.normals], rows, 0)).toEqual([...rest.normals]);
  });
});
