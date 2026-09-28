// The two shader translators Babylon ships (glslang, GLSL to SPIR-V; twgsl,
// SPIR-V to WGSL), as the page ships them, run under Node.
//
// The files are resolved from the client package, as the page's build
// resolves the `?url` imports of `client/src/game/gpuEngine.ts`, so the tools
// translate with the very bytes the page downloads. Their digests are part of
// the salt of every key the WebGPU shader lookup makes, computed here once for
// the page's build (`client/vite.config.ts`, `__WGSL_TRANSLATORS__`) and for
// the tools, by one function.

import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

/** The client package's directory, where the page's build resolves its imports from. */
export const CLIENT_DIR = fileURLToPath(new URL('../../../client/', import.meta.url));

/**
 * The translators' files, each loader and its WebAssembly, resolved as the
 * client resolves `@babylonjs/core/assets/<name>/<name>.<js|wasm>`.
 * `clientDir` is passed by a caller whose own location Vite may have moved
 * (the page's config, which Vite bundles before it runs).
 */
export function translatorFiles(clientDir = CLIENT_DIR) {
  const resolve = createRequire(join(clientDir, 'package.json')).resolve;
  const file = (name, kind) => resolve(`@babylonjs/core/assets/${name}/${name}.${kind}`);
  return {
    glslang: { js: file('glslang', 'js'), wasm: file('glslang', 'wasm') },
    twgsl: { js: file('twgsl', 'js'), wasm: file('twgsl', 'wasm') },
  };
}

/**
 * `glslang=<hex>|twgsl=<hex>|glslang.js=<hex>|twgsl.js=<hex>`: the SHA-256 of
 * each translator's WebAssembly and of its loader (which holds the
 * translator's defaults and its wrapper). A translator that changes makes
 * every key made before unreachable.
 */
export function translatorDigests(clientDir = CLIENT_DIR) {
  const files = translatorFiles(clientDir);
  const digest = (path) => createHash('sha256').update(readFileSync(path)).digest('hex');
  return (
    `glslang=${digest(files.glslang.wasm)}|twgsl=${digest(files.twgsl.wasm)}` +
    `|glslang.js=${digest(files.glslang.js)}|twgsl.js=${digest(files.twgsl.js)}`
  );
}

/**
 * Runs one translator's loader, a classic script, in a context of its own and
 * starts the translator it defines, as the page does (`startTranslator`,
 * `gpuEngine.ts`): the global `name`, called with the WebAssembly's path.
 * Each loader declares a top-level `var Module` that the other's would
 * replace in a shared context, so each gets its own. As ES modules they
 * define nothing. The context is a browser page's as far as the loaders look:
 * their fetch of the WebAssembly is answered with the file's bytes, the
 * page's is answered with the same file downloaded.
 */
function start(name, files) {
  const bytes = readFileSync(files.wasm);
  const context = vm.createContext({
    console,
    TextDecoder,
    TextEncoder,
    performance,
    crypto,
    setTimeout,
    clearTimeout,
    window: {},
    document: {},
    fetch: async () => new Response(bytes, { headers: { 'content-type': 'application/wasm' } }),
  });
  vm.runInContext(readFileSync(files.js, 'utf8'), context, { filename: files.js });
  const factory = context[name];
  if (typeof factory !== 'function') throw new Error(`the ${name} loader defined nothing`);
  return factory(`${name}.wasm`);
}

/**
 * The two translators, started, as Babylon holds them: glslang's
 * `compileGLSL`, and Babylon's own wrapper of twgsl (`WebGPUTintWASM`, which
 * puts the uniformity diagnostic before the WGSL of a stage that turns the
 * analysis off), handed twgsl as the page hands it (`initTwgsl`).
 */
export async function startTranslators(files = translatorFiles()) {
  // Imported here, not above: the page's build config loads this module for
  // `translatorDigests` alone, and needs no Babylon for it.
  const { WebGPUTintWASM } = await import('@babylonjs/core/Engines/WebGPU/webgpuTintWASM.js');
  const glslang = await start('glslang', files.glslang);
  const twgsl = await start('twgsl', files.twgsl);
  const tint = new WebGPUTintWASM();
  await tint.initTwgsl({ twgsl });
  return { glslang, twgsl, tint };
}

/**
 * The WGSL of one stage, as the page translates it (`translate` in
 * `lookUpShaders`): the stage's text to SPIR-V by glslang, called as
 * Babylon's `_compileRawShaderToSpirV` calls it, then to WGSL through
 * Babylon's wrapper with the stage's uniformity switch. Throws where a
 * translator does.
 */
export function translateStage(translators, entry) {
  const spirv = translators.glslang.compileGLSL(entry.glsl, entry.stage);
  return translators.tint.convertSpirV2WGSL(spirv, entry.flag);
}
