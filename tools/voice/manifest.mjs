// The inner voice's lines as the clip generator wants them: one JSON array of
// { id, scenario, text, file }, the id and file as voiceClips.ts expects
// (`voice.<scenario>.<n>`, n from 1 in the pool's order). Prints to stdout:
//   node tools/voice/manifest.mjs > /tmp/voice-manifest.json
// The lines live in client/src/game/innerLines.ts; this reads that file's
// text so the two cannot drift.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const source = readFileSync(join(here, "../../client/src/game/innerLines.ts"), "utf8");
const body = source.slice(source.indexOf("export const INNER_LINES"));
const out = [];
for (const m of body.matchAll(/^  (\w+): \[\n((?:    "(?:[^"\\]|\\.)*",\n)+)  \],/gm)) {
  const scenario = m[1];
  const lines = [...m[2].matchAll(/^    ("(?:[^"\\]|\\.)*"),\n/gm)].map((l) => JSON.parse(l[1]));
  lines.forEach((text, i) => out.push({ id: `voice.${scenario}.${i + 1}`, scenario, text, file: `client/assets/audio/voice.${scenario}.${i + 1}.mp3` }));
}
process.stdout.write(JSON.stringify(out, null, 2) + "\n");
