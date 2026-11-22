import { describe, expect, it } from "vitest";
import "../../../src/sim/passes/index.js";
import { chainTargetsStand } from "@csarkosh/engine/game/lite/postChain";

describe("the post chain's targets on Babylon Lite", () => {
  /** A scene's depth and resolve as Lite hands them: an object each, made again only with the target. */
  const made = (): { depth: object; resolve: object } => ({ depth: {}, resolve: {} });

  it("stand through a recording that left the scene's own targets as they were: a hiker's lamp joining makes none again", () => {
    const scene = made();
    const built = { depth: scene.depth, resolve: scene.resolve };
    for (let recording = 0; recording < 12; recording++) expect(chainTargetsStand(built, scene.depth, scene.resolve)).toBe(true);
  });

  it("are made again when the scene's are: its depth or its resolve is another object after a resize", () => {
    const scene = made();
    const built = { depth: scene.depth, resolve: scene.resolve };
    const resized = made();
    expect(chainTargetsStand(built, resized.depth, resized.resolve)).toBe(false);
    expect(chainTargetsStand(built, scene.depth, resized.resolve)).toBe(false);
    expect(chainTargetsStand(built, resized.depth, scene.resolve)).toBe(false);
  });

  it("are made for the first recording, and not while the scene has no target of its own yet", () => {
    const scene = made();
    expect(chainTargetsStand(null, scene.depth, scene.resolve)).toBe(false);
    const built = { depth: scene.depth, resolve: scene.resolve };
    expect(chainTargetsStand(built, null, scene.resolve)).toBe(false);
    expect(chainTargetsStand(built, scene.depth, null)).toBe(false);
  });
});
