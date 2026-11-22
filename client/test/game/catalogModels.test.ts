import { describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";

import { catalog } from "../helpers/catalogs.js";
import { glbOutline } from "@csarkosh/engine/game/glbParts";
import { babylonValues } from "../helpers/babylonFixture.js";

type Entry = { id: string; kind: string; output: string; animations?: Record<string, string> };
const ENTRIES = catalog.assets as Entry[];

/** Kinds whose models the game streams by LOD root name (clutter, forest and wildlife fields). */
const LOD_KINDS = new Set(["prop", "environment"]);

/** A shipped model's bytes, as a page fetches them. */
function model(output: string): { bytes: Buffer; file: ArrayBuffer } {
  const own = new URL(`../../assets/${output}`, import.meta.url);
  const bytes = readFileSync(existsSync(own) ? own : new URL(`../../../engine/assets/${output}`, import.meta.url));
  return { bytes, file: bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer };
}

/**
 * Every model the catalog lists is a binary glTF the game's own reader takes, has geometry, holds every clip its
 * catalog entry names, and — for LOD-streamed kinds — has `LOD0` and `LOD1` roots. Enemies never spawn in normal
 * play today, so this is the only place their clips are held to their files.
 */
describe("every catalog model", () => {
  for (const entry of ENTRIES) {
    it(`${entry.id} loads with its clips and LOD roots`, () => {
      const outline = glbOutline(model(entry.output).file);
      expect(outline.vertices).toBeGreaterThan(0);
      for (const clip of Object.values(entry.animations ?? {})) expect(outline.clips).toContain(clip);
      if (LOD_KINDS.has(entry.kind)) {
        expect(outline.nodes).toContain("LOD0");
        expect(outline.nodes).toContain("LOD1");
      }
    });
  }
});

/**
 * What Babylon.js's loader read of each model, recorded with the file's length and SHA-256: its animation groups'
 * names, the vertices of its meshes in all, and whether it found a node named `LOD0` or `LOD1`.
 */
const LOADER = babylonValues<Record<string, { bytes: number; sha256: string; clips: string[]; vertices: number; lod0: boolean; lod1: boolean }>>("numbers/catalogModels.json");
const RECORDED = Object.entries(LOADER).filter(([id]) => id !== "from");

describe("the game's reader of a model's file, against Babylon.js's loader as recorded", () => {
  it("was recorded for the forty-four models the catalog listed, each of which it still lists", () => {
    expect(RECORDED).toHaveLength(44);
    for (const [id] of RECORDED) expect(ENTRIES.some((entry) => entry.id === id), id).toBe(true);
  });

  it("reads of each file what the loader read of it: its clips in order, its vertices, its LOD roots", () => {
    for (const [id, loader] of RECORDED) {
      const entry = ENTRIES.find((e) => e.id === id) as Entry;
      const { bytes, file } = model(entry.output);
      // The comparison is with the file the loader read. A model made again is no longer that file: take its row
      // out of the record, and the reader alone holds it above.
      expect([bytes.length, createHash("sha256").update(bytes).digest("hex")], `${id} is the file the loader was recorded reading`).toEqual([loader.bytes, loader.sha256]);
      const outline = glbOutline(file);
      expect(outline.clips, `${id} clips`).toEqual(loader.clips);
      expect(outline.vertices, `${id} vertices`).toBe(loader.vertices);
      expect([outline.nodes.includes("LOD0"), outline.nodes.includes("LOD1")], `${id} roots`).toEqual([loader.lod0, loader.lod1]);
    }
  });

  it("holds what the loader read to the catalog as the reader's is held: geometry, each named clip, both roots where streamed by LOD", () => {
    for (const [id, loader] of RECORDED) {
      const entry = ENTRIES.find((e) => e.id === id) as Entry;
      expect(loader.vertices, id).toBeGreaterThan(0);
      for (const clip of Object.values(entry.animations ?? {})) expect(loader.clips, id).toContain(clip);
      if (LOD_KINDS.has(entry.kind)) expect([loader.lod0, loader.lod1], id).toEqual([true, true]);
    }
  });
});
