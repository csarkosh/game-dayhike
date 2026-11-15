import { Quaternion, Vector3 } from "@babylonjs/core/Maths/math.vector.js";
import { Color3 } from "@babylonjs/core/Maths/math.color.js";
import { PBRMaterial } from "@babylonjs/core/Materials/PBR/pbrMaterial.js";
import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder.js";
import type { Mesh } from "@babylonjs/core/Meshes/mesh.js";
import type { TransformNode } from "@babylonjs/core/Meshes/transformNode.js";
import type { AbstractMesh } from "@babylonjs/core/Meshes/abstractMesh.js";
import type { Observer } from "@babylonjs/core/Misc/observable.js";
import type { Scene } from "@babylonjs/core/scene.js";
import type { SpotLight } from "@babylonjs/core/Lights/spotLight.js";

import type { WorldState } from "../sim/types.js";
import { ENEMY_HALF, PLAYER_HALF } from "../sim/constants.js";
import { HOLLOW_HEIGHT } from "../sim/hollow.js";
import { createCharacterPool, type CharacterInstance, type CharacterPool } from "./characterModel.js";
import { HOLLOW_MODEL, createEntityPoses, type EntityModels, type EntityPoses } from "./entityPoses.js";
import { LAMP_ANGLE, LAMP_RANGE, createHeadlamp, setLamp } from "./headlamp.js";
import { LAMP_DEFAULT, type LampState } from "./lampParams.js";
import {
  HOLLOW_ALBEDO, HOLLOW_EMISSIVE, HOLLOW_EYE_COLOR, HOLLOW_EYE_INTENSITY, HOLLOW_MATERIAL, HOLLOW_ROUGHNESS, HOLLOW_SCALE,
} from "./hollowLook.js";

// Where the bodies stand and how, a frame, is worked out with no engine (`entityPoses.ts`): this file moves nodes.
export {
  CHARACTER_IDS, HOLLOW_MAX_MEASURED_SPEED, HOLLOW_MODEL, HOLLOW_SPEED_SMOOTHING, LUNGE_FADE_IN_S, RANGER_IDS, REACH_M, REACH_S,
  SHADE_EYES_DULL, SHADE_EYES_FROM, SHADE_EYES_SHADE, SHADE_FADE_IN_S, SHADE_FADE_OUT_S, SHADE_FAR_M, SHADE_FAR_SHARE, SHADE_NEAR_M,
  SHADE_OPACITY_GAIN, SHADE_RESOLVE_M, SHADE_RESOLVE_S, SHADE_UNRESOLVE_S, SUMMIT_RISE_DELAY_S, WALK_RATIO_MAX, WALK_RATIO_MIN,
  WALK_THRESHOLD, eyeLevelOf, opacityOf,
} from "./entityPoses.js";

/**
 * The local player's own body in its first frames (`warmLocal`): the metres
 * under their feet it is drawn at, behind the ground, and the frames and the
 * milliseconds it is drawn for at least. The time is what the pipelines take,
 * not the frames: on the rig that measured it (a T4, two creations in
 * flight) a body's two took about a second, asked for while the hike's own
 * were still being made.
 */
export const WARM_DEPTH_M = 40;
export const WARM_FRAMES_MIN = 30;
export const WARM_MS = 8000;
import type { ShadeEntry } from "./shadeSilhouette.js";

/** A Hollow's model, with the meshes that are its eyes (the glowing materials), which the shade mask lets onto the frame dulled. */
type HollowView = { instance: CharacterInstance; eyes: AbstractMesh[]; arms: { shoulder: TransformNode; elbow: TransformNode; wrist: TransformNode }[] };

/**
 * The reaching arms are the model's shoulder, elbow and wrist joints
 * (characterModel.ts `joint`), which the file names by number; `ARMS` names
 * them for each side.
 */
export const ARMS: readonly { shoulder: string; elbow: string; wrist: string }[] = [
  { shoulder: "hollow.antlered.node19", elbow: "hollow.antlered.node18", wrist: "hollow.antlered.node17" },
  { shoulder: "hollow.antlered.node38", elbow: "hollow.antlered.node37", wrist: "hollow.antlered.node36" },
];

/** Writes `visibility` on every mesh under `node`: 1 is drawn as it is, under 1 is blended toward nothing. */
function setVisibility(node: TransformNode, level: number): void {
  const v = level < 0 ? 0 : level > 1 ? 1 : level;
  for (const m of node.getChildMeshes(false)) m.visibility = v;
  if ((node as Mesh).visibility !== undefined) (node as Mesh).visibility = v;
}

export class EntityViews {
  /** Capsules, drawn for a player or a Hollow whose model is not (yet) in the pool. */
  private readonly players = new Map<number, Mesh>();
  private readonly enemies = new Map<number, Mesh>();
  /** The players whose model this file has placed, and the Hollows' models with their eyes and arms. */
  private readonly playerModels = new Map<number, CharacterInstance>();
  private readonly enemyModels = new Map<number, HollowView>();
  /** Where every body stands and how, a frame (`entityPoses.ts`). */
  private readonly poses: EntityPoses = createEntityPoses();
  /** Whether the local player's own body is drawn: a scene's camera stands elsewhere (renderer.ts). */
  get showLocal(): boolean {
    return this.poses.showLocal;
  }
  set showLocal(on: boolean) {
    this.poses.showLocal = on;
  }
  /** In the end scene, every other body within `radius` of this point (the car's door) is hidden: it is in the car. */
  get hideNear(): { x: number; z: number; radius: number } | null {
    return this.poses.hideNear;
  }
  set hideNear(near: { x: number; z: number; radius: number } | null) {
    this.poses.hideNear = near;
  }
  /**
   * Where the local body's eyes are and the way they look, as this sync drew
   * it: null when it drew no local body. The body has no lamp of its own; a
   * scene that shows it moves the lens's lamp here (renderer.ts), so the
   * lights every material binds are the same all game.
   */
  localEye: { x: number; y: number; z: number; dx: number; dy: number; dz: number } | null = null;
  private readonly eye = { x: 0, y: 0, z: 0, dx: 0, dy: 0, dz: 1 };
  /** Where the reaching arms aim this frame: the local player's eyes, or null with no local player. */
  private reachAt: Vector3 | null = null;
  private readonly reachObserver: Observer<Scene> | null;
  private readonly warmObserver: Observer<Scene> | null;
  /** Models of shades gone from the state, going out: held until the fade ends. */
  private readonly fading = new Map<number, HollowView>();
  /** This frame's shades for the silhouette mask (shadeSilhouette.ts), which
   * sets their fade and softness and leaves their `visibility` and layer to
   * the mask on every path (the low tier's own fade by `visibility` went
   * 2026-11-05: the mask and the veil draw the figure there too). */
  private readonly shadeList: ShadeEntry[] = [];
  private readonly lamps = new Map<number, SpotLight>();
  private readonly playerMaterial: PBRMaterial;
  private readonly hollowMaterial: PBRMaterial;
  /** Which bodies are drawn as their models: a model the pool holds, made on the asking. */
  private readonly modelled: EntityModels = {
    player: (id, model) => this.models.acquire(id, model) !== null,
    hollow: (id) => this.models.acquire(id, HOLLOW_MODEL) !== null,
  };

  constructor(
    private readonly scene: Scene,
    readonly models: CharacterPool = createCharacterPool(),
    /** The page's clock (ms), which times the local body's first frames; the tests hand in their own. */
    private readonly now: () => number = () => performance.now(),
  ) {
    // PBRMaterial, not StandardMaterial: a StandardMaterial ignores
    // `scene.environmentTexture` entirely and takes the full sun intensity
    // (4.0 at noon), so a remote player's capsule would read blown-out and
    // unlit-by-sky beside PBR terrain. Metallic 0 and a mid roughness put
    // these capsules in the same dielectric, matte-ish range as the world
    // materials in `renderer.ts`.
    // The reach is posed after the clips have animated the joints for the
    // frame (scene.animate runs before this observer), so it stands on the
    // idle rather than under it.
    this.reachObserver = scene.onBeforeRenderObservable.add(() => this.applyReaches());
    this.warmObserver = scene.onAfterRenderObservable.add(() => this.warmDrawn());
    this.playerMaterial = new PBRMaterial("mat_player", scene);
    this.playerMaterial.albedoColor = new Color3(0.3, 0.7, 0.95);
    this.playerMaterial.metallic = 0;
    this.playerMaterial.roughness = 0.85;
    // The Hollow's fallback: a very dark shape the lights can touch, outside
    // the fog. It must be lit, because it hunts in the dark: a pure black,
    // unlit shape is invisible at full dark, whatever the lamp does. And lit
    // as PBR, because the headlamp's 400 is tuned for PBR's physical falloff;
    // a lit StandardMaterial under that lamp blows out white. The albedo, the
    // emissive floor and the roughness are the knobs in hollowLook.ts.
    //
    // Fog stays off so it remains a silhouette at any distance in mist,
    // findable in hindsight from far off. That is also why the Atmosphere
    // plugin (atmosphere.ts) must leave this one material alone (it declines
    // it by name): the plugin's spliced shader code reads Babylon's `vFogColor`,
    // which the shader declares only while the material's FOG define is set.
    // With fog off the fragment shader fails on an undeclared identifier and
    // the material silently never draws. The model's own materials keep fog
    // on and take the plugin like every other lit surface.
    this.hollowMaterial = new PBRMaterial(HOLLOW_MATERIAL, scene);
    this.hollowMaterial.albedoColor = new Color3(HOLLOW_ALBEDO.r, HOLLOW_ALBEDO.g, HOLLOW_ALBEDO.b);
    this.hollowMaterial.emissiveColor = new Color3(HOLLOW_EMISSIVE.r, HOLLOW_EMISSIVE.g, HOLLOW_EMISSIVE.b);
    this.hollowMaterial.metallic = 0;
    this.hollowMaterial.roughness = HOLLOW_ROUGHNESS;
    this.hollowMaterial.fogEnabled = false;
  }

  /**
   * `lamp` is this frame's headlamp state (`lampUnder(weather, t)`), shared
   * by every remote player's lamp: dread dims and flickers all of them alike.
   * Defaults to the tuned lamp for callers without weather. `dt` is the
   * frame's seconds, from which the Hollow's pace is measured; 0 leaves its
   * pace where it was.
   */
  sync(
    state: WorldState,
    localId: number,
    alpha: number,
    lampState: LampState = LAMP_DEFAULT,
    dt = 0,
  ): void {
    this.localEye = null;
    const frame = this.poses.step(state, localId, alpha, dt, this.modelled);

    for (const pose of frame.players) {
      const id = pose.id;
      // The local player is the camera; drawing their own body would fill
      // the screen from the inside. In a scene (showLocal) the camera is
      // elsewhere and the body stands in the shot.
      if (pose.hidden === "lens") {
        // Its first frames: drawn out of sight, so the summit scene's first shot asks for nothing.
        if (this.warmLocal(id, pose.model, pose.x, pose.y, pose.z)) continue;
        this.players.get(id)?.setEnabled(false);
        this.playerModels.get(id)?.root.setEnabled(false);
        continue;
      }
      if (pose.hidden === "car") {
        this.players.get(id)?.setEnabled(false);
        this.playerModels.get(id)?.root.setEnabled(false);
        const lamp = this.lamps.get(id);
        if (lamp !== undefined) setLamp(lamp, false);
        continue;
      }

      let node: TransformNode;
      if (pose.modelled) {
        const instance = this.models.acquire(id, pose.model) as CharacterInstance;
        this.playerModels.set(id, instance);
        // Hide the fallback capsule if one was made before the model loaded.
        this.players.get(id)?.setEnabled(false);
        node = instance.root;
        node.setEnabled(true);
        if (pose.clip === "walk") {
          instance.setSpeed(pose.rate);
          instance.play("walk");
        } else {
          instance.setSpeed(1);
          instance.play("idle");
        }
      } else {
        let capsule = this.players.get(id);
        if (capsule === undefined) {
          capsule = this.makeCapsule(`player_${id}`, this.playerMaterial);
          this.players.set(id, capsule);
        }
        capsule.setEnabled(true);
        node = capsule;
      }
      node.position.set(pose.x, pose.y, pose.z);
      node.rotation.y = pose.yaw;

      // The local body wears the lens's lamp, which the renderer moves here: a lamp of its own was a
      // fourth light on every lit material (to 2026-11-09), so each needed its shader and its
      // pipeline again in the summit scene's first frame: the page held 18 of the scene's 21 seconds
      // for them on WebGPU, and drew five frames of it on WebGL2 (the rig's measure).
      if (pose.local) {
        const eye = this.eye;
        eye.x = pose.eyeX;
        eye.y = pose.eyeY;
        eye.z = pose.eyeZ;
        eye.dx = pose.aimX;
        eye.dy = pose.aimY;
        eye.dz = pose.aimZ;
        this.localEye = eye;
        continue;
      }
      // Unparented: a child of the body would inherit its yaw and turn
      // `direction` into a local vector, so position and direction are written
      // in world space every sync instead. At the eyes, whichever body is drawn.
      let lamp = this.lamps.get(id);
      if (lamp === undefined) {
        lamp = createHeadlamp(this.scene, `lamp_player_${id}`);
        this.lamps.set(id, lamp);
      }
      lamp.position.set(pose.eyeX, pose.eyeY, pose.eyeZ);
      lamp.direction.set(pose.aimX, pose.aimY, pose.aimZ);
      if (lamp.angle !== LAMP_ANGLE) lamp.angle = LAMP_ANGLE;
      if (lamp.range !== LAMP_RANGE) lamp.range = LAMP_RANGE;
      setLamp(lamp, pose.lampOn, lampState);
    }
    for (const id of frame.playersGone) {
      this.models.release(id);
      this.playerModels.delete(id);
    }
    for (const id of frame.capsulesGone) {
      this.players.get(id)?.dispose();
      this.players.delete(id);
    }
    for (const [id, lamp] of this.lamps) {
      if (!state.players.has(id)) {
        lamp.dispose();
        this.lamps.delete(id);
      }
    }

    this.shadeList.length = 0;
    this.reachAt = frame.reachAt === null ? null : new Vector3(frame.reachAt.x, frame.reachAt.y, frame.reachAt.z);
    for (const pose of frame.hollows) {
      const id = pose.id;
      if (pose.modelled) {
        const instance = this.models.acquire(id, HOLLOW_MODEL) as CharacterInstance;
        const entry = this.ensureHollowModel(id, instance);
        this.enemies.get(id)?.setEnabled(false);
        const node = instance.root;
        node.position.set(pose.x, pose.y, pose.z);
        node.rotation.y = pose.yaw;
        const look = pose.shade;
        this.shadeList.push({ node, fade: look.fade, presence: look.presence, soft: look.soft, near: look.near, eyes: entry.eyes, eyeLevel: look.eyeLevel });
        // A strike stands in the idle with its arms out (the reach, below); everything else walks or stands by its pace.
        if (pose.rate === null) instance.play("idle");
        else if (pose.clip === "walk") {
          instance.setSpeed(pose.rate);
          instance.play("walk");
        } else {
          instance.setSpeed(1);
          instance.play("idle");
        }
        continue;
      }
      let capsule = this.enemies.get(id);
      if (capsule === undefined) {
        capsule = this.makeHollow(`hollow_${id}`);
        this.enemies.set(id, capsule);
      }
      capsule.setEnabled(true);
      capsule.position.set(pose.x, pose.y, pose.z);
      capsule.rotation.y = pose.yaw;
      setVisibility(capsule, pose.level);
    }
    // A shade or a lunge gone from the state goes out to nothing over
    // SHADE_FADE_OUT_S: its model is held back from the prune until then.
    for (const out of frame.fading) {
      let entry = this.fading.get(out.id);
      if (entry === undefined) {
        entry = this.enemyModels.get(out.id) as HollowView;
        this.enemyModels.delete(out.id);
        this.fading.set(out.id, entry);
      }
      const look = out.shade;
      this.shadeList.push({ node: entry.instance.root, fade: look.fade, presence: look.presence, soft: look.soft, near: look.near, eyes: entry.eyes, eyeLevel: look.eyeLevel });
    }
    for (const id of frame.hollowsGone) {
      this.models.release(id);
      this.fading.delete(id);
      this.enemyModels.delete(id);
    }
    for (const id of frame.hollowCapsulesGone) {
      this.enemies.get(id)?.dispose();
      this.enemies.delete(id);
    }
  }

  /** How many enemies are fading out, for the tests. */
  fadingOut(): number {
    return this.poses.fadingOut();
  }

  /**
   * The local body's warm-up: whether it stands in the frame being made, the frames that drew it,
   * when the first and the latest of them ended, and whether it is over.
   */
  private readonly warm = { placed: false, frames: 0, since: Number.NaN, last: Number.NaN, done: false };
  /** After a frame the scene drew: one more of the body's first frames, if it stood in it. */
  private warmDrawn(): void {
    const w = this.warm;
    if (!w.placed) return;
    w.placed = false;
    w.frames++;
    w.last = this.now();
    if (Number.isNaN(w.since)) w.since = w.last;
  }
  /**
   * The local player's own body in its first frames: drawn WARM_DEPTH_M under where they stand,
   * behind the ground, whatever the view, so its shaders and its pipelines (on WebGL2 its
   * programs) are made while the hike starts. A body first drawn in the summit scene's first shot
   * asked for them there: the page held that shot's frames for them on WebGPU, and stopped for
   * them on WebGL2. Counted in frames the scene drew, from the first of them: a page still
   * holding its frames for the world's pipelines has drawn none. True while it draws.
   */
  private warmLocal(id: number, model: string, x: number, feet: number, z: number): boolean {
    const w = this.warm;
    if (w.done) return false;
    const instance = this.models.acquire(id, model);
    if (instance === null) return false;
    const meshes = instance.root.getChildMeshes(false);
    if (w.frames >= WARM_FRAMES_MIN && w.last - w.since >= WARM_MS) {
      w.done = true;
      for (const m of meshes) m.alwaysSelectAsActiveMesh = false;
      // Placed anew when a scene shows it: its place forgotten, the instance kept.
      if (this.playerModels.delete(id)) instance.root.setEnabled(false);
      this.poses.forgetModel(id);
      return false;
    }
    // Its track is its model's, drawn under the ground whatever the track says.
    const track = this.poses.modelTrack(id, x, feet - WARM_DEPTH_M, z);
    track.x = x;
    track.y = feet - WARM_DEPTH_M;
    track.z = z;
    this.playerModels.set(id, instance);
    this.players.get(id)?.setEnabled(false);
    instance.root.setEnabled(true);
    instance.root.position.set(x, feet - WARM_DEPTH_M, z);
    for (const m of meshes) m.alwaysSelectAsActiveMesh = true;
    w.placed = true;
    return true;
  }

  /** Whether the local body is still in its first frames (`warmLocal`), for the tests. */
  warming(): boolean {
    return !this.warm.done;
  }

  /** This frame's shades for the silhouette mask. */
  shades(): readonly ShadeEntry[] {
    return this.shadeList;
  }

  /**
   * Turns `bone` so its line to `child` points at `to`, `t` of the way (0
   * leaves it as animated, 1 aims it). All in the parent's frame: the line is
   * the child's local position turned by the bone's rotation, the target is
   * `to` brought into the parent's space less the bone's position, and the
   * turn between them (FromUnitVectors, in Babylon's own hand) is composed
   * before the rotation, since `a.multiply(b)` applies b first.
   */
  private static aimBone(bone: TransformNode, child: TransformNode, to: Vector3, t: number): void {
    const parent = bone.parent as TransformNode | null;
    if (parent === null) return;
    parent.computeWorldMatrix(true);
    const local = bone.rotationQuaternion ?? Quaternion.FromEulerVector(bone.rotation);
    const line = child.position.clone();
    if (line.lengthSquared() < 1e-10) return;
    line.normalize().applyRotationQuaternionInPlace(local);
    const want = Vector3.TransformCoordinates(to, parent.getWorldMatrix().clone().invert()).subtract(bone.position);
    if (want.lengthSquared() < 1e-10) return;
    want.normalize();
    const turn = new Quaternion();
    Quaternion.FromUnitVectorsToRef(line, want, turn);
    if (t < 1) Quaternion.SlerpToRef(Quaternion.Identity(), turn, t, turn);
    bone.rotationQuaternion = turn.multiply(local);
    bone.computeWorldMatrix(true);
  }

  /** Poses every reaching enemy's arms at the local player's eyes, after the frame's animation. */
  private applyReaches(): void {
    const at = this.reachAt;
    if (at === null) return;
    for (const [id, reach] of this.poses.reaches()) {
      if (reach <= 0) continue;
      const entry = this.enemyModels.get(id);
      if (entry === undefined) continue;
      for (const arm of entry.arms) {
        EntityViews.aimBone(arm.shoulder, arm.elbow, at, reach);
        EntityViews.aimBone(arm.elbow, arm.wrist, at, reach);
      }
    }
  }

  private ensureHollowModel(id: number, instance: CharacterInstance): HollowView {
    const existing = this.enemyModels.get(id);
    if (existing !== undefined && existing.instance === instance) return existing;
    // Only the picture grows: the hull, the stare and the contact are the sim's.
    instance.root.scaling.setAll(HOLLOW_SCALE);
    // The eyes are the materials that glow in the file. Materials are shared
    // by every instance of the model, so this settles them for all Hollows.
    const eyes: AbstractMesh[] = [];
    for (const mesh of instance.root.getChildMeshes(false)) {
      const material = mesh.material;
      if (!(material instanceof PBRMaterial)) continue;
      const e = material.emissiveColor;
      if (e.r === 0 && e.g === 0 && e.b === 0) continue;
      material.emissiveColor = new Color3(HOLLOW_EYE_COLOR.r, HOLLOW_EYE_COLOR.g, HOLLOW_EYE_COLOR.b);
      material.emissiveIntensity = HOLLOW_EYE_INTENSITY;
      eyes.push(mesh);
    }
    const arms: HollowView["arms"] = [];
    for (const a of ARMS) {
      const shoulder = instance.joint(a.shoulder), elbow = instance.joint(a.elbow), wrist = instance.joint(a.wrist);
      if (shoulder !== null && elbow !== null && wrist !== null) arms.push({ shoulder, elbow, wrist });
    }
    const entry = { instance, eyes, arms };
    this.enemyModels.set(id, entry);
    return entry;
  }

  /** Where player `id`'s body is drawn this frame: between its last two places, at its feet. Null for a player with no body drawn. One reused object. */
  drawnAt(id: number): { x: number; y: number; z: number } | null {
    return this.poses.drawnAt(id);
  }

  private makeCapsule(name: string, material: PBRMaterial): Mesh {
    const mesh = MeshBuilder.CreateCapsule(
      name,
      { height: PLAYER_HALF.y * 2, radius: PLAYER_HALF.x },
      this.scene,
    );
    mesh.material = material;
    return mesh;
  }

  private makeHollow(name: string): Mesh {
    const mesh = MeshBuilder.CreateCapsule(name, { height: HOLLOW_HEIGHT, radius: ENEMY_HALF.x }, this.scene);
    mesh.material = this.hollowMaterial;
    return mesh;
  }

  dispose(): void {
    if (this.reachObserver !== null) this.scene.onBeforeRenderObservable.remove(this.reachObserver);
    if (this.warmObserver !== null) this.scene.onAfterRenderObservable.remove(this.warmObserver);
    this.fading.clear();
    this.poses.clear();
    for (const capsule of this.players.values()) capsule.dispose();
    for (const capsule of this.enemies.values()) capsule.dispose();
    for (const lamp of this.lamps.values()) lamp.dispose();
    this.players.clear();
    this.enemies.clear();
    this.playerModels.clear();
    this.enemyModels.clear();
    this.lamps.clear();
    this.models.dispose();
    this.playerMaterial.dispose();
    this.hollowMaterial.dispose();
  }
}
