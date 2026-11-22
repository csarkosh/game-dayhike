import { describe, expect, it } from "vitest";
import { sourceText } from "../helpers/source.js";

/**
 * `app.ts` builds the peer-to-peer networking and a WebGPU renderer, so nothing here can start a hike under
 * Node: where the signs and the body are built is read from the source, as `appSky.test.ts` reads the sky's.
 * The sessions' starts are in `app.ts`, which calls the hike's own half as `side.<name>`.
 * How a build is put off is `extrasLater.test.ts`'s.
 */
const src = sourceText("app.ts");
const slice = (from: string, to: string, text: string = src): string => text.slice(text.indexOf(from), text.indexOf(to, text.indexOf(from)));

describe("the signs and the body of a hike the film covers", () => {
  it("are built by the host in a task after the build where the start has a loader of first builds, and in place where it has none", () => {
    const host = slice("  function runAsHost(): void {", "  async function runAsClient(");
    expect(host).toContain("    if (firstBuilds === undefined) side.buildExtras(renderer);\n    else extrasToCome = extrasLater({");
    expect(host.match(/\bbuildExtras\(/g)).toHaveLength(2);
    // The one the task builds for is the renderer that stood when it was asked.
    expect(host).toContain("build: () => side.buildExtras(asked),");
  });

  it("are built only for the hike and the renderer that asked, and only where nothing built them meanwhile: the engine's half", () => {
    const host = slice("  function runAsHost(): void {", "  async function runAsClient(");
    expect(host).toContain("still: () => !disposed && !broken && renderer === asked && !side.extrasStand(),");
  });

  it("are not built by a task still to come once they are disposed: a swap builds its own, and a hike left builds none: the engine's half", () => {
    // The swap's bindings and the handle's dispose both go through it.
    expect(src).toContain("    extras: { dispose: side.disposeExtras, build: side.buildExtras },");
    // The handle's dispose lets go of the hike's own through one function of the hike's (`disposeHike`, which the hike's `dispose` calls), which goes through it.
    expect(src.slice(src.lastIndexOf("    dispose() {\n      disposed = true;"))).toContain("side.dispose();");
  });

  it("are a follower's as they were: built in its own continuation, once its world is in", () => {
    const client = slice("  async function runAsClient(", "  if (lobby === null || lobby.state.role === \"host\") {");
    expect(client).toContain("    activeWorld = client.world;\n    side.buildExtras(renderer);");
    expect(client).not.toContain("extrasLater(");
  });
});
