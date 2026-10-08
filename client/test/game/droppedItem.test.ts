import { describe, it, expect } from "vitest";
import { NullEngine } from "@babylonjs/core/Engines/nullEngine.js";
import { Scene } from "@babylonjs/core/scene.js";
import { CAP_PROGRESS, CAP_SIDE_M, createDroppedCap, droppedCapAt } from "../../src/game/droppedItem.js";
import { stemPointAt, stemProgress } from "../../src/sim/trailRoute.js";
import { trailDistance } from "../../src/sim/trail.js";
import { activeTerrainVariant } from "../../src/sim/terrain.js";
import { seedFromToken } from "../../src/game/seed.js";
import "../../src/sim/passes/index.js";

describe("the dropped cap", () => {
  it("lies a stride off the stem a fifth of the way up, on the seed's side, the same every time for a seed", () => {
    const seed = seedFromToken("olympics-veg");
    const graph = activeTerrainVariant().trailGraph!(seed);
    const cap = droppedCapAt(graph, seed)!;
    expect(cap).not.toBeNull();
    expect(droppedCapAt(graph, seed)).toEqual(cap);
    const at = stemPointAt(graph, CAP_PROGRESS)!;
    expect(Math.hypot(cap.x - at.x, cap.z - at.z)).toBeCloseTo(CAP_SIDE_M, 6);
    // Beside the trail, not on it, and at the progress asked for.
    expect(trailDistance(graph, cap.x, cap.z)).toBeLessThan(CAP_SIDE_M + 1);
    expect(1 - stemProgress(graph, at.x, at.z)).toBeCloseTo(CAP_PROGRESS, 2);
    // Another seed, another trail: a different place or side.
    const other = seedFromToken("another-trail");
    const graph2 = activeTerrainVariant().trailGraph!(other);
    const cap2 = droppedCapAt(graph2, other)!;
    expect(cap2.x !== cap.x || cap2.z !== cap.z).toBe(true);
  });

  it("builds a crown and a brim at its place, seated on the ground given", () => {
    const engine = new NullEngine();
    const scene = new Scene(engine);
    const view = createDroppedCap(scene, { x: 3, z: -4, yaw: 1 }, 12);
    const meshes = view.node.getChildMeshes(false);
    expect(meshes.map((m) => m.name).sort()).toEqual(["dropped_cap_brim", "dropped_cap_crown"]);
    expect(view.node.position.x).toBe(3);
    expect(view.node.position.z).toBe(-4);
    expect(view.node.position.y).toBeGreaterThan(12);
    expect(view.node.position.y).toBeLessThan(12.1);
    view.dispose();
    expect(scene.getTransformNodeByName("dropped_cap")).toBeNull();
    scene.dispose();
    engine.dispose();
  });
});
