import { tickWorld, type World } from "../../../src/sim/world.js";
import { Button, DeathCause, type PlayerState } from "../../../src/sim/types.js";
import { STEP_HEIGHT, TICK_DT } from "../../../src/sim/constants.js";
import { boxesNear } from "../../../src/sim/boxSource.js";
import { WAY_RIM_M, wayDistance, wayPoint, wayProject, type WayDown } from "../../../src/sim/wayDown.js";

/** Metres down the way from its own place the runner aims at, and the metres ahead on its heading it looks for something in the way. */
const AIM_AHEAD_M = 8;
const LOOK_AHEAD_M = 5;
/** Metres either side of a sampled point that a box must be clear of. */
const CLEAR_M = 0.6;
/** The turns off its aim it tries, in degrees, nearest first. */
const TURNS_DEG = [0, 20, 40, 60, 80];
/**
 * Seconds without advancing after which the runner is snagged, and the turns
 * it tries then. Snagged, it takes everything round it for a wall, whatever
 * its height, and steps round it as a person would: a fallen trunk's end on a
 * slope can stand under the step's height at the runner's own feet and still
 * hold them (measured on two of the sweep's worlds: the runner stood against
 * one, aimed through it, until the chase took them for standing still).
 */
const SNAG_S = 0.25;
const SNAG_TURNS_DEG = [0, 20, 40, 60, 80, 100, 120, 140];

export type RunDown = {
  /** Reached the road's safe ground alive. */
  reached: boolean;
  /** Seconds of the run. */
  seconds: number;
  /** The longest the runner's place along the way went without advancing, seconds. */
  stalledS: number;
  /** The furthest the runner was from the way's line, metres. */
  maxOff: number;
  /** Why it died, or None. */
  cause: DeathCause;
};

type Box = { minX: number; maxX: number; minZ: number; maxZ: number };

/** The boxes round `p` that a runner cannot step over (or, `snagged`, every box that stands over its feet), copied out of the provider's scratch buffer. */
function wallsNear(world: World, p: PlayerState, snagged: boolean): Box[] {
  const feet = p.pos.y - 0.9;
  const reach = LOOK_AHEAD_M + 2;
  const out: Box[] = [];
  for (const b of boxesNear(world.boxes, { x: p.pos.x - reach, y: feet - 0.5, z: p.pos.z - reach }, { x: p.pos.x + reach, y: feet + 1.8, z: p.pos.z + reach })) {
    if (b.max.y <= feet + (snagged ? 0.05 : STEP_HEIGHT) || b.min.y >= feet + 1.8) continue;
    out.push({ minX: b.min.x - CLEAR_M, maxX: b.max.x + CLEAR_M, minZ: b.min.z - CLEAR_M, maxZ: b.max.z + CLEAR_M });
  }
  return out;
}

/** Whether the `LOOK_AHEAD_M` ahead of `p` on `yaw` are clear of `walls`. */
function clear(walls: readonly Box[], p: PlayerState, yaw: number): boolean {
  const dx = Math.sin(yaw), dz = Math.cos(yaw);
  for (let d = 0.8; d <= LOOK_AHEAD_M; d += 0.8) {
    const x = p.pos.x + dx * d, z = p.pos.z + dz * d;
    for (const b of walls) if (x > b.minX && x < b.maxX && z > b.minZ && z < b.maxZ) return false;
  }
  return true;
}

/**
 * Drives a player down the world's way with real input, as someone who stays
 * in the channel and sprints would: aimed at the way's point a few metres
 * ahead of their own place, turning off that aim only for a trunk or a rock
 * in the way, to the side with room inside the channel. Runs until the
 * player is safe, dead, or `maxSeconds` pass. `each` is called after every
 * tick, for whatever else a test watches.
 */
export function runDown(world: World, playerId: number, opts: { maxSeconds?: number; each?: () => void } = {}): RunDown {
  const way = world.way as WayDown;
  const p = world.state.players.get(playerId) as PlayerState;
  const aim = { x: 0, z: 0 };
  let seq = 0, side = 1, best = -Infinity, stalled = 0, stalledS = 0, maxOff = 0, ticks = 0;
  const most = Math.round((opts.maxSeconds ?? 400) / TICK_DT);
  while (ticks < most && !p.safe && p.health > 0) {
    const here = wayProject(way, p.pos.x, p.pos.z);
    if (here.d > maxOff) maxOff = here.d;
    if (here.s > best + 0.05) {
      best = here.s;
      stalled = 0;
    } else {
      stalled += TICK_DT;
      if (stalled > stalledS) stalledS = stalled;
    }
    wayPoint(way, here.s + AIM_AHEAD_M, aim);
    const want = Math.atan2(aim.x - p.pos.x, aim.z - p.pos.z);
    const snagged = stalled > SNAG_S;
    const walls = wallsNear(world, p, snagged);
    let yaw = want, fallback: number | null = null, chosen = false;
    for (const deg of snagged ? SNAG_TURNS_DEG : TURNS_DEG) {
      for (const s of deg === 0 ? [1] : [side, -side]) {
        const tryYaw = want + (s * deg * Math.PI) / 180;
        if (!clear(walls, p, tryYaw)) continue;
        if (fallback === null) fallback = tryYaw;
        // A turn that would carry the runner out of the channel is the last resort.
        if (wayDistance(way, p.pos.x + Math.sin(tryYaw) * 4, p.pos.z + Math.cos(tryYaw) * 4) > WAY_RIM_M - 1) continue;
        yaw = tryYaw;
        if (deg !== 0) side = s;
        chosen = true;
        break;
      }
      if (chosen) break;
    }
    if (!chosen && fallback !== null) yaw = fallback;
    tickWorld(world, new Map([[playerId, { seq: seq++, moveX: 0, moveZ: 1, yaw, pitch: 0, buttons: Button.Sprint }]]));
    ticks++;
    opts.each?.();
  }
  return { reached: p.safe && p.health > 0, seconds: ticks * TICK_DT, stalledS, maxOff, cause: p.health > 0 ? DeathCause.None : p.cause };
}
