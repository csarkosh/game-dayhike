/**
 * The GPU classes, and the ordered rule table that sorts a page's signals into
 * one of them. Pure and Babylon-free.
 *
 * The WebGL renderer string decides first, because it names the GPU the WebGL
 * path draws with; the WebGPU adapter's vendor and architecture decide only
 * where the string is missing or names nothing below. The rules run on the
 * ANGLE string whole; the PCI id in it (`(0x00002503)`) is not read.
 *
 * Wherever a browser will not name the GPU, the class says so rather than
 * guessing: Safari's "Apple GPU" and Firefox's buckets ("Apple M1, or similar"
 * stands for every Apple GPU, "GeForce GTX 980, or similar" for every NVIDIA
 * GPU from the 900 series on) each have an "unknown" class of their own.
 */
import type { AdapterInfo, GpuSignals } from "./gpuSignals.js";
import type { QualityTier } from "./quality.js";

export type GpuClass =
  | "mobile"
  | "software"
  | "discrete-legacy"
  | "integrated-older"
  | "integrated-unknown"
  | "integrated-modern"
  | "apple-base"
  | "discrete-older"
  | "unknown"
  | "apple-unknown"
  | "discrete-unknown"
  | "apple-large"
  | "discrete-modern";

export type ClassTiers = { start: QualityTier; ceiling: QualityTier; probe: boolean };

/**
 * Each class's tiers: where Auto starts it, the highest it may reach, and
 * whether a probe measures it from that ceiling before its first hike. A named
 * class starts at its ceiling; an unknown one starts a step below and is
 * probed. Only `apple-base` rests on a measurement of its own class (high is
 * 24 ms a frame at the canopy pose on an M4 with an 8-core GPU); the other
 * named rows are set from each GPU's throughput relative to that one, and each
 * is one literal in `gpuClass.test.ts`, so a later measurement moves one row.
 */
export const CLASS_TIERS: Readonly<Record<GpuClass, ClassTiers>> = {
  // Thermals, not the GPU, are a phone's limit.
  mobile: { start: "low", ceiling: "low", probe: false },
  // A CPU rasteriser.
  software: { start: "low", ceiling: "low", probe: false },
  // Kepler and older, Radeon before Polaris.
  "discrete-legacy": { start: "low", ceiling: "low", probe: false },
  // Intel Gen 9 to 11, Vega APUs.
  "integrated-older": { start: "low", ceiling: "low", probe: false },
  // Iris Xe, a bare "Radeon Graphics", Firefox's Intel buckets.
  "integrated-unknown": { start: "low", ceiling: "medium", probe: true },
  // Arc integrated, RDNA 2 and later APUs, Snapdragon X.
  "integrated-modern": { start: "medium", ceiling: "medium", probe: false },
  // An M-series base GPU: high does not hold 60 Hz at the canopy pose.
  "apple-base": { start: "medium", ceiling: "medium", probe: false },
  // Maxwell to Turing without RTX, Polaris, Vega, Arc A3xx.
  "discrete-older": { start: "medium", ceiling: "medium", probe: false },
  // Nothing recognisable.
  unknown: { start: "medium", ceiling: "high", probe: true },
  // Safari's "Apple GPU", Firefox's "Apple M1" bucket: an M1 or an M4 Max.
  "apple-unknown": { start: "medium", ceiling: "high", probe: true },
  // Firefox's "GTX 980" bucket, WebGPU's "turing".
  "discrete-unknown": { start: "medium", ceiling: "high", probe: true },
  // Pro, Max and Ultra.
  "apple-large": { start: "high", ceiling: "high", probe: false },
  // RTX, RDNA 1 and later, Arc A5xx and up.
  "discrete-modern": { start: "high", ceiling: "high", probe: false },
};

/** A CPU rasteriser, by any of the names the browsers give one. */
const SOFTWARE = /swiftshader|llvmpipe|softpipe|lavapipe|basic render driver|\bwarp\b/i;

/** How Firefox marks a renderer string it has replaced with a representative model. */
const BUCKET = ", or similar";

/** Firefox's buckets by the model they name, first match wins; any other bucket is `unknown`
 * ("Radeon R9 200 Series" stands for Vega, Fury and the Renoir and Rembrandt APUs alike). */
const BUCKETS: readonly (readonly [readonly string[], GpuClass])[] = [
  [["Apple M1"], "apple-unknown"],
  [["GeForce GTX 980"], "discrete-unknown"],
  [["GeForce GTX 480", "GeForce 8800", "Radeon HD 5850", "Radeon HD 3200"], "discrete-legacy"],
  [["Arc(TM) A750"], "discrete-modern"],
  [["Intel"], "integrated-unknown"],
];

/** An APU that names no model: its adapter's architecture, where there is one. */
function radeonApu(adapter: AdapterInfo | null): GpuClass {
  const architecture = adapter?.architecture.toLowerCase() ?? "";
  if (architecture.startsWith("rdna-")) return "integrated-modern";
  if (architecture.startsWith("gcn-")) return "integrated-older";
  return "integrated-unknown";
}

/** The named GPUs, first match wins. */
const NAMED: readonly (readonly [RegExp, GpuClass | ((adapter: AdapterInfo | null) => GpuClass)])[] = [
  [/Apple M\d+ (Pro|Max|Ultra)/, "apple-large"],
  [/Apple M\d+/, "apple-base"],
  [/Apple GPU/, "apple-unknown"],
  // GeForce RTX, the RTX A-series and Quadro RTX.
  [/\bRTX\b/, "discrete-modern"],
  // Maxwell to Turing without RTX.
  [/GTX (9\d\d|10\d\d|16\d\d)|TITAN X|\bMX ?\d{3}/, "discrete-older"],
  [/GeForce|Quadro|NVIDIA/, "discrete-legacy"],
  // RDNA 1 to 4; AMD writes its workstation line both "Pro" and "PRO".
  [/Radeon RX (5|6|7|9)\d{3}|Radeon P(ro|RO) W(5|6|7)\d{3}/, "discrete-modern"],
  // Polaris, Vega, and the Intel Macs' Radeon Pro.
  [/Radeon (RX (4|5)\d\d\b|RX Vega|VII|Pro|PRO)/, "discrete-older"],
  // 680M, 780M, 880M, 890M, 8060S.
  [/Radeon \d{3}M|Radeon 8\d{2}0S/, "integrated-modern"],
  [/Radeon\(TM\) Graphics|Radeon Graphics/, radeonApu],
  [/Vega \d+/, "integrated-older"],
  [/Radeon (R9|R7|R5|HD)/, "discrete-legacy"],
  [/Arc.*\b[AB][5-9]\d\d\b/, "discrete-modern"],
  [/Arc.*\b[AB]3\d\d\b/, "discrete-older"],
  // Meteor, Lunar and Arrow Lake, as Windows ("Arc(TM) 140V GPU") and Mesa ("Arc(tm) Graphics") name them.
  [/Arc\((TM|tm)\) Graphics|Arc(\((TM|tm)\))? \d{3}[VT]\b/, "integrated-modern"],
  // 80 to 96 execution units and among the commonest laptop GPUs: the frame decides.
  [/Iris\(R\) Xe|Iris Xe/, "integrated-unknown"],
  [/UHD Graphics|HD Graphics|Iris\(TM\) Plus|Iris Plus|Iris Pro/, "integrated-older"],
  // Snapdragon X laptops.
  [/Adreno.*X\d/, "integrated-modern"],
];

/** WebGPU adapter architectures by vendor, as Chrome reports them. */
const ARCHITECTURES: ReadonlyMap<string, ReadonlyMap<string, GpuClass>> = new Map([
  [
    "nvidia",
    new Map<string, GpuClass>([
      ["ampere", "discrete-modern"],
      ["lovelace", "discrete-modern"],
      ["blackwell", "discrete-modern"],
      // GTX 16 and RTX 20 alike.
      ["turing", "discrete-unknown"],
      ["pascal", "discrete-older"],
      ["maxwell", "discrete-older"],
    ]),
  ],
  [
    "intel",
    new Map<string, GpuClass>([
      ["xe-lpg", "integrated-modern"],
      ["xe-2lpg", "integrated-modern"],
      ["xe-3lpg", "integrated-modern"],
      ["gen-12lp", "integrated-unknown"],
      ["gen-9", "integrated-older"],
      ["gen-11", "integrated-older"],
      ["gen-12hp", "discrete-modern"],
      ["xe-2hpg", "discrete-modern"],
    ]),
  ],
  ["google", new Map<string, GpuClass>([["swiftshader", "software"]])],
  ["mesa", new Map<string, GpuClass>([["software", "software"]])],
  ["microsoft", new Map<string, GpuClass>([["warp", "software"]])],
]);

function byRenderer(renderer: string, adapter: AdapterInfo | null): GpuClass | null {
  if (SOFTWARE.test(renderer)) return "software";
  if (renderer.trimEnd().endsWith(BUCKET)) {
    for (const [names, cls] of BUCKETS) {
      if (names.some((name) => renderer.includes(name))) return cls;
    }
    return "unknown";
  }
  for (const [pattern, cls] of NAMED) {
    if (pattern.test(renderer)) return typeof cls === "function" ? cls(adapter) : cls;
  }
  return null;
}

function byAdapter(adapter: AdapterInfo): GpuClass | null {
  if (adapter.isFallbackAdapter) return "software";
  const vendor = adapter.vendor.toLowerCase();
  if (vendor === "apple") return "apple-unknown";
  return ARCHITECTURES.get(vendor)?.get(adapter.architecture.toLowerCase()) ?? null;
}

/**
 * The class, first match wins: mobile; a software rasteriser; Firefox's
 * buckets; the named GPUs; then, where the renderer is missing or matched
 * nothing, the adapter; else `unknown`.
 */
export function classifyGpu(signals: Pick<GpuSignals, "renderer" | "adapter" | "mobile">): GpuClass {
  if (signals.mobile) return "mobile";
  const named = signals.renderer === null ? null : byRenderer(signals.renderer, signals.adapter);
  if (named !== null) return named;
  const found = signals.adapter === null ? null : byAdapter(signals.adapter);
  return found ?? "unknown";
}

/** Which GPU a remembered verdict was measured on: the renderer string, else
 * the adapter's "vendor/architecture", else "". */
export function gpuIdentity(signals: Pick<GpuSignals, "renderer" | "adapter">): string {
  if (signals.renderer !== null && signals.renderer !== "") return signals.renderer;
  const adapter = signals.adapter;
  if (adapter !== null && (adapter.vendor !== "" || adapter.architecture !== "")) {
    return `${adapter.vendor}/${adapter.architecture}`;
  }
  return "";
}
