import type { Vec3, InputCommand } from "./types.js";
import { Button } from "./types.js";
import type { BoxProvider } from "./boxSource.js";
import { MAX_WALKABLE_GRADIENT, type GroundField } from "./ground.js";
import { depenetrate, sweepBox } from "./collision.js";
import {
  EPSILON,
  SKIN,
  MAX_SLIDE_ITERATIONS,
  GRAVITY,
  GROUND_SNAP_MARGIN,
  JUMP_SPEED,
  WALK_SPEED,
  SPRINT_SPEED,
  GROUND_ACCEL,
  AIR_ACCEL,
  FRICTION,
  STEP_HEIGHT,
  GROUND_NORMAL_Y,
  PLAYER_HALF,
  WADE_CHEST_DEPTH,
  WADE_FLOOR,
} from "./constants.js";

export type MoveState = { pos: Vec3; vel: Vec3; grounded: boolean };

/** yaw 0 faces +Z; increasing yaw rotates forward toward +X. */
export function wishDirection(moveX: number, moveZ: number, yaw: number): { x: number; z: number } {
  const sin = Math.sin(yaw);
  const cos = Math.cos(yaw);
  let x = moveX * cos + moveZ * sin;
  let z = -moveX * sin + moveZ * cos;
  const len = Math.sqrt(x * x + z * z);
  if (len > 1) {
    x /= len;
    z /= len;
  }
  return { x, z };
}

function applyFriction(vel: Vec3, dt: number): void {
  const speed = Math.sqrt(vel.x * vel.x + vel.z * vel.z);
  if (speed < EPSILON) {
    vel.x = 0;
    vel.z = 0;
    return;
  }
  const drop = speed * FRICTION * dt;
  const scale = Math.max(0, speed - drop) / speed;
  vel.x *= scale;
  vel.z *= scale;
}

/** Quake-style acceleration: only ever adds speed along the wish direction. */
function accelerate(
  vel: Vec3,
  dirX: number,
  dirZ: number,
  wishSpeed: number,
  accel: number,
  dt: number,
): void {
  const current = vel.x * dirX + vel.z * dirZ;
  const add = wishSpeed - current;
  if (add <= 0) return;
  const accelSpeed = Math.min(accel * wishSpeed * dt, add);
  vel.x += dirX * accelSpeed;
  vel.z += dirZ * accelSpeed;
}

export function moveAndSlide(
  pos: Vec3,
  delta: Vec3,
  half: Vec3,
  boxes: BoxProvider,
): { pos: Vec3; hitNormals: Vec3[] } {
  let p: Vec3 = { x: pos.x, y: pos.y, z: pos.z };
  let remaining: Vec3 = { x: delta.x, y: delta.y, z: delta.z };
  const hitNormals: Vec3[] = [];

  for (let i = 0; i < MAX_SLIDE_ITERATIONS; i++) {
    const hit = sweepBox(p, half, remaining, boxes);
    if (hit === null) {
      p = { x: p.x + remaining.x, y: p.y + remaining.y, z: p.z + remaining.z };
      break;
    }
    hitNormals.push(hit.normal);

    // Back off by a fixed distance, not a fixed fraction, so the gap left
    // against the surface does not scale with how fast we were moving.
    const len = Math.sqrt(
      remaining.x * remaining.x + remaining.y * remaining.y + remaining.z * remaining.z,
    );
    const backoff = len > EPSILON ? SKIN / len : 0;
    const t = Math.max(0, hit.t - backoff);

    p = { x: p.x + remaining.x * t, y: p.y + remaining.y * t, z: p.z + remaining.z * t };

    const leftover: Vec3 = {
      x: remaining.x * (1 - t),
      y: remaining.y * (1 - t),
      z: remaining.z * (1 - t),
    };
    const dot = leftover.x * hit.normal.x + leftover.y * hit.normal.y + leftover.z * hit.normal.z;
    remaining = {
      x: leftover.x - hit.normal.x * dot,
      y: leftover.y - hit.normal.y * dot,
      z: leftover.z - hit.normal.z * dot,
    };

    if (
      Math.abs(remaining.x) < EPSILON &&
      Math.abs(remaining.y) < EPSILON &&
      Math.abs(remaining.z) < EPSILON
    ) {
      break;
    }
  }

  return { pos: p, hitNormals };
}

function horizontalDistanceSq(a: Vec3, b: Vec3): number {
  const dx = a.x - b.x;
  const dz = a.z - b.z;
  return dx * dx + dz * dz;
}

/** Rise, move across, drop back down. Returns null if nothing was gained. */
function tryStepUp(pos: Vec3, horizontal: Vec3, half: Vec3, boxes: BoxProvider): Vec3 | null {
  const up = moveAndSlide(pos, { x: 0, y: STEP_HEIGHT, z: 0 }, half, boxes);
  if (up.hitNormals.length > 0) return null; // no headroom to step into

  const across = moveAndSlide(up.pos, horizontal, half, boxes);
  const down = moveAndSlide(across.pos, { x: 0, y: -STEP_HEIGHT, z: 0 }, half, boxes);

  const landed = down.hitNormals.some((n) => n.y >= GROUND_NORMAL_Y);
  return landed ? down.pos : null;
}

/**
 * Scratch for the ground normal. Module-level so the per-tick path allocates
 * nothing; safe because `resolveGround` reads it back before returning and the
 * simulation is single-threaded and never reentrant.
 */
const GROUND_NORMAL_SCRATCH: Vec3 = { x: 0, y: 0, z: 0 };

/**
 * Places the hull on the ground surface and reports whether that counts as
 * standing on it.
 *
 * Called once per tick, after the box passes, at the position they settled on.
 * Sampling only the hull's centre line is deliberate: it is the axis the camera
 * sits on, and it is the only sample that keeps the eye's height a continuous
 * function of where you walk. Taking a max over the hull's corners would be
 * continuous too but kinked, and the kinks are visible.
 *
 * `normal` is caller-owned scratch, so the per-tick path allocates nothing.
 */
function resolveGround(
  pos: Vec3,
  vel: Vec3,
  half: Vec3,
  ground: GroundField,
  normal: Vec3,
  wasGrounded: boolean,
  jumped: boolean,
  horizontalDistance: number,
): boolean {
  const h = ground.heightAt(pos.x, pos.z);
  const feet = pos.y - half.y;

  if (feet > h) {
    // Above the surface. Ordinarily that is flight — but a walking player
    // cresting a convex rise is lifted clear by their own horizontal step, and
    // letting them launch off every bump is the column-edge bug in miniature.
    // Stick, bounded by the most the steepest *walkable* slope could have
    // dropped over the ground actually covered this tick, so ledges and cliffs
    // are still falls and a jump is still a jump.
    if (!wasGrounded || jumped || vel.y > 0) return false;
    if (feet - h > horizontalDistance * MAX_WALKABLE_GRADIENT + GROUND_SNAP_MARGIN) return false;
  }

  ground.normalAt(pos.x, pos.z, normal);
  pos.y = h + half.y;

  if (normal.y >= GROUND_NORMAL_Y) {
    if (vel.y < 0) vel.y = 0;
    return true;
  }

  // Too steep to stand on. The hull still rests on the surface — a heightfield
  // has no inside to sink into — but grounded stays false, so the player keeps
  // air control and friction never applies. Cancelling only the into-surface
  // component leaves gravity's downhill share intact, and that is what carries
  // them off the face.
  const dot = vel.x * normal.x + vel.y * normal.y + vel.z * normal.z;
  if (dot < 0) {
    vel.x -= normal.x * dot;
    vel.y -= normal.y * dot;
    vel.z -= normal.z * dot;
  }
  return false;
}

export function stepMovement(
  state: MoveState,
  input: InputCommand,
  dt: number,
  boxes: BoxProvider,
  half: Vec3 = PLAYER_HALF,
  waterLevel: number | null = null,
  ground: GroundField | null = null,
): MoveState {
  const vel: Vec3 = { x: state.vel.x, y: state.vel.y, z: state.vel.z };

  // Wading: purely polynomial, reads only sim state. feet =
  // pos.y − half.y because pos is the hull centre.
  let wade = 1;
  if (waterLevel !== null) {
    const sub = (waterLevel - (state.pos.y - half.y)) / WADE_CHEST_DEPTH;
    const clamped = sub < 0 ? 0 : sub > 1 ? 1 : sub;
    wade = 1 - clamped * (1 - WADE_FLOOR);
  }

  const wish = wishDirection(input.moveX, input.moveZ, input.yaw);
  const wishLen = Math.sqrt(wish.x * wish.x + wish.z * wish.z);
  // Sprint caps the wish higher; it does not add acceleration. Applied in the
  // air as well as on the ground so a sprint carried into a jump can be
  // maintained rather than bled off — AIR_ACCEL is small enough that this
  // cannot be used to gain speed you did not already have.
  const topSpeed = (input.buttons & Button.Sprint) !== 0 ? SPRINT_SPEED : WALK_SPEED;

  if (state.grounded) {
    applyFriction(vel, dt);
    if (wishLen > EPSILON) {
      accelerate(
        vel,
        wish.x / wishLen,
        wish.z / wishLen,
        wishLen * topSpeed * wade,
        GROUND_ACCEL,
        dt,
      );
    }
  } else if (wishLen > EPSILON) {
    accelerate(vel, wish.x / wishLen, wish.z / wishLen, wishLen * topSpeed * wade, AIR_ACCEL, dt);
  }

  let jumped = false;
  if (state.grounded && (input.buttons & Button.Jump) !== 0) {
    vel.y = JUMP_SPEED;
    jumped = true;
  }

  vel.y += GRAVITY * dt;

  // Resolve any existing overlap before sweeping. A reconciling client is
  // routinely placed a couple of millimetres inside the floor by snapshot
  // quantization, and a penetrating mover gets no collision at all.
  const start = depenetrate(state.pos, half, boxes);

  // Vertical pass first, so `grounded` is known before the horizontal move
  // decides whether step-up is allowed.
  const vertical = moveAndSlide(start, { x: 0, y: vel.y * dt, z: 0 }, half, boxes);
  let grounded = false;
  for (const n of vertical.hitNormals) {
    if (n.y >= GROUND_NORMAL_Y) {
      grounded = true;
      vel.y = 0;
    } else if (n.y <= -GROUND_NORMAL_Y) {
      vel.y = 0; // clipped a ceiling
    }
  }
  if (jumped) grounded = false;

  const horizontal: Vec3 = { x: vel.x * dt, y: 0, z: vel.z * dt };
  const flat = moveAndSlide(vertical.pos, horizontal, half, boxes);
  let finalPos = flat.pos;

  if (grounded && flat.hitNormals.length > 0) {
    const stepped = tryStepUp(vertical.pos, horizontal, half, boxes);
    if (
      stepped !== null &&
      horizontalDistanceSq(vertical.pos, stepped) >
        horizontalDistanceSq(vertical.pos, flat.pos) + EPSILON
    ) {
      finalPos = stepped;
    }
  }

  for (const n of flat.hitNormals) {
    const dot = vel.x * n.x + vel.z * n.z;
    if (dot < 0) {
      vel.x -= n.x * dot;
      vel.z -= n.z * dot;
    }
  }

  // Ground last, on the position the boxes settled on and with wall velocity
  // already cancelled, so a player pressed into a cliff face slides along the
  // wall and down the slope rather than fighting the two resolutions.
  if (ground !== null) {
    const dx = finalPos.x - start.x;
    const dz = finalPos.z - start.z;
    const travelled = Math.sqrt(dx * dx + dz * dz);
    const onGround = resolveGround(
      finalPos,
      vel,
      half,
      ground,
      GROUND_NORMAL_SCRATCH,
      state.grounded,
      jumped,
      travelled,
    );
    if (onGround) grounded = true;
  }

  return { pos: finalPos, vel, grounded };
}
