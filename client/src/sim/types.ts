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
  /** The Hollow bound to `targetId`, a player, and walking at them. */
  Hunt = 5,
  /** The Hollow stepping out: still for `stateTimer` seconds, facing `targetId`, then Hunt. */
  Emerge = 7,
  /** The Hollow with nobody left to hunt: still where it stands, facing the pad. */
  Stand = 8,
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

export const enum Outcome {
  Playing = 0,
  Won = 1,
  /** Every player dead. */
  Lost = 2,
}

/** The match's two acts (docs/gameplay/2026-09-16-the-summit.md §2). Host truth, one byte on the wire. */
export const enum Phase {
  Climb = 0,
  Chase = 1,
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
   * The headlamp. `on` is toggled by the host on the Lamp press edge;
   * `charge` is carried at 1 for now — draining is not implemented yet. Both
   * ride the snapshot as one byte so peers see each other's lamps.
   */
  lamp: { on: boolean; charge: number };
  /**
   * The stare, 0 to 1: fills while a Hollow is in this player's view, empties
   * when it is not, and kills at 1 (hollow.ts). Host truth; rides the snapshot
   * as one byte so the screen's darkening and the death agree on every peer.
   */
  stare: number;
  /**
   * On the road corridor this tick — within ROAD_CORRIDOR_HALF of the road's
   * centreline (summit.ts). A safe player is never targeted and never killed,
   * and steps back into the woods a target again. Host truth; rides the
   * snapshot as one bit so every peer's end screen agrees.
   */
  safe: boolean;
  /**
   * Where this player fell. Set once, on the tick health reaches 0, and never
   * cleared: death is permanent, and `updateDeaths` uses it to know the drop
   * has been done.
   *
   * Host-only. The snapshot carries id, pos, vel, yaw, pitch, health, the
   * lamp and the safe bit, so this never reaches the wire and the codec is
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
  /**
   * The Hollow's walk (hollow.ts): the node route it is following, the index
   * of the next node, whether it has left the graph for its target, and
   * whether a living player had it in view last tick (which slows it).
   *
   * Host-only, like the stuck fields above: absent from the snapshot and the
   * fingerprint. Unused (empty, 0, false, false) on a sandbox chaser.
   */
  route: number[];
  routeAt: number;
  approach: boolean;
  seen: boolean;
};

export type WorldState = {
  tick: number;
  players: Map<number, PlayerState>;
  enemies: Map<number, EnemyState>;
  outcome: Outcome;
  /** Climb until the first living player finds the body; Chase from then on (summit.ts). */
  phase: Phase;
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
