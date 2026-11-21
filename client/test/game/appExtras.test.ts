import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

/**
 * `app.ts` builds the peer-to-peer networking and a WebGPU renderer, so nothing here can start a hike under
 * Node: where the signs and the body are built is read from the source, as `appSky.test.ts` reads the sky's.
 * The sessions' starts are in `app.ts`, which calls the hike's own half as `hike.<name>`; the extras'
 * build and dispose are in `hike.ts`, where a variable of `app.ts` is written `h.<name>`.
 * How a build is put off is `extrasLater.test.ts`'s.
 */
const src = readFileSync(fileURLToPath(new URL("../../src/app.ts", import.meta.url)), "utf8");
const hikeSrc = readFileSync(fileURLToPath(new URL("../../src/hike.ts", import.meta.url)), "utf8");
const slice = (from: string, to: string, text: string = src): string => text.slice(text.indexOf(from), text.indexOf(to, text.indexOf(from)));

describe("the signs and the body of a hike the film covers", () => {
  it("are built by the host in a task after the build where the start has a loader of first builds, and in place where it has none", () => {
    const host = slice("  function runAsHost(): void {", "  async function runAsClient(");
    expect(host).toContain("    if (firstBuilds === undefined) hike.buildExtras(renderer);\n    else extrasToCome = extrasLater({");
    expect(host.match(/\bbuildExtras\(/g)).toHaveLength(2);
    // The one the task builds for is the renderer that stood when it was asked.
    expect(host).toContain("build: () => hike.buildExtras(asked),");
  });

  it("are built only for the hike and the renderer that asked, and only where nothing built them meanwhile", () => {
    const host = slice("  function runAsHost(): void {", "  async function runAsClient(");
    expect(host).toContain("still: () => !disposed && !broken && renderer === asked && hike.signs === null && hike.body === null,");
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
    // The swap's bindings and the handle's dispose both go through it.
    expect(src).toContain("    extras: { dispose: hike.disposeExtras, build: hike.buildExtras },");
    // The handle's dispose lets go of the hike's own through one function of the hike's (`disposeHike`), which goes through it.
    expect(src.slice(src.lastIndexOf("    dispose() {\n      disposed = true;"))).toContain("hike.disposeHike();");
    expect(slice("  function disposeHike(): void {", "  /**\n   * The hike as a session starts it", hikeSrc)).toContain("    disposeExtras();");
  });

  it("are a follower's as they were: built in its own continuation, once its world is in", () => {
    const client = slice("  async function runAsClient(", "  if (lobby === null || lobby.state.role === \"host\") {");
    expect(client).toContain("    activeWorld = client.world;\n    hike.buildExtras(renderer);");
    expect(client).not.toContain("extrasLater(");
  });
});
