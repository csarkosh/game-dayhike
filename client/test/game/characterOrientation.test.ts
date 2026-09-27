import { describe, it, expect, afterEach } from "vitest";
import { NullEngine } from "@babylonjs/core/Engines/nullEngine.js";
import { Scene } from "@babylonjs/core/scene.js";
import { TransformNode } from "@babylonjs/core/Meshes/transformNode.js";
import { Quaternion, Vector3 } from "@babylonjs/core/Maths/math.vector.js";

import { orientationRoot } from "../../src/game/characterModel.js";

let engine: NullEngine | null = null;

afterEach(() => {
  engine?.dispose();
  engine = null;
});

function scene(): Scene {
  engine = new NullEngine();
  return new Scene(engine);
}

/**
 * Reproduces what Babylon's glTF loader hands back: a `__root__` node carrying a
 * rotationQuaternion of 180 degrees about Y and a mirrored Z scale, which together convert
 * glTF's right-handed space into Babylon's left-handed one.
 */
function loaderRoot(s: Scene): TransformNode {
  const node = new TransformNode("__root__", s);
  node.rotationQuaternion = new Quaternion(0, 1, 0, 0);
  node.scaling = new Vector3(1, 1, -1);
  return node;
}

/** World-space direction the node's local +Z points, which is where the model faces. */
function facing(node: TransformNode): Vector3 {
  node.computeWorldMatrix(true);
  const forward = Vector3.TransformNormal(new Vector3(0, 0, 1), node.getWorldMatrix());
  return forward.normalize();
}

describe("the Babylon trap this guards against", () => {
  it("ignores the Euler rotation entirely when a rotationQuaternion is set", () => {
    const s = scene();
    const root = loaderRoot(s);
    const before = facing(root);

    root.rotation.y = Math.PI / 2;

    // Assigning .rotation is silently a no-op here. This is why enemies rendered
    // through the glTF loader never turned to face anyone while their sim yaw was
    // perfectly correct, and why the capsule fallback never showed the bug: a plain
    // capsule mesh has no quaternion, so .rotation works on it.
    expect(facing(root).z).toBeCloseTo(before.z, 6);
    expect(facing(root).x).toBeCloseTo(before.x, 6);
  });
});

describe("orientationRoot", () => {
  it("returns a node whose yaw actually reaches the world matrix", () => {
    const s = scene();
    const loaded = loaderRoot(s);
    const root = orientationRoot(loaded, "character_1");

    root.rotation.y = Math.PI / 2;
    const dir = facing(loaded);

    // Yaw 90 degrees points along +X, matching the sim's convention that yaw 0 faces
    // +Z and increasing yaw rotates toward +X.
    expect(dir.x).toBeCloseTo(1, 5);
    expect(dir.z).toBeCloseTo(0, 5);
  });

  it("faces +Z at yaw 0, so the sim and the model agree on forward", () => {
    const s = scene();
    const loaded = loaderRoot(s);
    const root = orientationRoot(loaded, "character_1");

    root.rotation.y = 0;
    const dir = facing(loaded);

    expect(dir.z).toBeCloseTo(1, 5);
    expect(dir.x).toBeCloseTo(0, 5);
  });

  it("leaves the loader's own conversion untouched", () => {
    const s = scene();
    const loaded = loaderRoot(s);
    orientationRoot(loaded, "character_1");

    // The wrapper must not clear the quaternion or unmirror the scale: those are how
    // the loader reconciles glTF's handedness with Babylon's, not incidental state.
    expect(loaded.rotationQuaternion).not.toBeNull();
    expect(loaded.scaling.z).toBe(-1);
  });

  it("moves with the wrapper, so position and yaw share one node", () => {
    const s = scene();
    const loaded = loaderRoot(s);
    const root = orientationRoot(loaded, "character_1");

    root.position.set(3, 1, -2);
    loaded.computeWorldMatrix(true);

    expect(loaded.absolutePosition.x).toBeCloseTo(3, 5);
    expect(loaded.absolutePosition.y).toBeCloseTo(1, 5);
    expect(loaded.absolutePosition.z).toBeCloseTo(-2, 5);
  });
});
