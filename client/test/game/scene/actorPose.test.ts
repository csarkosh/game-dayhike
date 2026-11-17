import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { NullEngine } from "@babylonjs/core/Engines/nullEngine.js";
import { Scene } from "@babylonjs/core/scene.js";
import { loadAssetContainerAsync } from "@babylonjs/core/Loading/sceneLoader.js";
import { registerBuiltInLoaders } from "@babylonjs/loaders/dynamic.js";
import catalog from "../../../assets/catalog.json" with { type: "json" };
import { createCharacterPool, type CharacterInstance, type CharacterLoader } from "../../../src/game/characterModel.js";
import {
  actorBones, actorClips, actorNode, createActorPosed, invertAffine, poseActor, readActorRig, rootForJoint, type ActorBlend, type ActorRig,
} from "../../../src/game/scene/actorPose.js";
import { INTRO_RANGER } from "../../../src/game/scene/intro.js";
import { worldOf } from "../../../src/game/scene/sceneStage.js";

const FILE = new URL("../../../assets/models/intro.ranger.glb", import.meta.url);

/** The real file, read from disk the way `characterModel.test.ts` does. */
const fromDisk: CharacterLoader = (asset, scene) => {
  registerBuiltInLoaders();
  const bytes = readFileSync(new URL(`../../../assets/${asset.output}`, import.meta.url));
  return loadAssetContainerAsync(new Uint8Array(bytes), scene, { pluginExtension: ".glb" });
};

function rigFromDisk(): ActorRig {
  const bytes = readFileSync(FILE);
  return readActorRig(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
}

/** The film's ranger as the stage on Babylon.js poses it: its instance, standing at the origin, facing +z. */
async function stagedRanger(): Promise<{ instance: CharacterInstance; done(): void }> {
  const engine = new NullEngine();
  const scene = new Scene(engine);
  const pool = createCharacterPool(catalog, fromDisk);
  await pool.load(scene, [INTRO_RANGER]);
  const instance = pool.acquire(1, INTRO_RANGER);
  if (instance === null) throw new Error("the film's ranger did not load");
  return {
    instance,
    done() {
      pool.dispose();
      engine.dispose();
    },
  };
}

/** How far (the largest float of sixteen) every named node of the rig stands from the same node on Babylon.js. */
function apart(rig: ActorRig, world: Float64Array, instance: CharacterInstance): { worst: number; compared: number } {
  let worst = 0;
  let compared = 0;
  for (const [i, name] of rig.names.entries()) {
    const node = name === undefined ? null : instance.joint(name);
    if (node === null) continue;
    const m = worldOf(node).m;
    for (let e = 0; e < 16; e++) worst = Math.max(worst, Math.abs((m[e] as number) - (world[i * 16 + e] as number)));
    compared++;
  }
  return { worst, compared };
}

describe("an actor's pose with no engine", () => {
  it("reads the film's ranger: its nodes, its one skin of 52 joints and the film's clips", () => {
    const rig = rigFromDisk();
    expect(rig.nodes).toBe(55);
    expect(rig.skins).toHaveLength(1);
    expect(rig.skins[0]!.joints).toHaveLength(52);
    expect(rig.skins[0]!.inverseBind).toHaveLength(52 * 16);
    for (const clip of ["drive", "reach", "talk", "lower", "door", "walk", "face_trail"]) expect(actorClips(rig)).toContain(clip);
    for (const joint of ["chest", "hips", "hand_r"]) expect(actorNode(rig, joint)).toBeGreaterThanOrEqual(0);
    expect(actorNode(rig, "no such joint")).toBe(-1);
    // A parent stands before its children.
    const place = new Map([...rig.order].map((node, k) => [node, k]));
    for (let i = 0; i < rig.nodes; i++) if ((rig.parents[i] as number) >= 0) expect(place.get(rig.parents[i] as number)!).toBeLessThan(place.get(i)!);
  });

  it("stands every node where the stage on Babylon.js stands it: a clip at a time, a loop wrapped, a clip that begins after its first frame", async () => {
    const rig = rigFromDisk();
    const posed = createActorPosed(rig);
    const { instance, done } = await stagedRanger();
    const times: [string, number][] = [
      ["drive", 0], ["drive", 1.234], ["drive", 3.99], ["drive", 9.7], ["reach", 0.4], ["reach", 1.5 - 1 / 60], ["talk", 2.2], ["talk", 31.05],
      ["lower", 1.9], ["door", 0.01], ["door", 2.6], ["walk", 0], ["walk", 0.02], ["walk", 0.9], ["walk", 5.3], ["face_trail", 3.2], ["idle", 0.01],
    ];
    for (const [clip, seconds] of times) {
      instance.pose(clip, seconds);
      expect(poseActor(rig, clip, seconds, undefined, posed), clip).toBe(true);
      const { worst, compared } = apart(rig, posed.world, instance);
      expect(compared, clip).toBeGreaterThanOrEqual(52);
      // The model's joints are in hundredths of a metre: a float of a matrix is within a hundredth of a millimetre.
      expect(worst, `${clip} at ${seconds}`).toBeLessThan(1e-5);
    }
    done();
  });

  it("mixes two clips as the stage does, and poses one alone again after", async () => {
    const rig = rigFromDisk();
    const posed = createActorPosed(rig);
    const { instance, done } = await stagedRanger();
    const blends: [string, number, ActorBlend][] = [
      ["reach", 0.1, { clip: "drive", seconds: 15.1, weight: 0.7 }],
      ["talk", 0.2, { clip: "reach", seconds: 1.4, weight: 0.25 }],
      ["door", 0.05, { clip: "drive", seconds: 1.1, weight: 0.93 }],
      ["walk", 0.15, { clip: "door", seconds: 2.98, weight: 0.5 }],
      ["face_trail", 0.29, { clip: "walk", seconds: 6, weight: 0.01 }],
      ["drive", 0.5, { clip: "lower", seconds: 1.99, weight: 2 }],
    ];
    for (const [clip, seconds, blend] of blends) {
      instance.pose(clip, seconds, { clip: blend.clip, seconds: blend.seconds, weight: blend.weight });
      expect(poseActor(rig, clip, seconds, blend, posed)).toBe(true);
      expect(apart(rig, posed.world, instance).worst, `${clip} toward ${blend.clip}`).toBeLessThan(1e-5);
    }
    // No weight, or the clip itself: the clip alone.
    instance.pose("talk", 1, { clip: "drive", seconds: 2, weight: 0 });
    poseActor(rig, "talk", 1, { clip: "drive", seconds: 2, weight: 0 }, posed);
    expect(apart(rig, posed.world, instance).worst).toBeLessThan(1e-5);
    instance.pose("talk", 1.7);
    poseActor(rig, "talk", 1.7, undefined, posed);
    expect(apart(rig, posed.world, instance).worst).toBeLessThan(1e-5);
    done();
  });

  it("leaves the pose as it was for a clip the model lacks, and leaves out a blend's", () => {
    const rig = rigFromDisk();
    const posed = createActorPosed(rig);
    poseActor(rig, "talk", 1, undefined, posed);
    const before = posed.world.slice();
    expect(poseActor(rig, "no such clip", 2, undefined, posed)).toBe(false);
    expect(posed.world).toEqual(before);
    expect(poseActor(rig, "talk", 1, { clip: "no such clip", seconds: 0, weight: 0.5 }, posed)).toBe(true);
    expect(posed.world).toEqual(before);
  });

  it("stands the root so a joint is at its anchor, whichever way the actor faces", async () => {
    const rig = rigFromDisk();
    const posed = createActorPosed(rig);
    const { instance, done } = await stagedRanger();
    const chest = actorNode(rig, "chest");
    const anchor = { x: 12.5, y: 3.25, z: -40 };
    for (const yaw of [0, 0.7, -2.4, Math.PI]) {
      poseActor(rig, "drive", 2, undefined, posed);
      const root = rootForJoint(posed, chest, yaw, anchor, { x: 0, y: 0, z: 0 });
      // The stage on Babylon.js: the actor stood there and turned, its chest read back.
      instance.pose("drive", 2);
      instance.root.position.set(root.x, root.y, root.z);
      instance.root.rotation.y = yaw;
      const at = worldOf(instance.joint("chest")!).getTranslation();
      expect(at.x).toBeCloseTo(anchor.x, 4);
      expect(at.y).toBeCloseTo(anchor.y, 4);
      expect(at.z).toBeCloseTo(anchor.z, 4);
    }
    done();
  });

  it("tells a skin's bones in its mesh's own frame: at rest every joint turns its vertices as every other does", () => {
    const rig = rigFromDisk();
    const posed = createActorPosed(rig);
    const bones = new Float32Array(52 * 16);
    actorBones(rig, 0, posed, bones);
    // At rest a joint's matrix over its inverse bind matrix is the skeleton's frame in the mesh's: the same turn for every
    // joint, to within how far the file's rest stands from the pose its skin was bound in.
    for (let j = 1; j < 52; j++) for (const e of [0, 1, 2, 4, 5, 6, 8, 9, 10]) expect(bones[j * 16 + e]).toBeCloseTo(bones[e] as number, 1);
    expect(bones[15]).toBe(1);
    // And a posed bone moves: the hand's in the talk is not the hand's at rest.
    const talking = new Float32Array(52 * 16);
    poseActor(rig, "talk", 1, undefined, posed);
    actorBones(rig, 0, posed, talking);
    const hand = rig.skins[0]!.joints.indexOf(actorNode(rig, "hand_r"));
    expect(hand).toBeGreaterThanOrEqual(0);
    expect(Math.abs((talking[hand * 16 + 12] as number) - (bones[hand * 16 + 12] as number)) + Math.abs((talking[hand * 16 + 13] as number) - (bones[hand * 16 + 13] as number))).toBeGreaterThan(1);
  });

  it("undoes a matrix of a turn, a size and a place", () => {
    const rig = rigFromDisk();
    const posed = createActorPosed(rig);
    poseActor(rig, "walk", 0.4, undefined, posed);
    const hand = actorNode(rig, "hand_r");
    const inverse = new Float64Array(16);
    invertAffine(posed.world, hand * 16, inverse, 0);
    const m = posed.world.subarray(hand * 16, hand * 16 + 16);
    for (let column = 0; column < 4; column++) {
      for (let row = 0; row < 4; row++) {
        let sum = 0;
        for (let k = 0; k < 4; k++) sum += (m[k * 4 + row] as number) * (inverse[column * 4 + k] as number);
        expect(sum).toBeCloseTo(row === column ? 1 : 0, 9);
      }
    }
  });
});
