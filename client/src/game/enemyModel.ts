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

export type EnemyAsset = {
  /** The catalog's own `id`. Keys the pool's loaded-variant map. */
  id: string;
  url: string;
  clips: Partial<Record<ClipKind, string>>;
};

/**
 * Every character asset in the catalog, in catalog order.
 *
 * The URL is derived rather than hardcoded: shipped output lives under
 * `client/assets/`, keyed by the catalog's `output` field. `modelUrl` turns
 * that into whatever Vite serves the file at — content-hashed in production.
 * Reading the catalog here
 * means adding a pack needs no code change and the two cannot drift apart; going
 * through `modelUrl` means a catalog entry with no shipped file behind it throws
 * at startup instead of 404ing into a capsule.
 *
 * Order matters and is preserved: `variantForEnemy` indexes into this array, so
 * two peers only agree on which enemy wears which model because they both read
 * the same static catalog in the same order.
 *
 * Returns an empty array when no character asset is present, which is the
 * shipping state until an asset ships. Enemies then stay capsules.
 */
export function resolveEnemyAssets(source: unknown): EnemyAsset[] {
  if (typeof source !== "object" || source === null) return [];
  const entries = (source as { assets?: unknown }).assets;
  if (!Array.isArray(entries)) return [];

  const found: EnemyAsset[] = [];
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
    found.push({ id: asset.id, url: modelUrl(asset.output), clips });
  }
  return found;
}

/**
 * Which model an enemy wears, derived from its entity id.
 *
 * Round-robin over catalog order rather than a hash. The host and every client
 * instantiate views independently from the same static catalog, so deriving the
 * choice from the id makes it replicated by construction — nothing about model
 * assignment crosses the wire, and nothing has to. A random draw at spawn would
 * show two players different models for the same enemy.
 *
 * Round-robin also guarantees a mix at small populations, where a hash would
 * clump; with three variants and five enemies a hash can easily show one model.
 */
export function variantForEnemy<T>(assets: readonly T[], id: number): T | null {
  if (assets.length === 0) return null;
  return assets[Math.abs(Math.trunc(id)) % assets.length] ?? null;
}

/**
 * Which clip in a shipped file plays a given role, for one asset.
 *
 * The catalog's mapping wins, because a mapped clip that is
 * absent from the shipped file fails validation before it ships — so a declared name that is present is verified,
 * not guessed. `pickClip` is the fallback for a pack whose clips were never
 * mapped, or one that renamed them in a later release.
 */
export function clipNameFor(
  asset: EnemyAsset,
  available: readonly string[],
  kind: ClipKind,
): string | null {
  const declared = asset.clips[kind];
  if (declared !== undefined && available.includes(declared)) return declared;
  return pickClip([...available], kind);
}

export type EnemyInstance = {
  root: TransformNode;
  play(kind: ClipKind): void;
  dispose(): void;
};

/**
 * Wraps a loaded glTF root in a plain node that callers can position and rotate.
 *
 * The node Babylon's glTF loader hands back carries a `rotationQuaternion` of 180 degrees
 * about Y together with a mirrored Z scale, which is how it reconciles glTF's right-handed
 * space with Babylon's left-handed one. **While a rotationQuaternion is set, Babylon
 * ignores the Euler `rotation` property completely.** Assigning `root.rotation.y` on it
 * therefore does nothing at all — which is why enemies stared in one fixed direction while
 * chasing, with a sim yaw that was correct the whole time. Position kept working because it
 * is independent of the quaternion, so the bug looked like an AI problem rather than a
 * rendering one.
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
 * declare. Materials are shared by every instance of a variant, so once here
 * covers the pool.
 */
export function attachSkinToContainer(container: { materials: Material[] }): number {
  return attachSkinToMaterials(container.materials);
}

type LoadedVariant = {
  asset: EnemyAsset;
  container: AssetContainer;
  clipNames: string[];
};

export class EnemyModelPool {
  /** Catalog order. Indexed by `variantForEnemy`, so it must not be sorted. */
  private readonly assets = resolveEnemyAssets(catalog);
  private readonly loaded = new Map<string, LoadedVariant>();
  private readonly instances = new Map<number, EnemyInstance>();

  async load(scene: Scene): Promise<void> {
    if (this.assets.length === 0) return; // nothing shipped yet; capsules it is
    registerBuiltInLoaders();
    for (const asset of this.assets) {
      try {
        const container = await loadAssetContainerAsync(asset.url, scene);
        // Stop the source clips: only the instantiated copies should animate.
        for (const group of container.animationGroups) group.stop();
        attachSkinToContainer(container);
        this.loaded.set(asset.id, {
          asset,
          container,
          clipNames: container.animationGroups.map((g) => g.name),
        });
      } catch {
        // One bad asset costs its own variant and nothing else. An asset problem
        // degrades the visuals; it must never block the match.
      }
    }
  }

  acquire(id: number): EnemyInstance | null {
    const existing = this.instances.get(id);
    if (existing) return existing;

    const asset = variantForEnemy(this.assets, id);
    if (asset === null) return null;
    // Assignment is made against the catalog rather than against whatever
    // loaded, so every peer agrees on which enemy wears which model. The cost is
    // that a variant which failed to load yields a capsule here rather than a
    // silent substitution — which is the honest outcome: substituting would hide
    // a broken asset behind a working one.
    const variant = this.loaded.get(asset.id);
    if (variant === undefined) return null;

    // instantiateModelsToScene shares geometry and skeleton data across copies,
    // which is what makes 30 skinned enemies affordable.
    const entries = variant.container.instantiateModelsToScene(
      (name) => `enemy_${id}_${name}`,
      false,
    );
    const loadedRoot = entries.rootNodes[0];
    if (loadedRoot === undefined) return null;
    const root = orientationRoot(loadedRoot as TransformNode, `enemy_${id}_orientation`);

    const groups = new Map<string, AnimationGroup>();
    for (const group of entries.animationGroups) {
      group.stop();
      // Instantiated names get suffixed; match on the original clip name.
      const original = variant.clipNames.find((n) => group.name.includes(n)) ?? group.name;
      groups.set(original, group);
    }

    let current: AnimationGroup | null = null;
    const instance: EnemyInstance = {
      root,
      play: (kind) => {
        const name = clipNameFor(variant.asset, variant.clipNames, kind);
        const next = name === null ? null : (groups.get(name) ?? null);
        if (next === null || next === current) return;
        current?.stop();
        next.play(kind !== "death"); // death holds its final pose
        current = next;
      },
      dispose: () => {
        entries.dispose();
        root.dispose(); // the wrapper is ours, not the instantiation's
        this.instances.delete(id);
      },
    };

    this.instances.set(id, instance);
    return instance;
  }

  release(id: number): void {
    this.instances.get(id)?.dispose();
  }

  dispose(): void {
    for (const id of [...this.instances.keys()]) this.release(id);
    for (const variant of this.loaded.values()) variant.container.dispose();
    this.loaded.clear();
  }
}
