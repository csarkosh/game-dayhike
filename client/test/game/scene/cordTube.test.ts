import { describe, expect, it } from "vitest";
import { NullEngine } from "@babylonjs/core/Engines/nullEngine.js";
import { VertexBuffer } from "@babylonjs/core/Buffers/buffer.js";
import { Scene } from "@babylonjs/core/scene.js";
import { createCordTube } from "../../../src/game/scene/cordTube.js";

describe("the cord's tube", () => {
  it("is made on the first lay and reshaped in place after, then goes with its material", () => {
    const engine = new NullEngine();
    const scene = new Scene(engine);
    const tube = createCordTube(scene);
    const line = (y: number) => Array.from({ length: 11 }, (_, i) => ({ x: i * 0.05, y, z: 0 }));
    tube.lay(line(1));
    const mesh = scene.getMeshByName("film_cord")!;
    const ys = () => Array.from(mesh.getVerticesData(VertexBuffer.PositionKind)!).filter((_, i) => i % 3 === 1);
    // A six-sided tube of 1.8 mm: its lowest corner is the radius times cos 30 degrees below the line.
    expect(Math.min(...ys())).toBeCloseTo(0.998441, 6);
    tube.lay(line(2));
    expect(scene.meshes.filter((m) => m.name === "film_cord")).toHaveLength(1);
    expect(Math.min(...ys())).toBeCloseTo(1.998441, 6);
    tube.dispose();
    expect(scene.getMeshByName("film_cord")).toBeNull();
    expect(scene.getMaterialByName("mat_film_cord")).toBeNull();
    engine.dispose();
  });
});
