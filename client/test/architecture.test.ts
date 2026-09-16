import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

// Resolve against this file, never process.cwd(). Vitest is launched from the
// repo root with `--root client`, so cwd is the repo root: a relative "src/sim"
// silently points at nothing and every check below passes vacuously forever.
const SRC = fileURLToPath(new URL("../src", import.meta.url));

function sourceFiles(dir: string): string[] {
  if (!existsSync(dir)) return [];
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...sourceFiles(full));
    else if (entry.name.endsWith(".ts")) out.push(full);
  }
  return out;
}

function importsOf(file: string): string[] {
  const src = readFileSync(file, "utf8");
  const specifiers: string[] = [];
  const re = /(?:^|\n)\s*import[^"']*["']([^"']+)["']|\bfrom\s+["']([^"']+)["']/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src)) !== null) {
    const spec = m[1] ?? m[2];
    if (spec) specifiers.push(spec);
  }
  return specifiers;
}

function violations(dir: string, forbidden: RegExp[]): string[] {
  const found: string[] = [];
  for (const file of sourceFiles(dir)) {
    for (const spec of importsOf(file)) {
      if (forbidden.some((rx) => rx.test(spec))) found.push(`${file} imports ${spec}`);
    }
  }
  return found;
}

/**
 * Strips `/* ... *\/` and `// ...` comments from source text so the
 * determinism guards below scan only real code, not comment prose that
 * happens to contain a banned token. A "does this LINE start with a comment
 * marker" heuristic — what both guards used before this helper — misses two
 * real shapes: a comment that opens and carries real code trailing it on the
 * same line (`/** doc *\/ const x = base ** 2;`), and code trailing a
 * comment's closing delimiter (`*\/ const y = z ** 2;`). Neither shape exists
 * in sim/ today, which is exactly why this is worth hardening rather than
 * reacting to: a guard whose coverage depends on nobody ever writing a
 * comment that way is one reformat from silently passing forever.
 *
 * Block comments are blanked rather than deleted so newlines survive and line
 * numbers/content still line up with the original file for callers that
 * split the result back into lines. Not a full parser — a string or regex
 * literal containing `//` or `/*` would be misread — but sim/ has neither.
 */
function stripComments(src: string): string {
  const noBlockComments = src.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, " "));
  return noBlockComments.replace(/\/\/[^\n]*/g, "");
}

describe("layer boundaries", () => {
  // Guards against the guard: if these directories ever stop resolving, every
  // boundary check silently degrades into a no-op.
  it("can actually see the source tree", () => {
    expect(existsSync(SRC)).toBe(true);
    expect(sourceFiles(SRC).length).toBeGreaterThan(0);
  });

  it("sim/ imports nothing but node builtins and itself", () => {
    expect(violations(join(SRC, "sim"), [/^@babylonjs/, /net\//, /game\//])).toEqual([]);
  });

  it("sim/ has no external package dependencies at all", () => {
    const external = sourceFiles(join(SRC, "sim"))
      .flatMap((f) => importsOf(f).map((s) => `${f} imports ${s}`))
      .filter((line) => {
        const spec = line.split(" imports ")[1] ?? "";
        return !spec.startsWith(".") && !spec.startsWith("node:");
      });
    expect(external).toEqual([]);
  });

  it("net/ does not import Babylon or game/", () => {
    expect(violations(join(SRC, "net"), [/^@babylonjs/, /game\//])).toEqual([]);
  });

  /**
   * `game/` is deliberately split: `colour.ts`, `sky.ts`, `quality.ts` and
   * `terrainSurface.ts` are pure arithmetic, tested under
   * `environment: "node"`, while `lighting.ts` and `renderer.ts` are the only
   * modules allowed to touch Babylon. Nothing enforced that split before this
   * test — Babylon imports fine under `NullEngine`, so a stray `@babylonjs`
   * import in `sky.ts` would build and pass every other test today.
   *
   * Per-file, not per-directory: `game/` as a whole also contains the Babylon
   * shells, so a directory-wide check here would fail on files that are
   * supposed to import Babylon.
   */
  it("the pure game/ arithmetic modules stay Babylon-free", () => {
    const BABYLON_FREE_FILES = [
      join(SRC, "game", "colour.ts"),
      join(SRC, "game", "sky.ts"),
      join(SRC, "game", "quality.ts"),
      join(SRC, "game", "terrainSurface.ts"),
      join(SRC, "game", "atmosphereParams.ts"),
      join(SRC, "game", "clipmap.ts"),
      join(SRC, "game", "roadPaint.ts"),
      join(SRC, "game", "trailPaint.ts"),
      join(SRC, "game", "water.ts"),
      join(SRC, "game", "forestField.ts"),
      join(SRC, "game", "mistField.ts"),
      join(SRC, "game", "weather.ts"),
      join(SRC, "game", "skinParams.ts"),
      join(SRC, "game", "viewBob.ts"),
      join(SRC, "game", "gradeParams.ts"),
      join(SRC, "game", "groundHexParams.ts"),
      join(SRC, "game", "trailBenchParams.ts"),
      join(SRC, "game", "postParams.ts"),
      join(SRC, "game", "windParams.ts"),
      join(SRC, "game", "motesParams.ts"),
      join(SRC, "game", "lampParams.ts"),
      join(SRC, "game", "registerHud.ts"),
      join(SRC, "game", "escalation.ts"),
    ];

    // Guards against the guard: a rename or deletion of one of these files
    // must fail loudly here rather than silently shrinking the check to
    // nothing, the same failure mode "can actually see the source tree"
    // exists to catch above.
    expect(BABYLON_FREE_FILES.length).toBeGreaterThan(0);
    for (const file of BABYLON_FREE_FILES) {
      expect(existsSync(file)).toBe(true);
    }

    const found = BABYLON_FREE_FILES.flatMap((file) =>
      importsOf(file)
        .filter((spec) => /^@babylonjs/.test(spec))
        .map((spec) => `${file} imports ${spec}`),
    );
    expect(found).toEqual([]);
  });

  /**
   * `Math.sin` and friends are implementation-defined and may differ by an ULP
   * between JS engines. A generator that uses one produces a different forest in
   * Chrome than in Firefox from the identical seed, which is unrecoverable —
   * nothing about the world crosses the wire, so there is no correction.
   *
   * Seven call sites predate the procedural work. Only one of them can actually
   * diverge two peers:
   *
   * - `movement.ts` — `wishDirection` runs on BOTH sides, for every input,
   *   including reconciliation replay. This is the real hazard, and retiring it
   *   means a fixed-point angle representation. Its own project.
   * - `ai.ts`, `view.ts` — `faceToward` is host-only (`stepEnemy` sits inside
   *   the `authoritative` guard); `aimDirection` feeds Interact's resolver
   *   (`interact.ts`, host-only, so only the host's answer is authoritative)
   *   and the headlamp's direction (`entityViews.ts`, render-only, never
   *   hashed), so an engine difference is unobservable either way.
   * - `hollow.ts` — the Hollow's facing, written inside the authoritative
   *   branch (`stepHollows`) and never replayed; render-only downstream.
   *
   * Allowlisted by call text rather than by line number, deliberately. An earlier
   * version pinned `ai.ts:58`, and adding the unstick fallback shifted that call
   * to line 69 and broke the test for no reason. Matching on content is robust to
   * moves while still failing on anything new, removed, or duplicated.
   *
   * Do not extend this list without an argument for why the new site cannot
   * diverge two peers.
   */
  it("sim/ contains exactly the known implementation-defined Math calls", () => {
    const FORBIDDEN =
      /\bMath\.(?:sin|cos|tan|asin|acos|atan|atan2|pow|exp|log|log2|log10|cbrt|hypot)\s*\(/g;
    const EXPECTED = [
      "ai.ts Math.atan2(",
      "hollow.ts Math.atan2(",
      "movement.ts Math.cos(",
      "movement.ts Math.sin(",
      "view.ts Math.cos(",
      "view.ts Math.cos(",
      "view.ts Math.sin(",
      "view.ts Math.sin(",
    ];

    const found: string[] = [];
    for (const file of sourceFiles(join(SRC, "sim"))) {
      const name = file.split("/").pop() ?? file;
      const code = stripComments(readFileSync(file, "utf8"));
      for (const match of code.matchAll(FORBIDDEN)) found.push(`${name} ${match[0].trim()}`);
    }
    expect(found.sort()).toEqual(EXPECTED);
  });

  /**
   * Banned for the same reason Math.pow is: ES Number::exponentiate is
   * implementation-approximated, so two engines could raise the same base
   * to the same power and disagree in the last bit — which in sim/ means
   * two peers generating different worlds from one seed, with nothing on
   * the wire to correct it. Repeated multiplication is exact and is what
   * `montane.ts` uses to raise uplift to a power.
   */
  it("sim/ uses no exponentiation operator", () => {
    const found: string[] = [];
    for (const file of sourceFiles(join(SRC, "sim"))) {
      const name = file.split("/").pop() ?? file;
      const code = stripComments(readFileSync(file, "utf8"));
      for (const line of code.split("\n")) {
        if (/[^*]\*\*[^*]/.test(line)) found.push(`${name}: ${line.trim()}`);
      }
    }
    expect(found).toEqual([]);
  });

  it("has no rifle left in src/: no Fire or Reload button", () => {
    const offenders: string[] = [];
    for (const file of sourceFiles(SRC)) {
      const src = stripComments(readFileSync(file, "utf8"));
      if (/Button\.(Fire|Reload)\b/.test(src)) offenders.push(`${file} uses Button.Fire/Reload`);
      if (/sim\/combat\.js/.test(src)) offenders.push(`${file} imports sim/combat.js`);
    }
    expect(offenders).toEqual([]);
    expect(existsSync(join(SRC, "sim", "combat.ts"))).toBe(false);
  });
});
