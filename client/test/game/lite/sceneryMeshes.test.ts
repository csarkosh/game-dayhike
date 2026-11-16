import { describe, expect, it } from "vitest";
import type { Renderer } from "../../../src/game/renderer.js";
import { cameraAxes, restAxes, restPlanes, viewPlanes, type CameraPose } from "../../../src/game/lite/cameraPose.js";
import {
  SCENERY_REACH_M, SIGN_REACH_M, deferredScenery, inSight, liteSceneryOf, type LiteScenery, type LiteTrailhead, type SceneryView,
} from "../../../src/game/lite/sceneryMeshes.js";
import { factorByte, farthestFirst, listPanes, partsByMaterial, placeMatrix, placed, type SceneryPart } from "../../../src/game/lite/sceneryModels.js";
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

  it("is under a pixel of the frame past its reach", () => {
    // A pixel's angle at the game's lens on a frame 956 rows tall: a post 0.11 m across and a car 4.6 m long.
    const pixel = (2 * Math.tan(1.4 / 2)) / 956;
    expect(0.11 / SIGN_REACH_M).toBeLessThan(pixel / 5);
    expect(4.6 / SCENERY_REACH_M).toBeLessThan(pixel * 2);
  });
});

describe("the scenery asked for before its renderer stands", () => {
  type Made = { kind: string; disposed: boolean; film: AbortSignal[] };
  function fakeScenery(log: Made[]): LiteScenery {
    const piece = (kind: string): Made & { dispose(): void } => {
      const made = { kind, disposed: false, film: [] as AbortSignal[], dispose() { made.disposed = true; } };
      log.push(made);
      return made;
    };
    return {
      signs: () => piece("signs"),
      body: () => piece("body"),
      trailhead: () => {
        const made = piece("trailhead");
        const trailhead: LiteTrailhead = { filmCar: (signal) => void made.film.push(signal), filmCarIn: () => made.film.length > 0, dispose: () => made.dispose() };
        return trailhead;
      },
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
    stand();
    await ready;
    await Promise.resolve();
    expect(log.map((made) => made.kind)).toEqual(["signs", "trailhead"]);
    expect(log[1]?.film).toEqual([film.signal]);
    expect(trailhead.filmCarIn()).toBe(true);
    trailhead.dispose();
    expect(log[1]?.disposed).toBe(true);
    expect(log[0]?.disposed).toBe(false);
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
  });

  it("gathers a file's primitives a material, in the order the materials first come: one draw a material", () => {
    const glass = material("glass", true);
    const paint = material("paint");
    const parts = partsByMaterial([part(glass, 0, false), part(paint, 10, true), part(glass, 20, false), part(paint, 30, false)]);
    expect(parts.map((p) => [p.name, p.blended, p.positions.length / 3])).toEqual([["glass", true, 6], ["paint", false, 6]]);
    expect([...(parts[0] as SceneryPart).indices]).toEqual([0, 1, 2, 3, 4, 5]);
    // Each primitive is a pane of its part: its run of the triangles, and the middle of its box.
    expect((parts[0] as SceneryPart).panes).toEqual([{ first: 0, count: 3, x: 0.5, y: 0.5, z: 0 }, { first: 3, count: 3, x: 20.5, y: 0.5, z: 0 }]);
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
