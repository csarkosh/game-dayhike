import { afterEach, describe, expect, it } from "vitest";
import { prepareSceneReply, prepareWorld, type WorldPrepReply } from "../../src/game/world.worker.js";
import { RING_COUNT } from "../../src/game/clipmap.js";
import { sceneTransfer } from "../../src/game/preparedScene.js";
import { DEFAULT_TERRAIN_VARIANT, setActiveTerrainVariant } from "../../src/sim/terrain.js";
import { timeLimit } from "../helpers/timeLimit.js";

describe("a hike's world, prepared as the worker prepares it", () => {
  // `prepareWorld` sets the active terrain, as a worker of its own may; this thread's is put back.
  afterEach(() => setActiveTerrainVariant(DEFAULT_TERRAIN_VARIANT));

  it("posts the bowl, then the pass hash, then done, each as data that survives a clone", () => {
    const replies: WorldPrepReply[] = [];
    prepareWorld({ id: 7, seed: 627994160, variant: "olympic" }, (r) => replies.push(structuredClone(r)));
    expect(replies.map((r) => r.kind)).toEqual(["prepared", "passHash", "done"]);
    expect(replies.every((r) => r.id === 7)).toBe(true);
    const prepared = replies[0] as Extract<WorldPrepReply, { kind: "prepared" }>;
    expect([prepared.seed, prepared.variant]).toEqual([627994160, "olympic"]);
    expect((prepared.prepared as { graph: { nodes: unknown[] } }).graph.nodes.length).toBeGreaterThan(0);
    const hash = replies[1] as Extract<WorldPrepReply, { kind: "passHash" }>;
    expect([hash.hash, hash.variant]).toEqual([64181734, "olympic"]);
    expect(hash.passCount).toBeGreaterThan(0);
  }, timeLimit(120_000));

  it("posts no bowl on a terrain that prepares nothing, and that terrain's pass hash", () => {
    const replies: WorldPrepReply[] = [];
    prepareWorld({ id: 1, seed: 5, variant: "montane" }, (r) => replies.push(r));
    expect(replies.map((r) => r.kind)).toEqual(["passHash", "done"]);
    const hash = replies[0] as Extract<WorldPrepReply, { kind: "passHash" }>;
    expect(hash.variant).toBe("montane");
    expect(hash.hash).not.toBe(64181734);
  }, timeLimit(120_000));

  it("leaves out what the page says it holds", () => {
    const replies: WorldPrepReply[] = [];
    prepareWorld({ id: 4, seed: 627994160, variant: "olympic", skip: { prepared: true, passHash: false } }, (r) => replies.push(r));
    prepareWorld({ id: 5, seed: 627994160, variant: "olympic", skip: { prepared: false, passHash: true } }, (r) => replies.push(r));
    prepareWorld({ id: 6, seed: 627994160, variant: "olympic", skip: { prepared: true, passHash: true } }, (r) => replies.push(r));
    expect(replies.map((r) => [r.id, r.kind])).toEqual([[4, "passHash"], [4, "done"], [5, "prepared"], [5, "done"], [6, "done"]]);
  }, timeLimit(120_000));

  it("answers an unknown terrain with one failure", () => {
    const replies: WorldPrepReply[] = [];
    prepareWorld({ id: 2, seed: 5, variant: "nowhere" }, (r) => replies.push(r));
    expect(replies).toEqual([{ id: 2, kind: "failed", message: expect.stringContaining("nowhere") }]);
  });

  it("answers a result that cannot be posted with one failure, and nothing after it", () => {
    const replies: WorldPrepReply[] = [];
    let refused = false;
    prepareWorld({ id: 3, seed: 5, variant: "montane" }, (r) => {
      if (r.kind === "passHash" && !refused) {
        refused = true;
        throw new Error("could not be cloned");
      }
      replies.push(r);
    });
    expect(replies).toEqual([{ id: 3, kind: "failed", message: expect.stringContaining("could not be cloned") }]);
  }, timeLimit(120_000));
});

describe("a hike's first scene, sampled as the worker samples it", () => {
  afterEach(() => setActiveTerrainVariant(DEFAULT_TERRAIN_VARIANT));

  it("posts the scene with every one of its buffers in the transfer list, then done", () => {
    const posts: { reply: WorldPrepReply; transfer: ArrayBuffer[] }[] = [];
    prepareSceneReply({ id: 4, kind: "scene", seed: 7, variant: "montane", tier: "low" }, (reply, transfer) => posts.push({ reply, transfer }));
    expect(posts.map((p) => [p.reply.id, p.reply.kind])).toEqual([[4, "scene"], [4, "done"]]);
    const first = posts[0]!;
    if (first.reply.kind !== "scene") throw new Error("not a scene");
    expect(first.reply.scene).toMatchObject({ seed: 7, variant: "montane", tier: "low", start: { x: 0, z: 0 }, lakes: [] });
    expect(first.transfer).toHaveLength(RING_COUNT * 10);
    expect(first.transfer).toEqual(sceneTransfer(first.reply.scene));
    expect(posts[1]!.transfer).toEqual([]);
    // As the message crosses: cloned, its buffers moved.
    const crossed = structuredClone(first.reply, { transfer: first.transfer });
    expect(crossed.scene.rings).toHaveLength(RING_COUNT);
    expect(crossed.scene.rings[0]!.h.byteLength).toBeGreaterThan(0);
    expect(first.reply.scene.rings[0]!.h.byteLength).toBe(0);
  }, timeLimit(120_000));

  it("answers an unknown terrain with one failure", () => {
    const replies: WorldPrepReply[] = [];
    prepareSceneReply({ id: 2, kind: "scene", seed: 5, variant: "nowhere", tier: "low" }, (r) => replies.push(r));
    expect(replies).toEqual([{ id: 2, kind: "failed", message: expect.stringContaining("nowhere") }]);
  });

  it("answers a scene that cannot be posted with one failure, and nothing after it", () => {
    const replies: WorldPrepReply[] = [];
    prepareSceneReply({ id: 3, kind: "scene", seed: 5, variant: "montane", tier: "low" }, (r) => {
      if (r.kind === "scene") throw new Error("could not be cloned");
      replies.push(r);
    });
    expect(replies).toEqual([{ id: 3, kind: "failed", message: expect.stringContaining("could not be cloned") }]);
  }, timeLimit(120_000));
});
