import { clamp01 } from "./colour.js";
import { WALK_SPEED } from "../sim/constants.js";

/**
 * The pure arithmetic of the walking cue. Babylon-free and on the architecture
 * test's BABYLON_FREE_FILES list; `renderer.ts` is the shell that applies it —
 * the `stylizeParams.ts` / `stylize.ts` split, repeated.
 *
 * This exists because the ground got *too* smooth. Once collision became the
 * continuous elevation field (`sim/ground.ts`), the eye tracked the surface
 * exactly and gliding along it read as floating: correct, and lifeless. What
 * was missing was footfall.
 *
 * Strictly a view effect. Interact resolves in the sim from `player.pos` plus
 * PLAYER_EYE_OFFSET and the player's own yaw and pitch (`sim/view.ts`), so
 * nothing here can move what the player reaches for — the eye moves under a
 * ray that stays honest. Nothing here reaches the simulation at all, so
 * determinism is untouched and two peers may run different scales.
 */

/** Metres of ground covered per full stride cycle — two footfalls. */
export const STRIDE_LENGTH = 3;
/** Peak dip of the eye, in metres. */
export const BOB_VERTICAL = 0.05;
/** Peak sideways travel of the eye, in metres. */
export const BOB_LATERAL = 0.03;
/** Peak roll, in radians — about 0.6°, felt rather than seen. */
export const BOB_ROLL = 0.0105;
/**
 * Seconds for the stride amplitude to close ~63% of the gap to its target.
 * Short enough that starting to walk feels immediate, long enough that
 * stopping settles instead of snapping.
 */
export const AMPLITUDE_TAU = 0.12;
/** Metres of extra dip per m/s of impact speed when landing. */
export const LANDING_DIP_PER_SPEED = 0.012;
/** Ceiling on that dip, so a fall from any height cannot bury the camera. */
export const LANDING_DIP_MAX = 0.12;
/** Seconds for the landing dip to decay by ~63%; gone inside a third of a second. */
export const LANDING_TAU = 0.09;

/**
 * The tuned scale, and so the value `/bob` omits from the URL.
 *
 * Half strength: an unhurried walk should be understated, because the cue is
 * there to say your feet are on the ground, not to announce itself. Sprinting
 * is what reaches the full amplitude.
 */
export const DEFAULT_BOB_SCALE = 0.5;
/**
 * What holding sprint multiplies the stride strength by. Two, so the shipped
 * default of 0.5 lands on exactly 1 — the full tuned amplitude — while a player
 * who has turned `/bob` up or down keeps their own ratio instead of being
 * overridden to a fixed number.
 *
 * Applied to the *eased* target rather than on top of it, so pressing sprint
 * ramps over AMPLITUDE_TAU instead of stepping the amplitude in one frame.
 *
 * Sprint currently changes nothing else: `Button.Sprint` is bound in `input.ts`
 * and rides the wire, but `sim/movement.ts` reads only Button.Jump, so this is
 * a view difference and not yet a movement one.
 */
export const SPRINT_BOB_MULTIPLIER = 2;
/** Ceiling accepted by `/bob`. Three times the tuned amplitude is already
 * seasick; beyond that is a bug report, not a preference. */
export const MAX_BOB_SCALE = 3;

const TWO_PI = Math.PI * 2;

export type BobSample = {
  /** Hull centre, world space. */
  x: number;
  z: number;
  /** Horizontal speed, m/s. */
  speed: number;
  /** Vertical velocity, m/s; negative is falling. */
  velY: number;
  grounded: boolean;
  /** Whether sprint is held — `input.ts` owns the binding. */
  sprinting: boolean;
};

export type BobOffset = {
  /** Vertical eye offset in metres. Never positive — the eye only ever dips. */
  dy: number;
  /** Lateral eye offset in metres, along the camera's right vector. */
  dx: number;
  /** Camera roll in radians. */
  roll: number;
};

export type ViewBob = {
  /** Advances the stride by this frame's motion and returns the eye offset. */
  update(sample: BobSample, dt: number): BobOffset;
  /** 0 disables the effect entirely; 1 is the tuned default. */
  setScale(scale: number): void;
  /** Drops the remembered position and phase — for teleports and respawns. */
  reset(): void;
};

/** Frame-rate independent approach fraction for an exponential ease. */
function easeFraction(dt: number, tau: number): number {
  return 1 - Math.exp(-dt / tau);
}

export function createViewBob(initialScale = DEFAULT_BOB_SCALE): ViewBob {
  let scale = Math.max(0, initialScale);
  /** Position in the stride, in cycles, wrapped to [0, 1). */
  let phase = 0;
  /** Eased stride strength: 0 to 1 walking, up to SPRINT_BOB_MULTIPLIER sprinting. */
  let amplitude = 0;
  /** Landing dip in metres, positive, decaying. */
  let dip = 0;
  let prevX = 0;
  let prevZ = 0;
  let placed = false;
  let wasGrounded = true;
  /** Descent speed seen on the previous airborne frame — the impact speed. */
  let descent = 0;

  return {
    update(sample, dt) {
      if (!placed) {
        // The first sample only says where we are. Advancing the stride by the
        // distance from an arbitrary origin would read a teleport as a sprint.
        prevX = sample.x;
        prevZ = sample.z;
        placed = true;
        wasGrounded = sample.grounded;
      }

      const dx = sample.x - prevX;
      const dz = sample.z - prevZ;
      prevX = sample.x;
      prevZ = sample.z;

      // Landing is read before `descent` is refreshed: by the time `grounded`
      // turns true the sim has already zeroed vel.y, so the impact speed only
      // survives as the value carried from the previous frame.
      if (sample.grounded && !wasGrounded) {
        dip = Math.min(LANDING_DIP_MAX, descent * LANDING_DIP_PER_SPEED);
      }
      descent = sample.grounded ? 0 : Math.max(0, -sample.velY);
      wasGrounded = sample.grounded;

      // Phase advances with ground covered rather than with time, so cadence
      // tracks speed for free and a stuttering frame rate cannot change it.
      if (sample.grounded) {
        phase = (phase + Math.sqrt(dx * dx + dz * dz) / STRIDE_LENGTH) % 1;
      }

      const effort = sample.sprinting ? SPRINT_BOB_MULTIPLIER : 1;
      const target = sample.grounded ? clamp01(sample.speed / WALK_SPEED) * effort : 0;
      amplitude += (target - amplitude) * easeFraction(dt, AMPLITUDE_TAU);
      dip *= Math.exp(-dt / LANDING_TAU);

      // Capped rather than left to multiply out: `/bob 3` while sprinting would
      // otherwise reach six times the tuned dip, which is a faceplant, not a
      // preference.
      const strength = Math.min(amplitude * scale, MAX_BOB_SCALE);
      const angle = TWO_PI * phase;
      // Vertical runs at twice the stride frequency — one dip per footfall —
      // and is shaped so it only ever subtracts. Lateral and roll run at the
      // stride frequency: one weight shift per cycle, peaking on each footfall.
      return {
        dy: (-BOB_VERTICAL * strength * (1 - Math.cos(2 * angle))) / 2 - dip * scale,
        dx: BOB_LATERAL * strength * Math.sin(angle),
        roll: BOB_ROLL * strength * Math.sin(angle),
      };
    },

    setScale(next) {
      scale = Math.max(0, next);
    },

    reset() {
      phase = 0;
      amplitude = 0;
      dip = 0;
      placed = false;
      descent = 0;
      wasGrounded = true;
    },
  };
}
