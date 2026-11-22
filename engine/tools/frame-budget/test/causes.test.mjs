import { describe, expect, it } from "vitest";
import { CAUSES, causeOf, stopsByCause } from "../lib/causes.mjs";

const frame = (id, functionName, url = "") => ({ id, callFrame: { functionName, url, lineNumber: 0, columnNumber: 0 } });
const NODES = {
  root: frame(1, "(root)"),
  olympic: frame(2, "a", "https://x/assets/index-abc.js"),
  babylon: frame(3, "b", "https://x/assets/pbr-renderable-def.js"),
  link: frame(4, "getProgramParameter"),
  tex: frame(5, "texImage2D"),
  idle: frame(6, "(idle)"),
};
// What the report's maps would say of a frame: its name and source, or null for a native call.
const SOURCES = new Map([[NODES.olympic.callFrame, "olympicSample src/sim/olympic.ts:778"], [NODES.babylon.callFrame, "buildPipeline babylon-lite/index.js:1718"]]);
const sourceOf = (c) => SOURCES.get(c) ?? null;
// 40 ms sampling the world, 30 ms in a link, 20 ms in an upload, 50 ms idle, then 10 ms more sampling.
const SAMPLES = {
  ids: [2, 4, 5, 6, 2, 1],
  at: [1000, 1040, 1070, 1090, 1140, 1150],
  nodes: new Map(Object.values(NODES).map((n) => [n.id, n])),
  parent: new Map([[2, 1], [3, 1], [4, 3], [5, 3], [6, 1]]),
};

describe("a page stop's causes", () => {
  it("names a sample by its own source, and a native call by what it is", () => {
    expect(causeOf(NODES.olympic.callFrame, [], sourceOf)).toBe("world sampling (src/sim)");
    expect(causeOf(NODES.link.callFrame, [NODES.babylon.callFrame], sourceOf)).toBe("shader links");
    expect(causeOf(NODES.tex.callFrame, [NODES.babylon.callFrame], sourceOf)).toBe("texture uploads");
    expect(causeOf(NODES.idle.callFrame, [], sourceOf)).toBeNull();
    expect(causeOf({ functionName: "(garbage collector)", url: "" }, [], sourceOf)).toBe("garbage collection");
  });
  it("tells the game's own builders apart by their file", () => {
    const named = (source) => causeOf({ functionName: "f", url: "u" }, [], () => source);
    expect(named("r src/game/forestField.ts:498")).toBe("forest and ground cover (src/game)");
    expect(named("update src/game/clipmap.ts:261")).toBe("terrain and water (src/game)");
    expect(named("sync src/game/lite/renderer.ts:3160")).toBe("other game code");
    expect(named("fill src/game/lite/terrainMeshes.ts:508")).toBe("terrain and water (src/game)");
    expect(named("cut src/game/lite/bladeMeshes.ts:120")).toBe("forest and ground cover (src/game)");
    expect(named("renderFrame babylon-lite/index.js:3806")).toBe("Babylon Lite");
    expect(named("renderFrame ../node_modules/@babylonjs/lite/index.js:3806")).toBe("Babylon Lite");
  });
  it("gives an unknown native call its nearest caller's cause", () => {
    expect(causeOf({ functionName: "getError", url: "" }, [NODES.babylon.callFrame], sourceOf)).toBe("Babylon Lite");
  });
  it("falls back to other when there are no maps", () => {
    expect(causeOf(NODES.olympic.callFrame, [], () => null)).toBe("other");
  });
  it("only names causes it lists", () => {
    for (const c of ["world sampling (src/sim)", "shader links", "texture uploads", "Babylon Lite", "garbage collection", "other"]) expect(CAUSES).toContain(c);
  });
  it("sums the time inside the stops by cause, leaving out idle and what is outside them", () => {
    const { ms, total } = stopsByCause(SAMPLES, [[1000, 1140]], sourceOf);
    expect(ms.get("world sampling (src/sim)")).toBeCloseTo(40, 5);
    expect(ms.get("shader links")).toBeCloseTo(30, 5);
    expect(ms.get("texture uploads")).toBeCloseTo(20, 5);
    expect(total).toBeCloseTo(90, 5);
  });
});
