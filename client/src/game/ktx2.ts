// KTX2/Basis transcoder wiring. Character GLBs carry KHR_texture_basisu
// textures; Babylon decodes them in a worker whose decoder JS + transcoder
// wasm must be fetched by URL. Point every URL at the vendored copies under
// /libs/ktx2 (committed by tools/vendor-ktx2.mjs) so nothing reaches for a CDN.
import { KhronosTextureContainer2 } from "@babylonjs/core/Misc/khronosTextureContainer2.js";

export const KTX2_DECODER_BASE_URL = "/libs/ktx2";

// KhronosTextureContainer2.URLConfig defaults every field to null except
// jsDecoderModule (which defaults to a CDN URL). Both the main-thread and
// worker code paths in @babylonjs/core only overwrite a transcoder's
// URL/binary when the corresponding config field is truthy (see
// khronosTextureContainer2Worker.js's `applyConfig`) — a field left null or
// empty silently keeps that transcoder's own hard-coded CDN default
// (e.g. LiteTranscoder_UASTC_ASTC.WasmModuleURL points at
// https://cdn.babylonjs.com/... out of the box). So every field below is set
// explicitly, never derived from whatever the default happened to be, to
// guarantee no fetch ever leaves /libs/ktx2.
//
// Field-by-field mapping to the files vendor-ktx2.mjs copies out of
// @babylonjs/ktx2decoder@9.18.0:
//   jsDecoderModule       -> babylon.ktx2Decoder.js   (esbuild UMD bundle of
//                            the package's ESM entry point — see
//                            vendor-ktx2.mjs for why a bundle is necessary)
//   wasmUASTCToASTC       -> uastc_astc.wasm
//   wasmUASTCToBC7        -> uastc_bc7.wasm
//   wasmUASTCToRGBA_UNORM -> uastc_rgba8_unorm_v2.wasm
//   wasmUASTCToRGBA_SRGB  -> uastc_rgba8_srgb_v2.wasm
//   wasmUASTCToR8_UNORM   -> uastc_r8_unorm.wasm
//   wasmUASTCToRG8_UNORM  -> uastc_rg8_unorm.wasm
//   jsMSCTranscoder       -> msc_basis_transcoder.js
//   wasmMSCTranscoder     -> msc_basis_transcoder.wasm
//   wasmZSTDDecoder       -> zstddec.wasm
KhronosTextureContainer2.URLConfig = {
  jsDecoderModule: `${KTX2_DECODER_BASE_URL}/babylon.ktx2Decoder.js`,
  wasmUASTCToASTC: `${KTX2_DECODER_BASE_URL}/uastc_astc.wasm`,
  wasmUASTCToBC7: `${KTX2_DECODER_BASE_URL}/uastc_bc7.wasm`,
  wasmUASTCToRGBA_UNORM: `${KTX2_DECODER_BASE_URL}/uastc_rgba8_unorm_v2.wasm`,
  wasmUASTCToRGBA_SRGB: `${KTX2_DECODER_BASE_URL}/uastc_rgba8_srgb_v2.wasm`,
  wasmUASTCToR8_UNORM: `${KTX2_DECODER_BASE_URL}/uastc_r8_unorm.wasm`,
  wasmUASTCToRG8_UNORM: `${KTX2_DECODER_BASE_URL}/uastc_rg8_unorm.wasm`,
  jsMSCTranscoder: `${KTX2_DECODER_BASE_URL}/msc_basis_transcoder.js`,
  wasmMSCTranscoder: `${KTX2_DECODER_BASE_URL}/msc_basis_transcoder.wasm`,
  wasmZSTDDecoder: `${KTX2_DECODER_BASE_URL}/zstddec.wasm`,
};
