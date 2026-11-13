import type { WayDown } from "../../../src/sim/wayDown.js";
import { wayTarget } from "../../../src/sim/wayDraw.js";

/** Degrees a stretch's headings may differ by and still be straight. */
const STRAIGHT_DEG = 8;
/** Metres along the way two points must be apart before their closeness counts as the way doubling on itself. */
const APART_ALONG_M = 60;

export type WayRules = {
  length: number;
  /** What the way's length aims at, from its straight line (wayTarget). */
  target: number;
  /** The longest stretch whose headings stay within 8 degrees of each other, metres. */
  longestStraight: number;
  /** The most the straight-line distance to `end` grows before it falls again, metres. */
  worstBack: number;
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
  let longestStraight = 0;
  for (let i = 0; i < headings.length; i++) {
    let lo = headings[i] as number, hi = lo, j = i;
    while (j + 1 < headings.length) {
      const h = headings[j + 1] as number;
      if (Math.max(hi, h) - Math.min(lo, h) > STRAIGHT_DEG) break;
      lo = Math.min(lo, h);
      hi = Math.max(hi, h);
      j++;
    }
    longestStraight = Math.max(longestStraight, (way.cum[j + 1] as number) - (way.cum[i] as number));
  }
  let worstBack = 0, least = Infinity;
  for (let i = 0; i < n; i++) {
    const d = Math.hypot((way.xs[i] as number) - end.x, (way.zs[i] as number) - end.z);
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
  return { length: way.length, target: wayTarget(way.straight), longestStraight, worstBack, closestApart };
}
