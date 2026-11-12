import { afterEach, describe, expect, it, vi } from "vitest";
import { NullEngine } from "@babylonjs/core/Engines/nullEngine.js";
import { Scene } from "@babylonjs/core/scene.js";
import { PBRMaterial } from "@babylonjs/core/Materials/PBR/pbrMaterial.js";
import { CreateBox } from "@babylonjs/core/Meshes/Builders/boxBuilder.js";
import { Mesh } from "@babylonjs/core/Meshes/mesh.js";
import "../../src/sim/passes/index.js";
import { CLUTTER_CLASS_COUNT } from "../../src/sim/clutter.js";
import { createClutterMeshes } from "../../src/game/clutterMeshes.js";
import { createBladeMeshes } from "../../src/game/bladeMeshes.js";
import { createDuffMeshes } from "../../src/game/duffMeshes.js";
import { createFirstBuilds, type FirstBuilds } from "../../src/game/firstBuilds.js";
import { timeLimit } from "../helpers/timeLimit.js";

// A shell's first fill under the intro's film: handed to the loader (`firstBuilds.ts`) and stepped,
// not drained in the call that asked for it. What reached the GPU is read as the forest's and the
// ground cover's own tests read it: the calls to `thinInstanceSetBuffer`.
const SEED = 1;
const AT = { x: 2500, z: 2500 };
const engines: NullEngine[] = [];
afterEach(() => {
  vi.restoreAllMocks();
  for (const e of engines.splice(0)) e.dispose();
});
function scene(): Scene {
  const engine = new NullEngine();
  engines.push(engine);
  return new Scene(engine);
}
type Shell = { update(x: number, z: number): void; dispose(): void };
const SHELLS: Record<string, (firstBuilds?: FirstBuilds) => Shell> = {
  "ground cover": (firstBuilds) => {
    const s = scene();
    const assets: Mesh[][][][] = [];
    for (let cls = 0; cls < CLUTTER_CLASS_COUNT; cls++) {
      assets.push([0, 1].map((variant) => [0, 1].map((lod) => {
        const mesh = CreateBox(`c${cls}v${variant}l${lod}`, { size: 0.5 }, s);
        mesh.material = new PBRMaterial(mesh.name, s);
        return [mesh];
      })));
    }
    return createClutterMeshes(s, SEED, { assets, radiusScale: 0.6, firstBuilds });
  },
  blades: (firstBuilds) => createBladeMeshes(scene(), SEED, { quality: "high", firstBuilds }),
  duff: (firstBuilds) => createDuffMeshes(scene(), SEED, { quality: "high", firstBuilds }),
};
/** A loader whose turns the test runs by hand. */
function loaderByHand(): { loader: FirstBuilds; turns: (() => void)[] } {
  const turns: (() => void)[] = [];
  return { loader: createFirstBuilds({ later: (run) => void turns.push(run), now: () => 0 }), turns };
}

describe.each(Object.keys(SHELLS))("the %s's first fill", (name) => {
  const make = SHELLS[name]!;

  it("is handed to a loader that is open, and uploads what a whole build uploads", () => {
    const uploads = vi.spyOn(Mesh.prototype, "thinInstanceSetBuffer");
    make().update(AT.x, AT.z);
    const whole = uploads.mock.calls.length;
    expect(whole).toBeGreaterThan(0);
    uploads.mockClear();
    const { loader } = loaderByHand();
    make(loader).update(AT.x, AT.z);
    expect(loader.pending()).toBe(1);
    expect(uploads.mock.calls.length).toBe(0); // queued, not built in the call
    loader.close(); // the cut: what is left runs to its end
    expect(uploads.mock.calls.length).toBe(whole);
  }, timeLimit(120_000));

  it("is built whole, at once, once the loader has closed", () => {
    const { loader } = loaderByHand();
    loader.close();
    const uploads = vi.spyOn(Mesh.prototype, "thinInstanceSetBuffer");
    make(loader).update(AT.x, AT.z);
    expect(loader.pending()).toBe(0);
    expect(uploads.mock.calls.length).toBeGreaterThan(0);
  }, timeLimit(120_000));

  it("is dropped when the shell is disposed, so nothing is stepped against meshes that have gone", () => {
    const { loader } = loaderByHand();
    const shell = make(loader);
    shell.update(AT.x, AT.z);
    expect(loader.pending()).toBe(1);
    shell.dispose();
    expect(loader.pending()).toBe(0);
    const uploads = vi.spyOn(Mesh.prototype, "thinInstanceSetBuffer");
    expect(() => loader.close()).not.toThrow();
    expect(uploads.mock.calls.length).toBe(0);
  }, timeLimit(120_000));

  it("is replaced, not doubled, when the view jumps before it has run", () => {
    const { loader } = loaderByHand();
    const shell = make(loader);
    shell.update(AT.x, AT.z);
    shell.update(AT.x + 6000, AT.z + 6000);
    expect(loader.pending()).toBe(1);
    // The frames after it, standing still: nothing more is queued and nothing builds beside it.
    const uploads = vi.spyOn(Mesh.prototype, "thinInstanceSetBuffer");
    shell.update(AT.x + 6000, AT.z + 6000);
    expect(loader.pending()).toBe(1);
    expect(uploads.mock.calls.length).toBe(0);
    loader.close();
    expect(uploads.mock.calls.length).toBeGreaterThan(0);
  }, timeLimit(120_000));
});
