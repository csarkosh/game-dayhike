import { describe, expect, it } from "vitest";
import { sourceText } from "../helpers/source.js";

/**
 * A session's frame is one function, the host's and a follower's alike: the two differ only in
 * where the state drawn comes from and in what the netgraph is told. The order inside it is the
 * hike's as it has always run, and is pinned here for the page's half (`app.ts`): the hike's steps that
 * the renderer's sync reads come before it, the world's sound after it, and the hike's own reading of
 * the frame after that. The hike's own half is read by Day Hike's suite (`client/test/game/appFrame.test.ts`).
 */

const app = sourceText("app.ts");

/** The body of a function declared in `app.ts`, from its opening brace to the brace that closes it. */
function bodyOf(name: string, text: string = app): string {
  const at = text.indexOf(`  function ${name}(`);
  if (at < 0) throw new Error(`no function ${name}`);
  const open = text.indexOf(" {\n", at);
  const close = text.indexOf("\n  }\n", open);
  return text.slice(open, close);
}

/** How many times `call` is written in `text` as a call, not as a declaration. */
function calls(text: string, call: string): number {
  return [...text.matchAll(new RegExp(`(?<!function |\\.)\\b${call.replace(/[.$]/g, "\\$&")}\\(`, "g"))].length;
}

// The page calls the hike's steps in groups, `side.<group>`; the world's sound and the touch layer stay in `app.ts`.
const BEFORE_SYNC = ["side.beforeSync"];
const WORLD_SOUND = ["playWildlifeAudio", "syncWind", "syncDrip", "syncWaterLife", "syncSurf"];
const AFTER_SYNC = ["syncTouch", "side.afterSync", "side.report"];

describe("a session's frame", () => {
  it("runs its steps in the hike's order: what the sync reads, the sync, the world's sound, the hike's reading of the frame, the draw: the engine's half", () => {
    const frame = bodyOf("frame");
    const order = [...BEFORE_SYNC, "renderer.sync", ...WORLD_SOUND, ...AFTER_SYNC, "drawSession"];
    const places = order.map((step) => frame.search(new RegExp(`\\b${step.replace(".", "\\.")}\\(`)));
    expect(places.every((at) => at >= 0), `each of ${order.join(", ")} is called in frame()`).toBe(true);
    expect(places).toEqual([...places].sort((a, b) => a - b));
    for (const step of order) expect(calls(frame, step), step).toBe(1);
  });

  it("is the one place a frame's steps are called from: the host and a follower both run it: the engine's half", () => {
    for (const step of [...BEFORE_SYNC, ...WORLD_SOUND, ...AFTER_SYNC, "side.lampOn", "side.sound", "side.command"]) expect(calls(app, step), step).toBe(1);
    // The lamp's state is read through the hike, for the touch layer, in the frame's one touch step.
    expect(bodyOf("frame")).toContain("syncTouch(side.lampOn(self));");
    // The hike's stare rides the drip's call, after the drips are set.
    const drip = bodyOf("syncDrip");
    expect(drip).toContain("ambient.setDrip(");
    expect(drip.indexOf("side.sound();")).toBeGreaterThan(drip.indexOf("ambient.setDrip("));
    expect(calls(app, "renderer.sync")).toBe(1);
    // The host draws its own state; a follower the one blended between snapshots at this frame's time.
    expect(bodyOf("runAsHost")).toMatch(/const state: S = host\.world\.state;\s+frame\(host, state, cmd, dt\);/);
    expect(app).toMatch(/const state = client\.renderState\(performance\.now\(\)\);\s+frame\(client, state, cmd, dt\);/);
    expect(calls(app, "frame")).toBe(2);
  });

  it("steps a frame's ticks in one place: each command sampled, filtered by the hike and handed to the session: the engine's half", () => {
    const ticks = bodyOf("stepTicks");
    expect(ticks).toContain("cmd = side.command(input.sample(++seq), me, live.world);");
    expect(ticks).toContain("live.tick(cmd);");
    // The one other sample is the free camera's look at the command just sampled, which takes no new sequence number.
    expect(app.match(/input\.sample\(\+\+seq\)/g)).toHaveLength(1);
    // The host's look at the end scene steps after the frame's ticks are counted and before they run.
    expect(bodyOf("runAsHost")).toMatch(/const ticks = accumulator\.advance\(dt\);\s+side\.beforeTicks\(\);\s+const cmd = stepTicks\(host, ticks\);/);
    expect(app).toMatch(/const ticks = accumulator\.advance\(dt\);\s+const cmd = stepTicks\(client, ticks\);/);
  });
});

describe("a session's start", () => {
  it("puts the hike back at rest in one place, for the host's session and a follower's alike: the engine's half", () => {
    // Written once, in `hike.ts` and nowhere in `app.ts`: the two sessions used to carry a copy each.
    expect(app).not.toContain("woods = WOODS_REST;");
    expect(app).not.toContain("voice = voiceRest(");
    // After the match is announced and the governor restarted, before the session's world is wired to the page.
    for (const who of ["host", "client"]) {
      expect(app, who).toMatch(new RegExp(`matchStarted\\("${who}", ${who}\\.world, [^\\n]+\\n    governor\\?\\.restart\\(performance\\.now\\(\\)\\);\\n    side\\.atRest\\(\\);`));
    }
    expect(calls(app, "side.atRest")).toBe(2);
  });
});

describe("the hike's own hands on a session", () => {
  it("installs the host's looks in a function of the hike's, where the host's session is made: the engine's half", () => {
    for (const hand of ["summitPreview = () => {", "standAt = (x, z, yaw) => {", "setLamp = (on) => {", "escapeLook = () => {", "escapeStep = () => {"]) {
      expect(bodyOf("runAsHost"), hand).not.toContain(hand);
    }
    expect(bodyOf("runAsHost")).toMatch(/mode,\n    \}\);\n    side\.hostStarted\(host\);\n    session = host;/);
  });

  it("puts what the hike reports of a match back at rest in a function of the hike's, when a match starts: the engine's half", () => {
    expect(bodyOf("matchStarted")).toMatch(/if \(telemetry === null\) return;\n    side\.matchStarted\(world\);/);
    expect(bodyOf("matchStarted")).not.toContain("hollowSeen");
  });

  it("lets go of the hike's panels, timers and extras in a function of the hike's, when the page lets go of the hike: the engine's half", () => {
    expect(app).toMatch(/connectPanel\.dispose\(\);\n      side\.dispose\(\);\n      touchLayer\.dispose\(\);\n      input\.dispose\(\);/);
  });
});

describe("the console's commands on a hike", () => {
  const OWN = ["escalation", "mist", "way", "crowd", "summit", "escape", "stand", "lamp", "end"];

  it("the hike applies its own, and the page asks it before its own: the engine's half", () => {
    const page = bodyOf("applyView");
    expect(page).toMatch(/const value = findCommand\(name\)\?\.scriptValue\?\.\(args\);\n    if \(side\.applyOwnView\(name, args\)\) return;/);
    for (const name of OWN) expect(page, name).not.toContain(`name === "${name}"`);
    // The page's own are still its own.
    for (const name of ["aim", "freecam", "wireframe", "skin", "time", "palette", "weather", "bob", "unsettle", "wind", "volume"]) expect(page, name).toContain(`name === "${name}"`);
  });
});

describe("the hike's own details of a session", () => {
  it("registers what a world's players can interact with, hears the session's own events and counts its entities, where the page did: the engine's half", () => {
    const page = app;
    for (const gone of ["world.interactables.set(", ".onInteracted(", "state.enemies.size"]) expect(page, gone).not.toContain(gone);
    // The page calls the hike at the points it did those itself: a session's world in, its events, the netgraph's row.
    expect(page.split("side.worldIn(").length - 1).toBe(2);
    expect(page).toContain("    side.worldIn(host.world);\n    activeWorld = host.world;");
    expect(page).toContain("    side.worldIn(client.world);\n    activeWorld = client.world;");
    expect(page.split("side.hears(").length - 1).toBe(2);
    expect(page).toContain("    side.hears(host);");
    expect(page).toContain("    side.hears(client);");
    expect(page.split("entities: side.entities(state),").length - 1).toBe(2);
  });
});
