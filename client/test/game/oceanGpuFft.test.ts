import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { NullEngine } from "@babylonjs/core/Engines/nullEngine.js";
import evolveWgsl from "../../src/game/shaders/oceanFftEvolve.compute.wgsl?raw";
import passWgsl from "../../src/game/shaders/oceanFftPass.compute.wgsl?raw";
import resolveWgsl from "../../src/game/shaders/oceanFftResolve.compute.wgsl?raw";
import {
  OCEAN_FFT_DISPATCH, OCEAN_FFT_EVOLVE_BINDINGS, OCEAN_FFT_PASS_BINDINGS, OCEAN_FFT_RESOLVE_BINDINGS,
  createGpuWindSea, gpuWindSeaH0,
} from "../../src/game/oceanGpuFft.js";
import { FFT_CASCADES, FFT_N, cascadeBands, windSeaCascadeSeed, windSeaH0 } from "../../src/game/oceanSpectrum.js";
import { WIND_SEA_CHOPPINESS, fftInverseLine, windSeaFields } from "../../src/game/oceanFft.js";
import { timeLimit } from "../helpers/timeLimit.js";

const SHADERS = { evolve: evolveWgsl, pass: passWgsl, resolve: resolveWgsl };

/** The WGSL's resource declarations: name → group, binding, address space or type. */
function declarations(wgsl: string): Record<string, { group: number; binding: number; kind: string }> {
  const out: Record<string, { group: number; binding: number; kind: string }> = {};
  const pattern = /@group\((\d+)\)\s*@binding\((\d+)\)\s*var(?:<([^>]+)>)?\s+(\w+)\s*:\s*([^;]+);/g;
  for (const m of wgsl.matchAll(pattern)) {
    out[m[4]!] = { group: Number(m[1]), binding: Number(m[2]), kind: (m[3] ?? m[5]!).replace(/\s+/g, " ").trim() };
  }
  return out;
}

const where = (d: ReturnType<typeof declarations>): Record<string, { group: number; binding: number }> =>
  Object.fromEntries(Object.entries(d).map(([name, { group, binding }]) => [name, { group, binding }]));

/** The workgroup sizes of every entry point. */
function workgroupSizes(wgsl: string): number[][] {
  return [...wgsl.matchAll(/@workgroup_size\((\d+),\s*(\d+),\s*(\d+)\)/g)].map((m) => [Number(m[1]), Number(m[2]), Number(m[3])]);
}

/** A `const NAME: u32 = <n>u;` of the WGSL. */
function u32Const(wgsl: string, name: string): number {
  const m = wgsl.match(new RegExp(`const ${name}: u32 = (\\d+)u;`));
  if (!m) throw new Error(`no const ${name}`);
  return Number(m[1]);
}

/** The lines marked `// stockham: <name>`, as name → expression, normalised:
 * no `const`/`let`, no spaces, WGSL's unsigned literals, `f32()` casts and `N`
 * written as TypeScript writes them. */
function stockhamLines(source: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const m of source.matchAll(/^\s*(?:const|let)\s+(\w+)\s*=\s*(.+);\s*\/\/ stockham: (\w+)\s*$/gm)) {
    expect(m[1]).toBe(m[3]);
    out[m[3]!] = m[2]!
      .replace(/\s+/g, "")
      .replace(/(\d+)u\b/g, "$1")
      .replace(/f32\((\w+)\)/g, "$1")
      .replace(/\bN\b/g, "n");
  }
  return out;
}

describe("the wind sea's compute shaders", () => {
  it("bind each resource where oceanGpuFft.ts says, as the kind it binds", () => {
    const evolve = declarations(evolveWgsl);
    const pass = declarations(passWgsl);
    const resolve = declarations(resolveWgsl);
    expect(where(evolve)).toEqual(OCEAN_FFT_EVOLVE_BINDINGS);
    expect(where(pass)).toEqual(OCEAN_FFT_PASS_BINDINGS);
    expect(where(resolve)).toEqual(OCEAN_FFT_RESOLVE_BINDINGS);
    expect(Object.fromEntries(Object.entries(evolve).map(([k, v]) => [k, v.kind]))).toEqual({
      h0: "storage, read",
      spectra: "storage, read_write",
      params: "uniform",
    });
    expect(pass.spectra!.kind).toBe("storage, read_write");
    expect(Object.fromEntries(Object.entries(resolve).map(([k, v]) => [k, v.kind]))).toEqual({
      spectra: "storage, read",
      params: "uniform",
      disp: "texture_storage_2d_array<rgba16float, write>",
      slope: "texture_storage_2d_array<rgba16float, write>",
    });
  });

  it("stay inside the device's limits: at most 4 storage textures, 8 storage buffers and 1 uniform buffer a stage", () => {
    const counts = Object.fromEntries(
      Object.entries(SHADERS).map(([name, wgsl]) => {
        const kinds = Object.values(declarations(wgsl)).map((d) => d.kind);
        return [name, {
          storageTextures: kinds.filter((k) => k.startsWith("texture_storage_")).length,
          storageBuffers: kinds.filter((k) => k.startsWith("storage")).length,
          uniforms: kinds.filter((k) => k === "uniform").length,
        }];
      }),
    );
    expect(counts).toEqual({
      evolve: { storageTextures: 0, storageBuffers: 2, uniforms: 1 },
      pass: { storageTextures: 0, storageBuffers: 1, uniforms: 0 },
      resolve: { storageTextures: 2, storageBuffers: 1, uniforms: 1 },
    });
  });

  it("run at most 256 invocations a workgroup, and the pass holds 8 KiB of workgroup memory of the 16 KiB allowed", () => {
    expect(workgroupSizes(evolveWgsl)).toEqual([[16, 16, 1]]);
    expect(workgroupSizes(passWgsl)).toEqual([[128, 1, 1], [128, 1, 1]]);
    expect(workgroupSizes(resolveWgsl)).toEqual([[16, 16, 1]]);
    for (const wgsl of Object.values(SHADERS)) {
      for (const [x, y, z] of workgroupSizes(wgsl)) expect(x! * y! * z!).toBeLessThanOrEqual(256);
    }
    const shared = [...passWgsl.matchAll(/var<workgroup>\s+(\w+)\s*:\s*array<vec4<f32>,\s*(\d+)>;/g)];
    expect(shared.length).toBe(1);
    const bytes = Number(shared[0]![2]) * 16;
    expect(bytes).toBe(8192);
    expect(bytes).toBeLessThanOrEqual(16384);
    expect(evolveWgsl).not.toMatch(/var<workgroup>/);
    expect(resolveWgsl).not.toMatch(/var<workgroup>/);
  });

  it("are dispatched over every bin, every line and every texel of the three cascades", () => {
    const [ex, ey, ez] = OCEAN_FFT_DISPATCH.evolve;
    expect([ex * 16, ey * 16, ez]).toEqual([256, 256, 3]);
    const [rx, ry, rz] = OCEAN_FFT_DISPATCH.resolve;
    expect([rx * 16, ry * 16, rz]).toEqual([256, 256, 3]);
    expect(OCEAN_FFT_DISPATCH.rows).toEqual([256, 6, 1]);
    expect(OCEAN_FFT_DISPATCH.columns).toEqual([256, 6, 1]);
    // A workgroup of HALF invocations moves two values each: the whole line.
    expect(2 * u32Const(passWgsl, "HALF")).toBe(FFT_N);
  });

  it("share the CPU FFT's size, stage count and Stockham index arithmetic", () => {
    for (const wgsl of Object.values(SHADERS)) expect(u32Const(wgsl, "N")).toBe(FFT_N);
    expect(u32Const(passWgsl, "HALF")).toBe(FFT_N / 2);
    expect(u32Const(passWgsl, "STAGES")).toBe(Math.log2(FFT_N));
    const cpu = readFileSync(fileURLToPath(new URL("../../src/game/oceanFft.ts", import.meta.url)), "utf8");
    const gpu = stockhamLines(passWgsl);
    expect(Object.keys(gpu).sort()).toEqual(["angle", "dest", "dst", "r", "span", "src"]);
    expect(gpu).toEqual(stockhamLines(cpu));
    expect(gpu.dest).toBe("((j>>stage)<<(stage+1))+r");
  });

  it("name no module of Babylon's WebGPU engine at run time", () => {
    const source = readFileSync(fileURLToPath(new URL("../../src/game/oceanGpuFft.ts", import.meta.url)), "utf8");
    const runtime = [...source.matchAll(/^\s*import\s+(?!type\s)(?:[^"'();]*?\s+from\s+)?["']([^"']+)["']/gm)].map((m) => m[1]!);
    expect(runtime.filter((spec) => /^@babylonjs\/core\/Engines\/(?:webgpuEngine|WebGPU\/)/.test(spec))).toEqual([]);
  });
});

describe("createGpuWindSea", () => {
  it("returns null on an engine without WebGPU compute", () => {
    const engine = new NullEngine();
    expect(createGpuWindSea(engine)).toBeNull();
    Object.defineProperty(engine, "isWebGPU", { get: () => true });
    expect(engine.getCaps().supportComputeShaders).toBe(false);
    expect(createGpuWindSea(engine)).toBeNull();
    engine.dispose();
  });

  it("uploads each cascade's h0 as (re, im, ω, 0) a bin, cascade after cascade", () => {
    const state = { u10: 9, dir: [0.8, 0.6] as [number, number] };
    const upload = gpuWindSeaH0(state, 42);
    expect(upload.length).toBe(3 * 256 * 256 * 4);
    const bands = cascadeBands(FFT_CASCADES, FFT_N);
    for (let c = 0; c < 3; c++) {
      const h0 = windSeaH0(FFT_N, FFT_CASCADES[c]!, state, bands[c]!, windSeaCascadeSeed(42, c));
      for (const i of [0, 1, 257, 4000, 65535]) {
        const at = (c * 65536 + i) * 4;
        expect([upload[at], upload[at + 1], upload[at + 2], upload[at + 3]]).toEqual([h0.re[i], h0.im[i], h0.omega[i], 0]);
      }
    }
  });
});

/** Values a line apart, as one workgroup of the pass sees them: four numbers
 * (two complex values) at each of the line's N places. */
function passLine(spectra: Float64Array, offset: number, stride: number): void {
  const n = 256;
  const half = 128;
  const stages = 8;
  const scratch = new Float64Array(2 * n * 4);
  const copy = (to: Float64Array, toAt: number, from: Float64Array, fromAt: number): void => {
    for (let q = 0; q < 4; q++) to[toAt * 4 + q] = from[fromAt * 4 + q]!;
  };
  for (let j = 0; j < half; j++) {
    copy(scratch, j, spectra, offset + j * stride);
    copy(scratch, j + half, spectra, offset + (j + half) * stride);
  }
  for (let stage = 0; stage < stages; stage++) {
    // Every invocation of the workgroup between two barriers: each reads the
    // src half and writes the dst half, so their order does not matter.
    for (let j = 0; j < half; j++) {
      const src = (stage & 1) * n;
      const dst = n - src;
      const span = 1 << stage;
      const r = j & (span - 1);
      const angle = (Math.PI * r) / span;
      const dest = ((j >> stage) << (stage + 1)) + r;
      const wr = Math.cos(angle);
      const wi = Math.sin(angle);
      const a = (src + j) * 4;
      const c = (src + j + half) * 4;
      const b = [
        scratch[c]! * wr - scratch[c + 1]! * wi, scratch[c]! * wi + scratch[c + 1]! * wr,
        scratch[c + 2]! * wr - scratch[c + 3]! * wi, scratch[c + 2]! * wi + scratch[c + 3]! * wr,
      ];
      for (let q = 0; q < 4; q++) {
        scratch[(dst + dest) * 4 + q] = scratch[a + q]! + b[q]!;
        scratch[(dst + dest + span) * 4 + q] = scratch[a + q]! - b[q]!;
      }
    }
  }
  const out = (stages & 1) * n;
  for (let j = 0; j < half; j++) {
    copy(spectra, offset + j * stride, scratch, out + j);
    copy(spectra, offset + (j + half) * stride, scratch, out + j + half);
  }
}

/** A whole frame as the three shaders compute it, on the CPU in double
 * precision: evolve, rows, columns, resolve, from what `setSpectrum` uploads. */
function frame(upload: Float32Array, t: number, choppiness: number): { disp: Float64Array; slope: Float64Array } {
  const n = 256;
  const cascades = 3;
  const spectra = new Float64Array(2 * cascades * n * n * 4);
  const waveIndex = (m: number): number => (m >= n / 2 ? m - n : m);
  for (let cascade = 0; cascade < cascades; cascade++) {
    const base = cascade * n * n;
    const dk = (2 * Math.PI) / FFT_CASCADES[cascade]!;
    for (let row = 0; row < n; row++) {
      for (let col = 0; col < n; col++) {
        const here = (base + row * n + col) * 4;
        const there = (base + ((n - row) % n) * n + ((n - col) % n)) * 4;
        const cycles = (upload[here + 2]! * t) / (2 * Math.PI);
        const phase = 2 * Math.PI * (cycles - Math.floor(cycles));
        const c = Math.cos(phase);
        const s = Math.sin(phase);
        const [ar, ai, br, bi] = [upload[here]!, upload[here + 1]!, upload[there]!, upload[there + 1]!];
        const hr = ar * c + ai * s + br * c + bi * s;
        const hi = ai * c - ar * s + br * s - bi * c;
        const kx = dk * waveIndex(col);
        const kz = dk * waveIndex(row);
        const k = Math.hypot(kx, kz);
        const inverse = k > 0 ? 1 / k : 0;
        const [ux, uz] = [kx * inverse, kz * inverse];
        // i·h, and a + i·b for each pair of fields
        const [ihr, ihi] = [-hi, hr];
        const field = {
          dx: [ux * ihr, ux * ihi], dz: [uz * ihr, uz * ihi], sx: [kx * ihr, kx * ihi], sz: [kz * ihr, kz * ihi],
          dxdx: [-kx * ux * hr, -kx * ux * hi], dzdz: [-kz * uz * hr, -kz * uz * hi], dxdz: [-kx * uz * hr, -kx * uz * hi],
        };
        const plusI = (a: number[], b: number[]): number[] => [a[0]! - b[1]!, a[1]! + b[0]!];
        const at = (cascade * 2 * n * n + row * n + col) * 4;
        spectra.set([...plusI([hr, hi], field.dx), ...plusI(field.dz, field.sx)], at);
        spectra.set([...plusI(field.sz, field.dxdx), ...plusI(field.dzdz, field.dxdz)], at + n * n * 4);
      }
    }
  }
  for (let layer = 0; layer < 2 * cascades; layer++) {
    for (let line = 0; line < n; line++) passLine(spectra, layer * n * n + line * n, 1);
  }
  for (let layer = 0; layer < 2 * cascades; layer++) {
    for (let line = 0; line < n; line++) passLine(spectra, layer * n * n + line, n);
  }
  const disp = new Float64Array(cascades * n * n * 4);
  const slope = new Float64Array(cascades * n * n * 4);
  const l = choppiness;
  for (let cascade = 0; cascade < cascades; cascade++) {
    for (let i = 0; i < n * n; i++) {
      const a = (cascade * 2 * n * n + i) * 4;
      const b = a + n * n * 4;
      const jacobian = (1 + l * spectra[b + 1]!) * (1 + l * spectra[b + 2]!) - l * l * spectra[b + 3]! ** 2;
      disp.set([spectra[a]!, l * spectra[a + 1]!, l * spectra[a + 2]!, jacobian], (cascade * n * n + i) * 4);
      slope.set([spectra[a + 3]!, spectra[b]!, 0, 0], (cascade * n * n + i) * 4);
    }
  }
  return { disp, slope };
}

describe("the pass's algorithm, run on the CPU as the WGSL runs it", () => {
  it("transforms a line of 256 as fftInverseLine does, both of its complex values", () => {
    let seed = 99;
    const next = (): number => {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      return seed / 4294967296 - 0.5;
    };
    const n = 256;
    const spectra = new Float64Array(n * n * 4);
    for (let i = 0; i < spectra.length; i++) spectra[i] = next();
    const column = 37;
    const expected = [0, 1].map((pair) => {
      const re = new Float32Array(n);
      const im = new Float32Array(n);
      for (let z = 0; z < n; z++) {
        re[z] = spectra[(z * n + column) * 4 + 2 * pair]!;
        im[z] = spectra[(z * n + column) * 4 + 2 * pair + 1]!;
      }
      fftInverseLine(re, im, 0, 1, n, new Float64Array(2 * n), new Float64Array(2 * n));
      return [re, im] as const;
    });
    passLine(spectra, column, n);
    for (let z = 0; z < n; z++) {
      for (const pair of [0, 1]) {
        expect(spectra[(z * n + column) * 4 + 2 * pair]).toBeCloseTo(expected[pair]![0][z]!, 4);
        expect(spectra[(z * n + column) * 4 + 2 * pair + 1]).toBeCloseTo(expected[pair]![1][z]!, 4);
      }
    }
  });

  it("makes, over a whole frame of the three cascades, the fields windSeaFields makes", () => {
    const state = { u10: 11, dir: [0.6, -0.8] as [number, number] };
    const seed = 7;
    const t = 37.25;
    const { disp, slope } = frame(gpuWindSeaH0(state, seed), t, WIND_SEA_CHOPPINESS);
    const bands = cascadeBands(FFT_CASCADES, FFT_N);
    const n = FFT_N;
    for (let c = 0; c < 3; c++) {
      const h0 = windSeaH0(n, FFT_CASCADES[c]!, state, bands[c]!, windSeaCascadeSeed(seed, c));
      const cpu = windSeaFields(h0, n, FFT_CASCADES[c]!, t, WIND_SEA_CHOPPINESS);
      let largest = 0;
      for (let i = 0; i < n * n; i++) {
        const at = (c * n * n + i) * 4;
        largest = Math.max(
          largest,
          Math.abs(disp[at]! - cpu.height[i]!), Math.abs(disp[at + 1]! - cpu.dx[i]!), Math.abs(disp[at + 2]! - cpu.dz[i]!),
          Math.abs(disp[at + 3]! - cpu.jacobian[i]!), Math.abs(slope[at]! - cpu.slopeX[i]!), Math.abs(slope[at + 1]! - cpu.slopeZ[i]!),
        );
      }
      expect(largest).toBeLessThan(1e-4);
      expect(cpu.height.some((v) => Math.abs(v) > 1e-3)).toBe(true);
    }
  }, timeLimit(60_000));
});
