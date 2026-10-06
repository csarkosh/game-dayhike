/**
 * The chase's pulse: what tells a player, by ear, to keep running. A low
 * thump on every beat and a dry tick between, at a tempo that quickens as
 * the Hollow closes, under a drone of two rough tones whose cutoff opens
 * with it. It comes in with the chase's cast (escalation.ts) and never
 * stops until the match does. Synthesized on the ambient context beside
 * the world's bus, so no hush or stare takes it.
 */

const clamp01 = (v: number): number => Math.max(0, Math.min(1, v));
const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;

/** Beats a minute with nothing near, and with the Hollow at the ear. */
export const CHASE_BPM_FAR = 104;
export const CHASE_BPM_NEAR = 132;
/** The pulse's and the drone's levels at a full cast, under the master volume; the drone's share with nothing near. */
export const CHASE_PULSE_LEVEL = 0.8;
export const CHASE_DRONE_LEVEL = 0.22;
export const CHASE_DRONE_FAR_SHARE = 0.35;
/** The drone's low-pass with nothing near and with the Hollow at the ear. */
export const CHASE_DRONE_FAR_HZ = 320;
export const CHASE_DRONE_NEAR_HZ = 1800;
/** Seconds ahead of the context's clock the beats are scheduled, and the cast below which nothing plays. */
export const CHASE_LOOKAHEAD_S = 0.25;
export const CHASE_FLOOR = 0.02;

export type ChaseAudio = {
  /** One frame: `cast` 0 to 1 is how far in the chase is, `near` 0 to 1 how close the Hollow. */
  set(cast: number, near: number): void;
};

export function createChaseAudio(ctx: AudioContext, out: AudioNode, noise: AudioBuffer): ChaseAudio {
  const bus = ctx.createGain();
  bus.gain.value = 0;
  bus.connect(out);
  let drone: { filter: BiquadFilterNode; gain: GainNode } | null = null;
  /** When the next beat falls on the context's clock, and whether it is a thump (on the beat) or a tick (between). */
  let next = -1;
  let onBeat = true;

  function thump(at: number): void {
    const osc = ctx.createOscillator();
    osc.type = "sine";
    osc.frequency.setValueAtTime(64, at);
    osc.frequency.exponentialRampToValueAtTime(40, at + 0.1);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, at);
    g.gain.linearRampToValueAtTime(CHASE_PULSE_LEVEL, at + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, at + 0.2);
    osc.connect(g);
    g.connect(bus);
    osc.start(at);
    osc.stop(at + 0.25);
  }

  function tick(at: number): void {
    const src = ctx.createBufferSource();
    src.buffer = noise;
    src.loop = true;
    const f = ctx.createBiquadFilter();
    f.type = "highpass";
    f.frequency.value = 3200;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, at);
    g.gain.linearRampToValueAtTime(CHASE_PULSE_LEVEL * 0.35, at + 0.003);
    g.gain.exponentialRampToValueAtTime(0.0001, at + 0.04);
    src.connect(f);
    f.connect(g);
    g.connect(bus);
    src.start(at);
    src.stop(at + 0.06);
  }

  function buildDrone(): { filter: BiquadFilterNode; gain: GainNode } {
    const filter = ctx.createBiquadFilter();
    filter.type = "lowpass";
    filter.frequency.value = CHASE_DRONE_FAR_HZ;
    filter.Q.value = 2;
    const gain = ctx.createGain();
    gain.gain.value = 0;
    filter.connect(gain);
    gain.connect(bus);
    for (const hz of [55, 55.7, 82.4]) {
      const osc = ctx.createOscillator();
      osc.type = "sawtooth";
      osc.frequency.value = hz;
      osc.connect(filter);
      osc.start();
    }
    return { filter, gain };
  }

  return {
    set(cast, near) {
      const level = clamp01(cast);
      const now = ctx.currentTime;
      bus.gain.setTargetAtTime(level, now, 0.5);
      if (level < CHASE_FLOOR) {
        next = -1;
        return;
      }
      const d = drone ?? (drone = buildDrone());
      const closeness = clamp01(near);
      d.filter.frequency.setTargetAtTime(lerp(CHASE_DRONE_FAR_HZ, CHASE_DRONE_NEAR_HZ, closeness), now, 0.3);
      d.gain.gain.setTargetAtTime(CHASE_DRONE_LEVEL * lerp(CHASE_DRONE_FAR_SHARE, 1, closeness), now, 0.3);
      // The beats: half a beat apart, thump and tick by turns, the tempo
      // read afresh at each so a Hollow closing quickens the next.
      if (next < now) next = now;
      const half = 30 / lerp(CHASE_BPM_FAR, CHASE_BPM_NEAR, closeness);
      while (next <= now + CHASE_LOOKAHEAD_S) {
        if (onBeat) thump(next);
        else tick(next);
        onBeat = !onBeat;
        next += half;
      }
    },
  };
}
