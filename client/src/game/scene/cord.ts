/**
 * A coiled cord's path between two plugs: a curve that sags under its own weight when the plugs
 * are nearer than the cord's length (by at most `maxSag`, the coil holding the rest up), wound
 * in `turns` coils of `radius` about it. The coil narrows to nothing over the last twentieth at
 * either end, so the cord meets each plug. Pure: the stage lays a tube along it every frame.
 */
export type CordOptions = { length: number; maxSag: number; radius: number; turns: number; points: number };
type Point = { x: number; y: number; z: number };

const cross = (a: Point, b: Point): Point => ({ x: a.y * b.z - a.z * b.y, y: a.z * b.x - a.x * b.z, z: a.x * b.y - a.y * b.x });
const unit = (a: Point): Point => {
  const l = Math.hypot(a.x, a.y, a.z);
  return { x: a.x / l, y: a.y / l, z: a.z / l };
};

export function coiledCord(a: Point, b: Point, { length, maxSag, radius, turns, points }: CordOptions): Point[] {
  const span = Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z);
  const sag = Math.min(maxSag, Math.max(0, (length - span) / 2));
  const along = (u: number): Point => ({
    x: a.x + (b.x - a.x) * u,
    y: a.y + (b.y - a.y) * u - 4 * sag * u * (1 - u),
    z: a.z + (b.z - a.z) * u,
  });
  const out: Point[] = [];
  for (let i = 0; i < points; i += 1) {
    const u = i / (points - 1);
    const p = along(u);
    const ahead = along(Math.min(1, u + 1e-3)), behind = along(Math.max(0, u - 1e-3));
    const tangent = unit({ x: ahead.x - behind.x, y: ahead.y - behind.y, z: ahead.z - behind.z });
    // A frame about the curve: level across it, then the third; a vertical stretch takes x.
    const level = cross(tangent, { x: 0, y: 1, z: 0 });
    const across = unit(Math.hypot(level.x, level.y, level.z) > 1e-6 ? level : cross(tangent, { x: 1, y: 0, z: 0 }));
    const third = cross(tangent, across);
    const r = radius * Math.min(1, u / 0.05, (1 - u) / 0.05);
    const angle = 2 * Math.PI * turns * u;
    const c = Math.cos(angle) * r, s = Math.sin(angle) * r;
    out.push({ x: p.x + c * across.x + s * third.x, y: p.y + c * across.y + s * third.y, z: p.z + c * across.z + s * third.z });
  }
  return out;
}
