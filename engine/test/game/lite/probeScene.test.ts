import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { sourceText } from "../../helpers/source.js";

describe("the page's probe on the hike's own renderer", () => {
  it("imports nothing of a game's: it stands in the engine, and every import of its source is of a neighbour there: the engine's half", () => {
    const specs = [...sourceText("game/lite/probeScene.ts").matchAll(/^\s*(?:import|export)\s[^;]*?\bfrom\s+["']([^"']+)["']|^\s*import\s+["']([^"']+)["']/gm)].map((m) => (m[1] ?? m[2]) as string);
    expect(specs.length).toBeGreaterThan(0);
    expect(existsSync(fileURLToPath(new URL("../../../src/game/lite/probeScene.ts", import.meta.url)))).toBe(true);
    // Relative, and so inside the engine's package, where no module may import a game's (`architecture.test.ts`).
    expect(specs.filter((spec) => !spec.startsWith("."))).toEqual([]);
    expect(specs.filter((spec) => /client|@csarkosh/.test(spec))).toEqual([]);
  });
});
