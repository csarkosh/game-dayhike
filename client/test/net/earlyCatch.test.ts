import { describe, it, expect } from "vitest";
import { createTelemetry, installErrorCapture, type EarlyCatch, type TelemetryDeps } from "../../src/net/telemetry.js";
import { markedProgress, type Stage } from "../../src/game/loadProgress.js";

function deps() {
  const sent: { events: Record<string, unknown>[] }[] = [];
  const d: TelemetryDeps = {
    now: () => 0,
    send: (_url, body) => {
      sent.push(JSON.parse(body) as { events: Record<string, unknown>[] });
      return Promise.resolve(true);
    },
    beacon: () => true,
    setTimer: () => 1,
    clearTimer: () => undefined,
  };
  return { d, sent };
}

describe("the early catch", () => {
  it("drains what the HTML queued before the bundle ran, then hears the HTML's listeners directly", () => {
    const { d, sent } = deps();
    const t = createTelemetry("u", { sid: "s" }, d);
    const early: EarlyCatch = { q: [{ kind: "uncaught", msg: "ReferenceError: x is not defined", stack: "ReferenceError: x\n    at a.js:1:1" }], on: null };
    const printed: unknown[][] = [];
    const con = { error: (...args: unknown[]) => void printed.push(args), warn: (...args: unknown[]) => void printed.push(args) };
    const uninstall = installErrorCapture(t, { addEventListener: () => undefined }, con, early);
    expect(early.q).toEqual([]);
    expect(early.on).not.toBeNull();
    early.on?.({ kind: "unhandled", msg: "later" });
    con.error("from the console");
    t.flush();
    expect(sent[0]!.events.map((e) => [e.n, e.kind, e.msg])).toEqual([
      ["error", "uncaught", "ReferenceError: x is not defined"],
      ["error", "unhandled", "later"],
      ["error", "console", "from the console"],
    ]);
    expect(printed).toEqual([["from the console"]]);
    uninstall();
    expect(early.on).toBeNull();
  });
});

describe("markedProgress", () => {
  it("names each stage once as its first item starts, and forwards to the bar when there is one", () => {
    const marks: Stage[] = [];
    const calls: string[] = [];
    const inner = {
      total: (s: Stage, n: number) => void calls.push(`total ${s} ${n}`),
      start: (s: Stage, id: string) => void calls.push(`start ${s} ${id}`),
      bytes: () => undefined,
      done: (s: Stage, id: string) => void calls.push(`done ${s} ${id}`),
      gate: () => void calls.push("gate"),
      view: () => ({ bar: 0.5, lines: ["x"], ready: false }),
    };
    const p = markedProgress(inner, (s) => marks.push(s));
    p.total("models", 3);
    p.start("models", "a");
    p.start("models", "b");
    p.done("models", "a");
    p.start("ground", "c0");
    p.gate();
    expect(marks).toEqual(["models", "ground"]);
    expect(calls).toEqual(["total models 3", "start models a", "start models b", "done models a", "start ground c0", "gate"]);
    expect(p.view()).toEqual({ bar: 0.5, lines: ["x"], ready: false });

    const bare = markedProgress(null, (s) => marks.push(s));
    bare.start("world", "ring0");
    expect(marks).toEqual(["models", "ground", "world"]);
    expect(bare.view()).toEqual({ bar: 0, lines: [], ready: false });
  });

  it("names a stage only while the hike is built, at the first of its items to start then, and forwards every item to the bar", () => {
    const marks: Stage[] = [];
    const started: string[] = [];
    const inner = {
      total: () => undefined, start: (s: Stage, id: string) => void started.push(`${s} ${id}`), bytes: () => undefined, done: () => undefined,
      gate: () => undefined, view: () => ({ bar: 0, lines: [], ready: false }),
    };
    let building = false;
    const p = markedProgress(inner, (s) => marks.push(s), () => building);
    // A tier check's renderer loads before the build: the breadcrumb stays the start's own.
    p.start("ground", "ground.grass.webp");
    p.start("models", "tree.glb");
    expect(marks).toEqual([]);
    // The build: each stage at its first item, the ground's though an image of it started before.
    building = true;
    p.start("world", "ring0");
    p.start("ground", "call.elk_bugle");
    p.start("ground", "call.raven_croak");
    expect(marks).toEqual(["world", "ground"]);
    // The game is named: the hike's renderer asks for its models now, and their stage takes no one's place.
    building = false;
    p.start("models", "fern.glb");
    p.start("models", "tree.glb");
    expect(marks).toEqual(["world", "ground"]);
    expect(started).toEqual([
      "ground ground.grass.webp", "models tree.glb", "world ring0", "ground call.elk_bugle", "ground call.raven_croak", "models fern.glb", "models tree.glb",
    ]);
  });
});
