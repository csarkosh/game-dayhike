/**
 * The swash along the cove: one row of SWASH_COLUMNS columns, one a metre of
 * shore, refilled in place from the shared clock each frame. The sea's
 * shaders read it as a texture to lay the sheet on the pebbles, the wet
 * ground reads it for the moving wet line, and the surf's sound reads its
 * backwash. Babylon-free (on BABYLON_FREE_FILES).
 *
 * Each column watches the swell at the face's toe (d = toeD, x =
 * coastX(z) + toeD) and finds a crest passing there exactly as
 * `boreArrivals` does: the crest phase, falling with time, wraps through 0
 * between two frames, the time found by linear interpolation and the height
 * the greater of the two frames' (unbroken · scale). Every crest that reaches
 * the toe ends on the face, broken already or plunging there, so each one
 * sets a sheet off up the face when it reaches the still waterline, `transit`
 * seconds later: the amplitude-weighted mean of each component's phase from
 * the toe to the waterline over its frequency, the time its crests take to
 * cross. The sheet runs up by `swashRunUp` with the face's Iribarren number
 * (the face's grade over √(Hs/L0), the field's significant height and its
 * deep wavelength g·Tp²/2π) and a reach held to the column's cap, `reachCapAt`, which lobes along the shore.
 *
 * Distances up the face are from the still waterline (d = 0). Per column the
 * row holds the front, the sheet's thickness at the waterline (it falls
 * linearly to 0 at the front), the wet reach and its age: the reach follows
 * the front up and holds as it falls back, the age counting from the last
 * time a front stood at the reach (within SWASH_REWET_M); once the age passes
 * SWASH_DRY_S the line falls to the present front. Columns past the cove's end blend hold zeros
 * and SWASH_AGE_MAX.
 *
 * The swell at the toe is the field's sum with its time-invariant part made
 * once a column (`swellAtInto` under zero phases): each frame takes one sine
 * and cosine a component and sums every column by angle addition, so a frame
 * costs a few multiplies a component a column.
 */
import { COVE_END_BLEND } from "../sim/olympic.js";
import { OCEAN_G } from "./oceanPhysics.js";
import { SWELL_COMPONENTS, type SwellComponent } from "./oceanSwell.js";
import { swellAtInto, swellBreakInto, swellScratch, type OceanField } from "./oceanWaves.js";
import {
  SWASH_DOWN_RATIO, frontAt, overlap, reachCapAt, runUpAlongFace, thicknessAt, tUpOf,
} from "./swashRunUp.js";

/** One a metre of shore, column 0 at z0 − SWASH_COLUMNS/2. */
export const SWASH_COLUMNS = 512;
/** Floats a column: front (m up the face), thickness (m), wet reach (m up the face), age (s since last wetted). */
export const SWASH_STRIDE = 4;
/** The age of a column never wetted, and the most any age reads. */
export const SWASH_AGE_MAX = 600;
/** The wet ground's drying time (s), read by the wet plugin. */
export const SWASH_DRY_S = 60;
/** The foam speckle's life on the wet band (s) after the front turns, read by the wet plugin. */
export const SWASH_SPECKLE_S = 10;
/** The sheets a column carries at once; a crest past that takes the oldest's place. */
export const SWASH_BORES_PER_COLUMN = 4;
/** A front that turns from a reach over this (m) is a backwash event. */
export const SWASH_BACKWASH_MIN_M = 2;
/** A front within this (m) of the wet reach wets the line again: frames sample a front's turn a little short of it. */
export const SWASH_REWET_M = 0.1;
/** A step longer than this (s), a stalled page or a jump of the clock, finds no crest: the watch starts again.
 * A step back of up to this is a hold; a longer one back starts the table dry. */
export const SWASH_STEP_MAX_S = 1;

export type SwashCove = { z0: number; halfWidth: number; toeD: number; faceGrade: number; coastX: (z: number) => number };

const TWO_PI = 2 * Math.PI;
const HALF = SWASH_COLUMNS / 2;

function mod(x: number, m: number): number {
  return x - m * Math.floor(x / m);
}

export class SwashTable {
  /** SWASH_COLUMNS × SWASH_STRIDE floats, refilled in place by `update`: the texture's and the wet plugin's source. */
  readonly data: Float32Array;
  /** Crests that passed a column's toe since the last update, refilled in place; `broken` as `boreArrivals` finds them. */
  readonly arrivals: { count: number; column: Int32Array; t: Float64Array; height: Float64Array; broken: Uint8Array };
  /** Fronts that turned from a reach over SWASH_BACKWASH_MIN_M since the last update, refilled in place. */
  readonly backwash: { count: number; column: Int32Array; reach: Float32Array };
  /** The face's Iribarren number: faceGrade / √(Hs / L0). */
  readonly iribarren: number;
  /** Seconds a crest takes from a column's toe to its waterline; 0 outside the cove. */
  readonly transit: Float32Array;

  private readonly field: OceanField;
  private readonly cove: SwashCove;
  private readonly n: number;
  private readonly first: number;
  private readonly last: number;
  private readonly cosB: Float64Array;
  private readonly sinB: Float64Array;
  private readonly amp: Float64Array;
  private readonly depth: Float64Array;
  private readonly weggelA: Float64Array;
  private readonly weggelB: Float64Array;
  private readonly cosT: Float64Array;
  private readonly sinT: Float64Array;
  private readonly prevQ: Float64Array;
  private readonly prevHeight: Float64Array;
  private readonly prevBroken: Uint8Array;
  private readonly boreLaunch: Float64Array;
  private readonly boreHeight: Float64Array;
  private readonly boreReach: Float64Array;
  /** Each column's cap on a bore's reach (m): `reachCapAt`, made once. */
  private readonly reachCap: Float64Array;
  private readonly boreNext: Uint8Array;
  private readonly wetReach: Float64Array;
  private readonly wetAt: Float64Array;
  private readonly brk = { ratio: 0, scale: 1 };
  private readonly sheet = { front: 0, thick: 0 };
  private seconds = Number.NaN;
  private watching = false;

  constructor(field: OceanField, cove: SwashCove) {
    this.field = field;
    this.cove = cove;
    const n = field.count;
    this.n = n;
    const deepLength = (OCEAN_G * field.tp * field.tp) / TWO_PI;
    this.iribarren = cove.faceGrade / Math.sqrt(Math.max(field.hs, 1e-6) / deepLength);
    this.data = new Float32Array(SWASH_COLUMNS * SWASH_STRIDE);
    this.arrivals = {
      count: 0, column: new Int32Array(SWASH_COLUMNS), t: new Float64Array(SWASH_COLUMNS),
      height: new Float64Array(SWASH_COLUMNS), broken: new Uint8Array(SWASH_COLUMNS),
    };
    this.backwash = { count: 0, column: new Int32Array(SWASH_COLUMNS), reach: new Float32Array(SWASH_COLUMNS) };
    this.transit = new Float32Array(SWASH_COLUMNS);
    const span = cove.halfWidth + COVE_END_BLEND;
    this.first = Math.max(0, Math.ceil(HALF - span));
    this.last = Math.min(SWASH_COLUMNS - 1, Math.floor(HALF + span));
    this.cosB = new Float64Array(SWASH_COLUMNS * n);
    this.sinB = new Float64Array(SWASH_COLUMNS * n);
    this.amp = new Float64Array(SWASH_COLUMNS * n);
    this.depth = new Float64Array(SWASH_COLUMNS);
    this.weggelA = new Float64Array(SWASH_COLUMNS);
    this.weggelB = new Float64Array(SWASH_COLUMNS);
    this.cosT = new Float64Array(n);
    this.sinT = new Float64Array(n);
    this.prevQ = new Float64Array(SWASH_COLUMNS);
    this.prevHeight = new Float64Array(SWASH_COLUMNS);
    this.prevBroken = new Uint8Array(SWASH_COLUMNS);
    this.boreLaunch = new Float64Array(SWASH_COLUMNS * SWASH_BORES_PER_COLUMN);
    this.boreHeight = new Float64Array(SWASH_COLUMNS * SWASH_BORES_PER_COLUMN);
    this.boreReach = new Float64Array(SWASH_COLUMNS * SWASH_BORES_PER_COLUMN);
    this.reachCap = new Float64Array(SWASH_COLUMNS);
    for (let col = 0; col < SWASH_COLUMNS; col++) this.reachCap[col] = reachCapAt(col);
    this.boreNext = new Uint8Array(SWASH_COLUMNS);
    this.wetReach = new Float64Array(SWASH_COLUMNS);
    this.wetAt = new Float64Array(SWASH_COLUMNS);

    // The time-invariant part of the swell at each column's toe and waterline.
    const zero = new Float32Array(Math.max(n, SWELL_COMPONENTS));
    const toe = swellScratch(field);
    const shore = swellScratch(field);
    for (let col = this.first; col <= this.last; col++) {
      const z = cove.z0 - HALF + col;
      const cx = cove.coastX(z);
      swellAtInto(field, zero, cx + cove.toeD, z, toe);
      swellAtInto(field, zero, cx, z, shore);
      let weight = 0;
      let lag = 0;
      for (let k = 0; k < n; k++) {
        const base = toe.phase[k] as number;
        const a = toe.amp[k] as number;
        this.cosB[col * n + k] = Math.cos(base);
        this.sinB[col * n + k] = Math.sin(base);
        this.amp[col * n + k] = a;
        const omega = (field.components[k] as SwellComponent).omega;
        weight += a;
        lag += (a * ((shore.phase[k] as number) - base)) / omega;
      }
      this.transit[col] = weight > 0 ? lag / weight : 0;
      this.depth[col] = toe.sample.depth;
      this.weggelA[col] = toe.weggelA;
      this.weggelB[col] = toe.weggelB;
    }
    this.reset();
  }

  /** The column of a world z, rounded to the nearest column centre and clamped to [0, SWASH_COLUMNS − 1]. */
  columnOf(z: number): number {
    const v = z - this.cove.z0 + HALF;
    return Math.floor((v >= 0 ? Math.min(v, SWASH_COLUMNS - 1) : 0) + 0.5);
  }

  /** Advance to the shared seconds under that moment's phases (`swellPhases`). */
  update(seconds: number, phases: Float32Array): void {
    this.arrivals.count = 0;
    this.backwash.count = 0;
    if (!Number.isFinite(seconds)) return;
    const before = this.seconds;
    // A client's tick reconciled to the host's steps back a tick or two: hold
    // until the seconds pass the latest counted. A longer jump back starts again.
    if (seconds < before) {
      if (before - seconds <= SWASH_STEP_MAX_S) return;
      this.reset();
    } else if (seconds === before) return;
    const step = seconds - this.seconds;
    const watch = this.watching && step <= SWASH_STEP_MAX_S;
    const n = this.n;
    for (let k = 0; k < n; k++) {
      const theta = phases[k] as number;
      this.cosT[k] = Math.cos(theta);
      this.sinT[k] = Math.sin(theta);
    }
    const tp = this.field.tp;
    const iribarren = this.iribarren;
    const grade = this.cove.faceGrade;
    const data = this.data;
    const sheet = this.sheet;
    const amp = this.amp;
    const cosB = this.cosB;
    const sinB = this.sinB;
    const cosT = this.cosT;
    const sinT = this.sinT;
    for (let col = this.first; col <= this.last; col++) {
      // The crest at the toe: the sum by angle addition, then the break.
      let sx = 0;
      let sy = 0;
      const o = col * n;
      for (let k = 0; k < n; k++) {
        const a = amp[o + k] as number;
        const cb = cosB[o + k] as number;
        const sb = sinB[o + k] as number;
        const ct = cosT[k] as number;
        const st = sinT[k] as number;
        sx += a * (cb * ct - sb * st);
        sy += a * (sb * ct + cb * st);
      }
      const unbroken = 2 * Math.sqrt(sx * sx + sy * sy);
      swellBreakInto(unbroken, this.depth[col] as number, this.weggelA[col] as number, this.weggelB[col] as number, tp, this.brk);
      const broken = this.brk.ratio > 1;
      const height = unbroken * this.brk.scale;
      const q = mod(Math.atan2(sy, sx), TWO_PI);
      const prevQ = this.prevQ[col] as number;
      if (watch && q - prevQ > Math.PI) {
        const f = prevQ / (prevQ + TWO_PI - q);
        const t = this.seconds + f * step;
        const h = Math.max(this.prevHeight[col] as number, height);
        const i = this.arrivals.count++;
        this.arrivals.column[i] = col;
        this.arrivals.t[i] = t;
        this.arrivals.height[i] = h;
        this.arrivals.broken[i] = this.prevBroken[col] === 1 || broken ? 1 : 0;
        const slot = col * SWASH_BORES_PER_COLUMN + (this.boreNext[col] as number);
        this.boreNext[col] = ((this.boreNext[col] as number) + 1) % SWASH_BORES_PER_COLUMN;
        this.boreLaunch[slot] = t + (this.transit[col] as number);
        this.boreHeight[slot] = h;
        this.boreReach[slot] = Math.min(runUpAlongFace(h, iribarren, grade), this.reachCap[col] as number);
      }
      this.prevQ[col] = q;
      this.prevHeight[col] = height;
      this.prevBroken[col] = broken ? 1 : 0;

      // The live sheets, overlapped.
      sheet.front = 0;
      sheet.thick = 0;
      for (let b = 0; b < SWASH_BORES_PER_COLUMN; b++) {
        const slot = col * SWASH_BORES_PER_COLUMN + b;
        const h = this.boreHeight[slot] as number;
        if (!(h > 0)) continue;
        const reach = this.boreReach[slot] as number;
        const tUp = tUpOf(reach, h);
        const tDown = SWASH_DOWN_RATIO * tUp;
        const age = seconds - (this.boreLaunch[slot] as number);
        if (age > tUp + tDown) {
          this.boreHeight[slot] = 0;
          continue;
        }
        const was = this.seconds - (this.boreLaunch[slot] as number);
        if (watch && was < tUp && age >= tUp && reach > SWASH_BACKWASH_MIN_M && this.backwash.count < SWASH_COLUMNS) {
          const i = this.backwash.count++;
          this.backwash.column[i] = col;
          this.backwash.reach[i] = reach;
        }
        const front = frontAt(age, reach, h);
        if (!(front > 0)) continue;
        const retreating = age > tUp ? (age - tUp) / tDown : 0;
        overlap(sheet.front, sheet.thick, front, thicknessAt(0, front, h, retreating), sheet);
      }

      // The wet line: up with the front, held as it falls back, down to the front once dry.
      const front = sheet.front;
      const wetAt = this.wetAt[col] as number;
      let wetAge = Number.isNaN(wetAt) ? SWASH_AGE_MAX : Math.min(Math.max(seconds - wetAt, 0), SWASH_AGE_MAX);
      if (wetAge >= SWASH_DRY_S) this.wetReach[col] = front;
      if (front > 0 && front >= (this.wetReach[col] as number) - SWASH_REWET_M) {
        this.wetReach[col] = Math.max(this.wetReach[col] as number, front);
        this.wetAt[col] = seconds;
        wetAge = 0;
      }
      const d = col * SWASH_STRIDE;
      data[d] = front;
      data[d + 1] = sheet.thick;
      data[d + 2] = this.wetReach[col] as number;
      data[d + 3] = wetAge;
    }
    this.seconds = seconds;
    this.watching = true;
  }

  /** Back to no sheet anywhere and nothing watched: the first update and a clock run back past SWASH_STEP_MAX_S start here. */
  private reset(): void {
    this.seconds = Number.NaN;
    this.watching = false;
    this.boreHeight.fill(0);
    this.boreNext.fill(0);
    this.wetReach.fill(0);
    this.wetAt.fill(Number.NaN);
    this.data.fill(0);
    for (let col = 0; col < SWASH_COLUMNS; col++) this.data[col * SWASH_STRIDE + 3] = SWASH_AGE_MAX;
  }
}

/** The sheet's floor (m), thinner being no sheet, and the least front its
 * taper divides by: `SWASH_SHEET_MIN` in oceanSwash.fx. */
export const SWASH_SHEET_MIN = 0.001;

/** The depth (m) under which the sea's fragment stage takes the sea as
 * resting on the ground, a hundredth of a millimetre: `OCEAN_REST_EPS` in
 * oceanSwash.fx, as waterLights.fragment.fx holds the depth to it. */
export const SWASH_REST_EPS = 1e-5;

/** The column `oceanSwash.fx` reads at world z: the row's nearest texel, the
 * cove's centre z0 at column SWASH_COLUMNS / 2, held to the table; 0 for a z
 * that is not a number, as `columnOf` has it. */
export function swashColumnAt(z: number, z0: number): number {
  const c = Math.min(Math.max(z - z0 + SWASH_COLUMNS / 2, 0), SWASH_COLUMNS - 1);
  return Number.isNaN(c) ? 0 : Math.floor(c + 0.5);
}

/**
 * The sheet's thickness (m) at d, metres up the face from the still
 * waterline (negative seaward), and world z, read from the table's data as
 * `swashSheet` in oceanSwash.fx reads its texture: the column's thickness
 * at the waterline, thinning to nothing at its front, held to it seaward,
 * none past the front or seaward of the face's toe.
 */
export function sheetAt(d: number, z: number, data: Float32Array, cove: SwashCove): number {
  const o = swashColumnAt(z, cove.z0) * SWASH_STRIDE;
  const front = data[o] as number;
  const thickness = data[o + 1] as number;
  const cover = (d >= cove.toeD ? 1 : 0) * (front >= d ? 1 : 0);
  return cover * thickness * Math.min(1, Math.max(0, 1 - d / Math.max(front, SWASH_SHEET_MIN)));
}

/** The cove's end fade (m): `OCEAN_COVE_END` in oceanSwash.fx, as the wet
 * ground's (`WET_COVE_END`, wet.fragment.fx). */
export const SWASH_COVE_END = 30;

/** GLSL's smoothstep: x held to the edges, then 3t² − 2t³. */
function smoothstep(e0: number, e1: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
}

/** The cove's share at world z, as `oceanCoveShare` (oceanSwash.fx) and the
 * wet ground's (wet.fragment.fx) make it: 1 across the cove, 0 past
 * SWASH_COVE_END beyond either end. */
export function coveShareAt(z: number, cove: SwashCove): number {
  return 1 - smoothstep(cove.halfWidth - SWASH_COVE_END, cove.halfWidth + SWASH_COVE_END, Math.abs(z - cove.z0));
}

/** How far the sheet lifts the sea over ground `depth` metres below the
 * level (negative above it), the swell's height `swell` already on the
 * surface, as `swashLift` in oceanSwash.fx does: to the sheet's top where it
 * stands higher than the still sea, and wherever the cove has any share, its
 * ends' fades whole (GLSL's `step(1.0e-6, share)`), up to the ground wherever
 * the surface would lie under it, so the sea rests on the pebbles between
 * sheets, its depth there 0. */
export function sheetLiftAt(
  d: number, z: number, depth: number, swell: number, data: Float32Array, cove: SwashCove,
): number {
  const sheet = sheetAt(d, z, data, cove);
  const lift = sheet >= SWASH_SHEET_MIN ? Math.max(0, sheet - depth) : 0;
  const rest = coveShareAt(z, cove) >= 1e-6 ? Math.max(0, -(depth + swell)) : 0;
  return Math.max(lift, rest);
}
