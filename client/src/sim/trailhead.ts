import { ROAD_BED_HALF } from "./road.js";
import { TRAILHEAD_U, TRAILHEAD_RADIUS } from "./bowl.js";
import { PLAYER_HALF } from "./constants.js";
import { segmentBoxGap, type Ground } from "./boxGap.js";
import { TRAIL_BED_HALF, trailDistance } from "./trail.js";
import type { TrailGraph, TrailNode } from "./trail.js";
import type { Vec3 } from "./types.js";
import { facingYaw } from "./facing.js";

/** The trailhead's places: the ranger's car, the roofed notice board and
 * where a player arrives. Its two props are axis-aligned brushes for the car and
 * the notice board (the kiosk) the missing hiker's poster is pinned
 * to. The drawn models stand on these boxes; the boxes are what a hiker
 * collides with. The board stands by `propSite`, the car by `carSite`.
 *
 * THE BOARD STANDS IN THE ROAD FRAME (u from the road centreline, z from the
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
 * their place in PROPS.
 *
 * Pure geometry and constants. Pass 8 (passes/trailhead.ts) emits the boxes;
 * this module registers nothing, so reading a constant from it has no effect. */
export const CAR_HALF: Vec3 = { x: 0.9, y: 0.8, z: 2.3 };
/** The kiosk: 2.2 m wide along world x (across the road, which runs along
 * z), 2.5 m tall to the roof, 1.1 m deep along z, the way its poster faces. */
export const KIOSK_HALF: Vec3 = { x: 1.1, y: 1.25, z: 0.55 };

/** The car: parked on the shoulder, parallel to the
 * road, its road-side face 0.5 m off the pavement edge, at the pad's own
 * place along the road, so that it is behind a player who stands near the
 * pad's centre and faces the trail. */
export const CAR_ROAD_U = ROAD_BED_HALF + 0.5 + CAR_HALF.x; // centre's u
export const CAR_ROAD_Z = 0;                               // centre's z from the anchor
/** The least gap from the bed's centreline to the car's box: the bed's
 * half-width and a player's, so a player walking the bed's edge clears the
 * car. Where the gap is less, the car slides along the road. */
export const CAR_BED_CLEAR = TRAIL_BED_HALF + PLAYER_HALF.x;
export const CAR_SLIDE_STEP = 0.5;
/** The pad's radius. Over the 227-seed sweep the car slides 3.5 m at most. */
export const CAR_SLIDE_MAX = 8;
/** How far past the car's box, along the line to the entrance, a player
 * spawns (`trailheadSpawn` in spawn.ts). It stands here because it is part
 * of what every peer must agree on, and the pass's tunables are what the
 * level id reads. */
export const SPAWN_GAP = 2.5;

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

export type EntranceGraph = Pick<TrailGraph, "nodes" | "edges" | "stem" | "trailhead">;

/**
 * The trail's entrance: the point where the stem's first edge crosses the
 * pad's rim, and the unit direction the trail leaves in. The first edge is
 * longer than the pad's radius on every seed of the sweep (11.4 m at the
 * least), so the bed is straight from the pad's centre to the rim. A graph
 * with no stem leaves toward +x.
 */
export function trailEntrance(graph: EntranceGraph): { x: number; z: number; dx: number; dz: number } {
  const first = graph.stem.length === 0 ? undefined : graph.edges[graph.stem[0] as number];
  const from = graph.nodes[0] as TrailNode;
  const to = first === undefined ? from : (graph.nodes[first.a === 0 ? first.b : first.a] as TrailNode);
  const ex = to.x - from.x, ez = to.z - from.z;
  const len = Math.sqrt(ex * ex + ez * ez);
  const dx = len > 0 ? ex / len : 1, dz = len > 0 ? ez / len : 0;
  return { x: graph.trailhead.x + dx * TRAILHEAD_RADIUS, z: graph.trailhead.z + dz * TRAILHEAD_RADIUS, dx, dz };
}

/** The least gap from any edge's centreline to a box. */
export function bedGap(graph: Pick<TrailGraph, "nodes" | "edges">, centre: Ground, half: Ground): number {
  let gap = Infinity;
  for (const e of graph.edges) {
    const g = segmentBoxGap(graph.nodes[e.a] as TrailNode, graph.nodes[e.b] as TrailNode, centre, half);
    if (g < gap) gap = g;
  }
  return gap;
}

/**
 * Where the car stands: on the shoulder at the pad's own place along the
 * road, and where the bed would come within CAR_BED_CLEAR of its box, slid
 * along the road in CAR_SLIDE_STEP steps until it does not, or until
 * CAR_SLIDE_MAX. It slides away from the way the trail heads, so the bed
 * runs off from the car and not along its flank. Over the 227-seed sweep it
 * stands at the pad on 216 seeds and slides 3 m on one and 3.5 m on ten.
 */
export function carSite(
  graph: EntranceGraph,
  roadCenterX: (seed: number, z: number) => number,
  seed: number,
): Ground {
  const away = trailEntrance(graph).dz > 0 ? -1 : 1;
  const at = (slide: number): Ground => {
    const z = graph.trailhead.z + CAR_ROAD_Z + away * slide;
    return { x: roadCenterX(seed, z) + CAR_ROAD_U, z };
  };
  let site = at(0);
  for (let slide = CAR_SLIDE_STEP; slide <= CAR_SLIDE_MAX && bedGap(graph, site, CAR_HALF) < CAR_BED_CLEAR; slide += CAR_SLIDE_STEP) {
    site = at(slide);
  }
  return site;
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
  graph: EntranceGraph,
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

/** Where the prop of a material stands: the car by its own rule, the rest by `propSite`. */
export function trailheadSite(
  graph: EntranceGraph,
  roadCenterX: (seed: number, z: number) => number,
  seed: number,
  material: string,
): Ground {
  return material === CAR_MATERIAL ? carSite(graph, roadCenterX, seed) : propSite(graph, roadCenterX, seed, roadProp(material));
}

/** Where a player arrives, and the yaw they face. */
export type Start = { x: number; z: number; yaw: number };

/**
 * A player arrives on the straight line from the car to the trail's
 * entrance, SPAWN_GAP past the point where that line leaves the car's box,
 * facing the entrance. Because they stand on that line, the car is behind
 * them and the entrance ahead whatever way the trail leaves the pad: on 24
 * of the 227 sweep seeds it leaves nearly parallel to the road, and a place
 * fixed in the road's frame could not put the car behind them there.
 */
export function trailheadSpawn(graph: EntranceGraph, car: Ground): Start {
  const e = trailEntrance(graph);
  const lx = e.x - car.x, lz = e.z - car.z;
  const len = Math.sqrt(lx * lx + lz * lz);
  const ux = lx / len, uz = lz / len;
  const ax = ux < 0 ? -ux : ux, az = uz < 0 ? -uz : uz;
  // How far along the line the car's box reaches: the nearer of its two faces.
  const outX = ax === 0 ? Infinity : CAR_HALF.x / ax;
  const outZ = az === 0 ? Infinity : CAR_HALF.z / az;
  const reach = (outX < outZ ? outX : outZ) + SPAWN_GAP;
  const x = car.x + ux * reach, z = car.z + uz * reach;
  return { x, z, yaw: facingYaw(e.x - x, e.z - z) };
}
