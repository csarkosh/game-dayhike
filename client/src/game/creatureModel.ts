/**
 * The `creature` asset kind at runtime: the
 * character pool (`createCharacterPool`) generalised to wildlife roles. One cloned container
 * per visible animal with its own clip playback; the pool is keyed by the
 * caller's integer (unit id × 16 + member), and a species whose asset is not
 * in the catalog simply has no animals — there is no capsule fallback for
 * wildlife, because an ambient elk that renders as a capsule is worse
 * than no elk.
 */
import type { AssetContainer } from "@babylonjs/core/assetContainer.js";
import type { AnimationGroup } from "@babylonjs/core/Animations/animationGroup.js";
import type { Scene } from "@babylonjs/core/scene.js";
import type { TransformNode } from "@babylonjs/core/Meshes/transformNode.js";
import { registerBuiltInLoaders } from "@babylonjs/loaders/dynamic.js";
import catalog from "../../assets/catalog.json" with { type: "json" };
import { creatureGroupsByName, creatureRoleGroups, resolveCreatureAssets, type CreatureAsset } from "./creatureAssets.js";
import { loadContainer, loadUntilAborted } from "./modelLoad.js";
import { orientationRoot } from "./characterModel.js";
import type { ClipRole } from "./wildlifeBehaviour.js";

export type { ClipRole } from "./wildlifeBehaviour.js";
export { creatureClipFor, creatureGroupsByName, creatureRoleGroups, resolveCreatureAssets, type CreatureAsset } from "./creatureAssets.js";

export type CreatureInstance = {
  root: TransformNode;
  play(role: ClipRole): void;
  /** The current clip run (`true`) or held where it stands: an animal nobody sees animates nothing. */
  animate?(on: boolean): void;
  dispose(): void;
};

/** What `animateGroup` reads and moves of an animation group (Babylon's returns itself from each; a fake need not). */
export type AnimatedGroup = { readonly isStarted: boolean; readonly isPlaying: boolean; pause(): unknown; restart(): unknown };

/**
 * The group run (`on`) or held where it stands: paused, it keeps its frame
 * and costs the scene's animation step nothing, and `restart` picks it up
 * from that frame, so an animal coming back into view carries on mid-stride
 * rather than from the clip's start. A group never started, or none, is left
 * alone: `play` starts it. Babylon steps every started group every frame, on
 * or off the screen; the meadow's herd was 3.5 ms a frame of that on the rig
 * (2026-10-22).
 */
export function animateGroup(group: AnimatedGroup | null, on: boolean): void {
  if (group === null || !group.isStarted) return;
  if (on) {
    if (!group.isPlaying) group.restart();
  } else if (group.isPlaying) group.pause();
}
export type CreaturePool = {
  load(scene: Scene): Promise<void>;
  has(assetId: string): boolean;
  acquire(key: number, assetId: string): CreatureInstance | null;
  release(key: number): void;
  dispose(): void;
};

type Loaded = { asset: CreatureAsset; container: AssetContainer; clipNames: string[] };

/**
 * One cloned instance per visible animal, keyed by the caller's integer key
 * (unit id × 16 + member — see wildlifeField.ts). Mirrors `createCharacterPool`:
 * `instantiateModelsToScene` shares geometry and skeleton data across copies,
 * `orientationRoot` wraps the loader's converted root so callers can drive yaw
 * without fighting its `rotationQuaternion`, and a variant that fails to load
 * simply has no instances rather than substituting a placeholder.
 */
export function createCreaturePool(): CreaturePool {
  const assets = resolveCreatureAssets(catalog);
  const loaded = new Map<string, Loaded>();
  const instances = new Map<number, CreatureInstance>();
  /** Aborted first thing in `dispose`: the species in flight then ends at once
   * and quietly, and the rest of the list is never fetched (`modelLoad.ts`). */
  const loads = new AbortController();
  return {
    async load(scene) {
      if (assets.length === 0) return; // no creature assets shipped yet; no animals
      registerBuiltInLoaders();
      for (const asset of assets) {
        try {
          const container = await loadUntilAborted(() => loadContainer(asset.url, scene), loads.signal);
          // Disposed between the load settling and this line: nothing will
          // ever instantiate it.
          if (loads.signal.aborted) {
            container.dispose();
            return;
          }
          // Stop the source clips: only the instantiated copies should animate.
          for (const g of container.animationGroups) g.stop();
          loaded.set(asset.id, { asset, container, clipNames: container.animationGroups.map((g) => g.name) });
        } catch {
          // Disposed mid-load: nothing failed, and the rest is not wanted.
          if (loads.signal.aborted) return;
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
          // characterModel.ts's `next.play(kind !== "death")` holding death's final
          // frame instead of looping it.
          next.play(role !== "alert");
          current = next;
        },
        animate(on) {
          animateGroup(current, on);
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
      loads.abort();
      for (const k of [...instances.keys()]) instances.get(k)?.dispose();
      for (const v of loaded.values()) v.container.dispose();
      loaded.clear();
    },
  };
}
