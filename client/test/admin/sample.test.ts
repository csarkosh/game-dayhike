import { describe, it, expect, vi } from "vitest";
import { sampleSource } from "../../src/admin/sample.js";
import { howItRan, machinesOf, problemsOf } from "../../src/admin/profile.js";
import { trailOf } from "../../src/admin/timeline.js";
import { lossEndedLine } from "@csarkosh/engine/game/lossBound";
import type { DrawableTrail } from "../../src/admin/trail.js";

// A trail of three nodes up a straight stem: enough for the sample to walk sessions on.
const TRAIL: DrawableTrail = {
  nodes: [{ x: 0, z: 0 }, { x: 0, z: 60 }, { x: 0, z: 120 }],
  edges: [{ a: 0, b: 1, kind: "stem" }, { a: 1, b: 2, kind: "stem" }],
  forks: [],
  stem: [0, 1],
  trailhead: { x: 0, z: 0 },
  summit: 2,
  features: [],
  stemLen: 120,
};

describe("the sample's paths come from the trail builder it is given", () => {
  it("asks the builder for the sample's world once, and walks its sessions on the trail it answers", async () => {
    const trailFor = vi.fn<(world: string, seed: number) => Promise<DrawableTrail | null>>(() => Promise.resolve(TRAIL));
    const source = sampleSource(trailFor);
    const rows = await source.query("paths", 7);
    await source.query("paths", 30);
    expect(trailFor).toHaveBeenCalledTimes(1);
    expect(rows.length).toBeGreaterThan(0);
    expect(new Set(rows.map((r) => r.sid)).size).toBe(14);
    // Every walked sample sits on the given trail's line (x = 0, give or take the wander and the stray).
    const samples = rows.filter((r) => typeof r.x === "number");
    expect(samples.length).toBeGreaterThan(0);
    expect(samples.every((r) => Math.abs(Number(r.x)) <= 30)).toBe(true);
  });

  it("answers no paths when the builder has no trail for the world", async () => {
    const source = sampleSource(() => Promise.resolve(null));
    expect(await source.query("paths", 7)).toEqual([]);
  });
});

describe("the sample's trail carries each thing the GPU can do under a hike", () => {
  it("has a GPU error whose picture held, one whose picture broke, and a lost device that was rebuilt, each read as the page reads it", async () => {
    const trail = trailOf(await sampleSource(() => Promise.resolve(null)).session("s3f8a"));
    const gpu = trail.steps.filter((s) => ["gpu_error", "gpu_window", "device_lost", "engine_failed", "engine_rebuilt"].includes(s.n));
    expect(gpu.map((s) => [s.n, s.tone])).toEqual([
      // The start's own: a renderer that could not be built on WebGPU.
      ["engine_failed", "error"],
      ["gpu_error", "warn"],
      ["gpu_window", "warn"],
      ["gpu_error", "error"],
      ["gpu_window", "error"],
      ["device_lost", "error"],
      ["engine_failed", "error"],
      ["engine_rebuilt", ""],
    ]);
    expect(gpu[1]?.text).toContain('names RenderPassEncoder "post_scene"; RenderPipeline "clutter-fern"');
    expect(gpu[2]?.text).toContain("picture held, luminance 41.2 of 255, 1% black");
    expect(gpu[4]?.text).toContain("picture broke, luminance 0 of 255, 100% black");
    expect(gpu[5]?.text).toContain("unknown: The GPU process exited unexpectedly., loss 1 of this page, 1 within the bound, rebuilt");
    expect(gpu[5]?.text).toContain("held 1807 buffers (96.2 MB) and 275 textures (540.3 MB), heap 311.4 MB");
    expect(gpu[7]?.text).toBe("stood again after lost, medium on webgpu renderer 3, 104 frames under the cover, in 4.3 s");
    // The session went on to its end.
    expect(trail.steps.some((s) => s.n === "outcome")).toBe(true);
  });

  it("has a session whose hike its lost devices ended: three in ten minutes, the line, then the landing", async () => {
    const trail = trailOf(await sampleSource(() => Promise.resolve(null)).session("s41b2"));
    const losses = trail.steps.filter((s) => s.n === "device_lost");
    expect(losses).toHaveLength(3);
    expect(losses.map((s) => s.text.includes("the hike ends"))).toEqual([false, false, true]);
    expect(losses[2]?.text).toContain("loss 3 of this page, 3 within the bound, 1 min 47 s after the last");
    const end = trail.steps.find((s) => s.n === "session_end");
    expect(end?.tone).toBe("error");
    expect(end?.text).toBe(`${lossEndedLine()}, ended by lost devices: 3 this page, 3 within the bound, 52% up`);
    expect(trail.steps.filter((s) => s.n === "engine_rebuilt")).toHaveLength(2);
    expect(trail.steps.some((s) => s.n === "outcome")).toBe(false);
    // The rows after the end are the landing's.
    const names = trail.steps.map((s) => s.n);
    expect(names.slice(names.indexOf("session_end"))).toEqual(["session_end", "match_end", "page", "end"]);
  });

  it("lists them on the errors card: a GPU error as a warning and as an error, a lost device, and the hike it ended", async () => {
    const rows = await sampleSource(() => Promise.resolve(null)).query("errors", 7);
    expect(rows.filter((r) => r.n === "gpu_error").map((r) => r.level)).toEqual(["error", "warning"]);
    expect(rows.find((r) => r.n === "device_lost")).toMatchObject({ level: "error", a_session: "s41b2" });
    expect(rows.find((r) => r.n === "session_end")).toMatchObject({ level: "error", msg: lossEndedLine(), a_session: "s41b2" });
    // Errors before warnings, as the query orders them.
    const levels = rows.map((r) => r.level);
    expect(levels.lastIndexOf("error")).toBeLessThan(levels.indexOf("warning"));
  });

  it("counts the visitors the load check turned away: beside the funnel's stages, and as warnings by their reason", async () => {
    const source = sampleSource(() => Promise.resolve(null));
    const funnel = await source.query("funnel", 7);
    const all = funnel.find((r) => r.build === "all");
    // Of those that landed, and never more than those that did not press Play.
    expect(all).toMatchObject({ landed: 181, turned_away: 6, pressed_play: 78 });
    for (const r of funnel) expect(Number(r.turned_away)).toBeLessThanOrEqual(Number(r.landed) - Number(r.pressed_play));
    const builds = funnel.filter((r) => r.build !== "all");
    expect(builds.reduce((n, r) => n + Number(r.turned_away), 0)).toBe(6);
    const turned = (await source.query("errors", 7)).filter((r) => r.n === "turned_away");
    expect(turned.map((r) => [r.level, r.kind, r.sessions])).toEqual([["warning", "no-webgpu", 4], ["warning", "software", 2]]);
  });
});

describe("the sample visitor's profile", () => {
  it("shows every section of the drawer", async () => {
    const rows = await sampleSource().visitor("v7a10-1000");
    const ran = howItRan(rows);
    expect(ran.runs.length).toBeGreaterThanOrEqual(2);
    expect(ran.notes.length).toBeGreaterThanOrEqual(1);
    const levels = new Set(problemsOf(rows).map((p) => p.level));
    expect(levels).toEqual(new Set(["error", "warning"]));
    expect(machinesOf(rows).some((m) => m.gpu === "not shared by the browser")).toBe(true);
  });
});

describe("the sample's machines", () => {
  it("covers all three tiers, one masked GPU and one phone", async () => {
    const rows = await sampleSource().query("machines", 7);
    expect(rows.length).toBeGreaterThanOrEqual(4);
    expect(new Set(rows.map((r) => r.tier))).toEqual(new Set(["high", "medium", "low"]));
    expect(rows.some((r) => r.gpu === "")).toBe(true);
    expect(rows.some((r) => r.mobile === true)).toBe(true);
  });
});
