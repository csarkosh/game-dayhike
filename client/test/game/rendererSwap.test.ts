import { describe, it, expect, vi } from "vitest";
import type { QualityTier } from "@csarkosh/engine/game/quality";
import type { Renderer } from "../../src/game/rendererTypes.js";
import {
  APPLY_SWAP_READY_MAX_MS,
  GOVERNOR_SWAP_READY_MAX_MS,
  buildFirstRenderer,
  buildOrUndo,
  swapRenderer,
  switchOutcome,
  whenStandingSkyHeld,
  type SwapBindings,
} from "../../src/game/rendererSwap.js";

/**
 * The swap's order and its ladders, on stand-in renderers: no engine is made
 * here and none is loaded.
 */

// ---- the order, with stubs --------------------------------------------------

function stubRenderer(id: string, log: string[], sky: Promise<void> = Promise.resolve()): Renderer {
  return {
    id,
    engine: {},
    stopLoop: () => log.push(`stop ${id}`),
    runLoop: () => log.push(`run ${id}`),
    scene: { id },
    skyReady: () => sky,
    dispose: () => log.push(`dispose ${id}`),
  } as unknown as Renderer;
}

/** One turn of the event loop: a held sky's start has run. */
const flush = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

function stubCanvas(id: string, log: string[]): HTMLCanvasElement {
  return {
    id,
    style: {},
    replaceWith: (next: { id: string }) => log.push(`replace ${id} with ${next.id}`),
  } as unknown as HTMLCanvasElement;
}

const idOf = (x: unknown): string => (x as { id: string }).id;

function stubBindings(
  log: string[],
  failing: ReadonlySet<QualityTier> = new Set(),
  restoreFailing: ReadonlySet<QualityTier> = new Set(),
): SwapBindings {
  let n = 0;
  return {
    freshCanvas: () => {
      n += 1;
      log.push(`fresh c${n}`);
      return stubCanvas(`c${n}`, log);
    },
    build: (canvas, tier) => {
      log.push(`build ${idOf(canvas)} ${tier}`);
      if (failing.has(tier)) throw new Error(`no ${tier}`);
      return stubRenderer(`${tier}@${idOf(canvas)}`, log);
    },
    unwatch: () => log.push("unwatch"),
    watch: (r) => log.push(`watch ${idOf(r)}`),
    extras: { dispose: () => log.push("extras dispose"), build: (r) => log.push(`extras build ${idOf(r)}`) },
    rebind: (canvas) => log.push(`rebind ${idOf(canvas)}`),
    restore: (r) => {
      log.push(`restore ${idOf(r)}`);
      const tier = idOf(r).split("@")[0] as QualityTier;
      if (restoreFailing.has(tier)) throw new Error(`restore ${tier}`);
    },
    loop: () => undefined,
  };
}

describe("swapRenderer's order", () => {
  it("tears the old renderer down first, then builds on a fresh canvas and rebinds", async () => {
    const log: string[] = [];
    const got = swapRenderer(
      { renderer: stubRenderer("medium@c0", log), canvas: stubCanvas("c0", log) },
      { tier: "high", fallbackTier: "medium" },
      stubBindings(log),
    );
    await flush();
    expect(got.tier).toBe("high");
    expect(got.fellBack).toBe(false);
    expect((got.canvas as unknown as { style: { touchAction?: string } }).style.touchAction).toBe("none");
    expect(log).toEqual([
      "stop medium@c0",
      "unwatch",
      "extras dispose",
      "dispose medium@c0",
      "fresh c1",
      "replace c0 with c1",
      "build c1 high",
      "restore high@c1",
      "extras build high@c1",
      "rebind c1",
      "run high@c1",
    ]);
  });

  it("rebuilds the running tier when the new build throws, then low, and throws when every rung fails", async () => {
    const log: string[] = [];
    const quiet = vi.spyOn(console, "error").mockImplementation(() => undefined);
    try {
      const got = swapRenderer(
        { renderer: stubRenderer("medium@c0", log), canvas: stubCanvas("c0", log) },
        { tier: "high", fallbackTier: "medium" },
        stubBindings(log, new Set<QualityTier>(["high"])),
      );
      await flush();
      expect(got.tier).toBe("medium");
      expect(got.fellBack).toBe(true);
      // Each rung on a canvas of its own: the failed one's is left.
      expect(log.slice(4)).toEqual([
        "fresh c1",
        "replace c0 with c1",
        "build c1 high",
        "fresh c2",
        "replace c1 with c2",
        "build c2 medium",
        "restore medium@c2",
        "extras build medium@c2",
        "rebind c2",
        "run medium@c2",
      ]);
      // The running tier fails too: one more try at low, the tier least likely to fail.
      const log2: string[] = [];
      const low = swapRenderer(
        { renderer: stubRenderer("medium@c0", log2), canvas: stubCanvas("c0", log2) },
        { tier: "high", fallbackTier: "medium" },
        stubBindings(log2, new Set<QualityTier>(["high", "medium"])),
      );
      await flush();
      expect(low.tier).toBe("low");
      expect(low.fellBack).toBe(true);
      expect(log2.slice(-5)).toEqual(["build c3 low", "restore low@c3", "extras build low@c3", "rebind c3", "run low@c3"]);
      const log3: string[] = [];
      expect(() =>
        swapRenderer(
          { renderer: stubRenderer("medium@c0", log3), canvas: stubCanvas("c0", log3) },
          { tier: "high", fallbackTier: "medium" },
          stubBindings(log3, new Set<QualityTier>(["high", "medium", "low"])),
        ),
      ).toThrow("no low");
    } finally {
      quiet.mockRestore();
    }
  });
});

describe("a swap's first frame", () => {
  it("waits for the new renderer's sky: its loop runs only once the sky is held", async () => {
    const log: string[] = [];
    let hold = (): void => undefined;
    const sky = new Promise<void>((resolve) => {
      hold = resolve;
    });
    const bindings = stubBindings(log);
    bindings.build = (canvas, tier) => {
      log.push(`build ${idOf(canvas)} ${tier}`);
      return stubRenderer(`${tier}@${idOf(canvas)}`, log, sky);
    };
    swapRenderer({ renderer: stubRenderer("medium@c0", log), canvas: stubCanvas("c0", log) }, { tier: "high", fallbackTier: "medium" }, bindings);
    await flush();
    expect(log.at(-1)).toBe("rebind c1");
    expect(log.some((line) => line.startsWith("run"))).toBe(false);
    hold();
    await flush();
    expect(log.at(-1)).toBe("run high@c1");
    expect(log.filter((line) => line.startsWith("run"))).toEqual(["run high@c1"]);
  });
});

describe("a rung taken down after its loop was promised", () => {
  it("starts no loop, though its sky was held: only the rung that stands runs", async () => {
    const log: string[] = [];
    const quiet = vi.spyOn(console, "error").mockImplementation(() => undefined);
    try {
      // A renderer with a watch of its own, as the hike's is; putting the first rung's on throws.
      const b = stubBindings(log);
      const bindings: SwapBindings = {
        ...b,
        build: (canvas, tier) => Object.assign(b.build(canvas, tier), { ownWatch: () => () => undefined }),
        watch: (r) => {
          log.push(`watch ${idOf(r)}`);
          if (idOf(r) === "high@c1") throw new Error("watch high");
        },
      };
      const got = swapRenderer({ renderer: stubRenderer("medium@c0", log), canvas: stubCanvas("c0", log) }, { tier: "high", fallbackTier: "medium" }, bindings);
      await flush();
      expect(idOf(got.renderer)).toBe("medium@c2");
      expect(log).toContain("dispose high@c1");
      expect(log.filter((line) => line.startsWith("run"))).toEqual(["run medium@c2"]);
    } finally {
      quiet.mockRestore();
    }
  });
});

describe("a renderer's own watch on the engine it made", () => {
  /** A renderer with a watch of its own, as the hike's is. */
  const selfWatched = (log: string[], failing: ReadonlySet<QualityTier> = new Set()): SwapBindings => {
    const b = stubBindings(log, failing);
    return {
      ...b,
      build: (canvas, tier) => Object.assign(b.build(canvas, tier), { ownWatch: () => () => undefined }),
      watch: (r, detector) => log.push(`watch ${idOf(r)} ${detector === (r as { ownWatch?: unknown }).ownWatch ? "by its own watch" : "by another"}`),
    };
  };

  it("is listened to through its own watch once its rung stands, at the hike's start and after a swap", async () => {
    const first: string[] = [];
    const got = buildFirstRenderer(stubCanvas("c0", first), ["high", "low"], selfWatched(first));
    expect([got.tier, got.fellBack]).toEqual(["high", false]);
    expect(first).toEqual(["build c0 high", "watch high@c0 by its own watch"]);
    const log: string[] = [];
    const swapped = swapRenderer({ renderer: stubRenderer("low@c0", log), canvas: stubCanvas("c0", log) }, { tier: "high", fallbackTier: "low" }, selfWatched(log));
    await flush();
    expect(swapped.tier).toBe("high");
    expect(log.slice(-3)).toEqual(["rebind c1", "watch high@c1 by its own watch", "run high@c1"]);
    // The old one's watch came off before anything of it went.
    expect(log.indexOf("unwatch")).toBeLessThan(log.indexOf("dispose low@c0"));
  });

  it("is not listened to where its rung failed: the rung that stands is", async () => {
    const log: string[] = [];
    const quiet = vi.spyOn(console, "error").mockImplementation(() => undefined);
    try {
      const got = swapRenderer(
        { renderer: stubRenderer("medium@c0", log), canvas: stubCanvas("c0", log) },
        { tier: "high", fallbackTier: "medium" },
        selfWatched(log, new Set<QualityTier>(["high"])),
      );
      await flush();
      expect([got.tier, got.fellBack]).toEqual(["medium", true]);
      expect(log.filter((line) => line.startsWith("watch"))).toEqual(["watch medium@c2 by its own watch"]);
    } finally {
      quiet.mockRestore();
    }
  });

  it("is listened to by nothing where the renderer offers no watch", () => {
    const log: string[] = [];
    buildFirstRenderer(stubCanvas("c0", log), ["low"], stubBindings(log));
    expect(log).toEqual(["build c0 low"]);
  });
});

describe("a swap that throws before its first rung", () => {
  it("builds nothing and lets the throw go up, when the old renderer's dispose or the fresh canvas throws", () => {
    for (const where of ["old dispose", "fresh canvas"] as const) {
      const log: string[] = [];
      const old = stubRenderer("low@c0", log);
      const bindings = stubBindings(log);
      if (where === "old dispose") {
        (old as unknown as { dispose(): void }).dispose = () => {
          throw new Error("old dispose");
        };
      } else {
        bindings.freshCanvas = () => {
          throw new Error("fresh canvas");
        };
      }
      expect(() => swapRenderer({ renderer: old, canvas: stubCanvas("c0", log) }, { tier: "high", fallbackTier: "low" }, bindings)).toThrow(where);
      expect(log.some((line) => line.startsWith("build"))).toBe(false);
    }
  });
});

describe("a throw after the build", () => {
  it("disposes the renderer just built, with what was built into its scene, and falls back", async () => {
    const log: string[] = [];
    const quiet = vi.spyOn(console, "error").mockImplementation(() => undefined);
    try {
      const got = swapRenderer(
        { renderer: stubRenderer("medium@c0", log), canvas: stubCanvas("c0", log) },
        { tier: "high", fallbackTier: "medium" },
        stubBindings(log, new Set(), new Set<QualityTier>(["high"])),
      );
      await flush();
      expect(got.tier).toBe("medium");
      expect(log.slice(4)).toEqual([
        "fresh c1",
        "replace c0 with c1",
        "build c1 high",
        "restore high@c1",
        "extras dispose",
        "dispose high@c1",
        "fresh c2",
        "replace c1 with c2",
        "build c2 medium",
        "restore medium@c2",
        "extras build medium@c2",
        "rebind c2",
        "run medium@c2",
      ]);
    } finally {
      quiet.mockRestore();
    }
  });
});

describe("the bound a switch's cover waits under", () => {
  it("is the governor's 10 s over play and the Apply's 20 s on the pause screen, each handed whole to the new scene's wait", () => {
    // A canvas is made at once, so nothing is taken off either before the scene's wait (`Renderer.whenReady`).
    expect(GOVERNOR_SWAP_READY_MAX_MS).toBe(10_000);
    expect(APPLY_SWAP_READY_MAX_MS).toBe(20_000);
  });
});

describe("switchOutcome", () => {
  it("keeps a choice the switch reached, and keeps the choice as it was after a fallback", () => {
    expect(switchOutcome("high", { tier: "high", fellBack: false })).toEqual({ save: "high", line: null });
    expect(switchOutcome("high", { tier: "medium", fellBack: true })).toEqual({ save: null, line: "Could not switch; still using Medium." });
    expect(switchOutcome("auto", { tier: "low", fellBack: true })).toEqual({ save: null, line: "Could not switch; still using Low." });
  });
});

describe("buildFirstRenderer", () => {
  it("builds the tier asked for on the page's canvas, and each fallback on a fresh one", () => {
    const log: string[] = [];
    const quiet = vi.spyOn(console, "error").mockImplementation(() => undefined);
    try {
      const b = stubBindings(log, new Set<QualityTier>(["high"]));
      const got = buildFirstRenderer(stubCanvas("c0", log), ["high", "medium", "low"], b);
      expect(got.tier).toBe("medium");
      expect(got.fellBack).toBe(true);
      expect(idOf(got.canvas)).toBe("c1");
      expect((got.canvas as unknown as { style: { touchAction?: string } }).style.touchAction).toBe("none");
      expect(log).toEqual(["build c0 high", "fresh c1", "replace c0 with c1", "build c1 medium"]);
      const straight: string[] = [];
      const first = buildFirstRenderer(stubCanvas("c0", straight), ["high", "low"], stubBindings(straight));
      expect([first.tier, first.fellBack, idOf(first.canvas)]).toEqual(["high", false, "c0"]);
      expect(straight).toEqual(["build c0 high"]);
      expect(() => buildFirstRenderer(stubCanvas("c0", []), ["high", "low"], stubBindings([], new Set<QualityTier>(["high", "low"])))).toThrow("no low");
    } finally {
      quiet.mockRestore();
    }
  });
});

describe("buildOrUndo", () => {
  it("undoes what a build made, newest first, when it throws, and nothing when it returns", () => {
    const undone: string[] = [];
    expect(() =>
      buildOrUndo((made) => {
        made(() => undone.push("engine"));
        made(() => {
          undone.push("listener");
          throw new Error("undo failed");
        });
        made(() => undone.push("audio"));
        throw new Error("build failed");
      }),
    ).toThrow("build failed");
    expect(undone).toEqual(["audio", "listener", "engine"]);
    const kept: string[] = [];
    expect(buildOrUndo((made) => {
      made(() => kept.push("x"));
      return 7;
    })).toBe(7);
    expect(kept).toEqual([]);
  });
});

describe("the hike's start across a swap", () => {
  /** A renderer whose sky is held once `hold` is called. */
  function skyOf(id: string): { renderer: Renderer; hold(): void } {
    let hold = (): void => undefined;
    const sky = new Promise<void>((resolve) => {
      hold = resolve;
    });
    return { renderer: { id, skyReady: () => sky } as unknown as Renderer, hold: () => hold() };
  }

  it("ends with the first renderer's sky when no swap comes", async () => {
    const first = skyOf("first");
    let held = false;
    void whenStandingSkyHeld(() => first.renderer, () => new Promise(() => undefined)).then(() => (held = true));
    await flush();
    expect(held).toBe(false);
    first.hold();
    await flush();
    expect(held).toBe(true);
  });

  it("is not stranded by a swap made before the sky's slices arrive: it waits for the new renderer's sky, and the old one's ends nothing", async () => {
    const first = skyOf("first");
    const next = skyOf("next");
    let standing = first.renderer;
    let tell = (): void => undefined;
    let waits = 0;
    const nextSwap = (): Promise<void> => {
      waits += 1;
      return new Promise((resolve) => (tell = resolve));
    };
    let held = false;
    void whenStandingSkyHeld(() => standing, nextSwap).then(() => (held = true));
    await flush();
    // The swap: the renderer standing changes, and the wait is told once.
    standing = next.renderer;
    tell();
    await flush();
    expect(held).toBe(false);
    expect(waits).toBe(2);
    // The old renderer's sky, should it ever come, is no longer the hike's.
    first.hold();
    await flush();
    expect(held).toBe(false);
    next.hold();
    await flush();
    expect(held).toBe(true);
  });
});
