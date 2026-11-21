import { describe, expect, it } from "vitest";
import { sourceText } from "../helpers/source.js";

/**
 * A session's frame is one function, the host's and a follower's alike: the two differ only in
 * where the state drawn comes from and in what the netgraph is told. The order inside it is the
 * hike's as it has always run, and is pinned here: the hike's steps that the renderer's sync reads
 * come before it, the world's sound after it, and the hike's own reading of the frame after that.
 */

const app = sourceText("app.ts");

/** The body of a function declared in `app.ts`, from its opening brace to the brace that closes it. */
function bodyOf(name: string): string {
  const at = app.indexOf(`  function ${name}(`);
  if (at < 0) throw new Error(`app.ts has no function ${name}`);
  const open = app.indexOf(" {\n", at);
  const close = app.indexOf("\n  }\n", open);
  return app.slice(open, close);
}

/** How many times `call` is written in `text` as a call, not as a declaration. */
function calls(text: string, call: string): number {
  return [...text.matchAll(new RegExp(`(?<!function |\\.)\\b${call.replace(/[.$]/g, "\\$&")}\\(`, "g"))].length;
}

const BEFORE_SYNC = ["syncWayLight", "syncCrowd", "syncWayDraw", "syncAtmosphere"];
const WORLD_SOUND = ["playWildlifeAudio", "syncWind", "syncDrip", "syncWaterLife", "syncSurf"];
const AFTER_SYNC = ["syncTouch", "syncPrompt", "syncPoster", "syncRoadLine", "syncDeath", "syncOutcome", "syncEndScene", "syncTelemetry"];

describe("a session's frame", () => {
  it("runs its steps in the hike's order: what the sync reads, the sync, the world's sound, the hike's reading of the frame, the draw", () => {
    const frame = bodyOf("frame");
    const order = [...BEFORE_SYNC, "renderer.sync", ...WORLD_SOUND, ...AFTER_SYNC, "drawHike"];
    const places = order.map((step) => frame.search(new RegExp(`\\b${step.replace(".", "\\.")}\\(`)));
    expect(places.every((at) => at >= 0), `each of ${order.join(", ")} is called in frame()`).toBe(true);
    expect(places).toEqual([...places].sort((a, b) => a - b));
    for (const step of order) expect(calls(frame, step), step).toBe(1);
  });

  it("is the one place a frame's steps are called from: the host and a follower both run it", () => {
    for (const step of [...BEFORE_SYNC, ...WORLD_SOUND, ...AFTER_SYNC]) expect(calls(app, step), step).toBe(1);
    expect(calls(app, "renderer.sync")).toBe(1);
    // The host draws its own state; a follower the one blended between snapshots at this frame's time.
    expect(bodyOf("runAsHost")).toMatch(/const state: WorldState = host\.world\.state;\s+frame\(host, state, cmd, dt\);/);
    expect(app).toMatch(/const state = client\.renderState\(performance\.now\(\)\);\s+frame\(client, state, cmd, dt\);/);
    expect(calls(app, "frame")).toBe(2);
  });

  it("steps a frame's ticks in one place: each command sampled, filtered by the hike and handed to the session", () => {
    const ticks = bodyOf("stepTicks");
    expect(ticks).toContain("cmd = taken(ranToCar(stilled(input.sample(++seq), me, live.world), me));");
    expect(ticks).toContain("live.tick(cmd);");
    // The one other sample is the free camera's look at the command just sampled, which takes no new sequence number.
    expect(app.match(/input\.sample\(\+\+seq\)/g)).toHaveLength(1);
    // The host's look at the end scene steps after the frame's ticks are counted and before they run.
    expect(bodyOf("runAsHost")).toMatch(/const ticks = accumulator\.advance\(dt\);\s+escapeStep\?\.\(\);\s+const cmd = stepTicks\(host, ticks\);/);
    expect(app).toMatch(/const ticks = accumulator\.advance\(dt\);\s+const cmd = stepTicks\(client, ticks\);/);
  });
});
