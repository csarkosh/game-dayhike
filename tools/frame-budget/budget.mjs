// Calibration: a tier's budget from an Air file and a rig file. The budgets are the standard bars
// scaled by how much slower the rig is than the Air (k, the median of the views' ratios), so a
// rig that is 1.2x the Air is held to 1.2x the bars. For the high tier the Pro's frame rate is
// estimated two ways, from the Air's high rows by the factor and from the owner's reading on the
// M3 Max, as a sanity check that the factor is not far out.
//
//   node tools/frame-budget/budget.mjs --tier medium --air <air.jsonl> --rig <rig.jsonl> \
//     --machine "g4dn.xlarge" [--factor 1.5]
//
// Writes (or replaces) the tier's entry in budgets.json, keeping the other tier's.
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { PRO_FACTOR, budgetRecord, estimatesAgree, kFor, proEstimate } from "./lib/budget.mjs";
import { keep, medianOf, viewMedians } from "./lib/sample.mjs";

const BUDGETS = fileURLToPath(new URL("./budgets.json", import.meta.url));
/** The owner's reading on the M3 Max, 30 fps, divided by 2 to 2.5 for the Pro: frames a second. */
const M3_MAX_PRO_FPS = [12, 15];
const M3_MAX_MIDPOINT = 13.5;

/** The tier's k and budget record from the two sets of rows, and for the high tier the Pro's two
 * estimates (frames a second) and whether they agree; `info` is what the rows cannot give
 * (`machine`, `date`, `commit`) with `gpu` and `browser` falling back to the rig rows'. */
export function calibrate(airRows, rigRows, tier, factor, info) {
  const air = keep(airRows.filter((r) => r.tier === tier));
  const rig = keep(rigRows.filter((r) => r.tier === tier));
  const k = kFor(rig, air);
  const record = budgetRecord({
    tier,
    machine: info.machine,
    gpu: info.gpu ?? rig[0]?.gpu,
    browser: info.browser ?? rig[0]?.browser,
    k: k.k,
    spread: k.spread,
    factor,
    airWarm: true,
    date: info.date,
    commit: info.commit,
  });
  let estimates = null;
  if (tier === "high") {
    const airMean = medianOf([...viewMedians(air).values()].map((m) => m.meanMs));
    const fromAir = proEstimate(airMean, factor);
    estimates = { fromAir, fromM3Max: M3_MAX_PRO_FPS, agree: estimatesAgree(fromAir, M3_MAX_MIDPOINT) };
  }
  return { k, record, estimates };
}

function parseArgs(argv) {
  const options = { tier: undefined, air: undefined, rig: undefined, machine: undefined, factor: undefined };
  const value = (i, arg) => {
    const v = argv[i];
    if (v === undefined || v.startsWith("--")) throw new Error(`${arg} needs a value`);
    return v;
  };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--tier") options.tier = value(++i, arg);
    else if (arg === "--air") options.air = value(++i, arg);
    else if (arg === "--rig") options.rig = value(++i, arg);
    else if (arg === "--machine") options.machine = value(++i, arg);
    else if (arg === "--factor") {
      const n = Number(value(++i, arg));
      if (!Number.isFinite(n) || n <= 0) throw new Error(`--factor needs a positive number, got ${argv[i]}`);
      options.factor = n;
    } else throw new Error(`unknown option ${arg}`);
  }
  for (const name of ["tier", "air", "rig", "machine"]) if (options[name] === undefined) throw new Error(`--${name} is required`);
  if (options.tier !== "medium" && options.tier !== "high") throw new Error(`--tier needs medium or high, got ${options.tier}`);
  options.factor ??= options.tier === "high" ? PRO_FACTOR : 1;
  return options;
}

const readRows = (path) =>
  readFileSync(path, "utf8")
    .split("\n")
    .filter((l) => l.trim() !== "")
    .map((l) => JSON.parse(l));

function main() {
  const options = parseArgs(process.argv.slice(2));
  const commit = execFileSync("git", ["rev-parse", "--short", "HEAD"], { encoding: "utf8" }).trim();
  const date = new Date().toISOString().slice(0, 10);
  const { k, record, estimates } = calibrate(readRows(options.air), readRows(options.rig), options.tier, options.factor, {
    machine: options.machine,
    date,
    commit,
  });
  process.stdout.write(`${options.tier}: k ${k.k}, spread ${k.spread[0]} to ${k.spread[1]}\n`);
  for (const [view, ratio] of Object.entries(k.perView)) process.stdout.write(`  ${view}: ${ratio}\n`);
  process.stdout.write(`  missing: ${k.missing.length === 0 ? "none" : k.missing.join(", ")}\n`);
  process.stdout.write(`  budget: mean ${record.meanMs} ms, p95 ${record.p95Ms} ms (factor ${record.factor})\n`);
  if (estimates !== null) {
    process.stdout.write(
      `  Pro: ${estimates.fromAir.toFixed(1)} fps from the Air, ${estimates.fromM3Max[0]} to ${estimates.fromM3Max[1]} fps from the M3 Max: ${estimates.agree ? "agree" : "DISAGREE"}\n`,
    );
  }
  const budgets = existsSync(BUDGETS) ? JSON.parse(readFileSync(BUDGETS, "utf8")) : {};
  budgets[options.tier] = record;
  writeFileSync(BUDGETS, `${JSON.stringify(budgets, null, 2)}\n`);
  process.stdout.write(`wrote ${BUDGETS}\n`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    main();
  } catch (err) {
    process.stderr.write(`${err.message}\n`);
    process.exit(1);
  }
}
