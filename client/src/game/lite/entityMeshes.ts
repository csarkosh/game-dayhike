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
 * fetches one: the local hiker's own.
 *
 * **A body is not drawn while its model is on the way.** The capsule is for
 * the model that never came: one draw for every such hiker, in the game's
 * blue. One standing in while a model loads would be a blue shape for the
 * moment after each hiker joins.
 *
 * **The local hiker's own body is an instance like any other's**, of the
 * ranger they wear, drawn only while a scene's camera stands elsewhere
 * (`EntityPoses.showLocal`); it wears no lamp of its own, since the lens's
 * is moved to its eyes. Its ranger is fetched with the hike and drawn for
 * its first frames under the ground it stands on (`LOCAL_WARM_FRAMES`), so
 * the pipelines its two draws need are made as the hike starts and not in
 * the first frame of the summit's scene.
 *
 * **Of a Hollow the frame shows its eyes, glowing at their level.** The
 * figure itself is a shadow in the silhouette mask, which the grade lays
 * over the frame: the model's other primitives are drawn there, by the mask
 * (`shadeMask.ts`), from the same bodies, and by no other pass: they stand
 * hidden; this file stands the bodies and hands the mask each figure's
 * values (`ShadeLook`: how far in it is, how soft, how near). A body stands
 * from when its figure is in the mask at all or its eyes' level is above
 * nothing. What is drawn on the frame is the model's glowing primitive
 * alone, one opaque draw for every Hollow and shade, and none while no
 * pair's level is above nothing.
 * A pair's level (`eyeLevelOf`: the real one's glow dulled, a shade's near
 * nothing, both rising with the figure as it comes in and going first as
 * it goes) multiplies the eye's whole lit colour, what it gives off and
 * what it reflects together, in linear light, before the air, the display
 * curve and the grade (`eyeLevelPlugin`): at a level of 0.1375 the real
 * one's eye gives off 0.55 of the eye's colour, where the whole eye gives
 * off 4 of it. What the eye's surface reflects is scaled with it, because
 * the model's eye is a red surface lit by the day and by a lamp like any
 * other: left whole, a shade's eyes would stay red discs with next to no
 * glow in them. The level rides the pair's instance, a float of the
 * plugin's own: four bytes a pair are written on a frame in which a level
 * has changed or a pair has joined, and while no level is above nothing
 * there is no draw and no write. A pair at no level among pairs that glow
 * is put outside the view.
 *
 * The eyes are drawn with the bodies, at the last of their places
 * (`BODY_PLACES.eyes`), and write the frame's depth as every opaque draw
 * does: a trunk in front of them hides them, and the motes, the mist banks
 * and the rain, which follow every opaque draw, are laid over them. The
 * model is fetched with the hike, since a Hollow steps out of the mist
 * without warning.
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
  addToScene, createCapsule, createPbrMaterial, disposeMeshGpu, markThinInstancePluginData, removeFromScene, setMeshVisible, setPbrEmissive,
  setThinInstanceCount, setThinInstances,
  type EngineContext, type MaterialPlugin, type Mesh, type PbrMaterialProps, type PluginUniformBlock, type SceneContext,
} from "@babylonjs/lite";
import catalog from "../../../assets/catalog.json" with { type: "json" };
import { PLAYER_HALF } from "@csarkosh/engine/sim/constants";
import { clipNameFor, resolveCharacterAssets, type CharacterAsset, type ClipKind } from "../characterAssets.js";
import { HOLLOW_MODEL, stepClip, type ClipClock, type EntityFrame, type EntityModels, type ShadeLook } from "../entityPoses.js";
import { HOLLOW_EYE_COLOR, HOLLOW_EYE_INTENSITY, HOLLOW_SCALE } from "../hollowLook.js";
import { writeBodyMatrix, writeClipParams, type BakedClip } from "@csarkosh/engine/game/skinInstances";
import type { WetUniforms } from "@csarkosh/engine/game/wetSurface";
import { DRAW_ORDER, createDrawOrders } from "@csarkosh/engine/game/lite/drawOrder";
import { baseColourPlugin, surfaceWetPlugin } from "./forestPlugins.js";
import type { FrameUploads } from "@csarkosh/engine/game/lite/frameUploads";
import { MATRIX_BYTES } from "./listMeshes.js";
import { writeShadeLook, type LiteShadeMask } from "./shadeMask.js";
import { loadSkinnedModel, type SkinClock, type SkinnedModel, type SkinnedPart } from "./skinnedModels.js";
import eyeLevelVertexSource from "../shaders/entity/eyeLevelVertex.wgsl?raw";
import eyeLevelColourSource from "../shaders/entity/eyeLevelColour.wgsl?raw";
import { wgsl } from "@csarkosh/engine/game/shaders/shaderText";

/** The bodies' places among the draws, from the shell's first: a ranger's primitives, a place each by their order in the model, then the capsule, then the Hollow's body, which the mask draws and the frame's own pass does not, then the Hollows' eyes. */
export const BODY_PLACES = { rangers: 0, capsule: 4, figure: 5, eyes: 6 } as const;

/**
 * The local hiker's own body in its first frames: the metres under their
 * feet it is drawn at, behind the ground (the game's `WARM_DEPTH_M`), and
 * the frames it is drawn for once its ranger has landed. Lite makes a draw's
 * pipeline in the frame that first draws it, so the first frame makes them.
 */
export const LOCAL_WARM_DEPTH_M = 40;
export const LOCAL_WARM_FRAMES = 2;

/** The most hikers of one ranger drawn at once: every player may wear the same one. */
export const RANGER_CAPACITY = 8;
/** The most Hollows and shades whose eyes are drawn at once. */
export const HOLLOW_CAPACITY = 16;
/** The capsule's colour and roughness: the game's `mat_player`. */
export const CAPSULE_COLOUR: readonly [number, number, number] = [0.3, 0.7, 0.95];
export const CAPSULE_ROUGHNESS = 0.85;
/** Bytes of a pair of eyes' level: one float, the eyes' plugin's own in the pair's instance. */
export const EYE_LEVEL_BYTES = 4;

/**
 * The eyes at their level. The level multiplies the eye's whole lit colour,
 * the light it gives off and the light it reflects, once Lite's fragment
 * has summed the two and before the air is laid over the sum: the air and
 * the tier's curve or grade follow, so a faint eye is veiled by the air as
 * a dark surface is, and the fragment's alpha is left as the material has
 * it. The level is the plugin's own float in a pair's instance, handed on
 * to the fragment; a pair whose level is nothing is put outside the view,
 * so that it is no dark disc among pairs that glow. Just before the air's
 * plugin, which shares the fragment's point and moves no vertex.
 */
export function eyeLevelPlugin(): MaterialPlugin {
  return {
    name: "EyeLevel",
    priority: 890,
    getCustomCode: (stage) =>
      stage === "vertex"
        ? { CUSTOM_VERTEX_MAIN_END: wgsl(eyeLevelVertexSource) }
        : { CUSTOM_FRAGMENT_BEFORE_FINALCOLORCOMPOSITION: wgsl(eyeLevelColourSource) },
    getInstanceAttributes: () => [{ name: "eyeLevel", type: "f32", format: "float32" as const, stride: EYE_LEVEL_BYTES, offset: 0 }],
    getVaryings: () => [{ name: "vEyeLevel", type: "f32" }],
  };
}

/** Sets pair `index`'s level in `levels`, a float a pair; true where it changed. */
export function setEyeLevel(levels: Float32Array, index: number, level: number): boolean {
  const sent = Math.fround(level);
  if (levels[index] === sent) return false;
  levels[index] = sent;
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
  /** What is drawn now: the bodies as models and as capsules, the pairs of eyes, the Hollows' figures (in the mask, or standing for their eyes), and the draws they take in the frame's own pass, where a figure's body takes none. */
  drawn(): { bodies: number; capsules: number; eyes: number; figures: number; draws: number };
  /** Whether the local hiker's own body is still in its first frames, drawn under the ground (`LOCAL_WARM_FRAMES`). */
  warming(): boolean;
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
  /** The mask the Hollows' figures are drawn into (`shadeMask.ts`); without one a Hollow is its eyes alone. */
  mask?: LiteShadeMask | null;
  uploads?: FrameUploads;
};

const CLIP_KINDS: readonly ClipKind[] = ["idle", "walk", "attack", "death"];

type Loaded = {
  state: "loading" | "landed" | "failed";
  model: SkinnedModel | null;
  asset: CharacterAsset;
  clips: Map<string, BakedClip | null>;
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
  const counts = { bodies: 0, capsules: 0, eyes: 0, figures: 0, draws: 0 };
  const mask = options.mask ?? null;
  /** Each primitive of the Hollow's body in the mask, with its figures' values there. */
  const bodyLooks: Float32Array[] = [];
  const bodyMeshes: Mesh[] = [];
  let relooked = false;
  /** Whether the eyes' meshes are shown: only while a pair's level is above nothing. */
  let eyesShown = false;

  // The eyes: the meshes that draw them, each pair's level, and the pairs whose levels the GPU holds.
  const eyeMeshes: Mesh[] = [];
  const eyeLevels = new Float32Array(HOLLOW_CAPACITY);
  let eyesSent = 0;
  let relevelled = false;

  /** The frames the local hiker's own body is still to be drawn under the ground, from its ranger's landing. */
  let warmLeft = LOCAL_WARM_FRAMES;

  // The capsule, for a hiker whose ranger never came: made with its first.
  let capsule: { mesh: Mesh; matrices: Float32Array; count: number } | null = null;

  function dress(id: string, part: SkinnedPart, index: number): boolean {
    const material = part.material;
    material.usePhysicalLightFalloff = true;
    if (id === HOLLOW_MODEL) {
      // The eyes are the material that glows in the file; the rest of the figure is the mask's: drawn there with the
      // mask's own material, by the mask's own word, and hidden for every other pass. It stands in the scene either
      // way, so it is placed after the bodies, where Lite's own place for a mesh left unplaced is among the forest's.
      if (!part.emissive.some((channel) => channel > 0)) {
        orders.put(material, BODY_PLACES.figure);
        part.mesh.renderOrder = orders.of(material);
        if (mask === null) return false;
        part.elsewhere = true;
        bodyMeshes.push(part.mesh);
        return true;
      }
      setPbrEmissive(material, [HOLLOW_EYE_COLOR.r * HOLLOW_EYE_INTENSITY, HOLLOW_EYE_COLOR.g * HOLLOW_EYE_INTENSITY, HOLLOW_EYE_COLOR.b * HOLLOW_EYE_INTENSITY]);
      material.plugins = [baseColourPlugin(), surfaceWetPlugin(options.wet, options.shared), options.air(), eyeLevelPlugin()];
      // Each pair's level rides its instance. The levels are given before the mesh joins the scene; the instances
      // the model then gives it keep them.
      setThinInstances(part.mesh, new Float32Array(0), 0);
      if (part.mesh.thinInstances !== undefined && part.mesh.thinInstances !== null) part.mesh.thinInstances.pluginData = eyeLevels;
      orders.put(material, BODY_PLACES.eyes);
      part.mesh.renderOrder = orders.of(material);
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
    const mine: Loaded = { state: "loading", model: null, asset, clips: new Map(), settled: Promise.resolve() };
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
        // The body's primitives join the mask, which draws them from the same bodies.
        if (id === HOLLOW_MODEL && mask !== null) for (const mesh of bodyMeshes) bodyLooks.push(mask.add(mesh, HOLLOW_CAPACITY));
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
        if (pose.local) {
          if (pose.hidden === "lens") {
            // Its first frames: its ranger fetched with the hike and drawn under the ground, so a scene's first shot asks for nothing.
            if (warmLeft <= 0) continue;
            const worn = ask(pose.model);
            if (worn === null || worn.state === "failed") warmLeft = 0;
            if (worn === null || worn.state !== "landed") continue;
            const clock = clockOf(pose.id);
            stepClip(clock, "idle", 1, dt);
            if (place(worn, pose.x, pose.y - LOCAL_WARM_DEPTH_M, pose.z, pose.yaw, 1, clock, refold) >= 0) counts.bodies++;
            warmLeft--;
            continue;
          }
          // In a scene's shot the body stands as any other does; the lens's lamp is moved to its eyes by the renderer.
          if (pose.hidden !== null) continue;
        } else {
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
        }
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
      // The Hollows and the shades going out: a body for each whose figure is in the mask at all or whose eyes'
      // level is above nothing, its eyes at their level and its figure's values for the mask.
      counts.figures = 0;
      let masked = false;
      const figure = (id: number, x: number, y: number, z: number, yaw: number, clip: string | null, rate: number | null, look: ShadeLook): void => {
        const clock = clockOf(id);
        stepClip(clock, clip ?? (clock.clip === "" ? "idle" : clock.clip), rate, dt);
        const inMask = mask !== null && look.fade > 0;
        if (hollow === null || hollow.state !== "landed" || (look.eyeLevel <= 0 && !inMask)) return;
        const index = place(hollow, x, y, z, yaw, HOLLOW_SCALE, clock, refold);
        if (index < 0) return;
        counts.figures++;
        if (look.eyeLevel > 0) counts.eyes++;
        if (setEyeLevel(eyeLevels, index, Math.max(0, look.eyeLevel))) relevelled = true;
        if (inMask) masked = true;
        // The figure stands on its feet, which is where its pose is.
        for (const values of bodyLooks) if (writeShadeLook(values, index, { fade: inMask ? look.fade : 0, presence: look.presence, soft: look.soft, near: look.near, feetY: y })) relooked = true;
      };
      for (const pose of frame.hollows) if (pose.modelled && !pose.shadow) figure(pose.id, pose.x, pose.y, pose.z, pose.yaw, pose.clip, pose.rate, pose.shade);
      for (const pose of frame.fading) figure(pose.id, pose.x, pose.y, pose.z, pose.yaw, null, null, pose.shade);
      for (const id of clocks.keys()) if (!seen.has(id)) clocks.delete(id);

      counts.draws = 0;
      for (const [entry, fill] of filled) {
        const model = entry.model as SkinnedModel;
        const stood = model.count > 0;
        model.show(fill.count, fill.moved, fill.reclipped);
        if (entry === hollow) {
          // Showing its first body shows every primitive of the model, and its last hides them: the eyes are then
          // shown only while a pair's level is above nothing, so a figure in the mask alone costs no draw of them.
          if (stood !== fill.count > 0) eyesShown = fill.count > 0;
          const wanted = fill.count > 0 && counts.eyes > 0;
          if (wanted !== eyesShown) {
            eyesShown = wanted;
            for (const mesh of eyeMeshes) setMeshVisible(mesh, wanted);
          }
          // The body is the mask's pass's alone: the frame's own draws the eyes.
          if (wanted) counts.draws += eyeMeshes.length;
          continue;
        }
        if (fill.count > 0) counts.draws += model.parts.filter((part) => part.drawn).length;
      }
      // The eyes' levels, sent when one of the pairs drawn has changed or a body has joined them: four bytes a body.
      if (counts.eyes > 0 && (relevelled || counts.figures > eyesSent)) {
        for (const mesh of eyeMeshes) {
          markThinInstancePluginData(mesh, 0, counts.figures);
          options.uploads?.count("instances", counts.figures * EYE_LEVEL_BYTES);
        }
        eyesSent = counts.figures;
        relevelled = false;
      } else if (counts.figures === 0) eyesSent = 0;
      // The figures' values for the mask, sent where one changed, and the mask drawn with the frame while one is in.
      if (mask !== null) {
        if (relooked && counts.figures > 0) options.uploads?.count("instances", bodyLooks.length * counts.figures * 32);
        mask.show(counts.figures, relooked, masked);
        relooked = false;
      }
      showCapsules(capsules, capsuleCount);
      counts.capsules = capsuleCount;
      if (capsuleCount > 0) counts.draws++;
      // The shared clock is sent on a frame that shows a skinned body, and on no other.
      if (counts.bodies + counts.figures > 0) options.clock.send(options.uploads);
    },
    lamps: () => lamps,
    waiting: () => waiting,
    warming: () => warmLeft > 0,
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
