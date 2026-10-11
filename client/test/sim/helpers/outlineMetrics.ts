/**
 * An outline's shape numbers as the lake survey reads them: shoreline
 * development P / (2√(πA)), convexity A / A_hull, and Feret length to width,
 * the longest distance between two hull points over the narrowest caliper
 * width. For the tests' sweeps.
 */
export function outlineMetrics(xs: readonly number[], zs: readonly number[]): {
  sdi: number; convexity: number; lw: number; area: number; perimeter: number;
} {
  const area = Math.abs(signedArea(xs, zs));
  let perimeter = 0;
  for (let i = 0, j = xs.length - 1; i < xs.length; j = i++) perimeter += Math.hypot(xs[i]! - xs[j]!, zs[i]! - zs[j]!);
  const hull = convexHull(xs, zs);
  const hullArea = Math.abs(signedArea(hull.map((p) => p[0]), hull.map((p) => p[1])));
  let length = 0;
  for (let i = 0; i < hull.length; i++) {
    for (let j = i + 1; j < hull.length; j++) length = Math.max(length, Math.hypot(hull[i]![0] - hull[j]![0], hull[i]![1] - hull[j]![1]));
  }
  let width = Infinity;
  for (let i = 0, j = hull.length - 1; i < hull.length; j = i++) {
    const ex = hull[i]![0] - hull[j]![0], ez = hull[i]![1] - hull[j]![1];
    const el = Math.hypot(ex, ez);
    if (el === 0) continue;
    let far = 0;
    for (const p of hull) far = Math.max(far, Math.abs((p[0] - hull[j]![0]) * ez - (p[1] - hull[j]![1]) * ex) / el);
    width = Math.min(width, far);
  }
  return { sdi: perimeter / (2 * Math.sqrt(Math.PI * area)), convexity: area / hullArea, lw: length / width, area, perimeter };
}

export function median(values: readonly number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)]!;
}

function signedArea(xs: readonly number[], zs: readonly number[]): number {
  let a = 0;
  for (let i = 0, j = xs.length - 1; i < xs.length; j = i++) a += xs[j]! * zs[i]! - xs[i]! * zs[j]!;
  return a / 2;
}

/** Andrew's monotone chain. */
function convexHull(xs: readonly number[], zs: readonly number[]): Array<[number, number]> {
  const pts = xs.map((x, i) => [x, zs[i]!] as [number, number]).sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const cross = (o: [number, number], a: [number, number], b: [number, number]): number =>
    (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lower: Array<[number, number]> = [];
  for (const p of pts) {
    while (lower.length >= 2 && cross(lower[lower.length - 2]!, lower[lower.length - 1]!, p) <= 0) lower.pop();
    lower.push(p);
  }
  const upper: Array<[number, number]> = [];
  for (let i = pts.length - 1; i >= 0; i--) {
    const p = pts[i]!;
    while (upper.length >= 2 && cross(upper[upper.length - 2]!, upper[upper.length - 1]!, p) <= 0) upper.pop();
    upper.push(p);
  }
  upper.pop();
  lower.pop();
  return lower.concat(upper);
}
