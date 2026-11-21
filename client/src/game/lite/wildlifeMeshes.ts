/**
 * The animals on Babylon Lite, drawn from the wildlife's frame
 * (`wildlifeScene.ts`, which says which animals there are, where each ground
 * member stands and which clip it plays, and every flying model's
 * instances).
 *
 * **A ground species is one skinned model, every member an instance**
 * (`skinnedModels.ts`): one draw a species in sight, whatever the herd.
 * A member that grazes on costs nothing a frame; one that walks
 * is its matrix; one whose clip changes, eight floats. A member nobody can
 * see keeps its clip where it stood, as the game's does. One drawn at no
 * size (the weather has emptied the ground, or it stands at its disc's
 * edge) is left out.
 *
 * **A flying model is one mesh, every bird an instance**, its wing beat
 * riding in its matrix (`wingPlugin.ts`): one draw a model in the air and
 * one buffer written a frame while a bird of it moves. The butterfly is
 * built in code, two quads, its pattern in its texture coordinate and its
 * colourway in its matrix.
 *
 * The materials are the files' own, lit as every surface is and under the
 * air; the game wets none of them.
 *
 * **The species share their places among the draws, and so do the flying
 * models** (`ANIMAL_PLACES`): a primitive stands at the place of its order
 * in its model, whichever the animal. Lite draws the meshes of one place
 * grouped by pipeline, and the species are models of one make, as the birds
 * are: at a place each, their draws alternated between the pipelines they
 * share. An animal's own primitives keep their order; no two animals lie
 * at one depth, so the order among them decides no pixel.
 */
import {
  acquireTexture, addToScene, createMeshFromData, createPbrMaterial, disposeMeshGpu, releaseTexture, removeFromScene, setMeshVisible,
  setThinInstanceCount, setThinInstances,
  type EngineContext, type MaterialPlugin, type Mesh, type PbrMaterialProps, type PluginUniformBlock, type SceneContext, type Texture2D,
} from "@babylonjs/lite";
import catalog from "../../../assets/catalog.json" with { type: "json" };
import { modelUrl } from "../assetUrls.js";
import { creatureRoleGroups, resolveCreatureAssets, type CreatureAsset } from "../creatureAssets.js";
import { stepClip, type ClipClock } from "../entityPoses.js";
import { expectModels } from "../loadReport.js";
import type { FirstBuilds } from "@csarkosh/engine/game/firstBuilds";
import { composeInto, type Quat } from "@csarkosh/engine/game/instancePose";
import { writeClipParams, type BakedClip } from "@csarkosh/engine/game/skinInstances";
import type { ClipRole, PlayerPoint, WildlifeEvent } from "@csarkosh/engine/game/wildlifeBehaviour";
import type { MatchState, View } from "@csarkosh/engine/game/wildlifeDirector";
import { FIRST_BIRD_SPECIES, SPECIES_BUTTERFLY, SPECIES_COUNT } from "@csarkosh/engine/game/wildlifeField";
import {
  BIRD_ASSET, BIRD_PERCHED_ASSET, BUTTERFLY_COLOURWAYS, SPECIES_ASSET, birdBucketOmega, butterflyGeometry, createWildlifeScene,
  type BirdBucket, type ViewPlane, type WildlifeScene,
} from "@csarkosh/engine/game/wildlifeScene";
import type { WeatherParams } from "@csarkosh/engine/game/weather";
import { DRAW_ORDER, createDrawOrders } from "@csarkosh/engine/game/lite/drawOrder";
import { loadModel } from "./forestModels.js";
import { oneSidedLightPlugin } from "./forestPlugins.js";
import type { FrameUploads } from "@csarkosh/engine/game/lite/frameUploads";
import { MATRIX_BYTES } from "./listMeshes.js";
import { loadSkinnedModel, type SkinClock, type SkinnedModel } from "./skinnedModels.js";
import { WING_AMP_AT, WING_COLOURWAY_AT, WING_PHASE_AT, wingPlugin } from "./wingPlugin.js";

/** The most members of one ground species drawn at once. */
export const SPECIES_CAPACITY = 64;
/** The node a flying model's drawn level of detail hangs under. */
const BIRD_LOD = "LOD0";

export type LiteWildlifeMeshes = {
  update(
    camX: number, camZ: number, tick: number, players: readonly PlayerPoint[], weather: WeatherParams, hour: number,
    director: { view: View; match: MatchState } | undefined, dt: number,
  ): void;
  /** Calls, lifts and flee starts, appended as they happen: whoever voices them drains the list. */
  readonly events: WildlifeEvent[];
  directorLog(): readonly number[];
  /** What is drawn now: ground members and birds, and the draws each take. */
  drawn(): { ground: number; groundDraws: number; birds: number; birdDraws: number };
  /** Models still on the way. */
  waiting(): number;
  dispose(): void;
};

export type LiteWildlifeOptions = {
  /** The species' discs scaled, as the tier asks. */
  radiusScale?: number;
  firstBuilds?: FirstBuilds;
  /** The air's plugin, one a material. */
  air: () => MaterialPlugin;
  /** The frame's block (`frameBlock.ts`): the wings' clock is in it. */
  shared: PluginUniformBlock;
  /** The clock every skinned model's clips are read by. */
  clock: SkinClock;
  /** The view's planes, last frame's: an animal outside them animates nothing. */
  planes: () => readonly ViewPlane[] | undefined;
  uploads?: FrameUploads;
};

/** The animals' places among the draws, from the shell's first: a ground species' primitives, a place each by their order in the model, then a flying model's. */
export const ANIMAL_PLACES = { ground: 0, flying: 512 } as const;

type Species = { asset: CreatureAsset; model: SkinnedModel | null; roles: Map<ClipRole, BakedClip | null> | null; count: number; moved: boolean; reclipped: boolean };
type Flock = { bucket: BirdBucket; meshes: Mesh[]; matrices: Float32Array; count: number };

export function createLiteWildlifeMeshes(engine: EngineContext, scene: SceneContext, seed: number, options: LiteWildlifeOptions): LiteWildlifeMeshes {
  const loads = new AbortController();
  const orders = createDrawOrders(DRAW_ORDER.animals);
  const species = new Map<string, Species>();
  /** Each ground member's clip, by its key: the role playing, its time, and whether it loops. */
  const clocks = new Map<number, ClipClock & { playing: BakedClip | null; loop: boolean }>();
  const flocks: Flock[] = [];
  const held = new Set<Texture2D>();
  const made: Mesh[] = [];
  let disposed = false;
  let waiting = 0;
  let clockFolds = options.clock.folds;
  const counts = { ground: 0, groundDraws: 0, birds: 0, birdDraws: 0 };
  const scratch = new Float32Array(16);
  const turn: Quat = { x: 0, y: 0, z: 0, w: 1 };

  const wildlife: WildlifeScene = createWildlifeScene(
    seed,
    {
      // A member holds a body from the frame its species' model has landed.
      slot: (_key, assetId) => (species.get(assetId)?.model ?? null) !== null,
      release: (key) => void clocks.delete(key),
      planes: options.planes,
    },
    { radiusScale: options.radiusScale, firstBuilds: options.firstBuilds },
  );

  // The ground species: every creature the catalog ships, each landing on its own.
  for (const asset of resolveCreatureAssets(catalog)) {
    const entry: Species = { asset, model: null, roles: null, count: 0, moved: false, reclipped: false };
    species.set(asset.id, entry);
    waiting++;
    void loadSkinnedModel(engine, scene, asset.url, {
      capacity: SPECIES_CAPACITY,
      clock: options.clock,
      signal: loads.signal,
      dress(part, n) {
        part.material.usePhysicalLightFalloff = true;
        part.material.plugins = [options.air()];
        orders.put(part.material, ANIMAL_PLACES.ground + n);
        part.mesh.renderOrder = orders.of(part.material);
        return true;
      },
      uploads: options.uploads,
    }).then(
      (model) => {
        waiting--;
        if (disposed) {
          model.dispose();
          return;
        }
        entry.model = model;
        entry.roles = creatureRoleGroups(asset, [...model.clips.keys()], model.clips);
      },
      (error: unknown) => {
        waiting--;
        if (!disposed && !loads.signal.aborted) console.error(`the model ${asset.id} could not be made; its animals are not drawn`, error);
      },
    );
  }

  /** A flying model's meshes as a flock: hidden and holding no instance until a frame fills it. */
  function adopt(assetId: string, meshes: Mesh[]): void {
    for (const mesh of meshes) {
      setThinInstances(mesh, new Float32Array(16), 1);
      setThinInstanceCount(mesh, 0);
      setMeshVisible(mesh, false);
      addToScene(scene, mesh);
      made.push(mesh);
      options.uploads?.made();
    }
    flocks.push({ bucket: wildlife.adoptBird(assetId), meshes, matrices: new Float32Array(0), count: 0 });
  }

  /** The catalog `output` for an asset id, or null where the catalog has no such entry. */
  function outputFor(assetId: string): string | null {
    const entries = (catalog as { assets?: { id?: unknown; output?: unknown }[] }).assets ?? [];
    const found = entries.find((entry) => entry.id === assetId);
    return found !== undefined && typeof found.output === "string" ? found.output : null;
  }

  async function loadBirds(): Promise<void> {
    const wanted = new Set<string>([BIRD_PERCHED_ASSET]);
    for (let s = FIRST_BIRD_SPECIES; s < SPECIES_COUNT; s++) {
      const id = BIRD_ASSET[s];
      if (id !== null && id !== undefined) wanted.add(id);
    }
    // The birds are fetched one after another: the loading bar is told of them all before the first.
    const fetched: string[] = [];
    for (const assetId of wanted) {
      const output = assetId === BIRD_ASSET[SPECIES_BUTTERFLY] ? null : outputFor(assetId);
      if (output === null) continue;
      try {
        fetched.push(modelUrl(output));
      } catch {
        // A model the build does not ship: its own load says so below.
      }
    }
    expectModels(fetched);
    for (const assetId of wanted) {
      if (disposed) return;
      if (assetId === BIRD_ASSET[SPECIES_BUTTERFLY]) {
        // Two quads built in code: the pattern is each vertex's shade, carried in its first texture coordinate.
        const shape = butterflyGeometry();
        const uvs = new Float32Array((shape.positions.length / 3) * 2);
        for (let i = 0; i < uvs.length / 2; i++) uvs[i * 2] = shape.colors[i * 4] as number;
        const mesh = createMeshFromData(engine, "wildlife_butterfly", shape.positions, shape.normals, new Uint32Array(shape.indices), uvs);
        // White under the pattern and the colourway, matt, seen from both sides and lit as the side it was built facing.
        const material = createPbrMaterial({ baseColorFactor: [1, 1, 1, 1], metallicFactor: 0, roughnessFactor: 1, doubleSided: true, usePhysicalLightFalloff: true });
        material.plugins = [oneSidedLightPlugin(), wingPlugin(halfSpanOf(shape.positions), birdBucketOmega(assetId), options.shared, BUTTERFLY_COLOURWAYS), options.air()];
        orders.put(material, ANIMAL_PLACES.flying);
        mesh.material = material;
        mesh.renderOrder = orders.of(material);
        adopt(assetId, [mesh]);
        continue;
      }
      const output = outputFor(assetId);
      if (output === null) continue;
      waiting++;
      try {
        const model = await loadModel(engine, modelUrl(output), [BIRD_LOD], loads.signal);
        waiting--;
        if (disposed) return;
        const parts = model.get(BIRD_LOD) ?? [];
        if (parts.length === 0) continue;
        // The half span is measured across the whole bird: one bird, one wingspan.
        let minX = Infinity;
        let maxX = -Infinity;
        for (const part of parts) {
          minX = Math.min(minX, part.min.x);
          maxX = Math.max(maxX, part.max.x);
        }
        const meshes = parts.map((part, n) => {
          const mesh = createMeshFromData(engine, `${assetId}_${n}`, part.positions, part.normals, part.indices, part.uvs, undefined, part.tangents ?? undefined);
          const material: PbrMaterialProps = part.material;
          for (const texture of [material.baseColorTexture, material.normalTexture, material.ormTexture, material.emissiveTexture, material.occlusionTexture]) {
            if (texture === undefined || held.has(texture)) continue;
            held.add(texture);
            acquireTexture(texture);
          }
          material.usePhysicalLightFalloff = true;
          material.plugins = [wingPlugin(0.5 * (maxX - minX), birdBucketOmega(assetId), options.shared), options.air()];
          orders.put(material, ANIMAL_PLACES.flying + n);
          mesh.material = material;
          mesh.renderOrder = orders.of(material);
          return mesh;
        });
        adopt(assetId, meshes);
      } catch (error) {
        waiting--;
        if (loads.signal.aborted) return;
        // One bad asset costs its own bird and nothing else.
        console.error(`the model ${assetId} could not be made; its birds are not drawn`, error);
      }
    }
  }
  void loadBirds();

  /** Half the width of a shape, from its positions. */
  function halfSpanOf(positions: Float32Array): number {
    let minX = Infinity;
    let maxX = -Infinity;
    for (let i = 0; i < positions.length; i += 3) {
      minX = Math.min(minX, positions[i] as number);
      maxX = Math.max(maxX, positions[i] as number);
    }
    return 0.5 * (maxX - minX);
  }

  /** The colourway a butterfly's tint is, by its place in the game's list. */
  function colourwayOf(tint: Float32Array, at: number): number {
    for (let c = 0; c < BUTTERFLY_COLOURWAYS.length; c++) {
      const way = BUTTERFLY_COLOURWAYS[c] as readonly [number, number, number];
      if (tint[at] === Math.fround(way[0]) && tint[at + 1] === Math.fround(way[1]) && tint[at + 2] === Math.fround(way[2])) return c;
    }
    return 0;
  }

  /** A flock's instances from its bucket: each matrix with the bird's wing and colourway in its last row. Sent where any has changed. */
  function showFlock(flock: Flock): void {
    const { bucket } = flock;
    const count = bucket.count;
    if (flock.matrices.length < bucket.matrices.length) {
      flock.matrices = new Float32Array(bucket.matrices.length);
      for (const mesh of flock.meshes) setThinInstances(mesh, flock.matrices, flock.matrices.length / 16);
      flock.count = -1;
    }
    let moved = count !== flock.count;
    const own = flock.matrices;
    for (let i = 0; i < count; i++) {
      const at = i * 16;
      for (let k = 0; k < 16; k++) {
        let value = bucket.matrices[at + k] as number;
        if (k === WING_PHASE_AT) value = Math.fround(bucket.wing[i * 2] as number);
        else if (k === WING_AMP_AT) value = Math.fround(bucket.wing[i * 2 + 1] as number);
        else if (k === WING_COLOURWAY_AT) value = bucket.tint === null ? 0 : colourwayOf(bucket.tint, i * 4);
        if (own[at + k] !== value) {
          own[at + k] = value;
          moved = true;
        }
      }
    }
    if (moved) {
      for (const mesh of flock.meshes) {
        setThinInstanceCount(mesh, count);
        if (count > 0) options.uploads?.count("instances", count * MATRIX_BYTES);
        if ((count > 0) !== (flock.count > 0)) setMeshVisible(mesh, count > 0);
      }
      flock.count = count;
    }
  }

  return {
    events: wildlife.events,
    update(camX, camZ, tick, players, weather, hour, director, dt) {
      if (disposed) return;
      wildlife.update(camX, camZ, tick, players, weather, hour, director);
      const refold = options.clock.folds !== clockFolds;
      clockFolds = options.clock.folds;
      for (const entry of species.values()) {
        entry.count = 0;
        entry.moved = false;
        entry.reclipped = false;
      }
      counts.ground = 0;
      for (const g of wildlife.ground) {
        const assetId = SPECIES_ASSET[g.species];
        const entry = assetId === null || assetId === undefined ? undefined : species.get(assetId);
        if (entry === undefined || entry.model === null || entry.roles === null) continue;
        // The member's clip, as the game's pooled body plays it: a role with no clip leaves the one playing, a new
        // clip starts from its beginning, the alert holds its end, and a member nobody can see keeps its frame.
        let clock = clocks.get(g.key);
        if (clock === undefined) {
          clock = { clip: "", seconds: 0, rate: 1, playing: null, loop: true };
          clocks.set(g.key, clock);
        }
        const next = entry.roles.get(g.clip) ?? null;
        if (next !== null && next !== clock.playing) {
          clock.playing = next;
          clock.loop = g.clip !== "alert";
          clock.clip = "";
        }
        stepClip(clock, "playing", 1, g.animate ? dt : 0);
        if (g.scale <= 0 || entry.count >= entry.model.capacity) continue;
        const index = entry.count++;
        turn.x = g.qx;
        turn.y = g.qy;
        turn.z = g.qz;
        turn.w = g.qw;
        composeInto(scratch, 0, g.scale, g.scale, g.scale, turn, g.x, g.y, g.z);
        const at = index * 16;
        const matrices = entry.model.matrices;
        for (let k = 0; k < 16; k++) {
          if (matrices[at + k] !== scratch[k]) {
            matrices[at + k] = scratch[k] as number;
            entry.moved = true;
          }
        }
        if (clock.playing !== null) {
          if (refold) entry.model.clipParams[index * 8] = -1;
          if (writeClipParams(entry.model.clipParams, index, clock.playing, clock.seconds, g.animate ? 1 : 0, options.clock.seconds, clock.loop)) entry.reclipped = true;
        }
        counts.ground++;
      }
      counts.groundDraws = 0;
      for (const entry of species.values()) {
        if (entry.model === null) continue;
        entry.model.show(entry.count, entry.moved, entry.reclipped);
        if (entry.count > 0) counts.groundDraws += entry.model.parts.length;
      }
      counts.birds = 0;
      counts.birdDraws = 0;
      for (const flock of flocks) {
        showFlock(flock);
        counts.birds += Math.max(0, flock.count);
        if (flock.count > 0) counts.birdDraws += flock.meshes.length;
      }
      // The shared clock is sent on a frame that shows a skinned animal.
      if (counts.ground > 0) options.clock.send(options.uploads);
    },
    directorLog: () => wildlife.directorLog(),
    drawn: () => ({ ...counts }),
    waiting: () => waiting,
    dispose() {
      if (disposed) return;
      disposed = true;
      loads.abort();
      wildlife.dispose();
      for (const entry of species.values()) entry.model?.dispose();
      species.clear();
      for (const mesh of made) {
        removeFromScene(scene, mesh);
        disposeMeshGpu(mesh);
        options.uploads?.dropped();
      }
      made.length = 0;
      flocks.length = 0;
      for (const texture of held) releaseTexture(texture);
      held.clear();
      clocks.clear();
    },
  };
}
