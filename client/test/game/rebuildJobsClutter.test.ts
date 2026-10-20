// The clutter's walk of 40 crossings, from "rebuilds as jobs: what is
// uploaded", in a file of its own: about 90 s on a CI runner alone, and vitest
// hands out files, not tests, so beside the other shells' walks in
// `rebuildJobsUploads.test.ts` it would set a floor under the client suite.
import { describe, it, vi } from "vitest";

// The terrain material's ground textures are a texture array NullEngine
// cannot make; `renderer.test.ts` stands in for them the same way.
vi.mock("../../src/game/groundMaps.js", () => ({
  reportLayer: () => undefined,
  loadGroundArrays: () => ({
    normals: { isReady: () => true, dispose() {} },
    rah: { isReady: () => true, dispose() {}, getSize: () => ({ width: 1, height: 1 }) },
    ready: Promise.resolve(),
    dispose() {},
  }),
}));

import "../../src/sim/passes/index.js";
import { timeLimit } from "../helpers/timeLimit.js";
import { SHELLS, checkWalkUploads } from "./helpers/rebuildShells.js";

describe("rebuilds as jobs: what is uploaded", () => {
  for (const shellOf of SHELLS.filter((of) => of().name === "clutter")) {
    // A limit for a hang, not a bar on speed: the walk takes about 90 s on a CI runner.
    it(`${shellOf().name}: uploads, over a walk of 40 crossings, exactly what the present rebuild uploads for each view`, () => {
      checkWalkUploads(shellOf);
    }, timeLimit(240_000));
  }
});
