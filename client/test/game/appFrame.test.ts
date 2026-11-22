import { describe, expect, it } from "vitest";
import { sourceText } from "../helpers/source.js";

/**
 * A session's frame is one function, the host's and a follower's alike: the two differ only in
 * where the state drawn comes from and in what the netgraph is told. The order inside it is the
 * hike's as it has always run, and is pinned here for the hike's own half (`hike.ts`); the page's half
 * (`app.ts`) is read by the engine's suite (`test/game/appFrame.test.ts` in the engine's repository).
 */

/** The hike's own half (`createHike`): what `app.ts` calls as `side.<name>`. A variable of `app.ts` it reads is written `h.<name>` there. */
const hikeSrc = sourceText("hike.ts");

/** The body of a function declared in `hike.ts`, from its opening brace to the brace that closes it. */
function bodyOf(name: string, text: string): string {
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

// Inside the hike, each group runs its own steps in this order (`hike.ts`, where each is called as `<name>`).
const HIKE_BEFORE_SYNC = ["syncWayLight", "syncCrowd", "syncWayDraw", "syncAtmosphere"];
const HIKE_AFTER_SYNC = ["syncPrompt", "syncPoster", "syncRoadLine", "syncDeath", "syncOutcome", "syncEndScene"];

describe("a session's frame", () => {
  it("runs its steps in the hike's order: what the sync reads, the sync, the world's sound, the hike's reading of the frame, the draw", () => {
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
    // Each of the hike's steps is called once in `hike.ts`, in its group's body.
    for (const step of [...HIKE_BEFORE_SYNC, ...HIKE_AFTER_SYNC]) expect(calls(hikeSrc, step), step).toBe(1);
  });

  it("steps a frame's ticks in one place: each command sampled, filtered by the hike and handed to the session", () => {
    // The hike's own filter of a command, in the hike's `command`: held still in a scene, run to the car, marked taken.
    expect(bodyOf("command", hikeSrc)).toContain("return taken(ranToCar(stilled(sample, me, world), me));");
    expect(bodyOf("beforeTicks", hikeSrc)).toContain("escapeStep?.();");
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
  });
});

describe("the hike's own hands on a session", () => {
  it("installs the host's looks in a function of the hike's, where the host's session is made", () => {
    const looks = bodyOf("hikeHostLooks", hikeSrc);
    for (const hand of ["summitPreview = () => {", "standAt = (x, z, yaw) => {", "setLamp = (on) => {", "escapeLook = () => {", "escapeStep = () => {"]) {
      expect(looks, hand).toContain(hand);
    }
    expect(hikeSrc).toContain("    hostStarted: hikeHostLooks,");
  });

  it("puts what the hike reports of a match back at rest in a function of the hike's, when a match starts", () => {
    const rest = bodyOf("hikeReportAtRest", hikeSrc);
    for (const line of ["actsReported = 0;", "lastPhase = Phase.Climb;", "hollowSeen = false;", "lastTargets = null;"]) expect(rest, line).toContain(line);
    // The hike's `matchStarted` puts its reading at rest first, then makes the trace with the hike's seed.
    const started = bodyOf("matchStarted", hikeSrc);
    expect(started).toContain("hikeReportAtRest();");
    expect(started.indexOf("hikeReportAtRest();")).toBeLessThan(started.indexOf("trace = createTrace("));
    expect(started).toContain("placeNames(h.seed, graph.features, hikerFirst)");
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
  });
});

describe("the hike's own details of a session", () => {
  it("registers what a world's players can interact with, hears the session's own events and counts its entities, where the page did", () => {
    expect(bodyOf("worldIn", hikeSrc)).toContain("world.interactables.set(1, {");
    expect(bodyOf("worldIn", hikeSrc)).toContain("if (!h.debugOn) return;");
    expect(bodyOf("hears", hikeSrc)).toContain('if (h.debugOn) console.info("[debug] interacted", e);');
    expect(hikeSrc).toContain("entities: (state: WorldState): number => state.players.size + state.enemies.size,");
  });
});

