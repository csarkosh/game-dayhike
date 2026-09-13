#!/usr/bin/env node
// One-shot vendoring of the Babylon KTX2 decoder + transcoder wasm files into
// client/public/libs/ktx2/, committed so deploys never depend on a CDN.
// Re-run only when @babylonjs/ktx2decoder is upgraded.
//
// Package-layout note (@babylonjs/ktx2decoder@9.18.0): the published npm
// package is ESM-only, meant for bundler consumption — it does NOT ship the
// prebuilt UMD "babylon.ktx2Decoder.js" that KhronosTextureContainer2 (in
// @babylonjs/core) expects to fetch as `URLConfig.jsDecoderModule`. That URL
// is loaded via a classic <script src> on the main thread, or `importScripts`
// inside the KTX2 worker — both require plain, non-module script syntax that
// sets a global `KTX2DECODER`, which is exactly what the CDN's prebuilt file
// does. Rather than reach for the CDN (even once), we bundle that global
// script ourselves from the installed ESM sources with esbuild, which is
// already vendored locally (a transitive dependency of vite/tsx in this
// workspace, pinned explicitly in the root package.json). This keeps the
// whole vendoring step reproducible from node_modules alone — no network
// fetch, ever.
import { copyFileSync, mkdirSync, readdirSync, statSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import * as esbuild from "esbuild";

const require = createRequire(import.meta.url);
const PKG = dirname(require.resolve("@babylonjs/ktx2decoder/package.json"));
const OUT = "client/public/libs/ktx2";
mkdirSync(OUT, { recursive: true });

// 1. Copy every non-map .js/.wasm file shipped under wasm/ — the Emscripten
//    glue (msc_basis_transcoder.js) and the transcoder/zstd wasm binaries
//    referenced by URLConfig's wasm*/jsMSCTranscoder fields.
const wasmDir = join(PKG, "wasm");
const wanted = [];
const walk = (dir) => {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p);
    else if (/\.(js|wasm)$/.test(name) && !/\.map$/.test(name)) wanted.push(p);
  }
};
walk(wasmDir);
if (wanted.length === 0) {
  throw new Error(`no .js/.wasm files found under ${wasmDir} — package layout changed; list it and adjust`);
}
for (const src of wanted) {
  const dest = join(OUT, src.split("/").pop());
  copyFileSync(src, dest);
  console.log(`vendored ${dest}`);
}

// 2. Bundle the ESM entry point into a global-exposing IIFE standing in for
//    the CDN's babylon.ktx2Decoder.js. KhronosTextureContainer2 does
//    `KTX2DecoderModule = KTX2DECODER` (a bare global read) after loading
//    this script, so every class the config code touches
//    (LiteTranscoder_UASTC_*, MSCTranscoder, ZSTDDecoder, KTX2Decoder,
//    Transcoder, WASMMemoryManager) must be a named export reachable off the
//    IIFE's global — esbuild's `globalName` option does exactly that.
const decoderOut = join(OUT, "babylon.ktx2Decoder.js");
await esbuild.build({
  entryPoints: [join(PKG, "index.js")],
  bundle: true,
  format: "iife",
  globalName: "KTX2DECODER",
  outfile: decoderOut,
  target: "es2020",
});
console.log(`vendored ${decoderOut} (bundled from @babylonjs/ktx2decoder's index.js)`);
