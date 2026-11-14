import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it } from "vitest";
import { NullEngine } from "@babylonjs/core/Engines/nullEngine.js";
import { Scene } from "@babylonjs/core/scene.js";
import { Vector3 } from "@babylonjs/core/Maths/math.vector.js";
import { ShaderMaterial } from "@babylonjs/core/Materials/shaderMaterial.js";
import { Texture } from "@babylonjs/core/Materials/Textures/texture.js";
import { Constants } from "@babylonjs/core/Engines/constants.js";
import type { SyncJobs, Slices } from "../../src/game/syncJobs.js";
import { WAY_HEIGHTS_A_SLICE, WAY_LIGHT_NAME, WAY_LIGHT_SAMPLERS, WAY_LIGHT_UNIFORMS, WAY_WARM_FRAMES, createWayLight } from "../../src/game/wayLight.js";
import {
  WAY_CURL, WAY_DENSITY_FLOOR, WAY_FIN_SHARE, WAY_GROUND_BAND, WAY_GROUND_CORE, WAY_GROUND_REACH, WAY_HEAD, WAY_HEAVE, WAY_HIDE_SHARE, WAY_LIFT_M, WAY_LIGHT_FLOATS, WAY_MATERIAL_LIFT,
  WAY_MIST_REACH, WAY_NEAR_DAMP, WAY_PATH_SHARE, WAY_PATH_TOP_M, WAY_POINT_GROUNDS, WAY_POINT_VERTICES, WAY_POST_LIFT, WAY_SHEET_STRENGTH, WAY_STRATA_M, WAY_VEIL_STRENGTH,
  wayDrift, wayHeavePhases, wayMistColour, type WayShape,
} from "../../src/game/wayLightGeometry.js";
import { CLOUD_NOISE_LARGE_M, CLOUD_NOISE_SIZE, CLOUD_NOISE_SMALL_M } from "../../src/game/cloudParams.js";

/** A straight way along +x, a point every 2 m, `n` points. */
function straight(n: number): WayShape {
  const xs = new Float32Array(n), zs = new Float32Array(n), cum = new Float32Array(n);
  for (let i = 0; i < n; i++) { xs[i] = i * 2; cum[i] = i * 2; }
  return { xs, zs, cum, length: (n - 1) * 2 };
}
/** Jobs run by hand: the last job begun, a slice at a time. */
function handJobs(): { jobs: SyncJobs; slice(): boolean; cancelled: number; begun: number; patient: boolean | undefined; name: string | undefined } {
  let job: Slices | null = null;
  const state = {
    cancelled: 0, begun: 0, patient: undefined as boolean | undefined, name: undefined as string | undefined,
    jobs: {
      begin(_owner: object, slices: Slices, patient?: boolean, name?: string) { job?.return(); job = slices; state.begun++; state.patient = patient; state.name = name; },
      cancel() { if (job !== null) { job.return(); job = null; state.cancelled++; } },
      pending: () => job !== null,
      idle() {}, run() {}, started: () => 0, frame: 0,
      last: { slices: 0, late: 0, completed: 0, idle: 0, ms: 0, lateMs: 0, owners: {} },
    } as SyncJobs,
    slice(): boolean {
      if (job === null) return true;
      if (job.next().done === true) { job = null; return true; }
      return false;
    },
  };
  return state;
}
const EYE = new Vector3(0, 12, 0);
const GROUND = (): number => 10;
/** The ground mist's colour in the chase at night, about. */
const MIST = { r: 0.032, g: 0.035, b: 0.033 };
type V4 = { x: number; y: number; z: number; w: number };
type Held = { _floats: Record<string, number>; _vectors3: Record<string, Vector3>; _vectors4: Record<string, V4>; _textures: Record<string, Texture> };
const four = (v: V4): number[] => [v.x, v.y, v.z, v.w];

describe("the way's mist: its fragment stage", () => {
  const fragment = readFileSync("src/game/shaders/wayLight.fragment.fx", "utf8");

  it("reads the noise at the ground mist's two scales, which the drift's shares of a tile are of", () => {
    expect(fragment).toContain("plan * (1.0 / 11.0) + wayDrift.xy");
    expect(CLOUD_NOISE_LARGE_M).toBe(11);
    expect(fragment).toContain("plan * 0.25 + up * vec2(0.37, 0.19)");
    expect(1 / CLOUD_NOISE_SMALL_M).toBe(0.25);
  });

  it("holds a standing sheet's mist under the head it is built to, so no veil or fin ends in a cut edge", () => {
    expect(fragment).toContain("uniform float wayHead;");
    expect(fragment).toContain("mix(1.0e6, vWay.w * wayHead, standing)");
  });
});

describe("the way's mist: a face too small to have a lie", () => {
  it("is given none, never a division by nothing: a fragment against the eye must not put a NaN in the frame", () => {
    const fragment = readFileSync("src/game/shaders/wayLight.fragment.fx", "utf8");
    expect(fragment).not.toContain("normalize(cross(");
    expect(fragment).toContain("inversesqrt(max(dot(face, face), 1.0e-20))");
  });
});

describe("the way's mist", () => {
  let engine: NullEngine, scene: Scene;
  const make = (colourPath: "post" | "material" = "post") => {
    engine = new NullEngine();
    scene = new Scene(engine);
    const hand = handJobs();
    return { hand, light: createWayLight(scene, colourPath, hand.jobs) };
  };
  const held = (): Held => scene.getMaterialByName(WAY_LIGHT_NAME) as unknown as Held;
  afterEach(() => { scene.dispose(); engine.dispose(); });

  it("is one material that veils what is behind it and writes no depth, given the geometry's numbers and the ground mist's noise", () => {
    const { light } = make();
    const m = scene.getMaterialByName(WAY_LIGHT_NAME) as ShaderMaterial;
    expect(m).toBeInstanceOf(ShaderMaterial);
    // Premultiplied: the mist hides a share of what is behind it and adds its own colour, so where it piles up it settles at that colour and never whitens.
    expect(m.alphaMode).toBe(Constants.ALPHA_PREMULTIPLIED);
    expect(m.disableDepthWrite).toBe(true);
    expect(m.backFaceCulling).toBe(false);
    expect(m.zOffset).toBeLessThan(0);
    expect(m.options.attributes).toEqual(["position", "wayLight"]);
    expect(m.options.uniforms).toEqual([...WAY_LIGHT_UNIFORMS]);
    expect([...WAY_LIGHT_UNIFORMS]).toEqual(["viewProjection", "wayDrift", "wayEye", "wayGain", "wayGround", "wayHead", "wayMist", "wayMove", "wayPath", "wayStrata", "wayTint"]);
    expect(m.options.samplers).toEqual([...WAY_LIGHT_SAMPLERS]);
    expect([...WAY_LIGHT_SAMPLERS]).toEqual(["wayNoise"]);
    expect(m.options.needAlphaBlending).toBe(true);
    const h = held();
    expect(four(h._vectors4.wayMist!)).toEqual([WAY_VEIL_STRENGTH, WAY_FIN_SHARE, WAY_SHEET_STRENGTH, WAY_HIDE_SHARE]);
    expect(four(h._vectors4.wayGround!)).toEqual([WAY_GROUND_BAND, WAY_GROUND_CORE, WAY_GROUND_REACH, WAY_MIST_REACH]);
    expect(four(h._vectors4.wayPath!)).toEqual([WAY_PATH_SHARE, WAY_PATH_TOP_M, WAY_NEAR_DAMP, WAY_DENSITY_FLOOR]);
    expect(h._floats.wayStrata).toBe(WAY_STRATA_M);
    expect(h._floats.wayHead).toBe(WAY_HEAD);
    expect(h._floats.wayGain).toBe(0);
    // The ground mist's own noise, tiling, so the way's mist is shaped as the night's is.
    const noise = h._textures.wayNoise!;
    expect(noise.getSize()).toEqual({ width: CLOUD_NOISE_SIZE, height: CLOUD_NOISE_SIZE });
    expect([noise.wrapU, noise.wrapV]).toEqual([Texture.WRAP_ADDRESSMODE, Texture.WRAP_ADDRESSMODE]);
    expect(light.ready).toBe(false);
  });

  it("builds as a patient job, a few of the ground's heights a slice, each chunk a mesh with the mist's attribute", () => {
    const { hand, light } = make();
    // The ground's height is the dear part (the walkable rock's layer is several reads a place): no slice asks for many.
    let asked = 0, most = 0;
    const ground = (): number => { asked++; return 10; };
    light.setWay(straight(40), ground);
    expect(hand.begun).toBe(1);
    expect(hand.patient).toBe(true);
    expect(hand.name).toBe("wayLight");
    expect(scene.meshes.length).toBe(0);
    let slices = 0, firstMeshAt = -1;
    for (;;) {
      const before = asked;
      const done = hand.slice();
      slices++;
      most = Math.max(most, asked - before);
      if (firstMeshAt < 0 && scene.meshes.length === 1) {
        firstMeshAt = slices;
        expect(light.ready).toBe(false);
      }
      if (done) break;
    }
    expect(most).toBeLessThanOrEqual(WAY_HEIGHTS_A_SLICE);
    expect(WAY_HEIGHTS_A_SLICE).toBe(24);
    // Each place on the ground was asked for once, never once a vertex: 40 points, the chunks' shared one twice.
    expect(asked).toBe(41 * WAY_POINT_GROUNDS);
    expect(firstMeshAt).toBeGreaterThan(25);
    expect(scene.meshes.length).toBe(2);
    expect(light.ready).toBe(true);
    const mesh = scene.meshes[0]!;
    expect(mesh.getVerticesData("wayLight")!.length).toBe(33 * WAY_POINT_VERTICES * WAY_LIGHT_FLOATS);
    expect(mesh.getVertexBuffer("wayLight")!.getSize()).toBe(WAY_LIGHT_FLOATS);
    expect(mesh.getTotalVertices()).toBe(33 * WAY_POINT_VERTICES);
    expect(mesh.isPickable).toBe(false);
    expect(mesh.material!.name).toBe(WAY_LIGHT_NAME);
  });

  it("stands every vertex on the ground it is given with the way, as high over it as it says: the ground the players stand on, the walkable rock with it", () => {
    const { hand, light } = make();
    // A ground that rises with x, as a rock's plate rises out of the bare ground.
    const ground = (x: number, z: number): number => 7 + 0.25 * x + 0.5 * z;
    light.setWay(straight(10), ground);
    while (!hand.slice()) { /* build */ }
    const mesh = scene.meshes[0]!;
    const positions = mesh.getVerticesData("position")!, way = mesh.getVerticesData("wayLight")!;
    expect(positions.length / 3).toBe(10 * WAY_POINT_VERTICES);
    for (let v = 0; v < positions.length / 3; v++) {
      expect(positions[v * 3 + 1]).toBeCloseTo(ground(positions[v * 3]!, positions[v * 3 + 2]!) + WAY_LIFT_M + way[v * WAY_LIGHT_FLOATS + 1]!, 3);
    }
  });

  it("draws for its first frames at nothing, then only while its level is up", () => {
    const { hand, light } = make();
    light.setWay(straight(10), GROUND);
    while (!hand.slice()) { /* build */ }
    const mesh = scene.meshes[0]!;
    // Warm: enabled with no mist, so its pipeline is made before it is seen.
    for (let i = 0; i < WAY_WARM_FRAMES; i++) {
      light.update(EYE, 0, 1, MIST, 0);
      expect(mesh.isEnabled()).toBe(true);
      expect(held()._floats.wayGain).toBe(0);
    }
    light.update(EYE, 0, 1, MIST, 0);
    expect(mesh.isEnabled()).toBe(false);
    light.update(EYE, 0.5, 2, MIST, 0);
    expect(mesh.isEnabled()).toBe(true);
    expect(held()._floats.wayGain).toBe(0.5);
    expect(held()._vectors3.wayEye!.asArray()).toEqual([0, 12, 0]);
    light.update(EYE, 0, 1, MIST, 0);
    expect(mesh.isEnabled()).toBe(false);
  });

  it("takes its colour from the ground mist, on the post path with the frame's dim taken back out of it", () => {
    const { light } = make();
    light.update(EYE, 1, 2, MIST, 0);
    const want = wayMistColour(MIST, WAY_POST_LIFT * 2);
    const got = held()._vectors3.wayTint!.asArray();
    for (let i = 0; i < 3; i++) expect(got[i]).toBeCloseTo(want[i]!, 6);
    // Another night's mist, another colour: nothing of it is fixed.
    light.update(EYE, 1, 2, { r: 0.1, g: 0.02, b: 0.02 }, 0);
    expect(held()._vectors3.wayTint!.x).toBeGreaterThan(held()._vectors3.wayTint!.z);
  });

  it("on the material path its colour is in the frame's own terms, whatever the dim", () => {
    const { light } = make("material");
    light.update(EYE, 1, 2, MIST, 0);
    const want = wayMistColour(MIST, WAY_MATERIAL_LIFT);
    const got = held()._vectors3.wayTint!.asArray();
    for (let i = 0; i < 3; i++) expect(got[i]).toBeCloseTo(want[i]!, 6);
  });

  it("is never still: its shapes drift and its banks heave with the frame's seconds", () => {
    const { light } = make();
    light.update(EYE, 1, 1, MIST, 10);
    const drift10 = four(held()._vectors4.wayDrift!), move10 = four(held()._vectors4.wayMove!);
    const d = wayDrift(10), p = wayHeavePhases(10);
    for (let i = 0; i < 4; i++) expect(drift10[i]).toBeCloseTo(d[i]!, 6);
    expect(move10[0]).toBe(WAY_HEAVE);
    expect(move10[1]).toBe(WAY_CURL);
    expect(move10[2]).toBeCloseTo(p[0], 6);
    expect(move10[3]).toBeCloseTo(p[1], 6);
    light.update(EYE, 1, 1, MIST, 10.5);
    expect(four(held()._vectors4.wayDrift!)).not.toEqual(drift10);
    expect(four(held()._vectors4.wayMove!).slice(2)).not.toEqual(move10.slice(2));
  });

  it("a new way replaces the old one's meshes and its unfinished build; none clears them", () => {
    const { hand, light } = make();
    light.setWay(straight(40), GROUND);
    while (scene.meshes.length === 0) hand.slice();
    expect(scene.meshes.length).toBe(1);
    light.setWay(straight(10), GROUND);
    expect(scene.meshes.length).toBe(0);
    while (!hand.slice()) { /* build */ }
    expect(scene.meshes.length).toBe(1);
    light.setWay(null, GROUND);
    expect(scene.meshes.length).toBe(0);
    expect(light.ready).toBe(false);
    light.update(EYE, 1, 1, MIST, 0);
  });

  it("disposes its meshes, its material, its noise and its build", () => {
    const { hand, light } = make();
    expect(scene.textures.length).toBe(1);
    light.setWay(straight(40), GROUND);
    while (scene.meshes.length === 0) hand.slice();
    light.dispose();
    expect(scene.meshes.length).toBe(0);
    expect(scene.getMaterialByName(WAY_LIGHT_NAME)).toBeNull();
    expect(scene.textures.length).toBe(0);
    expect(hand.jobs.pending({})).toBe(false);
  });
});
