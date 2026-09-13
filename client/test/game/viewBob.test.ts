import { describe, it, expect } from "vitest";
import {
  createViewBob,
  BOB_LATERAL,
  BOB_VERTICAL,
  DEFAULT_BOB_SCALE,
  LANDING_DIP_MAX,
  MAX_BOB_SCALE,
  SPRINT_BOB_MULTIPLIER,
  STRIDE_LENGTH,
  type BobOffset,
  type ViewBob,
} from "../../src/game/viewBob.js";
import { WALK_SPEED } from "../../src/sim/constants.js";

/**
 * The walking cue is a render effect, so its whole contract is the offset it
 * returns. These pin the properties that make it read as footfall rather than
 * as a wobble: it dips and never lifts, it keeps time with ground covered
 * rather than with frames, and it returns to neutral whenever you are not
 * walking.
 */

/**
 * Walks a fixed distance in a fixed number of equal steps at a constant speed.
 * Distance rather than duration, so a coarse and a fine walk cover exactly the
 * same ground and can be compared directly.
 */
function walk(
  bob: ViewBob,
  distance: number,
  steps: number,
  speed: number,
  grounded = true,
  sprinting = false,
): BobOffset[] {
  const dt = distance / speed / steps;
  // Prime the origin: the first sample after creation establishes where we are
  // and advances nothing, so without this a coarse walk would cover one step
  // less ground than a fine one.
  bob.update({ x: 0, z: 0, speed, velY: 0, grounded, sprinting }, dt);
  const out: BobOffset[] = [];
  for (let i = 1; i <= steps; i++) {
    out.push(bob.update({ x: (distance * i) / steps, z: 0, speed, velY: 0, grounded, sprinting }, dt));
  }
  return out;
}

/** Holds position for `seconds`, which is what standing still looks like. */
function stand(bob: ViewBob, seconds: number, x = 0, grounded = true, sprinting = false): BobOffset {
  const dt = 1 / 60;
  let last: BobOffset = { dy: 0, dx: 0, roll: 0 };
  for (let t = 0; t < seconds; t += dt) {
    last = bob.update({ x, z: 0, speed: 0, velY: 0, grounded, sprinting }, dt);
  }
  return last;
}

describe("view bob", () => {
  it("sits neutral when standing still", () => {
    const bob = createViewBob();
    const o = stand(bob, 2);
    expect(Math.abs(o.dy)).toBeLessThan(1e-6);
    expect(Math.abs(o.dx)).toBeLessThan(1e-6);
    expect(Math.abs(o.roll)).toBeLessThan(1e-6);
  });

  it("sits neutral in the air, however fast you are moving", () => {
    const bob = createViewBob();
    // Airborne at full speed for a second: no stride, because your feet are
    // not touching anything.
    const frames = walk(bob, WALK_SPEED, 60, WALK_SPEED, false);
    const last = frames[frames.length - 1] as BobOffset;
    expect(Math.abs(last.dy)).toBeLessThan(1e-6);
    expect(Math.abs(last.dx)).toBeLessThan(1e-6);
  });

  it("never lifts the eye above its true height", () => {
    // Only ever a dip. An offset that rose above the real eye position would
    // let you see over things you are not tall enough to see over.
    const bob = createViewBob();
    for (const o of walk(bob, 60, 2000, WALK_SPEED)) {
      expect(o.dy).toBeLessThanOrEqual(1e-12);
    }
  });

  it("dips twice and sways once per stride", () => {
    // Two footfalls to a stride, one weight shift. That ratio is what reads as
    // walking rather than as bobbing.
    const bob = createViewBob();
    walk(bob, 40, 400, WALK_SPEED); // settle the amplitude first

    const N = 720;
    const cycle = walk(bob, STRIDE_LENGTH, N, WALK_SPEED);

    let verticalDips = 0;
    for (let i = 1; i < cycle.length - 1; i++) {
      const prev = (cycle[i - 1] as BobOffset).dy;
      const here = (cycle[i] as BobOffset).dy;
      const next = (cycle[i + 1] as BobOffset).dy;
      if (here < prev && here <= next) verticalDips++;
    }
    expect(verticalDips).toBe(2);

    let lateralSignChanges = 0;
    for (let i = 1; i < cycle.length; i++) {
      const prev = (cycle[i - 1] as BobOffset).dx;
      const here = (cycle[i] as BobOffset).dx;
      if (prev <= 0 && here > 0) lateralSignChanges++;
      if (prev >= 0 && here < 0) lateralSignChanges++;
    }
    expect(lateralSignChanges).toBe(2); // one full period
  });

  it("keeps time with ground covered, not with frames", () => {
    // Phase is driven by distance, so a stuttering frame rate cannot change
    // your cadence — the same walk sampled coarsely and finely must end in the
    // same place in the stride.
    const coarse = createViewBob();
    const fine = createViewBob();
    const walked = 17.3;
    const a = walk(coarse, walked, 40, WALK_SPEED);
    const b = walk(fine, walked, 900, WALK_SPEED);
    const last = (xs: BobOffset[]) => xs[xs.length - 1] as BobOffset;
    expect(Math.abs(last(a).dy - last(b).dy)).toBeLessThan(1e-6);
    expect(Math.abs(last(a).dx - last(b).dx)).toBeLessThan(1e-6);
  });

  it("bobs less at a walk than at a run", () => {
    const peak = (speed: number): number => {
      const bob = createViewBob();
      // Same distance either way, so both settle and both cover whole strides.
      const frames = walk(bob, 60, 4000, speed);
      return Math.max(...frames.slice(2000).map((o) => Math.abs(o.dy)));
    };
    const full = peak(WALK_SPEED);
    const half = peak(WALK_SPEED / 2);
    expect(full).toBeGreaterThan(0);
    expect(half / full).toBeGreaterThan(0.4);
    expect(half / full).toBeLessThan(0.6);
    expect(full).toBeLessThanOrEqual(BOB_VERTICAL + 1e-9);
  });

  it("eases back to neutral when you stop rather than snapping", () => {
    const bob = createViewBob();
    const frames = walk(bob, 40, 400, WALK_SPEED);
    const moving = Math.abs((frames[frames.length - 1] as BobOffset).dy);
    expect(moving).toBeGreaterThan(0);

    // One frame after stopping it must still be moving, not already zero.
    const oneFrame = bob.update({ x: 40, z: 0, speed: 0, velY: 0, grounded: true, sprinting: false }, 1 / 60);
    expect(Math.abs(oneFrame.dy)).toBeGreaterThan(0);
    // Half a second in it is already below a tenth of a millimetre — gone as
    // far as an eye is concerned, which is the property that matters.
    expect(Math.abs(stand(bob, 0.5, 40).dy)).toBeLessThan(1e-3);
    // And it keeps closing rather than parking on a residue.
    expect(Math.abs(stand(bob, 1.5, 40).dy)).toBeLessThan(1e-6);
  });

  it("dips on landing, in proportion to the impact, then recovers", () => {
    const land = (impact: number): { dip: number; after: number } => {
      const bob = createViewBob();
      const dt = 1 / 60;
      // Falling: airborne with a downward velocity.
      for (let i = 0; i < 10; i++) {
        bob.update({ x: 0, z: 0, speed: 0, velY: -impact, grounded: false, sprinting: false }, dt);
      }
      const dip = bob.update({ x: 0, z: 0, speed: 0, velY: 0, grounded: true, sprinting: false }, dt).dy;
      return { dip, after: stand(bob, 0.5).dy };
    };

    const soft = land(4);
    const hard = land(14);
    expect(soft.dip).toBeLessThan(0); // a dip, not a lift
    expect(hard.dip).toBeLessThan(soft.dip); // harder landing dips further
    expect(Math.abs(hard.dip)).toBeLessThanOrEqual(LANDING_DIP_MAX + 1e-9);
    expect(Math.abs(hard.after)).toBeLessThan(1e-3); // and it recovers
  });

  it("is switched off entirely at scale zero", () => {
    const bob = createViewBob(0);
    for (const o of walk(bob, 30, 300, WALK_SPEED)) {
      expect(Math.abs(o.dy)).toBe(0);
      expect(Math.abs(o.dx)).toBe(0);
      expect(Math.abs(o.roll)).toBe(0);
    }
    // Including the landing dip, which is not part of the stride.
    for (let i = 0; i < 10; i++) {
      bob.update({ x: 0, z: 0, speed: 0, velY: -12, grounded: false, sprinting: false }, 1 / 60);
    }
    expect(Math.abs(bob.update({ x: 0, z: 0, speed: 0, velY: 0, grounded: true, sprinting: false }, 1 / 60).dy)).toBe(0);
  });

  it("scales the whole effect together", () => {
    const peakOf = (scale: number): BobOffset => {
      const bob = createViewBob(scale);
      const frames = walk(bob, 60, 4000, WALK_SPEED).slice(2000);
      return {
        dy: Math.max(...frames.map((o) => Math.abs(o.dy))),
        dx: Math.max(...frames.map((o) => Math.abs(o.dx))),
        roll: Math.max(...frames.map((o) => Math.abs(o.roll))),
      };
    };
    const one = peakOf(1);
    const two = peakOf(2);
    expect(two.dy / one.dy).toBeCloseTo(2, 6);
    expect(two.dx / one.dx).toBeCloseTo(2, 6);
    expect(two.roll / one.roll).toBeCloseTo(2, 6);
    expect(one.dx).toBeCloseTo(BOB_LATERAL, 6);
  });

  it("walks at half strength by default and sprints at full", () => {
    // The tuned pair: an unhurried walk is understated, and sprinting is the
    // full amplitude. `/bob` scales both together rather than overriding, so a
    // player who has turned the effect up keeps their ratio while sprinting.
    const peak = (sprinting: boolean): number => {
      const bob = createViewBob();
      return Math.max(
        ...walk(bob, 60, 4000, WALK_SPEED, true, sprinting)
          .slice(2000)
          .map((o) => Math.abs(o.dy)),
      );
    };
    expect(peak(false)).toBeCloseTo(BOB_VERTICAL * DEFAULT_BOB_SCALE, 6);
    expect(peak(true)).toBeCloseTo(BOB_VERTICAL * DEFAULT_BOB_SCALE * SPRINT_BOB_MULTIPLIER, 6);
    // Which, at the shipped default, is exactly the full tuned amplitude.
    expect(peak(true)).toBeCloseTo(BOB_VERTICAL, 6);
  });

  it("ramps into a sprint rather than jolting", () => {
    // The sprint boost rides the same ease as the stride strength, so pressing
    // shift cannot step the amplitude in a single frame.
    const bob = createViewBob();
    walk(bob, 40, 400, WALK_SPEED); // settled at the walking strength
    const before = walk(bob, 0.2, 1, WALK_SPEED)[0] as BobOffset;

    const first = walk(bob, 0.2, 1, WALK_SPEED, true, true)[0] as BobOffset;
    const settled = Math.max(
      ...walk(bob, 40, 400, WALK_SPEED, true, true)
        .slice(200)
        .map((o) => Math.abs(o.dy)),
    );
    // One frame in it has not already reached the sprint amplitude.
    expect(Math.abs(first.dy)).toBeLessThan(settled);
    expect(Number.isFinite(before.dy)).toBe(true);
  });

  it("does not bob for holding sprint while standing still", () => {
    const bob = createViewBob();
    expect(Math.abs(stand(bob, 2, 0, true, true).dy)).toBeLessThan(1e-6);
  });

  it("caps the combined scale so sprinting cannot bury the camera", () => {
    const bob = createViewBob(MAX_BOB_SCALE);
    const peak = Math.max(
      ...walk(bob, 60, 4000, WALK_SPEED, true, true)
        .slice(2000)
        .map((o) => Math.abs(o.dy)),
    );
    expect(peak).toBeLessThanOrEqual(BOB_VERTICAL * MAX_BOB_SCALE + 1e-9);
  });

  it("forgets where it was after a reset, so a respawn does not lurch", () => {
    const bob = createViewBob();
    walk(bob, 40, 400, WALK_SPEED);
    bob.reset();
    // A teleport across the map right after reset must not be read as a stride.
    const o = bob.update({ x: 5000, z: 5000, speed: 0, velY: 0, grounded: true, sprinting: false }, 1 / 60);
    expect(Math.abs(o.dy)).toBeLessThan(1e-6);
    expect(Math.abs(o.dx)).toBeLessThan(1e-6);
  });
});
