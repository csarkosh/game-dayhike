/**
 * The motes as a field a vertex stage can place, with no engine and no
 * particle kept from frame to frame: every mote's place, size and fade is a
 * function of its slot, the clock and the settings `motesParams.ts` gives
 * for the hour and the weather. `lite/motes.ts` draws it; the arithmetic is
 * here twice over, as the numbers a renderer hands its stage (`moteSlots`,
 * `moteUniforms`) and as the stage's own steps in plain code (`moteAt`),
 * which the tests read and the stage's text is held to.
 *
 * It keeps the look of a pair of particle systems, the pollen's and the
 * frost's:
 *
 * - **A slot a particle of the tier's capacity**, a third of it a species.
 *   A slot lives one life after another. Where a system's pool is full
 *   every slot is shown; under a low rate the share shown is the pool's
 *   steady count, the rate times the mean life.
 * - **A life** is as long as a particle's: between the species' shortest
 *   and longest, weighted by its length, since of the particles alive at
 *   any moment the long-lived are the more. A slot keeps one length and its
 *   own phase of it, so the slots do not turn over together.
 * - **A birth** is anywhere in the emitter's box round the eye; each life
 *   takes a new place, a new drift within the species' jitter, and a new
 *   size. A mote fades from the motes' alpha at its birth to nothing at its
 *   end, as a particle's colour runs to its dead colour.
 * - **The clock is the particles' own**: Babylon.js steps a system 0.01 a
 *   frame at sixty frames a second, so a second is 0.6 of the units the
 *   species' lives, rises and jitters are given in (`MOTE_CLOCK_RATE`).
 *
 * Where it parts from the particle systems: the births are places in a
 * field fixed in the world that repeats every box and is seen through the
 * box round the eye, carried by the wind as one. So a walker has the whole
 * box of motes round them, where the particles are born round the eye and
 * left behind; and a wind that changes carries every mote alike from then
 * on, where a particle keeps the wind of its birth.
 *
 * Loads no engine.
 */
import type { Rgb } from "./colour.js";
import { MOTE_BOX_HALF, MOTE_BOX_HALF_HEIGHT, MOTE_ALPHA, MOTE_SPECIES, moteCapacity, type MoteSettings, type MotesRecord } from "./motesParams.js";
import type { QualityTier } from "./quality.js";

/** Units of the particles' clock a second: Babylon.js's update speed, 0.01 a frame, at its sixty frames a second. */
export const MOTE_CLOCK_RATE = 0.6;

/** The emitter's box, metres a side: the field repeats by it. */
export const MOTE_BOX: readonly [number, number, number] = [MOTE_BOX_HALF * 2, MOTE_BOX_HALF_HEIGHT * 2, MOTE_BOX_HALF * 2];

/** Floats a slot is in the instance list: a thin instance's sixteen, of which the first three are read. */
export const MOTE_SLOT_FLOATS = 16;

/** What each draw of a slot's randoms is for: one salt each, so no two share a number. */
export const MOTE_SALT = { life: 1, phase: 2, x: 3, y: 4, z: 5, driftX: 6, driftY: 7, driftZ: 8, size: 9 } as const;

/** A 32-bit mix (PCG's output step), which the stage computes the same in integers. */
export function moteHash(n: number): number {
  let h = (Math.imul(n >>> 0, 747796405) + 2891336453) >>> 0;
  h = Math.imul((h >>> ((h >>> 28) + 4)) ^ h, 277803737) >>> 0;
  return ((h >>> 22) ^ h) >>> 0;
}

/** A number in [0, 1) for a slot's `life` (0: the slot's own, kept for every life) and a salt. */
export function moteRandom(slot: number, life: number, salt: number): number {
  return (moteHash((slot ^ moteHash((Math.imul(life >>> 0, 0x9e3779b9) + salt) >>> 0)) >>> 0) >>> 8) / 16777216;
}

/**
 * The tier's slots as an instance list: for each, its number, its species
 * (the species' place in MOTE_SPECIES) and its rank among its species'
 * slots, in [0, 1): a slot is shown while its rank is under the species'
 * share. Null on a tier with no capacity.
 */
export function moteSlots(tier: QualityTier): { data: Float32Array; count: number } | null {
  const each = moteCapacity(tier);
  if (each === 0) return null;
  const count = each * MOTE_SPECIES.length;
  const data = new Float32Array(count * MOTE_SLOT_FLOATS);
  for (let slot = 0; slot < count; slot++) {
    const at = slot * MOTE_SLOT_FLOATS;
    data[at] = slot;
    data[at + 1] = Math.floor(slot / each);
    data[at + 2] = ((slot % each) + 0.5) / each;
  }
  return { data, count };
}

/** The share of a species' slots shown: its pool's steady count, the rate times the mean life, over its capacity. */
export function moteShare(settings: MoteSettings, capacity: number): number {
  if (capacity <= 0 || settings.rate <= 0) return 0;
  return Math.min(1, (settings.rate * (settings.minLife + settings.maxLife)) / 2 / capacity);
}

/**
 * The wind's carry of the field, metres in x and z, stepped by `seconds` of
 * the render clock under the frame's drift (`MotesRecord.drift`, a metre a
 * unit of the particles' clock). At most a second a step, so a suspended
 * tab resumes where it left off; kept within a box, which the field
 * repeats by.
 */
export function stepMoteTravel(travel: { x: number; z: number }, drift: { readonly x: number; readonly z: number }, seconds: number): void {
  const dt = Math.min(1, Math.max(0, seconds)) * MOTE_CLOCK_RATE;
  travel.x = (travel.x + drift.x * dt) % MOTE_BOX[0];
  travel.z = (travel.z + drift.z * dt) % MOTE_BOX[2];
}

/** The motes' uniforms by name. A species' `Span` is (its smallest size, its largest, its shortest life, its longest),
 * its `Drift` (its rise, its jitter, the share of its slots shown, nothing). */
export type MoteUniforms = {
  /** The particles' clock: the render clock by MOTE_CLOCK_RATE. */
  moteClock: [number];
  moteTravel: [number, number];
  motePollenSpan: [number, number, number, number];
  motePollenDrift: [number, number, number, number];
  moteFrostSpan: [number, number, number, number];
  moteFrostDrift: [number, number, number, number];
  /** The air's near colour, and the alpha a mote is born with. */
  moteColour: [number, number, number, number];
  moteExposure: [number];
  moteContrast: [number];
};

/** A record of the right shape, every component zero, for `moteUniforms` to fill. */
export function emptyMoteUniforms(): MoteUniforms {
  return {
    moteClock: [0], moteTravel: [0, 0], motePollenSpan: [0, 0, 0, 0], motePollenDrift: [0, 0, 0, 0], moteFrostSpan: [0, 0, 0, 0],
    moteFrostDrift: [0, 0, 0, 0], moteColour: [0, 0, 0, 0], moteExposure: [0], moteContrast: [0],
  };
}

function species(settings: MoteSettings, capacity: number, span: [number, number, number, number], drift: [number, number, number, number]): void {
  span[0] = settings.minSize;
  span[1] = settings.maxSize;
  span[2] = settings.minLife;
  span[3] = settings.maxLife;
  drift[0] = settings.rise;
  drift[1] = settings.jitter;
  drift[2] = moteShare(settings, capacity);
  drift[3] = 0;
}

/**
 * The uniforms for `record` (`motesUnder`) on `tier` at `seconds` of the
 * render clock, the field carried `travel` by the wind. Fills and returns
 * `out` (a record of its own when none is given).
 */
export function moteUniforms(
  record: MotesRecord, tier: QualityTier, seconds: number, travel: { readonly x: number; readonly z: number }, exposure: number, contrast: number,
  out: MoteUniforms = emptyMoteUniforms(),
): MoteUniforms {
  const capacity = moteCapacity(tier);
  out.moteClock[0] = seconds * MOTE_CLOCK_RATE;
  out.moteTravel[0] = travel.x;
  out.moteTravel[1] = travel.z;
  species(record.species.pollen, capacity, out.motePollenSpan, out.motePollenDrift);
  species(record.species.frost, capacity, out.moteFrostSpan, out.moteFrostDrift);
  out.moteColour[0] = record.colour.r;
  out.moteColour[1] = record.colour.g;
  out.moteColour[2] = record.colour.b;
  out.moteColour[3] = MOTE_ALPHA;
  out.moteExposure[0] = exposure;
  out.moteContrast[0] = contrast;
  return out;
}

/** Whether any mote is shown under `u`. */
export function motesShown(u: MoteUniforms): boolean {
  return u.motePollenDrift[2] > 0 || u.moteFrostDrift[2] > 0;
}

/** A mote as the stage places it. */
export type MoteState = { shown: boolean; x: number; y: number; z: number; size: number; colour: Rgb; alpha: number; age: number; life: number };

const fract = (v: number): number => v - Math.floor(v);

/**
 * The mote of `slot` (its number, its species' place and its rank, as
 * `moteSlots` lists them) under `u`, for an eye at `eye`: the vertex
 * stage's steps, one for one.
 */
export function moteAt(slot: number, kind: number, rank: number, u: MoteUniforms, eye: { readonly x: number; readonly y: number; readonly z: number }): MoteState {
  const span = kind > 0.5 ? u.moteFrostSpan : u.motePollenSpan;
  const drift = kind > 0.5 ? u.moteFrostDrift : u.motePollenDrift;
  const life = Math.sqrt(span[2] * span[2] + (span[3] * span[3] - span[2] * span[2]) * moteRandom(slot, 0, MOTE_SALT.life));
  const t = u.moteClock[0] + moteRandom(slot, 0, MOTE_SALT.phase) * life;
  const lives = Math.floor(t / life);
  const age = t - lives * life;
  const n = lives + 1;
  const born = [moteRandom(slot, n, MOTE_SALT.x), moteRandom(slot, n, MOTE_SALT.y), moteRandom(slot, n, MOTE_SALT.z)] as const;
  const carried = [u.moteTravel[0], 0, u.moteTravel[1]] as const;
  const at = [eye.x, eye.y, eye.z] as const;
  const jitter = [moteRandom(slot, n, MOTE_SALT.driftX), moteRandom(slot, n, MOTE_SALT.driftY), moteRandom(slot, n, MOTE_SALT.driftZ)].map((v) => v * 2 - 1) as [number, number, number];
  const velocity = [drift[1] * jitter[0], drift[0] + 0.5 * drift[1] * jitter[1], drift[1] * jitter[2]] as const;
  const place = [0, 1, 2].map((axis) => {
    const box = MOTE_BOX[axis] as number;
    const anchored = ((born[axis] as number) - 0.5) * box + (carried[axis] as number) - (at[axis] as number);
    return (at[axis] as number) + (fract(anchored / box + 0.5) - 0.5) * box + (velocity[axis] as number) * age;
  }) as [number, number, number];
  return {
    shown: rank < drift[2],
    x: place[0], y: place[1], z: place[2],
    size: span[0] + (span[1] - span[0]) * moteRandom(slot, n, MOTE_SALT.size),
    colour: { r: u.moteColour[0], g: u.moteColour[1], b: u.moteColour[2] },
    alpha: u.moteColour[3] * (1 - age / life),
    age, life,
  };
}
