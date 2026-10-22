// The frame-budget harness's samples: frames reduced to a mean and a 95th percentile, the flags
// that say a reading cannot be trusted, the order two builds are interleaved in, the pairs' deltas
// and the table a run prints.

/** The CPU cores busy with other work (outside the harness and its Chrome) above which a machine
 * is too busy for its reading to count. Not a load average: the harness's own Chrome would fill it. */
export const QUIET_LOAD = 2.0;

/** The GPU's Device Utilization % (from `ioreg -r -c AGXAccelerator -d 1`) at or above which another
 * page is drawing on the Mac and its rows are void. An idle desktop reads 0 to 15. */
export const QUIET_GPU = 20;

/** The number after `"Device Utilization %"=` in `ioreg`'s text, or null when it is not there. */
export function parseGpuUtil(ioregText) {
  const m = /"Device Utilization %"\s*=\s*(\d+)/.exec(ioregText);
  return m === null ? null : Number(m[1]);
}

const round = (x, dp) => Math.round(x * 10 ** dp) / 10 ** dp;

/** A sample's frame times as `{ n, mean, p95 }`, each to 2 dp. */
export function summarise(frameMs) {
  const n = frameMs.length;
  if (n < 10) throw new Error(`a sample needs at least 10 frames, got ${n}`);
  const sorted = [...frameMs].sort((a, b) => a - b);
  const mean = sorted.reduce((s, x) => s + x, 0) / n;
  return { n, mean: round(mean, 2), p95: round(sorted[Math.floor(0.95 * n)], 2) };
}

/** The median; the mean of the two middle values for an even count. */
export function medianOf(xs) {
  if (xs.length === 0) throw new Error("no values to take a median of");
  const s = [...xs].sort((a, b) => a - b);
  const mid = s.length >> 1;
  return s.length % 2 === 1 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

/** Why a row cannot be trusted: the canvas changed size during the sample, or the machine was busy. */
export function flagsFor(row) {
  const flags = [];
  if (row.canvas.start[0] !== row.canvas.end[0] || row.canvas.start[1] !== row.canvas.end[1]) flags.push("scale-moved");
  if (row.load !== null && row.load > QUIET_LOAD) flags.push("loaded");
  return flags;
}

/** The order the builds are opened in for `pairs` pairs: A B, then B A, then A B, so a drift in
 * the machine does not favour one build. */
export function pairOrder(pairs) {
  const order = [];
  for (let i = 0; i < pairs; i++) order.push(...(i % 2 === 0 ? ["A", "B"] : ["B", "A"]));
  return order;
}

/** The rows with no flags. */
export function keep(rows) {
  return rows.filter((r) => flagsFor(r).length === 0);
}

/** The kept rows by view, in the order the views first appear. */
export function byView(rows) {
  const views = new Map();
  for (const r of keep(rows)) {
    if (!views.has(r.view)) views.set(r.view, []);
    views.get(r.view).push(r);
  }
  return views;
}

/** Each kept view's rows reduced to the median of their means and of their 95th percentiles.
 * Flagged rows are left out here, so every reading built on it sees kept rows only. */
export function viewMedians(rows) {
  const out = new Map();
  for (const [view, rs] of byView(rows)) {
    out.set(view, { meanMs: medianOf(rs.map((r) => r.mean)), p95Ms: medianOf(rs.map((r) => r.p95)), n: rs.length });
  }
  return out;
}

/** The pairs of one view's rows (A then B, in order) as `{ pair, a, b, delta }` on the means, delta
 * `b - a` to 2 dp, and the median of the deltas. A pair is each A with the nearest B in its
 * interleaving: rows are taken in order, the first A with the first B, the next A with the next B.
 * When the builds have different counts the surplus rows are dropped. */
export function pairDeltas(rows) {
  const as = rows.filter((r) => r.build === "A");
  const bs = rows.filter((r) => r.build === "B");
  const pairs = [];
  for (let i = 0; i < Math.min(as.length, bs.length); i++) {
    pairs.push({ pair: i + 1, a: as[i].mean, b: bs[i].mean, delta: round(bs[i].mean - as[i].mean, 2) });
  }
  return { pairs, median: pairs.length === 0 ? null : medianOf(pairs.map((p) => p.delta)) };
}

/** One line a view, and with a budget a last line for the tier. Takes all the rows: the counts
 * show how many of a view's rows were kept, and the medians and the verdict use the kept ones. */
export function table(rows, budget = null) {
  const lines = [];
  let worst = null;
  let worstRatio = -Infinity;
  let anyOver = false;
  const total = new Map();
  for (const r of rows) total.set(r.view, (total.get(r.view) ?? 0) + 1);
  for (const [view, m] of viewMedians(rows)) {
    let line = `${view}  n=${m.n}/${total.get(view)}  mean ${m.meanMs} ms  p95 ${m.p95Ms} ms`;
    if (budget !== null) {
      const over = m.meanMs > budget.meanMs || m.p95Ms > budget.p95Ms;
      anyOver = anyOver || over;
      line += `  ${over ? "OVER" : "under"} (B ${budget.meanMs}/${budget.p95Ms})`;
      if (m.meanMs / budget.meanMs > worstRatio) {
        worstRatio = m.meanMs / budget.meanMs;
        worst = view;
      }
    }
    lines.push(line);
  }
  if (budget !== null) lines.push(anyOver ? `OVER budget (worst ${worst})` : "under budget");
  return lines.join("\n");
}
