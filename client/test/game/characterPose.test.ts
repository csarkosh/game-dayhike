import { describe, expect, it, vi } from "vitest";
import { NullEngine } from "@babylonjs/core/Engines/nullEngine.js";
import { Scene } from "@babylonjs/core/scene.js";
import { AssetContainer } from "@babylonjs/core/assetContainer.js";
import { AnimationGroup } from "@babylonjs/core/Animations/animationGroup.js";
import { Animation } from "@babylonjs/core/Animations/animation.js";
import { TransformNode } from "@babylonjs/core/Meshes/transformNode.js";
import { createCharacterPool } from "../../src/game/characterModel.js";

/** A container with one node and two clips: `Idle` (60 frames) and `Walk` (30 frames) at 30 fps. */
function fakeContainer(scene: Scene): AssetContainer {
  const c = new AssetContainer(scene);
  const root = new TransformNode("root", scene);
  c.rootNodes.push(root);
  c.transformNodes.push(root);
  for (const [name, frames] of [["Idle", 60], ["Walk", 30]] as const) {
    const g = new AnimationGroup(name, scene);
    const a = new Animation(`${name}.y`, "position.y", 30, Animation.ANIMATIONTYPE_FLOAT, Animation.ANIMATIONLOOPMODE_CYCLE);
    a.setKeys([{ frame: 0, value: 0 }, { frame: frames, value: frames }]);
    g.addTargetedAnimation(a, root);
    c.animationGroups.push(g);
  }
  return c;
}

const asset = { id: "ranger.nathan", kind: "character", output: "models/ranger.nathan.glb", animations: { idle: "Idle", walk: "Walk" } };

describe("posing a character at a clip time", () => {
  it("holds the named clip at the second asked, wrapping a loop, and names its clips", async () => {
    const engine = new NullEngine();
    const scene = new Scene(engine);
    const pool = createCharacterPool({ assets: [asset] }, async () => fakeContainer(scene));
    await pool.load(scene, [asset.id]);
    const instance = pool.acquire(7, asset.id);
    expect(instance).not.toBeNull();
    expect(instance?.clipNames()).toEqual(["Idle", "Walk"]);
    instance?.pose("Walk", 0.5);
    const node = scene.getTransformNodeByName("character_7_root");
    expect(node?.position.y).toBeCloseTo(15, 3);
    instance?.pose("Walk", 1.5);
    expect(node?.position.y).toBeCloseTo(15, 3);
    instance?.pose("idle", 1);
    expect(node?.position.y).toBeCloseTo(30, 3);
    engine.dispose();
  });

  it("logs once and holds the pose for a clip the model lacks", async () => {
    const engine = new NullEngine();
    const scene = new Scene(engine);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const pool = createCharacterPool({ assets: [asset] }, async () => fakeContainer(scene));
    await pool.load(scene, [asset.id]);
    const instance = pool.acquire(8, asset.id);
    instance?.pose("Walk", 0.5);
    instance?.pose("Drive", 2);
    instance?.pose("Drive", 3);
    const node = scene.getTransformNodeByName("character_8_root");
    expect(node?.position.y).toBeCloseTo(15, 3);
    expect(warn).toHaveBeenCalledTimes(1);
    warn.mockRestore();
    engine.dispose();
  });

  it("mixes two clips by a weight, then poses one alone again, and finds a node of the model by name", async () => {
    const engine = new NullEngine();
    const scene = new Scene(engine);
    const pool = createCharacterPool({ assets: [asset] }, async () => fakeContainer(scene));
    await pool.load(scene, [asset.id]);
    const instance = pool.acquire(7, asset.id)!;
    const node = scene.getTransformNodeByName("character_7_root")!;
    // Idle at 1 s is 30, Walk at 0.5 s is 15: a quarter of the way to Walk is 26.25.
    instance.pose("Idle", 1, { clip: "Walk", seconds: 0.5, weight: 0.25 });
    expect(node.position.y).toBeCloseTo(26.25, 3);
    instance.pose("Walk", 0.5);
    expect(node.position.y).toBeCloseTo(15, 3);
    expect(instance.joint("root")).toBe(node);
    expect(instance.joint("hand")).toBeNull();
    engine.dispose();
  });
});
