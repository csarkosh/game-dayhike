import { afterEach, describe, expect, it } from "vitest";
import { NullEngine } from "@babylonjs/core/Engines/nullEngine.js";
import { Scene } from "@babylonjs/core/scene.js";
import { Vector3 } from "@babylonjs/core/Maths/math.vector.js";
import { ShaderMaterial } from "@babylonjs/core/Materials/shaderMaterial.js";
import { Constants } from "@babylonjs/core/Engines/constants.js";
import { WAY_FIELD_NAME, WAY_FIELD_SAMPLERS, WAY_FIELD_UNIFORMS, createWayMistField } from "../../src/game/wayMistField.js";
import { FIELD_FIN_STRENGTH, FIELD_FLOATS, FIELD_FROM_M, FIELD_RIM_M, FIELD_SHEET_STRENGTH, FIELD_TOP_M, FIELD_VERTICES, FIELD_WHOLE_M } from "../../src/game/wayMistFieldGeometry.js";
import { WAY_HEAD, WAY_HIDE_SHARE, wayTint } from "../../src/game/wayLightGeometry.js";
import { WAY_WARM_FRAMES } from "../../src/game/wayLight.js";
import { CHASE_TINT } from "../../src/game/gradeParams.js";
import { makeWay } from "../../src/sim/wayDown.js";

const EYE = new Vector3(30, 12, 0);
const MIST = { r: 0.032, g: 0.035, b: 0.033 };
const GROUND = (): number => 10;
const way = makeWay(Array.from({ length: 60 }, (_, i) => ({ x: i * 2, z: 0 })), 118, false);
type V4 = { x: number; y: number; z: number; w: number };
type Held = { _floats: Record<string, number>; _vectors3: Record<string, Vector3>; _vectors4: Record<string, V4> };

describe("the mist beyond the way", () => {
  let engine: NullEngine, scene: Scene;
  const make = () => {
    engine = new NullEngine();
    scene = new Scene(engine);
    return createWayMistField(scene);
  };
  const held = (): Held => scene.getMaterialByName(WAY_FIELD_NAME) as unknown as Held;
  afterEach(() => { scene.dispose(); engine.dispose(); });

  it("is one mesh and one material that veils what is behind it, given the field's numbers", () => {
    make();
    const m = scene.getMaterialByName(WAY_FIELD_NAME) as ShaderMaterial;
    expect(m.alphaMode).toBe(Constants.ALPHA_PREMULTIPLIED);
    expect(m.disableDepthWrite).toBe(true);
    expect(m.backFaceCulling).toBe(false);
    expect(m.options.attributes).toEqual(["position", "wayField"]);
    expect(m.options.uniforms).toEqual([...WAY_FIELD_UNIFORMS]);
    expect([...WAY_FIELD_UNIFORMS]).toEqual(["viewProjection", "wayDrift", "wayEye", "wayFieldMist", "wayFieldReach", "wayGain", "wayHead", "wayMove", "wayTint"]);
    expect(m.options.samplers).toEqual([...WAY_FIELD_SAMPLERS]);
    const h = held();
    expect([h._vectors4.wayFieldMist!.x, h._vectors4.wayFieldMist!.y, h._vectors4.wayFieldMist!.z, h._vectors4.wayFieldMist!.w]).toEqual([FIELD_SHEET_STRENGTH, FIELD_FIN_STRENGTH, FIELD_TOP_M, WAY_HIDE_SHARE]);
    expect([h._vectors4.wayFieldReach!.x, h._vectors4.wayFieldReach!.y, h._vectors4.wayFieldReach!.z, h._vectors4.wayFieldReach!.w]).toEqual([FIELD_FROM_M, FIELD_WHOLE_M, FIELD_RIM_M[0], FIELD_RIM_M[1]]);
    expect(h._floats.wayHead).toBe(WAY_HEAD);
    expect(scene.meshes.length).toBe(1);
    const mesh = scene.meshes[0]!;
    expect(mesh.getTotalVertices()).toBe(FIELD_VERTICES);
    expect(mesh.getVertexBuffer("wayField")!.getSize()).toBe(FIELD_FLOATS);
    expect(mesh.isPickable).toBe(false);
  });

  it("draws for its first frames at nothing, then only while the way's mist is up and there is a way", () => {
    const field = make();
    const mesh = scene.meshes[0]!;
    for (let i = 0; i < WAY_WARM_FRAMES; i++) {
      field.update(EYE, 0, MIST, 0, 0, null, null);
      expect(mesh.isEnabled()).toBe(true);
      expect(held()._floats.wayGain).toBe(0);
    }
    field.update(EYE, 0, MIST, 0, 0, way, GROUND);
    expect(mesh.isEnabled()).toBe(false);
    field.update(EYE, 1, MIST, 0, 0, null, null);
    expect(mesh.isEnabled()).toBe(false);
    field.update(EYE, 0.5, MIST, 0, 0, way, GROUND);
    expect(mesh.isEnabled()).toBe(true);
    expect(held()._floats.wayGain).toBe(0.5);
  });

  it("stands on the ground a few cells a frame, and takes the mist's colour with the chase's cast", () => {
    const field = make();
    let asked = 0;
    const ground = (): number => { asked++; return 10; };
    for (let i = 0; i <= WAY_WARM_FRAMES; i++) field.update(EYE, 1, MIST, 3, 1, way, ground);
    expect(asked).toBeGreaterThan(0);
    expect(asked).toBeLessThanOrEqual(40 * (WAY_WARM_FRAMES + 1));
    const want = wayTint("material", MIST, 1, 1, CHASE_TINT);
    const got = held()._vectors3.wayTint!.asArray();
    for (let i = 0; i < 3; i++) expect(got[i]).toBeCloseTo(want[i]!, 6);
    expect(held()._vectors3.wayEye!.asArray()).toEqual([30, 12, 0]);
    // The eye's own cell is on the ground by now: the lowest sheet's middle vertex.
    const positions = scene.meshes[0]!.getVerticesData("position")!;
    const centre = 12 * 25 + 12;
    expect(positions[centre * 3 + 1]).toBeCloseTo(10 + 0.08 + 0.25, 4);
  });

  it("disposes its mesh, its material and its noise", () => {
    const field = make();
    expect(scene.textures.length).toBe(1);
    field.dispose();
    expect(scene.meshes.length).toBe(0);
    expect(scene.getMaterialByName(WAY_FIELD_NAME)).toBeNull();
    expect(scene.textures.length).toBe(0);
  });
});
