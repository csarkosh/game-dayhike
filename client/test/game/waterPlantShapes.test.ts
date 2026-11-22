import { describe, expect, it } from "vitest";
import "../../src/sim/passes/index.js";
import "@csarkosh/engine/sim/olympic";
import { firstPondWorld, lakeOf } from "../sim/helpers/lakes.js";
import { waterPlantPlacements } from "@csarkosh/engine/game/waterPlantField";
import {
  LILY_LIFT, REED_CHARACTERS, lilyFlowers, lilyYaw, waterPlantLists,
} from "@csarkosh/engine/game/waterPlantShapes";
import { timeLimit } from "@csarkosh/engine/testing/timeLimit";

describe("a lake's plants as lists, with no engine", { timeout: timeLimit(60_000) }, () => {
  const { seed } = firstPondWorld((f) => (f.murk ?? 0) >= 0.8);
  const lake = lakeOf(seed);
  const placed = waterPlantPlacements(seed, lake);
  const lists = waterPlantLists(seed, [lake], [placed]);

  it("holds a list a reed variant, the pads and the flowers, a matrix a plant", () => {
    expect(lists.reeds).toHaveLength(REED_CHARACTERS.length);
    lists.reeds.forEach((list, variant) => {
      expect(list.count).toBe(placed.reeds[variant]?.length);
      expect(list.matrices.length).toBe(list.count * 16);
    });
    expect(lists.pads.count).toBe(placed.pads.length);
    expect(lists.flowers.count).toBe(placed.pads.filter((inst) => lilyFlowers(seed, inst)).length);
    expect(lists.reeds.reduce((n, list) => n + list.count, 0)).toBeGreaterThan(0);
  });

  it("stands a reed on its ground, turned by its own hash and scaled whole", () => {
    const variant = placed.reeds.findIndex((list) => list.length > 0);
    const inst = placed.reeds[variant]?.[0];
    const m = lists.reeds[variant]?.matrices;
    if (inst === undefined || m === undefined) throw new Error("no reed");
    const yaw = inst.hash * Math.PI * 2;
    expect(m[0]).toBeCloseTo(Math.cos(yaw) * inst.scale, 6);
    expect(m[2]).toBeCloseTo(-Math.sin(yaw) * inst.scale, 6);
    expect(m[5]).toBeCloseTo(inst.scale, 6);
    expect([m[12], m[13], m[14], m[15]]).toEqual([Math.fround(inst.x), Math.fround(inst.groundH), Math.fround(inst.z), 1]);
  });

  it("lays a pad just over its lake's level, scaled across and not in height, and its flower on it unscaled at the same turn", () => {
    const pad = placed.pads[0];
    if (pad === undefined) throw new Error("no pad");
    const m = lists.pads.matrices;
    const yaw = lilyYaw(seed, pad);
    expect(m[13]).toBe(Math.fround(lake.level + LILY_LIFT));
    expect(m[5]).toBe(1);
    expect(Math.hypot(m[0] as number, m[2] as number)).toBeCloseTo(pad.scale, 6);
    expect(m[0]).toBeCloseTo(Math.cos(yaw) * pad.scale, 6);
    const flowering = placed.pads.find((inst) => lilyFlowers(seed, inst));
    if (flowering !== undefined) {
      const f = lists.flowers.matrices;
      expect(Math.hypot(f[0] as number, f[2] as number)).toBeCloseTo(1, 6);
      expect([f[12], f[13], f[14]]).toEqual([Math.fround(flowering.x), Math.fround(lake.level + LILY_LIFT), Math.fround(flowering.z)]);
    }
  });

  it("samples a lake's plants itself where none were placed ahead", () => {
    const sampled = waterPlantLists(seed, [lake]);
    expect(sampled.pads.matrices).toEqual(lists.pads.matrices);
    sampled.reeds.forEach((list, variant) => expect(list.matrices).toEqual(lists.reeds[variant]?.matrices));
  });
});
