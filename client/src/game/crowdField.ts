/**
 * The crowd (docs/gameplay/2026-11-13-the-way-down.md): in the chase the
 * woods beside the way are full of shades. Each screen makes and moves its
 * own round its own player, from the rules here; the host knows none of
 * them, and two players side by side do not see the same ones. None of them
 * comes for a player the last metres: each stops short and stands. But a
 * player who walks into one is had by it (its arms come out, and the screen
 * tells the host, which makes the death: sim/taken.ts), so the crowd is what
 * a runner must not touch. What hunts is the host's, as it was (a Hollow, a
 * shade's lunge), and is told apart by its red eyes.
 *
 * This file is the rules and their numbers, computed with no engine so they
 * are tested as arithmetic: how many the way wants, what each figure is, where
 * one may stand. The renderer draws what it holds.
 */
import type { QualityTier } from "./quality.js";
import { hash2 } from "../sim/field.js";
import { Outcome, Phase, nextRandom } from "../sim/types.js";
import { WAY_FLOOR_M, WAY_RIM_M } from "../sim/wayDown.js";

/** The most figures a screen keeps at the crowd's thickest. */
export const CROWD_MOST: Record<QualityTier, number> = { low: 90, medium: 90, high: 90 };
/**
 * Where they stand, in metres. Beyond the path's edge, where its mist is
 * whole (sim/wayDown.ts WAY_FLOOR_M): none within CROWD_CLEAR_M of it (so
 * CROWD_EDGE_M from the way's line is the nearest one stands or waits),
 * CROWD_NEAR_SHARE of them within CROWD_NEAR_BAND_M, the rest out to
 * CROWD_FAR_BAND_M. Down the way from the player's own place on it: to
 * CROWD_AHEAD_M, so there are always eyes far down the way; one left
 * CROWD_BEHIND_M behind is taken away. No two within CROWD_APART_M. Round a
 * player who has left the way: CROWD_OFF_WAY_M from them. And the nearest
 * one comes to its player by its own steps: CROWD_KEEP_M, where it stands.
 * (Until 2026-11-19 there were sixty, 5.5 m apart, and one that came within
 * 3 m of its player went: nothing of the crowd could be walked into.)
 */
export const CROWD_CLEAR_M = 1;
export const CROWD_EDGE_M = WAY_FLOOR_M + CROWD_CLEAR_M;
export const CROWD_NEAR_BAND_M = 15;
export const CROWD_FAR_BAND_M = 35;
export const CROWD_NEAR_SHARE = 0.7;
export const CROWD_AHEAD_M = 85;
export const CROWD_BEHIND_M = 30;
export const CROWD_APART_M = 4.5;
export const CROWD_OFF_WAY_M: readonly [number, number] = [8, 15];
export const CROWD_KEEP_M = 3;

const smooth = (t: number): number => (t <= 0 ? 0 : t >= 1 ? 1 : t * t * (3 - 2 * t));

/**
 * How many the crowd wants at `progress` of the way (0 its start, 1 the
 * pad) where `most` is the thickest: a third near the crest, all of them
 * from three tenths of the way to eight, and half by the road.
 */
export function crowdTarget(progress: number, most: number): number {
  const share = progress < 0.3 ? 1 / 3 + (2 / 3) * smooth(progress / 0.3) : 1 - 0.5 * smooth((progress - 0.8) / 0.2);
  return Math.round(most * share);
}

/**
 * A figure of the crowd. `size` is its share of a Hollow's; `eyes` how
 * bright its eyes are (0 to 1) and `warm` their colour, 0 pale to 1 a dull
 * ember (never the Hollow's red); `pace` the metres a second it stalks its
 * player at over the last metres (crowdSpeed: it runs in from further off);
 * `born` the seconds it began to rise at, and `gone` the seconds it began to
 * go at, or -1; `rise` how it came, 0 out of the mist or 1 as a pair of eyes
 * opening far off; `reach` how far its two arms are out at its player, 0
 * (or absent) to 1. `kills` marks a figure that is no part of this crowd:
 * one of the host's that hunts, drawn among it (crowdKillers.ts), with the
 * Hollow's red eyes.
 */
export type CrowdFigure = { id: number; x: number; z: number; size: number; eyes: number; warm: number; pace: number; born: number; gone: number; rise: 0 | 1; /** Whether the ground last refused its step on: it stands until it is asked again. */ held?: boolean; kills?: boolean; reach?: number };

/**
 * The touch: a player who comes within CROWD_TOUCH_M of a figure that is at
 * least CROWD_TOUCH_PRESENCE there (not one still rising, nor one going) is
 * had by it. It stands where it is and its arms come out over CROWD_REACH_S;
 * the screen tells the host (app.ts, sim/taken.ts), which makes the death,
 * and the figure holds its reach over them until they are back. A player the
 * host does not give it (one just returned, one on the road) it lets go
 * after CROWD_HOLD_S, and goes. The touch is seen coming: a figure's arms
 * open as its player comes within CROWD_REACH_FROM_M of it, by how near they
 * are, and shut as they go, so one brushed past at the lane's edge shows
 * what it would do.
 *
 * And what makes the touch the player's own doing: no figure steps into the
 * ground right in front of its player, within CROWD_LANE_M of the line of
 * their look for CROWD_LANE_AHEAD_M along it. One that is there (the player
 * turned to it) comes no nearer. So a player who looks where they go and
 * keeps straight on passes through the crowd; one who turns into it dies.
 */
export const CROWD_TOUCH_M = 1;
export const CROWD_TOUCH_PRESENCE = 0.5;
export const CROWD_REACH_S = 0.12;
export const CROWD_HOLD_S = 2;
export const CROWD_REACH_FROM_M = 2.4;
export const CROWD_LANE_M = 1.6;
export const CROWD_LANE_AHEAD_M = 10;

/**
 * The lunge: a figure waiting at the path's edge comes onto the path at a
 * runner once they are within CROWD_LUNGE_M of it down the way, at
 * CROWD_LUNGE_MPS, faster than a sprint, so that the woods either side throw
 * themselves at whoever passes. CROWD_LUNGE_SHARE of the figures are
 * lungers (`crowdLunges`, from a figure's own number); the rest hold the
 * edge and fall in behind. None reaches its player: it stops at
 * CROWD_KEEP_M as every figure does, beside their line, and is passed.
 */
export const CROWD_LUNGE_M = 12;
export const CROWD_LUNGE_MPS = 8;
export const CROWD_LUNGE_SHARE = 2 / 3;
/** Whether the figure of this number is a lunger. */
export function crowdLunges(id: number, seed: number): boolean {
  return hash2(id, 6, seed) < CROWD_LUNGE_SHARE;
}

/** A figure's look, from its own number: the same for as long as it lives. A fifth are small, one in seven large, the rest near a Hollow's size. */
export function figureOf(id: number, seed: number): Pick<CrowdFigure, "size" | "eyes" | "warm" | "pace"> {
  const kind = hash2(id, 1, seed), within = hash2(id, 2, seed);
  const size = kind < 0.2 ? 0.5 + 0.2 * within : kind < 0.2 + 1 / 7 ? 1.4 + 0.35 * within : 0.8 + 0.45 * within;
  return { size, eyes: 0.35 + 0.65 * hash2(id, 3, seed), warm: hash2(id, 4, seed), pace: 0.6 + 0.8 * hash2(id, 5, seed) };
}

/**
 * The way and the ground as the crowd needs them: the way's length, a place
 * projected onto it (the metres down it and the metres off its line), its
 * point and its direction at so many metres down it, and whether a figure
 * may stand at a place (dry ground it can stand on, with nothing solid in it).
 */
export type CrowdWorld = {
  length: number;
  project(x: number, z: number): { s: number; d: number };
  point(s: number, out: { x: number; z: number }): { x: number; z: number };
  direction(s: number, out: { x: number; z: number }): { x: number; z: number };
  admit(x: number, z: number): boolean;
};

const AT = { x: 0, z: 0 }, ALONG = { x: 0, z: 0 };
/** The living figures at their player's back this step. */
const BACK: CrowdFigure[] = [];

/**
 * One try at a place for a new figure. Beside the way: a drawn side of it, a
 * drawn distance beyond the rim, a drawn distance down it from the player's
 * own place. Round a player who has left the way (`offWay` metres off its
 * rim, over nothing): a drawn bearing, CROWD_OFF_WAY_M from them. Kept when
 * the ground admits it, when it is clear of the channel, and when it is
 * CROWD_APART_M from every figure. Spends six draws whatever the ground says.
 */
export function placeCrowd(world: CrowdWorld, eye: { x: number; z: number; yaw: number }, figures: readonly CrowdFigure[], rng: { rngSeed: number }, offWay: number): { x: number; z: number } | null {
  const side = nextRandom(rng) < 0.5 ? -1 : 1;
  const near = nextRandom(rng) < CROWD_NEAR_SHARE;
  const band = nextRandom(rng);
  const ahead = nextRandom(rng) * CROWD_AHEAD_M;
  const bearing = nextRandom(rng) * 2 * Math.PI;
  const range = CROWD_OFF_WAY_M[0] + nextRandom(rng) * (CROWD_OFF_WAY_M[1] - CROWD_OFF_WAY_M[0]);
  let x: number, z: number;
  if (offWay > 0) {
    x = eye.x + Math.sin(bearing) * range;
    z = eye.z + Math.cos(bearing) * range;
  } else {
    const s = Math.min(world.length, world.project(eye.x, eye.z).s + ahead);
    world.point(s, AT);
    world.direction(s, ALONG);
    const beyond = near ? CROWD_CLEAR_M + band * (CROWD_NEAR_BAND_M - CROWD_CLEAR_M) : CROWD_NEAR_BAND_M + band * (CROWD_FAR_BAND_M - CROWD_NEAR_BAND_M);
    x = AT.x - side * ALONG.z * (WAY_FLOOR_M + beyond);
    z = AT.z + side * ALONG.x * (WAY_FLOOR_M + beyond);
  }
  // Clear of the path wherever the way bends toward it.
  if (world.project(x, z).d < CROWD_EDGE_M) return null;
  if (!world.admit(x, z)) return null;
  for (const f of figures) {
    const dx = f.x - x, dz = f.z - z;
    if (dx * dx + dz * dz < CROWD_APART_M * CROWD_APART_M) return null;
  }
  return { x, z };
}

/**
 * How the crowd closes on its player, so that the whole wood is felt to be
 * coming for them. A figure runs in from far off and stalks the last metres:
 * its own pace where it would go (CROWD_KEEP_M), CROWD_RUSH times that from
 * CROWD_RUSH_M off and further. One the player has passed gives chase
 * instead, to CROWD_CHASE_MPS from CROWD_CHASE_M off: faster than a player
 * sprints, so what follows holds some 9 m off a sprinter's heels and closes
 * on one who slows (16 m off until 2026-11-19, too far back to be felt). At a runner's back there are CROWD_PACK at the
 * most, so the rest of the crowd is ahead of them, where they look. And no
 * figure walks into another: within CROWD_PRESS_M of one it is turned aside,
 * and directly behind one it waits.
 */
export const CROWD_RUSH = 3.6;
export const CROWD_RUSH_M = 22;
export const CROWD_CHASE_MPS = 9;
export const CROWD_CHASE_M = 12;
export const CROWD_PACK = 10;
export const CROWD_PRESS_M = 3;
/** How hard a figure is turned from one inside the press's reach, against its own step toward the player: at half the reach the two are equal. */
const PRESS_PUSH = 2;

/** The metres a second a figure of this `pace` moves at, `d` metres from its player: giving chase (`chasing`, behind them) or coming in from the woods. */
export function crowdSpeed(pace: number, d: number, chasing: boolean): number {
  const far = smooth((d - CROWD_KEEP_M) / ((chasing ? CROWD_CHASE_M : CROWD_RUSH_M) - CROWD_KEEP_M));
  return pace + ((chasing ? CROWD_CHASE_MPS : pace * CROWD_RUSH) - pace) * far;
}

/** A screen's crowd: its figures, its own stream (never the sim's), the next figure's number, the seed its figures' looks come from, and the number of the figure that has its player (0: none has) with the seconds it had them at. */
export type Crowd = { figures: CrowdFigure[]; rng: { rngSeed: number }; nextId: number; seed: number; steps: number; has: number; hadAt: number };
export function newCrowd(seed: number): Crowd {
  return { figures: [], rng: { rngSeed: (seed ^ 0x2c0d) >>> 0 }, nextId: 1, seed, steps: 0, has: 0, hadAt: 0 };
}

/** Where a crowd is stepped round: its player's place, the yaw of their look, and whether a figure may have them now (`prey`: alive, in the chase, not on the road; absent, nothing is had). */
export type CrowdEye = { x: number; z: number; yaw: number; prey?: boolean };

/** Metres from where the host raises a killer within which a figure of the crowd is the one that turned. */
export const CROWD_GIVES_M = 12;

/**
 * The host has raised what can kill (a Hollow, a shade's lunge) at `at`: the
 * nearest living figure within `within` metres of it begins to go, as the
 * killer comes in at its own place over the same seconds, so one of the
 * crowd is seen to turn. Its number, or null where none is near (the killer
 * rises as it always did).
 */
export function crowdGives(crowd: Crowd, at: { x: number; z: number }, seconds: number, within = CROWD_GIVES_M): number | null {
  let turned: CrowdFigure | null = null, least = within * within;
  for (const f of crowd.figures) {
    if (f.gone >= 0) continue;
    const d2 = (f.x - at.x) * (f.x - at.x) + (f.z - at.z) * (f.z - at.z);
    if (d2 <= least) {
      least = d2;
      turned = f;
    }
  }
  if (turned === null) return null;
  turned.gone = seconds;
  return turned.id;
}

/**
 * A killer of the host's that has stopped hunting (gone from the state) goes
 * back into the crowd: a figure is born at `at` as the killer fades. Nothing
 * is left where a figure of the crowd may not stand (the channel and its
 * clear ground, ground that refuses it): there it goes into the mist.
 */
export function crowdTakes(crowd: Crowd, at: { x: number; z: number }, seconds: number, world: CrowdWorld): void {
  if (world.project(at.x, at.z).d < CROWD_EDGE_M || !world.admit(at.x, at.z)) return;
  const id = crowd.nextId++;
  crowd.figures.push({ id, x: at.x, z: at.z, born: seconds, gone: -1, rise: 0, ...figureOf(id, crowd.seed) });
}

/** Whether the crowd is up: from the summit scene's turn to the way (the way's mist shown) through the chase, while the match is undecided. */
export function crowdOn(phase: Phase, outcome: Outcome, wayShown: number): boolean {
  return (phase === Phase.Chase || phase === Phase.Scene) && outcome === Outcome.Playing && wayShown > 0;
}

/**
 * A walking figure's step on is put to the ground one step in this many (its
 * own number sets which), and it stands where the ground last refused it
 * until it is asked again: the ground's admission is several reads of the
 * world a place, and sixty of them a frame would be the crowd's whole cost.
 */
export const CROWD_ADMIT_EVERY = 8;

/** The ground's height is asked for this many figures a frame at the most, and again for one only once it has moved this many metres. */
export const CROWD_HEIGHTS_A_FRAME = 8;
export const CROWD_HEIGHT_STALE_M = 1;
/** The ground under each figure, as last asked: where it stood then, and the height. */
export type CrowdGround = Map<number, { x: number; z: number; h: number }>;

/**
 * The ground's height under each of `figures`, in step with them, written to
 * `out`: kept from frame to frame in `ground`, asked of `heightAt` for a few
 * figures a frame, the rest standing at what was last known of them or, new,
 * at `fallback`. A figure gone is forgotten.
 */
export function crowdHeights(ground: CrowdGround, figures: readonly CrowdFigure[], heightAt: (x: number, z: number) => number, fallback: number, out: number[]): number[] {
  out.length = figures.length;
  let asked = 0;
  for (let i = 0; i < figures.length; i++) {
    const f = figures[i] as CrowdFigure;
    let known = ground.get(f.id);
    const stale = known === undefined || (f.x - known.x) * (f.x - known.x) + (f.z - known.z) * (f.z - known.z) > CROWD_HEIGHT_STALE_M * CROWD_HEIGHT_STALE_M;
    if (stale && asked < CROWD_HEIGHTS_A_FRAME) {
      asked++;
      known = { x: f.x, z: f.z, h: heightAt(f.x, f.z) };
      ground.set(f.id, known);
    }
    out[i] = known === undefined ? fallback : known.h;
  }
  if (ground.size > figures.length) {
    const live = new Set(figures.map((f) => f.id));
    for (const id of ground.keys()) if (!live.has(id)) ground.delete(id);
  }
  return out;
}

/**
 * Places tried in one step; the seconds a figure takes to come and to go;
 * how far off the player's look is out of their view (its cosine: 60
 * degrees); and the metres past which the mist leaves only a figure's eyes,
 * so one may be added there in view (as a pair of eyes opening).
 */
export const CROWD_TRIES_A_STEP = 4;
export const CROWD_RISE_S = 2.4;
export const CROWD_FADE_S = 2.6;
export const CROWD_VIEW_COS = 0.5;
export const CROWD_MIST_M = 30;
/** Metres past CROWD_AHEAD_M a figure may be before it is taken away, and metres from a player off the way past which one is. */
const AHEAD_SLACK_M = 20;
const OFF_WAY_FAR_M = CROWD_OFF_WAY_M[1] + 10;

const clamp01 = (t: number): number => (t <= 0 ? 0 : t >= 1 ? 1 : t);

/** How much of a figure is there, 0 to 1: in over CROWD_RISE_S from its birth, out over CROWD_FADE_S from when it began to go. */
export function presenceOf(f: CrowdFigure, seconds: number): number {
  const come = clamp01((seconds - f.born) / CROWD_RISE_S);
  return f.gone < 0 ? come : come * (1 - clamp01((seconds - f.gone) / CROWD_FADE_S));
}

/**
 * A step of the crowd round a player at `eye` (their place and the yaw of
 * their look), `seconds` on the screen's clock, `dt` since the last step.
 *
 * With no world, or `most` at nothing, every figure begins to go. Otherwise
 * each figure comes for the player (crowdSpeed), turned aside from any
 * other it would walk into. One ahead of the player's place on the way keeps
 * off the path as it comes, sliding along its edge, until the player is
 * within a lunge of it down the way, when a lunger comes onto the path at
 * them; one the player has passed is free to step in behind them, and gives
 * chase. None steps nearer its player than CROWD_KEEP_M, nor into the lane
 * in front of them (CROWD_LANE_M); one a player who is `prey` walks into has
 * them (`crowd.has`), and stands reaching until it lets go.
 * A figure goes when it has been
 * left CROWD_BEHIND_M behind, is too far down the way, or, round a player
 * who has left the way, is too far from them; and behind a player on the way
 * the furthest goes while there are more than CROWD_PACK there. It goes at
 * once where it is out of their view, by fading where it is in it. And while there are fewer than
 * the way wants, places are tried: one is kept only where it is out of the
 * player's view or past the mist's reach, so nothing appears in plain sight
 * (round a player off the way they rise close, and their rise is the fade).
 */
export function stepCrowd(crowd: Crowd, world: CrowdWorld | null, eye: CrowdEye, most: number, seconds: number, dt: number): void {
  const figures = crowd.figures;
  if (world === null || most <= 0) {
    for (const f of figures) if (f.gone < 0) f.gone = seconds;
    crowd.figures = figures.filter((f) => seconds - f.gone < CROWD_FADE_S);
    crowd.has = 0;
    return;
  }
  const prey = eye.prey === true;
  // The one that has its player lets go of one who is prey still, or again, after the hold: the host did not give
  // them to it, or they have died of it and are back. It goes.
  if (crowd.has !== 0 && prey && seconds - crowd.hadAt > CROWD_HOLD_S) {
    for (const f of figures) if (f.id === crowd.has && f.gone < 0) f.gone = seconds;
    crowd.has = 0;
  }
  const here = world.project(eye.x, eye.z);
  const offWay = Math.max(0, here.d - WAY_RIM_M);
  const lookX = Math.sin(eye.yaw), lookZ = Math.cos(eye.yaw);
  const seen = (x: number, z: number, d: number): boolean => d > 0 && ((x - eye.x) * lookX + (z - eye.z) * lookZ) / d >= CROWD_VIEW_COS;
  const kept: CrowdFigure[] = [];
  let alive = 0;
  BACK.length = 0;
  for (const f of figures) {
    if (f.gone >= 0) {
      if (seconds - f.gone < CROWD_FADE_S) kept.push(f);
      continue;
    }
    // The one that has its player stands where it took them, its arms coming out.
    if (f.id === crowd.has) {
      f.reach = Math.min(1, (f.reach ?? 0) + dt / CROWD_REACH_S);
      alive++;
      kept.push(f);
      continue;
    }
    const dx = eye.x - f.x, dz = eye.z - f.z;
    const d = Math.sqrt(dx * dx + dz * dz);
    const at = world.project(f.x, f.z);
    const ahead = at.s > here.s;
    // A lunger the player has come within a lunge of, down the way: loosed onto the path at them.
    const loosed = ahead && offWay <= 0 && at.s <= here.s + CROWD_LUNGE_M && crowdLunges(f.id, crowd.seed);
    // Its step toward the player (never past where it would go), turned from any figure it presses on; ahead of them, along the path's edge where the step would take it onto the path.
    if (d > 0) {
      const step = Math.max(0, Math.min((loosed ? CROWD_LUNGE_MPS : crowdSpeed(f.pace, d, offWay <= 0 && !ahead)) * dt, d - CROWD_KEEP_M + 0.05));
      let ux = dx / d, uz = dz / d, px = 0, pz = 0;
      for (const g of figures) {
        if (g === f || g.gone >= 0) continue;
        const ex = f.x - g.x, ez = f.z - g.z, e2 = ex * ex + ez * ez;
        if (e2 >= CROWD_PRESS_M * CROWD_PRESS_M || e2 === 0) continue;
        const e = Math.sqrt(e2), push = (1 - e / CROWD_PRESS_M) / e;
        px += ex * push;
        pz += ez * push;
      }
      if (px !== 0 || pz !== 0) {
        ux += PRESS_PUSH * px;
        uz += PRESS_PUSH * pz;
        // Never faster for being pushed, and slower where the push is against its step: behind another it waits.
        const n = Math.sqrt(ux * ux + uz * uz);
        if (n > 1) {
          ux /= n;
          uz /= n;
        }
      }
      let nx = f.x + ux * step, nz = f.z + uz * step;
      let to = world.project(nx, nz);
      if (ahead && !loosed && to.d < CROWD_EDGE_M) {
        world.direction(at.s, ALONG);
        const along = (ux * ALONG.x + uz * ALONG.z) * step;
        nx = f.x + ALONG.x * along;
        nz = f.z + ALONG.z * along;
        to = world.project(nx, nz);
      }
      if ((f.id + crowd.steps) % CROWD_ADMIT_EVERY === 0) f.held = !world.admit(nx, nz);
      // Never into the ground right in front of its player, nor nearer them along it: the lane of their look is theirs.
      const fore = (nx - eye.x) * lookX + (nz - eye.z) * lookZ, side = Math.abs((nx - eye.x) * lookZ - (nz - eye.z) * lookX);
      const lane = fore > 0 && fore < CROWD_LANE_AHEAD_M && side < CROWD_LANE_M && side <= Math.abs(dx * lookZ - dz * lookX);
      // Onto the path only behind the player's own place on the way, or in a lunge, wherever the figure set out from.
      if (f.held !== true && !lane && (loosed || to.s <= here.s || to.d >= CROWD_EDGE_M)) {
        f.x = nx;
        f.z = nz;
      }
    }
    const nd = Math.sqrt((eye.x - f.x) * (eye.x - f.x) + (eye.z - f.z) * (eye.z - f.z));
    // Walked into: it has them, and stands.
    if (prey && crowd.has === 0 && nd <= CROWD_TOUCH_M && presenceOf(f, seconds) >= CROWD_TOUCH_PRESENCE) {
      crowd.has = f.id;
      crowd.hadAt = seconds;
      f.reach = Math.min(1, dt / CROWD_REACH_S);
      alive++;
      kept.push(f);
      continue;
    }
    // Its arms open as its player comes near, and shut as they go.
    const open = prey && nd < CROWD_REACH_FROM_M && presenceOf(f, seconds) >= CROWD_TOUCH_PRESENCE ? clamp01((CROWD_REACH_FROM_M - nd) / (CROWD_REACH_FROM_M - CROWD_TOUCH_M)) : 0;
    const arms = f.reach ?? 0;
    if (open !== arms) f.reach = arms + Math.max(-dt / CROWD_REACH_S, Math.min(dt / CROWD_REACH_S, open - arms));
    const going = at.s < here.s - CROWD_BEHIND_M || at.s > here.s + CROWD_AHEAD_M + AHEAD_SLACK_M || (offWay > 0 && nd > OFF_WAY_FAR_M);
    if (going) {
      // Out of view it is simply gone. In view it fades.
      if (!seen(f.x, f.z, nd)) continue;
      f.gone = seconds;
    } else {
      alive++;
      if (!ahead) BACK.push(f);
    }
    kept.push(f);
  }
  // More at the back of a player on the way than the pack: the last of them goes, so the crowd is where they look.
  const away = (f: CrowdFigure): number => (eye.x - f.x) * (eye.x - f.x) + (eye.z - f.z) * (eye.z - f.z);
  while (offWay <= 0 && BACK.length > CROWD_PACK) {
    let at = 0;
    for (let i = 1; i < BACK.length; i++) if (away(BACK[i] as CrowdFigure) > away(BACK[at] as CrowdFigure)) at = i;
    const last = BACK[at] as CrowdFigure;
    if (seen(last.x, last.z, Math.sqrt(away(last)))) last.gone = seconds;
    else kept.splice(kept.indexOf(last), 1);
    BACK.splice(at, 1);
    alive--;
  }
  const want = crowdTarget(world.length > 0 ? here.s / world.length : 0, most);
  // More than the way wants now (the road is coming): the one furthest from the player goes.
  if (alive > want) {
    let far: CrowdFigure | null = null, farD = -1;
    for (const f of kept) {
      if (f.gone >= 0 || f.id === crowd.has) continue;
      const d = (eye.x - f.x) * (eye.x - f.x) + (eye.z - f.z) * (eye.z - f.z);
      if (d > farD) {
        farD = d;
        far = f;
      }
    }
    if (far !== null) {
      far.gone = seconds;
      alive--;
    }
  }
  for (let t = 0; t < CROWD_TRIES_A_STEP && alive < want; t++) {
    const p = placeCrowd(world, eye, kept, crowd.rng, offWay);
    if (p === null) continue;
    const d = Math.sqrt((p.x - eye.x) * (p.x - eye.x) + (p.z - eye.z) * (p.z - eye.z));
    const inView = seen(p.x, p.z, d);
    if (offWay <= 0 && inView && d < CROWD_MIST_M) continue;
    const id = crowd.nextId++;
    kept.push({ id, x: p.x, z: p.z, born: seconds, gone: -1, rise: inView && offWay <= 0 ? 1 : 0, ...figureOf(id, crowd.seed) });
    alive++;
  }
  crowd.figures = kept;
  crowd.steps++;
}
