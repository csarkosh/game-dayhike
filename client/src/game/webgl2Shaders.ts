/**
 * The shaders Babylon loads lazily on the WebGL2 path, fetched ahead on a page
 * drawing with WebGPU, so a fall back to WebGL2 later needs no network.
 *
 * A Babylon material, shadow generator or post-process imports its shader
 * modules the first time it is readied, in the engine's language: WGSL on the
 * WebGPU engine (the PBR and standard materials excepted, which this project
 * forces to GLSL, `gpuEngine.ts`), GLSL on WebGL2. The build gives each module
 * a chunk of its own, so a WebGPU page has never fetched the GLSL chunks of
 * the shadows, the depth pass or the post chain, and the renderer the game
 * rebuilds on WebGL2 after a failure of its engine (`answerFailures`) fetches
 * them then. On 2026-10-19 that rebuild ran while the network was down (the
 * laptop had just woken): the imports failed, the shadows' effects never
 * compiled, and the player got a scene without them. Fetched once at idle
 * after the start, the modules are in the page's module map, and a later
 * import of the same module is answered from it with no request.
 *
 * `WEBGL2_SHADER_MODULES` names every GLSL shader module the WebGL2 renderer
 * loads lazily at any tier, each under the specifier it imports, as literal
 * imports so the build resolves them to the same chunks Babylon's own imports
 * do. `webgl2Shaders.test.ts` builds the renderer at each tier and fails
 * when it loads a module not listed here. Each entry imports its includes
 * statically, so those come with it; `Misc/dumpTools` is the one module
 * listed that is no shader: every render target imports it as it is first
 * readied, the shadow maps included.
 */
export const WEBGL2_SHADER_MODULES: Readonly<Record<string, () => Promise<unknown>>> = {
  "@babylonjs/core/Misc/dumpTools.js": () => import("@babylonjs/core/Misc/dumpTools.js"),
  "@babylonjs/core/Shaders/pbr.vertex.js": () => import("@babylonjs/core/Shaders/pbr.vertex.js"),
  "@babylonjs/core/Shaders/pbr.fragment.js": () => import("@babylonjs/core/Shaders/pbr.fragment.js"),
  "@babylonjs/core/Shaders/shadowMap.vertex.js": () => import("@babylonjs/core/Shaders/shadowMap.vertex.js"),
  "@babylonjs/core/Shaders/shadowMap.fragment.js": () => import("@babylonjs/core/Shaders/shadowMap.fragment.js"),
  "@babylonjs/core/Shaders/depthBoxBlur.fragment.js": () => import("@babylonjs/core/Shaders/depthBoxBlur.fragment.js"),
  "@babylonjs/core/Shaders/ShadersInclude/shadowMapFragmentSoftTransparentShadow.js": () => import("@babylonjs/core/Shaders/ShadersInclude/shadowMapFragmentSoftTransparentShadow.js"),
  "@babylonjs/core/Shaders/kernelBlur.vertex.js": () => import("@babylonjs/core/Shaders/kernelBlur.vertex.js"),
  "@babylonjs/core/Shaders/kernelBlur.fragment.js": () => import("@babylonjs/core/Shaders/kernelBlur.fragment.js"),
  "@babylonjs/core/Shaders/postprocess.vertex.js": () => import("@babylonjs/core/Shaders/postprocess.vertex.js"),
  "@babylonjs/core/Shaders/pass.fragment.js": () => import("@babylonjs/core/Shaders/pass.fragment.js"),
  "@babylonjs/core/Shaders/fxaa.vertex.js": () => import("@babylonjs/core/Shaders/fxaa.vertex.js"),
  "@babylonjs/core/Shaders/fxaa.fragment.js": () => import("@babylonjs/core/Shaders/fxaa.fragment.js"),
  "@babylonjs/core/Shaders/particles.vertex.js": () => import("@babylonjs/core/Shaders/particles.vertex.js"),
  "@babylonjs/core/Shaders/particles.fragment.js": () => import("@babylonjs/core/Shaders/particles.fragment.js"),
  // The standard material: the trailhead's and the body's, built outside the renderer.
  "@babylonjs/core/Shaders/default.vertex.js": () => import("@babylonjs/core/Shaders/default.vertex.js"),
  "@babylonjs/core/Shaders/default.fragment.js": () => import("@babylonjs/core/Shaders/default.fragment.js"),
};

/** What one load of the modules came to: the specifiers that could not be loaded. */
export type ShadersLoaded = { failed: string[] };

let loaded: Promise<ShadersLoaded> | null = null;

/**
 * Loads every module of `modules` (the page's, by default), each on its own
 * so one that fails keeps no other out, and says which failed. The page's
 * modules are loaded once: a second call shares the first load, unless that
 * load failed in part, when it loads again (the network may be back).
 */
export function loadWebGl2Shaders(modules: Readonly<Record<string, () => Promise<unknown>>> = WEBGL2_SHADER_MODULES): Promise<ShadersLoaded> {
  const page = modules === WEBGL2_SHADER_MODULES;
  if (page && loaded !== null) return loaded;
  const load = Promise.all(
    Object.entries(modules).map(([spec, load]) =>
      load().then(
        () => null,
        () => spec,
      ),
    ),
  ).then((outcomes) => {
    const failed = outcomes.filter((spec): spec is string => spec !== null);
    if (page && failed.length > 0) loaded = null;
    return { failed };
  });
  if (page) loaded = load;
  return load;
}

/** Drops the page's one load, so the next `loadWebGl2Shaders` loads again (the suite). */
export function forgetWebGl2Shaders(): void {
  loaded = null;
}

/**
 * Fetches the WebGL2 shaders ahead, when the page is next idle (`deps.idle`),
 * saying through `deps.log` what could not be fetched; nothing where the
 * function returned is called first. For a hike started on WebGPU, once its
 * world is in (`app.ts`), so the fetches take nothing from the start.
 */
export function prefetchWebGl2Shaders(deps: {
  /** Calls `fn` once when the page is idle; the function returned cancels that. */
  idle(fn: () => void): () => void;
  load(): Promise<ShadersLoaded>;
  log(line: string): void;
}): () => void {
  let cancelled = false;
  const stop = deps.idle(() => {
    void deps.load().then(({ failed }) => {
      if (cancelled || failed.length === 0) return;
      deps.log(`WebGL2: ${failed.length} of the shaders fetched ahead for a fall back could not be fetched: ${failed.join(", ")}`);
    });
  });
  return () => {
    cancelled = true;
    stop();
  };
}

/**
 * Calls `fn` once when the browser is idle (`requestIdleCallback`), or on the
 * next turn where the browser has no such thing; the function returned cancels
 * that.
 */
export function pageIdle(fn: () => void): () => void {
  const page = globalThis as { requestIdleCallback?: (fn: () => void) => number; cancelIdleCallback?: (id: number) => void };
  if (typeof page.requestIdleCallback === "function") {
    const id = page.requestIdleCallback(fn);
    return () => page.cancelIdleCallback?.(id);
  }
  const id = setTimeout(fn, 0);
  return () => clearTimeout(id);
}
