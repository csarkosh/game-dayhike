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

import type { Vec3, WorldState } from "../sim/types.js";
import { ENEMY_HALF, PLAYER_HALF, PLAYER_EYE_OFFSET } from "../sim/constants.js";
import { aimDirection } from "../sim/view.js";
import { HOLLOW_HEIGHT } from "../sim/hollow.js";
import { createCharacterPool, variantForId, type CharacterInstance, type CharacterPool } from "./characterModel.js";
import { createHeadlamp, setLamp } from "./headlamp.js";
import { LAMP_DEFAULT, type LampState } from "./lampParams.js";
import {
  HOLLOW_ALBEDO, HOLLOW_EMISSIVE, HOLLOW_EYE_COLOR, HOLLOW_EYE_INTENSITY, HOLLOW_MATERIAL, HOLLOW_ROUGHNESS,
  HOLLOW_SCALE, HOLLOW_WALK_CLIP_SPEED, RANGER_WALK_CLIP_SPEED,
} from "./hollowLook.js";
import { AiState, Phase } from "../sim/types.js";
import type { ShadeEntry } from "./shadeSilhouette.js";

/**
 * The rangers other hikers are drawn as, in a fixed order indexed by player
 * id, never by what loaded or by catalog order: every peer then sees the same
 * ranger for the same player, and a download that fails on one machine turns
 * that ranger into a capsule there rather than into a different ranger.
 */
export const RANGER_IDS: readonly string[] = [
  "ranger.nathan", "ranger.eric", "ranger.sophia", "ranger.carla", "ranger.claudia",
];
/** The Hollow's model. */
export const HOLLOW_MODEL = "hollow.antlered";
/** Every model this file draws, which is all `models.load` needs to fetch. */
export const CHARACTER_IDS: readonly string[] = [...RANGER_IDS, HOLLOW_MODEL];

/** Below this horizontal speed, m/s, a character stands; above it, it walks. */
export const WALK_THRESHOLD = 0.3;
/** The walk clip's playback rate never leaves this range, so a sprint or a lurch never shows a blur or a crawl. */
export const WALK_RATIO_MIN = 0.5;
export const WALK_RATIO_MAX = 2.5;
/** Seconds over which the Hollow's measured speed settles, so one uneven frame does not flick its clip. */
export const HOLLOW_SPEED_SMOOTHING = 0.25;
/** The most, m/s, one frame's displacement may count for in the Hollow's pace. */
export const HOLLOW_MAX_MEASURED_SPEED = 10;

type View = { node: TransformNode; previous: Vector3; target: Vector3 };
type ModelView = { instance: CharacterInstance; view: View };
/** A Hollow's model, with the meshes that are its eyes (the glowing materials), which the shade mask lets onto the frame dulled. */
type HollowView = ModelView & { pace: Pace; eyes: AbstractMesh[]; arms: { shoulder: TransformNode; elbow: TransformNode; wrist: TransformNode }[] };
/** The Hollow's measured pace: where its feet were last frame, and a smoothed speed. */
type Pace = { x: number; z: number; speed: number };

/**
 * A view's first frame is drawn where the entity is, not on the way there.
 * `advance` below interpolates from the last position the entity held, and
 * `previous` only moves when `target` does, so a view whose two points
 * started at the origin stayed a fraction of the way from the origin to the
 * entity for as long as it stood still: a player who joined and did not walk
 * was drawn hundreds of metres away until their first step.
 */
function placeView(node: TransformNode, x: number, y: number, z: number): View {
  node.position.set(x, y, z);
  return { node, previous: new Vector3(x, y, z), target: new Vector3(x, y, z) };
}

/** Walk or stand, and at what rate, for a character moving at `speed` m/s whose walk clip covers `clipSpeed` at rate 1. */
function stride(instance: CharacterInstance, speed: number, clipSpeed: number): void {
  if (speed > WALK_THRESHOLD) {
    const ratio = speed / clipSpeed;
    instance.setSpeed(ratio < WALK_RATIO_MIN ? WALK_RATIO_MIN : ratio > WALK_RATIO_MAX ? WALK_RATIO_MAX : ratio);
    instance.play("walk");
  } else {
    instance.setSpeed(1);
    instance.play("idle");
  }
}

/** Seconds a shade, a lunge or a Hollow stepping out takes to come in from nothing, and a shade or a lunge to go out. */
export const SHADE_FADE_IN_S = 0.9;
/** Seconds a gone shade takes to go: slowly, and unevenly (the grade dissolves it by `gone`, shadeSilhouette.ts). */
export const SHADE_FADE_OUT_S = 2.6;
/** Seconds a shade takes to rise from the ground to its height as it comes in, at half its opacity by then; and the seconds after that to its whole. Going, it keeps its height and dissolves. A lunge rises in half the time and is whole as it stands: it has metres to cover. */
export const SHADE_RISE_S = 2.4;
export const SHADE_SETTLE_S = 3;
export const LUNGE_RISE_S = 1.2;
/** Seconds the Hollow stepping out at the crest, in the summit scene, waits before its rise: the scene's first two shots and the reveal's first beat, the camera on its spot by then (cutscene.ts SUMMIT_RISE_AT_S). The chase's fork Hollows step out in the same state and never wait. */
export const SUMMIT_RISE_DELAY_S = 8.8;
/**
 * The eyes: the real one's, dulled to this share of their glow once it has
 * resolved; a shade's, fainter still. The share is the eye meshes' alpha over
 * an emissive of HOLLOW_EYE_INTENSITY (4), so a few hundredths is a solid
 * glow after the night's exposure and the halation; a shade's is near
 * nothing, a faint point.
 */
export const SHADE_EYES_DULL = 0.55;
export const SHADE_EYES_SHADE = 0.005;
/** Metres from the local eye within which a lunge resolves from the mist into the Hollow, and the seconds that takes. */
export const SHADE_RESOLVE_M = 24;
export const SHADE_RESOLVE_S = 0.7;
/** Seconds a gone lunge takes to be a shade again as it goes out. */
export const SHADE_UNRESOLVE_S = 0.5;
/** Metres within which a shade is whole in the mask, the metres at which it is SHADE_FAR_SHARE of itself, and that share. */
export const SHADE_NEAR_M = 10;
export const SHADE_FAR_M = 40;
export const SHADE_FAR_SHARE = 0.35;

/** Writes `visibility` on every mesh under `node`: 1 is drawn as it is, under 1 is blended toward nothing. */
/**
 * The reach: a lunge within REACH_M of the local eye, and the strike, hold
 * both arms out straight at the player's eyes, as if to take hold, the arms
 * turned from the idle's over REACH_S and back as fast. The arms are the
 * model's shoulder, elbow and wrist joints (characterModel.ts `joint`), which
 * the file names by number; `ARMS` names them for each side.
 */
export const REACH_M = 6;
export const REACH_S = 0.35;
export const ARMS: readonly { shoulder: string; elbow: string; wrist: string }[] = [
  { shoulder: "hollow.antlered.node19", elbow: "hollow.antlered.node18", wrist: "hollow.antlered.node17" },
  { shoulder: "hollow.antlered.node38", elbow: "hollow.antlered.node37", wrist: "hollow.antlered.node36" },
];

/**
 * The eyes' level on the frame: the real one's dulled glow, a shade's fainter, by the softness
 * between, and the fade. The level is the eye meshes' alpha, and they glow at HOLLOW_EYE_INTENSITY,
 * so the alpha is the level over that: a figure half there has eyes half there, the frame showing
 * through them as through its body, never a glow that saturates while the body is a veil.
 */
export function eyeLevelOf(soft: number, fade: number): number {
  return ((SHADE_EYES_SHADE * soft + SHADE_EYES_DULL * (1 - soft)) * fade) / HOLLOW_EYE_INTENSITY;
}

/** The share of its height a shade stands at for a rise of `t`: eased, so it slows into its full height. */
export function risen(t: number): number {
  const r = Math.max(0, Math.min(1, t));
  return r * r * (3 - 2 * r);
}

function setVisibility(node: TransformNode, level: number): void {
  const v = level < 0 ? 0 : level > 1 ? 1 : level;
  for (const m of node.getChildMeshes(false)) m.visibility = v;
  if ((node as Mesh).visibility !== undefined) (node as Mesh).visibility = v;
}

export class EntityViews {
  /** Capsules, drawn for a player or a Hollow whose model is not (yet) in the pool. */
  private readonly players = new Map<number, View>();
  private readonly enemies = new Map<number, View>();
  private readonly playerModels = new Map<number, ModelView>();
  private readonly enemyModels = new Map<number, HollowView>();
  /** Each enemy's fade, 0 to 1 (`visibility`), and the state it was last seen in: a shade, a lunge or a Hollow stepping out comes in from nothing, and a shade or a lunge goes out to nothing after it is gone. */
  /** Whether the local player's own body is drawn: a scene's camera stands elsewhere (renderer.ts). */
  showLocal = false;
  private readonly fades = new Map<number, { level: number; ai: number; rise: number; settle: number; quick: boolean; delay: number }>();
  /** Each enemy's reach, 0 to 1: how far its arms are turned out at the local player (REACH_S). */
  private readonly reaches = new Map<number, number>();
  /** Where the reaching arms aim this frame: the local player's eyes, or null with no local player. */
  private reachAt: Vector3 | null = null;
  private readonly reachObserver: Observer<Scene> | null;
  /** Views of shades gone from the state, fading out: the model is held until the fade ends. */
  private readonly fading = new Map<number, { entry: HollowView; level: number; rise: number; soft: number; near: number }>();
  /** Each shade's softness (shadeSilhouette.ts): 1 a blur in the mist, 0 the Hollow; a lunge resolves as it closes on the local eye. */
  private readonly soft = new Map<number, number>();
  private readonly near = new Map<number, number>();
  /**
   * Whether the shades are drawn soft, through the silhouette mask
   * (shadeSilhouette.ts): then this sets their fade and softness and leaves
   * their `visibility` and layer to the mask; otherwise (the low tier) they
   * are the Hollow, fading by `visibility` here.
   */
  softShades = false;
  /** This frame's shades for the mask: each node, its fade and its softness. */
  private readonly shadeList: ShadeEntry[] = [];
  private readonly lamps = new Map<number, SpotLight>();
  private readonly playerMaterial: PBRMaterial;
  private readonly hollowMaterial: PBRMaterial;

  constructor(
    private readonly scene: Scene,
    readonly models: CharacterPool = createCharacterPool(),
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
    const clamped = alpha < 0 ? 0 : alpha > 1 ? 1 : alpha;

    for (const [id, player] of state.players) {
      // The local player is the camera; drawing their own body would fill
      // the screen from the inside. In a scene (showLocal) the camera is
      // elsewhere and the body stands in the shot.
      if (id === localId && !this.showLocal) {
        this.players.get(id)?.node.setEnabled(false);
        this.playerModels.get(id)?.view.node.setEnabled(false);
        continue;
      }

      // The model's origin is at its feet (ARCHITECTURE.md, Model
      // conventions), the sim's position at the centre of the hull.
      const feet = player.pos.y - PLAYER_HALF.y;
      let node: TransformNode;
      let feetY: number;
      const instance = this.models.acquire(id, variantForId(RANGER_IDS, id) as string);
      if (instance !== null) {
        const entry = this.ensureModel(this.playerModels, id, instance, player.pos.x, feet, player.pos.z);
        // Hide the fallback capsule if one was made before the model loaded.
        this.players.get(id)?.node.setEnabled(false);
        entry.view.node.setEnabled(true);
        this.advance(entry.view, player.pos.x, feet, player.pos.z, clamped);
        // Sprint reuses the walk clip, played faster; `vel` is on the wire,
        // so every peer sees the same stride.
        stride(instance, Math.sqrt(player.vel.x * player.vel.x + player.vel.z * player.vel.z), RANGER_WALK_CLIP_SPEED);
        node = entry.view.node;
        feetY = node.position.y;
      } else {
        const view = this.ensure(this.players, id, player.pos, () =>
          this.makeCapsule(`player_${id}`, this.playerMaterial),
        );
        view.node.setEnabled(true);
        this.advance(view, player.pos.x, player.pos.y, player.pos.z, clamped);
        node = view.node;
        feetY = node.position.y - PLAYER_HALF.y;
      }
      node.rotation.y = player.yaw;

      // Unparented: a child of the body would inherit its yaw and turn
      // `direction` into a local vector, so position and direction are written
      // in world space every sync instead. At the eyes, whichever body is drawn.
      let lamp = this.lamps.get(id);
      if (lamp === undefined) {
        lamp = createHeadlamp(this.scene, `lamp_player_${id}`);
        this.lamps.set(id, lamp);
      }
      lamp.position.set(node.position.x, feetY + PLAYER_HALF.y + PLAYER_EYE_OFFSET, node.position.z);
      const d = aimDirection(player.yaw, player.pitch);
      lamp.direction.set(d.x, d.y, d.z);
      // The scene's light is the local player's own headlamp, worn on the body it shows, on for its length.
      setLamp(lamp, player.lamp.on || (id === localId && this.showLocal), lampState);
    }
    this.pruneModels(this.playerModels, state.players);
    this.prune(this.players, state.players);
    for (const [id, lamp] of this.lamps) {
      if (!state.players.has(id) || (id === localId && !this.showLocal)) {
        lamp.dispose();
        this.lamps.delete(id);
      }
    }

    // Every enemy the game spawns is a Hollow, so every enemy is drawn as one:
    // there is no other shape to give an entity that can still collide. A
    // shade, a lunge or a Hollow stepping out comes in from nothing over
    // SHADE_FADE_IN_S (the shadow's look, haunt.ts); the rest stand at once.
    this.shadeList.length = 0;
    {
      const me = state.players.get(localId);
      this.reachAt = me === undefined ? null : new Vector3(me.pos.x, me.pos.y - PLAYER_HALF.y + PLAYER_HALF.y + PLAYER_EYE_OFFSET, me.pos.z);
    }
    for (const [id, enemy] of state.enemies) {
      const feet = enemy.pos.y - ENEMY_HALF.y;
      let fade = this.fades.get(id);
      if (fade === undefined) {
        const comesIn = enemy.ai === AiState.Shade || enemy.ai === AiState.Lunge || enemy.ai === AiState.Strike || enemy.ai === AiState.Emerge;
        // A shade, and the Hollow stepping out at the crest, come up out of the ground; a lunge quick; the rest stand at once.
        const shade = enemy.ai === AiState.Shade || enemy.ai === AiState.Lunge || enemy.ai === AiState.Strike || enemy.ai === AiState.Emerge;
        const quick = enemy.ai === AiState.Lunge || enemy.ai === AiState.Strike;
        // The Hollow stepping out at the crest, in the summit scene, waits SUMMIT_RISE_DELAY_S before it
        // rises: the scene's arrival and find come first. A fork's Hollow steps out in the same state in
        // the chase, and rises at once: held, it would reach its player before it had drawn.
        fade = { level: comesIn ? 0 : 1, ai: enemy.ai, rise: shade ? 0 : 1, settle: shade && !quick ? 0 : 1, quick, delay: enemy.ai === AiState.Emerge && state.phase === Phase.Scene ? SUMMIT_RISE_DELAY_S : 0 };
        this.fades.set(id, fade);
      }
      fade.ai = enemy.ai;
      // The held wait spends the frame first; what is left of it begins the rise, so the rise is not a frame late.
      let step = dt;
      if (fade.delay > 0) {
        const held = Math.min(fade.delay, step);
        fade.delay -= held;
        step -= held;
      }
      if (fade.rise < 1 || fade.settle < 1) {
        // A shade comes up out of the ground to its height over SHADE_RISE_S,
        // as if out of the mist, at half its opacity by then, and settles to
        // its whole over SHADE_SETTLE_S after.
        if (step > 0 && fade.rise < 1) fade.rise = Math.min(1, fade.rise + step / (fade.quick ? LUNGE_RISE_S : SHADE_RISE_S));
        else if (step > 0) fade.settle = Math.min(1, fade.settle + step / SHADE_SETTLE_S);
        fade.level = fade.quick ? risen(fade.rise) : 0.5 * risen(fade.rise) + 0.5 * fade.settle;
      } else if (step > 0 && fade.level < 1) fade.level = Math.min(1, fade.level + step / SHADE_FADE_IN_S);
      // A lunge resolves from the mist as it closes on the local eye; a shade
      // never does; a Hollow out in the open is the resolved form from the
      // start, the same black figure with the dulled eyes.
      if (enemy.ai === AiState.Shade || enemy.ai === AiState.Lunge || enemy.ai === AiState.Strike) {
        const me = state.players.get(localId);
        const d = me === undefined ? Infinity : Math.hypot(enemy.pos.x - me.pos.x, enemy.pos.z - me.pos.z);
        const want = (enemy.ai === AiState.Lunge || enemy.ai === AiState.Strike) && d < SHADE_RESOLVE_M ? 0 : 1;
        const was = this.soft.get(id) ?? 1;
        const soft = dt > 0 ? was + (want - was) * Math.min(1, dt / SHADE_RESOLVE_S) : was;
        this.soft.set(id, soft);
        // Fainter with distance: whole within SHADE_NEAR_M, SHADE_FAR_SHARE of itself at SHADE_FAR_M.
        const t = Math.max(0, Math.min(1, (d - SHADE_NEAR_M) / (SHADE_FAR_M - SHADE_NEAR_M)));
        this.near.set(id, 1 - (1 - SHADE_FAR_SHARE) * t);
      } else { this.soft.set(id, 0); this.near.set(id, 1); }
      const instance = this.models.acquire(id, HOLLOW_MODEL);
      if (instance !== null) {
        const entry = this.ensureHollowModel(id, instance, enemy.pos.x, feet, enemy.pos.z);
        this.enemies.get(id)?.node.setEnabled(false);
        this.advance(entry.view, enemy.pos.x, feet, enemy.pos.z, clamped);
        // Every Hollow and shade is drawn facing the local player, whatever
        // way the sim has it going: the figure, and its head with it, is
        // always turned to whoever is looking at it.
        entry.view.node.rotation.y = this.facingOf(state, localId, enemy.pos.x, enemy.pos.z, enemy.yaw);
        entry.instance.root.scaling.y = HOLLOW_SCALE * risen(fade.rise);
        if (this.softShades && this.soft.has(id)) {
          const soft = this.soft.get(id) as number;
          this.shadeList.push({ node: entry.view.node, fade: fade.level, soft, near: this.near.get(id) ?? 1, gone: 0, eyes: entry.eyes, eyeLevel: eyeLevelOf(soft, fade.level) });
        }
        else setVisibility(entry.view.node, fade.level);
        // Enemy velocity never reaches a client (it is zeroed there), so the
        // pace is measured from how far the drawn body moved: the same on
        // every peer, and it walks through Emerge as well as the hunt.
        const pace = entry.pace;
        const at = entry.view.node.position;
        if (dt > 0) {
          const dx = at.x - pace.x;
          const dz = at.z - pace.z;
          // Capped so a jump (a respawn, a snapshot catching up) reads as a
          // brisk stride for a moment, not a full-rate walk for over a second.
          const raw = Math.sqrt(dx * dx + dz * dz) / dt;
          const measured = raw > HOLLOW_MAX_MEASURED_SPEED ? HOLLOW_MAX_MEASURED_SPEED : raw;
          pace.speed += (measured - pace.speed) * (1 - Math.exp(-dt / HOLLOW_SPEED_SMOOTHING));
        }
        pace.x = at.x;
        pace.z = at.z;
        // A strike stands in the idle with its arms out (the reach, below); everything else walks or stands by its pace.
        if (enemy.ai === AiState.Strike) instance.play("idle");
        else stride(instance, pace.speed, HOLLOW_WALK_CLIP_SPEED * HOLLOW_SCALE);
        // The reach: in the strike, and in a lunge's last metres.
        const meFor = state.players.get(localId);
        const dFor = meFor === undefined ? Infinity : Math.hypot(enemy.pos.x - meFor.pos.x, enemy.pos.z - meFor.pos.z);
        const wantReach = enemy.ai === AiState.Strike || (enemy.ai === AiState.Lunge && dFor < REACH_M) ? 1 : 0;
        const hadReach = this.reaches.get(id) ?? 0;
        this.reaches.set(id, dt > 0 ? hadReach + Math.max(-dt / REACH_S, Math.min(dt / REACH_S, wantReach - hadReach)) : hadReach);
        continue;
      }

      // The capsule is taller than the hull: lift it so both stand on the same feet.
      const hollowY = feet + HOLLOW_HEIGHT / 2;
      const view = this.ensure(
        this.enemies,
        id,
        { x: enemy.pos.x, y: hollowY, z: enemy.pos.z },
        () => this.makeHollow(`hollow_${id}`),
      );
      view.node.setEnabled(true);
      this.advance(view, enemy.pos.x, hollowY, enemy.pos.z, clamped);
      view.node.rotation.y = this.facingOf(state, localId, enemy.pos.x, enemy.pos.z, enemy.yaw);
      setVisibility(view.node, fade.level);
    }
    // A shade or a lunge gone from the state goes out to nothing over
    // SHADE_FADE_OUT_S: its model is held back from the prune until then.
    for (const [id, fade] of this.fades) {
      if (state.enemies.has(id)) continue;
      const entry = this.enemyModels.get(id);
      if (entry !== undefined && (fade.ai === AiState.Shade || fade.ai === AiState.Lunge || fade.ai === AiState.Strike)) {
        this.enemyModels.delete(id);
        this.fading.set(id, { entry, level: fade.level, rise: fade.rise, soft: this.soft.get(id) ?? 1, near: this.near.get(id) ?? 1 });
      }
      this.fades.delete(id);
      this.soft.delete(id);
      this.near.delete(id);
      this.reaches.delete(id);
    }
    for (const [id, out] of this.fading) {
      // Going, it is a shade again first: a resolved lunge goes back into
      // the mist over SHADE_UNRESOLVE_S as it fades, not out of the frame.
      if (dt > 0) {
        out.level -= dt / SHADE_FADE_OUT_S;
        out.soft = Math.min(1, out.soft + dt / SHADE_UNRESOLVE_S);
      }
      // It keeps its height: the going is the grade's, patch by patch, by `gone`.
      out.entry.instance.root.scaling.y = HOLLOW_SCALE * risen(out.rise);
      if (out.level <= 0) {
        this.models.release(id);
        this.fading.delete(id);
        continue;
      }
      if (this.softShades) this.shadeList.push({ node: out.entry.view.node, fade: out.level, soft: out.soft, near: out.near, gone: 1 - out.level, eyes: out.entry.eyes, eyeLevel: eyeLevelOf(out.soft, out.level) });
      else setVisibility(out.entry.view.node, out.level);
    }
    this.pruneModels(this.enemyModels, state.enemies);
    this.prune(this.enemies, state.enemies);
  }

  /** How many enemies are fading out, for the tests. */
  fadingOut(): number {
    return this.fading.size;
  }

  /** This frame's shades for the silhouette mask, when `softShades`. */
  shades(): readonly ShadeEntry[] {
    return this.shadeList;
  }

  private ensureModel(
    map: Map<number, ModelView>,
    id: number,
    instance: CharacterInstance,
    x: number,
    y: number,
    z: number,
  ): ModelView {
    const existing = map.get(id);
    if (existing !== undefined && existing.instance === instance) return existing;
    const entry = { instance, view: placeView(instance.root, x, y, z) };
    map.set(id, entry);
    return entry;
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
    for (const [id, reach] of this.reaches) {
      if (reach <= 0) continue;
      const entry = this.enemyModels.get(id);
      if (entry === undefined) continue;
      for (const arm of entry.arms) {
        EntityViews.aimBone(arm.shoulder, arm.elbow, at, reach);
        EntityViews.aimBone(arm.elbow, arm.wrist, at, reach);
      }
    }
  }

  /** The yaw that turns a figure at (x, z) to the local player's position, or the sim's yaw when there is no local player. */
  private facingOf(state: WorldState, localId: number, x: number, z: number, fallback: number): number {
    const me = state.players.get(localId);
    if (me === undefined) return fallback;
    return Math.atan2(me.pos.x - x, me.pos.z - z);
  }

  private ensureHollowModel(
    id: number,
    instance: CharacterInstance,
    x: number,
    y: number,
    z: number,
  ): HollowView {
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
    const entry = { instance, view: placeView(instance.root, x, y, z), pace: { x, z, speed: 0 }, eyes, arms };
    this.enemyModels.set(id, entry);
    return entry;
  }

  private ensure(map: Map<number, View>, id: number, at: Vec3, make: () => Mesh): View {
    const existing = map.get(id);
    if (existing) return existing;
    const view = placeView(make(), at.x, at.y, at.z);
    map.set(id, view);
    return view;
  }

  private advance(view: View, x: number, y: number, z: number, alpha: number): void {
    if (view.target.x !== x || view.target.y !== y || view.target.z !== z) {
      view.previous.copyFrom(view.target);
      view.target.set(x, y, z);
    }
    Vector3.LerpToRef(view.previous, view.target, alpha, view.node.position);
  }

  private prune(map: Map<number, View>, live: Map<number, unknown>): void {
    for (const [id, view] of map) {
      if (!live.has(id)) {
        view.node.dispose();
        map.delete(id);
      }
    }
  }

  private pruneModels(map: Map<number, ModelView>, live: Map<number, unknown>): void {
    for (const id of map.keys()) {
      if (!live.has(id)) {
        this.models.release(id);
        map.delete(id);
      }
    }
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
    this.fading.clear();
    this.fades.clear();
    for (const view of this.players.values()) view.node.dispose();
    for (const view of this.enemies.values()) view.node.dispose();
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
