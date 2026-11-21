/**
 * The `creature` asset kind as the catalog names it: each species' model
 * file and which clip of it plays each wildlife role, with the fallbacks a
 * role degrades through. Plain reads of the catalog and of a file's clip
 * names, so whichever renderer draws an animal asks the same file for the
 * same clip.
 */
import { modelUrl } from "./assetUrls.js";
import type { ClipRole } from "@csarkosh/engine/game/wildlifeBehaviour";

export type { ClipRole } from "@csarkosh/engine/game/wildlifeBehaviour";

/** Every wildlife role, in the order a model's clips are resolved. */
export const CREATURE_ROLES: readonly ClipRole[] = ["graze", "idle", "walk", "run", "alert"];
/** Fallback chain when a role is not declared or not in the file (idle and alert are optional). */
const FALLBACK: Record<ClipRole, readonly ClipRole[]> = {
  graze: ["idle"],
  idle: ["graze"],
  walk: ["run"],
  run: ["walk"],
  alert: ["idle", "graze"],
};
const SYNONYMS: Record<ClipRole, string[]> = {
  graze: ["graze", "eat", "feed", "idle_eat"],
  idle: ["idle", "stand", "look"],
  walk: ["walk", "trot"],
  run: ["run", "gallop", "sprint", "hop"],
  alert: ["alert", "listen", "head_up", "headup"],
};

export type CreatureAsset = { id: string; url: string; clips: Partial<Record<ClipRole, string>> };

/**
 * Every `creature` asset in the catalog, in catalog order, with its clip-role
 * map. Mirrors `resolveCharacterAssets` in characterAssets.ts: reading the catalog here
 * means adding a species needs no code change, and going through `urlFor`
 * (defaulting to `modelUrl`) means a catalog entry with no shipped file behind
 * it throws at startup rather than 404ing at runtime.
 *
 * `urlFor` is overridable — not just for `modelUrl`'s convenience — because
 * `modelUrl` throws on any `output` it does not recognise, and the catalog has
 * no `creature` entries yet (this returns `[]` on the real catalog today).
 * Tests that resolve a synthetic catalog with a `creature` entry need a
 * stand-in that does not require a real shipped file on disk.
 */
export function resolveCreatureAssets(
  source: unknown,
  urlFor: (output: string) => string = modelUrl,
): CreatureAsset[] {
  if (typeof source !== "object" || source === null) return [];
  const entries = (source as { assets?: unknown }).assets;
  if (!Array.isArray(entries)) return [];
  const found: CreatureAsset[] = [];
  for (const entry of entries) {
    if (typeof entry !== "object" || entry === null) continue;
    const a = entry as { id?: unknown; kind?: unknown; output?: unknown; animations?: unknown };
    if (a.kind !== "creature" || typeof a.id !== "string" || typeof a.output !== "string") continue;
    const clips: Partial<Record<ClipRole, string>> = {};
    if (typeof a.animations === "object" && a.animations !== null) {
      for (const role of CREATURE_ROLES) {
        const v = (a.animations as Record<string, unknown>)[role];
        if (typeof v === "string" && v.length > 0) clips[role] = v;
      }
    }
    found.push({ id: a.id, url: urlFor(a.output), clips });
  }
  return found;
}

/**
 * The name split into lower-case, alphanumeric tokens, exporter prefix (the
 * part before `|`, e.g. `"CharacterArmature|"`) stripped first.
 */
function tokensOf(name: string): string[] {
  const tail = name.includes("|") ? (name.split("|").pop() as string) : name;
  return tail.toLowerCase().split(/[^a-z0-9]+/).filter((t) => t.length > 0);
}

/**
 * Matches a synonym against whole tokens, not substrings. Plain `.includes()`
 * (this file's first pass, and `characterAssets.ts`'s `pickClip` today) treats a
 * synonym as a substring of the whole clip name, so `"eat"` matches inside
 * `"Death"` and `"run"` matches inside `"Trunk_Idle"` or `"Grunt"` — false
 * positives that get more likely here than in the enemy list, because
 * `graze`'s `"eat"` and `run`'s `"run"` are short, generic strings apt to
 * turn up inside unrelated animal-rig clip names. A token must equal the
 * synonym outright, or equal it with a trailing digit run (`Walk_01`,
 * `run2`) — the numbering exporters append for take variants.
 */
function bySynonym(available: readonly string[], role: ClipRole): string | null {
  for (const s of SYNONYMS[role]) {
    for (const name of available) {
      for (const token of tokensOf(name)) {
        if (token === s || (token.startsWith(s) && /^\d+$/.test(token.slice(s.length)))) return name;
      }
    }
  }
  return null;
}

/**
 * Which clip in a shipped file plays a given role, for one asset.
 *
 * The catalog's mapping wins when it names a clip that is actually present in
 * the file (a mapped clip that is absent fails validation before it ships, so a
 * declared name that is present is verified, not guessed). Failing that, a synonym match
 * against the file's own clip names; failing that, the role's fallback chain
 * (`alert` and `idle` are optional and degrade to a nearby role) tried
 * the same way — declared name first, then synonym.
 */
export function creatureClipFor(
  asset: CreatureAsset,
  available: readonly string[],
  role: ClipRole,
): string | null {
  const declared = asset.clips[role];
  if (declared !== undefined && available.includes(declared)) return declared;
  const direct = bySynonym(available, role);
  if (direct !== null) return direct;
  for (const fb of FALLBACK[role]) {
    const d = asset.clips[fb];
    if (d !== undefined && available.includes(d)) return d;
    const s = bySynonym(available, fb);
    if (s !== null) return s;
  }
  return null;
}

/**
 * One instantiated clone's animation groups, keyed by the ORIGINAL clip name.
 *
 * `instantiateModelsToScene` renames every cloned group through the name
 * function it is given, so the instantiated name is known exactly:
 * `` `${prefix}${original}` ``. Preferring that over a substring scan matters
 * because `includes` maps `Walk_Fast` onto `Walk` whenever `Walk` comes first in
 * the file's clip list — one group under two names and the real `Walk` lost
 * (inherited from `characterAssets.ts`'s `pickClip`; the same fix applies there
 * someday). The scan stays as the fallback for a loader that renames some other
 * way.
 *
 * Generic over `{ name }` rather than typed to `AnimationGroup` so it can be
 * exercised without a GPU: the pool has no seam for a fake container, and this
 * is the half of `acquire` worth pinning.
 */
export function creatureGroupsByName<T extends { name: string }>(
  clipNames: readonly string[],
  prefix: string,
  groups: readonly T[],
): Map<string, T> {
  const byName = new Map<string, T>();
  for (const g of groups) {
    const exact = clipNames.find((n) => g.name === `${prefix}${n}`);
    byName.set(exact ?? clipNames.find((n) => g.name.includes(n)) ?? g.name, g);
  }
  return byName;
}

/**
 * Every role resolved to its group ONCE, at acquire — the whole of `play`'s
 * decision, precomputed.
 *
 * `play` runs once per member per frame (`lite/wildlifeMeshes.ts`), and resolving the
 * role there ran `creatureClipFor` every time. For a role the catalog does not
 * declare — `alert` and `idle` are optional — that falls to the synonym
 * scan, which splits and filters a fresh array per clip name per synonym: for a
 * 53-clip elk, a herd of eight standing alert is thousands of arrays a frame,
 * for as long as the alert lasts. The mapping is static per
 * asset, so it belongs here; `play` becomes a map read.
 */
export function creatureRoleGroups<T>(
  asset: CreatureAsset,
  clipNames: readonly string[],
  byName: ReadonlyMap<string, T>,
): Map<ClipRole, T | null> {
  const byRole = new Map<ClipRole, T | null>();
  for (const role of CREATURE_ROLES) {
    const name = creatureClipFor(asset, clipNames, role);
    byRole.set(role, name === null ? null : (byName.get(name) ?? null));
  }
  return byRole;
}
