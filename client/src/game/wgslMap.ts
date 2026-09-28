/**
 * The translations shipped with the build, the WebGPU shader lookup's first
 * source (`shaderLookup.ts`), asked before the browser's store: the map
 * `tools/wgsl/build-map.mjs` makes of the shader corpus before Vite runs,
 * each stage's WGSL under the key the page asks for, which the build ships as
 * a content-hashed asset of the WebGPU chunk (`gpuEngine.ts`), served
 * immutable. So a first visit finds the stages the corpus holds, which the
 * store cannot.
 *
 * A preparation never waits (`shaderLookup.ts`), so the map answers from
 * memory: `loadWgslMap` fetches it as the engine is made, and parses it into
 * memory as it lands; the lookup waits for that within its own bound,
 * `WGSL_MAP_MS`, beside the store's read. A map that lands after the engine is handed over
 * is found from then on. What it read is held for the engine's life, as the
 * store's is.
 *
 * Nothing here is the player's to see: a map that does not come (a fetch
 * refused or never answered, an HTTP error), one whose `Content-Length` is
 * over `MAP_MAX_BYTES`, one made for another build (its salt) or in another
 * format, or one that does not parse is a source with
 * nothing in it, and the lookup translates as the engine always has: never an
 * error, never a switch to WebGL2, never a record. It takes no writes.
 */
import { Logger } from "@babylonjs/core/Misc/logger.js";
import type { WgslSource } from "./shaderLookup.js";
import { MAP_MAX_BYTES, readMap } from "./wgslFormat.js";

/** How the report names the map (`hitsBySource`). */
export const WGSL_MAP_SOURCE = "shipped";

/**
 * How long the engine's maker waits for the map, from when its fetch began,
 * within the start's own budget. The map is the difference between a first
 * visit that translates nothing and one that translates every stage (40 s of
 * the page's thread on a machine with 4 virtual CPUs); but a map that lands
 * after the engine is handed over is still found by every stage asked for
 * from then on, and the preparations run on for most of a minute: the few
 * effects made before the world's first frame (the post chain, the sky, one
 * material), then the world's, from its first frame, 4 to 5 s after the
 * hand-over there. So waiting longer buys only those first effects, which
 * cost about a second to translate there, and a map that never comes costs
 * the whole wait: the wait is that second. A start's map, about a megabyte
 * compressed, comes within it over a link of 10 Mbit/s or more.
 */
export const WGSL_MAP_MS = 1_000;

/**
 * The map at `url`, for `salt`, as a source of the lookup, at once: its
 * fetch begun, its entries in memory once `ready` resolves (never rejecting),
 * none where the map is not this build's or does not come. `close` aborts a
 * fetch still under way.
 */
export function loadWgslMap(url: string, salt: string, deps: { fetch?: typeof fetch } = {}): WgslSource {
  const request = deps.fetch ?? ((input: RequestInfo | URL, init?: RequestInit) => fetch(input, init));
  const abort = new AbortController();
  /** The WGSL read in, held for the engine's life. */
  let held = new Map<string, string>();
  let closed = false;

  const ready = (async (): Promise<void> => {
    const response = await request(url, { signal: abort.signal });
    if (!response.ok) throw new Error(`${url}: ${response.status}`);
    // Refused unread where it says it is over the ceiling.
    const length = Number(response.headers.get("content-length"));
    if (length > MAP_MAX_BYTES) {
      abort.abort();
      throw new Error(`${url}: ${length} bytes, over the map's ceiling of ${MAP_MAX_BYTES}`);
    }
    const entries = readMap(await response.text(), salt);
    if (!closed) held = entries;
  })().catch((error: unknown) => {
    if (!closed) Logger.Warn(`WebGPU shader lookup: no translations shipped with the build (${error instanceof Error ? error.message : String(error)})`);
  });

  return {
    name: WGSL_MAP_SOURCE,
    salt,
    ready,
    waitMs: WGSL_MAP_MS,
    get: (key) => held.get(key) ?? null,
    close: () => {
      closed = true;
      abort.abort();
      held.clear();
    },
  };
}
