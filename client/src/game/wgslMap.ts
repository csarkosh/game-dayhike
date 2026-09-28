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
 * memory as it lands; the lookup waits for that within `WGSL_SOURCES_MS`,
 * beside the store's read. A map that lands after the engine is handed over
 * is found from then on. It holds what it read as the store does: an entry
 * asked for before the start settles is let go at the settle, one not asked
 * for yet is kept, and let go once used.
 *
 * Nothing here is the player's to see: a map that does not come (a fetch
 * refused or never answered, an HTTP error), one made for another build (its
 * salt) or in another format, or one that does not parse is a source with
 * nothing in it, and the lookup translates as the engine always has: never an
 * error, never a switch to WebGL2, never a record. It takes no writes.
 */
import { Logger } from "@babylonjs/core/Misc/logger.js";
import type { WgslSource } from "./shaderLookup.js";
import { readMap } from "./wgslFormat.js";

/** How the report names the map (`hitsBySource`). */
export const WGSL_MAP_SOURCE = "shipped";

/**
 * The map at `url`, for `salt`, as a source of the lookup, at once: its
 * fetch begun, its entries in memory once `ready` resolves (never rejecting),
 * none where the map is not this build's or does not come. `close` aborts a
 * fetch still under way.
 */
export function loadWgslMap(url: string, salt: string, deps: { fetch?: typeof fetch } = {}): WgslSource {
  const request = deps.fetch ?? ((input: RequestInfo | URL, init?: RequestInit) => fetch(input, init));
  const abort = new AbortController();
  /** The WGSL read in. */
  let held = new Map<string, string>();
  /** Keys served from `held` before the settle, let go at it. */
  const served = new Set<string>();
  let settled = false;
  let closed = false;

  const ready = (async (): Promise<void> => {
    const response = await request(url, { signal: abort.signal });
    if (!response.ok) throw new Error(`${url}: ${response.status}`);
    const entries = readMap(await response.text(), salt);
    if (!closed) held = entries;
  })().catch((error: unknown) => {
    if (!closed) Logger.Warn(`WebGPU shader lookup: no translations shipped with the build (${error instanceof Error ? error.message : String(error)})`);
  });

  return {
    name: WGSL_MAP_SOURCE,
    salt,
    ready,
    get: (key) => {
      const wgsl = held.get(key);
      if (wgsl === undefined) return null;
      // Used: kept until the settle, let go at once after it.
      if (settled) held.delete(key);
      else served.add(key);
      return wgsl;
    },
    settle: () => {
      settled = true;
      for (const key of served) held.delete(key);
      served.clear();
    },
    close: () => {
      closed = true;
      settled = true;
      abort.abort();
      held.clear();
      served.clear();
    },
  };
}
