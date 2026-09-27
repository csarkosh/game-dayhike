import { readdirSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NullEngine } from "@babylonjs/core/Engines/nullEngine.js";
import { Buffer, type VertexBuffer } from "@babylonjs/core/Buffers/buffer.js";
import { Scene } from "@babylonjs/core/scene.js";
import { Mesh } from "@babylonjs/core/Meshes/mesh.js";
import { CreateBox } from "@babylonjs/core/Meshes/Builders/boxBuilder.js";
import type { Material } from "@babylonjs/core/Materials/material.js";
import { PBRMaterial } from "@babylonjs/core/Materials/PBR/pbrMaterial.js";
import "../../src/sim/passes/index.js";
import { CLUTTER_CLASS_COUNT, CLUTTER_GRASS } from "../../src/sim/clutter.js";
import { elevationSampleAt } from "../../src/sim/terrain.js";
import { createBladeMeshes } from "../../src/game/bladeMeshes.js";
import { createClutterMeshes } from "../../src/game/clutterMeshes.js";
import type { CullPose } from "../../src/game/grassCull.js";
import { OFFSET_HASH_SHIFT, offsetKeyedVertexBuffer } from "../../src/game/webgpuVertexBuffer.js";
import { timeLimit } from "../helpers/timeLimit.js";

const require = createRequire(import.meta.url);
let engine: NullEngine;
let buffer: Buffer;
beforeEach(() => {
  engine = new NullEngine();
  // 24 vertices, 8 floats each: two vec4 attributes interleaved.
  buffer = new Buffer(engine, new Float32Array(24 * 8), true, 8);
});
afterEach(() => engine.dispose());

describe("Babylon's WebGPU pipeline cache (canaries: when one fails, a fixed Babylon is installed; remove the workaround and its callers in the upgrade's own commit)", () => {
  it("still hashes two vertex buffers alike when only their offset differs", () => {
    const a = buffer.createVertexBuffer("tint", 0, 4);
    const b = buffer.createVertexBuffer("tint", 4, 4);
    expect([a.byteOffset, b.byteOffset]).toEqual([0, 16]);
    expect(a.hashCode).toBe(b.hashCode);
  });

  it("still keys an attribute's vertex state by that hash and its location only, one state entry each", () => {
    const src = readFileSync(require.resolve("@babylonjs/core/Engines/WebGPU/webgpuCacheRenderPipeline.js"), "utf8");
    // The whole key block, so that any change to how the key is built fails
    // here, the fix the draft upstream issue suggests included (it keeps the
    // `vid` line and adds a second entry after it).
    const block = [
      "            const vid = vertexBuffer.hashCode + (location << 7);",
      "            this._isDirty = this._isDirty || this._states[newNumStates] !== vid;",
      "            this._states[newNumStates++] = vid;",
      "        }",
      "        this.vertexBuffers.length = numVertexBuffers;",
      "",
    ].join("\n");
    expect(src).toContain(block);
    const suggested = src.replace(
      "            this._states[newNumStates++] = vid;\n",
      "            this._states[newNumStates++] = vid;\n            this._states[newNumStates++] = oid;\n",
    );
    expect(suggested).not.toContain(block);
  });

  it("still looks a key up as a plain object's property, exact for any integer below 2^53", () => {
    // The engine walks the tree cache, and each node keys its children by the
    // state value on a plain object: ToString of an integer is exact and
    // unique, however far above 2^32 the workaround's keys go. An int32 hash
    // here would truncate them.
    const resolve = require.resolve;
    const engineSrc = readFileSync(resolve("@babylonjs/core/Engines/webgpuEngine.pure.js"), "utf8");
    expect(engineSrc).toContain("this._cacheRenderPipeline = new WebGPUCacheRenderPipelineTree(this._device, this._emptyVertexBuffer);");
    const tree = readFileSync(resolve("@babylonjs/core/Engines/WebGPU/webgpuCacheRenderPipelineTree.js"), "utf8");
    expect(tree).toContain("        this.values = {};");
    expect(tree).toContain("            let nn = node.values[this._states[i]];");
    expect(tree).toContain("                node.values[this._states[i]] = nn;");
  });

  it("still recomputes the hash by assigning the public hashCode, from the constructor and the divisor setter only", () => {
    const src = readFileSync(require.resolve("@babylonjs/core/Buffers/buffer.pure.js"), "utf8");
    // The workaround's accessor catches exactly this assignment.
    expect(src).toContain("    _computeHashCode() {\n        // note: cast to any because the property is declared readonly\n        this.hashCode =");
    expect(src).not.toMatch(/_hashCode\b/);
    expect(src.match(/this\._computeHashCode\(\);/g)).toHaveLength(2);
    expect(src).toContain("if (isInstanced !== this._instanced) {\n            this._instanced = isInstanced;\n            this._computeHashCode();");
  });
});

describe("offsetKeyedVertexBuffer", () => {
  it("keys its hash by the byte offset, above the stride's bits", () => {
    expect(OFFSET_HASH_SHIFT).toBe(16_777_216);
    const a = offsetKeyedVertexBuffer(buffer, "tint", 0, 4);
    const b = offsetKeyedVertexBuffer(buffer, "tint", 4, 4);
    expect(b.hashCode - a.hashCode).toBe(268_435_456);
  });

  it("makes the vertex buffer Babylon would, on the shared buffer", () => {
    const b = offsetKeyedVertexBuffer(buffer, "tint", 4, 4, true);
    expect(b.getKind()).toBe("tint");
    expect([b.byteOffset, b.byteStride, b.getSize()]).toEqual([16, 32, 4]);
    expect(b.getIsInstanced()).toBe(true);
    expect(b.getWrapperBuffer()).toBe(buffer);
  });

  it("keeps the offset term when Babylon recomputes the hash", () => {
    const b = offsetKeyedVertexBuffer(buffer, "tint", 4, 4);
    b.instanceDivisor = 1; // the setter recomputes the hash when instancing flips
    const plain = buffer.createVertexBuffer("tint", 4, 4, undefined, true);
    expect(b.hashCode - plain.hashCode).toBe(268_435_456);
  });

  it("keeps two offsets apart after every path that recomputes or rebinds the hash", () => {
    // Two keyed buffers at offsets 0 and 16 bytes, and a plain one beside
    // them, each taken down the same paths in turn.
    const a = offsetKeyedVertexBuffer(buffer, "tint", 0, 4);
    const b = offsetKeyedVertexBuffer(buffer, "tint", 4, 4);
    const plain = buffer.createVertexBuffer("tint", 4, 4);
    const paths: [string, (vb: VertexBuffer) => void][] = [
      ["as made", () => undefined],
      ["instanced by the divisor setter", (vb) => void (vb.instanceDivisor = 1)],
      ["the divisor changed while instanced", (vb) => void (vb.instanceDivisor = 3)],
      ["un-instanced by the divisor setter", (vb) => void (vb.instanceDivisor = 0)],
      ["the hash recomputed directly", (vb) => (vb as unknown as { _computeHashCode(): void })._computeHashCode()],
      ["the hash assigned outright", (vb) => void ((vb as unknown as { hashCode: number }).hashCode = plain.hashCode)],
      ["the data updated", (vb) => vb.update(new Float32Array(24 * 8))],
      ["the data made again", (vb) => vb.create(new Float32Array(24 * 8))],
      ["instanced again", (vb) => void (vb.instanceDivisor = 2)],
    ];
    const seen: [string, number, number, boolean][] = [];
    for (const [name, step] of paths) {
      step(plain);
      step(a);
      step(b);
      seen.push([name, a.hashCode - plain.hashCode, b.hashCode - plain.hashCode, a.hashCode !== b.hashCode]);
    }
    expect(seen).toEqual([
      ["as made", 0, 268_435_456, true],
      ["instanced by the divisor setter", 0, 268_435_456, true],
      ["the divisor changed while instanced", 0, 268_435_456, true],
      ["un-instanced by the divisor setter", 0, 268_435_456, true],
      ["the hash recomputed directly", 0, 268_435_456, true],
      ["the hash assigned outright", 0, 268_435_456, true],
      ["the data updated", 0, 268_435_456, true],
      ["the data made again", 0, 268_435_456, true],
      ["instanced again", 0, 268_435_456, true],
    ]);
    // The plain one's hash did change along the way: the paths are real.
    const fresh = buffer.createVertexBuffer("tint", 4, 4);
    const instanced = buffer.createVertexBuffer("tint", 4, 4, undefined, true);
    expect(instanced.hashCode - fresh.hashCode).toBe(64);
  });

  it("is the only way the game makes a vertex buffer over a shared buffer", () => {
    const src = fileURLToPath(new URL("../../src", import.meta.url));
    const files = (dir: string): string[] =>
      readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
        e.isDirectory() ? files(join(dir, e.name)) : e.name.endsWith(".ts") ? [join(dir, e.name)] : [],
      );
    const all = files(src);
    expect(all.length).toBeGreaterThan(20);
    const own = join(src, "game", "webgpuVertexBuffer.ts");
    const others = all.filter((f) => f !== own && /createVertexBuffer\(|new VertexBuffer\(/.test(readFileSync(f, "utf8")));
    expect(others).toEqual([]);
    expect(readFileSync(own, "utf8")).toContain("createVertexBuffer(");
  });
});

/**
 * The grass cull (`grassCull.ts`) rewrites the blade and grass-card buffers
 * every few frames. Babylon makes their vertex buffers itself, in
 * `thinInstanceSetBuffer`: the matrix as one buffer read as `world0`–`world3`
 * at 0, 16, 32 and 48 bytes, every other kind its own buffer at 0. So the
 * meshes of one material bind each kind at one offset, the offset-blind
 * pipeline key cannot mix two of them up, and while the shells hand Babylon
 * plain arrays none needs `offsetKeyedVertexBuffer`. The cull's prefix uploads
 * write into those vertex buffers in place; the shells' context-restore
 * observers hand their buffers back through `thinInstanceSetBuffer`, which
 * makes new ones the same way. (The tests fire those observers directly, so
 * Babylon's own buffer rebuild on a real restore is not exercised here.)
 *
 * Each test asserts the property first (no material's meshes bind a kind at
 * two offsets), then pins today's layout as literals. A GPU-driven
 * interleaved blade layout replaces that pin, and must move the bucket-growth
 * path (`applyGrown` in `bladeMeshes.ts`) onto `offsetKeyedVertexBuffer` in the
 * same change: growth replaces the buffers through `thinInstanceSetBuffer`,
 * and it runs on WebGPU.
 */
describe("the grass cull's thin-instance buffers", () => {
  const SEED = 1;
  const CAM = { x: 35, z: 21335 };
  const POSE: CullPose = {
    x: CAM.x, y: elevationSampleAt(SEED, CAM.x, CAM.z).h + 1.6, z: CAM.z, yaw: 1.571, pitch: 0.3, roll: 0, fov: 1.4, aspect: 1200 / 2029,
  };
  /** Past the cull's turn threshold, so every culled bucket cuts again. */
  const TURNED: CullPose = { ...POSE, yaw: POSE.yaw + 1 };

  /** Every thin-instanced mesh's vertex buffer of each kind it binds. */
  function bound(meshes: readonly Mesh[], kinds: readonly string[]): VertexBuffer[] {
    return meshes.flatMap((m) => kinds.map((k) => m.getVertexBuffer(k)).filter((vb): vb is VertexBuffer => vb != null));
  }
  /** Each kind's byte offsets across every mesh that binds it. */
  function offsets(meshes: readonly Mesh[], kinds: readonly string[]): Record<string, number[]> {
    const out: Record<string, number[]> = {};
    for (const k of kinds) {
      const seen = new Set(meshes.map((m) => m.getVertexBuffer(k)).filter((vb): vb is VertexBuffer => vb != null).map((vb) => vb.byteOffset));
      if (seen.size > 0) out[k] = [...seen].sort((a, b) => a - b);
    }
    return out;
  }
  /** Every material whose meshes bind one kind at more than one offset, as
   * `material kind: offsets`: the case the pipeline key gets wrong. */
  function mixedOffsets(meshes: readonly Mesh[], kinds: readonly string[]): string[] {
    const byMaterial = new Map<Material | null, Mesh[]>();
    for (const m of meshes) byMaterial.set(m.material, [...(byMaterial.get(m.material) ?? []), m]);
    const out: string[] = [];
    for (const [material, group] of byMaterial) {
      for (const [k, at] of Object.entries(offsets(group, kinds))) if (at.length > 1) out.push(`${material?.name ?? "none"} ${k}: ${at.join(",")}`);
    }
    return out;
  }
  function materials(meshes: readonly Mesh[]): number {
    return new Set(meshes.map((m) => m.material)).size;
  }
  function kept(before: readonly VertexBuffer[], after: readonly VertexBuffer[]): number {
    return after.filter((vb) => before.includes(vb)).length;
  }

  it("binds each blade kind at one offset, and cuts into the same vertex buffers", () => {
    const scene = new Scene(engine);
    const blades = createBladeMeshes(scene, SEED, { quality: "high" });
    try {
      const kinds = ["world0", "world1", "world2", "world3", "foliage", "bladeStrength"];
      blades.update(CAM.x, CAM.z);
      blades.cull(POSE);
      const meshes = blades.meshes.filter((m) => m.getVertexBuffer("world0") != null);
      expect(meshes.length).toBe(26);
      expect(materials(meshes)).toBe(3);
      // The property: one offset per kind within each material.
      expect(mixedOffsets(meshes, kinds)).toEqual([]);
      // The pin of today's layout, which a layout change revises.
      const want = { world0: [0], world1: [16], world2: [32], world3: [48], foliage: [0], bladeStrength: [0] };
      expect(offsets(meshes, kinds)).toEqual(want);
      const before = bound(meshes, kinds);
      expect(before.length).toBe(156);
      const partial = vi.spyOn(Mesh.prototype, "thinInstancePartialBufferUpdate");
      blades.cull(TURNED);
      expect(partial.mock.calls.length).toBeGreaterThan(0);
      expect(kept(before, bound(meshes, kinds))).toBe(156);
      // The shells' restore observers re-hand the full buffers: new vertex
      // buffers, the same offsets.
      engine.onContextRestoredObservable.notifyObservers(engine);
      blades.cull(POSE);
      expect(kept(before, bound(meshes, kinds))).toBe(0);
      expect(mixedOffsets(meshes, kinds)).toEqual([]);
      expect(offsets(meshes, kinds)).toEqual(want);
    } finally {
      vi.restoreAllMocks();
      blades.dispose();
    }
  }, timeLimit(60_000));

  it("binds each grass-card kind at one offset, and cuts into the same vertex buffers", () => {
    const scene = new Scene(engine);
    const assets: Mesh[][][][] = [];
    for (let cls = 0; cls < CLUTTER_CLASS_COUNT; cls++) {
      assets.push([0, 1].map((variant) => {
        const material = new PBRMaterial(`vb-c${cls}v${variant}`, scene);
        material.transparencyMode = PBRMaterial.PBRMATERIAL_ALPHATEST;
        return [0, 1].map((lod) => {
          const mesh = CreateBox(`vb-c${cls}v${variant}l${lod}`, { size: 0.5 }, scene);
          mesh.material = material;
          return [mesh];
        });
      }));
    }
    const clutter = createClutterMeshes(scene, SEED, { assets, nearBlades: true, cull: true });
    try {
      const kinds = ["world0", "world1", "world2", "world3", "fadeBands", "foliage"];
      clutter.update(CAM.x, CAM.z);
      clutter.cull(POSE);
      const grass = scene.meshes.filter((m): m is Mesh => m instanceof Mesh && m.name.startsWith(`vb-c${CLUTTER_GRASS}v`) && m.getVertexBuffer("world0") != null);
      expect(grass.length).toBe(4);
      const all = scene.meshes.filter((m): m is Mesh => m instanceof Mesh && m.getVertexBuffer("world0") != null);
      expect(materials(grass)).toBe(2);
      // The property, on the grass cards and on every thin-instanced clutter
      // mesh, culled or not: one offset per kind within each material.
      expect(mixedOffsets(grass, kinds)).toEqual([]);
      expect(mixedOffsets(all, kinds)).toEqual([]);
      // The pin of today's layout, which a layout change revises.
      const want = { world0: [0], world1: [16], world2: [32], world3: [48], fadeBands: [0], foliage: [0] };
      expect(offsets(grass, kinds)).toEqual(want);
      expect(offsets(all, kinds)).toEqual(want);
      const before = bound(grass, kinds);
      expect(before.length).toBe(24);
      const partial = vi.spyOn(Mesh.prototype, "thinInstancePartialBufferUpdate");
      clutter.cull(TURNED);
      expect(partial.mock.calls.length).toBeGreaterThan(0);
      expect(kept(before, bound(grass, kinds))).toBe(24);
      // The shells' restore observers, as for the blades.
      engine.onContextRestoredObservable.notifyObservers(engine);
      clutter.cull(POSE);
      expect(kept(before, bound(grass, kinds))).toBe(0);
      expect(mixedOffsets(grass, kinds)).toEqual([]);
      expect(offsets(grass, kinds)).toEqual(want);
    } finally {
      vi.restoreAllMocks();
      clutter.dispose();
    }
  }, timeLimit(60_000));
});
