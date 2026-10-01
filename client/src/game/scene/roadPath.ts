/**
 * The car on the road: its pose a distance along the road, in a lane, and
 * its wheels' spin from the distance travelled. Pure; the road's centreline
 * and the ground are injected (the sim's `roadCenterX` and `elevationAt`,
 * which the scene route passes in), so a test can use a straight line.
 */
import type { CarPose } from "./timeline.js";

/** The car's centreline x at z, and the ground's height. */
export type Road = { centerX: (z: number) => number; groundY: (x: number, z: number) => number };

/** The film car's tyre radius (m), for the spin. */
export const WHEEL_RADIUS = 0.348;
/** The film car's wheelbase (m): its axles 2.675 m apart. */
export const WHEELBASE = 2.675;
/** The steering wheel's turns per turn of the front wheels. */
export const STEERING_RATIO = 15;
/** The step along z the road's heading is read over. */
const HEADING_DZ = 1;

/** The car at `z`: on the centreline plus `lane` metres to its right, on the
 * ground, headed along the road the way it drives. */
export function roadPose(road: Road, z: number, lane: number, direction: 1 | -1): { x: number; y: number; z: number; yaw: number } {
  const cx = road.centerX(z);
  const dx = road.centerX(z + HEADING_DZ) - cx;
  // The road's heading toward +z, as a yaw; driving toward -z turns it round.
  const yaw = Math.atan2(dx, HEADING_DZ) + (direction === 1 ? 0 : Math.PI);
  // The car's right, heading +z, is +x; heading -z, it is -x.
  const x = cx + lane * direction;
  return { x, y: road.groundY(x, z), z, yaw };
}

/** The car driving from `startZ`, `distance(t)` metres along the road, in
 * `lane` (metres right of the centreline, a number or a function of time so
 * a car can ease onto the shoulder as it stops). */
export function carAlong(road: Road, startZ: number, distance: (t: number) => number, lane: number | ((t: number) => number), direction: 1 | -1): (t: number) => CarPose {
  return (t) => {
    const d = distance(t);
    const l = typeof lane === "number" ? lane : lane(t);
    const pose = roadPose(road, startZ + direction * d, l, direction);
    // The front wheels follow the road's curvature over the next metre.
    const ahead = roadPose(road, startZ + direction * (d + 1), l, direction);
    const wheelTurn = Math.atan(WHEELBASE * wrap(ahead.yaw - pose.yaw));
    return { ...pose, wheelSpin: d / WHEEL_RADIUS, doorOpen: 0, wheelTurn, steer: wheelTurn * STEERING_RATIO, handset: "cradle" };
  };
}

/** An angle in (−π, π]. */
function wrap(a: number): number {
  return Math.atan2(Math.sin(a), Math.cos(a));
}

/**
 * Distance travelled: `cruise` m/s until a braking stretch of `brakeSeconds`
 * that ends at `total` with the speed at zero (a linear brake covers half
 * the cruise's distance over its time), and none after.
 */
export function stopAt(total: number, cruise: number, brakeSeconds: number): (t: number) => number {
  const brakeDistance = (cruise * brakeSeconds) / 2;
  const cruiseEnd = (total - brakeDistance) / cruise;
  return (t) => {
    if (t <= 0) return 0;
    if (t <= cruiseEnd) return cruise * t;
    const u = Math.min(1, (t - cruiseEnd) / brakeSeconds);
    return total - brakeDistance + cruise * brakeSeconds * (u - u * u / 2);
  };
}
