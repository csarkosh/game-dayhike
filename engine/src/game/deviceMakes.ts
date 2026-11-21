/**
 * What a WebGPU device is asked to make of shaders, counted as it is asked,
 * and who is told of the frames that asked.
 *
 * The game voids a frame in which a shader was compiled when it judges the
 * frame rate (`governor.ts`). WGSL has no event for a compile: a shader
 * module is handed to the device, which compiles it
 * when a pipeline first needs it, and a pipeline made the synchronous way
 * holds the frame that asked for it. So what `Renderer.onShaderCompiled`
 * tells of is a frame in which the device was asked for a shader module or
 * a pipeline.
 *
 * The count is taken at the device's own calls, by standing a function of
 * the same name on the device in front of each; nothing is counted or
 * called on a frame that makes nothing, and `stop` takes the functions off.
 * No engine: any object with those calls is counted, so it runs under Node.
 */

/** The calls counted: a device, or anything with the same ones. */
export type MakesDevice = {
  createShaderModule(descriptor: never): unknown;
  createRenderPipeline(descriptor: never): unknown;
  createRenderPipelineAsync(descriptor: never): Promise<unknown>;
  createComputePipeline(descriptor: never): unknown;
  createComputePipelineAsync(descriptor: never): Promise<unknown>;
};

/** What was asked for: shader modules, pipelines made while the caller waits, and pipelines asked for off the page's thread. */
export type Makes = { modules: number; pipelines: number; pipelinesAsync: number };

const NAMES = ["createShaderModule", "createRenderPipeline", "createRenderPipelineAsync", "createComputePipeline", "createComputePipelineAsync"] as const;

export type DeviceMakes = {
  /** Everything asked for since the count began. */
  readonly total: Readonly<Makes>;
  /** Pipelines asked for off the page's thread that have not come back yet. */
  readonly pending: number;
  /** Calls `fn` at the end of each frame that asked for a shader module or a pipeline (`frameEnd`); the function returned stops it. */
  onMade(fn: () => void): () => void;
  /** Begins counting `device`'s calls; a device counted before it is let go of. */
  count(device: MakesDevice): void;
  /** The end of a frame, or of any stretch of work: tells the listeners if anything was asked for since the last one. True when it told. */
  frameEnd(): boolean;
  /** Takes the count off the device and lets every listener go. */
  stop(): void;
};

export function createDeviceMakes(): DeviceMakes {
  const total: Makes = { modules: 0, pipelines: 0, pipelinesAsync: 0 };
  const heard = new Set<() => void>();
  /** Whether anything was asked for since the last `frameEnd`. */
  let asked = false;
  let pending = 0;
  let counted: MakesDevice | null = null;
  const off = (): void => {
    if (counted === null) return;
    const own = counted as unknown as Record<string, unknown>;
    for (const name of NAMES) delete own[name];
    counted = null;
  };
  return {
    total,
    get pending() {
      return pending;
    },
    onMade(fn) {
      heard.add(fn);
      return () => void heard.delete(fn);
    },
    count(device) {
      off();
      counted = device;
      const own = device as unknown as Record<string, (descriptor: never) => unknown>;
      for (const name of NAMES) {
        // The device's own call, found through its prototype: the function stood here is taken off again by `stop`.
        const call = own[name] as (descriptor: never) => unknown;
        own[name] = (descriptor: never): unknown => {
          asked = true;
          if (name === "createShaderModule") total.modules++;
          else if (name === "createRenderPipeline" || name === "createComputePipeline") total.pipelines++;
          else total.pipelinesAsync++;
          const made = call.call(device, descriptor);
          if (name === "createRenderPipelineAsync" || name === "createComputePipelineAsync") {
            pending++;
            const landed = (): void => {
              pending--;
              // A pipeline that lands is drawn with from the next frame: that frame is told of too.
              asked = true;
            };
            (made as Promise<unknown>).then(landed, landed);
          }
          return made;
        };
      }
    },
    frameEnd() {
      if (!asked) return false;
      asked = false;
      for (const tell of [...heard]) tell();
      return true;
    },
    stop() {
      off();
      heard.clear();
    },
  };
}
