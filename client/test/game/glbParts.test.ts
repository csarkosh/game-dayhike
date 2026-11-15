import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { glbEmissive, glbParts } from "../../src/game/glbParts.js";

const MODELS = join(import.meta.dirname, "../../assets/models");

/** A shipped model's bytes, as a page fetches them. */
function model(name: string): ArrayBuffer {
  const bytes = readFileSync(join(MODELS, name));
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

/** A binary glTF made of `json` and `bin`, each chunk padded to four bytes. */
function glb(json: unknown, bin: Uint8Array): ArrayBuffer {
  const text = new TextEncoder().encode(JSON.stringify(json));
  const jsonLength = Math.ceil(text.length / 4) * 4;
  const binLength = Math.ceil(bin.length / 4) * 4;
  const out = new Uint8Array(12 + 8 + jsonLength + 8 + binLength);
  const view = new DataView(out.buffer);
  view.setUint32(0, 0x46546c67, true);
  view.setUint32(4, 2, true);
  view.setUint32(8, out.length, true);
  view.setUint32(12, jsonLength, true);
  view.setUint32(16, 0x4e4f534a, true);
  out.fill(0x20, 20, 20 + jsonLength);
  out.set(text, 20);
  view.setUint32(20 + jsonLength, binLength, true);
  view.setUint32(24 + jsonLength, 0x004e4942, true);
  out.set(bin, 28 + jsonLength);
  return out.buffer;
}

describe("what a model's file says of a named node's primitives", () => {
  it("is the giant fir's crown and bark at each LOD: tangents a vertex, the crown alpha-tested, each with its file's specular weight", () => {
    const file = model("tree.giant_fir.glb");
    for (const lod of ["LOD0", "LOD1", "LOD2"]) {
      const parts = glbParts(file, lod);
      expect(parts.map((p) => p.material), lod).toEqual(["tree.giant_fir.material1", "tree.giant_fir.material0"]);
      const [crown, bark] = parts as [(typeof parts)[number], (typeof parts)[number]];
      expect(crown.alphaMask).toBe(true);
      expect(crown.alphaCutoff).toBe(0.5);
      expect(crown.specularWeight).toBe(0);
      expect(bark.alphaMask).toBe(false);
      expect(bark.specularWeight).toBeCloseTo(0.0468, 4);
      for (const part of parts) {
        expect(part.doubleSided).toBe(true);
        expect(part.ior).toBeCloseTo(1.45, 6);
        expect(part.vertices).toBeGreaterThan(0);
        expect(part.tangents).toHaveLength(part.vertices * 4);
        // A tangent is a unit vector and a handedness of one or minus one.
        const t = part.tangents as Float32Array;
        expect(Math.hypot(t[0] as number, t[1] as number, t[2] as number)).toBeCloseTo(1, 3);
        expect(Math.abs(t[3] as number)).toBe(1);
      }
    }
    // A coarser LOD has fewer vertices.
    expect((glbParts(file, "LOD2")[0] as { vertices: number }).vertices).toBeLessThan((glbParts(file, "LOD0")[0] as { vertices: number }).vertices);
  });

  it("says a file gives no specular weight and no index of refraction where it carries neither: the alder and the snag", () => {
    for (const part of glbParts(model("tree.alder.glb"), "LOD1")) {
      expect(part.specularWeight).toBeNull();
      expect(part.ior).toBeNull();
    }
    const alder = glbParts(model("tree.alder.glb"), "LOD1");
    expect(alder.map((p) => p.alphaMask)).toEqual([true, false]);
    const snag = glbParts(model("deadwood.snag.glb"), "LOD1");
    expect(snag).toHaveLength(1);
    expect(snag[0]).toMatchObject({ material: "deadwood.snag.material0", alphaMask: false, doubleSided: true, specularWeight: null, ior: null });
  });

  it("has no parts for a node the file does not name", () => {
    expect(glbParts(model("deadwood.snag.glb"), "LOD7")).toEqual([]);
  });

  it("walks a node's children before its own mesh, reads a strided accessor, and leaves a primitive without tangents as it is", () => {
    // Two vec4 tangents in a view strided at 20 bytes, behind 4 bytes of other data.
    const bin = new Uint8Array(4 + 40);
    const floats = new DataView(bin.buffer);
    [0, 1, 0, 1].forEach((v, k) => floats.setFloat32(4 + k * 4, v, true));
    [1, 0, 0, -1].forEach((v, k) => floats.setFloat32(4 + 20 + k * 4, v, true));
    const file = glb({
      nodes: [
        { name: "trunk", mesh: 0, children: [1] },
        { name: "twig", mesh: 1 },
      ],
      meshes: [
        { primitives: [{ attributes: { POSITION: 1 }, material: 0 }] },
        { primitives: [{ attributes: { POSITION: 1, TANGENT: 0 } }] },
      ],
      materials: [{ name: "wood", alphaMode: "MASK", alphaCutoff: 0.3 }],
      accessors: [
        { bufferView: 0, componentType: 5126, count: 2, type: "VEC4" },
        { componentType: 5126, count: 2, type: "VEC3" },
      ],
      bufferViews: [{ buffer: 0, byteOffset: 4, byteLength: 40, byteStride: 20 }],
    }, bin);
    const parts = glbParts(file, "trunk");
    expect(parts).toHaveLength(2);
    // The child's primitive first: it names no material and has the tangents.
    expect(parts[0]).toMatchObject({ material: null, alphaMask: false, alphaCutoff: 0.5, doubleSided: false, vertices: 2 });
    expect([...(parts[0] as { tangents: Float32Array }).tangents]).toEqual([0, 1, 0, 1, 1, 0, 0, -1]);
    expect(parts[1]).toMatchObject({ material: "wood", alphaMask: true, alphaCutoff: 0.3, tangents: null, vertices: 2 });
  });

  it("refuses bytes that are not a binary glTF", () => {
    expect(() => glbParts(new ArrayBuffer(64), "LOD0")).toThrow(/not a binary glTF/);
  });
});

describe("what a model's materials give off, read from its file", () => {
  it("names the Hollow's eyes as the one material that glows, and no ranger's", () => {
    const hollow = glbEmissive(model("hollow.antlered.glb"));
    expect([...hollow.keys()].sort()).toEqual(["hollow.antlered.material0", "hollow.antlered.material1"]);
    expect(hollow.get("hollow.antlered.material0")).toEqual([0, 0, 0]);
    expect(hollow.get("hollow.antlered.material1")).toEqual([1, 0, 0]);
    for (const [, emissive] of glbEmissive(model("ranger.nathan.glb"))) expect(emissive).toEqual([0, 0, 0]);
  });
});
