#!/usr/bin/env node
// Vendors lib-visits' client script into client/public/libs/visits/, read from a tag of a
// lib-visits checkout (~/Projects/lib-visits, or VISITS_LIB), never from a CDN, so the page
// never depends on another host for a script. Committed; re-run to take a new tag:
//
//   node tools/vendor-visits.mjs v0.5.0
//
// The file is the tag's `client/dist/visits.min.js` byte for byte, after one provenance
// line (tag, licence, sha256 of the file as the tag holds it).
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const tag = process.argv[2];
if (!/^v\d+\.\d+\.\d+$/.test(tag ?? "")) {
  console.error("usage: node tools/vendor-visits.mjs v<major>.<minor>.<patch>");
  process.exit(2);
}
const lib = process.env.VISITS_LIB ?? join(homedir(), "Projects", "lib-visits");
const file = execFileSync("git", ["-C", lib, "show", `${tag}:client/dist/visits.min.js`], { encoding: "buffer" });
const sha256 = createHash("sha256").update(file).digest("hex");
const out = "client/public/libs/visits/visits.min.js";
mkdirSync("client/public/libs/visits", { recursive: true });
writeFileSync(out, Buffer.concat([Buffer.from(`// lib-visits ${tag} (GPL-3.0-only), client/dist/visits.min.js, sha256 ${sha256}\n`), file]));
console.log(`${out}: lib-visits ${tag}, ${file.length} B, sha256 ${sha256}`);
