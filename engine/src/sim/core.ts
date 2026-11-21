/**
 * What every simulation built on the engine is made of, whatever its game: a place, a player's
 * input for a tick, the buttons movement itself reads, and the seeded random stream. A game's
 * own records (its players' fields, its entities, its match) are the game's.
 *
 * sim/ determinism rules: no trig, no Math.pow, no `**`, no hypot.
 */
export type Vec3 = { x: number; y: number; z: number };

export type InputCommand = {
  seq: number;
  moveX: number;
  moveZ: number;
  yaw: number;
  pitch: number;
  buttons: number;
};

/**
 * The buttons movement reads from a command's one byte. The byte's other bits are the game's to
 * name; a game that names all of them keeps these three where they are.
 */
export const enum MoveButton {
  Jump = 2,
  Crouch = 4,
  Sprint = 8,
}

/**
 * mulberry32. Integer-only, so it is bit-identical on every JS engine.
 * The seed lives in world state, which is what makes AI and spawning replayable.
 */
export function nextRandom(state: { rngSeed: number }): number {
  state.rngSeed = (state.rngSeed + 0x6d2b79f5) | 0;
  let t = state.rngSeed;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

export function randomRange(state: { rngSeed: number }, lo: number, hi: number): number {
  return lo + nextRandom(state) * (hi - lo);
}

export function vec3(x = 0, y = 0, z = 0): Vec3 {
  return { x, y, z };
}

export function cloneVec3(v: Vec3): Vec3 {
  return { x: v.x, y: v.y, z: v.z };
}

export function distanceSquared(a: Vec3, b: Vec3): number {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  const dz = a.z - b.z;
  return dx * dx + dy * dy + dz * dz;
}
