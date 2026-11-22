import type { AdapterInfo } from "../../src/game/gpuSignals.js";

export const M4 = "ANGLE (Apple, ANGLE Metal Renderer: Apple M4, Unspecified Version)";
export const M3_MAX = "ANGLE (Apple, ANGLE Metal Renderer: Apple M3 Max, Unspecified Version)";
export const M2_PRO = "ANGLE (Apple, ANGLE Metal Renderer: Apple M2 Pro, Unspecified Version)";
export const SAFARI = "Apple GPU";
export const FF_APPLE = "Apple M1, or similar";
export const RTX_3060 = "ANGLE (NVIDIA, NVIDIA GeForce RTX 3060 (0x00002503) Direct3D11 vs_5_0 ps_5_0, D3D11)";
export const GTX_1060 = "ANGLE (NVIDIA, NVIDIA GeForce GTX 1060 6GB (0x00001C03) Direct3D11 vs_5_0 ps_5_0, D3D11)";
export const GT_730 = "ANGLE (NVIDIA, NVIDIA GeForce GT 730 (0x00001287) Direct3D11 vs_5_0 ps_5_0, D3D11)";
export const FF_NVIDIA = "ANGLE (NVIDIA, NVIDIA GeForce GTX 980 Direct3D11 vs_5_0 ps_5_0), or similar";
export const RX_6700 = "ANGLE (AMD, AMD Radeon RX 6700 XT (0x000073DF) Direct3D11 vs_5_0 ps_5_0, D3D11)";
export const RX_580 = "ANGLE (AMD, Radeon RX 580 Series (0x000067DF) Direct3D11 vs_5_0 ps_5_0, D3D11)";
export const RADEON_780M = "ANGLE (AMD, AMD Radeon 780M Graphics (0x000015BF) Direct3D11 vs_5_0 ps_5_0, D3D11)";
export const RADEON_BARE = "ANGLE (AMD, AMD Radeon(TM) Graphics (0x00001681) Direct3D11 vs_5_0 ps_5_0, D3D11)";
export const UHD_620 = "ANGLE (Intel, Intel(R) UHD Graphics 620 (0x00005917) Direct3D11 vs_5_0 ps_5_0, D3D11)";
export const IRIS_XE = "ANGLE (Intel, Intel(R) Iris(R) Xe Graphics (0x00009A49) Direct3D11 vs_5_0 ps_5_0, D3D11)";
export const ARC_IGPU = "ANGLE (Intel, Intel(R) Arc(TM) Graphics (0x00007D55) Direct3D11 vs_5_0 ps_5_0, D3D11)";
export const ARC_A770 = "ANGLE (Intel, Intel(R) Arc(TM) A770 Graphics (0x000056A0) Direct3D11 vs_5_0 ps_5_0, D3D11)";
export const IRIS_PLUS_MAC = "ANGLE (Intel, ANGLE Metal Renderer: Intel(R) Iris(TM) Plus Graphics 655, Unspecified Version)";
export const FF_INTEL = "ANGLE (Intel, Intel(R) HD Graphics 400 Direct3D11 vs_5_0 ps_5_0), or similar";
export const FF_AMD = "ANGLE (AMD, Radeon R9 200 Series Direct3D11 vs_5_0 ps_5_0), or similar";
export const SWIFTSHADER = "ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (Subzero) (0x0000C0DE)), SwiftShader driver)";
export const LLVMPIPE = "llvmpipe (LLVM 15.0.7, 256 bits)";
export const ADRENO_X1 = "ANGLE (Qualcomm, Qualcomm(R) Adreno(TM) X1-85 GPU Direct3D11 vs_5_0 ps_5_0, D3D11)";

export function adapter(vendor: string, architecture: string, isFallbackAdapter = false): AdapterInfo {
  return { vendor, architecture, device: "", description: "", isFallbackAdapter };
}
