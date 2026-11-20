import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { timeLimit } from "../helpers/timeLimit.js";
import "../../src/sim/passes/index.js";
import { generateChunk } from "../../src/sim/chunk.js";
import { createForest } from "../../src/sim/forest.js";
import { trailheadStart } from "../../src/sim/spawn.js";
import { activeTerrainVariant, elevationSampleAt } from "../../src/sim/terrain.js";
import { route } from "../../src/sim/trailRoute.js";
import { seedFromToken } from "../../src/game/seed.js";

/**
 * A world as it stood on 2026-11-19, by its digest: its id, where a hiker arrives, its ground
 * with its slopes, its trail, its water and the chunks along the trail. A world is derived from
 * its seed and the code alone, so a digest that moves means every hike on that seed has moved:
 * a peer on the build before could not join, and what a player knew of the mountain is gone.
 * Nothing here may be recorded again without that being meant.
 */

/** JSON with typed arrays as plain ones. A double's JSON is the shortest text that reads back to it. */
function canonical(value: unknown): string {
  return JSON.stringify(value, (_key, v: unknown) => (ArrayBuffer.isView(v) ? Array.from(v as unknown as ArrayLike<number>) : v));
}

function digest(parts: readonly unknown[]): string {
  const hash = createHash("sha256");
  for (const part of parts) hash.update(canonical(part)).update("\n");
  return hash.digest("hex");
}

/** 256 places in the road's frame: from the sea, over the road and the pad, up through the bowl to past the peak's reach. */
function ground(seed: number): number[] {
  const out: number[] = [];
  for (let i = 0; i < 16; i++) {
    for (let j = 0; j < 16; j++) {
      const s = elevationSampleAt(seed, -700 + i * 119.5, -720 + j * 96.25);
      out.push(s.h, s.dx, s.dz);
    }
  }
  return out;
}

function world(seed: number) {
  const forest = createForest(seed);
  const variant = activeTerrainVariant();
  const graph = variant.trailGraph?.(seed);
  if (graph === undefined) throw new Error("the default terrain has a trail");
  const chunks: unknown[] = [];
  const step = Math.max(1, Math.floor(graph.nodes.length / 6));
  for (let n = 0; n < graph.nodes.length; n += step) {
    const node = graph.nodes[n] as { x: number; z: number };
    const made = generateChunk(seed, Math.floor(node.x / 32), Math.floor(node.z / 32));
    chunks.push([made.columns, made.props]);
  }
  return {
    id: [forest.levelId, forest.fieldHash, forest.passHash, variant.name],
    start: trailheadStart(seed),
    ground: ground(seed),
    trail: [graph, route(graph, 0, graph.summit), route(graph, graph.summit, 0)],
    water: variant.waterBodies?.(seed) ?? [],
    landmarks: variant.sceneryLandmarks?.(seed) ?? [],
    chunks,
  };
}

const WORLDS: readonly { token: string; levelId: string; digests: Record<string, string> }[] = [
  {
    token: "hollow39",
    levelId: "forest/8/olympic/-838591574/1879659486/64181734",
    digests: {
      chunks: "dce6fe1b326a7b19f25d4cee624cb8c08efd0f5bb0d7971e3ce2ca32a572edae",
      ground: "cffc1bf3fa30cdef8074948bbe00f4a252c911d2a79f81e9be2057dfe55741fc",
      id: "aed0a36b0a67aa161f75ee174a3dc05302aef174f7511974ac84439dbd5e6ad0",
      landmarks: "e6d9dfe0dbfc5fed61982f2dd32422a88a03691fe3276f4438b725a95c3b84a5",
      start: "b2c3392ae2e34663b5e5b39d3f0f27e48a34e1991f8aeab4f4781c36734e9bf9",
      trail: "451fe998aabf4c4e748bedb009edb392f78025bd863a0836eec4ca7ef8fac344",
      water: "6438fe221993be90392122253a8ea6b7348951d67581298b10de87e9e112bd9b",
    },
  },
  {
    token: "trail14",
    levelId: "forest/8/olympic/-936623642/1210311332/64181734",
    digests: {
      chunks: "aa7c06af33f53a9f1eab7dcf9b1612160471970cc5b2511bea72a48e8ee250cc",
      ground: "42bbe3c0f24e8845dd7b052e607d0770ccd8ff8b2c20ea9e2a83af6b7a34098a",
      id: "f2122c53552a8ec3e91760d5dc011df38675e23f572c4548a258ed0323d36ade",
      landmarks: "687868c97911d91eca76885829739540ee7eb4118fc15d7aac12ec608b04484f",
      start: "00438d6304acc8e415ab5c8b5ecedee7f3051cd26de1f7982ce59effce16343c",
      trail: "a79c9f92bfe5213a60f77637b8fd47aeae19a13964203e800824ed0eace9c3a2",
      water: "b4beced8fd7cba3049d321172c902b541324f68889f3ca8ab1eb7d269a3ef0f6",
    },
  },
  {
    token: "hollow0",
    levelId: "forest/8/olympic/-496113302/1451043937/64181734",
    digests: {
      chunks: "ff89026761ec2e59f528943f1f26d7761b2289d6ac94d7e6d59a91e59049a2fa",
      ground: "4893a3fd8d7ab7b93aebb34fda9830c97bc07bc44786e19f8654f5c79d30aac8",
      id: "09924b5f4d3a40f5a46914a8e611f98198ef539e7fb7bbf7a3035a0197b87d4c",
      landmarks: "eb680e801ad58dffdba95e099c99de78cf5926ba0a5287f94e9cf4644236ab1a",
      start: "a65f650a9d4460896134460bec2a9220a64b8baac29cae6dc0650163dc2a7513",
      trail: "89fcd082f0aeac705918ad75d05069da87161912d68d98822b85cc4b7d84e84c",
      water: "b4beced8fd7cba3049d321172c902b541324f68889f3ca8ab1eb7d269a3ef0f6",
    },
  },
];

describe("a world's identity", () => {
  for (const expected of WORLDS) {
    it(`${expected.token} is the world it was`, () => {
      const made = world(seedFromToken(expected.token));
      const digests = Object.fromEntries(Object.entries(made).map(([name, part]) => [name, digest([part])]));
      expect({ levelId: made.id[0], digests }).toEqual({ levelId: expected.levelId, digests: expected.digests });
    }, timeLimit(120_000));
  }
});
