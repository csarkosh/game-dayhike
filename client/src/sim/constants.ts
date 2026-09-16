import type { Vec3 } from "./types.js";

export const SIM_TICK_HZ = 60;
export const TICK_DT = 1 / SIM_TICK_HZ;
export const SNAPSHOT_HZ = 20;
export const TICKS_PER_SNAPSHOT = SIM_TICK_HZ / SNAPSHOT_HZ;
export const INTERP_DELAY_MS = 100;
export const MAX_UNACKED_INPUTS = 16;
/**
 * Ticks of client input the host is willing to sit on before catching up.
 * A small buffer absorbs jitter; a permanent one is pure added input latency,
 * because the host consumes one command per tick and the client produces one.
 */
export const INPUT_BUFFER_TARGET = 2;
/** Commands one peer may have applied in a single host tick while catching up. */
export const MAX_INPUTS_PER_TICK = 2;
export const LAG_COMP_HISTORY_TICKS = SIM_TICK_HZ;
export const MAX_PLAYERS = 5;
export const CLIENT_TIMEOUT_MS = 5000;
export const ICE_TIMEOUT_MS = 15000;

export const EPSILON = 1e-6;
export const SKIN = 0.001;
export const MAX_SLIDE_ITERATIONS = 4;

export const PLAYER_HALF: Vec3 = { x: 0.4, y: 0.9, z: 0.4 };
export const PLAYER_EYE_OFFSET = 0.7;
export const ENEMY_HALF: Vec3 = { x: 0.4, y: 0.9, z: 0.4 };

export const GRAVITY = -24;
export const JUMP_SPEED = 8;
/**
 * Top horizontal speed on foot, m/s. Three quarters of the 7 this shipped at —
 * 7 read as a sprint even while walking, so it became the sprint speed and this
 * became the walk.
 *
 * Renamed from MAX_SPEED when sprinting arrived: it is no longer the maximum,
 * and a constant called MAX that something exceeds is a trap for whoever next
 * writes a clamp. Everything downstream is a ratio of this (`ai.ts`'s
 * ENEMY_WISH, `viewBob.ts`'s stride strength), so enemies keep their own
 * absolute speed and the walking cue keeps its tuned shape.
 */
export const WALK_SPEED = 5.25;
/**
 * Top horizontal speed while Button.Sprint is held — the 7 that walking used
 * to be. Sprint raises only the speed the wish is capped at: acceleration,
 * friction and air control are untouched, so it changes how fast movement tops
 * out and nothing else about how it feels.
 */
export const SPRINT_SPEED = 7;
export const GROUND_ACCEL = 10;
export const AIR_ACCEL = 1.2;
export const FRICTION = 8;
export const STEP_HEIGHT = 0.5;
export const GROUND_NORMAL_Y = 0.7;
/**
 * Slack on the ground-stick test, on top of what the local slope already
 * explains. Absorbs the float error in one tick of "descend, then clamp back to
 * the surface" so a player walking a smooth slope is never scored airborne for
 * a fraction of a millimetre. Far below the height of anything worth falling
 * off, so real ledges still read as falls.
 */
export const GROUND_SNAP_MARGIN = 0.02;
/**
 * March step for `raycastGround`, in metres. The ground is a height field, so a
 * ray against it is found by sampling rather than solved: this is the interval
 * whose sign flip brackets the hit. A 120 m ray costs 240 field samples at
 * this step.
 */
export const GROUND_RAY_STEP = 0.5;
/**
 * Bisections of the bracketing interval. 16 halvings of GROUND_RAY_STEP land
 * inside 8 micrometres — far past what any ray can resolve, and cheap because
 * it is paid once per ray rather than once per step.
 */
export const GROUND_RAY_REFINEMENTS = 16;

/** Wading: submergence depth at which the slowdown saturates. */
export const WADE_CHEST_DEPTH = 1.3;
/** Horizontal speed multiplier at full submergence. */
export const WADE_FLOOR = 0.45;

export const PLAYER_MAX_HEALTH = 100;
export const ENEMY_MAX_HEALTH = 40;

export const ENEMY_DETECT_RANGE = 30;
export const ENEMY_ATTACK_RANGE = 2.0;
export const ENEMY_SPEED = 3.2;
export const ENEMY_DAMAGE = 8;
export const ENEMY_ATTACK_COOLDOWN = 1.2;
export const ENEMY_CORPSE_SECONDS = 4;

export const ENEMY_BASE_POPULATION = 12;
export const ENEMY_PER_EXTRA_PLAYER = 6;
export const ENEMY_POPULATION_CAP = 30;
export const ENEMY_MIN_SPAWN_DISTANCE = 25;
