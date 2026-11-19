import type { WayDown } from "../../../src/sim/wayDown.js";
import { wayTarget } from "../../../src/sim/wayDraw.js";

/** Metres of the way a turn is measured over: a sprint's two seconds. */
const TURN_OVER_M = 14;
/** Metres along the way two points must be apart before their closeness counts as the way doubling on itself. */
const APART_ALONG_M = 60;
/**
 * Metres of the way's start left out of the heading-back measure: where the
 * stem comes up the far side of the crest, the way begins by going round it,
 * clear of the ground behind the body that is the Hollow's. On two of the
 * sweep's fifty worlds that takes 150 m, the pad 36 m and 38 m further off
 * at its end than at its start (measured 2026-11-14; 60 m until then, which
 * only the worlds first run had fitted).
 */
const START_M = 160;
/**
 * The give the tests allow on heading back, which the design states as
 * "about": a way gone round a lake may head back 5 m more than
 * WAY_BACK_MAX_M (measured 11 m).
 */
export const BACK_SLACK_M = 5;
/**
 * How soft the way's bends are, as the tests hold them: the most its heading
 * may turn over any TURN_OVER_M of it, in degrees, and the share of its
 * length that may turn by more than a gentle bend does (GENTLE_DEG): what
 * stands in the way is gone round, and that is the only turning there is.
 * Measured on seven worlds, 2026-11-19: the sharpest 40 to 78 degrees (a
 * fallen trunk or a rock band the line is held against), 6 to 16 % of the
 * way past gentle. The fifty of the sweep then showed two worlds whose way
 * rounds the end of a fallen trunk that lies across it, in one rounded S of
 * 100 and 104 degrees, with 20 and 24 % of the way past gentle: those are
 * the bounds' measure. The way before, which wound to a length and bent
 * every straight stretch, turned through 90 degrees in places.
 */
export const TURN_MOST_DEG = 110;
export const GENTLE_DEG = 15;
export const UNGENTLE_SHARE_MOST = 0.3;

export type WayRules = {
  length: number;
  /** What the way's length aims at, from its straight line (wayTarget). */
  target: number;
  /** The most the heading turns over any 14 m of the way, degrees. */
  sharpestTurn: number;
  /** The share of the way's points whose 14 m on turn by more than a gentle bend (15 degrees). */
  ungentleShare: number;
  /** The most the straight-line distance to `end` grows before it falls again, metres, past the way's start (START_M). */
  worstBack: number;
  /** The same over the start alone: how far the way's start, going round the crest, takes it from the pad. */
  startBack: number;
  /** The least distance between two of the way's points more than 60 m apart along it, metres. */
  closestApart: number;
};

/** A way measured against the design's shape rules (spec §4.1). */
export function wayRules(way: WayDown, end: { x: number; z: number }): WayRules {
  const n = way.xs.length;
  // Each segment's heading, unwrapped so a turn through north does not read as a jump.
  const headings: number[] = [];
  for (let i = 0; i + 1 < n; i++) {
    let h = (Math.atan2((way.xs[i + 1] as number) - (way.xs[i] as number), (way.zs[i + 1] as number) - (way.zs[i] as number)) * 180) / Math.PI;
    const prev = headings[i - 1];
    if (prev !== undefined) {
      while (h - prev > 180) h -= 360;
      while (h - prev < -180) h += 360;
    }
    headings.push(h);
  }
  let sharpestTurn = 0, ungentle = 0;
  for (let i = 0; i < headings.length; i++) {
    let j = i;
    while (j + 1 < headings.length && (way.cum[j + 1] as number) - (way.cum[i] as number) < TURN_OVER_M) j++;
    const turn = Math.abs((headings[j] as number) - (headings[i] as number));
    sharpestTurn = Math.max(sharpestTurn, turn);
    if (turn > GENTLE_DEG) ungentle++;
  }
  const ungentleShare = headings.length > 0 ? ungentle / headings.length : 0;
  let worstBack = 0, startBack = 0, least = Infinity;
  for (let i = 0; i < n; i++) {
    const d = Math.hypot((way.xs[i] as number) - end.x, (way.zs[i] as number) - end.z);
    if ((way.cum[i] as number) <= START_M) {
      startBack = Math.max(startBack, d - Math.hypot((way.xs[0] as number) - end.x, (way.zs[0] as number) - end.z));
      // Past the start the measure begins from where the start left the way.
      least = d;
      continue;
    }
    least = Math.min(least, d);
    worstBack = Math.max(worstBack, d - least);
  }
  let closestApart = Infinity;
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      if ((way.cum[j] as number) - (way.cum[i] as number) <= APART_ALONG_M) continue;
      closestApart = Math.min(closestApart, Math.hypot((way.xs[i] as number) - (way.xs[j] as number), (way.zs[i] as number) - (way.zs[j] as number)));
    }
  }
  return { length: way.length, target: wayTarget(way.straight), sharpestTurn, ungentleShare, worstBack, startBack, closestApart };
}
