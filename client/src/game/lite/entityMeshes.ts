/**
 * The hikers' bodies and the Hollows' eyes on Babylon Lite, drawn from a
 * frame's poses (`entityPoses.ts`, which works out where each stands, the
 * clip it plays and how far in from the mist a Hollow is).
 *
 * **A ranger is one skinned model, every hiker who wears it an instance**
 * (`skinnedModels.ts`): two draws a ranger worn, whatever the hikers, and
 * nothing written a frame while they stand or walk on at a steady pace but
 * the clock all skinned things share. A hiker who moves is a matrix written
 * for each of the model's two primitives; one whose pace changes, eight
 * floats. A ranger is
 * fetched when a hiker who wears it is first to be drawn, so a hike alone
 * fetches none.
 *
 * **A body is not drawn while its model is on the way.** The capsule is for
 * the model that never came: one draw for every such hiker, in the game's
 * blue. On Babylon.js a capsule also stands in while a model loads, which
 * there is the start of the hike; here it would be a blue shape for the
 * moment after each hiker joins.
 *
 * **Of a Hollow the frame shows its eyes, at their level.** The figure
 * itself is a shadow in the silhouette mask, which the grade or the veil
 * lays over the frame (`shadeSilhouette.ts`), and no part of this file:
 * what is drawn here is the model's glowing primitive alone, one draw for
 * every Hollow and shade whose eyes have come, blended over the frame.
 * A pair's level (`eyeLevelOf`: the real one's glow dulled, a shade's near
 * nothing, both rising with the figure as it comes in and going first as
 * it goes) is the alpha of its instance's colour, and the blend goes by
 * that alpha alone (`eyeLevelPlugin`): at a level of 0.1375 a pixel is
 * that share of the glowing surface over the rest of what stands behind
 * it. Sixteen bytes a pair are written on a frame in which a level has
 * changed or a pair has joined, and while no level is above nothing there
 * is no draw and no write. The game sets the same level on Babylon.js, as
 * the eye meshes' visibility, and there it does not show: Babylon.js
 * blends a mesh by its visibility only under a material with no
 * transparency mode of its own, which a loaded model's material has, so
 * that renderer draws the eyes whole.
 *
 * A blended draw is tested against the frame's depth and writes none: a
 * trunk in front of the eyes hides them. Lite orders its blended draws by
 * how far each mesh's origin is and only then by their places, so the eyes'
 * mesh is stood at the world's origin, where every see-through mesh stands
 * (`standAtOrigin`), and takes the first place among them
 * (`SEE_THROUGH_ORDER.eyes`): the motes, the mist banks and the rain are
 * laid over the eyes, from every view. The model is fetched with the hike,
 * since a Hollow steps out of the mist without warning.
 *
 * The materials are the files' own under the game's stack: the base
 * colour's block, the wet look at no porosity (a body takes the water's
 * line, not the rain), and the air.
 *
 * **The rangers share their places among the draws** (`BODY_PLACES`): a
 * primitive stands at the place of its order in its model, whichever the
 * ranger, and the capsule after them. Lite draws the meshes of one place
 * grouped by pipeline, and the rangers are five models of one make: at a
 * place a ranger's primitive, their draws alternated between the pipelines
 * their primitives share, and a crowd set a pipeline for nearly every
 * draw. A ranger's own primitives keep their order, which decides the
 * pixels where two of them lie at one depth; no two rangers lie at one
 * depth, so the order among them decides none.
 */
import {
  addToScene, createCapsule, createPbrMaterial, disposeMeshGpu, removeFromScene, setMeshVisible, setPbrEmissive, setThinInstanceColors, setThinInstanceCount,
  setThinInstances,
  type EngineContext, type MaterialPlugin, type Mesh, type PbrMaterialProps, type PluginUniformBlock, type SceneContext, type SceneNode,
} from "@babylonjs/lite";
import catalog from "../../../assets/catalog.json" with { type: "json" };
import { PLAYER_HALF } from "../../sim/constants.js";
import { clipNameFor, resolveCharacterAssets, type CharacterAsset, type ClipKind } from "../characterAssets.js";
import { HOLLOW_MODEL, stepClip, type ClipClock, type EntityFrame, type EntityModels } from "../entityPoses.js";
import { HOLLOW_EYE_COLOR, HOLLOW_EYE_INTENSITY, HOLLOW_SCALE } from "../hollowLook.js";
import { writeBodyMatrix, writeClipParams, type BakedClip } from "../skinInstances.js";
import type { WetUniforms } from "../wetSurface.js";
import { DRAW_ORDER, SEE_THROUGH_ORDER, createDrawOrders } from "./drawOrder.js";
import { baseColourPlugin, surfaceWetPlugin } from "./forestPlugins.js";
import type { FrameUploads } from "./frameUploads.js";
import { MATRIX_BYTES } from "./listMeshes.js";
import { loadSkinnedModel, type SkinClock, type SkinnedModel, type SkinnedPart } from "./skinnedModels.js";

/** The bodies' places among the draws, from the shell's first: a ranger's primitives, a place each by their order in the model, then the capsule. */
export const BODY_PLACES = { rangers: 0, capsule: 4 } as const;

/** The most hikers of one ranger drawn at once: every player may wear the same one. */
export const RANGER_CAPACITY = 8;
/** The most Hollows and shades whose eyes are drawn at once. */
export const HOLLOW_CAPACITY = 16;
/** The capsule's colour and roughness: the game's `mat_player`. */
export const CAPSULE_COLOUR: readonly [number, number, number] = [0.3, 0.7, 0.95];
export const CAPSULE_ROUGHNESS = 0.85;
/** Bytes of an instance's colour, four floats: a pair of eyes' level is the last. */
export const EYE_LEVEL_BYTES = 16;

/**
 * The eyes' alpha is their level and nothing more. To a blended surface's
 * alpha Lite adds the square of what the surface reflects, so that a glint
 * is not seen through; on eyes at a level of a tenth, a lamp held on them
 * would show its glint as a point of nearly their whole glow. Babylon.js
 * multiplies a mesh's visibility in after that sum, so there the level is
 * the alpha. The fragment is returned here, at the last point before Lite's
 * sum, with the alpha as the instance's colour left it.
 */
export function eyeLevelPlugin(): MaterialPlugin {
  return {
    name: "EyeLevel",
    priority: 995,
    getCustomCode: (stage) => (stage === "fragment" ? { CUSTOM_FRAGMENT_BEFORE_FRAGCOLOR: "return vec4<f32>(color,alpha*material.materialAlpha);" } : null),
  };
}

/**
 * Stands `mesh` at the world's origin and hands back where it stood. A
 * model's root lifts its mesh; Lite draws a body as its instance's matrix
 * times the mesh's, so the lift is the same picture carried by each
 * instance (`liftBody`), and a blended mesh at the origin is ordered among
 * the see-through draws by its place alone (`drawOrder.ts`).
 */
function standAtOrigin(mesh: Mesh): [number, number, number] {
  const world = mesh.worldMatrix;
  const stood: [number, number, number] = [world[12] as number, world[13] as number, world[14] as number];
  for (let node: Partial<SceneNode> | null = mesh; node !== null && node !== undefined; node = node.parent as Partial<SceneNode> | null) node.position?.set(0, 0, 0);
  return stood;
}

/** Moves the body whose matrix is `matrix` by `lift` in its own frame: the matrix times a move by `lift`. */
export function liftBody(matrix: Float32Array, lift: readonly [number, number, number]): void {
  for (let row = 0; row < 3; row++) {
    matrix[12 + row] = (matrix[12 + row] as number) + (matrix[row] as number) * lift[0] + (matrix[4 + row] as number) * lift[1] + (matrix[8 + row] as number) * lift[2];
  }
}

/** Sets pair `index`'s level in `colours`, four floats a pair of which the level is the last; true where it changed. */
export function setEyeLevel(colours: Float32Array, index: number, level: number): boolean {
  const sent = Math.fround(level);
  if (colours[index * 4 + 3] === sent) return false;
  colours[index * 4 + 3] = sent;
  return true;
}

/** A lamp a hiker other than the local one wears, as the frame lights it. */
export type WornLamp = { x: number; y: number; z: number; dx: number; dy: number; dz: number; on: boolean };

export type EntityMeshes = {
  /** Which bodies are drawn as their models: a ranger is asked for on the first question about it. */
  readonly models: EntityModels;
  /** Draws a frame's poses; `dt` runs the clips on. */
  update(frame: EntityFrame, dt: number): void;
  /** The lamps the other hikers wear this frame, in the players' order: one reused list. */
  lamps(): readonly WornLamp[];
  /** Models still on the way. */
  waiting(): number;
  /** What is drawn now: the bodies as models and as capsules, the pairs of eyes, and the draws they take. */
  drawn(): { bodies: number; capsules: number; eyes: number; draws: number };
  /** Resolved once the Hollow's model has landed, or could not. */
  readonly ready: Promise<void>;
  dispose(): void;
};

export type EntityMeshOptions = {
  /** The wet look's uniforms at no porosity (`wetUniforms`): filled in place each frame. */
  wet: WetUniforms;
  /** The air's plugin, one a material. */
  air: () => MaterialPlugin;
  /** The frame's block (`frameBlock.ts`). */
  shared: PluginUniformBlock;
  /** The clock every skinned model's clips are read by. */
  clock: SkinClock;
  /** Whether the Hollow's model is fetched at once: a world a Hollow hunts in. */
  hollows: boolean;
  uploads?: FrameUploads;
};

const CLIP_KINDS: readonly ClipKind[] = ["idle", "walk", "attack", "death"];

type Loaded = {
  state: "loading" | "landed" | "failed";
  model: SkinnedModel | null;
  asset: CharacterAsset;
  clips: Map<string, BakedClip | null>;
  /** Where the model's meshes stood before they were stood at the world's origin, which each body's matrix carries; null for a model left where its file has it. */
  lift: [number, number, number] | null;
  /** Resolved once the model has landed, or could not. */
  settled: Promise<void>;
};

export function createEntityMeshes(engine: EngineContext, scene: SceneContext, options: EntityMeshOptions): EntityMeshes {
  const assets = new Map(resolveCharacterAssets(catalog).map((asset) => [asset.id, asset]));
  const loaded = new Map<string, Loaded>();
  const loads = new AbortController();
  const orders = createDrawOrders(DRAW_ORDER.bodies);
  /** Each hiker's and each Hollow's clip, by its id: players and enemies never share one. */
  const clocks = new Map<number, ClipClock>();
  const seen = new Set<number>();
  const lamps: WornLamp[] = [];
  let lampCount = 0;
  let disposed = false;
  let waiting = 0;
  let clockFolds = options.clock.folds;
  const counts = { bodies: 0, capsules: 0, eyes: 0, draws: 0 };

  // The eyes: the meshes that draw them, each pair's colour (white, its alpha the pair's level), and the pairs whose colours the GPU holds.
  const eyeMeshes: Mesh[] = [];
  const eyeColours = new Float32Array(HOLLOW_CAPACITY * 4).fill(1);
  let eyesSent = 0;
  let relevelled = false;

  // The capsule, for a hiker whose ranger never came: made with its first.
  let capsule: { mesh: Mesh; matrices: Float32Array; count: number } | null = null;

  function dress(id: string, part: SkinnedPart, index: number): boolean {
    const material = part.material;
    material.usePhysicalLightFalloff = true;
    if (id === HOLLOW_MODEL) {
      // The eyes are the material that glows in the file; the rest of the figure is the mask's.
      if (!part.emissive.some((channel) => channel > 0)) return false;
      setPbrEmissive(material, [HOLLOW_EYE_COLOR.r * HOLLOW_EYE_INTENSITY, HOLLOW_EYE_COLOR.g * HOLLOW_EYE_INTENSITY, HOLLOW_EYE_COLOR.b * HOLLOW_EYE_INTENSITY]);
      material.plugins = [baseColourPlugin(), surfaceWetPlugin(options.wet, options.shared), options.air(), eyeLevelPlugin()];
      // Blended over the frame, each pair by the alpha of its instance's colour. The colours are given before the
      // mesh joins the scene, where Lite reads whether it has any; the instances the model then gives it keep them.
      material.alphaBlend = true;
      setThinInstances(part.mesh, new Float32Array(0), 0);
      setThinInstanceColors(part.mesh, eyeColours);
      part.mesh.renderOrder = SEE_THROUGH_ORDER.eyes;
      eyeMeshes.push(part.mesh);
      return true;
    }
    material.plugins = [baseColourPlugin(), surfaceWetPlugin(options.wet, options.shared), options.air()];
    orders.put(material, BODY_PLACES.rangers + index);
    part.mesh.renderOrder = orders.of(material);
    return true;
  }

  function ask(id: string): Loaded | null {
    const entry = loaded.get(id);
    if (entry !== undefined) return entry;
    const asset = assets.get(id);
    if (asset === undefined) return null;
    const mine: Loaded = { state: "loading", model: null, asset, clips: new Map(), lift: null, settled: Promise.resolve() };
    loaded.set(id, mine);
    waiting++;
    mine.settled = loadSkinnedModel(engine, scene, asset.url, {
      capacity: id === HOLLOW_MODEL ? HOLLOW_CAPACITY : RANGER_CAPACITY,
      clock: options.clock,
      signal: loads.signal,
      dress: (part, index) => dress(id, part, index),
      uploads: options.uploads,
    }).then(
      (model) => {
        waiting--;
        if (disposed) {
          model.dispose();
          return;
        }
        mine.model = model;
        mine.state = "landed";
        // The model's glowing primitives hang from one root: where the first stood is where each did.
        if (id === HOLLOW_MODEL) {
          for (const mesh of eyeMeshes) {
            const stood = standAtOrigin(mesh);
            mine.lift ??= stood;
          }
        }
      },
      (error: unknown) => {
        waiting--;
        mine.state = "failed";
        if (!disposed) console.error(`the model ${id} could not be made; ${id === HOLLOW_MODEL ? "the Hollows' eyes are not drawn" : "its hikers are drawn as capsules"}`, error);
      },
    );
    return mine;
  }

  /** The clip of `entry`'s model that plays `kind`, or null where the file has none. */
  function clipOf(entry: Loaded, kind: ClipKind): BakedClip | null {
    let clip = entry.clips.get(kind);
    if (clip === undefined) {
      const model = entry.model as SkinnedModel;
      const name = clipNameFor(entry.asset, [...model.clips.keys()], kind);
      clip = name === null ? null : (model.clips.get(name) ?? null);
      entry.clips.set(kind, clip);
    }
    return clip;
  }

  function clockOf(id: number): ClipClock {
    let clock = clocks.get(id);
    if (clock === undefined) {
      clock = { clip: "", seconds: 0, rate: 1 };
      clocks.set(id, clock);
    }
    seen.add(id);
    return clock;
  }

  function lampAt(n: number): WornLamp {
    let lamp = lamps[n];
    if (lamp === undefined) {
      lamp = { x: 0, y: 0, z: 0, dx: 0, dy: 0, dz: 1, on: false };
      lamps[n] = lamp;
    }
    return lamp;
  }

  function showCapsules(matrices: Float32Array, count: number): void {
    if (capsule === null) {
      if (count === 0) return;
      const mesh = createCapsule(engine, { height: PLAYER_HALF.y * 2, radius: PLAYER_HALF.x });
      const material: PbrMaterialProps = createPbrMaterial({
        baseColorFactor: [CAPSULE_COLOUR[0], CAPSULE_COLOUR[1], CAPSULE_COLOUR[2], 1], metallicFactor: 0, roughnessFactor: CAPSULE_ROUGHNESS, usePhysicalLightFalloff: true,
      });
      material.plugins = [options.air()];
      orders.put(material, BODY_PLACES.capsule);
      mesh.material = material;
      mesh.renderOrder = orders.of(material);
      const own = new Float32Array(RANGER_CAPACITY * 16);
      setThinInstances(mesh, own, RANGER_CAPACITY);
      setThinInstanceCount(mesh, 0);
      setMeshVisible(mesh, false);
      addToScene(scene, mesh);
      options.uploads?.made();
      capsule = { mesh, matrices: own, count: 0 };
    }
    let moved = count !== capsule.count;
    for (let i = 0; i < count * 16 && !moved; i++) moved = capsule.matrices[i] !== matrices[i];
    if (!moved) return;
    capsule.matrices.set(matrices.subarray(0, count * 16));
    setThinInstanceCount(capsule.mesh, count);
    if (count > 0) options.uploads?.count("instances", count * MATRIX_BYTES);
    if ((count > 0) !== (capsule.count > 0)) setMeshVisible(capsule.mesh, count > 0);
    capsule.count = count;
  }

  // What a frame fills: for each model the bodies it draws, by the order of the poses.
  const filled = new Map<Loaded, { count: number; moved: boolean; reclipped: boolean }>();
  const fillOf = (entry: Loaded): { count: number; moved: boolean; reclipped: boolean } => {
    let fill = filled.get(entry);
    if (fill === undefined) {
      fill = { count: 0, moved: false, reclipped: false };
      filled.set(entry, fill);
    }
    return fill;
  };
  const scratch = new Float32Array(16);
  const capsules = new Float32Array(RANGER_CAPACITY * 16);

  /** Stands a body in `entry`'s next instance, playing `clip` at the clock's time. True where it was given one. */
  function place(entry: Loaded, x: number, y: number, z: number, yaw: number, scale: number, clock: ClipClock, refold: boolean): number {
    const model = entry.model as SkinnedModel;
    const fill = fillOf(entry);
    if (fill.count >= model.capacity) return -1;
    const index = fill.count++;
    writeBodyMatrix(scratch, 0, x, y, z, yaw, scale);
    if (entry.lift !== null) liftBody(scratch, entry.lift);
    const at = index * 16;
    for (let i = 0; i < 16; i++) {
      if (model.matrices[at + i] !== scratch[i]) {
        model.matrices[at + i] = scratch[i] as number;
        fill.moved = true;
      }
    }
    const clip = clipOf(entry, (CLIP_KINDS as readonly string[]).includes(clock.clip) ? (clock.clip as ClipKind) : "idle");
    if (clip !== null) {
      // After a fold of the shared clock every body's floats are written for the new count.
      if (refold) model.clipParams[index * 8] = -1;
      if (writeClipParams(model.clipParams, index, clip, clock.seconds, clock.rate, options.clock.seconds, true)) fill.reclipped = true;
    }
    return index;
  }

  const hollow = options.hollows ? ask(HOLLOW_MODEL) : null;
  const ready: Promise<void> = hollow === null ? Promise.resolve() : hollow.settled;

  return {
    models: {
      player: (_id, model) => (ask(model)?.state ?? "failed") !== "failed",
      hollow: () => (hollow?.state ?? "failed") !== "failed",
    },
    update(frame, dt) {
      if (disposed) return;
      const refold = options.clock.folds !== clockFolds;
      clockFolds = options.clock.folds;
      for (const fill of filled.values()) {
        fill.count = 0;
        fill.moved = false;
        fill.reclipped = false;
      }
      seen.clear();
      lampCount = 0;
      let capsuleCount = 0;
      counts.bodies = 0;
      counts.eyes = 0;
      for (const pose of frame.players) {
        if (pose.local) continue;
        // The lamp stands at the eyes, whichever body is drawn; a hiker in the car wears none lit.
        const lamp = lampAt(lampCount++);
        lamp.on = pose.hidden === null && pose.lampOn;
        if (pose.hidden !== null) continue;
        lamp.x = pose.eyeX;
        lamp.y = pose.eyeY;
        lamp.z = pose.eyeZ;
        lamp.dx = pose.aimX;
        lamp.dy = pose.aimY;
        lamp.dz = pose.aimZ;
        if (!pose.modelled) {
          if (capsuleCount < RANGER_CAPACITY) writeBodyMatrix(capsules, capsuleCount++, pose.x, pose.y, pose.z, pose.yaw, 1);
          continue;
        }
        const entry = loaded.get(pose.model);
        const clock = clockOf(pose.id);
        stepClip(clock, pose.clip, pose.rate, dt);
        if (entry === undefined || entry.state !== "landed") continue;
        if (place(entry, pose.x, pose.y, pose.z, pose.yaw, 1, clock, refold) >= 0) counts.bodies++;
      }
      lamps.length = lampCount;
      // The Hollows and the shades going out: their eyes, each pair from when its level is above nothing.
      const eyes = (id: number, x: number, y: number, z: number, yaw: number, clip: string | null, rate: number | null, level: number): void => {
        const clock = clockOf(id);
        stepClip(clock, clip ?? (clock.clip === "" ? "idle" : clock.clip), rate, dt);
        if (hollow === null || hollow.state !== "landed" || level <= 0) return;
        const index = place(hollow, x, y, z, yaw, HOLLOW_SCALE, clock, refold);
        if (index < 0) return;
        counts.eyes++;
        if (setEyeLevel(eyeColours, index, level)) relevelled = true;
      };
      for (const pose of frame.hollows) if (pose.modelled) eyes(pose.id, pose.x, pose.y, pose.z, pose.yaw, pose.clip, pose.rate, pose.shade.eyeLevel);
      for (const pose of frame.fading) eyes(pose.id, pose.x, pose.y, pose.z, pose.yaw, null, null, pose.shade.eyeLevel);
      for (const id of clocks.keys()) if (!seen.has(id)) clocks.delete(id);

      counts.draws = 0;
      for (const [entry, fill] of filled) {
        const model = entry.model as SkinnedModel;
        model.show(fill.count, fill.moved, fill.reclipped);
        if (fill.count > 0) counts.draws += model.parts.filter((part) => part.drawn).length;
      }
      // The eyes' levels, sent when one of the pairs drawn has changed or a pair has joined them: sixteen bytes a pair.
      if (counts.eyes > 0 && (relevelled || counts.eyes > eyesSent)) {
        for (const mesh of eyeMeshes) {
          setThinInstanceColors(mesh, eyeColours);
          options.uploads?.count("instances", counts.eyes * EYE_LEVEL_BYTES);
        }
      }
      eyesSent = counts.eyes;
      relevelled = false;
      showCapsules(capsules, capsuleCount);
      counts.capsules = capsuleCount;
      if (capsuleCount > 0) counts.draws++;
      // The shared clock is sent on a frame that shows a skinned body, and on no other.
      if (counts.bodies + counts.eyes > 0) options.clock.send(options.uploads);
    },
    lamps: () => lamps,
    waiting: () => waiting,
    drawn: () => ({ ...counts }),
    ready,
    dispose() {
      if (disposed) return;
      disposed = true;
      loads.abort();
      for (const entry of loaded.values()) entry.model?.dispose();
      loaded.clear();
      if (capsule !== null) {
        removeFromScene(scene, capsule.mesh);
        disposeMeshGpu(capsule.mesh);
        options.uploads?.dropped();
        capsule = null;
      }
    },
  };
}
