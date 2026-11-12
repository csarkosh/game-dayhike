import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

/**
 * `app.ts` builds the peer-to-peer networking and a WebGL renderer, so nothing here can start a hike under
 * Node: where the signs and the body are built is read from the source, as `appSky.test.ts` reads the sky's.
 * How a build is put off is `extrasLater.test.ts`'s.
 */
const src = readFileSync(fileURLToPath(new URL("../../src/app.ts", import.meta.url)), "utf8");
const slice = (from: string, to: string): string => src.slice(src.indexOf(from), src.indexOf(to, src.indexOf(from)));

describe("the signs and the body of a hike the film covers", () => {
  it("are built by the host in a task after the build where the start has a loader of first builds, and in place where it has none", () => {
    const host = slice("  function runAsHost(): void {", "  async function runAsClient(");
    expect(host).toContain("    if (firstBuilds === undefined) buildExtras(renderer);\n    else extrasToCome = extrasLater({");
    expect(host.match(/buildExtras\(/g)).toHaveLength(2);
    // The one the task builds for is the renderer that stood when it was asked.
    expect(host).toContain("build: () => buildExtras(asked),");
  });

  it("are built only for the hike and the renderer that asked, and only where nothing built them meanwhile", () => {
    const host = slice("  function runAsHost(): void {", "  async function runAsClient(");
    expect(host).toContain("still: () => !disposed && !broken && renderer === asked && signs === null && body === null,");
  });

  it("are not built by a task still to come once they are disposed: a swap builds its own, and a hike left builds none", () => {
    const dispose = slice("  function disposeExtras(): void {", "  made(disposeExtras);");
    expect(dispose).toContain("    extrasToCome?.cancel();\n    extrasToCome = null;");
    // The swap's bindings and the handle's dispose both go through it.
    expect(src).toContain("    extras: { dispose: disposeExtras, build: buildExtras },");
    expect(src.slice(src.lastIndexOf("    dispose() {\n      disposed = true;"))).toContain("disposeExtras();");
  });

  it("are a follower's as they were: built in its own continuation, once its world is in", () => {
    const client = slice("  async function runAsClient(", "  if (lobby === null || lobby.state.role === \"host\") {");
    expect(client).toContain("    activeWorld = client.world;\n    buildExtras(renderer);");
    expect(client).not.toContain("extrasLater(");
  });
});
