// The frame-budget harness's budgets: the bars a frame must clear, the factor k that carries them
// from the Air to a rig (the median of the views' ratios), the verdict on a tier's rows, and the
// estimate of what the Pro would draw. Arithmetic only; the numbers come from the rows.
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
