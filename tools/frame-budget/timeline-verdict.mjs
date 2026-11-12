#!/usr/bin/env node
// An intro's runs judged against its limits (`lib/verdict.mjs`): from the Play tap to the film's
// end, no page stop longer than 0.25 s and no film pause longer than 0.1 s. One row a run, what
// put a failing run outside under it, and one line for the lot. The bar is three first-visit runs
// in a row on a cool phone, all inside both limits.
//
//   node tools/frame-budget/timeline-verdict.mjs <run.json> [<run.json> ...]
//
// Exits 0 when every run passes, 1 when one fails, 2 with no run named.
import { readFileSync } from "node:fs";
import { basename } from "node:path";
import { VERDICT_HEAD, verdictOf, verdictRow } from "./lib/verdict.mjs";

const files = process.argv.slice(2).filter((a) => a.endsWith(".json"));
if (files.length === 0) {
  console.error("usage: timeline-verdict.mjs <run.json> [<run.json> ...]");
  process.exit(2);
}
console.log(VERDICT_HEAD);
let failed = 0;
for (const file of files) {
  const v = verdictOf(JSON.parse(readFileSync(file, "utf8")));
  console.log(verdictRow(basename(file, ".json"), v));
  for (const line of v.why) console.log(`    ${line}`);
  if (!v.pass) failed++;
}
const few = files.length < 3 ? " (the bar asks for three cool first-visit runs in a row)" : "";
console.log(failed === 0 ? `PASS: all ${files.length} runs are inside both limits${few}` : `FAIL: ${failed} of ${files.length} runs are outside a limit${few}`);
process.exit(failed === 0 ? 0 : 1);
