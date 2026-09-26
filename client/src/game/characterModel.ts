import { loadAssetContainerAsync } from "@babylonjs/core/Loading/sceneLoader.js";
import type { AssetContainer } from "@babylonjs/core/assetContainer.js";
import type { AnimationGroup } from "@babylonjs/core/Animations/animationGroup.js";
import type { Scene } from "@babylonjs/core/scene.js";
import type { Material } from "@babylonjs/core/Materials/material.js";
import { TransformNode } from "@babylonjs/core/Meshes/transformNode.js";
import { registerBuiltInLoaders } from "@babylonjs/loaders/dynamic.js";
import "./ktx2.js";
import { attachSkinToMaterials } from "./skin.js";

import catalog from "../../assets/catalog.json" with { type: "json" };
import { modelUrl } from "./assetUrls.js";

export type ClipKind = "idle" | "walk" | "attack" | "death";

const SYNONYMS: Record<ClipKind, string[]> = {
  idle: ["idle", "stand"],
  walk: ["walk", "run", "move", "jog"],
  attack: ["attack", "punch", "swipe", "hit", "melee"],
  death: ["death", "die", "dead"],
};

export function pickClip(names: string[], want: ClipKind): string | null {
  const wanted = SYNONYMS[want];
  for (const synonym of wanted) {
    for (const name of names) {
      // Match against the segment after any exporter prefix like
      // "CharacterArmature|Attack_01", but fall back to the whole string.
      const tail = name.includes("|") ? (name.split("|").pop() as string) : name;
      if (tail.toLowerCase().includes(synonym) || name.toLowerCase().includes(synonym)) {
        return name;
      }
    }
  }
  return null;
}
export type CharacterAsset = {
  /** The catalog's own `id`. Keys the pool's loaded-model map. */
  id: string;
  /** The catalog's `output`, relative to `client/assets/`. */
  output: string;
  url: string;
  clips: Partial<Record<ClipKind, string>>;
};

/**
 * Every character asset in the catalog, in catalog order.
 *
 * The URL is derived rather than hardcoded: shipped output lives under
 * `client/assets/`, keyed by the catalog's `output` field. `modelUrl` turns
 * that into whatever Vite serves the file at — content-hashed in production.
 * Reading the catalog here means adding a character needs no code change and
 * the two cannot drift apart; going through `modelUrl` means a catalog entry
 * with no shipped file behind it throws at startup instead of 404ing into a
 * capsule.
 *
 * Returns an empty array when no character asset is present. Every character
 * then stays a capsule.
 */
export function resolveCharacterAssets(
  source: unknown,
  urlFor: (output: string) => string = modelUrl,
): CharacterAsset[] {
  if (typeof source !== "object" || source === null) return [];
  const entries = (source as { assets?: unknown }).assets;
  if (!Array.isArray(entries)) return [];

  const found: CharacterAsset[] = [];
  for (const entry of entries) {
    if (typeof entry !== "object" || entry === null) continue;
    const asset = entry as {
      id?: unknown;
      kind?: unknown;
      output?: unknown;
      animations?: unknown;
    };
    if (asset.kind !== "character") continue;
    if (typeof asset.id !== "string" || asset.id.length === 0) continue;
    if (typeof asset.output !== "string" || asset.output.length === 0) continue;

    const clips: Partial<Record<ClipKind, string>> = {};
    const named = asset.animations;
    if (typeof named === "object" && named !== null) {
      for (const kind of ["idle", "walk", "attack", "death"] as const) {
        const value = (named as Record<string, unknown>)[kind];
        if (typeof value === "string" && value.length > 0) clips[kind] = value;
      }
    }
    found.push({ id: asset.id, output: asset.output, url: urlFor(asset.output), clips });
  }
  return found;
}

/**
 * Which entry of a fixed list an entity wears, derived from its id.
 *
 * Round-robin rather than a hash. The host and every client build views
 * independently, so deriving the choice from the id makes it replicated by
 * construction — nothing about model assignment crosses the wire, and nothing
 * has to. A random draw at spawn would show two players different models for
 * the same entity. Round-robin also guarantees a mix at small counts, where a
 * hash would clump. The list must be a fixed one, never whatever happened to
 * load, or peers would disagree the moment one of them failed a download.
 */
export function variantForId<T>(list: readonly T[], id: number): T | null {
  if (list.length === 0) return null;
  return list[Math.abs(Math.trunc(id)) % list.length] ?? null;
}

/**
 * Which clip in a shipped file plays a given role, for one asset.
 *
 * The catalog's mapping wins, because a mapped clip that is absent from the
 * shipped file fails validation before it ships — so a declared name that is
 * present is verified, not guessed. `pickClip` is the fallback for a model
 * whose clips were never mapped, or one that renamed them in a later release.
 */
export function clipNameFor(
  asset: Pick<CharacterAsset, "clips">,
  available: readonly string[],
  kind: ClipKind,
): string | null {
  const declared = asset.clips[kind];
  if (declared !== undefined && available.includes(declared)) return declared;
  return pickClip([...available], kind);
}

export type CharacterInstance = {
  /** The node callers position, turn and scale; the model's feet sit at its origin. */
  root: TransformNode;
  play(kind: ClipKind): void;
  /** Playback rate of every clip, so a walk can keep pace with the ground it covers. */
  setSpeed(ratio: number): void;
  dispose(): void;
};

/**
 * Wraps a loaded glTF root in a plain node that callers can position and rotate.
 *
 * The node Babylon's glTF loader hands back carries a `rotationQuaternion` of 180 degrees
 * about Y together with a mirrored Z scale, which is how it reconciles glTF's right-handed
 * space with Babylon's left-handed one. **While a rotationQuaternion is set, Babylon
 * ignores the Euler `rotation` property completely.** Assigning `root.rotation.y` on it
 * therefore does nothing at all — which is why characters would stare in one fixed
 * direction while moving, with a sim yaw that was correct the whole time. Position keeps
 * working because it is independent of the quaternion, so the bug looks like an AI
 * problem rather than a rendering one.
 *
 * Wrapping is preferred over clearing the quaternion or folding the 180 degrees into the
 * Euler angle: both of those depend on the loader's conversion staying exactly what it is
 * today, and neither would fail loudly if it changed.
 */
export function orientationRoot(loaded: TransformNode, name: string): TransformNode {
  const wrapper = new TransformNode(name, loaded.getScene());
  // Plain assignment, not setParent(): the loader's transform is a local conversion that
  // must be preserved as-is, where setParent() would rewrite it to keep world position.
  loaded.parent = wrapper;
  return wrapper;
}

/**
 * Skin shading attaches per material — never globally,
 * because the injected code reads the MR sample only textured PBR materials
 * declare. Materials are shared by every instance of a model, so once here
 * covers the pool.
 */
export function attachSkinToContainer(container: { materials: Material[] }): number {
  return attachSkinToMaterials(container.materials);
}

/** Turns one catalog asset into a loaded container. Tests pass one that reads the file from disk. */
export type CharacterLoader = (asset: CharacterAsset, scene: Scene) => Promise<AssetContainer>;

export type CharacterPool = {
  /**
   * Loads the named assets, each on its own: one bad file costs its own
   * model and nothing else. Resolves once every load has settled.
   */
  load(scene: Scene, assetIds: readonly string[]): Promise<void>;
  /** Whether `assetId` has loaded, so `acquire` can draw it. */
  has(assetId: string): boolean;
  /**
   * The instance drawn for `key`, made on first call. Null while the asset
   * has not loaded (or never will), which callers answer with a placeholder.
   */
  acquire(key: number, assetId: string): CharacterInstance | null;
  release(key: number): void;
  dispose(): void;
};

type LoadedCharacter = {
  asset: CharacterAsset;
  container: AssetContainer;
  clipNames: string[];
};

const defaultLoader: CharacterLoader = (asset, scene) => {
  registerBuiltInLoaders();
  return loadAssetContainerAsync(asset.url, scene);
};

/**
 * Every animated character the game draws, keyed by the caller's integer
 * (an entity id: players and enemies never share one). Only the assets named
 * to `load` are fetched, so a match downloads the models it can show and no
 * others.
 */
export function createCharacterPool(
  source: unknown = catalog,
  loader: CharacterLoader = defaultLoader,
): CharacterPool {
  const assets = new Map(resolveCharacterAssets(source).map((a) => [a.id, a]));
  const loaded = new Map<string, LoadedCharacter>();
  const instances = new Map<number, { assetId: string; instance: CharacterInstance }>();
  let disposed = false;

  async function loadOne(scene: Scene, id: string): Promise<void> {
    const asset = assets.get(id);
    if (asset === undefined || loaded.has(id)) return;
    try {
      const container = await loader(asset, scene);
      // Disposed while the file was in flight: nothing will ever draw it.
      if (disposed) {
        container.dispose();
        return;
      }
      // Stop the source clips: only the instantiated copies should animate.
      for (const group of container.animationGroups) group.stop();
      attachSkinToContainer(container);
      loaded.set(id, { asset, container, clipNames: container.animationGroups.map((g) => g.name) });
    } catch {
      // An asset problem degrades the visuals; it must never block the match.
    }
  }

  function release(key: number): void {
    instances.get(key)?.instance.dispose();
  }

  return {
    async load(scene, assetIds) {
      await Promise.all(assetIds.map((id) => loadOne(scene, id)));
    },

    has: (assetId) => loaded.has(assetId),

    acquire(key, assetId) {
      const existing = instances.get(key);
      if (existing !== undefined) {
        if (existing.assetId === assetId) return existing.instance;
        release(key);
      }
      const model = loaded.get(assetId);
      if (model === undefined) return null;

      // instantiateModelsToScene shares geometry and skeleton data across
      // copies, and (with cloneMaterials false) the materials too.
      const prefix = `character_${key}_`;
      const entries = model.container.instantiateModelsToScene((name) => `${prefix}${name}`, false);
      const loadedRoot = entries.rootNodes[0];
      if (loadedRoot === undefined) {
        entries.dispose();
        return null;
      }
      const root = orientationRoot(loadedRoot as TransformNode, `${prefix}orientation`);

      const groups = new Map<string, AnimationGroup>();
      for (const group of entries.animationGroups) {
        group.stop();
        // Instantiated names get prefixed; match on the original clip name.
        const original = model.clipNames.find((n) => group.name === `${prefix}${n}`)
          ?? model.clipNames.find((n) => group.name.includes(n))
          ?? group.name;
        groups.set(original, group);
      }

      let current: AnimationGroup | null = null;
      let ratio = 1;
      const instance: CharacterInstance = {
        root,
        play: (kind) => {
          const name = clipNameFor(model.asset, model.clipNames, kind);
          const next = name === null ? null : (groups.get(name) ?? null);
          if (next === null || next === current) return;
          current?.stop();
          next.play(kind !== "death"); // death holds its final pose
          next.speedRatio = ratio;
          current = next;
        },
        setSpeed: (value) => {
          if (value === ratio) return;
          ratio = value;
          for (const group of groups.values()) group.speedRatio = value;
        },
        dispose: () => {
          entries.dispose();
          root.dispose(); // the wrapper is ours, not the instantiation's
          if (instances.get(key)?.instance === instance) instances.delete(key);
        },
      };

      instances.set(key, { assetId, instance });
      return instance;
    },

    release,

    dispose() {
      disposed = true;
      for (const key of [...instances.keys()]) release(key);
      for (const model of loaded.values()) model.container.dispose();
      loaded.clear();
    },
  };
}
