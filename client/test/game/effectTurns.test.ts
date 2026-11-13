import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { createEffectTurns, spaceEffects } from "../../src/game/effectTurns.js";

const require = createRequire(import.meta.url);
const read = (spec: string): string => readFileSync(require.resolve(spec), "utf8");

/** Lets every microtask asked for so far, and those they ask for, run. */
async function settle(): Promise<void> {
  for (let i = 0; i < 20; i++) await Promise.resolve();
}

/** Turns the test gives by hand: `next()` runs the oldest one asked for. */
function byHand(): { turn(run: () => void): void; next(): void; asked(): number } {
  const runs: (() => void)[] = [];
  return {
    turn: (run) => void runs.push(run),
    next: () => runs.shift()?.(),
    asked: () => runs.length,
  };
}

describe("createEffectTurns", () => {
  it("lets one waiter go a turn, in the order they asked", async () => {
    const hand = byHand();
    const turns = createEffectTurns({ turn: hand.turn });
    const gone: string[] = [];
    void turns.wait().then(() => gone.push("a"));
    void turns.wait().then(() => gone.push("b"));
    void turns.wait().then(() => gone.push("c"));
    await settle();
    expect(gone).toEqual([]);
    expect(turns.waiting()).toBe(3);
    hand.next();
    await settle();
    expect(gone).toEqual(["a"]);
    expect(turns.waiting()).toBe(2);
    hand.next();
    await settle();
    expect(gone).toEqual(["a", "b"]);
    expect(turns.waiting()).toBe(1);
    hand.next();
    await settle();
    expect(gone).toEqual(["a", "b", "c"]);
    expect(turns.waiting()).toBe(0);
  });

  it("asks for one turn at a time: the next only as a waiter goes", async () => {
    const hand = byHand();
    const turns = createEffectTurns({ turn: hand.turn });
    void turns.wait();
    void turns.wait();
    expect(hand.asked()).toBe(1);
    hand.next();
    expect(hand.asked()).toBe(1);
    hand.next();
    await settle();
    expect(hand.asked()).toBe(0);
    expect(turns.waiting()).toBe(0);
  });

  it("gives a wait asked while one is let go the next turn, not the same", async () => {
    const hand = byHand();
    const turns = createEffectTurns({ turn: hand.turn });
    const gone: string[] = [];
    void turns.wait().then(() => {
      gone.push("a");
      void turns.wait().then(() => gone.push("late"));
    });
    hand.next();
    await settle();
    expect(gone).toEqual(["a"]);
    expect(turns.waiting()).toBe(1);
    hand.next();
    await settle();
    expect(gone).toEqual(["a", "late"]);
  });

  it("lets every waiter go at once when disposed, and none wait after", async () => {
    const hand = byHand();
    const turns = createEffectTurns({ turn: hand.turn });
    const gone: string[] = [];
    void turns.wait().then(() => gone.push("a"));
    void turns.wait().then(() => gone.push("b"));
    turns.dispose();
    await settle();
    expect(gone).toEqual(["a", "b"]);
    expect(turns.waiting()).toBe(0);
    const asked = hand.asked();
    void turns.wait().then(() => gone.push("after"));
    await settle();
    expect(gone).toEqual(["a", "b", "after"]);
    expect(hand.asked()).toBe(asked);
    // A turn asked for before the disposal lets nobody go and asks for nothing.
    hand.next();
    expect(hand.asked()).toBe(0);
  });

  it("by default gives each waiter a task of its own", async () => {
    const turns = createEffectTurns();
    let second = false;
    let seenAfterFirst: boolean | null = null;
    const a = turns.wait().then(async () => {
      // Everything the first waiter's continuation does, however long its chain, ends before the
      // second is let go: that is what a task of its own means.
      for (let i = 0; i < 200; i++) await Promise.resolve();
      seenAfterFirst = second;
    });
    const b = turns.wait().then(() => {
      second = true;
    });
    await Promise.all([a, b]);
    expect(seenAfterFirst).toBe(false);
    expect(second).toBe(true);
    turns.dispose();
  });
});

/** An engine as `spaceEffects` reads it: its `createEffect` on its prototype, each call recorded. */
class StandInEngine {
  calls: unknown[][] = [];
  createEffect(...args: unknown[]): string {
    this.calls.push(args);
    return `effect ${this.calls.length}`;
  }
}

describe("spaceEffects", () => {
  it("makes an effect that waits also wait its turn, after what it waited for", async () => {
    const hand = byHand();
    const turns = createEffectTurns({ turn: hand.turn });
    const engine = new StandInEngine();
    spaceEffects(engine, turns);
    const order: string[] = [];
    let release: () => void = () => undefined;
    const given = async (): Promise<void> => {
      await new Promise<void>((resolve) => {
        release = resolve;
      });
      order.push("given");
    };
    const options = { attributes: ["position"], uniformsNames: ["world"], samplers: [], defines: "#define A", extraInitializationsAsync: given };
    expect(engine.createEffect("pbr", options, engine)).toBe("effect 1");
    const [name, passed, third] = engine.calls[0] as [string, typeof options, unknown];
    expect(name).toBe("pbr");
    expect(third).toBe(engine);
    expect(passed).not.toBe(options);
    expect({ ...passed, extraInitializationsAsync: given }).toEqual(options);
    expect(passed.extraInitializationsAsync).not.toBe(given);

    void passed.extraInitializationsAsync().then(() => order.push("ready"));
    await settle();
    // Not in the queue before what it waited for came: an import still loading holds no turn.
    expect(turns.waiting()).toBe(0);
    release();
    await settle();
    expect(order).toEqual(["given"]);
    expect(turns.waiting()).toBe(1);
    hand.next();
    order.push("turn");
    await settle();
    expect(order).toEqual(["given", "turn", "ready"]);
  });

  it("gives a PBR effect made with no wait its turn as its wait", async () => {
    const hand = byHand();
    const turns = createEffectTurns({ turn: hand.turn });
    const engine = new StandInEngine();
    spaceEffects(engine, turns);
    const options = { attributes: ["position"], uniformsNames: ["world"], samplers: [], defines: "#define B", extraInitializationsAsync: undefined };
    engine.createEffect("pbr", options, engine);
    const passed = engine.calls[0]?.[1] as { extraInitializationsAsync?: () => Promise<void> };
    expect(passed).not.toBe(options);
    expect({ ...passed, extraInitializationsAsync: undefined }).toEqual(options);
    // Asked for nothing yet: a turn is taken when the effect waits, not when it is asked for
    // (an effect the engine already has is handed back and never waits).
    expect(turns.waiting()).toBe(0);
    let ready = false;
    void passed.extraInitializationsAsync?.().then(() => {
      ready = true;
    });
    await settle();
    expect(ready).toBe(false);
    expect(turns.waiting()).toBe(1);
    hand.next();
    await settle();
    expect(ready).toBe(true);
  });

  it("spaces the effects of the names it is given, and of no other", () => {
    const turns = createEffectTurns({ turn: byHand().turn });
    const engine = new StandInEngine();
    spaceEffects(engine, turns, ["water"]);
    const pbr = { attributes: [], uniformsNames: [], samplers: [] };
    const water = { attributes: [], uniformsNames: [], samplers: [] };
    engine.createEffect("pbr", pbr, engine);
    engine.createEffect("water", water, engine);
    engine.createEffect({ vertex: "water", fragment: "water" }, water, engine);
    expect(engine.calls[0]?.[1]).toBe(pbr);
    expect(engine.calls[1]?.[1]).not.toBe(water);
    // A name that is not one string (a vertex and a fragment named apart) is not spaced by name.
    expect(engine.calls[2]?.[1]).toBe(water);
  });

  it("passes every other call through as it was given", () => {
    const turns = createEffectTurns({ turn: byHand().turn });
    const engine = new StandInEngine();
    spaceEffects(engine, turns);
    const ready = { attributes: ["position"], uniformsNames: [], samplers: [] };
    const attributes = ["position"];
    const uniforms = ["world"];
    const late = async (): Promise<void> => undefined;
    engine.createEffect("sky", ready, engine);
    engine.createEffect("old", attributes, uniforms, [], "", undefined, undefined, undefined, undefined, 0, late);
    expect(engine.calls[0]?.[1]).toBe(ready);
    expect(engine.calls[1]).toEqual(["old", attributes, uniforms, [], "", undefined, undefined, undefined, undefined, 0, late]);
    expect(engine.calls[1]?.[1]).toBe(attributes);
    expect(turns.waiting()).toBe(0);
  });

  it("calls the engine's own with the engine as `this`", () => {
    const engine = new StandInEngine();
    spaceEffects(engine, createEffectTurns({ turn: byHand().turn }));
    const { createEffect } = engine;
    createEffect("loose", { attributes: [], extraInitializationsAsync: async () => undefined });
    expect(engine.calls).toHaveLength(1);
  });

  it("passes the wait's failure on, having taken no turn", async () => {
    const turns = createEffectTurns({ turn: byHand().turn });
    const engine = new StandInEngine();
    spaceEffects(engine, turns);
    const failing = async (): Promise<void> => {
      throw new Error("no such module");
    };
    engine.createEffect("pbr", { attributes: [], extraInitializationsAsync: failing });
    const passed = engine.calls[0]?.[1] as { extraInitializationsAsync(): Promise<void> };
    await expect(passed.extraInitializationsAsync()).rejects.toThrow("no such module");
    expect(turns.waiting()).toBe(0);
  });

  it("puts the engine's own createEffect back", () => {
    const engine = new StandInEngine();
    const restore = spaceEffects(engine, createEffectTurns({ turn: byHand().turn }));
    expect(Object.hasOwn(engine, "createEffect")).toBe(true);
    restore();
    expect(Object.hasOwn(engine, "createEffect")).toBe(false);
    expect(engine.createEffect).toBe(StandInEngine.prototype.createEffect);
    const options = { attributes: [], extraInitializationsAsync: async () => undefined };
    engine.createEffect("pbr", options);
    expect(engine.calls[0]?.[1]).toBe(options);
  });

  it("leaves a wrap put on after its own where it is", () => {
    const engine = new StandInEngine();
    const restore = spaceEffects(engine, createEffectTurns({ turn: byHand().turn }));
    const later = (): string => "later";
    (engine as { createEffect: unknown }).createEffect = later;
    restore();
    expect(engine.createEffect).toBe(later);
  });
});

describe("the Babylon the spacing relies on", () => {
  it("has a PBR material's first effect wait for its shader's import, in its options", () => {
    const source = read("@babylonjs/core/Materials/PBR/pbrBaseMaterial.pure.js");
    expect(source).toMatch(/extraInitializationsAsync: this\._shadersLoaded\s*\? undefined\s*: async \(\) => \{/);
    expect(source).toMatch(/const effect = engine\.createEffect\(shaderName, \{\s*attributes: attribs,/);
  });

  it("has an effect take the wait from its options and await it before it processes its shader", () => {
    const source = read("@babylonjs/core/Materials/effect.pure.js");
    expect(source).toContain("extraInitializationsAsync = options.extraInitializationsAsync;");
    expect(source).toMatch(
      /async _processShaderCodeAsync\([^)]*extraInitializationsAsync\) \{\s*if \(extraInitializationsAsync\) \{\s*await extraInitializationsAsync\(\);\s*\}/,
    );
  });

  it("has the WebGPU engine read options by their attributes, and pass the options' wait on", () => {
    const source = read("@babylonjs/core/Engines/webgpuEngine.pure.js");
    expect(source).toContain("const isOptions = attributesNamesOrOptions.attributes !== undefined;");
    expect(source).toContain("attributesNamesOrOptions.extraInitializationsAsync ?? extraInitializationsAsync");
  });
});

describe("the WebGPU engine's start", () => {
  it("spaces its effects once it stands, and lets them all go when the engine does", () => {
    const source = readFileSync(new URL("../../src/game/gpuEngine.ts", import.meta.url), "utf8");
    expect(source).toMatch(
      /installPipelines\(engine, options\.pipelines \?\? "async"\);[\s\S]{0,600}const turns = createEffectTurns\(\);\s*const unspace = spaceEffects\(engine, turns\);\s*engine\.onDisposeObservable\.addOnce\(\(\) => \{\s*unspace\(\);\s*turns\.dispose\(\);\s*\}\);/,
    );
  });
});
