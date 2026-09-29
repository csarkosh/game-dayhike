/**
 * The map on the trailhead board: this world's own trails, laid out on a
 * sheet as a player standing at the road and facing inland would hold it.
 * Up the sheet is inland (+x) and right across it is -z. Pure: plain numbers
 * in pixels, which the painter draws.
 */
export type MapPoint = { x: number; y: number };
export type MapLine = { x0: number; y0: number; x1: number; y1: number };

export type MapInput = {
  nodes: readonly { x: number; z: number }[];
  edges: readonly { a: number; b: number; kind: string }[];
  /** The road's centreline, sampled along z. */
  road: readonly { x: number; z: number }[];
  /** The made features: the peak, the ponds, the meadows. */
  features: readonly { kind: string; x: number; z: number; radius: number }[];
  /** The named places, the summit among them. */
  places: readonly { name: string; x: number; z: number }[];
  /** The name the summit goes by among `places`. */
  summitName: string;
};

export type BoardMap = {
  /** Pixels to a metre. */
  scale: number;
  stem: MapLine[];
  /** Loop, strand and rung edges: drawn dashed. */
  side: MapLine[];
  road: MapPoint[];
  ponds: { x: number; y: number; rx: number; ry: number }[];
  /** Rings round the peak, innermost first. */
  rings: { x: number; y: number; rx: number; ry: number }[];
  summit: MapPoint | null;
  labels: { text: string; x: number; y: number }[];
  /** The pad: node 0. */
  here: MapPoint;
};

/** Metres of ground kept round the trails on every side. */
export const MAP_MARGIN = 60;
export const MAP_RINGS = 5;

/**
 * The map of a world, fitted inside `inner` (a rectangle in pixels) with
 * its proportions kept and centred in whichever direction has room to spare.
 */
export function boardMap(input: MapInput, inner: { x: number; y: number; width: number; height: number }): BoardMap {
  let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
  for (const n of input.nodes) {
    if (n.x < x0) x0 = n.x;
    if (n.x > x1) x1 = n.x;
    if (n.z < z0) z0 = n.z;
    if (n.z > z1) z1 = n.z;
  }
  if (input.nodes.length === 0) {
    x0 = 0; x1 = 0; z0 = 0; z1 = 0;
  }
  x0 -= MAP_MARGIN; x1 += MAP_MARGIN; z0 -= MAP_MARGIN; z1 += MAP_MARGIN;
  const scale = Math.min(inner.width / (z1 - z0), inner.height / (x1 - x0));
  const left = inner.x + (inner.width - (z1 - z0) * scale) / 2;
  const top = inner.y + (inner.height - (x1 - x0) * scale) / 2;
  const at = (x: number, z: number): MapPoint => ({ x: left + (z1 - z) * scale, y: top + (x1 - x) * scale });

  const stem: MapLine[] = [], side: MapLine[] = [];
  for (const e of input.edges) {
    const a = input.nodes[e.a], b = input.nodes[e.b];
    if (a === undefined || b === undefined) continue;
    const p = at(a.x, a.z), q = at(b.x, b.z);
    (e.kind === "stem" ? stem : side).push({ x0: p.x, y0: p.y, x1: q.x, y1: q.y });
  }
  const road: MapPoint[] = [];
  for (const r of input.road) if (r.z >= z0 && r.z <= z1) road.push(at(r.x, r.z));

  const ponds: BoardMap["ponds"] = [], rings: BoardMap["rings"] = [];
  for (const f of input.features) {
    const c = at(f.x, f.z);
    if (f.kind === "pond") ponds.push({ x: c.x, y: c.y, rx: f.radius * scale, ry: f.radius * scale });
    if (f.kind === "peak") {
      for (let k = 1; k <= MAP_RINGS; k++) {
        const r = (f.radius * scale * k) / MAP_RINGS;
        rings.push({ x: c.x, y: c.y, rx: r, ry: r });
      }
    }
  }
  let summit: MapPoint | null = null;
  const labels: BoardMap["labels"] = [];
  for (const p of input.places) {
    const c = at(p.x, p.z);
    if (p.name === input.summitName) summit = c;
    labels.push({ text: p.name, x: c.x, y: c.y });
  }
  const pad = input.nodes[0];
  return { scale, stem, side, road, ponds, rings, summit, labels, here: pad === undefined ? at(0, 0) : at(pad.x, pad.z) };
}
