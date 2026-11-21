import { describe, expect, it } from "vitest";
import { sourceText } from "../helpers/source.js";

/**
 * A session's frame is one function, the host's and a follower's alike: the two differ only in
 * where the state drawn comes from and in what the netgraph is told. The order inside it is the
 * hike's as it has always run, and is pinned here: the hike's steps that the renderer's sync reads
 * come before it, the world's sound after it, and the hike's own reading of the frame after that.
 */

const app = sourceText("app.ts");
/** The hike's own half (`createHike`): what `app.ts` calls as `hike.<name>`. A variable of `app.ts` it reads is written `h.<name>` there. */
const hikeSrc = sourceText("hike.ts");

/** The body of a function declared in `app.ts` (or, given `hike.ts`'s text, in `hike.ts`), from its opening brace to the brace that closes it. */
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

// The page calls the hike's steps in groups, `hike.<group>`; the world's sound and the touch layer stay in `app.ts`.
const BEFORE_SYNC = ["hike.beforeSync"];
const WORLD_SOUND = ["playWildlifeAudio", "syncWind", "syncDrip", "syncWaterLife", "syncSurf"];
const AFTER_SYNC = ["syncTouch", "hike.afterSync", "hike.report"];
// Inside the hike, each group runs its own steps in this order (`hike.ts`, where each is called as `<name>`).
const HIKE_BEFORE_SYNC = ["syncWayLight", "syncCrowd", "syncWayDraw", "syncAtmosphere"];
const HIKE_AFTER_SYNC = ["syncPrompt", "syncPoster", "syncRoadLine", "syncDeath", "syncOutcome", "syncEndScene"];

describe("a session's frame", () => {
  it("runs its steps in the hike's order: what the sync reads, the sync, the world's sound, the hike's reading of the frame, the draw", () => {
    const frame = bodyOf("frame");
    const order = [...BEFORE_SYNC, "renderer.sync", ...WORLD_SOUND, ...AFTER_SYNC, "drawHike"];
    const places = order.map((step) => frame.search(new RegExp(`\\b${step.replace(".", "\\.")}\\(`)));
    expect(places.every((at) => at >= 0), `each of ${order.join(", ")} is called in frame()`).toBe(true);
    expect(places).toEqual([...places].sort((a, b) => a - b));
    for (const step of order) expect(calls(frame, step), step).toBe(1);
    // Inside the hike: what the sync reads, then the hike's reading of the frame, each step in its group's body.
    for (const [group, steps] of [["beforeSync", HIKE_BEFORE_SYNC], ["afterSync", HIKE_AFTER_SYNC]] as const) {
      const body = bodyOf(group, hikeSrc);
      const inner = steps.map((step) => body.search(new RegExp(`\\b${step}\\(`)));
      expect(inner.every((at) => at >= 0), `each of ${steps.join(", ")} is called in ${group}()`).toBe(true);
      expect(inner).toEqual([...inner].sort((a, b) => a - b));
      for (const step of steps) expect(calls(body, step), step).toBe(1);
    }
  });

  it("is the one place a frame's steps are called from: the host and a follower both run it", () => {
    for (const step of [...BEFORE_SYNC, ...WORLD_SOUND, ...AFTER_SYNC, "hike.lampOn", "hike.sound", "hike.command"]) expect(calls(app, step), step).toBe(1);
    // The lamp's state is read through the hike, for the touch layer, in the frame's one touch step.
    expect(bodyOf("frame")).toContain("syncTouch(hike.lampOn(self));");
    // The hike's stare rides the drip's call, after the drips are set.
    const drip = bodyOf("syncDrip");
    expect(drip).toContain("ambient.setDrip(");
    expect(drip.indexOf("hike.sound();")).toBeGreaterThan(drip.indexOf("ambient.setDrip("));
    // Each of the hike's steps is called once in `hike.ts`, in its group's body.
    for (const step of [...HIKE_BEFORE_SYNC, ...HIKE_AFTER_SYNC]) expect(calls(hikeSrc, step), step).toBe(1);
    expect(calls(app, "renderer.sync")).toBe(1);
    // The host draws its own state; a follower the one blended between snapshots at this frame's time.
    expect(bodyOf("runAsHost")).toMatch(/const state: WorldState = host\.world\.state;\s+frame\(host, state, cmd, dt\);/);
    expect(app).toMatch(/const state = client\.renderState\(performance\.now\(\)\);\s+frame\(client, state, cmd, dt\);/);
    expect(calls(app, "frame")).toBe(2);
  });

  it("steps a frame's ticks in one place: each command sampled, filtered by the hike and handed to the session", () => {
    const ticks = bodyOf("stepTicks");
    expect(ticks).toContain("cmd = hike.command(input.sample(++seq), me, live.world);");
    // The hike's own filter of a command, in the hike's `command`: held still in a scene, run to the car, marked taken.
    expect(bodyOf("command", hikeSrc)).toContain("return taken(ranToCar(stilled(sample, me, world), me));");
    expect(ticks).toContain("live.tick(cmd);");
    // The one other sample is the free camera's look at the command just sampled, which takes no new sequence number.
    expect(app.match(/input\.sample\(\+\+seq\)/g)).toHaveLength(1);
    // The host's look at the end scene steps after the frame's ticks are counted and before they run.
    expect(bodyOf("runAsHost")).toMatch(/const ticks = accumulator\.advance\(dt\);\s+hike\.beforeTicks\(\);\s+const cmd = stepTicks\(host, ticks\);/);
    expect(bodyOf("beforeTicks", hikeSrc)).toContain("escapeStep?.();");
    expect(app).toMatch(/const ticks = accumulator\.advance\(dt\);\s+const cmd = stepTicks\(client, ticks\);/);
  });
});

describe("a session's start", () => {
  it("puts the hike back at rest in one place, for the host's session and a follower's alike", () => {
    const rest = bodyOf("hikeAtRest", hikeSrc);
    for (const line of [
      "escalation = ESCALATION_REST;", "woods = WOODS_REST;", "voice = voiceRest(h.seed ^ 0x5a11);", "capAt = undefined;",
      "wasChase = false;", "sceneUntil = -1;", "downLook = null;", "woodsSounds = woodsSoundsFrom(h.seed ^ (Date.now() | 0));",
    ]) {
      expect(rest, line).toContain(line);
    }
    // Written once, in `hike.ts` and nowhere in `app.ts`: the two sessions used to carry a copy each.
    expect(hikeSrc.split("woods = WOODS_REST;").length - 1).toBe(1);
    expect(hikeSrc.split("voice = voiceRest(h.seed ^ 0x5a11);").length - 1).toBe(1);
    expect(app).not.toContain("woods = WOODS_REST;");
    expect(app).not.toContain("voice = voiceRest(");
    // After the match is announced and the governor restarted, before the session's world is wired to the page.
    for (const who of ["host", "client"]) {
      expect(app, who).toMatch(new RegExp(`matchStarted\\("${who}", ${who}\\.world, [^\\n]+\\n    governor\\?\\.restart\\(performance\\.now\\(\\)\\);\\n    hike\\.atRest\\(\\);`));
    }
    expect(calls(app, "hike.atRest")).toBe(2);
  });
});

describe("the hike's own hands on a session", () => {
  it("installs the host's looks in a function of the hike's, where the host's session is made", () => {
    const looks = bodyOf("hikeHostLooks", hikeSrc);
    for (const hand of ["summitPreview = () => {", "standAt = (x, z, yaw) => {", "setLamp = (on) => {", "escapeLook = () => {", "escapeStep = () => {"]) {
      expect(looks, hand).toContain(hand);
      expect(bodyOf("runAsHost"), hand).not.toContain(hand);
    }
    expect(hikeSrc).toContain("    hostStarted: hikeHostLooks,");
    expect(bodyOf("runAsHost")).toMatch(/mode,\n    \}\);\n    hike\.hostStarted\(host\);\n    session = host;/);
  });

  it("puts what the hike reports of a match back at rest in a function of the hike's, when a match starts", () => {
    const rest = bodyOf("hikeReportAtRest", hikeSrc);
    for (const line of ["actsReported = 0;", "lastPhase = Phase.Climb;", "hollowSeen = false;", "lastTargets = null;"]) expect(rest, line).toContain(line);
    expect(bodyOf("matchStarted")).toMatch(/if \(telemetry === null\) return;\n    hike\.matchStarted\(world\);/);
    // The hike's `matchStarted` puts its reading at rest first, then makes the trace with the hike's seed.
    const started = bodyOf("matchStarted", hikeSrc);
    expect(started).toContain("hikeReportAtRest();");
    expect(started.indexOf("hikeReportAtRest();")).toBeLessThan(started.indexOf("trace = createTrace("));
    expect(started).toContain("placeNames(h.seed, graph.features, hikerFirst)");
    expect(bodyOf("matchStarted")).not.toContain("hollowSeen");
  });

  it("lets go of the hike's panels, timers and extras in a function of the hike's, when the page lets go of the hike", () => {
    const gone = bodyOf("disposeHike", hikeSrc);
    const order = ["posterPanel.dispose();", "clearTimeout(deathFadeTimer)", "clearTimeout(deathSoundTimer)", "clearTimeout(endFadeTimer)", "for (const timer of endBeatTimers) clearTimeout(timer);", "disposeExtras();", "prompt.dispose();"];
    const places = order.map((line) => gone.indexOf(line));
    expect(places.every((at) => at >= 0)).toBe(true);
    expect(places).toEqual([...places].sort((a, b) => a - b));
    // The hike's `dispose` drops its trace and then lets go of the rest.
    const disposeBody = bodyOf("dispose", hikeSrc);
    expect(disposeBody).toContain("trace = null;");
    expect(disposeBody.indexOf("trace = null;")).toBeLessThan(disposeBody.indexOf("disposeHike();"));
    expect(app).toMatch(/connectPanel\.dispose\(\);\n      hike\.dispose\(\);\n      touchLayer\.dispose\(\);\n      input\.dispose\(\);/);
    // Every clear of the death's fade timer, all in `hike.ts`, is one the timer being set guards.
    expect(hikeSrc.split("clearTimeout(deathFadeTimer)").length - 1).toBeLessThanOrEqual(hikeSrc.split("deathFadeTimer !== null) clearTimeout(deathFadeTimer)").length - 1);
  });
});

describe("the console's commands on a hike", () => {
  const OWN = ["escalation", "mist", "way", "crowd", "summit", "escape", "stand", "lamp", "end"];

  it("the hike applies its own, and the page asks it before its own", () => {
    const own = bodyOf("applyOwnView", hikeSrc);
    for (const name of OWN) expect(own, name).toContain(`name === "${name}"`);
    // The hike says whether the command was one of its own.
    expect(own).toContain("return false;");
    const page = bodyOf("applyView");
    expect(page).toMatch(/const value = findCommand\(name\)\?\.scriptValue\?\.\(args\);\n    if \(hike\.applyOwnView\(name, args\)\) return;/);
    for (const name of OWN) expect(page, name).not.toContain(`name === "${name}"`);
    // The page's own are still its own.
    for (const name of ["aim", "freecam", "wireframe", "skin", "time", "palette", "weather", "bob", "unsettle", "wind", "volume"]) expect(page, name).toContain(`name === "${name}"`);
  });
});

