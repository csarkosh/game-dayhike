import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

/**
 * The hike's own half of where the signs and the body are built, read from its source: the extras'
 * build and dispose are in `hike.ts`, where a variable of `app.ts` is written `h.<name>`. The sessions'
 * starts, in `app.ts`, are read by the engine's own suite (`test/game/appExtras.test.ts` in the engine's repository).
 */
const hikeSrc = readFileSync(fileURLToPath(new URL("../../src/hike.ts", import.meta.url)), "utf8");
const slice = (from: string, to: string, text: string): string => text.slice(text.indexOf(from), text.indexOf(to, text.indexOf(from)));

describe("the signs and the body of a hike the film covers", () => {
  it("are built only for the hike and the renderer that asked, and only where nothing built them meanwhile", () => {
    // The hike says whether any are built: the signs or the body.
    expect(hikeSrc).toContain("extrasStand: (): boolean => signs !== null || body !== null,");
  });

  it("are built in the scene of the renderer they are asked for, which under a swap is not yet the one running", () => {
    // `hikeScenery.ts` builds each into the renderer it is handed: `r`, never the hike's `renderer` binding.
    expect(slice("  function buildExtras(r: Renderer): void {", "  function disposeExtras(): void {", hikeSrc)).toContain(
      "    signs = createHikeSigns(r, h.activeWorld, h.seed);\n    fetchFilmCar(r);\n    body = h.activeWorld.search === null ? null : createHikeBody(r, h.activeWorld.search.body);",
    );
    expect(slice("  function fetchFilmCar(r: Renderer): void {", "  /** What the end scene is played over", hikeSrc)).toContain("loadFilmCar(r, signs, loads.signal);");
  });

  it("are not built by a task still to come once they are disposed: a swap builds its own, and a hike left builds none", () => {
    const dispose = slice("  function disposeExtras(): void {", "  h.made(disposeExtras);", hikeSrc);
    expect(dispose).toContain("    h.extrasToCome?.cancel();\n    h.extrasToCome = null;");
    expect(slice("  function disposeHike(): void {", "  /**\n   * The hike as a session starts it", hikeSrc)).toContain("    disposeExtras();");
  });
});
