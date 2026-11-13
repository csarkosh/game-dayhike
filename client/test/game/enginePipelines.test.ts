import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { mipmapPipelineAhead, withoutEagerPipelines } from "../../src/game/enginePipelines.js";

const require = createRequire(import.meta.url);
const read = (spec: string): string => readFileSync(require.resolve(spec), "utf8");

/** An engine as Babylon's holds its texture manager: `_textureHelper`, set once the manager is made. */
type StandInEngine = { _textureHelper?: unknown };

/**
 * A texture manager as Babylon's is to `withoutEagerPipelines`: its constructor calls both getters,
 * as Babylon's does, and each getter counts the calls that reached it.
 */
function managerClass(): { new (engine: StandInEngine): { made: string[]; _getPipeline(format: string): string; _getVideoPipeline(format: string): string }; prototype: object } {
  return class Manager {
    made: string[] = [];
    _engine: StandInEngine;
    constructor(engine: StandInEngine) {
      this._engine = engine;
      this._getPipeline("rgba8unorm");
      this._getVideoPipeline("rgba8unorm");
    }
    _getPipeline(format: string): string {
      this.made.push(`mipmap ${format}`);
      return `mipmap ${format}`;
    }
    _getVideoPipeline(format: string): string {
      this.made.push(`video ${format}`);
      return `video ${format}`;
    }
  };
}

/** Makes a manager as the engine's start does: constructed, then held by its engine. */
function start<M>(Manager: new (engine: StandInEngine) => M): M {
  const engine: StandInEngine = {};
  const manager = new Manager(engine);
  engine._textureHelper = manager;
  return manager;
}

describe("withoutEagerPipelines", () => {
  it("has a manager made inside the start make neither pipeline, and Babylon's own on its next calls", async () => {
    const Manager = managerClass();
    const manager = await withoutEagerPipelines(Manager, async () => start(Manager));
    expect(manager.made).toEqual([]);
    expect(manager._getPipeline("rgba8unorm")).toBe("mipmap rgba8unorm");
    expect(manager._getVideoPipeline("rgba8unorm")).toBe("video rgba8unorm");
    expect(manager.made).toEqual(["mipmap rgba8unorm", "video rgba8unorm"]);
  });

  it("skips only the constructor's calls: a held manager's call inside the start is Babylon's own", async () => {
    const Manager = managerClass();
    await withoutEagerPipelines(Manager, async () => {
      const manager = start(Manager);
      expect(manager.made).toEqual([]);
      expect(manager._getPipeline("rgba16float")).toBe("mipmap rgba16float");
      expect(manager._getVideoPipeline("rgba8unorm")).toBe("video rgba8unorm");
    });
  });

  it("leaves another engine's manager, made before, as it was while a start is under way", async () => {
    const Manager = managerClass();
    const before = start(Manager);
    before.made.length = 0;
    await withoutEagerPipelines(Manager, async () => {
      // Its first call inside the window, and not from a constructor: never skipped.
      expect(before._getPipeline("rgba8unorm-srgb")).toBe("mipmap rgba8unorm-srgb");
    });
    expect(before.made).toEqual(["mipmap rgba8unorm-srgb"]);
  });

  it("puts the prototype's own methods back when the start resolves, and a manager made after makes both", async () => {
    const Manager = managerClass();
    const proto = Manager.prototype as { _getPipeline: unknown; _getVideoPipeline: unknown };
    const { _getPipeline, _getVideoPipeline } = proto;
    await withoutEagerPipelines(Manager, async () => {
      expect(proto._getPipeline).not.toBe(_getPipeline);
      expect(proto._getVideoPipeline).not.toBe(_getVideoPipeline);
    });
    expect(proto._getPipeline).toBe(_getPipeline);
    expect(proto._getVideoPipeline).toBe(_getVideoPipeline);
    expect(start(Manager).made).toEqual(["mipmap rgba8unorm", "video rgba8unorm"]);
  });

  it("puts them back when the start rejects, and passes the rejection on", async () => {
    const Manager = managerClass();
    const proto = Manager.prototype as { _getPipeline: unknown; _getVideoPipeline: unknown };
    const { _getPipeline, _getVideoPipeline } = proto;
    await expect(
      withoutEagerPipelines(Manager, async () => {
        throw new Error("no adapter");
      }),
    ).rejects.toThrow("no adapter");
    expect(proto._getPipeline).toBe(_getPipeline);
    expect(proto._getVideoPipeline).toBe(_getVideoPipeline);
  });

  it("keeps the wrap on until the last of two starts under way at once has settled", async () => {
    const Manager = managerClass();
    const proto = Manager.prototype as { _getPipeline: unknown; _getVideoPipeline: unknown };
    const { _getPipeline } = proto;
    let endFirst: () => void = () => undefined;
    let endSecond: () => void = () => undefined;
    const first = withoutEagerPipelines(Manager, () => new Promise<void>((resolve) => (endFirst = resolve)));
    const second = withoutEagerPipelines(Manager, () => new Promise<void>((resolve) => (endSecond = resolve)));
    endFirst();
    await first;
    // The second start is still under way: its manager makes neither pipeline.
    expect(start(Manager).made).toEqual([]);
    endSecond();
    await second;
    expect(proto._getPipeline).toBe(_getPipeline);
    expect(start(Manager).made).toEqual(["mipmap rgba8unorm", "video rgba8unorm"]);
  });

  it("runs the start as it is where the manager has neither method", async () => {
    class Moved {}
    await expect(withoutEagerPipelines(Moved, async () => "started")).resolves.toBe("started");
    expect(Object.getOwnPropertyNames(Moved.prototype)).toEqual(["constructor"]);
  });
});

type Deferred<T> = { promise: Promise<T>; resolve(value: T): void; reject(error: unknown): void };
function deferred<T>(): Deferred<T> {
  let resolve: (value: T) => void = () => undefined;
  let reject: (error: unknown) => void = () => undefined;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}

type Pipeline = { name: string; getBindGroupLayout(index: number): string };
const pipelineNamed = (name: string): Pipeline => ({ name, getBindGroupLayout: (index) => `${name} layout ${index}` });

/** A device as the texture manager uses it: synchronous creations counted, on the prototype as a
 * real device's are; the asynchronous one settled by the test. */
class StandInDevice {
  sync: unknown[] = [];
  asked: unknown[] = [];
  landing = deferred<Pipeline>();
  createRenderPipeline(descriptor: unknown): Pipeline {
    this.sync.push(descriptor);
    return pipelineNamed(`sync ${this.sync.length}`);
  }
  createRenderPipelineAsync(descriptor: unknown): Promise<Pipeline> {
    this.asked.push(descriptor);
    return this.landing.promise;
  }
}

/** A manager whose `_getPipeline` is Babylon's in what matters here: the slot looked up, the
 * modules kept before the pipeline is made, the pipeline and its layout stored as a pair. */
class StandInManager {
  _pipelines: Record<string, unknown[]> = {};
  _compiledShaders: unknown[] = [];
  descriptors: { label: string; layout: string; format: string }[] = [];
  constructor(readonly _device: StandInDevice) {}
  _getPipeline(format: string): unknown {
    const index = 1 << 0;
    if (!this._pipelines[format]) this._pipelines[format] = [];
    let pair = this._pipelines[format]![index];
    if (!pair) {
      this._compiledShaders[index] ??= ["vertex module", "fragment module"];
      const descriptor = { label: `InternalPipeline_${format}_${index}`, layout: "auto", format };
      this.descriptors.push(descriptor);
      const pipeline = this._device.createRenderPipeline(descriptor);
      pair = this._pipelines[format]![index] = [pipeline, pipeline.getBindGroupLayout(0)];
    }
    return pair;
  }
}

describe("mipmapPipelineAhead", () => {
  it("asks for the pipeline asynchronously with the manager's own descriptor, and makes none synchronously", async () => {
    const device = new StandInDevice();
    const manager = new StandInManager(device);
    const ahead = mipmapPipelineAhead(device as never, manager);
    expect(device.sync).toEqual([]);
    expect(device.asked).toHaveLength(1);
    expect(device.asked[0]).toBe(manager.descriptors[0]);
    expect(device.asked[0]).toEqual({ label: "InternalPipeline_rgba8unorm_1", layout: "auto", format: "rgba8unorm" });
    // The modules are the manager's, made and kept as it makes them.
    expect(manager._compiledShaders[1]).toEqual(["vertex module", "fragment module"]);
    expect(Object.hasOwn(device, "createRenderPipeline")).toBe(false);

    const landed = pipelineNamed("async");
    device.landing.resolve(landed);
    await expect(ahead).resolves.toBe(true);
    expect(manager._pipelines.rgba8unorm?.[1]).toEqual([landed, "async layout 0"]);
    // Babylon's next look finds it: no creation.
    expect(manager._getPipeline("rgba8unorm")).toEqual([landed, "async layout 0"]);
    expect(device.sync).toEqual([]);
  });

  it("asks for the format it is given", () => {
    const device = new StandInDevice();
    const manager = new StandInManager(device);
    void mipmapPipelineAhead(device as never, manager, "rgba16float");
    expect(device.asked[0]).toEqual({ label: "InternalPipeline_rgba16float_1", layout: "auto", format: "rgba16float" });
  });

  it("keeps a pipeline Babylon made before the landing, and stores nothing over it", async () => {
    const device = new StandInDevice();
    const manager = new StandInManager(device);
    const ahead = mipmapPipelineAhead(device as never, manager);
    // A mipmap generated before the asynchronous pipeline lands: Babylon's own, synchronous.
    const own = manager._getPipeline("rgba8unorm");
    expect(device.sync).toHaveLength(1);
    device.landing.resolve(pipelineNamed("late"));
    await expect(ahead).resolves.toBe(false);
    expect(manager._pipelines.rgba8unorm?.[1]).toBe(own);
    expect(manager._getPipeline("rgba8unorm")).toBe(own);
  });

  it("resolves false on a rejection and leaves the manager to Babylon", async () => {
    const device = new StandInDevice();
    const manager = new StandInManager(device);
    const ahead = mipmapPipelineAhead(device as never, manager);
    device.landing.reject(new Error("device lost"));
    await expect(ahead).resolves.toBe(false);
    expect(manager._pipelines.rgba8unorm?.[1]).toBeUndefined();
    expect(Object.hasOwn(device, "createRenderPipeline")).toBe(false);
    // Babylon's own path is what it was.
    expect(manager._getPipeline("rgba8unorm")).toEqual([expect.objectContaining({ name: "sync 1" }), "sync 1 layout 0"]);
  });

  it("resolves false where the pipeline is already there: nothing recorded, nothing asked", async () => {
    const device = new StandInDevice();
    const manager = new StandInManager(device);
    manager._getPipeline("rgba8unorm");
    await expect(mipmapPipelineAhead(device as never, manager)).resolves.toBe(false);
    expect(device.asked).toEqual([]);
    expect(Object.hasOwn(device, "createRenderPipeline")).toBe(false);
  });

  it("resolves false, the device untouched, where the manager throws of its own or has no such method", async () => {
    const device = new StandInDevice();
    const throwing = {
      _getPipeline(): never {
        throw new Error("no processor");
      },
    };
    await expect(mipmapPipelineAhead(device as never, throwing)).resolves.toBe(false);
    await expect(mipmapPipelineAhead(device as never, {})).resolves.toBe(false);
    expect(device.asked).toEqual([]);
    expect(Object.hasOwn(device, "createRenderPipeline")).toBe(false);
  });

  it("resolves false where the asynchronous creation throws as it is asked for", async () => {
    const device = new StandInDevice();
    device.createRenderPipelineAsync = () => {
      throw new Error("destroyed");
    };
    const manager = new StandInManager(device);
    await expect(mipmapPipelineAhead(device as never, manager)).resolves.toBe(false);
    expect(manager._pipelines.rgba8unorm?.[1]).toBeUndefined();
  });

  it("puts back a createRenderPipeline the device had of its own", () => {
    const device = new StandInDevice();
    const own = (descriptor: unknown): Pipeline => {
      device.sync.push(descriptor);
      return pipelineNamed("own");
    };
    device.createRenderPipeline = own;
    void mipmapPipelineAhead(device as never, new StandInManager(device));
    expect(device.createRenderPipeline).toBe(own);
    expect(device.sync).toEqual([]);
  });
});

describe("the Babylon the engine's start relies on", () => {
  const manager = read("@babylonjs/core/Engines/WebGPU/webgpuTextureManager.js");

  it("has the texture manager's constructor end with its two pipelines", () => {
    expect(manager).toMatch(
      /this\._getPipeline\("rgba8unorm"[^)]*\);\s*this\._getVideoPipeline\("rgba8unorm"[^)]*\);\s*\}\s*_getPipeline\(format, type = PipelineType\.MipMap, params\) \{/,
    );
  });

  it("has the manager know its engine, and the engine hold the manager only once it is made", () => {
    expect(manager).toContain("this._engine = engine;");
    expect(read("@babylonjs/core/Engines/webgpuEngine.pure.js")).toContain("this._textureHelper = new WebGPUTextureManager(this, this._device,");
  });

  it("has the mipmap pipeline kept at index 1 of its format, with its first bind group layout", () => {
    expect(manager).toMatch(/const index = type === PipelineType\.MipMap\s*\? 1 << 0/);
    expect(manager).toContain("let pipelineAndBGL = this._pipelines[format][index];");
    expect(manager).toContain("pipelineAndBGL = this._pipelines[format][index] = [pipeline, pipeline.getBindGroupLayout(0)];");
  });

  it("has the manager keep its modules before it makes the pipeline, on its own device", () => {
    expect(manager).toMatch(/modules = this\._compiledShaders\[index\] = \[vertexModule, fragmentModule\];\s*\}\s*const pipeline = this\._device\.createRenderPipeline\(\{/);
  });
});

describe("the WebGPU engine's start", () => {
  it("starts with neither pipeline made, then asks for the mipmap one without waiting for it", () => {
    const source = readFileSync(new URL("../../src/game/gpuEngine.ts", import.meta.url), "utf8");
    expect(source).toMatch(
      /await withoutEagerPipelines\(WebGPUTextureManager, \(\) =>\s*engine\.initAsync\(\{ glslang: Promise\.resolve\(translators\.glslang\) \}, \{ twgsl: translators\.twgsl \}\),?\s*\);/,
    );
    expect(source).toMatch(/void mipmapPipelineAhead\(started\._device, started\._textureHelper\);/);
    expect(source).not.toMatch(/await mipmapPipelineAhead/);
  });
});
