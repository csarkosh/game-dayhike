/**
 * Where the hikers' bodies and the Hollows stand in a frame, and how: each
 * one's place between its last two ticks, the way it faces, the clip it
 * plays and how fast, where its eyes are and where they look, whether its
 * lamp is lit; and for a Hollow how far in from the mist it is, how soft,
 * how faint with distance, how far its arms have turned out, and the level
 * of its eyes. Plain arithmetic on the simulation's state, with no engine:
 * a renderer hands it the state each frame and draws what it says, with
 * whatever it has to draw a body with.
 *
 * What it cannot know is whether a body's model has loaded, which is the
 * renderer's to say (`modelled`): a model stands on its feet and a capsule,
 * drawn until the model lands and for good where it never does, on its
 * middle, so the two are placed apart and each keeps its own track.
 */
import { PLAYER_EYE_OFFSET, PLAYER_HALF, TELEPORT_M } from "../sim/constants.js";
import { ENEMY_HALF } from "../sim/dayhikeConstants.js";
import { HOLLOW_HEIGHT } from "../sim/hollow.js";
import { AiState, Phase, type WorldState } from "../sim/types.js";
import { aimDirection } from "../sim/view.js";
import { variantForId } from "./characterAssets.js";
import { HOLLOW_EYE_INTENSITY, HOLLOW_SCALE, HOLLOW_WALK_CLIP_SPEED, RANGER_WALK_CLIP_SPEED } from "./hollowLook.js";

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
/** Every model the hikers and the Hollows are drawn with. */
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

/**
 * Seconds a shade, or a Hollow stepping out, takes to come in from nothing,
 * and a lunge, which has metres to cover; and a shade or a lunge to go out.
 * Coming and going alike are the smoke's (lite/shadeMask.ts): the figure stands
 * at its whole height throughout and comes up out of the mist, or goes back
 * into it, patch by patch (2026-10-20; before, it grew up out of the ground
 * over 2.4 s, a lunge over 1.2).
 */
export const SHADE_FADE_IN_S = 2.4;
export const LUNGE_FADE_IN_S = 1.2;
export const SHADE_FADE_OUT_S = 2.6;
/** The figure's opacity in the mask over how far in it is: whole by a third of the way, so the smoke, not a fade, is what brings it in. */
export const SHADE_OPACITY_GAIN = 3;
/** Seconds the Hollow stepping out at the crest, in the summit scene, waits before it comes in: the scene's first two shots and the reveal's first beat, the camera on its spot by then (cutscene.ts SUMMIT_RISE_AT_S). The chase's fork Hollows step out in the same state and never wait. */
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
/** Metres within which a shade is whole in the mask, the metres at which it is SHADE_FAR_SHARE of itself, and that share. Whole to 20 m since the climb's shades stand 15 to 20 m off the trail (2026-10-20; 10 and 40 m before, when they stood from 7 m). */
export const SHADE_NEAR_M = 20;
export const SHADE_FAR_M = 50;
export const SHADE_FAR_SHARE = 0.35;

/**
 * The reach: a lunge within REACH_M of the local eye, and the strike, hold
 * both arms out straight at the player's eyes, as if to take hold, the arms
 * turned from the idle's over REACH_S and back as fast.
 */
export const REACH_M = 6;
export const REACH_S = 0.35;

/** How far in a figure is when its eyes begin to come, and they are whole with it: the smoke brings the lower body first, so the eyes come last, with the head, and on the way out go first. */
export const SHADE_EYES_FROM = 0.7;

/**
 * The eyes' level on the frame: the real one's dulled glow, a shade's fainter, by the softness
 * between, and how far in the figure is, from SHADE_EYES_FROM. The level is the eye meshes' alpha,
 * and they glow at HOLLOW_EYE_INTENSITY, so the alpha is the level over that: never a glow that
 * saturates while the body is a veil, nor eyes in the mist before the head they are in.
 */
export function eyeLevelOf(soft: number, presence: number): number {
  const t = Math.max(0, Math.min(1, (presence - SHADE_EYES_FROM) / (1 - SHADE_EYES_FROM)));
  return ((SHADE_EYES_SHADE * soft + SHADE_EYES_DULL * (1 - soft)) * t * t * (3 - 2 * t)) / HOLLOW_EYE_INTENSITY;
}

/** The figure's opacity in the mask for how far in it is, 0 to 1. */
export function opacityOf(presence: number): number {
  return Math.max(0, Math.min(1, presence * SHADE_OPACITY_GAIN));
}

/** The clip a walking or a standing character plays. */
export type StrideClip = "idle" | "walk";
/** A clip and its playback rate. */
export type Stride = { clip: StrideClip; rate: number };

/** Walk or stand, and at what rate, for a character moving at `speed` m/s whose walk clip covers `clipSpeed` at rate 1; into `out`. */
export function strideFor(speed: number, clipSpeed: number, out: Stride): Stride {
  if (speed > WALK_THRESHOLD) {
    const ratio = speed / clipSpeed;
    out.rate = ratio < WALK_RATIO_MIN ? WALK_RATIO_MIN : ratio > WALK_RATIO_MAX ? WALK_RATIO_MAX : ratio;
    out.clip = "walk";
  } else {
    out.rate = 1;
    out.clip = "idle";
  }
  return out;
}

/**
 * A drawn thing's place between ticks: where it last stood, where it stands,
 * and where this frame draws it.
 *
 * Its first frame is drawn where the entity is, not on the way there: the
 * place before only moves when the place now does, so a track whose two
 * points started at the origin stayed a fraction of the way from the origin
 * to the entity for as long as it stood still: a player who joined and did
 * not walk was drawn hundreds of metres away until their first step.
 */
export type Track = { px: number; py: number; pz: number; tx: number; ty: number; tz: number; x: number; y: number; z: number };

export function placeTrack(x: number, y: number, z: number): Track {
  return { px: x, py: y, pz: z, tx: x, ty: y, tz: z, x, y, z };
}

/** Moves `track` to (x, y, z) where that is new, and draws it `alpha` of the way from its place before. */
export function advanceTrack(track: Track, x: number, y: number, z: number, alpha: number): void {
  if (track.tx !== x || track.ty !== y || track.tz !== z) {
    track.px = track.tx;
    track.py = track.ty;
    track.pz = track.tz;
    track.tx = x;
    track.ty = y;
    track.tz = z;
    // A jump no walk makes (a return to the crest): drawn where it lands, not sliding there.
    const dx = track.px - track.tx;
    const dy = track.py - track.ty;
    const dz = track.pz - track.tz;
    if (dx * dx + dy * dy + dz * dz > TELEPORT_M * TELEPORT_M) {
      track.px = track.tx;
      track.py = track.ty;
      track.pz = track.tz;
    }
  }
  track.x = track.px + (track.tx - track.px) * alpha;
  track.y = track.py + (track.ty - track.py) * alpha;
  track.z = track.pz + (track.tz - track.pz) * alpha;
}

/** A clip's time as a renderer with no animation system of its own counts it. */
export type ClipClock = { clip: string; seconds: number; rate: number };

/**
 * A frame of `clock`: a clip newly asked for starts at its beginning, and the
 * one playing runs on by `dt` at its rate. `rate` null leaves the rate as it
 * was (a pose that names a clip and no pace).
 */
export function stepClip(clock: ClipClock, clip: string, rate: number | null, dt: number): void {
  if (rate !== null) clock.rate = rate;
  if (clock.clip !== clip) {
    clock.clip = clip;
    clock.seconds = 0;
  }
  clock.seconds += dt * clock.rate;
}

/** A hiker in a frame. */
export type PlayerPose = {
  id: number;
  local: boolean;
  /**
   * Why no body is drawn, or null for one that is: `lens`, the local player,
   * who is the camera (their body would fill the screen from the inside; in
   * a scene the camera is elsewhere and the body stands in the shot); `car`,
   * a hiker within the end scene's hiding radius, who is in the car.
   */
  hidden: "lens" | "car" | null;
  /** The ranger worn. */
  model: string;
  /** Drawn as its model; else as the capsule. */
  modelled: boolean;
  /** Where the body stands: a model's feet, a capsule's middle. For a hidden one, where the player's feet are. */
  x: number;
  y: number;
  z: number;
  yaw: number;
  /** A modelled body's clip and rate. */
  clip: StrideClip;
  rate: number;
  /** Where the eyes are, whichever body is drawn, and the way they look. */
  eyeX: number;
  eyeY: number;
  eyeZ: number;
  aimX: number;
  aimY: number;
  aimZ: number;
  lampOn: boolean;
};

/** A figure for the silhouette mask (`lite/shadeMask.ts`): its opacity there, how far in it is, how soft, how near, and its eyes' level on the frame. */
export type ShadeLook = { fade: number; presence: number; soft: number; near: number; eyeLevel: number };

/** A Hollow in a frame: every enemy the game spawns is one, shade and lunge included. */
export type HollowPose = {
  id: number;
  modelled: boolean;
  /** Drawn as one of the crowd's shadows this frame (`EntityPoses.shadows`), not as the model: the renderer's cards stand where the pose is. */
  shadow: boolean;
  /** Where it stands: a model's feet, a capsule's middle. */
  x: number;
  y: number;
  z: number;
  /** Turned to the local player, whatever way the simulation has it going. */
  yaw: number;
  /** How far in it is, 0 to 1: a capsule's visibility. */
  level: number;
  /** A modelled one's place in the mask. */
  shade: ShadeLook;
  /** A modelled one's clip; its rate, or null where the clip's rate is left as it was (the strike's idle). */
  clip: StrideClip;
  rate: number | null;
  /** How far its arms are turned out at the local player, 0 to 1. */
  reach: number;
};

/** A shade or a lunge gone from the state, going out where it last stood. */
export type FadingPose = { id: number; x: number; y: number; z: number; yaw: number; shade: ShadeLook };

/** What a renderer tells of the bodies it draws. */
export type EntityModels = {
  /** Whether player `id`'s body is drawn as `model` this frame: false while the model has not loaded, or never will. */
  player(id: number, model: string): boolean;
  /** Whether enemy `id` is drawn as the Hollow's model. */
  hollow(id: number): boolean;
};

export type EntityFrame = {
  /** Every player in the state, in its order. */
  players: readonly PlayerPose[];
  /** Players gone since the last frame that had a model's track, and those that had a capsule's. */
  playersGone: readonly number[];
  capsulesGone: readonly number[];
  /** Every enemy in the state, in its order. */
  hollows: readonly HollowPose[];
  /** The modelled shades and lunges going out, oldest first. */
  fading: readonly FadingPose[];
  /** Enemies whose model is let go this frame: gone and not going out, or gone out. */
  hollowsGone: readonly number[];
  hollowCapsulesGone: readonly number[];
  /** The local player's eyes, which the reaching arms aim at; null with no local player. */
  reachAt: { x: number; y: number; z: number } | null;
};

type Fade = { level: number; ai: number; quick: boolean; delay: number };
type Pace = { x: number; z: number; speed: number };
type HollowTrack = { track: Track; pace: Pace; yaw: number };

export type EntityPoses = {
  /** Whether the local player's own body is drawn: a scene's camera stands elsewhere. */
  showLocal: boolean;
  /** In the end scene, every other body within `radius` of this point (the car's door) is hidden: it is in the car. */
  hideNear: { x: number; z: number; radius: number } | null;
  /**
   * Whether the chase's enemies are drawn as the crowd's shadows (the
   * renderer's cards, crowdKillers.ts) and not as the model: while it is so,
   * every enemy's pose in the chase says `shadow`, and one gone from the
   * state is not left going out as the model.
   */
  shadows: boolean;
  /**
   * A frame. `dt` is the frame's seconds, from which a Hollow's pace, its
   * fades and its reach are stepped; 0 leaves them where they were. The
   * lists handed back are reused by the next call.
   */
  step(state: WorldState, localId: number, alpha: number, dt: number, models: EntityModels): EntityFrame;
  /** The track of player `id`'s model, placed at (x, y, z) where it has none: for a renderer that stands the body somewhere of its own. */
  modelTrack(id: number, x: number, y: number, z: number): Track;
  /** Forgets player `id`'s model's track: the body is placed anew when next drawn. */
  forgetModel(id: number): void;
  /** Where player `id`'s body is drawn this frame: between its last two places, at its feet. Null for a player with no body drawn. One reused object. */
  drawnAt(id: number): { x: number; y: number; z: number } | null;
  /** Each enemy's reach, 0 to 1, by its id. */
  reaches(): ReadonlyMap<number, number>;
  /** How many enemies are going out. */
  fadingOut(): number;
  /** Forgets every track and fade. */
  clear(): void;
};

function emptyShade(): ShadeLook {
  return { fade: 0, presence: 0, soft: 0, near: 1, eyeLevel: 0 };
}

export function createEntityPoses(): EntityPoses {
  const playerModels = new Map<number, Track>();
  const playerCapsules = new Map<number, Track>();
  const hollowModels = new Map<number, HollowTrack>();
  const hollowCapsules = new Map<number, Track>();
  /** Each enemy's fade, 0 to 1, and the state it was last seen in: a shade, a lunge or a Hollow stepping out comes in from nothing, and a shade or a lunge goes out to nothing after it is gone. */
  const fades = new Map<number, Fade>();
  /** Each shade's softness: 1 a blur in the mist, 0 the Hollow; a lunge resolves as it closes on the local eye. */
  const soft = new Map<number, number>();
  const near = new Map<number, number>();
  const reaches = new Map<number, number>();
  /** The enemies last drawn as shadows (`EntityPoses.shadows`). */
  const shadowed = new Set<number>();
  /** Shades gone from the state, going out: held until the fade ends. */
  const fading = new Map<number, { at: HollowTrack; level: number; soft: number; near: number }>();

  const players: PlayerPose[] = [];
  const hollows: HollowPose[] = [];
  const fadingList: FadingPose[] = [];
  const playersGone: number[] = [];
  const capsulesGone: number[] = [];
  const hollowsGone: number[] = [];
  const hollowCapsulesGone: number[] = [];
  const reachEye = { x: 0, y: 0, z: 0 };
  const stride: Stride = { clip: "idle", rate: 1 };
  const drawn = { x: 0, y: 0, z: 0 };
  const frame: EntityFrame = { players, playersGone, capsulesGone, hollows, fading: fadingList, hollowsGone, hollowCapsulesGone, reachAt: null };

  function playerAt(n: number): PlayerPose {
    let pose = players[n];
    if (pose === undefined) {
      pose = {
        id: 0, local: false, hidden: null, model: "", modelled: false, x: 0, y: 0, z: 0, yaw: 0, clip: "idle", rate: 1,
        eyeX: 0, eyeY: 0, eyeZ: 0, aimX: 0, aimY: 0, aimZ: 1, lampOn: false,
      };
      players[n] = pose;
    }
    return pose;
  }
  function hollowAt(n: number): HollowPose {
    let pose = hollows[n];
    if (pose === undefined) {
      pose = { id: 0, modelled: false, shadow: false, x: 0, y: 0, z: 0, yaw: 0, level: 1, shade: emptyShade(), clip: "idle", rate: 1, reach: 0 };
      hollows[n] = pose;
    }
    return pose;
  }
  function fadingAt(n: number): FadingPose {
    let pose = fadingList[n];
    if (pose === undefined) {
      pose = { id: 0, x: 0, y: 0, z: 0, yaw: 0, shade: emptyShade() };
      fadingList[n] = pose;
    }
    return pose;
  }
  function ensure(map: Map<number, Track>, id: number, x: number, y: number, z: number): Track {
    let track = map.get(id);
    if (track === undefined) {
      track = placeTrack(x, y, z);
      map.set(id, track);
    }
    return track;
  }
  /** The ids of `map` not in `live`, into `gone`, and out of `map`. */
  function prune<T>(map: Map<number, T>, live: ReadonlyMap<number, unknown>, gone: number[]): void {
    for (const id of map.keys()) {
      if (!live.has(id)) {
        gone.push(id);
        map.delete(id);
      }
    }
  }

  const poses: EntityPoses = {
    showLocal: false,
    hideNear: null,
    shadows: false,
    step(state, localId, alpha, dt, models) {
      const clamped = alpha < 0 ? 0 : alpha > 1 ? 1 : alpha;
      let n = 0;
      for (const [id, player] of state.players) {
        const pose = playerAt(n++);
        pose.id = id;
        pose.local = id === localId;
        pose.model = variantForId(RANGER_IDS, id) as string;
        pose.modelled = false;
        pose.yaw = player.yaw;
        pose.lampOn = player.lamp.on;
        // The model's origin is at its feet (ARCHITECTURE.md, Model
        // conventions), the sim's position at the centre of the hull.
        const feet = player.pos.y - PLAYER_HALF.y;
        if (id === localId && !poses.showLocal) {
          pose.hidden = "lens";
          pose.x = player.pos.x;
          pose.y = feet;
          pose.z = player.pos.z;
          continue;
        }
        const car = poses.hideNear;
        if (car !== null && id !== localId && Math.hypot(player.pos.x - car.x, player.pos.z - car.z) <= car.radius) {
          pose.hidden = "car";
          pose.x = player.pos.x;
          pose.y = feet;
          pose.z = player.pos.z;
          continue;
        }
        pose.hidden = null;
        let feetY: number;
        if (models.player(id, pose.model)) {
          const track = ensure(playerModels, id, player.pos.x, feet, player.pos.z);
          advanceTrack(track, player.pos.x, feet, player.pos.z, clamped);
          // Sprint reuses the walk clip, played faster; `vel` is on the wire,
          // so every peer sees the same stride.
          strideFor(Math.sqrt(player.vel.x * player.vel.x + player.vel.z * player.vel.z), RANGER_WALK_CLIP_SPEED, stride);
          pose.modelled = true;
          pose.clip = stride.clip;
          pose.rate = stride.rate;
          pose.x = track.x;
          pose.y = track.y;
          pose.z = track.z;
          feetY = track.y;
        } else {
          const track = ensure(playerCapsules, id, player.pos.x, player.pos.y, player.pos.z);
          advanceTrack(track, player.pos.x, player.pos.y, player.pos.z, clamped);
          pose.x = track.x;
          pose.y = track.y;
          pose.z = track.z;
          feetY = track.y - PLAYER_HALF.y;
        }
        const aim = aimDirection(player.yaw, player.pitch);
        pose.eyeX = pose.x;
        pose.eyeY = feetY + PLAYER_HALF.y + PLAYER_EYE_OFFSET;
        pose.eyeZ = pose.z;
        pose.aimX = aim.x;
        pose.aimY = aim.y;
        pose.aimZ = aim.z;
      }
      players.length = n;
      playersGone.length = 0;
      capsulesGone.length = 0;
      prune(playerModels, state.players, playersGone);
      prune(playerCapsules, state.players, capsulesGone);

      // Every enemy the game spawns is a Hollow, so every enemy is drawn as one:
      // there is no other shape to give an entity that can still collide. A
      // shade, a lunge or a Hollow stepping out comes in from nothing over
      // SHADE_FADE_IN_S (the shadow's look, haunt.ts); the rest stand at once.
      const me = state.players.get(localId);
      if (me === undefined) frame.reachAt = null;
      else {
        reachEye.x = me.pos.x;
        reachEye.y = me.pos.y - PLAYER_HALF.y + PLAYER_HALF.y + PLAYER_EYE_OFFSET;
        reachEye.z = me.pos.z;
        frame.reachAt = reachEye;
      }
      n = 0;
      for (const [id, enemy] of state.enemies) {
        const pose = hollowAt(n++);
        pose.id = id;
        pose.shadow = poses.shadows && state.phase === Phase.Chase;
        if (pose.shadow) shadowed.add(id);
        else shadowed.delete(id);
        const feet = enemy.pos.y - ENEMY_HALF.y;
        let fade = fades.get(id);
        if (fade === undefined) {
          // A shade, a lunge and the Hollow stepping out come up out of the mist; a lunge quick; the rest stand at once.
          const comesIn = enemy.ai === AiState.Shade || enemy.ai === AiState.Lunge || enemy.ai === AiState.Strike || enemy.ai === AiState.Emerge;
          const quick = enemy.ai === AiState.Lunge || enemy.ai === AiState.Strike;
          // The Hollow stepping out at the crest, in the summit scene, waits SUMMIT_RISE_DELAY_S before it
          // comes in: the scene's arrival and find come first. A fork's Hollow steps out in the same state in
          // the chase, and comes in at once: held, it would reach its player before it had drawn.
          fade = { level: comesIn ? 0 : 1, ai: enemy.ai, quick, delay: enemy.ai === AiState.Emerge && state.phase === Phase.Scene ? SUMMIT_RISE_DELAY_S : 0 };
          fades.set(id, fade);
        }
        fade.ai = enemy.ai;
        // The held wait spends the frame first; what is left of it begins the coming in, so it is not a frame late.
        let step = dt;
        if (fade.delay > 0) {
          const held = Math.min(fade.delay, step);
          fade.delay -= held;
          step -= held;
        }
        // It comes up out of the mist at its whole height, the smoke bringing it in (lite/shadeMask.ts).
        if (step > 0 && fade.level < 1) fade.level = Math.min(1, fade.level + step / (fade.quick ? LUNGE_FADE_IN_S : SHADE_FADE_IN_S));
        // A lunge resolves from the mist as it closes on the local eye; a shade
        // never does; a Hollow out in the open is the resolved form from the
        // start, the same black figure with the dulled eyes.
        if (enemy.ai === AiState.Shade || enemy.ai === AiState.Lunge || enemy.ai === AiState.Strike) {
          const d = me === undefined ? Infinity : Math.hypot(enemy.pos.x - me.pos.x, enemy.pos.z - me.pos.z);
          const want = (enemy.ai === AiState.Lunge || enemy.ai === AiState.Strike) && d < SHADE_RESOLVE_M ? 0 : 1;
          const was = soft.get(id) ?? 1;
          soft.set(id, dt > 0 ? was + (want - was) * Math.min(1, dt / SHADE_RESOLVE_S) : was);
          // Fainter with distance: whole within SHADE_NEAR_M, SHADE_FAR_SHARE of itself at SHADE_FAR_M.
          const t = Math.max(0, Math.min(1, (d - SHADE_NEAR_M) / (SHADE_FAR_M - SHADE_NEAR_M)));
          near.set(id, 1 - (1 - SHADE_FAR_SHARE) * t);
        } else {
          soft.set(id, 0);
          near.set(id, 1);
        }
        // Every Hollow and shade is drawn facing the local player, whatever
        // way the sim has it going: the figure, and its head with it, is
        // always turned to whoever is looking at it.
        const facing = me === undefined ? enemy.yaw : Math.atan2(me.pos.x - enemy.pos.x, me.pos.z - enemy.pos.z);
        pose.level = fade.level;
        pose.yaw = facing;
        if (models.hollow(id)) {
          let at = hollowModels.get(id);
          if (at === undefined) {
            at = { track: placeTrack(enemy.pos.x, feet, enemy.pos.z), pace: { x: enemy.pos.x, z: enemy.pos.z, speed: 0 }, yaw: facing };
            hollowModels.set(id, at);
          }
          const track = at.track;
          advanceTrack(track, enemy.pos.x, feet, enemy.pos.z, clamped);
          at.yaw = facing;
          pose.modelled = true;
          pose.x = track.x;
          pose.y = track.y;
          pose.z = track.z;
          const softness = soft.get(id) as number;
          pose.shade.fade = opacityOf(fade.level);
          pose.shade.presence = fade.level;
          pose.shade.soft = softness;
          pose.shade.near = near.get(id) ?? 1;
          pose.shade.eyeLevel = eyeLevelOf(softness, fade.level);
          // Enemy velocity never reaches a client (it is zeroed there), so the
          // pace is measured from how far the drawn body moved: the same on
          // every peer, and it walks through Emerge as well as the hunt.
          const pace = at.pace;
          if (dt > 0) {
            const dx = track.x - pace.x;
            const dz = track.z - pace.z;
            // Capped so a jump (a respawn, a snapshot catching up) reads as a
            // brisk stride for a moment, not a full-rate walk for over a second.
            const raw = Math.sqrt(dx * dx + dz * dz) / dt;
            const measured = raw > HOLLOW_MAX_MEASURED_SPEED ? HOLLOW_MAX_MEASURED_SPEED : raw;
            pace.speed += (measured - pace.speed) * (1 - Math.exp(-dt / HOLLOW_SPEED_SMOOTHING));
          }
          pace.x = track.x;
          pace.z = track.z;
          // A strike stands in the idle with its arms out (the reach, below); everything else walks or stands by its pace.
          if (enemy.ai === AiState.Strike) {
            pose.clip = "idle";
            pose.rate = null;
          } else {
            strideFor(pace.speed, HOLLOW_WALK_CLIP_SPEED * HOLLOW_SCALE, stride);
            pose.clip = stride.clip;
            pose.rate = stride.rate;
          }
          // The reach: in the strike, and in a lunge's last metres.
          const dFor = me === undefined ? Infinity : Math.hypot(enemy.pos.x - me.pos.x, enemy.pos.z - me.pos.z);
          const wantReach = enemy.ai === AiState.Strike || (enemy.ai === AiState.Lunge && dFor < REACH_M) ? 1 : 0;
          const hadReach = reaches.get(id) ?? 0;
          const reach = dt > 0 ? hadReach + Math.max(-dt / REACH_S, Math.min(dt / REACH_S, wantReach - hadReach)) : hadReach;
          reaches.set(id, reach);
          pose.reach = reach;
          continue;
        }
        // The capsule is taller than the hull: lift it so both stand on the same feet.
        const hollowY = feet + HOLLOW_HEIGHT / 2;
        const track = ensure(hollowCapsules, id, enemy.pos.x, hollowY, enemy.pos.z);
        advanceTrack(track, enemy.pos.x, hollowY, enemy.pos.z, clamped);
        pose.modelled = false;
        pose.x = track.x;
        pose.y = track.y;
        pose.z = track.z;
        pose.reach = 0;
      }
      hollows.length = n;
      // A shade or a lunge gone from the state goes out to nothing over
      // SHADE_FADE_OUT_S: its model is held back from the prune until then.
      for (const [id, fade] of fades) {
        if (state.enemies.has(id)) continue;
        const at = hollowModels.get(id);
        // One drawn as a shadow goes as the crowd's figures go (crowdKillers.ts), never as the model.
        if (at !== undefined && !shadowed.delete(id) && (fade.ai === AiState.Shade || fade.ai === AiState.Lunge || fade.ai === AiState.Strike)) {
          hollowModels.delete(id);
          fading.set(id, { at, level: fade.level, soft: soft.get(id) ?? 1, near: near.get(id) ?? 1 });
        }
        fades.delete(id);
        soft.delete(id);
        near.delete(id);
        reaches.delete(id);
      }
      hollowsGone.length = 0;
      hollowCapsulesGone.length = 0;
      n = 0;
      for (const [id, out] of fading) {
        // Going, it is a shade again first: a resolved lunge goes back into
        // the mist over SHADE_UNRESOLVE_S as it fades, not out of the frame.
        if (dt > 0) {
          out.level -= dt / SHADE_FADE_OUT_S;
          out.soft = Math.min(1, out.soft + dt / SHADE_UNRESOLVE_S);
        }
        // It keeps its height: the going is the smoke's, patch by patch (lite/shadeMask.ts).
        if (out.level <= 0) {
          hollowsGone.push(id);
          fading.delete(id);
          continue;
        }
        const pose = fadingAt(n++);
        pose.id = id;
        pose.x = out.at.track.x;
        pose.y = out.at.track.y;
        pose.z = out.at.track.z;
        pose.yaw = out.at.yaw;
        pose.shade.fade = opacityOf(out.level);
        pose.shade.presence = out.level;
        pose.shade.soft = out.soft;
        pose.shade.near = out.near;
        pose.shade.eyeLevel = eyeLevelOf(out.soft, out.level);
      }
      fadingList.length = n;
      prune(hollowModels, state.enemies, hollowsGone);
      prune(hollowCapsules, state.enemies, hollowCapsulesGone);
      return frame;
    },
    modelTrack(id, x, y, z) {
      return ensure(playerModels, id, x, y, z);
    },
    forgetModel(id) {
      playerModels.delete(id);
    },
    drawnAt(id) {
      // A model stands on its origin; the capsule that stands in for one is placed by its middle.
      const model = playerModels.get(id);
      const track = model ?? playerCapsules.get(id);
      if (track === undefined) return null;
      drawn.x = track.x;
      drawn.y = model !== undefined ? track.y : track.y - PLAYER_HALF.y;
      drawn.z = track.z;
      return drawn;
    },
    reaches: () => reaches,
    fadingOut: () => fading.size,
    clear() {
      playerModels.clear();
      playerCapsules.clear();
      hollowModels.clear();
      hollowCapsules.clear();
      fades.clear();
      soft.clear();
      near.clear();
      reaches.clear();
      fading.clear();
      shadowed.clear();
    },
  };
  return poses;
}
