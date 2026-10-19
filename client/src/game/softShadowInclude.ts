/**
 * The soft shadow's filter without its arrays.
 *
 * Babylon's percentage-closer soft shadow (`shadowsFragmentFunctions`, the
 * `SHADOWPCSS` path the high tier takes, `lighting.ts`) finds the blockers
 * round a sample with 16 reads of the depth map and filters with 32 reads of
 * the shadow map, each read offset by an entry of a 64-entry Poisson table.
 * The table is a function-scope constant array passed by value into the
 * filter and indexed by the loop counters. On WebGL2 that compiles to what it
 * says. On WebGPU the GLSL goes through SPIR-V to WGSL, and the compiler at
 * the end keeps a by-value array in memory and reads every tap's offset back
 * through it, for every lit fragment of the frame: the high tier drew at 1.4
 * frames a second on an Apple M4 with the filter and 15 without it, and the
 * same scene on WebGL2 at 11 (2026-10-18). The paint pass met the same cost
 * in its sector sums (`paint.fragment.fx`); the cure is the same: no array.
 *
 * `unrolledSoftShadows` rewrites the 32-tap cascaded function, the one the
 * tier calls, with its taps written out, each offset a literal taken from
 * Babylon's own table, so the text is the same arithmetic without the
 * array. The other functions of the include are left as they are; nothing
 * calls them on this path, and the translators drop a function nothing
 * calls. Pure, so the rewrite is tested under Node against the installed
 * include; `installSoftShadows` puts the rewritten text in Babylon's store,
 * once, before any material compiles.
 */
import { Effect } from "@babylonjs/core/Materials/effect.js";
import "@babylonjs/core/Shaders/ShadersInclude/shadowsFragmentFunctions.js";

/** The include's name in Babylon's store. */
export const SOFT_SHADOW_INCLUDE = "shadowsFragmentFunctions";
/** The mark the rewritten text carries, so it is rewritten once. */
export const UNROLLED_MARK = "/* dayhike: soft shadow taps unrolled */";
/** The tier's filter: 16 blocker taps, 32 filter taps (`ShadowGenerator.QUALITY_MEDIUM`). */
export const SEARCH_TAPS = 16;
export const FILTER_TAPS = 32;

const TABLE_HEAD = "const vec3 PoissonSamplers32[64]=vec3[64](";

/** Where a function of the include is: its head, where its body's `{` line begins, and the index after its closing `}`. */
export function functionSpan(include: string, name: string): { head: number; bodyStart: number; end: number } | null {
  const head = include.indexOf(`float ${name}(`);
  if (head < 0) return null;
  const bodyStart = include.indexOf("\n{", head);
  if (bodyStart < 0) return null;
  let depth = 0;
  for (let i = bodyStart + 1; i < include.length; i++) {
    const c = include[i];
    if (c === "{") depth++;
    else if (c === "}" && --depth === 0) return { head, bodyStart, end: i + 1 };
  }
  return null;
}

/** The table's entries as Babylon writes them, `[x, y]` text each. */
export function poissonTable(include: string): [string, string][] {
  const start = include.indexOf(TABLE_HEAD);
  if (start < 0) throw new Error("soft shadows: no Poisson table in the include");
  const end = include.indexOf(");", start);
  const body = include.slice(start + TABLE_HEAD.length, end);
  const entries: [string, string][] = [];
  // Babylon pads the 32-tap table to 64 with `vec3(0.)`, one scalar for all three.
  for (const m of body.matchAll(/vec3\(([^)]*)\)/g)) {
    const parts = m[1]!.split(",").map((s) => s.trim());
    if (parts.length === 1) entries.push([parts[0]!, parts[0]!]);
    else if (parts.length === 3) entries.push([parts[0]!, parts[1]!]);
    else throw new Error(`soft shadows: a table entry of ${parts.length} parts`);
  }
  if (entries.length !== 64) throw new Error(`soft shadows: ${entries.length} table entries, not 64`);
  return entries;
}

/** The 32-tap cascaded function's body with its taps written out. */
function unrolledBody(table: readonly [string, string][]): string {
  const lines: string[] = [];
  lines.push("{vec3 clipSpace=vPositionFromLight.xyz/vPositionFromLight.w;vec3 uvDepth=vec3(0.5*clipSpace.xyz+vec3(0.5));");
  lines.push("#ifdef USE_REVERSE_DEPTHBUFFER");
  lines.push("uvDepth.z=clamp(ZINCLIP,SMALLEST_ABOVE_ZERO,1.);");
  lines.push("#else");
  lines.push("uvDepth.z=clamp(ZINCLIP,0.,GREATEST_LESS_THAN_ONE);");
  lines.push("#endif");
  lines.push(
    "vec4 uvDepthLayer=vec4(uvDepth.x,uvDepth.y,layer,uvDepth.z);float blockerDepth=0.0;float sumBlockerDepth=0.0;float numBlocker=0.0;" +
      "vec2 searchScale=lightSizeUV*lightSizeUVCorrection*shadowMapSizeInverse;",
  );
  for (let i = 0; i < SEARCH_TAPS; i++) {
    const [x, y] = table[i]!;
    lines.push(
      `blockerDepth=texture2D(depthSampler,vec3(uvDepth.xy+searchScale*vec2(${x},${y}),layer)).r;if (blockerDepth<depthMetric) {sumBlockerDepth+=blockerDepth;numBlocker++;}`,
    );
  }
  lines.push(
    "float avgBlockerDepth=sumBlockerDepth/numBlocker;float AAOffset=shadowMapSizeInverse*10.;float penumbraRatio=((depthMetric-avgBlockerDepth)*depthCorrection+AAOffset);" +
      "vec2 filterRadius=penumbraRatio*lightSizeUV*lightSizeUVCorrection*shadowMapSizeInverse;float random=getRand(vPositionFromLight.xy);float rotationAngle=random*3.1415926;" +
      "vec2 rotationVector=vec2(cos(rotationAngle),sin(rotationAngle));float shadow=0.;",
  );
  for (let i = 0; i < FILTER_TAPS; i++) {
    const [x, y] = table[i]!;
    lines.push(
      // Each literal in parentheses: a negative entry after `-` would read as `--`.
      `shadow+=texture2D(shadowSampler,uvDepthLayer+vec4(((${x})*rotationVector.x-(${y})*rotationVector.y)*filterRadius.x,((${y})*rotationVector.x+(${x})*rotationVector.y)*filterRadius.y,0.,0.));`,
    );
  }
  lines.push(
    `shadow/=${FILTER_TAPS}.;shadow=mix(shadow,1.,min((depthMetric-avgBlockerDepth)*depthCorrection*penumbraDarkness,1.));shadow=mix(darkness,1.,shadow);if (numBlocker<1.0) {return 1.0;}`,
  );
  lines.push("else");
  lines.push("{return computeFallOff(shadow,clipSpace.xy,frustumEdgeFalloff);}}");
  return lines.join("\n");
}

/**
 * The include with `computeShadowWithCSMPCSS32`'s body unrolled: the same
 * signature, the same arithmetic, no array. The text given back unchanged
 * where it carries the mark already.
 */
export function unrolledSoftShadows(include: string): string {
  if (include.includes(UNROLLED_MARK)) return include;
  const table = poissonTable(include);
  const span = functionSpan(include, "computeShadowWithCSMPCSS32");
  if (span === null) throw new Error("soft shadows: no 32-tap cascaded function in the include");
  // The mark just inside the include's guard: Babylon's inliner wants a
  // function's brace right after its signature, so nothing goes between
  // them; and a stage that casts and receives no shadow drops the guarded
  // text whole, so its own text is as it was and its recorded translation
  // (`client/shaders/corpus/`) still serves it.
  const guard = "#ifdef SHADOWS\n";
  const at = include.indexOf(guard);
  if (at < 0) throw new Error("soft shadows: the include has no SHADOWS guard");
  const marked = include.slice(0, at + guard.length) + UNROLLED_MARK + "\n" + include.slice(at + guard.length);
  const offset = UNROLLED_MARK.length + 1;
  return marked.slice(0, span.bodyStart + offset) + "\n" + unrolledBody(table) + marked.slice(span.end + offset);
}

/** Puts the unrolled include in Babylon's store, once; what it holds after. */
export function installSoftShadows(store: Record<string, string> = Effect.IncludesShadersStore): string {
  const base = store[SOFT_SHADOW_INCLUDE];
  if (base === undefined) throw new Error("soft shadows: Babylon's include is not registered");
  const text = unrolledSoftShadows(base);
  store[SOFT_SHADOW_INCLUDE] = text;
  return text;
}
