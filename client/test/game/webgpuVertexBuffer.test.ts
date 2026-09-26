import { readdirSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { NullEngine } from "@babylonjs/core/Engines/nullEngine.js";
import { Buffer, type VertexBuffer } from "@babylonjs/core/Buffers/buffer.js";
import { OFFSET_HASH_SHIFT, offsetKeyedVertexBuffer } from "../../src/game/webgpuVertexBuffer.js";

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

  it("still keys an attribute's vertex state by that hash and its location only", () => {
    const src = readFileSync(require.resolve("@babylonjs/core/Engines/WebGPU/webgpuCacheRenderPipeline.js"), "utf8");
    expect(src).toContain("const vid = vertexBuffer.hashCode + (location << 7);");
    // A plain array, so a key above 2^31 (the workaround's) is kept exactly.
    expect(src).toContain("this._states = new Array(30);");
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
