import { describe, it, expect } from "vitest";
import type { AbstractEngine } from "@babylonjs/core/Engines/abstractEngine.js";
import { adoptEngine, dropEngine, keepEngine, pinShaders, takeEngine, type KeptEngine } from "../../src/game/keptEngine.js";

const fakeEngine = (webgpu: boolean): AbstractEngine => ({ isWebGPU: webgpu, isDisposed: false }) as unknown as AbstractEngine;
const kept = (webgpu: boolean, tier: KeptEngine["tier"] = "high"): KeptEngine => ({
  canvas: {} as HTMLCanvasElement,
  engine: fakeEngine(webgpu),
  watchers: null,
  tier,
});

describe("the engine a hike leaves for the next", () => {
  it("hands a WebGPU engine on as the next hike's engine, on its canvas, once", () => {
    const released: AbstractEngine[] = [];
    const release = (e: AbstractEngine): void => void released.push(e);
    const k = kept(true);
    keepEngine(k, release);
    expect(takeEngine(true, "high", release)).toEqual({ canvas: k.canvas, engine: k.engine, watchers: null });
    expect(takeEngine(true, "high", release)).toBeNull();
    expect(released).toEqual([]);
  });

  it("leaves a WebGL2 engine on its canvas for the renderer, so no engine is given", () => {
    const release = (): void => undefined;
    const k = kept(false);
    keepEngine(k, release);
    expect(takeEngine(false, "high", release)).toEqual({ canvas: k.canvas, engine: null, watchers: null });
    expect(adoptEngine(k.canvas)).toBe(k.engine);
    expect(adoptEngine(k.canvas)).toBeNull();
    expect(adoptEngine({} as HTMLCanvasElement)).toBeNull();
  });

  it("lets go of one that is another engine or another tier, and of one kept before another", () => {
    const released: AbstractEngine[] = [];
    const release = (e: AbstractEngine): void => void released.push(e);
    const first = kept(true);
    const second = kept(true);
    keepEngine(first, release);
    keepEngine(second, release);
    expect(released).toEqual([first.engine]);
    expect(takeEngine(false, "high", release)).toBeNull();
    expect(released).toEqual([first.engine, second.engine]);
    const third = kept(false, "medium");
    keepEngine(third, release);
    expect(takeEngine(false, "high", release)).toBeNull();
    expect(released.at(-1)).toBe(third.engine);
    const fourth = kept(false);
    keepEngine(fourth, release);
    dropEngine(release);
    expect(released.at(-1)).toBe(fourth.engine);
    expect(takeEngine(false, "high", release)).toBeNull();
  });

  it("never hands on an engine something else disposed", () => {
    const release = (): void => undefined;
    const k = kept(true);
    keepEngine(k, release);
    (k.engine as { isDisposed: boolean }).isDisposed = true;
    expect(takeEngine(true, "high", release)).toBeNull();
  });
});

describe("pinning the compiled shaders", () => {
  type FakeEffect = {
    isReady(): boolean;
    getCompilationError(): string;
    _refCount: number;
    _processCodeAfterIncludes: unknown;
    onCompiled: unknown;
    onError: unknown;
  };
  const effect = (over: Partial<{ ready: boolean; error: string }> = {}): FakeEffect => ({
    isReady: () => over.ready ?? true,
    getCompilationError: () => over.error ?? "",
    _refCount: 1,
    _processCodeAfterIncludes: () => "code",
    onCompiled: () => undefined,
    onError: () => undefined,
  });
  const engineWith = (cache: Record<string, FakeEffect>): AbstractEngine =>
    ({ _compiledEffects: cache }) as unknown as AbstractEngine;

  it("holds each clean effect once, and drops the compile's hooks, which held the hike that compiled it", () => {
    const clean = effect();
    const failed = effect({ error: "boom" });
    const engine = engineWith({ clean, failed });
    pinShaders(engine);
    pinShaders(engine);
    // Once, however many sweeps; the compile-time hooks are gone with the pin.
    expect(clean._refCount).toBe(2);
    expect(clean._processCodeAfterIncludes).toBeUndefined();
    expect(clean.onCompiled).toBeNull();
    expect(clean.onError).toBeNull();
    // A failed effect is left exactly as it was.
    expect(failed._refCount).toBe(1);
    expect(failed._processCodeAfterIncludes).toBeTypeOf("function");
  });

  it("leaves an effect still compiling for a later sweep", () => {
    let ready = false;
    const slow: FakeEffect = { ...effect(), isReady: () => ready };
    const engine = engineWith({ slow });
    pinShaders(engine);
    expect(slow._refCount).toBe(1);
    expect(slow._processCodeAfterIncludes).toBeTypeOf("function");
    ready = true;
    pinShaders(engine);
    expect(slow._refCount).toBe(2);
    expect(slow._processCodeAfterIncludes).toBeUndefined();
  });
});
