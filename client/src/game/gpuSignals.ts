/**
 * What the browser will say about the GPU, read once per page: the WebGL
 * renderer string and whether the context links shaders off the page's thread,
 * the high-performance WebGPU adapter's info and limits, the logical cores,
 * the device memory, and whether the device is a phone or a tablet.
 * `gpuClass.ts` sorts the result into a class.
 *
 * Babylon-free, with the browser behind `SignalEnv`, so every branch is tested
 * with plain objects. Nothing here throws: a missing API, a refused extension,
 * no WebGL2, no WebGPU, or an adapter request that fails or never answers each
 * leave their field null (`adapterStatus` says which of the last three), which
 * the class table reads as not knowing.
 *
 * What the browsers admit to:
 *
 * - Chrome, Edge and the launcher answer `RENDERER` with "WebKit WebGL" and give
 *   the full ANGLE string ("ANGLE (Apple, ANGLE Metal Renderer: Apple M4,
 *   Unspecified Version)") through `WEBGL_debug_renderer_info`. Safari answers
 *   the extension with "Apple GPU" for every GPU. Firefox puts a sanitised,
 *   bucketed string in `RENDERER` itself ("Apple M1, or similar") and has
 *   deprecated the extension with a console warning, so the extension is asked
 *   for only when `RENDERER` is the masked value.
 * - Firefox 156 answers `KHR_parallel_shader_compile` with null, so every
 *   program links on the page's thread and a link-status read blocks until the
 *   link is done (169–337 ms each, measured on an Apple M4); where the
 *   extension is exposed, the engine polls for completion instead.
 * - The adapter's `info` names a vendor and an architecture in Chrome
 *   ("nvidia"/"ampere"; Apple as its Metal family, which says nothing of the
 *   GPU's size) and may be blank elsewhere.
 * - `deviceMemory` is Chromium's alone: 2 to 32 on the desktop from Chrome 147,
 *   8 at most before. Safari clamps `hardwareConcurrency` to 4 or 8; Firefox
 *   reports 2 under `resistFingerprinting`. A value that is not reported stays
 *   null: a missing value is not a small one.
 */

/** The WebGPU adapter's `GPUAdapterInfo`, with every missing string as "". */
export type AdapterInfo = { vendor: string; architecture: string; device: string; description: string; isFallbackAdapter: boolean };

/**
 * How the adapter request ended: `"ok"`, an adapter read; `"none"`, no
 * `navigator.gpu` or an answer with no adapter; `"rejected"`, the request
 * threw, rejected, or answered with an adapter that could not be read;
 * `"timed-out"`, no answer within `ADAPTER_TIMEOUT_MS`. The WebGPU engine rule
 * reads the difference: an adapter that hangs is a failure worth remembering,
 * a browser without one is not.
 */
export type AdapterStatus = "ok" | "none" | "rejected" | "timed-out";

export type GpuSignals = {
  /** The WebGL renderer string, or null without a WebGL2 context or with only the masked value. */
  renderer: string | null;
  /** The high-performance adapter's info, or null without `navigator.gpu`, an adapter, or an answer within `ADAPTER_TIMEOUT_MS`. */
  adapter: AdapterInfo | null;
  /** The same adapter's limits, every one, for the WebGPU engine rule; null with `adapter`. */
  limits: Readonly<Record<string, number>> | null;
  /** Why `adapter` is null, or `"ok"`. */
  adapterStatus: AdapterStatus;
  /** Whether the WebGL2 context exposes `KHR_parallel_shader_compile`, or null
   * without a WebGL2 context or when the extension could not be asked for. */
  parallelCompile: boolean | null;
  /** Logical cores, or null where not reported. */
  cores: number | null;
  /** Device memory in GiB, or null where not reported. */
  memoryGb: number | null;
  mobile: boolean;
  /** The browser's major version (`browserMajor`), 0 when the user agent names none. */
  browser: number;
};

/** The part of a WebGL2 context this reads. */
export type WebGLLike = { readonly RENDERER: number; getParameter(p: number): unknown; getExtension(name: string): unknown };

/** The part of `navigator` this reads; every field may be missing. */
export type NavigatorLike = {
  userAgent?: string;
  hardwareConcurrency?: number;
  deviceMemory?: number;
  maxTouchPoints?: number;
  userAgentData?: { mobile?: boolean };
  gpu?: { requestAdapter(options: { powerPreference: "high-performance" }): Promise<unknown> };
};

export type SignalEnv = { navigator: NavigatorLike | undefined; webgl(): WebGLLike | null };

/** How long the adapter request may take before the signals go without it. */
export const ADAPTER_TIMEOUT_MS = 2000;

/** What Chrome and Safari answer `RENDERER` with in place of the GPU's name. */
const MASKED_RENDERER = "WebKit WebGL";
/** `WEBGL_debug_renderer_info.UNMASKED_RENDERER_WEBGL`, where the extension object lacks it. */
const UNMASKED_RENDERER_WEBGL = 0x9246;
const MOBILE_AGENT = /Mobi|Android|iPhone|iPad/;

/**
 * The GPU's name from a WebGL context, or null. `RENDERER` is taken as it is
 * unless it is the masked "WebKit WebGL"; only then is the debug extension
 * asked, so Firefox, whose `RENDERER` already carries its sanitised string,
 * never logs the extension's deprecation warning. The context is lost on every
 * path, so it never counts against the browser's live-context limit.
 */
export function readRenderer(gl: WebGLLike): string | null {
  try {
    const plain = gl.getParameter(gl.RENDERER);
    if (typeof plain === "string" && plain !== "" && plain !== MASKED_RENDERER) return plain;
    const ext = gl.getExtension("WEBGL_debug_renderer_info") as { UNMASKED_RENDERER_WEBGL?: unknown } | null | undefined;
    if (typeof ext !== "object" || ext === null) return null;
    const name = typeof ext.UNMASKED_RENDERER_WEBGL === "number" ? ext.UNMASKED_RENDERER_WEBGL : UNMASKED_RENDERER_WEBGL;
    const unmasked = gl.getParameter(name);
    return typeof unmasked === "string" && unmasked !== "" ? unmasked : null;
  } catch {
    return null;
  } finally {
    loseContext(gl);
  }
}

function loseContext(gl: WebGLLike): void {
  try {
    const ext = gl.getExtension("WEBGL_lose_context") as { loseContext?: () => void } | null | undefined;
    if (typeof ext?.loseContext === "function") ext.loseContext();
  } catch {
    /* a context that cannot be lost is left to the collector */
  }
}

/**
 * A phone or a tablet: Chromium's client hint where there is one; else the
 * user agent; else a Mac user agent on a touch screen, which is how an iPad
 * reports itself since iPadOS 13. Not `platform.ts`'s `isTouchDevice`: a
 * touch-screen laptop keeps its GPU's class.
 */
export function isMobile(nav: NavigatorLike | undefined): boolean {
  if (!nav) return false;
  try {
    if (nav.userAgentData?.mobile === true) return true;
    const agent = typeof nav.userAgent === "string" ? nav.userAgent : "";
    if (MOBILE_AGENT.test(agent)) return true;
    return /Macintosh/.test(agent) && typeof nav.maxTouchPoints === "number" && nav.maxTouchPoints > 1;
  } catch {
    return false;
  }
}

/** The browser's major version: the first of `Chrome/`, `Firefox/` and
 * `Version/` (Safari) found, else 0. */
export function browserMajor(userAgent: string): number {
  for (const key of ["Chrome", "Firefox", "Version"]) {
    const match = new RegExp(`${key}/(\\d+)`).exec(userAgent);
    if (match) return Number(match[1]);
  }
  return 0;
}

/**
 * Every signal, each on its own guard. The adapter request starts first and
 * runs beside the WebGL read. Whatever else needs the adapter (the WebGPU
 * engine rule reads its `limits` and `isFallbackAdapter`) should read it from
 * here rather than ask again: Babylon's `WebGPUEngine.IsSupportedAsync` is
 * itself a `requestAdapter`.
 */
export async function gatherSignals(env: SignalEnv): Promise<GpuSignals> {
  const nav = env.navigator;
  const pending = requestAdapter(nav);
  const context = readContext(env);
  const answer = await pending;
  const found = answer.adapter === null ? null : readAdapter(answer.adapter);
  const adapterStatus: AdapterStatus = answer.adapter !== null && found === null ? "rejected" : answer.status;
  return {
    renderer: context.renderer,
    adapter: found?.info ?? null,
    limits: found?.limits ?? null,
    adapterStatus,
    parallelCompile: context.parallelCompile,
    cores: reported(() => nav?.hardwareConcurrency),
    memoryGb: reported(() => nav?.deviceMemory),
    mobile: isMobile(nav),
    browser: browserMajor(agentOf(nav)),
  };
}

/** The page's environment: `globalThis.navigator`, and a throwaway canvas's
 * "webgl2" context, asked for the high-performance GPU as the game's engine
 * asks, so a machine with two GPUs names the one the game draws with. */
export function browserEnv(): SignalEnv {
  return {
    navigator: globalThis.navigator as NavigatorLike | undefined,
    webgl: () => document.createElement("canvas").getContext("webgl2", { powerPreference: "high-performance" }),
  };
}

/** The renderer and the parallel-compile extension, both from the one
 * throwaway context; the extension is asked first, since `readRenderer` loses
 * the context. */
function readContext(env: SignalEnv): { renderer: string | null; parallelCompile: boolean | null } {
  let gl: WebGLLike | null;
  try {
    gl = env.webgl();
  } catch {
    return { renderer: null, parallelCompile: null };
  }
  if (!gl) return { renderer: null, parallelCompile: null };
  const parallelCompile = readParallelCompile(gl);
  return { renderer: readRenderer(gl), parallelCompile };
}

function readParallelCompile(gl: WebGLLike): boolean | null {
  try {
    const ext = gl.getExtension("KHR_parallel_shader_compile");
    return typeof ext === "object" && ext !== null;
  } catch {
    return null;
  }
}

type AdapterAnswer = { status: AdapterStatus; adapter: object | null };

/** The high-performance adapter and how the request ended; the adapter is
 * null unless the status is `"ok"`. Never rejects. */
function requestAdapter(nav: NavigatorLike | undefined): Promise<AdapterAnswer> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const gpu = nav?.gpu;
    if (typeof gpu?.requestAdapter !== "function") return Promise.resolve({ status: "none", adapter: null });
    const answer = Promise.resolve(gpu.requestAdapter({ powerPreference: "high-performance" })).then(
      (adapter): AdapterAnswer =>
        typeof adapter === "object" && adapter !== null ? { status: "ok", adapter } : { status: "none", adapter: null },
      (): AdapterAnswer => ({ status: "rejected", adapter: null }),
    );
    const deadline = new Promise<AdapterAnswer>((resolve) => {
      timer = setTimeout(() => resolve({ status: "timed-out", adapter: null }), ADAPTER_TIMEOUT_MS);
    });
    return Promise.race([answer, deadline]).finally(() => clearTimeout(timer));
  } catch {
    clearTimeout(timer);
    return Promise.resolve({ status: "rejected", adapter: null });
  }
}

/**
 * The adapter's info and limits. Every limit is read with `for…in`: a
 * browser's limits are getters on the prototype, so `Object.keys` finds none.
 * `isFallbackAdapter` is the info's, else the adapter's own older attribute,
 * which is read only when the info has none.
 */
function readAdapter(adapter: object): { info: AdapterInfo; limits: Record<string, number> } | null {
  try {
    const source = adapter as { info?: unknown; limits?: unknown; isFallbackAdapter?: unknown };
    const info = (typeof source.info === "object" && source.info !== null ? source.info : {}) as Record<string, unknown>;
    const text = (value: unknown): string => (typeof value === "string" ? value : "");
    const fallback =
      typeof info.isFallbackAdapter === "boolean"
        ? info.isFallbackAdapter
        : typeof source.isFallbackAdapter === "boolean"
          ? source.isFallbackAdapter
          : false;
    const limits: Record<string, number> = {};
    if (typeof source.limits === "object" && source.limits !== null) {
      const all = source.limits as Record<string, unknown>;
      for (const name in all) {
        const value = all[name];
        if (typeof value === "number") limits[name] = value;
      }
    }
    return {
      info: {
        vendor: text(info.vendor),
        architecture: text(info.architecture),
        device: text(info.device),
        description: text(info.description),
        isFallbackAdapter: fallback,
      },
      limits,
    };
  } catch {
    return null;
  }
}

/** A count the browser reported: a positive finite number, else null. */
function reported(read: () => unknown): number | null {
  try {
    const value = read();
    return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : null;
  } catch {
    return null;
  }
}

function agentOf(nav: NavigatorLike | undefined): string {
  try {
    return typeof nav?.userAgent === "string" ? nav.userAgent : "";
  } catch {
    return "";
  }
}
