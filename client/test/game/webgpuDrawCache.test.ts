import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { NullEngine } from "@babylonjs/core/Engines/nullEngine.js";
import { Scene } from "@babylonjs/core/scene.js";
import { Geometry } from "@babylonjs/core/Meshes/geometry.js";
import { Mesh } from "@babylonjs/core/Meshes/mesh.js";
import { CreateBox } from "@babylonjs/core/Meshes/Builders/boxBuilder.js";
import { Matrix } from "@babylonjs/core/Maths/math.vector.js";
import { VertexBuffer } from "@babylonjs/core/Buffers/buffer.js";
import "@babylonjs/core/Meshes/thinInstanceMesh.js";
import { resetDrawsOf, resetDrawsOnBufferSwap } from "../../src/game/webgpuDrawCache.js";

/** A draw context that counts its resets, as WebGPU's would drop its bundle. */
type Counting = { reset(): void; dispose(): void; resets: number };

let engine: NullEngine;
let scene: Scene;
let contexts: Counting[];
beforeEach(() => {
  engine = new NullEngine();
  // NullEngine makes no draw contexts (WebGL has none); WebGPU makes one a
  // draw wrapper, which is what a reset reaches.
  contexts = [];
  engine.createDrawContext = (() => {
    const context: Counting = {
      resets: 0,
      reset() {
        this.resets++;
      },
      dispose() {},
    };
    contexts.push(context);
    return context;
  }) as never;
  // NullEngine reports no instancing, and `thinInstanceAdd` refuses to run
  // without it; WebGPU has it.
  (engine.getCaps() as { instancedArrays: boolean }).instancedArrays = true;
  scene = new Scene(engine);
});
afterEach(() => engine.dispose());

/** The draw contexts of `mesh`'s first sub-mesh in two passes, as the main
 * pass and a shadow map's would be. */
function drawnInTwoPasses(mesh: Mesh): Counting[] {
  const subMesh = mesh.subMeshes[0]!;
  return [0, 7].map((pass) => subMesh._getDrawWrapper(pass, true)!.drawContext as unknown as Counting);
}

const matrices = (n: number): Float32Array => {
  const out = new Float32Array(n * 16);
  for (let i = 0; i < n; i++) Matrix.Identity().copyToArray(out, i * 16);
  return out;
};

describe("Babylon's geometry buffer swaps (canaries: when one fails, an installed Babylon resets draws on a swap itself; remove the workaround and its install in the upgrade's own commit)", () => {
  it("still leaves every pass's draw context alone when a thin-instance matrix buffer is replaced", () => {
    const mesh = CreateBox("bucket", {}, scene);
    mesh.thinInstanceSetBuffer("matrix", matrices(9), 16, false);
    const passes = drawnInTwoPasses(mesh);
    mesh.thinInstanceSetBuffer("matrix", matrices(18), 16, false);
    expect(passes.map((c) => c.resets)).toEqual([0, 0]);
  });

  it("still leaves every pass's draw context alone when the indices are replaced under the same sub-meshes", () => {
    const mesh = CreateBox("box", {}, scene);
    const passes = drawnInTwoPasses(mesh);
    mesh.setIndices(mesh.getIndices()!.slice(), null, false, true);
    expect(passes.map((c) => c.resets)).toEqual([0, 0]);
  });
});

describe("resetDrawsOnBufferSwap", () => {
  let uninstall: () => void;
  beforeEach(() => {
    uninstall = resetDrawsOnBufferSwap(Geometry.prototype as never);
  });
  afterEach(() => uninstall());

  it("resets every pass's draw of a thin-instance bucket whose matrix buffer is replaced, as a growing flock's is", () => {
    const mesh = CreateBox("bucket", {}, scene);
    mesh.thinInstanceSetBuffer("matrix", matrices(9), 16, false);
    const passes = drawnInTwoPasses(mesh);
    mesh.thinInstanceSetBuffer("matrix", matrices(18), 16, false);
    expect(passes.every((c) => c.resets >= 1)).toBe(true);
  });

  it("resets them when a user thin-instance attribute is replaced, as the flocks' wing buffer is", () => {
    const mesh = CreateBox("bucket", {}, scene);
    mesh.thinInstanceSetBuffer("matrix", matrices(9), 16, false);
    mesh.thinInstanceSetBuffer("wing", new Float32Array(18), 2, false);
    const passes = drawnInTwoPasses(mesh);
    mesh.thinInstanceSetBuffer("wing", new Float32Array(36), 2, false);
    expect(passes.every((c) => c.resets >= 1)).toBe(true);
  });

  it("resets them when thinInstanceAdd outgrows the matrix buffer and Babylon makes a larger one", () => {
    const mesh = CreateBox("bucket", {}, scene);
    mesh.thinInstanceAdd(Matrix.Identity());
    const passes = drawnInTwoPasses(mesh);
    const before = (mesh as unknown as { _thinInstanceDataStorage: { matrixBuffer: unknown } })._thinInstanceDataStorage.matrixBuffer;
    for (let i = 0; i < 64; i++) mesh.thinInstanceAdd(Matrix.Identity());
    const after = (mesh as unknown as { _thinInstanceDataStorage: { matrixBuffer: unknown } })._thinInstanceDataStorage.matrixBuffer;
    expect(after).not.toBe(before);
    expect(passes.every((c) => c.resets >= 1)).toBe(true);
  });

  it("resets them when a vertex attribute or the indices are replaced", () => {
    const mesh = CreateBox("box", {}, scene);
    const [main, shadow] = drawnInTwoPasses(mesh);
    mesh.setVerticesData(VertexBuffer.NormalKind, mesh.getVerticesData(VertexBuffer.NormalKind)!.slice());
    expect([main!.resets, shadow!.resets]).toEqual([1, 1]);
    // Under the same sub-meshes: a swap that makes them again drops their draws with them.
    mesh.setIndices(mesh.getIndices()!.slice(), null, false, true);
    expect([main!.resets, shadow!.resets]).toEqual([2, 2]);
  });

  it("resets the draws of every mesh that shares the geometry", () => {
    const a = CreateBox("a", {}, scene);
    const b = new Mesh("b", scene);
    a.geometry!.applyToMesh(b);
    const passes = [...drawnInTwoPasses(a), ...drawnInTwoPasses(b)];
    a.setVerticesData(VertexBuffer.NormalKind, a.getVerticesData(VertexBuffer.NormalKind)!.slice());
    expect(passes.map((c) => c.resets)).toEqual([1, 1, 1, 1]);
  });

  it("resets nothing for a buffer written in place, which keeps its GPU buffer", () => {
    const mesh = CreateBox("bucket", {}, scene);
    mesh.thinInstanceSetBuffer("matrix", matrices(9), 16, false);
    const passes = drawnInTwoPasses(mesh);
    mesh.thinInstanceBufferUpdated("matrix");
    mesh.thinInstanceCount = 4;
    expect(passes.map((c) => c.resets)).toEqual([0, 0]);
  });

  it("wraps the doors once however often it is installed, and its uninstall puts Babylon's back", () => {
    const proto = Geometry.prototype as unknown as Record<string, unknown>;
    const wrapped = proto.setVerticesBuffer;
    const again = resetDrawsOnBufferSwap(Geometry.prototype as never);
    expect(proto.setVerticesBuffer).toBe(wrapped);
    again();
    expect(proto.setVerticesBuffer).toBe(wrapped);
    uninstall();
    expect((proto.setVerticesBuffer as { resetsDraws?: boolean }).resetsDraws).toBeUndefined();
    uninstall = () => undefined;
  });
});

describe("resetDrawsOf", () => {
  it("counts the contexts it reset, and passes over a wrapper without one (WebGL2's)", () => {
    const mesh = CreateBox("box", {}, scene);
    drawnInTwoPasses(mesh);
    (mesh.subMeshes[0] as unknown as { _drawWrappers: unknown[] })._drawWrappers[3] = { drawContext: undefined, dispose() {} };
    expect(resetDrawsOf(mesh.geometry!)).toBe(2);
  });
});

describe("the engine's install", () => {
  it("wraps the geometry doors before any WebGPU engine is made, and turns the fast path on once the engine stands", () => {
    const src = readFileSync(new URL("../../src/game/gpuEngine.ts", import.meta.url), "utf8");
    const install = src.indexOf("  resetDrawsOnBufferSwap(Geometry.prototype as never);");
    const made = src.indexOf("    const engine = new WebGPUEngine(canvas, {");
    const stood = src.indexOf("    const engine = await Promise.race([starting, deadline]);");
    const fast = src.indexOf("    engine.compatibilityMode = false;");
    expect(install).toBeGreaterThan(0);
    expect(install).toBeLessThan(made);
    expect(fast).toBeGreaterThan(src.indexOf('    installPipelines(engine, options.pipelines ?? "async");', stood));
  });
});
