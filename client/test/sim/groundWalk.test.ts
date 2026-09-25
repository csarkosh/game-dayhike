import { describe, it, expect } from "vitest";
import "../../src/sim/passes/index.js";
import { createForest } from "../../src/sim/forest.js";
import { createForestWorld, spawnPlayer, tickWorld } from "../../src/sim/world.js";
import { elevationAt, elevationSampleAt } from "../../src/sim/terrain.js";
import { PLAYER_HALF } from "../../src/sim/constants.js";
import { DEFAULT_TERRAIN_VARIANT, setActiveTerrainVariant } from "../../src/sim/terrain.js";
import { Button, type InputCommand } from "../../src/sim/types.js";
import { spiralSpawn } from "../../src/sim/spawn.js";

/**
 * Walking has to feel smooth, and "smooth" is a measurable property of the sim,
 * not of the renderer: the surface the player stands on must be the surface the
 * clipmap draws, which is the variant's continuous elevation field.
 *
 * Before the analytic ground, collision was a lattice of flat-topped 1 m columns
 * quantized to HEIGHT_QUANTUM. Walking downhill across it measured 196 airborne
 * ticks out of 240 — the player repeatedly walked off a column edge, fell, and
 * landed — with feet sitting a median 0.57 m above the drawn ground. Both
 * numbers are what these tests pin to zero.
 */

const SEEDS = [1234, 0xf0e57, 99];
/** Cardinals plus a diagonal: column edges are axis-aligned, so a diagonal path
 * crosses twice as many of them and was the worst case for the old staircase. */
const YAWS = [0, Math.PI / 2, Math.PI, -Math.PI / 2, Math.PI / 4];

type Vec2 = { x: number; z: number };

type Walk = {
  feet: number[];
  drawn: number[];
  grounded: boolean[];
  positions: Vec2[];
  gradient: number[];
};

/** Each (seed, heading) walk is simulated once and read by all three tests. */
const WALKS = new Map<string, Walk>();
function walkOnce(seed: number, yaw: number, sprinting = false): Walk {
  const key = `${seed},${yaw},${sprinting}`;
  let w = WALKS.get(key);
  if (w === undefined) {
    w = walk(seed, yaw, 240, sprinting);
    WALKS.set(key, w);
  }
  return w;
}

/**
 * Both gaits, every case. Sprinting is the stress case for the ground-stick
 * rule: a third more ground per tick means a third more chance to be carried
 * clear of a crest that curves away underneath, which is exactly the failure
 * the old columns produced.
 */
const GAITS = [false, true];

function walk(
  seed: number,
  yaw: number,
  ticks: number,
  sprinting = false,
): Walk {
  setActiveTerrainVariant(DEFAULT_TERRAIN_VARIANT);
  const forest = createForest(seed);
  const world = createForestWorld(forest);
  const player = spawnPlayer(world);

  // The game now spawns on the trailhead flat — a 14 m disc at the foot of a
  // face too steep to stand on. These
  // walks measure the FIELD's smoothness over 20–30 m in fixed directions, so
  // they start from open ground outside the bowl instead: the same inland band
  // the old origin spawn used, 1.5 km along the road from the trailhead (the
  // bowl ends at |z| = 600). The trailhead itself is covered by spawn.test.ts
  // and trailWalk.test.ts.
  const open = spiralSpawn(world.boxes, seed, PLAYER_HALF, { x: 0.5, z: -1500.5 });
  const s0 = world.state.players.get(player.id);
  if (s0 === undefined) throw new Error("player vanished");
  s0.pos.x = open.x;
  s0.pos.y = open.y;
  s0.pos.z = open.z;
  s0.vel.x = 0;
  s0.vel.y = 0;
  s0.vel.z = 0;

  const still = (seq: number): InputCommand => ({
    seq,
    moveX: 0,
    moveZ: 0,
    yaw,
    pitch: 0,
    buttons: 0,
  });
  // Settle out of the spawn drop before measuring: a player still falling onto
  // the ground is not what this measures.
  for (let i = 0; i < 120; i++) tickWorld(world, new Map([[player.id, still(i)]]));

  const feet: number[] = [];
  const drawn: number[] = [];
  const grounded: boolean[] = [];
  const positions: Vec2[] = [];
  const gradient: number[] = [];
  for (let i = 0; i < ticks; i++) {
    const cmd: InputCommand = {
      seq: 1000 + i,
      moveX: 0,
      moveZ: 1,
      yaw,
      pitch: 0,
      buttons: sprinting ? Button.Sprint : 0,
    };
    tickWorld(world, new Map([[player.id, cmd]]));
    const s = world.state.players.get(player.id);
    if (s === undefined) throw new Error("player vanished");
    feet.push(s.pos.y - PLAYER_HALF.y);
    drawn.push(elevationAt(seed, s.pos.x, s.pos.z));
    grounded.push(s.grounded);
    positions.push({ x: s.pos.x, z: s.pos.z });
    const e = elevationSampleAt(seed, s.pos.x, s.pos.z);
    gradient.push(Math.sqrt(e.dx * e.dx + e.dz * e.dz));
  }
  return { feet, drawn, grounded, positions, gradient };
}

describe("walking the generated ground", () => {
  it("never leaves the ground while walking across it", () => {
    for (const seed of SEEDS) {
      for (const yaw of YAWS) {
        for (const sprinting of GAITS) {
          const { grounded } = walkOnce(seed, yaw, sprinting);
          const airborne = grounded.filter((g) => !g).length;
          expect({ seed, yaw, sprinting, airborne }).toEqual({ seed, yaw, sprinting, airborne: 0 });
        }
      }
    }
  }, 300_000);

  it("stands on exactly the surface the renderer draws", () => {
    // The clipmap samples `elevationAt` directly, so any gap here is a gap
    // between where you are and where you can see you are.
    for (const seed of SEEDS) {
      for (const yaw of YAWS) {
        for (const sprinting of GAITS) {
          const { feet, drawn } = walkOnce(seed, yaw, sprinting);
          let worst = 0;
          for (const [i, f] of feet.entries()) {
            const gap = Math.abs(f - (drawn[i] as number));
            if (gap > worst) worst = gap;
          }
          expect({ seed, yaw, sprinting, ok: worst < 1e-6 }).toEqual({ seed, yaw, sprinting, ok: true });
        }
      }
    }
  });

  it("rises no faster than the slope it is standing on explains", () => {
    // The one property that rules out risers and falls without also asserting
    // that the terrain itself is smooth (it is not — the field is fbm, and its
    // roughness is content, not a bug). Over one tick the hull covers about
    // 0.117 m of ground; following the surface means the height change cannot
    // exceed the local gradient times that distance.
    //
    // The old columns violated it in both directions and by a wide margin: a
    // step-up took a 0.16 m riser in a single tick against a 0.117 m bound, and
    // mid-fall descent reached 0.147 m against a bound of 0.058 — excesses of
    // +0.04 and +0.09. Measured excess now is at most 0.0 across every seed and
    // heading below, so the 0.01 slack for curvature within a step still leaves
    // this test failing loudly on any return of the staircase.
    const CURVATURE_SLACK = 0.01;
    for (const seed of SEEDS) {
      for (const yaw of YAWS) {
        for (const sprinting of GAITS) {
        const { feet, positions, gradient } = walkOnce(seed, yaw, sprinting);
        let worst = -Infinity;
        for (let i = 1; i < feet.length; i++) {
          const rise = Math.abs((feet[i] as number) - (feet[i - 1] as number));
          const dx = (positions[i] as Vec2).x - (positions[i - 1] as Vec2).x;
          const dz = (positions[i] as Vec2).z - (positions[i - 1] as Vec2).z;
          const travelled = Math.sqrt(dx * dx + dz * dz);
          const slope = Math.max(gradient[i] as number, gradient[i - 1] as number);
          const excess = rise - slope * travelled;
          if (excess > worst) worst = excess;
        }
        expect({ seed, yaw, sprinting, ok: worst <= CURVATURE_SLACK }).toEqual({
          seed,
          yaw,
          sprinting,
          ok: true,
        });
        }
      }
    }
  });
});
