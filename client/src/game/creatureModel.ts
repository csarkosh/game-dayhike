/**
 * The `creature` asset kind at runtime: the
 * EnemyModelPool pattern generalised to wildlife roles. One cloned container
 * per visible animal with its own clip playback; the pool is keyed by the
 * caller's integer (unit id × 16 + member), and a species whose asset is not
 * in the catalog simply has no animals — there is no capsule fallback for
 * wildlife, because an ambient elk that renders as a violet capsule is worse
 * than no elk.
 */
import { loadAssetContainerAsync } from "@babylonjs/core/Loading/sceneLoader.js";
import type { AssetContainer } from "@babylonjs/core/assetContainer.js";
import type { AnimationGroup } from "@babylonjs/core/Animations/animationGroup.js";
import type { Scene } from "@babylonjs/core/scene.js";
import type { TransformNode } from "@babylonjs/core/Meshes/transformNode.js";
import { registerBuiltInLoaders } from "@babylonjs/loaders/dynamic.js";
import catalog from "../../assets/catalog.json" with { type: "json" };
import { modelUrl } from "./assetUrls.js";
import { orientationRoot } from "./enemyModel.js";
import type { ClipRole } from "./wildlifeBehaviour.js";

export type { ClipRole } from "./wildlifeBehaviour.js";

const ROLES: readonly ClipRole[] = ["graze", "idle", "walk", "run", "alert"];
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
export type CreatureInstance = { root: TransformNode; play(role: ClipRole): void; dispose(): void };
export type CreaturePool = {
  load(scene: Scene): Promise<void>;
  has(assetId: string): boolean;
  acquire(key: number, assetId: string): CreatureInstance | null;
  release(key: number): void;
  dispose(): void;
};

/**
 * Every `creature` asset in the catalog, in catalog order, with its clip-role
 * map. Mirrors `resolveEnemyAssets` in enemyModel.ts: reading the catalog here
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
      for (const role of ROLES) {
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
 * (this file's first pass, and `enemyModel.ts`'s `pickClip` today) treats a
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
 * (inherited from `enemyModel.ts`'s `pickClip`; the same fix applies there
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
 * `play` runs once per member per frame (`wildlifeMeshes.ts`), and resolving the
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
  for (const role of ROLES) {
    const name = creatureClipFor(asset, clipNames, role);
    byRole.set(role, name === null ? null : (byName.get(name) ?? null));
  }
  return byRole;
}

type Loaded = { asset: CreatureAsset; container: AssetContainer; clipNames: string[] };

/**
 * One cloned instance per visible animal, keyed by the caller's integer key
 * (unit id × 16 + member — see wildlifeField.ts). Mirrors `EnemyModelPool`:
 * `instantiateModelsToScene` shares geometry and skeleton data across copies,
 * `orientationRoot` wraps the loader's converted root so callers can drive yaw
 * without fighting its `rotationQuaternion`, and a variant that fails to load
 * simply has no instances rather than substituting a placeholder.
 */
export function createCreaturePool(): CreaturePool {
  const assets = resolveCreatureAssets(catalog);
  const loaded = new Map<string, Loaded>();
  const instances = new Map<number, CreatureInstance>();
  return {
    async load(scene) {
      if (assets.length === 0) return; // no creature assets shipped yet; no animals
      registerBuiltInLoaders();
      for (const asset of assets) {
        try {
          const container = await loadAssetContainerAsync(asset.url, scene);
          // Stop the source clips: only the instantiated copies should animate.
          for (const g of container.animationGroups) g.stop();
          loaded.set(asset.id, { asset, container, clipNames: container.animationGroups.map((g) => g.name) });
        } catch {
          // One bad asset costs its own species and nothing else.
        }
      }
    },
    has: (assetId) => loaded.has(assetId),
    acquire(key, assetId) {
      const existing = instances.get(key);
      if (existing) return existing;
      const variant = loaded.get(assetId);
      if (variant === undefined) return null;
      const entries = variant.container.instantiateModelsToScene((name) => `creature_${key}_${name}`, false);
      const loadedRoot = entries.rootNodes[0];
      if (loadedRoot === undefined) return null;
      const root = orientationRoot(loadedRoot as TransformNode, `creature_${key}_orientation`);
      for (const g of entries.animationGroups) g.stop();
      // Both maps are built once, here: `play` runs every frame and must not
      // re-resolve a role (see `creatureRoleGroups`).
      const byName = creatureGroupsByName<AnimationGroup>(
        variant.clipNames, `creature_${key}_`, entries.animationGroups,
      );
      const byRole = creatureRoleGroups(variant.asset, variant.clipNames, byName);
      let current: AnimationGroup | null = null;
      const instance: CreatureInstance = {
        root,
        play(role) {
          const next = byRole.get(role) ?? null;
          if (next === null || next === current) return;
          current?.stop();
          // alert is a held pose (head up), not a cycle — PHASE_ALERT is
          // a freeze, and looping it would show a repeating
          // head-raise instead of a held one. Every other role loops, mirroring
          // enemyModel.ts's `next.play(kind !== "death")` holding death's final
          // frame instead of looping it.
          next.play(role !== "alert");
          current = next;
        },
        dispose() {
          entries.dispose();
          root.dispose(); // the wrapper is ours, not the instantiation's
          instances.delete(key);
        },
      };
      instances.set(key, instance);
      return instance;
    },
    release(key) {
      instances.get(key)?.dispose();
    },
    dispose() {
      for (const k of [...instances.keys()]) instances.get(k)?.dispose();
      for (const v of loaded.values()) v.container.dispose();
      loaded.clear();
    },
  };
}
