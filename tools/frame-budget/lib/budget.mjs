// The frame-budget harness's budgets: the bars a frame must clear, the factor k that carries them
// from the Air to a rig (the median of the views' ratios), the budget a run is judged against, the
// verdict on a tier's rows, and the estimate of what the Pro would draw. Arithmetic only; the
// numbers come from the rows.
import { medianOf, viewMedians } from "./sample.mjs";

export const MEAN_BAR_MS = 16.0;
export const P95_BAR_MS = 22;
export const PRO_FACTOR = 1.5;

const round = (x, dp) => Math.round(x * 10 ** dp) / 10 ** dp;

/** k, how much slower the rig is than the Air: per view the median of the rig's means over the
 * median of the Air's (3 dp), k their median and spread their range; views in one set only are
 * `missing`. */
export function kFor(rigRows, airRows) {
  const rig = viewMedians(rigRows);
  const air = viewMedians(airRows);
  const perView = {};
  const missing = [];
  for (const view of rig.keys()) {
    if (air.has(view)) perView[view] = round(rig.get(view).meanMs / air.get(view).meanMs, 3);
    else missing.push(view);
  }
  for (const view of air.keys()) if (!rig.has(view)) missing.push(view);
  const ratios = Object.values(perView);
  if (ratios.length === 0) throw new Error("no view is in both sets");
  return { k: medianOf(ratios), spread: [Math.min(...ratios), Math.max(...ratios)], perView, missing };
}

/** The budgets for a machine k times the Air, `factor` times the standard bars (3 dp). */
export function budgetFor(k, factor = 1) {
  return { meanMs: round(MEAN_BAR_MS * factor * k, 3), p95Ms: round(P95_BAR_MS * factor * k, 3) };
}

/** What a run on `tier` is judged against, with the `label` its verdict names it by, or null for
 * none; `entry` is the tier's entry in `budgets.json` (undefined when there is none). Its budget is
 * in the rig's milliseconds, so it applies only to a `--remote` run, the rig's rows. A run on this
 * Mac is judged against the bars themselves: medium against MEAN_BAR_MS and P95_BAR_MS, high
 * against them times the entry's factor (PRO_FACTOR without an entry), the Pro's bars carried to
 * the Air. */
export function runBudget(tier, remote, entry) {
  if (remote) {
    if (entry === undefined) return null;
    return { meanMs: entry.meanMs, p95Ms: entry.p95Ms, label: `the ${tier} budget on ${entry.machine} (${entry.meanMs} ms mean, ${entry.p95Ms} p95)` };
  }
  const factor = tier === "high" ? (entry?.factor ?? PRO_FACTOR) : 1;
  const { meanMs, p95Ms } = budgetFor(1, factor);
  const label =
    tier === "high"
      ? `the high bars × ${factor}, the Pro's by the factor (${meanMs.toFixed(1)} ms mean, ${p95Ms.toFixed(1)} p95)`
      : `the ${tier} bars on this machine (${meanMs.toFixed(1)} ms mean, ${p95Ms} p95)`;
  return { meanMs, p95Ms, label };
}

/** A tier's kept rows against its budget: per view the medians and whether either is over, the
 * view furthest over (or nearest) on the mean bar, and whether any view is over. */
export function verdict(rows, budget) {
  const views = {};
  let worst = null;
  let worstRatio = -Infinity;
  let over = false;
  for (const [view, m] of viewMedians(rows)) {
    const viewOver = m.meanMs > budget.meanMs || m.p95Ms > budget.p95Ms;
    views[view] = { meanMs: m.meanMs, p95Ms: m.p95Ms, over: viewOver };
    over = over || viewOver;
    if (m.meanMs / budget.meanMs > worstRatio) {
      worstRatio = m.meanMs / budget.meanMs;
      worst = view;
    }
  }
  return { views, worst, over };
}

/** A budget's name in a verdict: its `label`, or its two numbers. */
const nameOf = (budget) => budget.label ?? `the budget (${budget.meanMs} ms mean, ${budget.p95Ms} p95)`;

/** `verdict`'s result with the budget and the one line that states it: over or under the budget,
 * named, and the worst view, or "not judged" when no view has a row without a flag. The run's
 * table ends with this line (`table` in `sample.mjs`), so the table and the verdict cannot differ. */
export function judgement(rows, budget) {
  const v = verdict(rows, budget);
  const line =
    v.worst === null
      ? "verdict: not judged: no row without a flag"
      : `verdict: ${v.over ? "OVER" : "under"} ${nameOf(budget)}; worst ${v.worst} at ${v.views[v.worst].meanMs} ms mean, ${v.views[v.worst].p95Ms} ms p95`;
  return { budget, ...v, line };
}

/** The frames a second the Pro would draw, from the Air's mean frame time on the high tier. */
export function proEstimate(airHighMeanMs, factor = PRO_FACTOR) {
  return 1000 / (airHighMeanMs / factor);
}

/** Whether two estimates are within a factor of two of each other. */
export function estimatesAgree(a, b) {
  return Math.max(a, b) / Math.min(a, b) <= 2;
}

/** The entry `budgets.json` keeps: the inputs, and the budgets they give. */
export function budgetRecord({ tier, machine, gpu, browser, k, spread, factor, airWarm, date, commit }) {
  const { meanMs, p95Ms } = budgetFor(k, factor);
  return { tier, machine, gpu, browser, k, spread, factor, airWarm, date, commit, meanMs, p95Ms };
}
