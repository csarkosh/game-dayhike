import { registerPass } from "../chunk.js";
import { CHUNK_SIZE } from "../forestConstants.js";
import { activeTerrainVariant, elevationSampleAt } from "../terrain.js";
import { ROAD_BED_HALF } from "../road.js";
import { TRAILHEAD_U } from "../bowl.js";
import { TRAIL_BED_HALF, trailDistance } from "../trail.js";
import type { TrailGraph } from "../trail.js";
import type { Vec3 } from "../types.js";

/** The trailhead's two props: axis-aligned brushes for the ranger's car and
 * the roofed notice board (the kiosk) the missing hiker's poster is pinned
 * to. The drawn models stand on these boxes; the boxes are what a hiker
 * collides with.
 *
 * BOTH STAND IN THE ROAD FRAME (u from the road centreline, z from the
 * trailhead's own anchor). The board
 * used to be laid out in a DEPARTURE FRAME whose `a` pointed
 * into the widest FREE wedge at node 0, i.e. away from the trail; that was
 * sound while the pad sat 44 m inland, but moving TRAILHEAD_U to 9 means
 * the trail now leaves the pad INLAND, so "away from the
 * trail" became "at the highway": measured over 40 sweep seeds, 38 of them put
 * a prop on the pavement (|u| <= ROAD_BED_HALF). The departure
 * frame and its machinery are deleted with it.
 *
 * In the road frame the kiosk is on the INLAND side of the pad by
 * construction — u = TRAILHEAD_U + 2, i.e. 11 m from the centreline against
 * ROAD_BED_HALF's 5.5 — and its z offset of +7 from the anchor keeps it the
 * length of the pad's own radius away from the trailhead node. The bed
 * clearance the departure frame used to buy survives as a REJECTION instead
 * (`propSite` below): a prop whose fixed site lands inside the trail bed's
 * own clearance takes the MIRRORED z, on the other side of the pad.
 * Measured over the 227-seed sweep with the old 1.2 m board, whose clearance
 * was 1.85 m: its primary site was inside the clearance on 15 seeds, never
 * both sides on any seed, and the worst margin after mirroring was +0.78 m
 * (2026-09-26; it read +4.90 m when first measured). The kiosk keeps the board's
 * site and widens to 2.2 m, so its clearance rises to 2.35 m: 0.5 m more,
 * under that margin, so no seed's side changes (still 15 mirrored) and the
 * kiosk's worst margin is +0.28 m. The sweep
 * in `trailhead.test.ts` holds both clauses over the same 227 seeds: the
 * road-side face clear of ROAD_BED_HALF + 0.5, and the bed clearance.
 *
 * The boxes themselves are axis-aligned world-space AABBs; the frame only
 * places their centres. Props are found by material (`roadProp`), never by
 * their place in PROPS. */
export const CAR_HALF: Vec3 = { x: 0.9, y: 0.8, z: 2.3 };
/** The kiosk: 2.2 m wide along world x (across the road, which runs along
 * z), 2.5 m tall to the roof, 1.1 m deep along z, the way its poster faces. */
export const KIOSK_HALF: Vec3 = { x: 1.1, y: 1.25, z: 0.55 };

/** The car: parked on the shoulder, parallel to the
 * road, its road-side face 0.5 m off the pavement edge, beside the pad (not
 * on it). */
export const CAR_ROAD_U = ROAD_BED_HALF + 0.5 + CAR_HALF.x; // centre's u
export const CAR_ROAD_Z = 12;                              // centre's z from the anchor: clears the pad disc

/** The kiosk, beside the car in the same road frame: two metres inland of
 * the pad centre, seven along the road. */
export const SIGN_ROAD_U = TRAILHEAD_U + 2;
export const SIGN_ROAD_Z = 7;

export const CAR_MATERIAL = "car";
export const KIOSK_MATERIAL = "kiosk";

export type RoadProp = { material: string; half: Vec3; u: number; z: number };
export const PROPS: readonly RoadProp[] = [
  { material: KIOSK_MATERIAL, half: KIOSK_HALF, u: SIGN_ROAD_U, z: SIGN_ROAD_Z },
  { material: CAR_MATERIAL, half: CAR_HALF, u: CAR_ROAD_U, z: CAR_ROAD_Z },
];

/** The trailhead prop of a material. Throws on a material PROPS does not hold. */
export function roadProp(material: string): RoadProp {
  const p = PROPS.find((q) => q.material === material);
  if (p === undefined) throw new Error(`no trailhead prop of material "${material}"`);
  return p;
}

/** The way the kiosk's poster faces: along the road, toward the pad, so a
 * hiker on the pad reads it. The kiosk stands SIGN_ROAD_Z along the road from
 * the trailhead on one side or the other (`propSite` mirrors it), and faces
 * back. A unit direction, never an angle. */
export function kioskFacing(site: { z: number }, trailhead: { z: number }): { dx: number; dz: number } {
  return { dx: 0, dz: site.z > trailhead.z ? -1 : 1 };
}

/**
 * Where a prop stands: the road frame's own centreline at the prop's OWN z
 * (the centreline curves, so a site 7 m along the road is not 7 m along a
 * straight line), offset inland by `u`.
 *
 * The one seeded-world decision left in the layout is the SIDE: `z` first,
 * and `-z` when the first site is inside the trail bed's clearance
 * (TRAIL_BED_HALF + the prop's own half-extent + 0.5 m, the same rule the
 * departure frame's sweep has always asserted). Nothing else varies with the
 * world, so a prop cannot wander onto the pavement the way the departure
 * frame's "away from the trail" could. The rule is deterministic (a plain
 * min over the graph's edges) and the test asserts its outcome, not its
 * internals.
 */
export function propSite(
  graph: Pick<TrailGraph, "nodes" | "edges" | "trailhead">,
  roadCenterX: (seed: number, z: number) => number,
  seed: number, p: RoadProp,
): { x: number; z: number } {
  const clear = TRAIL_BED_HALF + Math.max(p.half.x, p.half.z) + 0.5;
  const siteAt = (side: number): { x: number; z: number; d: number } => {
    const z = graph.trailhead.z + side;
    const x = roadCenterX(seed, z) + p.u;
    return { x, z, d: trailDistance(graph as TrailGraph, x, z) };
  };
  const first = siteAt(p.z);
  if (first.d >= clear) return { x: first.x, z: first.z };
  // Never reached over the 227-seed sweep (no seed has both sides inside the
  // clearance); the roomier side is the answer if one ever does.
  const second = siteAt(-p.z);
  const s = second.d > first.d ? second : first;
  return { x: s.x, z: s.z };
}

/** Pass 8. Emits each prop into the chunk that contains its centre, so a
 * prop is emitted exactly once even when its box straddles a chunk edge —
 * the collision broadphase surfaces every chunk a query overlaps. */
registerPass({
  id: 8,
  name: "trailhead",
  get tunables() {
    return {
      CAR_HALF_X: CAR_HALF.x, CAR_HALF_Y: CAR_HALF.y, CAR_HALF_Z: CAR_HALF.z,
      KIOSK_HALF_X: KIOSK_HALF.x, KIOSK_HALF_Y: KIOSK_HALF.y, KIOSK_HALF_Z: KIOSK_HALF.z,
      CAR_ROAD_U, CAR_ROAD_Z, SIGN_ROAD_U, SIGN_ROAD_Z,
    };
  },
  run(chunk, worldSeed) {
    const variant = activeTerrainVariant();
    const graph = variant.trailGraph?.(worldSeed);
    if (graph === undefined) return;
    const roadCenterX = variant.roadCenterX;
    if (roadCenterX === undefined) return;
    const minX = chunk.cx * CHUNK_SIZE;
    const minZ = chunk.cz * CHUNK_SIZE;
    const maxX = minX + CHUNK_SIZE;
    const maxZ = minZ + CHUNK_SIZE;
    for (const p of PROPS) {
      const { x: cx, z: cz } = propSite(graph, roadCenterX, worldSeed, p);
      if (cx < minX || cx >= maxX || cz < minZ || cz >= maxZ) continue;
      const ground = elevationSampleAt(worldSeed, cx, cz).h;
      chunk.props.push({
        material: p.material,
        box: {
          min: { x: cx - p.half.x, y: ground, z: cz - p.half.z },
          max: { x: cx + p.half.x, y: ground + 2 * p.half.y, z: cz + p.half.z },
        },
      });
    }
  },
});
