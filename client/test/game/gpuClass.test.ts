import { describe, it, expect } from "vitest";
import { classifyGpu, gpuIdentity, type GpuClass } from "../../src/game/gpuClass.js";
import type { AdapterInfo } from "../../src/game/gpuSignals.js";
import * as F from "./gpuFixtures.js";

type Row = [label: string, renderer: string | null, adapter: AdapterInfo | null, mobile: boolean, want: GpuClass];

export const CLASS_ROWS: Row[] = [
  ["Chrome, Apple M4", F.M4, null, false, "apple-base"],
  ["Chrome, Apple M3 Max", F.M3_MAX, null, false, "apple-large"],
  ["Chrome, Apple M2 Pro", F.M2_PRO, null, false, "apple-large"],
  ["Safari", F.SAFARI, null, false, "apple-unknown"],
  ["Firefox, any Apple GPU", F.FF_APPLE, null, false, "apple-unknown"],
  ["RTX 3060", F.RTX_3060, null, false, "discrete-modern"],
  ["GTX 1060", F.GTX_1060, null, false, "discrete-older"],
  ["GT 730", F.GT_730, null, false, "discrete-legacy"],
  ["Firefox, NVIDIA 900 series and up", F.FF_NVIDIA, null, false, "discrete-unknown"],
  ["RX 6700 XT", F.RX_6700, null, false, "discrete-modern"],
  ["RX 580", F.RX_580, null, false, "discrete-older"],
  ["Radeon 780M", F.RADEON_780M, null, false, "integrated-modern"],
  ["bare Radeon Graphics, RDNA 2", F.RADEON_BARE, F.adapter("amd", "rdna-2"), false, "integrated-modern"],
  ["bare Radeon Graphics, GCN 5", F.RADEON_BARE, F.adapter("amd", "gcn-5"), false, "integrated-older"],
  ["bare Radeon Graphics, no adapter", F.RADEON_BARE, null, false, "integrated-unknown"],
  ["UHD 620", F.UHD_620, null, false, "integrated-older"],
  ["Iris Xe", F.IRIS_XE, null, false, "integrated-unknown"],
  ["Arc integrated", F.ARC_IGPU, null, false, "integrated-modern"],
  ["Arc A770", F.ARC_A770, null, false, "discrete-modern"],
  ["an Intel Mac's Iris Plus 655", F.IRIS_PLUS_MAC, null, false, "integrated-older"],
  ["Firefox, Intel", F.FF_INTEL, null, false, "integrated-unknown"],
  ["Firefox, AMD", F.FF_AMD, null, false, "unknown"],
  ["SwiftShader", F.SWIFTSHADER, null, false, "software"],
  ["llvmpipe", F.LLVMPIPE, null, false, "software"],
  ["Snapdragon X", F.ADRENO_X1, null, false, "integrated-modern"],
  ["adapter only, Ampere", null, F.adapter("nvidia", "ampere"), false, "discrete-modern"],
  ["adapter only, Turing", null, F.adapter("nvidia", "turing"), false, "discrete-unknown"],
  ["adapter only, Apple", null, F.adapter("apple", "common-3"), false, "apple-unknown"],
  ["adapter only, fallback", null, F.adapter("google", "swiftshader", true), false, "software"],
  ["adapter only, Gen 12 LP", null, F.adapter("intel", "gen-12lp"), false, "integrated-unknown"],
  ["nothing at all", null, null, false, "unknown"],
  ["a phone", F.SAFARI, null, true, "mobile"],
  ["a fallback adapter beside a real renderer", F.RTX_3060, F.adapter("google", "swiftshader", true), false, "discrete-modern"],
];

describe("classifyGpu", () => {
  it.each(CLASS_ROWS)("%s", (_label, renderer, adapter, mobile, want) => {
    expect(classifyGpu({ renderer, adapter, mobile })).toBe(want);
  });
});

/** The table's other rules, each by one real renderer string or adapter info. */
const RULE_ROWS: Row[] = [
  ["WARP", "ANGLE (Microsoft, Microsoft Basic Render Driver (0x0000008C) Direct3D11 vs_5_0 ps_5_0, D3D11)", null, false, "software"],
  ["Firefox, NVIDIA before the 900 series", "ANGLE (NVIDIA, NVIDIA GeForce GTX 480 Direct3D11 vs_5_0 ps_5_0), or similar", null, false, "discrete-legacy"],
  ["Firefox, AMD before Polaris", "ANGLE (AMD, ATI Radeon HD 5850 Direct3D11 vs_5_0 ps_5_0), or similar", null, false, "discrete-legacy"],
  ["Firefox, Arc", "ANGLE (Intel, Intel(R) Arc(TM) A750 Graphics Direct3D11 vs_5_0 ps_5_0), or similar", null, false, "discrete-modern"],
  ["Firefox, a software bucket", "llvmpipe, or similar", null, false, "software"],
  ["GeForce MX450", "ANGLE (NVIDIA, NVIDIA GeForce MX450 (0x00001F97) Direct3D11 vs_5_0 ps_5_0, D3D11)", null, false, "discrete-older"],
  ["GTX 980 Ti", "ANGLE (NVIDIA, NVIDIA GeForce GTX 980 Ti (0x000017C8) Direct3D11 vs_5_0 ps_5_0, D3D11)", null, false, "discrete-older"],
  ["GTX 1660 SUPER", "ANGLE (NVIDIA, NVIDIA GeForce GTX 1660 SUPER (0x000021C4) Direct3D11 vs_5_0 ps_5_0, D3D11)", null, false, "discrete-older"],
  ["an Intel Mac's Radeon Pro", "ANGLE (AMD, ANGLE Metal Renderer: AMD Radeon Pro 5500M, Unspecified Version)", null, false, "discrete-older"],
  ["Radeon Pro W6800", "ANGLE (AMD, AMD Radeon PRO W6800 (0x000073A3) Direct3D11 vs_5_0 ps_5_0, D3D11)", null, false, "discrete-modern"],
  ["Radeon 8060S", "ANGLE (AMD, AMD Radeon 8060S Graphics (0x00001586) Direct3D11 vs_5_0 ps_5_0, D3D11)", null, false, "integrated-modern"],
  ["Vega 8", "ANGLE (AMD, AMD Radeon(TM) Vega 8 Graphics (0x000015D8) Direct3D11 vs_5_0 ps_5_0, D3D11)", null, false, "integrated-older"],
  ["Radeon R9 380", "ANGLE (AMD, AMD Radeon R9 380 Series (0x00006939) Direct3D11 vs_5_0 ps_5_0, D3D11)", null, false, "discrete-legacy"],
  ["Arc A380", "ANGLE (Intel, Intel(R) Arc(TM) A380 Graphics (0x000056A5) Direct3D11 vs_5_0 ps_5_0, D3D11)", null, false, "discrete-older"],
  ["Arc 140V, Lunar Lake", "ANGLE (Intel, Intel(R) Arc(TM) 140V GPU (16GB) (0x000064A0) Direct3D11 vs_5_0 ps_5_0, D3D11)", null, false, "integrated-modern"],
  ["Arc Graphics under Mesa", "ANGLE (Intel, Mesa Intel(R) Arc(tm) Graphics (MTL), OpenGL 4.6)", null, false, "integrated-modern"],
  ["Iris Xe under Mesa", "ANGLE (Intel, Mesa Intel(R) Iris(R) Xe Graphics (TGL GT2), OpenGL 4.6)", null, false, "integrated-unknown"],
  ["an unnamed renderer, the adapter decides", "ANGLE (Intel, Intel(R) Graphics (0x00007D67) Direct3D11 vs_5_0 ps_5_0, D3D11)", F.adapter("intel", "xe-lpg"), false, "integrated-modern"],
  ["an unnamed renderer and no adapter", "ANGLE (Intel, Intel(R) Graphics (0x00007D67) Direct3D11 vs_5_0 ps_5_0, D3D11)", null, false, "unknown"],
  ["adapter only, Lovelace", null, F.adapter("nvidia", "lovelace"), false, "discrete-modern"],
  ["adapter only, Blackwell", null, F.adapter("nvidia", "blackwell"), false, "discrete-modern"],
  ["adapter only, Pascal", null, F.adapter("nvidia", "pascal"), false, "discrete-older"],
  ["adapter only, Maxwell", null, F.adapter("nvidia", "maxwell"), false, "discrete-older"],
  ["adapter only, Xe LPG", null, F.adapter("intel", "xe-lpg"), false, "integrated-modern"],
  ["adapter only, Xe2 LPG", null, F.adapter("intel", "xe-2lpg"), false, "integrated-modern"],
  ["adapter only, Gen 9", null, F.adapter("intel", "gen-9"), false, "integrated-older"],
  ["adapter only, Gen 11", null, F.adapter("intel", "gen-11"), false, "integrated-older"],
  ["adapter only, Gen 12 HP", null, F.adapter("intel", "gen-12hp"), false, "discrete-modern"],
  ["adapter only, Xe2 HPG", null, F.adapter("intel", "xe-2hpg"), false, "discrete-modern"],
  ["adapter only, SwiftShader not flagged fallback", null, F.adapter("google", "swiftshader"), false, "software"],
  ["adapter only, Mesa software", null, F.adapter("mesa", "software"), false, "software"],
  ["adapter only, WARP", null, F.adapter("microsoft", "warp"), false, "software"],
  ["adapter only, AMD cannot say discrete or integrated", null, F.adapter("amd", "rdna-3"), false, "unknown"],
  ["adapter only, blank info", null, F.adapter("", ""), false, "unknown"],
  ["Safari with a blank adapter", F.SAFARI, F.adapter("", ""), false, "apple-unknown"],
  ["an iPad, Firefox's Apple bucket", F.FF_APPLE, null, true, "mobile"],
];

describe("classifyGpu, the rest of the table", () => {
  it.each(RULE_ROWS)("%s", (_label, renderer, adapter, mobile, want) => {
    expect(classifyGpu({ renderer, adapter, mobile })).toBe(want);
  });
});

describe("gpuIdentity", () => {
  it("is the renderer, else vendor/architecture, else empty", () => {
    expect(gpuIdentity({ renderer: F.M4, adapter: F.adapter("apple", "common-3") })).toBe(F.M4);
    expect(gpuIdentity({ renderer: null, adapter: F.adapter("nvidia", "ampere") })).toBe("nvidia/ampere");
    expect(gpuIdentity({ renderer: null, adapter: null })).toBe("");
    expect(gpuIdentity({ renderer: null, adapter: F.adapter("", "") })).toBe("");
  });
});
