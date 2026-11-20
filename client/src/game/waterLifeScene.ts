/**
 * The lake's life a frame at a time, with no engine: the midges' swarms at
 * dawn and dusk, the dragonflies by day and the chorus frogs at night, each
 * switched by the hour, the weather, the wind and the dread
 * (`waterLifeParams.ts`), placed once from the world's seed and its lake
 * (`waterLifeField.ts`).
 *
 * Render-side, like the animals: it reads the world and never writes it.
 * Every frame it eases the presence toward the weather's, steps the swarms'
 * table (`midgeMotion.ts`) for the one midge draw, the dragonflies' state
 * machines (`dragonflyBehaviour.ts`) for their cards and the frogs' chorus
 * (`frogChorus.ts`), and fills one reused `WaterLifeSound` for
 * `waterLifeAudio.ts` to voice. What it steps it hands to whoever draws it
 * (`WaterLifeDraws`): the midges' frame, or none, and the dragonflies as
 * they stand. `lite/waterLifeMeshes.ts` draws them.
 *
 * Under the frogs' voices lies a far chorus, the frogs farther out: two
 * places over the water, fixed once a world (the marsh's middle, or without
 * a marsh the shore farthest from its first frog, and the shore farthest
 * from that), and a level that follows the frogs' presence, is gone while
 * the Hollow holds them silent, and thins to `BED_FLOOR` as players' nearness
 * stops the voices. Each loop also falls quiet around the player nearest
 * its place, as the voices there do: down to `BED_FLOOR` within the voices'
 * quiet radius, whole from `FROG_BED_REF` out.
 *
 * With the camera beyond the reach of everything the lake holds
 * (`WATER_LIFE_REACH` past the farthest of it), nothing is stepped: the
 * draws are off, the sound is silent, the swarms over the players' heads
 * let go, and the presence starts again from the weather's own when the
 * camera comes back.
 */
import { MAX_PLAYERS } from "../sim/constants.js";
import type { LakeSource } from "../sim/terrain.js";
import { nextRandom } from "../sim/types.js";
import type { QualityTier } from "@csarkosh/engine/game/quality";
import type { SkyState } from "@csarkosh/engine/game/skyState";
import type { WeatherParams } from "@csarkosh/engine/game/weather";
import type { WindRecord } from "@csarkosh/engine/game/windParams";
import {
  midgeHumPitch,
  summerTemperature,
  waterLifePresenceUnder,
  type DragonflyShare,
  type WaterLifePresence,
} from "@csarkosh/engine/game/waterLifeParams";
import { inShoreBand, waterLifeBed, waterLifeLayout, type WaterLifeLayout, type WaterLifeMade } from "./waterLifeField.js";
import {
  HEAD_MIDGES,
  HEAD_ROW0,
  MIDGE_CUTOFF,
  MIDGE_SWARMS_MAX,
  MIDGE_TIER_MAX,
  SWARM_ROW_FLOATS,
  createHeads,
  packSwarm,
  shareBudget,
  stepHeads,
  swarmFrame,
  type SwarmFrame,
} from "./midgeMotion.js";
import type { MidgeFrame } from "./midgeLook.js";
import { DRAGONFLY_RANGE, createDragonflyBehaviour, type Dragonflies } from "./dragonflyBehaviour.js";
import { FROG_QUIET_RADIUS, createFrogChorus, type FrogCall } from "./frogChorus.js";
import { FROG_BED_REF, FROG_RANGE, type WaterLifeSound } from "./waterLifeAudio.js";

/** Seconds a share of presence takes to go from none to full, or back. */
export const WATER_LIFE_EASE_S = 3;
/** How far past the farthest thing the lake holds the camera still sees or
 * hears any of it, m: the frogs' range, the longest of the three. */
export const WATER_LIFE_REACH = Math.max(MIDGE_CUTOFF, DRAGONFLY_RANGE, FROG_RANGE);
/** The longest step taken, s: a stalled frame steps this far and no further. */
export const WATER_LIFE_DT_MAX = 0.25;
/** The rows the swarms' table fills: the markers' and one over each player. */
const ROWS = HEAD_ROW0 + MAX_PLAYERS;
/** A marker's block holds its swarm at its fullest: mist fills a swarm up to
 * 30 % fuller (`WaterLifePresence.midgeFullness`). */
const BLOCK_FULLNESS = 1.3;
/** How far a swarm's centre leaves its marker, in radii: the wind's shift
 * and surge reach one and a half. */
const SHIFT_RADII = 2;

/** The far chorus's level with every voice that may call stopped by a player: it thins, never vanishes. */
const BED_FLOOR = 0.35;


/** A head swarm is a ball sized as a marker of its count is
 * (`waterLifeField.ts`: 0.3 m and 1.2 mm a midge). */
function headRadius(midges: number): number {
  return 0.3 + 0.0012 * midges;
}

/** A step of `step` toward `target`, landing on it (the animals' ramp). */
function rampTo(current: number, target: number, step: number): number {
  const gap = target - current;
  return Math.abs(gap) <= step ? target : current + Math.sign(gap) * step;
}

function rampShare(current: DragonflyShare, target: DragonflyShare, step: number): void {
  current.seen = rampTo(current.seen, target.seen, step);
  current.flying = rampTo(current.flying, target.flying, step);
}

function noPresence(): WaterLifePresence {
  return {
    midge: 0, midgeFullness: 1,
    darner: { seen: 0, flying: 0 }, skimmer: { seen: 0, flying: 0 }, damselfly: { seen: 0, flying: 0 },
    frog: 0,
  };
}

function copyPresence(from: WaterLifePresence, to: WaterLifePresence): void {
  to.midge = from.midge;
  to.midgeFullness = from.midgeFullness;
  to.darner.seen = from.darner.seen;
  to.darner.flying = from.darner.flying;
  to.skimmer.seen = from.skimmer.seen;
  to.skimmer.flying = from.skimmer.flying;
  to.damselfly.seen = from.damselfly.seen;
  to.damselfly.flying = from.damselfly.flying;
  to.frog = from.frog;
}

const NO_RUSTLES: readonly { x: number; y: number; z: number; loud: boolean }[] = Object.freeze([]);
const NO_CALLS: readonly FrogCall[] = Object.freeze([]);

/** A player's position as the sim holds it: y is the body's centre. */
type PlayerAt = { x: number; y: number; z: number };

export type WaterLifeFrame = {
  camX: number; camY: number; camZ: number;
  tick: number; dt: number; time: number;              // shared seconds
  /**
   * The players by slot: each keeps their index for as long as they are in
   * the world (a head swarm and a speed are kept by it), and a slot with no
   * player is undefined.
   */
  players: readonly (PlayerAt | undefined)[];
  weather: WeatherParams; hour: number; wind: WindRecord;
  sky: SkyState | null; skyLuma: number; pixelAt1m: number;
  hollowDistance: number;
};

/** Whoever draws the lake's life: handed what a frame stepped. */
export type WaterLifeDraws = {
  /** The midges' one draw with `frame`, or none of it (null): no swarm in sight. */
  midges(frame: MidgeFrame | null): void;
  /** The dragonflies' cards from their units as they now stand; `seed` is the world's, which their colours and wing phases are drawn from. */
  dragonflies(units: Dragonflies, seed: number): void;
};

export type WaterLifeScene = {
  /** The midges' instances by row: row r holds `blocks[r]` (a marker's swarm at its fullest, a head's at its largest, 0 for a row not used). */
  readonly blocks: readonly number[];
  update(f: WaterLifeFrame, draws: WaterLifeDraws): void;
  /** In place of `update` for a lake the renderer leaves out this frame
   * (spec §10.3): nothing drawn, nothing heard, nothing stepped, as beyond
   * its own reach; the next `update` starts the presence again from the
   * weather's own. */
  rest(draws: WaterLifeDraws): void;
  /** This frame's sound: one object, reused, refilled by each `update`;
   * `hums[r]` is the swarm of the table's row r. */
  sound(): WaterLifeSound;
  /** Ends it: a late `update` refills nothing, and the sound is silent. */
  dispose(): void;
};

/**
 * The life of `lake`, placed from the world's `seed`, its midges capped by
 * `tier`. `made` is the lake's layout made ahead, without its `lake` and
 * with the far chorus's places (`preparedScene.ts`); absent or null, it is
 * laid out and the shore walked here.
 */
export function createWaterLifeScene(seed: number, lake: LakeSource, tier: QualityTier, made?: WaterLifeMade | null): WaterLifeScene {
  const layout: WaterLifeLayout = made !== null && made !== undefined ? { ...made, lake } : waterLifeLayout(seed, lake);
  const markers = layout.markers;
  const markerRows = Math.min(markers.length, HEAD_ROW0);

  // The static block layout: a marker's swarm at its fullest, a head's at
  // its largest, nothing in the rows left over.
  const blocks: number[] = new Array<number>(MIDGE_SWARMS_MAX).fill(0);
  for (let r = 0; r < markerRows; r++) blocks[r] = Math.ceil(markers[r]!.midges * BLOCK_FULLNESS);
  for (let h = 0; h < MAX_PLAYERS; h++) blocks[HEAD_ROW0 + h] = HEAD_MIDGES[1];

  const dragonflies = createDragonflyBehaviour(layout, seed);
  /** What the cards are handed while nothing is stepped: no unit at all. */
  const noDragonflies: Dragonflies = { count: [0, 0, 0], poses: [[], [], []], rustles: [], step() {} };
  // The chorus's rhythms, drawn from the world's seed.
  const rng = { rngSeed: seed | 0 };
  const frogs = createFrogChorus(layout.voices, seed, () => nextRandom(rng));

  // Beyond this from the lake's centre, the camera is out of reach of all of it.
  let extent = lake.shape.shoreMax;
  const reachTo = (p: { x: number; z: number }): void => {
    extent = Math.max(extent, Math.hypot(p.x - lake.x, p.z - lake.z));
  };
  for (const m of markers) reachTo(m);
  for (const b of layout.beats) for (const p of b.points) reachTo(p);
  for (const p of layout.perches) reachTo(p);
  for (const p of layout.stems) reachTo(p);
  for (const v of layout.voices) reachTo(v);
  const reach = extent + WATER_LIFE_REACH;

  // The swarms' rows, made once: the table, each row's frame, size and seed.
  const table = new Float32Array(SWARM_ROW_FLOATS * MIDGE_SWARMS_MAX);
  const fulls = new Float32Array(ROWS);
  const distances = new Float32Array(ROWS);
  const counts = new Float32Array(ROWS);
  const radii = new Float32Array(ROWS);
  const heights = new Float32Array(ROWS);
  const seeds = new Float32Array(ROWS);
  const columns = new Uint8Array(ROWS);
  const frames: SwarmFrame[] = [];
  for (let r = 0; r < ROWS; r++) frames.push({ cx: 0, cy: 0, cz: 0, swirl: 0, flatten: 0 });
  for (let r = 0; r < markerRows; r++) {
    const m = markers[r]!;
    radii[r] = m.radius;
    heights[r] = m.height;
    seeds[r] = m.seed;
    columns[r] = m.column ? 1 : 0;
  }
  const midgeFrame: MidgeFrame = {
    eyeX: 0, eyeY: 0, eyeZ: 0, time: 0,
    sunX: 0, sunY: 1, sunZ: 0, sunR: 0, sunG: 0, sunB: 0,
    glowR: 0, glowG: 0, glowB: 0,
    night: 0, skyLuma: 0, pixelAt1m: 0, table,
  };

  // The heads, and what the players did since the last frame.
  const heads = createHeads(seed);
  /** Each head swarm's share of the midges' presence: it gathers over
   * WATER_LIFE_EASE_S once its swarm forms, and thins out as long, where
   * the head last was, once the swarm lets go. */
  const headShares = new Float64Array(MAX_PLAYERS);
  /** Each row's presence this frame, as drawn and as heard: the midges' own
   * for a marker's swarm, times its share for a head's. */
  const rowPresence = new Float64Array(ROWS);
  /** The players there are this frame, in slot order: what the dragonflies and the frogs read. */
  const present: PlayerAt[] = [];
  const speeds: number[] = new Array<number>(MAX_PLAYERS).fill(0);
  const inBand: boolean[] = new Array<boolean>(MAX_PLAYERS).fill(false);
  const lastX = new Float64Array(MAX_PLAYERS);
  const lastZ = new Float64Array(MAX_PLAYERS);
  const known = new Uint8Array(MAX_PLAYERS);

  // The presence drawn and heard, eased toward the weather's, read each
  // frame into a record made once.
  const presence = noPresence();
  const target = noPresence();
  let primed = false;

  const sound: WaterLifeSound = {
    hums: [], hums_n: 0, pitch: 0, rustles: NO_RUSTLES, frogCalls: NO_CALLS,
    // The far chorus's places: with a layout made ahead they came with it, and the shore is walked here only without.
    bed: { level: 0, duck: [1, 1], points: made !== null && made !== undefined ? made.bed : waterLifeBed(lake, layout.voices) },
  };
  for (let r = 0; r < ROWS; r++) sound.hums.push({ x: 0, y: 0, z: 0, midges: 0, presence: 0 });
  let resting = false;
  let disposed = false;

  function ease(f: WaterLifeFrame, dt: number): void {
    const want = waterLifePresenceUnder(f.weather, f.hour, f.wind.speed, target);
    if (!primed) {
      // The first frame in reach takes the weather's presence outright, as
      // the animals do, rather than fading in a lake no one saw empty.
      copyPresence(want, presence);
      primed = true;
      return;
    }
    const step = dt / WATER_LIFE_EASE_S;
    presence.midge = rampTo(presence.midge, want.midge, step);
    presence.midgeFullness = rampTo(presence.midgeFullness, want.midgeFullness, step);
    rampShare(presence.darner, want.darner, step);
    rampShare(presence.skimmer, want.skimmer, step);
    rampShare(presence.damselfly, want.damselfly, step);
    presence.frog = rampTo(presence.frog, want.frog, step);
  }

  /** Each player's speed over the ground since the last frame, and whether they
   * stand in the shore band; and the players there are, gathered. */
  function measure(players: WaterLifeFrame["players"], frameDt: number): void {
    let n = 0;
    for (let i = 0; i < players.length; i++) {
      const p = players[i];
      if (p !== undefined) present[n++] = p;
    }
    present.length = n;
    for (let i = 0; i < MAX_PLAYERS; i++) {
      const p = players[i];
      if (p === undefined) {
        known[i] = 0;
        speeds[i] = 0;
        inBand[i] = false;
        continue;
      }
      if (known[i] === 0) speeds[i] = 0;
      else if (frameDt > 0) speeds[i] = Math.hypot(p.x - lastX[i]!, p.z - lastZ[i]!) / frameDt;
      known[i] = 1;
      lastX[i] = p.x;
      lastZ[i] = p.z;
      inBand[i] = inShoreBand(lake, p.x, p.z);
    }
  }

  /** Each chorus loop's quieting by the nearest player's distance to its
   * place, over the ground: `BED_FLOOR` within `FROG_QUIET_RADIUS`, rising
   * linearly to whole at `FROG_BED_REF`, whole with no player. */
  function duckBed(): void {
    const points = sound.bed.points;
    for (let k = 0; k < points.length; k++) {
      const p = points[k]!;
      let nearest = Infinity;
      for (let i = 0; i < present.length; i++) {
        const d = Math.hypot(present[i]!.x - p.x, present[i]!.z - p.z);
        if (d < nearest) nearest = d;
      }
      const rise = Math.min(Math.max((nearest - FROG_QUIET_RADIUS) / (FROG_BED_REF - FROG_QUIET_RADIUS), 0), 1);
      sound.bed.duck[k] = Math.max(rise, BED_FLOOR);
    }
  }

  /** Fills the swarms' table: each row's frame, then its share of the tier's
   * midges, and its presence; a head's row eases in and out by its share.
   * Returns how many are drawn. */
  function stepMidges(f: WaterLifeFrame, dt: number): number {
    const mp = presence.midge;
    stepHeads(heads, f.players, speeds, inBand, mp, dt);
    const t = f.time;
    const wind = f.wind;
    for (let r = 0; r < ROWS; r++) {
      fulls[r] = 0;
      distances[r] = Infinity;
      rowPresence[r] = r < HEAD_ROW0 ? mp : 0;
    }
    for (let r = 0; r < markerRows; r++) {
      const m = markers[r]!;
      const dx = m.x - f.camX;
      const dy = m.y - f.camY;
      const dz = m.z - f.camZ;
      // A swarm out of sight costs nothing: its row is drawn with no midge.
      if (mp <= 0 || dx * dx + dy * dy + dz * dz > (MIDGE_CUTOFF + SHIFT_RADII * m.radius) ** 2) continue;
      const fr = frames[r]!;
      swarmFrame(m.x, m.y, m.z, m.radius, m.column, m.seed, t, wind.dirX, wind.dirZ, wind.speed, fr);
      distances[r] = Math.hypot(fr.cx - f.camX, fr.cy - f.camY, fr.cz - f.camZ);
      fulls[r] = Math.min(blocks[r]!, m.midges * presence.midgeFullness);
    }
    for (let h = 0; h < MAX_PLAYERS; h++) {
      const row = HEAD_ROW0 + h;
      const head = heads[h];
      // Let go, the swarm keeps the head's last place while it thins out.
      const share = rampTo(headShares[h]!, head !== undefined && head.active ? 1 : 0, dt / WATER_LIFE_EASE_S);
      headShares[h] = share;
      rowPresence[row] = mp * share;
      if (head === undefined || share <= 0 || mp <= 0) continue;
      const radius = headRadius(head.midges);
      radii[row] = radius;
      heights[row] = radius;
      seeds[row] = head.seed;
      const fr = frames[row]!;
      swarmFrame(head.x, head.y, head.z, radius, false, head.seed, t, wind.dirX, wind.dirZ, wind.speed, fr);
      distances[row] = Math.hypot(fr.cx - f.camX, fr.cy - f.camY, fr.cz - f.camZ);
      fulls[row] = Math.min(HEAD_MIDGES[1], head.midges);
    }
    shareBudget(fulls, distances, ROWS, MIDGE_TIER_MAX[tier], counts);
    let total = 0;
    for (let r = 0; r < ROWS; r++) {
      const count = counts[r]!;
      packSwarm(table, r, frames[r]!, radii[r]!, heights[r]!, count, rowPresence[r]!, columns[r] === 1, seeds[r]!);
      total += count;
    }
    return total;
  }

  function fillMidges(f: WaterLifeFrame): MidgeFrame {
    midgeFrame.eyeX = f.camX;
    midgeFrame.eyeY = f.camY;
    midgeFrame.eyeZ = f.camZ;
    midgeFrame.time = f.time;
    const sky = f.sky;
    if (sky !== null) {
      midgeFrame.sunX = sky.sunDir.x;
      midgeFrame.sunY = sky.sunDir.y;
      midgeFrame.sunZ = sky.sunDir.z;
      midgeFrame.sunR = sky.sunColour.r * sky.sunIntensity;
      midgeFrame.sunG = sky.sunColour.g * sky.sunIntensity;
      midgeFrame.sunB = sky.sunColour.b * sky.sunIntensity;
      // The horizon toward the sun as the dome draws it level, the disc
      // aside: the table's ring already times the dome's scale, with the
      // cloud deck and the night's floor in it, blended toward the mist's air
      // by the mist's weight as the dome blends its horizon.
      const toward = sky.horizonToward;
      const air = sky.mistAir;
      const mist = sky.mistWeight;
      midgeFrame.glowR = toward.r + (air.r - toward.r) * mist;
      midgeFrame.glowG = toward.g + (air.g - toward.g) * mist;
      midgeFrame.glowB = toward.b + (air.b - toward.b) * mist;
      midgeFrame.night = sky.night;
    } else {
      // Before the sky's first slices: no sun, no glow, and the day's night factor.
      midgeFrame.sunX = 0;
      midgeFrame.sunY = 1;
      midgeFrame.sunZ = 0;
      midgeFrame.sunR = 0;
      midgeFrame.sunG = 0;
      midgeFrame.sunB = 0;
      midgeFrame.glowR = 0;
      midgeFrame.glowG = 0;
      midgeFrame.glowB = 0;
      midgeFrame.night = 0;
    }
    midgeFrame.skyLuma = f.skyLuma;
    midgeFrame.pixelAt1m = f.pixelAt1m;
    return midgeFrame;
  }

  /** Every swarm's hum, its row's index its identity from frame to frame,
   * at its row's presence: a row with no swarm this frame (out of sight,
   * gone, or a player not standing still) is listed with none.
   * `waterLifeAudio.ts` picks the nearest within earshot. */
  function listHums(): void {
    for (let r = 0; r < ROWS; r++) {
      const fr = frames[r]!;
      const hum = sound.hums[r]!;
      hum.x = fr.cx;
      hum.y = fr.cy;
      hum.z = fr.cz;
      hum.midges = fulls[r]!;
      hum.presence = fulls[r]! > 0 ? rowPresence[r]! : 0;
    }
    sound.hums_n = ROWS;
  }

  /** Out of reach: nothing drawn, nothing heard, nothing stepped, and the
   * heads let go, gone outright rather than thinning out where no one sees
   * them, so none is kept for a slot whose player leaves meanwhile. */
  function rest(draws: WaterLifeDraws): void {
    if (!resting) {
      draws.midges(null);
      draws.dragonflies(noDragonflies, seed);
      for (const h of heads) {
        h.active = false;
        h.still = 0;
        h.fast = 0;
      }
      headShares.fill(0);
      resting = true;
    }
    primed = false;
    known.fill(0);
    sound.hums_n = 0;
    sound.rustles = NO_RUSTLES;
    sound.frogCalls = NO_CALLS;
    sound.bed.level = 0;
  }

  return {
    blocks,
    update(f, draws) {
      // Gone with its renderer: a late call must not refill the sound.
      if (disposed) return;
      const dx = f.camX - lake.x;
      const dz = f.camZ - lake.z;
      if (dx * dx + dz * dz > reach * reach) {
        rest(draws);
        return;
      }
      resting = false;
      const frameDt = f.dt > 0 ? f.dt : 0;
      const dt = Math.min(frameDt, WATER_LIFE_DT_MAX);
      ease(f, dt);
      measure(f.players, frameDt);
      draws.midges(stepMidges(f, dt) > 0 ? fillMidges(f) : null);
      dragonflies.step(f.tick, dt, f.camX, f.camY, f.camZ, present, presence);
      draws.dragonflies(dragonflies, seed);
      frogs.step(f.time, dt, present, f.hollowDistance, presence.frog);
      listHums();
      sound.pitch = midgeHumPitch(summerTemperature(f.hour, f.weather));
      sound.rustles = dragonflies.rustles;
      sound.frogCalls = frogs.calls;
      sound.bed.level = frogs.stopped ? 0 : presence.frog * (BED_FLOOR + (1 - BED_FLOOR) * (1 - frogs.hushedShare));
      duckBed();
    },
    rest(draws) {
      if (disposed) return;
      rest(draws);
    },
    sound() {
      return sound;
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      sound.hums_n = 0;
      sound.rustles = NO_RUSTLES;
      sound.frogCalls = NO_CALLS;
      sound.bed.level = 0;
    },
  };
}
