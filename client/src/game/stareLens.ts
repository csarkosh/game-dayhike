/**
 * What looking at a Hollow costs, as the local player's screen and ears take
 * it: the sim's `stare` (hollow.ts, 0 to 1) turned into a darkness that
 * closes from the Hollow's side on a heartbeat, a world gone muffled, and
 * whispers. Nothing here kills, and nothing here is on the wire: the lens is
 * stepped on each screen from that player's own stare.
 *
 * In the chase the darkness is the chase's own (2026-11-19): there the whole
 * way down, never further closed than CHASE_REACH however long a player
 * looks at what hunts them (closed all the way it left a runner nothing to
 * see by), centred, and beating faster with a shadow or a hunter at the
 * centre of their view (chaseThreat.ts). The stare's level still dims the
 * frame and muffles the world there, as it does anywhere.
 *
 * Babylon-free: the renderer steps it, the grade (gradeParams.ts) and the
 * audio (stareAudio.ts) read it.
 */

const clamp01 = (v: number): number => Math.max(0, Math.min(1, v));

/** Beats a minute as the stare begins, and at a full stare. The top is held
 * under 90: a beat darkens the frame's edge twice, and three such changes a
 * second is the limit a screen may flash at (WCAG 2.3.1). */
export const HEART_BPM_REST = 62;
export const HEART_BPM_FULL = 84;
/** Where in a beat the second sound falls, and its share of the first's swell. */
export const HEART_DUB_AT = 0.28;
export const HEART_DUB_SHARE = 0.4;
/** The share of a beat a swell takes to reach its top; it falls away after as it rose. */
export const HEART_ATTACK = 0.09;
/** Below this level there is no pulse and the heart is at rest. */
export const STARE_FLOOR = 0.02;
/** Seconds the level takes to follow the stare (the snapshot's byte steps), and the darkness's centre to follow the Hollow. */
export const STARE_LEVEL_EASE_S = 0.35;
export const STARE_SIDE_EASE_S = 1.2;
/** How far the open centre moves off the Hollow, in the frame's half-widths, when the Hollow stands at the cone's edge. */
export const STARE_SIDE_SHIFT = 0.34;
/** The share of the closing a beat's swell adds. */
export const STARE_PULSE = 0.14;
/**
 * The chase's dark: how far it is closed at the top of a beat; the share of
 * that a beat's swell adds (a third of it stands between beats); the beats a
 * minute with nothing at the centre of the view, rising to HEART_BPM_FULL
 * with something whole there; the seconds it takes to come in and to go; and
 * the seconds its quickening takes to follow what is at the centre, in and out.
 */
export const CHASE_REACH = 0.3;
export const CHASE_PULSE = 0.45;
export const CHASE_BPM_CALM = 48;
export const CHASE_LENS_EASE_S = 1.2;
export const CHASE_QUICK_IN_S = 0.35;
export const CHASE_QUICK_OUT_S = 1.5;
/** Below this the chase's dark and its quickening are gone. */
const CHASE_FLOOR = 0.002;

export type StareLens = {
  /** The stare as the screen shows it, 0 to 1. */
  level: number;
  /** Where in the heartbeat, 0 to 1; 0 at rest. */
  phase: number;
  /** Beats begun since the match started: the audio plays one each time it rises. */
  beats: number;
  /** Seconds a beat takes at this level. */
  period: number;
  /** Where the Hollow stands on the screen, each within −1..1, x right and y up: the darkness is heaviest there. */
  sideX: number;
  sideY: number;
  /** How far the chase's own dark has come in, 0 to 1: 0 anywhere but the chase. */
  chase: number;
  /** What is at the centre of the view in the chase, eased, 0 to 1: the beat quickens by it. */
  quick: number;
};

export const STARE_LENS_REST: StareLens = { level: 0, phase: 0, beats: 0, period: 60 / HEART_BPM_REST, sideX: 0, sideY: 0, chase: 0, quick: 0 };

/** One swell: 0 before `at`, 1 at its top `HEART_ATTACK` later, falling away as `x·e^(1−x)`. */
function swell(phase: number, at: number): number {
  const x = (phase - at) / HEART_ATTACK;
  return x <= 0 ? 0 : x * Math.exp(1 - x);
}

/** The heartbeat's swell at a phase of 0 to 1: the first sound's, then the second's, smaller; near 0 for the beat's last half. */
export function heartbeat(phase: number): number {
  return Math.min(1, swell(phase, 0) + HEART_DUB_SHARE * swell(phase, HEART_DUB_AT));
}

/**
 * One frame of the lens. `stare` is the local player's (0 for the dead);
 * `side` is where the Hollow they look at stands on the screen, or null when
 * none is in front of them, and the darkness keeps the side it had.
 * `threat` is what is at the centre of their view in the chase (0 to 1,
 * chaseThreat.ts), or null where the chase does not have them: the chase's
 * own dark comes in while it is given and goes when it is not.
 */
export function stepStareLens(prev: StareLens, stare: number, side: { x: number; y: number } | null, dt: number, threat: number | null = null): StareLens {
  if (!(dt > 0)) return prev;
  const target = clamp01(stare);
  const level = target + (prev.level - target) * Math.exp(-dt / STARE_LEVEL_EASE_S);
  const chaseTo = threat === null ? 0 : 1, quickTo = threat === null ? 0 : clamp01(threat);
  let chase = chaseTo + (prev.chase - chaseTo) * Math.exp(-dt / CHASE_LENS_EASE_S);
  let quick = quickTo + (prev.quick - quickTo) * Math.exp(-dt / (quickTo > prev.quick ? CHASE_QUICK_IN_S : CHASE_QUICK_OUT_S));
  if (threat === null && chase < CHASE_FLOOR) chase = 0;
  if (quickTo === 0 && quick < CHASE_FLOOR) quick = 0;
  if (level < STARE_FLOOR && target === 0 && chase === 0) {
    return { ...STARE_LENS_REST, beats: prev.beats, sideX: prev.sideX, sideY: prev.sideY };
  }
  // The heart's own rate by the stare; the chase's by what is at the centre of the view.
  const own = HEART_BPM_REST + (HEART_BPM_FULL - HEART_BPM_REST) * level;
  const chased = CHASE_BPM_CALM + (HEART_BPM_FULL - CHASE_BPM_CALM) * quick;
  const period = 60 / (own + (chased - own) * chase);
  // The first beat falls as the stare begins, not a period later.
  const resting = prev.level < STARE_FLOOR && prev.chase === 0 && prev.phase === 0;
  let phase = (resting ? 0 : prev.phase) + dt / period;
  let beats = resting ? prev.beats + 1 : prev.beats;
  if (phase >= 1) {
    phase -= Math.floor(phase);
    beats++;
  }
  const k = side === null ? 0 : 1 - Math.exp(-dt / STARE_SIDE_EASE_S);
  return {
    level,
    phase,
    beats,
    period,
    sideX: side === null ? prev.sideX : prev.sideX + (side.x - prev.sideX) * k,
    sideY: side === null ? prev.sideY : prev.sideY + (side.y - prev.sideY) * k,
    chase,
    quick,
  };
}

/** The tangent of the stare's cone (hollow.ts HOLLOW_LOOK_COS, 20°): a Hollow there is at the side's full length. */
const SIDE_FULL_TAN = 0.364;

/**
 * Where a point stands on the screen for `stepStareLens`, from its place in
 * the camera's own frame (x right, y up, z ahead): its direction off the
 * centre, at full length when it is at the cone's edge or past it and
 * shorter toward the centre. Null behind the camera. `cos` is how near the
 * aim it is, for choosing among several.
 */
export function stareSide(vx: number, vy: number, vz: number): { x: number; y: number; cos: number } | null {
  if (!(vz > 0)) return null;
  const off = Math.hypot(vx, vy);
  if (off === 0) return { x: 0, y: 0, cos: 1 };
  const length = Math.min(1, off / vz / SIDE_FULL_TAN);
  return { x: (vx / off) * length, y: (vy / off) * length, cos: vz / Math.hypot(off, vz) };
}

/** What the grade pass draws of a lens: the open centre's offset, how far the darkness has closed, and the clock its edge crawls on. */
export type StareShade = { x: number; y: number; reach: number; time: number };

/**
 * How far the darkness has closed, 0 to 1: the level, eased so a glance is
 * slight, swelling on the beat; and in the chase, by how far its own dark is
 * in, the chase's reach in the stare's place, swelling more on the beat.
 */
export function stareReach(lens: StareLens): number {
  const l = clamp01(lens.level), c = clamp01(lens.chase);
  if (l === 0 && c === 0) return 0;
  const beat = heartbeat(lens.phase);
  const eased = l * l * (3 - 2 * l);
  const own = eased * (1 - STARE_PULSE + STARE_PULSE * beat);
  const chased = CHASE_REACH * (1 - CHASE_PULSE + CHASE_PULSE * beat);
  return clamp01(own + (chased - own) * c);
}

export function stareShadeUnder(lens: StareLens, timeSeconds: number): StareShade {
  const reach = stareReach(lens);
  if (reach === 0) return { x: 0, y: 0, reach: 0, time: 0 };
  // The open centre moves away from the Hollow, so the dark reaches it first; the chase's dark is centred.
  const lean = STARE_SIDE_SHIFT * (1 - clamp01(lens.chase));
  return { x: -lens.sideX * lean, y: -lens.sideY * lean, reach, time: timeSeconds };
}
