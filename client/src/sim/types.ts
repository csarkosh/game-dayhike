export type Vec3 = { x: number; y: number; z: number };

export const enum EntityKind {
  Player = 0,
  Enemy = 1,
}

export const enum AiState {
  Idle = 0,
  Chase = 1,
  Attack = 2,
  Dead = 3,
}

export const enum Button {
  /** The fire bit became Interact on 2026-09-10: same bit, same wire, a new verb. */
  Interact = 1,
  Jump = 2,
  Crouch = 4,
  Sprint = 8,
  /** The reload bit became the headlamp toggle. */
  Lamp = 16,
}

export type InputCommand = {
  seq: number;
  moveX: number;
  moveZ: number;
  yaw: number;
  pitch: number;
  buttons: number;
};

export type PlayerState = {
  id: number;
  pos: Vec3;
  vel: Vec3;
  yaw: number;
  pitch: number;
  health: number;
  grounded: boolean;
  lastProcessedInput: number;
  /**
   * Seconds until respawn; 0 means alive. Declared here rather than added
   * later because it rides in the snapshot, and changing the wire format
   * afterward would mean revisiting the codec, its byte-size test, and both
   * sessions.
   */
  respawnTimer: number;
  /**
   * The headlamp. `on` is toggled by the host on the Lamp press edge;
   * `charge` is carried at 1 for now — draining is not implemented yet. Both
   * ride the snapshot as one byte so peers see each other's lamps.
   */
  lamp: { on: boolean; charge: number };
  /**
   * Where this player last died, so respawn can put them back near it rather
   * than at a fixed point — in an unbounded world a fixed spawn could be a long
   * walk back through ground already cleared.
   *
   * Host-only. The snapshot carries id, pos, vel, yaw, pitch, health,
   * respawnTimer and lamp, so this never reaches the wire and the codec is
   * untouched.
   */
  deathPos: Vec3 | null;
};

export type EnemyState = {
  id: number;
  pos: Vec3;
  vel: Vec3;
  yaw: number;
  health: number;
  ai: AiState;
  targetId: number;
  stateTimer: number;
  attackCooldown: number;
  /**
   * Stuck detection for the unstick fallback in `ai.ts`.
   *
   * Host-only. The snapshot encodes id, pos, yaw, health and ai per enemy, so
   * these never reach the wire and the codec is untouched. They are also absent
   * from `serializeWorldState`, which fingerprints only what both sides can see.
   */
  lastDistSq: number;
  stuckTimer: number;
  unstickTimer: number;
};

export type WorldState = {
  tick: number;
  players: Map<number, PlayerState>;
  enemies: Map<number, EnemyState>;
  nextEntityId: number;
  rngSeed: number;
};

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
