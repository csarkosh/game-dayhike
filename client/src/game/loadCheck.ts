/**
 * Whether this browser and this GPU can play, decided once as the page
 * loads, from what the page already reads (`gpuSignals.ts`): the hike is
 * drawn with WebGPU alone, so a browser that offers none, or offers it with
 * nothing behind it the game can draw on, is told so before anything of a
 * hike is fetched or built, in place of a start that fails or a canvas
 * nothing draws.
 *
 * One verdict: play, or not, with a reason from a short closed list
 * (`TurnedAwayReason`). It makes no request of its own: the adapter it reads
 * is the answer to the page's one request (`readSignals`), which the
 * renderer's own request, made later, is expected to repeat.
 *
 * A request that has not answered is not an answer. The GPU's signals give
 * up on the adapter at two seconds (`timed-out`) so that the page is not
 * held by a busy machine; the verdict is then not known (null), nothing is
 * refused, and the page reads the same request's later answer when it comes
 * (`adapterVerdict`).
 *
 * With no engine and no page: plain values in, a plain value out.
 */
import type { AdapterReading, GpuSignals } from "./gpuSignals.js";

/**
 * Why a visitor is turned away: the browser has no WebGPU; it has, and gave
 * no adapter (none to give, or the request failed); the adapter is the
 * browser's software one, which draws on the processor; or the adapter is
 * short of something the game is drawn with (`LoadVerdict.short` names it).
 */
export type TurnedAwayReason = "no-webgpu" | "no-adapter" | "software" | "short";

/** Every reason, in the order they are looked for. */
export const TURNED_AWAY_REASONS: readonly TurnedAwayReason[] = ["no-webgpu", "no-adapter", "software", "short"];

/** The verdict: `short` is what the adapter lacks, in a few words, for the reason `short`, and null for every other. */
export type LoadVerdict = { play: true } | { play: false; reason: TurnedAwayReason; short: string | null };

/**
 * The limits the game is drawn within, and what an adapter must reach: each
 * is WebGPU's default. The renderer's device is made with no limit raised
 * (Babylon Lite's `createDevice` names none), so the device has the defaults
 * whatever the adapter could give, and every tier is built to fit them.
 * Beside each is the most a pipeline of a hike took of it, counted at the
 * browser's own calls on the three tiers at a forest view (2026-11-17); the
 * variables between a vertex and a fragment stage cannot be counted there,
 * and the device's own validation holds them to the default. An adapter that
 * implements WebGPU in full offers at least these, so they turn none of
 * those away; what they catch is an adapter that says it offers less, on
 * which the game's pipelines would fail one by one and the picture be short
 * of them.
 */
export const REQUIRED_LIMITS: Readonly<Record<string, number>> = {
  // The largest texture made is 2,560 on a side.
  maxTextureDimension2D: 8192,
  // 2 bind groups a pipeline.
  maxBindGroups: 4,
  // 15 textures in a stage.
  maxSampledTexturesPerShaderStage: 16,
  // 6 samplers in a stage.
  maxSamplersPerShaderStage: 16,
  // 5 uniform buffers in a stage.
  maxUniformBuffersPerShaderStage: 12,
  // The largest uniform buffer bound is 5,296 bytes: the frame's block, which every material reads.
  maxUniformBufferBindingSize: 65536,
  // 7 vertex buffers a pipeline, 11 attributes among them.
  maxVertexBuffers: 8,
  maxVertexAttributes: 16,
  maxInterStageShaderVariables: 16,
};

/**
 * The optional features of WebGPU the game cannot be drawn without: none.
 * What the renderer asks a device for where the adapter has it (compressed
 * textures, which the models' images are transcoded to and fall back from to
 * plain ones; filtering of 32-bit float textures, which the game's tables
 * are made without; the GPU's timer, read in the measurement mode alone)
 * it draws without: on a device made with no feature at all, every tier
 * loads and draws its frame with no error from the device, the same picture
 * but for the models' images, which are then not compressed.
 */
export const REQUIRED_FEATURES: readonly string[] = [];

const CAN_PLAY: LoadVerdict = { play: true };

function turnedAway(reason: TurnedAwayReason, short: string | null = null): LoadVerdict {
  return { play: false, reason, short };
}

/**
 * The verdict on an adapter, or on having none (null): a software adapter
 * is turned away whatever it offers; a limit the adapter reports under the
 * game's need, or a feature it lacks, is named. A limit the adapter does not
 * report at all is not known, never short: browsers name the newer limits
 * at different versions, and the device is made with the defaults either
 * way.
 */
export function adapterVerdict(adapter: AdapterReading | null): LoadVerdict {
  if (adapter === null) return turnedAway("no-adapter");
  if (adapter.isFallbackAdapter) return turnedAway("software");
  for (const [name, need] of Object.entries(REQUIRED_LIMITS)) {
    const have = adapter.limits[name];
    if (typeof have === "number" && have < need) return turnedAway("short", `${name} ${have} < ${need}`);
  }
  for (const feature of REQUIRED_FEATURES) {
    if (!adapter.features.includes(feature)) return turnedAway("short", feature);
  }
  return CAN_PLAY;
}

/**
 * The verdict as the page loads. `webgpu` is whether the browser offers
 * WebGPU at all (`offersWebGpu`), known at once, so a browser without it is
 * turned away before the signals are in (`signals` null). With it, the
 * verdict waits for the signals (null until then) and reads their adapter:
 * none, or a request that failed, is no adapter; one that had not answered
 * when the signals went on without it is not known yet (null), and the page
 * asks `adapterVerdict` of the same request's later answer.
 */
export function loadVerdict(
  webgpu: boolean,
  signals: Pick<GpuSignals, "adapterStatus" | "adapter" | "limits" | "features"> | null,
): LoadVerdict | null {
  if (!webgpu) return turnedAway("no-webgpu");
  if (signals === null || signals.adapterStatus === "timed-out") return null;
  if (signals.adapterStatus !== "ok" || signals.adapter === null || signals.limits === null) return turnedAway("no-adapter");
  return adapterVerdict({ limits: signals.limits, isFallbackAdapter: signals.adapter.isFallbackAdapter, features: signals.features ?? [] });
}
