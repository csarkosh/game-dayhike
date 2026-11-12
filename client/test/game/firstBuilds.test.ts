import { describe, expect, it } from "vitest";
import { createFirstBuilds } from "../../src/game/firstBuilds.js";
import type { Slices } from "../../src/game/syncJobs.js";

/** A loader whose turns the test runs by hand, on a clock the slices advance. */
function rig(sliceMs = 8) {
  const turns: (() => void)[] = [];
  const clock = { t: 0 };
  const loader = createFirstBuilds({ now: () => clock.t, later: (run) => void turns.push(run), sliceMs });
  /** Runs every turn asked for, and those they ask for; how many ran. */
  const drain = (): number => {
    let n = 0;
    while (turns.length > 0) { n++; turns.shift()!(); }
    return n;
  };
  return { loader, turns, clock, drain };
}
/** A build of `n` slices of `ms` each, logging its name once a slice; `ended` says its generator was closed. */
function build(name: string, n: number, ms: number, clock: { t: number }, log: string[], ended: string[] = []): Slices {
  return (function* (): Slices {
    try {
      for (let i = 0; i < n; i++) { clock.t += ms; log.push(name); yield; }
    } finally {
      ended.push(name);
    }
  })();
}

describe("a hike's first builds, stepped", () => {
  it("steps a build in turns of sliceMs and is idle when it ends", async () => {
    const r = rig();
    const log: string[] = [];
    let idle = false;
    r.loader.add({}, build("forest", 10, 3, r.clock, log), "forest");
    void r.loader.idle().then(() => { idle = true; });
    expect(r.loader.pending()).toBe(1);
    expect(log).toEqual([]); // nothing runs in the call that queued it
    // 3 ms a slice against 8: three slices a turn (9 ms), so ten slices are four turns.
    r.turns.shift()!();
    expect(log).toHaveLength(3);
    expect(r.drain()).toBe(3);
    expect(log).toHaveLength(10);
    expect(r.loader.pending()).toBe(0);
    await Promise.resolve();
    expect(idle).toBe(true);
  });
  it("is idle at once with nothing queued", async () => {
    const r = rig();
    let idle = false;
    void r.loader.idle().then(() => { idle = true; });
    await Promise.resolve();
    expect(idle).toBe(true);
  });
  it("asks for no turn while nothing is queued", () => {
    const r = rig();
    expect(r.turns).toHaveLength(0);
    r.loader.add({}, build("a", 1, 1, r.clock, []), "a");
    expect(r.turns).toHaveLength(1);
    r.drain();
    expect(r.turns).toHaveLength(0);
  });
  it("runs builds one at a time, in the order they were added", () => {
    const r = rig();
    const log: string[] = [];
    r.loader.add({}, build("forest", 4, 5, r.clock, log), "forest");
    r.loader.add({}, build("clutter", 3, 5, r.clock, log), "clutter");
    expect(r.loader.pending()).toBe(2);
    r.drain();
    expect(log).toEqual(["forest", "forest", "forest", "forest", "clutter", "clutter", "clutter"]);
  });
  it("replaces an owner's queued build and ends the one it replaced", () => {
    const r = rig();
    const log: string[] = [];
    const ended: string[] = [];
    const owner = {};
    r.loader.add(owner, build("old", 5, 9, r.clock, log, ended), "forest");
    r.turns.shift()!(); // one slice of the old build has run
    r.loader.add(owner, build("new", 2, 9, r.clock, log, ended), "forest");
    expect(ended).toEqual(["old"]);
    expect(r.loader.pending()).toBe(1);
    r.drain();
    expect(log).toEqual(["old", "new", "new"]);
  });
  it("says whether an owner has a build queued or in hand", () => {
    const r = rig();
    const owner = {};
    expect(r.loader.queued(owner)).toBe(false);
    r.loader.add(owner, build("forest", 2, 9, r.clock, []), "forest");
    expect(r.loader.queued(owner)).toBe(true);
    expect(r.loader.queued({})).toBe(false);
    r.drain();
    expect(r.loader.queued(owner)).toBe(false);
  });
  it("drops an owner's build on cancel", async () => {
    const r = rig();
    const log: string[] = [];
    const ended: string[] = [];
    const owner = {};
    r.loader.add(owner, build("props", 5, 9, r.clock, log, ended), "props");
    r.turns.shift()!();
    r.loader.cancel(owner);
    expect(ended).toEqual(["props"]);
    expect(r.loader.pending()).toBe(0);
    r.drain();
    expect(log).toEqual(["props"]);
    let idle = false;
    void r.loader.idle().then(() => { idle = true; });
    await Promise.resolve();
    expect(idle).toBe(true);
  });
  it("runs what is left to its end on close, in order, and is closed after", async () => {
    const r = rig();
    const log: string[] = [];
    r.loader.add({}, build("forest", 3, 9, r.clock, log), "forest");
    r.loader.add({}, build("clutter", 2, 9, r.clock, log), "clutter");
    let idle = false;
    void r.loader.idle().then(() => { idle = true; });
    expect(r.loader.open).toBe(true);
    r.loader.close();
    expect(log).toEqual(["forest", "forest", "forest", "clutter", "clutter"]);
    expect(r.loader.open).toBe(false);
    expect(r.loader.pending()).toBe(0);
    await Promise.resolve();
    expect(idle).toBe(true);
    // A turn asked for before the close finds nothing to do.
    expect(() => r.drain()).not.toThrow();
  });
  it("runs a build handed to it after it closed at once, whole", () => {
    const r = rig();
    const log: string[] = [];
    r.loader.close();
    r.loader.add({}, build("late", 3, 9, r.clock, log), "late");
    expect(log).toEqual(["late", "late", "late"]);
    expect(r.loader.pending()).toBe(0);
  });
  it("runs nothing on dispose, ends what was queued, and is idle", async () => {
    const r = rig();
    const log: string[] = [];
    const ended: string[] = [];
    r.loader.add({}, build("forest", 3, 9, r.clock, log, ended), "forest");
    r.loader.add({}, build("clutter", 2, 9, r.clock, log, ended), "clutter");
    r.turns.shift()!();
    r.loader.dispose();
    // The forest's build had begun and is closed; the ground cover's had not, and never runs.
    expect(ended).toEqual(["forest"]);
    r.drain();
    expect(log).toEqual(["forest"]);
    expect(r.loader.open).toBe(false);
    let idle = false;
    void r.loader.idle().then(() => { idle = true; });
    await Promise.resolve();
    expect(idle).toBe(true);
    // And nothing handed to a disposed loader runs.
    r.loader.add({}, build("late", 2, 9, r.clock, log, ended), "late");
    expect(log).toEqual(["forest"]);
    expect(r.loader.pending()).toBe(0);
  });
  it("lets the other builds go on when one throws, and lets the error be seen", () => {
    const r = rig();
    const log: string[] = [];
    const bad = (function* (): Slices { r.clock.t += 9; yield; throw new Error("a shell broke"); })();
    r.loader.add({}, bad, "bad");
    r.loader.add({}, build("clutter", 2, 9, r.clock, log), "clutter");
    r.turns.shift()!(); // the bad build's first slice
    expect(() => r.turns.shift()!()).toThrow("a shell broke");
    expect(r.loader.pending()).toBe(1);
    r.drain();
    expect(log).toEqual(["clutter", "clutter"]);
  });
});
