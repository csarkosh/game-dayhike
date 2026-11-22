import { describe, expect, it } from "vitest";
import { sourceText } from "../helpers/source.js";

describe("the renderer and the app", () => {
  const app = sourceText("app.ts");
  // The engine's renderer alone: what is a game's own in a frame is written in the game's side of it, which the game's suite reads.
  const renderer = sourceText("game/lite/renderer.ts");
  const chain = sourceText("game/lite/postChain.ts");

  it("the app reports the way once it is settled: its length, its straight line and whether it is the fallback: the engine's half", () => {
    // Once in all: in `hike.ts`, and not again in `app.ts`.
    expect(app).not.toContain('telemetry.event("way"');
  });

  it("the renderer makes the way's mist once, for a forest, toned for the tier's colour path, and disposes it: the engine's half", () => {
    // Day Hike's side makes it once; the engine's renderer does not make it.
    expect(renderer.match(/createLiteWayLight\(/g) ?? []).toHaveLength(0);
  });

  it("the renderer dims the frame by the mist's level on both colour paths and gives the mist the dim to undo: the engine's half", () => {
    // With no chain the exposure every material ends with carries it, beside the stare's.
    expect(renderer).toContain("(chained ? light.exposure : light.exposure * sightUnder(shownStare.level) * side.look.dim)");
    // With one the grade's does.
    expect(renderer).toContain("standing.chain?.setDim(side.look.dim);\n        standing.chain?.update(");
    expect(chain).toContain("if (dim !== 1) record = { ...record, exposure: record.exposure * dim };");
  });

  it("the renderer feeds the ground cloud's map the way in place of the trail while the mist is up, and builds it again when that changes: the engine's half", () => {
    expect(renderer).toContain("if (cloudGroundDue(cloudGroundAt, pose.x, pose.z) || (over !== null) !== wayMistBuilt) {");
  });
});
