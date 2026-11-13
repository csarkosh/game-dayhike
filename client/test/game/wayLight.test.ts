import { afterEach, describe, expect, it } from "vitest";
import { NullEngine } from "@babylonjs/core/Engines/nullEngine.js";
import { Scene } from "@babylonjs/core/scene.js";
import { Vector3 } from "@babylonjs/core/Maths/math.vector.js";
import { ShaderMaterial } from "@babylonjs/core/Materials/shaderMaterial.js";
import { Constants } from "@babylonjs/core/Engines/constants.js";
import type { SyncJobs, Slices } from "../../src/game/syncJobs.js";
import { WAY_LIGHT_NAME, WAY_LIGHT_UNIFORMS, WAY_MATERIAL_GAIN, WAY_WARM_FRAMES, createWayLight } from "../../src/game/wayLight.js";
import { WAY_FLOOR_REACH, WAY_FLOOR_STRENGTH, WAY_POINT_VERTICES, WAY_TINT, WAY_WALL_REACH, WAY_WALL_STRENGTH, type WayShape } from "../../src/game/wayLightGeometry.js";

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
type Held = { _floats: Record<string, number>; _vectors3: Record<string, Vector3>; _vectors4: Record<string, { x: number; y: number; z: number; w: number }> };

describe("the way's light", () => {
  let engine: NullEngine, scene: Scene;
  const make = (colourPath: "post" | "material" = "post") => {
    engine = new NullEngine();
    scene = new Scene(engine);
    const hand = handJobs();
    return { hand, light: createWayLight(scene, colourPath, () => 10, hand.jobs) };
  };
  afterEach(() => { scene.dispose(); engine.dispose(); });

  it("is one additive material that writes no depth, lit from the geometry's numbers", () => {
    const { light } = make();
    const m = scene.getMaterialByName(WAY_LIGHT_NAME) as ShaderMaterial;
    expect(m).toBeInstanceOf(ShaderMaterial);
    expect(m.alphaMode).toBe(Constants.ALPHA_ADD);
    expect(m.disableDepthWrite).toBe(true);
    expect(m.backFaceCulling).toBe(false);
    expect(m.zOffset).toBeLessThan(0);
    expect(m.options.attributes).toEqual(["position", "wayLight"]);
    expect(m.options.uniforms).toEqual([...WAY_LIGHT_UNIFORMS]);
    expect(m.options.needAlphaBlending).toBe(true);
    const held = m as unknown as Held;
    expect(held._vectors4.wayShape).toMatchObject({ x: WAY_FLOOR_STRENGTH, y: WAY_WALL_STRENGTH, z: WAY_FLOOR_REACH, w: WAY_WALL_REACH });
    expect(held._vectors3.wayTint!.asArray()).toEqual([...WAY_TINT]);
    expect(light.ready).toBe(false);
  });

  it("builds a chunk a slice as a patient job, each a mesh with the light's attribute", () => {
    const { hand, light } = make();
    light.setWay(straight(40));
    expect(hand.begun).toBe(1);
    expect(hand.patient).toBe(true);
    expect(hand.name).toBe("wayLight");
    expect(scene.meshes.length).toBe(0);
    expect(hand.slice()).toBe(false);
    expect(scene.meshes.length).toBe(1);
    expect(light.ready).toBe(false);
    while (!hand.slice()) { /* the rest */ }
    expect(scene.meshes.length).toBe(2);
    expect(light.ready).toBe(true);
    const mesh = scene.meshes[0]!;
    expect(mesh.getVerticesData("wayLight")!.length).toBe(33 * WAY_POINT_VERTICES * 2);
    expect(mesh.getTotalVertices()).toBe(33 * WAY_POINT_VERTICES);
    expect(mesh.isPickable).toBe(false);
    expect(mesh.material!.name).toBe(WAY_LIGHT_NAME);
  });

  it("draws for its first frames at nothing, then only while its level is up", () => {
    const { hand, light } = make();
    light.setWay(straight(10));
    while (!hand.slice()) { /* build */ }
    const mesh = scene.meshes[0]!;
    const held = scene.getMaterialByName(WAY_LIGHT_NAME) as unknown as Held;
    // Warm: enabled with no light, so its pipeline is made before it is seen.
    for (let i = 0; i < WAY_WARM_FRAMES; i++) {
      light.update(EYE, 0, 1);
      expect(mesh.isEnabled()).toBe(true);
      expect(held._floats.wayGain).toBe(0);
    }
    light.update(EYE, 0, 1);
    expect(mesh.isEnabled()).toBe(false);
    light.update(EYE, 0.5, 2);
    expect(mesh.isEnabled()).toBe(true);
    // On the post path the light is undimmed: the frame's dim is taken back out of it.
    expect(held._floats.wayGain).toBeCloseTo(1, 6);
    expect(held._vectors3.wayEye!.asArray()).toEqual([0, 12, 0]);
    light.update(EYE, 0, 1);
    expect(mesh.isEnabled()).toBe(false);
  });

  it("on the material path its light is in the frame's own terms, whatever the dim", () => {
    const { hand, light } = make("material");
    light.setWay(straight(10));
    while (!hand.slice()) { /* build */ }
    for (let i = 0; i <= WAY_WARM_FRAMES; i++) light.update(EYE, 1, 2);
    expect((scene.getMaterialByName(WAY_LIGHT_NAME) as unknown as Held)._floats.wayGain).toBeCloseTo(WAY_MATERIAL_GAIN, 6);
  });

  it("a new way replaces the old one's meshes and its unfinished build; none clears them", () => {
    const { hand, light } = make();
    light.setWay(straight(40));
    hand.slice();
    expect(scene.meshes.length).toBe(1);
    light.setWay(straight(10));
    expect(scene.meshes.length).toBe(0);
    while (!hand.slice()) { /* build */ }
    expect(scene.meshes.length).toBe(1);
    light.setWay(null);
    expect(scene.meshes.length).toBe(0);
    expect(light.ready).toBe(false);
    light.update(EYE, 1, 1);
  });

  it("disposes its meshes, its material and its build", () => {
    const { hand, light } = make();
    light.setWay(straight(40));
    hand.slice();
    light.dispose();
    expect(scene.meshes.length).toBe(0);
    expect(scene.getMaterialByName(WAY_LIGHT_NAME)).toBeNull();
    expect(hand.jobs.pending({})).toBe(false);
  });
});
