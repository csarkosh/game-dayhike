import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, existsSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { limitOffenders, scanTestSource, wallClockOffenders, type ScannedFile } from "./helpers/testCalls.js";

// Resolve against this file, never process.cwd(). Vitest is launched from the
// repo root with `--root client`, so cwd is the repo root: a relative "src/sim"
// silently points at nothing and every check below passes vacuously forever.
const SRC = fileURLToPath(new URL("../src", import.meta.url));
const TESTS = fileURLToPath(new URL(".", import.meta.url));
/**
 * The engine's modules, in the package beside this one. A module keeps its path when it moves
 * there (`game/quality.ts` here is `game/quality.ts` there), so the rules below name a file by
 * that path and are held over both trees: `at` finds where a path is, `logical` gives a file's
 * path back, and a folder is walked in both.
 */
const ENGINE = fileURLToPath(new URL("../../engine/src", import.meta.url));
const ENGINE_PACKAGE = "@csarkosh/engine/";

function at(...parts: string[]): string {
  const here = join(SRC, ...parts);
  const there = join(ENGINE, ...parts);
  return !existsSync(here) && existsSync(there) ? there : here;
}

function logical(file: string): string {
  return relative(file.startsWith(ENGINE) ? ENGINE : SRC, file);
}

/** The file a module's import names, where it is one of the game's or the engine's own: null for a package's or a file that is not a module. */
function followed(file: string, spec: string): string | null {
  if (spec.startsWith(ENGINE_PACKAGE)) return join(ENGINE, `${spec.slice(ENGINE_PACKAGE.length)}.ts`);
  if (spec.startsWith(".") && spec.endsWith(".js")) return join(file, "..", spec.replace(/\.js$/, ".ts"));
  return null;
}

function filesUnder(dir: string): string[] {
  if (!existsSync(dir)) return [];
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...filesUnder(full));
    else if (entry.name.endsWith(".ts")) out.push(full);
  }
  return out;
}

/** Every module under a folder, and under the same folder of the engine where the folder is one of the game's source. */
function sourceFiles(dir: string): string[] {
  const mirrored = dir === SRC || dir.startsWith(`${SRC}/`) ? filesUnder(join(ENGINE, relative(SRC, dir))) : [];
  return [...filesUnder(dir), ...mirrored];
}

function walkFiles(dir: string, ext: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walkFiles(full, ext));
    else if (entry.name.endsWith(ext)) out.push(full);
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

  it("keeps the scene player pure of Babylon but its stage, and out of the sim's writes", () => {
    const dir = at("game/scene");
    for (const pure of ["timeline.ts", "shots.ts", "roadPath.ts", "sceneClock.ts", "intro.ts", "scenePlayer.ts", "routeWorld.ts", "cord.ts", "cordTubeGeometry.ts", "actorPose.ts", "stageParts.ts"]) {
      expect(readFileSync(join(dir, pure), "utf8"), pure).not.toMatch(/from "@babylonjs/);
    }
    // The route's world is made in one place, with no local player, and is only ever read by the route.
    const world = readFileSync(join(dir, "routeWorld.ts"), "utf8");
    expect(world).toContain("createWorld(level, seed, false)");
    expect(world).not.toMatch(/world\.(step|apply|input)/);
    const lite = readFileSync(at("game/lite/sceneRoute.ts"), "utf8");
    expect(lite).toContain("const route = routeWorld(name);");
    expect(lite).toContain("renderer.sync(world.state, -1, 0)");
    expect(lite).not.toMatch(/world\.(step|apply|input)/);
  });

  it("keeps the engine no game's: nothing in it refers to a file outside it, by an import, a worker's entry or a path, and it names itself by no package", () => {
    const engine = filesUnder(ENGINE);
    expect(engine.length).toBeGreaterThan(100);
    const bad: string[] = [];
    for (const file of engine) {
      const text = readFileSync(file, "utf8");
      const specs = [
        ...importsOf(file),
        ...[...text.matchAll(/\bimport\(\s*["']([^"']+)["']/g)].map((m) => m[1] as string),
        ...[...text.matchAll(/new URL\(\s*["']([^"']+)["']\s*,\s*import\.meta\.url/g)].map((m) => m[1] as string),
      ];
      for (const spec of specs) {
        if (spec.startsWith(ENGINE_PACKAGE)) bad.push(`${logical(file)} names the engine as a package: ${spec}`);
        if (!spec.startsWith(".")) continue;
        const target = join(file, "..", spec.replace(/[?#].*$/, ""));
        if (!target.startsWith(`${ENGINE}/`)) bad.push(`${logical(file)} refers outside the engine: ${spec}`);
      }
    }
    expect(bad).toEqual([]);
  });

  it("registers Day Hike's world in every thread that asks for one: the page, the admin page and each worker that reaches the terrain reach the registration", () => {
    // The engine's terrain registers nothing of its own, so a thread that reaches it without the
    // game's registration (`sim/passes/index.ts`: the coast with the mountain on it, and every
    // pass) would throw at its first world, or worse, build one that is not Day Hike's.
    const loads = (file: string): string[] => {
      const text = stripComments(readFileSync(file, "utf8"));
      return [
        ...[...text.matchAll(/^\s*(?:import|export)\s+(?!type\s)(?:[^"'();]*?\s+from\s+)?["']([^"'?]+)["']/gm)].map((m) => m[1] as string),
        ...[...text.matchAll(/\bimport\(\s*["']([^"'?]+)["']\s*\)/g)].map((m) => m[1] as string),
      ];
    };
    const reach = (entry: string): Set<string> => {
      const seen = new Set<string>();
      const stack = [entry];
      while (stack.length > 0) {
        const file = stack.pop() as string;
        if (seen.has(file) || !existsSync(file)) continue;
        seen.add(file);
        for (const spec of loads(file)) {
          const next = followed(file, spec);
          if (next !== null) stack.push(next);
        }
      }
      return seen;
    };
    const entries = [at("main.ts"), at("admin", "main.ts"), ...sourceFiles(SRC).filter((file) => file.endsWith(".worker.ts"))];
    expect(entries.length).toBeGreaterThan(5);
    const terrain = at("sim", "terrain.ts");
    const registration = at("sim", "passes", "index.ts");
    const asking = entries.filter((entry) => reach(entry).has(terrain));
    expect(asking.map(logical)).toEqual(expect.arrayContaining(["main.ts", "game/world.worker.ts"]));
    expect(asking.filter((entry) => !reach(entry).has(registration)).map(logical)).toEqual([]);
  });

  it("registers Day Hike's shipped files as the page starts, and nowhere else", () => {
    // The engine's modules ask for a model, a texture or a clip by name (`game/assetUrls.ts`) and
    // answer from what a game registered; nothing is registered until Day Hike's own file runs.
    expect(importsOf(at("main.ts"))).toContain("./game/dayhikeAssets.js");
    const callers = sourceFiles(SRC)
      .filter((file) => /\bregisterAssets\(/.test(stripComments(readFileSync(file, "utf8"))))
      .map(logical)
      .sort();
    expect(callers).toEqual(["game/assetUrls.ts", "game/dayhikeAssets.ts"]);
  });

  it("sim/ imports nothing but node builtins and itself", () => {
    expect(violations(at("sim"), [/^@babylonjs/, /net\//, /game\//])).toEqual([]);
  });

  it("sim/ has no external package dependencies at all", () => {
    const external = sourceFiles(at("sim"))
      .flatMap((f) => importsOf(f).map((s) => `${f} imports ${s}`))
      .filter((line) => {
        const spec = line.split(" imports ")[1] ?? "";
        // The engine's own sim is the one package the game's sim builds on.
        return !spec.startsWith(".") && !spec.startsWith("node:") && !spec.startsWith(`${ENGINE_PACKAGE}sim/`);
      });
    expect(external).toEqual([]);
  });

  it("net/ does not import Babylon or game/", () => {
    expect(violations(at("net"), [/^@babylonjs/, /game\//])).toEqual([]);
  });

  it("keeps the hike and the page clear of Babylon: app.ts, shell.ts and main.ts import nothing of it, and reach what draws the world only through the game", () => {
    for (const top of ["app.ts", "shell.ts", "main.ts"]) {
      const file = at(top);
      // No import of it, static or dynamic, a type's included.
      expect(importsOf(file).filter((spec) => spec.startsWith("@babylonjs")), top).toEqual([]);
      const code = stripComments(readFileSync(file, "utf8"));
      expect(code, top).not.toContain("@babylonjs");
      // Nor the game's own ways back to it: the renderer with its scene, and the engine behind a handle.
      expect(code, top).not.toMatch(/\b(?:sceneRendererOf|SceneRenderer|engineOf)\b/);
      // Nor anything of the scene, the camera or the engine read off the renderer: the renderer
      // answers for them itself (`drawFrame`, `runLoop`, `cameraPosition`, `engineName`, `whenReady`).
      expect(code, top).not.toMatch(/\.(?:scene|camera|shadows|views)\b(?!\()/);
      expect(code, top).not.toMatch(/\b(?:isWebGPU|runRenderLoop|stopRenderLoop|getWaitingItemsCount|on\w+Observable)\b/);
    }
  });

  it("defines each helper the tier and engine code share once: the tier override, the browser's version, the storage accessors", () => {
    const definitions = (name: string): string[] =>
      sourceFiles(SRC).flatMap((file) =>
        [...stripComments(readFileSync(file, "utf8")).matchAll(new RegExp(`\\bfunction ${name}\\(`, "g"))].map(() => logical(file)),
      );
    expect(definitions("parseTierOverride")).toEqual(["game/tierChoice.ts"]);
    expect(definitions("browserMajor")).toEqual(["game/gpuSignals.ts"]);
    expect(definitions("pageStorage")).toEqual(["game/tierChoice.ts"]);
    expect(definitions("pageSessionStorage")).toEqual(["game/tierChoice.ts"]);
    expect(definitions("safeStorage")).toEqual([]);
    // The landing notice's pair: the engine's own reload notice is gone with
    // the reload.
    expect(definitions("leaveNotice")).toEqual(["game/tierChoice.ts"]);
    expect(definitions("takeNotice")).toEqual(["game/tierChoice.ts"]);
  });

  it("answers a WebGPU failure without reloading the page: the one reload left is the player's, on a build mismatch", () => {
    const calls = (pattern: RegExp): string[] =>
      sourceFiles(SRC).flatMap((file) =>
        [...stripComments(readFileSync(file, "utf8")).matchAll(pattern)].map((m) => `${logical(file)}: ${m[0]}`),
      );
    expect(calls(/location\.replace\(/g)).toEqual([]);
    expect(calls(/.*location\.reload\(.*/g)).toEqual(["app.ts:     onReload: () => location.reload(),"]);
  });

  it("asks for a WebGPU adapter in one place, the GPU's signals, and never through Babylon's support check", () => {
    const naming = (pattern: RegExp): string[] =>
      sourceFiles(SRC).flatMap((file) =>
        [...stripComments(readFileSync(file, "utf8")).matchAll(pattern)].map(() => logical(file)),
      );
    expect(naming(/\.requestAdapter\(/g)).toEqual(["game/gpuSignals.ts"]);
    expect(naming(/\bIsSupportedAsync\b/g)).toEqual([]);
  });

  it("starts a hike through one chain: one render token, the tier decided before the engine, one catch", () => {
    const main = stripComments(readFileSync(at("shell.ts"), "utf8"));
    expect([...main.matchAll(/\blet renderToken\b/g)].length).toBe(1);
    // The tier comes from the start's decision (`startupTier`), never from
    // the older rule, and the engine from the tier decided.
    expect(main).not.toContain("detectTier");
    expect([...main.matchAll(/\bstartSession</g)].length).toBe(1);
    // A hike's canvas carries no engine: its renderer makes its own from it, at the start and for every switch after.
    expect(main).toContain("      engine: () => sessionCanvas(),");
    expect(main).toContain("launch(onCanvas, route.token, decided, () => sessionCanvasNow(), opening, takeSampled);");
    // The scene route is drawn by the same renderer, on a canvas of the same kind: the one other caller.
    expect(main).toContain("      void sessionCanvas().then(");
    expect(main).toContain("page.scene({ canvas, container, tier }, parseSceneSearch(location.search), route.name);");
    expect([...main.matchAll(/\bsessionCanvas\(/g)].length).toBe(3);
    // A switch or a rebuild takes its canvas at once (`sessionCanvasNow`): the start's promise is made of the same.
    expect([...main.matchAll(/\bsessionCanvasNow\(/g)].length).toBe(3);
    // Nothing of the start hangs off a promise outside the chain's catch.
    expect(main).not.toMatch(/makeWebGpu\([^)]*\)\.then\(/);
  });

  it("wires the failure answer to the engine that failed and the renderer that runs, and the game to the start's recorder", () => {
    // What `engineFailure.test.ts` cannot see: the page's side of it.
    const app = stripComments(readFileSync(at("app.ts"), "utf8"));
    // The watcher reports the engine it watches, captured when it is put on.
    expect(app).toContain("      const engine = r.engine;\n      stopWatching = detector(engine, (reason) => void answerFailure(engine, reason));");
    // The answer compares it with the engine the running renderer draws with.
    expect(app).toContain("    running: () => renderer.engine,");
    // The game records every failure of its engine through the page's one recorder, handed to its start as it
    // is: the start is given no engine that could fail apart from the hike's renderer, so there is no start's
    // fault to tell from the hike's, and no second start on another engine.
    const main = stripComments(readFileSync(at("shell.ts"), "utf8"));
    expect(main).toContain("    const handle = startGame(onCanvas.canvas, worldToken, {");
    expect([...main.matchAll(/^ {6}engineFailed,$/gm)].length).toBe(1);
    expect(main).not.toMatch(/\b(?:startOnEngine|starting)\b/);
    // The recorder sends the failure's row and no more: it remembers nothing for a later hike and pins nothing
    // in the address.
    expect(main).toContain('  function engineFailed(reason: "pipeline" | "lost"): void {\n    telemetry.event("engine_failed", { reason });\n  }');
    expect(main).not.toMatch(/\b(?:recordEngineFailure|parseEngineOverride|withEngine|engineEnv|replaceState)\b/);
    // The answer's own module holds the answer and no more: nothing remembers a failure against an engine or
    // starts a hike again on another.
    expect(stripComments(readFileSync(at("game/engineFailure.ts"), "utf8"))).not.toMatch(/\b(?:recordEngineFailure|recordStartFailure|startOnEngine|failureSwap|writeFallback)\b/);
    expect(app).not.toMatch(/\b(?:recordEngineFailure|recordStartFailure|startOnEngine)\b/);
  });

  it("decides the tier at launch only: with the governor off the hike makes none, feeds none, times no idle frames and acts on no drop", () => {
    // What `governor.test.ts` cannot see: the page's side of the switch.
    const app = stripComments(readFileSync(at("app.ts"), "utf8"));
    const body = (from: string): string => app.slice(app.indexOf(from), app.indexOf("\n  }\n", app.indexOf(from)));
    // The one governor a hike has comes from `governSession`, null while
    // `GOVERNOR_ENABLED` is off; none is made any other way.
    expect([...app.matchAll(/\bgovernSession\(/g)].length).toBe(1);
    expect(app).toContain("  const governor = governSession(performance.now(), () => void lowerTier());");
    expect(app).not.toMatch(/\bcreateGovernor\(/);
    // Without one, a frame feeds nothing, no compile is marked for it, and no
    // drop is decided, covered, timed, recorded or switched to.
    expect(body("  function feedGovernor(")).toMatch(/^ {2}function feedGovernor\(dt: number\): void \{\n {4}if \(governor === null\) return;\n/);
    expect(body("  function watchCompiles(")).toMatch(/^ {2}function watchCompiles\(r: R\): void \{\n {4}unwatchCompiles\?\.\(\);\s+if \(governor === null\) return;\n/);
    expect(body("  async function lowerTier(")).toMatch(/^ {2}async function lowerTier\(\): Promise<void> \{\n {4}if \(governor === null\) return;\n/);
    // The idle frames are timed, and a drop recorded, only inside `lowerTier`.
    expect([...app.matchAll(/\btimeIdleCadence\(/g)].length).toBe(1);
    expect(body("  async function lowerTier(")).toContain("timeIdleCadence(");
    expect([...app.matchAll(/\bonGovernorDrop\(/g)].length).toBe(2);
    expect(body("  async function lowerTier(")).toContain("options.onGovernorDrop(running)");
    // Every other use of it is a no-op without one.
    expect(app).not.toMatch(/\bgovernor\.(restart|stop)\(/);
  });

  it("shows one line after a failure rebuild: the swap itself shows none, a switch none, the answer its own", () => {
    const app = stripComments(readFileSync(at("app.ts"), "utf8"));
    const body = (from: string, to: string): string => app.slice(app.indexOf(from), app.indexOf(to, app.indexOf(from)));
    // `switchNow` is the swap both paths run, and `switchTo` a switch (Apply, the governor): neither shows a line.
    expect(body("  async function switchNow(", "\n  }\n")).not.toContain("hud.flash");
    expect(body("  function switchTo(", "\n  }\n")).not.toContain("hud.flash");
    // A failure's rebuild leaves the line to the answer (`answerFailures`), which shows it once.
    expect(app).toContain("    rebuild: (readyMaxMs) => switchNow(tier, tierSource, null, readyMaxMs).then(() => undefined),");
    expect(app).toContain("    flash: (line) => hud.flash(line, FALLBACK_NOTICE_MS),");
  });

  it("measures every step of the tier check on the hike's own renderer: the page makes no engine, for a step or for anything", () => {
    const main = stripComments(readFileSync(at("shell.ts"), "utf8"));
    // The page's deps are the probe's on the hike's own renderer, which makes each step's renderer, canvas and engine
    // and lets them go with the step. The page makes them itself, on the game's level and renderer and the empty state
    // the game hands it (`page.probeState`); the game's page names no probe.
    expect(main).toContain("    const probe = liteProbeDeps(container, { level: page.game.level, renderer: page.game.renderer, state: page.probeState });");
    expect([...main.matchAll(/\bliteProbeDeps\(/g)].length).toBe(1);
    const game = stripComments(readFileSync(at("hikePageGame.ts"), "utf8"));
    expect([...game.matchAll(/\bliteProbeDeps\(/g)].length).toBe(0);
    expect(game).toContain("  probeState: (level, seed) => createWorld(level, seed, false).state,");
    expect(importsOf(at("shell.ts"))).toContain("./game/lite/probeScene.js");
    expect(importsOf(at("hikePageGame.ts"))).not.toContain("@csarkosh/engine/game/lite/probeScene");
    expect(importsOf(at("hikePageGame.ts"))).not.toContain("./game/probeScene.js");
    // No step is handed an engine.
    expect(main).not.toMatch(/\b(?:probeDeps|probeStepEngine|probeStepCanSettle|measureOnRuleEngine)\b/);
    // Nor does the page make an engine any other way: no rule is asked which or handed anything to decide by, and
    // the only canvas it makes is a hike's (`sessionCanvas`).
    expect(main).not.toMatch(/\b(?:makeWebGpu|engineForTier|resolveWebGpu|chooseEngine|startWebGpu|loadTranslators|engineInput)\b/);
    expect(main).not.toMatch(/\bengineFor\(/);
    expect(main).not.toContain("gpuEngine");
    expect([...main.matchAll(/document\.createElement\("canvas"\)/g)].length).toBe(1);
    // A verdict is kept for, and looked up under, the one engine a hike is drawn with, at the start and in Settings;
    // and the page says for itself whether a step can be measured: not where the browser offers no WebGPU, or no
    // adapter, which the GPU's signals say of both (`AdapterStatus`).
    expect(main).toContain('  function verdictEngineNow(): VerdictEngine {\n    return "webgpu";\n  }');
    expect([...main.matchAll(/\bverdictEngineNow\(\)/g)].length).toBe(5);
    expect(main).toContain('    return liteProbeSteps(read.adapterStatus !== "none");');
    expect(main).toContain("engine: verdictEngineNow(), steps: probeSteps(read) }, {");
    expect(main).toContain("engine: verdictEngineNow(), stepSettles: probeSteps(signals).settle });");
  });

  it("starts no engine, so the page has no failed start to record: a step of the tier check that fails is the step's own to end", () => {
    const main = stripComments(readFileSync(at("shell.ts"), "utf8"));
    // No page has a start of its own that could fail and be remembered: the hike's renderer makes its engine.
    expect(main).not.toMatch(/\b(?:rememberFailure|recordStartFailure)\b/);
    expect(main).not.toContain("webgpu_start_failed");
    // A step that fails ends with no reading (`lite/probeScene.ts`): nothing of it is recorded against the engine.
    const step = stripComments(readFileSync(at("game/lite/probeScene.ts"), "utf8"));
    expect(step).not.toMatch(/\b(?:recordFailure|recordStartFailure|recordEngineFailure|writeFallback)\b/);
    expect(main).not.toMatch(/\b(recordFailure|writeFallback)\(/);
  });

  it("loads no Babylon.js with the page: nothing the page's entry (main.ts), the engine's shell (shell.ts) and the game's page (hikePageGame.ts) import for themselves reaches it, by an import or a dynamic one", () => {
    // The page's own imports, each followed through everything it loads, static or dynamic, name no module of
    // Babylon.js (the hike, which is the engine's page that runs a session, `app.ts`, and the game it is handed,
    // `hikeGame.ts`, imported by the game's page, `hikePageGame.ts`, has its own test below and is left out here). Babylon Lite, which the hike
    // is drawn with, is another library.
    const code = (file: string): string => stripComments(readFileSync(file, "utf8"));
    const loads = (file: string): string[] => [
      ...[...code(file).matchAll(/^\s*(?:import|export)\s+(?!type\s)(?:[^"'();]*?\s+from\s+)?["']([^"']+)["']/gm)].map((m) => m[1] as string),
      ...[...code(file).matchAll(/\bimport\(\s*["']([^"']+)["']\s*\)/g)].map((m) => m[1] as string),
    ];
    // The entry (`main.ts`) loads Day Hike's registrations, then the shell and the game's page by name: each of those
    // two stands for its own loads. The shell (`shell.ts`) is the engine's and is handed the game's page.
    const main = at("main.ts");
    const entry = loads(main);
    const shellSpec = `${ENGINE_PACKAGE}shell`;
    expect(entry, shellSpec).toContain(shellSpec);
    expect(entry, "./hikePageGame.js").toContain("./hikePageGame.js");
    const shellFile = at("shell.ts");
    const ofShell = loads(shellFile);
    // The shell names the game only as `hikePageGame.ts`, which names the hike: its own loads stand in for that one.
    const gamePage = at("hikePageGame.ts");
    const ofGame = loads(gamePage);
    // The shell stands in the engine, beside the page that runs a session: it names it as a neighbour.
    const ofHike = ["./app.js", "./hikeGame.js"];
    expect(ofShell, ofHike[0]).toContain(ofHike[0] as string);
    expect(ofGame, ofHike[1]).toContain(ofHike[1] as string);
    for (const specs of [entry, ofShell, ofGame]) {
      expect(specs.filter((spec) => !spec.startsWith(".") && !spec.startsWith(ENGINE_PACKAGE))).toEqual([]);
    }
    const seen = new Map<string, string | null>();
    const stack: [string, string | null][] = [
      ...entry.filter((spec) => spec !== shellSpec && spec !== "./hikePageGame.js").map((spec): [string, null] => [followed(main, spec) as string, null]),
      ...ofShell.filter((spec) => spec !== ofHike[0]).map((spec): [string, null] => [followed(shellFile, spec) as string, null]),
      ...ofGame.filter((spec) => spec !== ofHike[1]).map((spec): [string, null] => [followed(gamePage, spec) as string, null]),
    ];
    const bad: string[] = [];
    while (stack.length > 0) {
      const [file, from] = stack.pop() as [string, string | null];
      if (seen.has(file)) continue;
      expect(existsSync(file), file).toBe(true);
      seen.set(file, from);
      for (const spec of loads(file)) {
        if (spec.startsWith("@babylonjs/") && spec !== "@babylonjs/lite") {
          const chain: string[] = [];
          for (let at: string | null = file; at !== null; at = seen.get(at) ?? null) chain.unshift(logical(at));
          bad.push(`${chain.join(" > ")} imports ${spec}`);
        }
        const path = spec.replace(/\?.*$/, "");
        const next = followed(file, path);
        if (next !== null) stack.push([next, file]);
      }
    }
    // The renderer on Babylon Lite and everything it is made with are among them: this is the page's whole graph but the hike's.
    expect(seen.size).toBeGreaterThan(300);
    expect([...seen.keys()].map((file) => logical(file))).toContain("game/lite/renderer.ts");
    expect(bad).toEqual([]);
    // The page keeps no engine between hikes, reads no library's version and hears no library's log.
    expect(code(shellFile)).not.toMatch(/\b(?:releaseEngine|adoptEngine|dropEngine|keepEngine|engineVersion|hearEngineLog|tellEngineLog)\b/);
    // The line of a renderer built again is the failure answer's own (`engineFailure.ts`), which holds no
    // rule and no record: the page's recorder gives none and the page reads nothing of that module.
    expect(code(shellFile)).not.toMatch(/engineFailure\.js|NOTICE_RESTARTED/);
    // How long the line shows is the answer's too, and the measurement mode's flag is the measurement's
    // (`gpuTimeReport.ts`).
    // The page that runs a session is the engine's now and names its neighbours by path: each import is followed to its file.
    const hike = importsOf(at("app.ts")).map((spec) => followed(at("app.ts"), spec)).filter((to): to is string => to !== null).map(logical);
    expect(hike).toContain("game/engineFailure.ts");
    expect(hike).toContain("game/gpuTimeReport.ts");
    expect(importsOf(at("game/engineFailure.ts"))).toEqual(["./rendererSwap.js"]);
  });

  it("decides once whether the browser can play, with no engine and no request of its own, and starts nothing of a hike where it cannot", () => {
    // The check and the page for those turned away are made with no engine, whatever they import.
    const loaded = (file: string): string[] =>
      [...readFileSync(file, "utf8").matchAll(/^\s*(?:import|export)\s+(?!type\s)(?:[^"'();]*?\s+from\s+)?["']([^"']+)["']/gm)].map((m) => m[1] as string);
    const ENGINE_FREE = ["loadCheck.ts", "turnedAway.ts", "turnedAwayModel.ts", "turnedAwayWords.ts", "gpuSignals.ts"];
    const seen = new Set<string>();
    const stack = ENGINE_FREE.map((name) => at("game", name));
    for (const file of stack) expect(existsSync(file), file).toBe(true);
    const bad: string[] = [];
    while (stack.length > 0) {
      const file = stack.pop() as string;
      if (seen.has(file)) continue;
      seen.add(file);
      for (const spec of loaded(file)) {
        if (spec.startsWith("@babylonjs")) bad.push(`${logical(file)} imports ${spec}`);
        {
          const next = followed(file, spec);
          if (next !== null) stack.push(next);
        }
      }
    }
    expect(seen.size).toBeGreaterThan(ENGINE_FREE.length);
    expect(bad).toEqual([]);
    // The verdict reads the answer to the page's one adapter request (the test above holds that there is one):
    // the check itself asks the browser nothing.
    const check = stripComments(readFileSync(at("game/loadCheck.ts"), "utf8"));
    expect(check).not.toMatch(/\bnavigator\b|requestAdapter|requestDevice|document\b|window\b/);
    expect(loaded(at("game/loadCheck.ts"))).toEqual([]);

    const main = stripComments(readFileSync(at("shell.ts"), "utf8"));
    // One verdict a page: known at once where the browser offers no WebGPU, else settled from the signals, or
    // from the same request's later answer where the signals went on without it; set in that one place after.
    expect(main).toContain("const webgpuOffered = offersWebGpu(navigator as NavigatorLike);\n  let verdict: LoadVerdict | null = loadVerdict(webgpuOffered, null);");
    expect(main).toContain("    const known = loadVerdict(webgpuOffered, read);\n    if (known !== null) settleVerdict(known);");
    expect(main).toContain("    else void signalsRead.adapter.then((later) => settleVerdict(adapterVerdict(later)));");
    expect([...main.matchAll(/\bverdict = /g)].length).toBe(1);
    expect(main).toContain("  function settleVerdict(next: LoadVerdict): void {\n    verdict = next;\n    if (next.play) return;");
    // Every route is refused in one place, before anything of it is looked at: the page for those turned away.
    expect(main).toContain(
      "  function render(container: HTMLDivElement): void {\n    const route = parseRoute(location.pathname);\n    if (verdict !== null && !verdict.play) {\n      turnAway(container, route, verdict);\n      return;\n    }",
    );
    // The page itself is the engine's (`turnedAway.ts`), drawn in one place in the shell and nowhere in Day Hike's own of the page.
    expect([...main.matchAll(/\brenderTurnedAway\(/g)].length).toBe(1);
    expect([...readFileSync(at("hikePage.ts"), "utf8").matchAll(/\brenderTurnedAway\(/g)].length).toBe(0);
    // A hike or a staged scene asked for before the signals are in waits for them, and that wait stands before
    // everything either starts with: the world's worker, the tier check, a follower's film, a canvas.
    const body = main.slice(main.indexOf("function render(container: HTMLDivElement): void {"), main.indexOf("\n  function launch("));
    const wait = body.indexOf("    if (!isLandingRoute(route) && signals === null) {");
    expect(wait).toBeGreaterThan(0);
    for (const start of ["void sessionCanvas().then(", "page.scene(", "side.openingFor(", "startWorldPrep(", "liteProbeDeps(container, ", "void startSession<EngineOnCanvas>("]) {
      expect(body.indexOf(start), start).toBeGreaterThan(wait);
      expect(body.lastIndexOf(start), start).toBe(body.indexOf(start));
    }
    // No canvas is made under a verdict of "cannot", for a route or for a hike that was running when it came.
    expect(main).toContain("    if (verdict !== null && !verdict.play) throw new Error(");
    // An invitation is joined once the signals are in, and not by a visitor turned away; one who is leaves a
    // lobby joined meanwhile, by the lobby's own leaving.
    expect([...main.matchAll(/\benterLobby\(route\.lobbyId\)/g)].length).toBe(1);
    expect(main).toContain("      void signalsReady.then(() => {\n        if (verdict === null || verdict.play) void enterLobby(route.lobbyId);\n      });");
    expect(main).toContain("    if (joining) abandonAttempt();\n    if (lobby !== null) {\n      lobby.leave();\n      detach();\n    }");
    // The visitor's one row, said in one place.
    expect([...main.matchAll(/"turned_away"/g)].length).toBe(1);
    expect(main).toContain('      telemetry.event("turned_away", next.short === null ? { reason: next.reason } : { reason: next.reason, short: next.short });');
  });

  it("bounds the cover over every switch by what its caller passes: no path picks its own bound", () => {
    // The Settings Apply passes `APPLY_SWAP_READY_MAX_MS` (`pauseMenu.ts`),
    // the governor and a failure's rebuild `GOVERNOR_SWAP_READY_MAX_MS`
    // (`governor.ts`, `engineFailure.ts`); a fallback's rung and a switch
    // that crosses engines are inside `switchNow` and wait on its bound.
    const app = stripComments(readFileSync(at("app.ts"), "utf8"));
    expect([...app.matchAll(/(?<!function )\bswitch(?:To|Now)\([^()]*\)/g)].map((m) => m[0])).toEqual([
      "switchTo(target, source, choice, readyMaxMs)",
      "switchNow(target, source, save, readyMaxMs)",
      "switchNow(tier, tierSource, null, readyMaxMs)",
      'switchTo(next, "auto", null, readyMaxMs)',
    ]);
    // The canvas a switch builds on is the page's, made at once and waited
    // for by nothing, so the scene waits on the bound whole.
    expect(app).toContain("      const next = options.engineFor(target);\n");
    expect(app).not.toMatch(/await options\.engineFor|engineWithinBound|leftMs/);
    expect([...app.matchAll(/\bwhenReady\([^;]*;/g)].map((m) => m[0])).toEqual(["whenReady(readyMaxMs);"]);
    expect(app).not.toMatch(/SWAP_READY_MAX_MS/);
  });

  it("loads no module of Babylon.js with the page, the hike under it included, followed into whatever a library's module loads in turn", () => {
    const NODE_MODULES = fileURLToPath(new URL("../../node_modules", import.meta.url));
    const runtimeImports = (file: string): string[] =>
      [...readFileSync(file, "utf8").matchAll(/^\s*(?:import|export)\s+(?!type\s)(?:[^"'();]*?\s+from\s+)?["']([^"'?]+)["']/gm)].map((m) => m[1] as string);
    const resolveIn = (from: string, spec: string): string | null => {
      // Babylon Lite is a library of its own, imported whole by its package's name: it holds no
      // module of Babylon.js and registers nothing on Babylon.js's classes.
      if (spec === "@babylonjs/lite") return null;
      if (spec.startsWith("@babylonjs/")) return join(NODE_MODULES, spec);
      if (spec.startsWith(ENGINE_PACKAGE)) return followed(from, spec);
      if (!spec.startsWith(".")) return null;
      const path = join(from, "..", spec);
      return from.includes("node_modules") ? path : path.replace(/\.js$/, ".ts");
    };
    const graph = (entry: string): Set<string> => {
      const seen = new Set<string>();
      const stack = [entry];
      while (stack.length > 0) {
        const file = stack.pop() as string;
        if (seen.has(file) || !existsSync(file)) continue;
        seen.add(file);
        for (const spec of runtimeImports(file)) {
          const next = resolveIn(file, spec);
          if (next !== null) stack.push(next);
        }
      }
      return seen;
    };
    // The page loads no module of Babylon.js, with the hike under it or without.
    expect([...graph(at("main.ts"))].filter((f) => f.includes("@babylonjs"))).toEqual([]);
  });

  it("keeps the quality modules out of sim/ and net/", () => {
    const quality = /game\/(quality|gpuSignals|gpuClass|tierChoice|frameProbe|governor|rendererSwap|settings)(\.js)?$/;
    expect(violations(at("sim"), [quality])).toEqual([]);
    expect(violations(at("net"), [quality])).toEqual([]);
  });

  /**
   * `game/` is deliberately split: `colour.ts`, `sky.ts`, `quality.ts`,
   * `terrainSurface.ts` and the rest of this list are pure arithmetic, tested
   * under `environment: "node"`, while the modules under `game/lite/` are the
   * ones that draw, with Babylon Lite. A stray import of the engine in
   * `sky.ts` would build, and would pass every other test.
   *
   * Per-file, not per-directory: `game/` as a whole also contains the
   * modules that draw, so a directory-wide check here would fail on files
   * that are supposed to import the engine.
   */
  it("the pure game/ arithmetic modules stay Babylon-free", () => {
    const BABYLON_FREE_FILES = [
      at("game", "colour.ts"),
      at("game", "sky.ts"),
      at("game", "quality.ts"),
      at("game", "terrainSurface.ts"),
      at("game", "waterGround.ts"),
      at("game", "panoramaTurn.ts"),
      at("game", "mirrorGround.ts"),
      at("game", "mirrorPass.ts"),
      at("game", "firstBuilds.ts"),
      at("game", "filmHead.ts"),
      at("game", "downloadTurns.ts"),
      at("game", "framePace.ts"),
      at("game", "atmosphereParams.ts"),
      at("game", "cloudParams.ts"),
      at("game", "wayLightGeometry.ts"),
      at("game", "wayLight.ts"),
      at("game", "wayMistFieldGeometry.ts"),
      at("game", "wayMistField.ts"),
      at("game", "crowdField.ts"),
      at("game", "crowdEyes.ts"),
      at("game", "crowdCards.ts"),
      at("game", "clipmap.ts"),
      at("game", "facePatches.ts"),
      at("game", "roadPaint.ts"),
      at("game", "trailPaint.ts"),
      at("game", "water.ts"),
      at("game", "forestField.ts"),
      at("game", "mistField.ts"),
      at("game", "mistBanks.ts"),
      at("game", "weather.ts"),
      at("game", "skinParams.ts"),
      at("game", "viewBob.ts"),
      at("game", "gradeParams.ts"),
      at("game", "groundHexParams.ts"),
      at("game", "trailBenchParams.ts"),
      at("game", "postParams.ts"),
      at("game", "windParams.ts"),
      at("game", "motesParams.ts"),
      at("game", "moteField.ts"),
      at("game", "rainField.ts"),
      at("game", "splashField.ts"),
      at("game", "rainCover.ts"),
      at("game", "lensCanopy.ts"),
      at("game", "lampParams.ts"),
      at("game", "forestLookParams.ts"),
      at("game", "barkParams.ts"),
      at("game", "coverAlbedoParams.ts"),
      at("game", "mossParams.ts"),
      at("game", "passages.ts"),
      at("game", "escalation.ts"),
      at("game", "stareLens.ts"),
      at("game", "woodsVoice.ts"),
      at("game", "woodsSounds.ts"),
      at("game", "oddSounds.ts"),
      at("game", "stareAudio.ts"),
      at("game", "bladeClump.ts"),
      at("game", "bladeField.ts"),
      at("game", "rockRelief.ts"),
      at("game", "gpuSignals.ts"),
      at("game", "gpuClass.ts"),
      at("game", "tierChoice.ts"),
      at("game", "frameProbe.ts"),
      at("game", "probePage.ts"),
      at("game", "probeScreen.ts"),
      at("game", "gpuTimeReport.ts"),
      at("game", "settings.ts"),
      at("game", "governor.ts"),
      at("game", "rainParams.ts"),
      at("game", "lensParams.ts"),
      at("game", "shadeVeilParams.ts"),
      at("game", "oceanLoopBake.ts"),
      at("game", "oceanLoop.worker.ts"),
      at("game", "oceanWindSea.ts"),
      at("game", "oceanWaves.ts"),
      at("game", "oceanTables.ts"),
      at("game", "oceanSwell.ts"),
      at("game", "oceanPhysics.ts"),
      at("game", "oceanSpectrum.ts"),
      at("game", "oceanFft.ts"),
      at("game", "skyModel.ts"),
      at("game", "skyTable.ts"),
      at("game", "sky.worker.ts"),
      at("game", "skyWorker.ts"),
      at("game", "world.worker.ts"),
      at("game", "worldPrep.ts"),
      at("game", "preparedScene.ts"),
      at("game", "lakeSurfaceGrid.ts"),
      at("game", "waterPlantField.ts"),
      at("game", "waterBump.ts"),
      at("game", "featureTable.ts"),
      at("game", "extrasLater.ts"),
      at("game", "impostorField.ts"),
      at("game", "impostorField.worker.ts"),
      at("game", "impostorFieldWorker.ts"),
      at("game", "skyState.ts"),
      at("game", "skyDomeParams.ts"),
      at("game", "skyProbeParams.ts"),
      at("game", "halfFloat.ts"),
      at("game", "waterLifeParams.ts"),
      at("game", "waterLifeField.ts"),
      at("game", "midgeMotion.ts"),
      at("game", "dragonflyBehaviour.ts"),
      at("game", "frogChorus.ts"),
      at("game", "lakeCalm.ts"),
      at("game", "mirrorView.ts"),
      at("game", "lakeSkyline.ts"),
      at("game", "lakeRipples.ts"),
      at("game", "swashRunUp.ts"),
      at("game", "swashTable.ts"),
      at("game", "oceanBreaker.ts"),
      at("game", "surfSound.ts"),
      at("game", "shoreAtlas.ts"),
      at("game", "lakeChoice.ts"),
      at("game", "carAudio.ts"),
      at("game", "terrainTables.ts"),
      at("game", "terrainUniforms.ts"),
      at("game", "groundLayers.ts"),
      at("game", "wetSurface.ts"),
      at("game", "terrainVertices.ts"),
      at("game", "sceneLights.ts"),
      at("game", "gameLens.ts"),
      at("game", "skyWait.ts"),
      at("game", "listenerPose.ts"),
      at("game", "characterAssets.ts"),
      at("game", "hollowLook.ts"),
      at("game", "entityPoses.ts"),
      at("game", "droppedCap.ts"),
      at("game", "creatureAssets.ts"),
      at("game", "wingParams.ts"),
      at("game", "wildlifeScene.ts"),
      at("game", "skinInstances.ts"),
      at("game", "wildlifeInputs.ts"),
      at("game", "waterSurface.ts"),
      at("game", "bedFollow.ts"),
      at("game", "lakeCalmFrame.ts"),
      at("game", "lakeSeen.ts"),
      at("game", "waterPlantShapes.ts"),
      at("game", "waterLifeScene.ts"),
      at("game", "waterLifeInputs.ts"),
      at("game", "midgeLook.ts"),
      at("game", "dragonflyShapes.ts"),
      at("game", "oceanFrame.ts"),
      at("game", "seaEdge.ts"),
      at("game", "oceanFftPasses.ts"),
      at("game", "windSeaField.ts"),
      at("game", "lipStrip.ts"),
      at("game", "sprayField.ts"),
      at("game", "seaLattice.ts"),
      at("game", "seaUniforms.ts"),
      at("game", "postFrame.ts"),
      at("game", "materialGrade.ts"),
      at("game", "shadeMaskParams.ts"),
      at("game", "signParts.ts"),
      at("game", "sceneryParts.ts"),
      at("game", "boardDraw.ts"),
      at("game", "scenePlay.ts"),
      at("game", "cutscene.ts"),
      at("game", "ending.ts"),
      at("game", "endScene.ts"),
      at("game", "carParts.ts"),
      at("game", "loadReport.ts"),
      at("game", "rendererTypes.ts"),
      at("game", "hikeRenderer.ts"),
      at("game", "scene", "routeWorld.ts"),
      at("game", "scene", "scenePlayer.ts"),
      at("game", "scene", "actorPose.ts"),
      at("game", "scene", "stageParts.ts"),
      at("game", "scene", "cordTubeGeometry.ts"),
      at("game", "scene", "cord.ts"),
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
   * What the ground, the air over it and the mist banks that stand in it, the sky's dome and the scene's light
   * are drawn with, and the lens they are seen through, is computed by modules that load no
   * Babylon at all: not by an import of
   * their own (the list above) and not through anything they import, so each
   * runs, and is tested, with no engine made. A type's import is erased when
   * the module is built and loads nothing, so only the imports that load a
   * module are followed.
   */
  it("what the terrain, the air and the light are drawn with, and the lens, is computed without loading Babylon, whatever it imports", () => {
    const ENGINE_FREE = [
      "terrainTables.ts", "terrainUniforms.ts", "groundLayers.ts", "wetSurface.ts", "terrainVertices.ts",
      "atmosphereParams.ts", "cloudParams.ts", "skyState.ts", "skyDomeParams.ts", "skyProbeParams.ts", "weather.ts", "sceneLights.ts", "lampParams.ts", "gameLens.ts",
      "mistField.ts", "mistBanks.ts", "motesParams.ts", "moteField.ts",
      "rainParams.ts", "rainField.ts", "splashField.ts", "rainCover.ts", "lensCanopy.ts",
    ];
    const loaded = (file: string): string[] =>
      [...readFileSync(file, "utf8").matchAll(/^\s*(?:import|export)\s+(?!type\s)(?:[^"'();]*?\s+from\s+)?["']([^"']+)["']/gm)].map((m) => m[1] as string);
    const seen = new Set<string>();
    const stack = ENGINE_FREE.map((name) => at("game", name));
    for (const file of stack) expect(existsSync(file), file).toBe(true);
    const bad: string[] = [];
    while (stack.length > 0) {
      const file = stack.pop() as string;
      if (seen.has(file)) continue;
      seen.add(file);
      for (const spec of loaded(file)) {
        if (spec.startsWith("@babylonjs")) bad.push(`${logical(file)} imports ${spec}`);
        {
          const next = followed(file, spec);
          if (next !== null) stack.push(next);
        }
      }
    }
    expect(seen.size).toBeGreaterThan(ENGINE_FREE.length);
    expect(bad).toEqual([]);
  });

  /**
   * What the forest is drawn with is computed by modules that load no
   * Babylon either: each plugin's uniforms as a record by name, the instance
   * lists and their per-instance attributes as typed arrays, the fade bands,
   * the bark's dressing and the trees' share of the sky, the pose math the
   * lists are composed with, how a far tree's bake is posed and framed, and
   * what is read of a model's file and baked into its vertices. The meshes that draw them
   * (`lite/forestMeshes.ts`) and their plugins take their values from these.
   */
  it("what the forest is drawn with is computed without loading Babylon, whatever it imports", () => {
    const ENGINE_FREE = [
      "forestField.ts", "forestInstances.ts", "instancePose.ts", "groundTilt.ts", "logSeat.ts", "nurseLog.ts",
      "foliageUniforms.ts", "distanceFade.ts", "groundConform.ts", "deadwoodParams.ts", "mossParams.ts", "barkParams.ts",
      "forestLookParams.ts", "coverAlbedoParams.ts", "windParams.ts", "impostorField.ts", "impostorBake.ts", "glbParts.ts", "modelBake.ts",
    ];
    const loaded = (file: string): string[] =>
      [...readFileSync(file, "utf8").matchAll(/^\s*(?:import|export)\s+(?!type\s)(?:[^"'();]*?\s+from\s+)?["']([^"']+)["']/gm)].map((m) => m[1] as string);
    const seen = new Set<string>();
    const stack = ENGINE_FREE.map((name) => at("game", name));
    for (const file of stack) expect(existsSync(file), file).toBe(true);
    const bad: string[] = [];
    while (stack.length > 0) {
      const file = stack.pop() as string;
      if (seen.has(file)) continue;
      seen.add(file);
      for (const spec of loaded(file)) {
        if (spec.startsWith("@babylonjs")) bad.push(`${logical(file)} imports ${spec}`);
        {
          const next = followed(file, spec);
          if (next !== null) stack.push(next);
        }
      }
    }
    expect(seen.size).toBeGreaterThan(ENGINE_FREE.length);
    expect(bad).toEqual([]);
  });

  /**
   * What the ground cover, the cliffs and the chunk props are drawn with is computed by
   * modules that load no Babylon either: which model and LOD a clutter class draws, an instance's
   * matrix and ground tint, the lists a bucket is drawn from and their cut to
   * the view, the fields that place the cover, the geometry of the clumps
   * built in code, and a prop's box and colour. The meshes that draw them
   * take their values from these.
   */
  it("what the ground cover, the cliffs and the chunk props are drawn with is computed without loading Babylon, whatever it imports", () => {
    const ENGINE_FREE = [
      "clutterInstances.ts", "clutterLists.ts", "instanceLists.ts", "bladeInstances.ts", "duffInstances.ts", "cliffInstances.ts", "clutterField.ts", "bladeField.ts", "bladeClump.ts", "duffField.ts", "duffClump.ts", "cliffField.ts",
      "shrubClump.ts", "wetPlantClump.ts", "highPlantClump.ts", "rockRelief.ts", "grassCull.ts", "keptValues.ts", "propBoxes.ts",
    ];
    const loaded = (file: string): string[] =>
      [...readFileSync(file, "utf8").matchAll(/^\s*(?:import|export)\s+(?!type\s)(?:[^"'();]*?\s+from\s+)?["']([^"']+)["']/gm)].map((m) => m[1] as string);
    const seen = new Set<string>();
    const stack = ENGINE_FREE.map((name) => at("game", name));
    for (const file of stack) expect(existsSync(file), file).toBe(true);
    const bad: string[] = [];
    while (stack.length > 0) {
      const file = stack.pop() as string;
      if (seen.has(file)) continue;
      seen.add(file);
      for (const spec of loaded(file)) {
        if (spec.startsWith("@babylonjs")) bad.push(`${logical(file)} imports ${spec}`);
        {
          const next = followed(file, spec);
          if (next !== null) stack.push(next);
        }
      }
    }
    expect(seen.size).toBeGreaterThan(ENGINE_FREE.length);
    expect(bad).toEqual([]);
  });

  /**
   * What the hikers, the Hollows, the dropped cap and the animals are drawn
   * with: where each
   * body stands and how (the poses), which file and which clip it is, a
   * lamp's state, the cap's place and shape, and the wildlife a frame at a
   * time with its field, its behaviour and its director. The meshes that
   * draw them take their values from these.
   */
  it("what the hikers, the Hollows, the cap and the animals are drawn with is computed without loading Babylon, whatever it imports", () => {
    const ENGINE_FREE = [
      "characterAssets.ts", "entityPoses.ts", "hollowLook.ts", "lampParams.ts", "skinParams.ts", "droppedCap.ts", "creatureAssets.ts", "wingParams.ts",
      "wildlifeScene.ts", "wildlifeField.ts", "wildlifeBehaviour.ts", "wildlifeDirector.ts", "groundTilt.ts", "skinInstances.ts", "wildlifeInputs.ts",
    ];
    const loaded = (file: string): string[] =>
      [...readFileSync(file, "utf8").matchAll(/^\s*(?:import|export)\s+(?!type\s)(?:[^"'();]*?\s+from\s+)?["']([^"']+)["']/gm)].map((m) => m[1] as string);
    const seen = new Set<string>();
    const stack = ENGINE_FREE.map((name) => at("game", name));
    for (const file of stack) expect(existsSync(file), file).toBe(true);
    const bad: string[] = [];
    while (stack.length > 0) {
      const file = stack.pop() as string;
      if (seen.has(file)) continue;
      seen.add(file);
      for (const spec of loaded(file)) {
        if (spec.startsWith("@babylonjs")) bad.push(`${logical(file)} imports ${spec}`);
        {
          const next = followed(file, spec);
          if (next !== null) stack.push(next);
        }
      }
    }
    expect(seen.size).toBeGreaterThan(ENGINE_FREE.length);
    expect(bad).toEqual([]);
  });

  /**
   * What the lakes' water is drawn with: a surface's numbers and its uniforms by name,
   * the bed's square following the camera, a lake's calm through the
   * weather's fade, whether a view holds a lake, its surface's grid, its
   * skyline, the ripple bump and the rows it is shaded by; its plants as
   * shapes and lists; and its life a frame at a time, with the midges' and
   * the dragonflies' draws as numbers. The meshes that draw them take
   * their values from these.
   */
  it("what the lakes' water, plants and life are drawn with is computed without loading Babylon, whatever it imports", () => {
    const ENGINE_FREE = [
      "waterSurface.ts", "bedFollow.ts", "bedHeight.ts", "lakeCalmFrame.ts", "lakeCalm.ts", "lakeSeen.ts", "lakeSkyline.ts", "lakeSurfaceGrid.ts", "lakeRipples.ts",
      "lakeChoice.ts", "waterBump.ts", "waterShading.ts", "water.ts", "waterPlantShapes.ts", "waterPlantField.ts",
      "waterLifeScene.ts", "waterLifeInputs.ts", "waterLifeField.ts", "waterLifeParams.ts", "midgeLook.ts", "midgeMotion.ts", "dragonflyShapes.ts",
      "dragonflyBehaviour.ts", "frogChorus.ts",
    ];
    const loaded = (file: string): string[] =>
      [...readFileSync(file, "utf8").matchAll(/^\s*(?:import|export)\s+(?!type\s)(?:[^"'();]*?\s+from\s+)?["']([^"']+)["']/gm)].map((m) => m[1] as string);
    const seen = new Set<string>();
    const stack = ENGINE_FREE.map((name) => at("game", name));
    for (const file of stack) expect(existsSync(file), file).toBe(true);
    const bad: string[] = [];
    while (stack.length > 0) {
      const file = stack.pop() as string;
      if (seen.has(file)) continue;
      seen.add(file);
      for (const spec of loaded(file)) {
        if (spec.startsWith("@babylonjs")) bad.push(`${logical(file)} imports ${spec}`);
        {
          const next = followed(file, spec);
          if (next !== null) stack.push(next);
        }
      }
    }
    expect(seen.size).toBeGreaterThan(ENGINE_FREE.length);
    expect(bad).toEqual([]);
  });

  /**
   * What the sea is drawn with: the swell and the wind sea as numbers, the sea following its
   * wind, the wind sea's loop asked of its worker, which field draws the wind sea and the passes of the one that
   * is computed each frame, its edge on the cove with the swash's table and the breaker's
   * tracker, the strips of the plunging lip's curl and the spray's bursts, the rings as one lattice, their samples and the box each has
   * water in, the sea's uniforms by name, and the surf as heard. The meshes
   * that draw it take their values from these.
   */
  it("what the sea is drawn with is computed without loading Babylon, whatever it imports", () => {
    const ENGINE_FREE = [
      "oceanFrame.ts", "oceanWindSea.ts", "oceanLoopStart.ts", "oceanLoopBake.ts", "oceanWaves.ts", "oceanTables.ts", "oceanSwell.ts", "seaEdge.ts", "swashTable.ts",
      "oceanBreaker.ts", "seaLattice.ts", "seaUniforms.ts", "surfSound.ts", "water.ts", "waterSurface.ts",
      "oceanFftPasses.ts", "windSeaField.ts", "lipStrip.ts", "sprayField.ts",
    ];
    const loaded = (file: string): string[] =>
      [...readFileSync(file, "utf8").matchAll(/^\s*(?:import|export)\s+(?!type\s)(?:[^"'();]*?\s+from\s+)?["']([^"']+)["']/gm)].map((m) => m[1] as string);
    const seen = new Set<string>();
    const stack = ENGINE_FREE.map((name) => at("game", name));
    for (const file of stack) expect(existsSync(file), file).toBe(true);
    const bad: string[] = [];
    while (stack.length > 0) {
      const file = stack.pop() as string;
      if (seen.has(file)) continue;
      seen.add(file);
      for (const spec of loaded(file)) {
        if (spec.startsWith("@babylonjs")) bad.push(`${logical(file)} imports ${spec}`);
        {
          const next = followed(file, spec);
          if (next !== null) stack.push(next);
        }
      }
    }
    expect(seen.size).toBeGreaterThan(ENGINE_FREE.length);
    expect(bad).toEqual([]);
    // The wind's lag is made in one place.
    expect(readFileSync(at("game/windSeaField.ts"), "utf8")).toContain("createSeaWindLag()");
  });

  /**
   * What a scene and an ending are played with: the summit's shots and the cap's, the death's
   * fall and its closing dark, the end scene's four shots, its car along the
   * road and its lamps, and the state that runs between them from frame to
   * frame (whose camera the frame has, the local body in a shot, who is in
   * the car, where the one lamp is worn). The renderer steps the play.
   */
  it("what the scenes and the endings are played with is computed without loading Babylon, whatever it imports", () => {
    const ENGINE_FREE = [
      "scenePlay.ts", "shotBodies.ts", "cutscene.ts", "ending.ts", "endScene.ts", "carAudio.ts", "carParts.ts", "scene/roadPath.ts", "scene/timeline.ts", "scene/shots.ts",
      "scene/routeWorld.ts", "scene/scenePlayer.ts", "scene/actorPose.ts", "scene/stageParts.ts", "scene/cordTubeGeometry.ts", "scene/cord.ts",
    ];
    const loaded = (file: string): string[] =>
      [...readFileSync(file, "utf8").matchAll(/^\s*(?:import|export)\s+(?!type\s)(?:[^"'();]*?\s+from\s+)?["']([^"']+)["']/gm)].map((m) => m[1] as string);
    const seen = new Set<string>();
    const stack = ENGINE_FREE.map((name) => at("game", name));
    for (const file of stack) expect(existsSync(file), file).toBe(true);
    const bad: string[] = [];
    while (stack.length > 0) {
      const file = stack.pop() as string;
      if (seen.has(file)) continue;
      seen.add(file);
      for (const spec of loaded(file)) {
        if (spec.startsWith("@babylonjs")) bad.push(`${logical(file)} imports ${spec}`);
        {
          const next = followed(file, spec);
          if (next !== null) stack.push(next);
        }
      }
    }
    expect(seen.size).toBeGreaterThan(ENGINE_FREE.length);
    expect(bad).toEqual([]);
    // On Lite the frame's bodies take up who the scene shows in the frame that says so.
    expect(readFileSync(at("game/lite/hikeParts.ts"), "utf8")).toContain("bodies = bodiesInShot(poses, bodies, now, state, localId, alpha, host.stands() ? (entities?.models ?? null) : null);");
  });

  /**
   * What stands between a renderer and the page it draws on is the game's
   * own arithmetic too: the frame's size from the canvas's box, the tier's
   * scaling and the render scale under the paint, the watch a renderer
   * keeps on an engine it made for itself, the count of what a device is
   * asked to make of shaders, and the measurement mode's report. The
   * renderer reads the rule that says where the render scale runs, and
   * answers the one type a renderer is held by (`rendererTypes.ts`). The
   * hike's renderer's wait for its world is of the same kind (`worldWait.ts`),
   * and so are the swap of one renderer for another, the answer to an engine
   * that fails and the start's gate.
   */
  it("what a renderer is sized and started by is computed without loading Babylon, whatever it imports", () => {
    const ENGINE_FREE = ["frameSize.ts", "renderScale.ts", "quality.ts", "engineWatch.ts", "deviceMakes.ts", "gpuTimeTasks.ts", "gpuTimeReport.ts", "gpuFaults.ts", "deviceHeld.ts", "lossBound.ts", "rendererTypes.ts", "worldWait.ts", "rendererSwap.ts", "engineFailure.ts", "startReady.ts", "drawnSettle.ts"];
    const loaded = (file: string): string[] =>
      [...readFileSync(file, "utf8").matchAll(/^\s*(?:import|export)\s+(?!type\s)(?:[^"'();]*?\s+from\s+)?["']([^"']+)["']/gm)].map((m) => m[1] as string);
    const seen = new Set<string>();
    const stack = ENGINE_FREE.map((name) => at("game", name));
    for (const file of stack) expect(existsSync(file), file).toBe(true);
    const bad: string[] = [];
    while (stack.length > 0) {
      const file = stack.pop() as string;
      if (seen.has(file)) continue;
      seen.add(file);
      for (const spec of loaded(file)) {
        if (spec.startsWith("@babylonjs")) bad.push(`${logical(file)} imports ${spec}`);
        {
          const next = followed(file, spec);
          if (next !== null) stack.push(next);
        }
      }
    }
    expect(seen.size).toBeGreaterThan(ENGINE_FREE.length);
    expect(bad).toEqual([]);
    const lite = readFileSync(at("game/lite/renderer.ts"), "utf8");
    expect(lite).toContain("createFrameFit(tier, renderScaleRuns(postFeatures.paint, options.gpuTime === true), {");
    // The surface is sized by the game's rule alone: Lite's own fit to the display's ratio is not called.
    expect(lite).not.toContain("resizeEngine");
    // A lost device is told to the hike, which builds the renderer again: Lite's recovery in place is not used.
    expect(lite).toContain('engineWatch.fail("lost");');
    expect(lite).toContain("ownWatch: engineWatch.watch,");
    expect(lite).not.toContain("enableDeviceLostSceneRecovery");
    // What the engine tells is told from the device's own calls, and timed by Lite's own timers.
    expect(lite).toContain("onShaderCompiled: (fn) => makes.onMade(fn),");
    // Its world is waited for by the bound of whoever asks: the swap's module walks no scene.
    expect(lite).toContain("    whenReady(maxMs) {\n      return whenWorldIn(sceneryReady, maxMs).then(() => {");
    expect(readFileSync(at("game/rendererSwap.ts"), "utf8")).not.toMatch(/whenSceneReady|walkSceneReady|@babylonjs/);
    expect(readFileSync(at("game/lite/gpuTimeReadout.ts"), "utf8")).toContain("taskTimeReport({");
  });

  /**
   * What the GPU says went wrong under a hike is told through the game's
   * own record (`gpuFaults.ts`, with no engine: the list above): the
   * renderer tells it of every error its device reports and of a loss it
   * did not ask for, the hike keeps the record for its life and gives it
   * each renderer that stands, and the page counts the losses its hikes
   * have had, so the loss that is one too many ends the hike by the way a
   * hike already ends when its graphics cannot be restarted.
   */
  it("tells the hike's record of the device's errors and losses, and ends a hike by the page's count of losses, through its one line", () => {
    const lite = readFileSync(at("game/lite/renderer.ts"), "utf8");
    // Every error nobody caught, and every one a scope handed back.
    expect(lite).toContain('      heard?.error(gpuFaults, error, "uncaptured");');
    expect(lite).toContain('    stopScopes = hearErrorScopes(getGpuDevice(engine), (error) => heard?.error(gpuFaults, error, "scope"));');
    // A loss is told before the hike is asked to answer it; the renderer's own letting go is told to no one.
    const lost = lite.slice(lite.indexOf("    onEngineDeviceLost(engine, (info) => {"), lite.indexOf('      engineWatch.fail("lost");'));
    expect(lost.indexOf("      if (disposed) return;")).toBeGreaterThan(0);
    expect(lost.indexOf("      heard?.lost(gpuFaults, info);")).toBeGreaterThan(lost.indexOf("      if (disposed) return;"));
    expect(lite).toContain("      heard = null;\n      stopScopes();\n      held.stop();");
    // A frame with no error counts itself and does no more: the picture is read in one place, when the record asks,
    // and what the device holds is counted only for a hike that sends it on.
    expect([...lite.matchAll(/\bdrawn\+\+/g)].length).toBe(1);
    expect([...lite.matchAll(/\breadPictureSmall\(/g)].length).toBe(1);
    expect(lite).toContain("    if (heard?.counting === true) {\n      holds = true;\n      held.count(getGpuDevice(engine) as unknown as HeldDevice);\n    }");
    expect(lite).toContain("    gpuFaults,\n    gpuTime,");
    // The hike gives its record each renderer that stands, as it puts the watch on it.
    const app = stripComments(readFileSync(at("app.ts"), "utf8"));
    expect([...app.matchAll(/\bcreateGpuFaults\(/g)].length).toBe(1);
    expect(app).toContain("      faults.attach(r);\n      const engine = r.engine;");
    expect(app).toContain("    loss: () => options.losses.note(),");
    // The loss that is one too many is not answered by another renderer: the hike ends as any hike that cannot go on.
    expect(app).toContain('    ends: (reason) => reason === "lost" && faults.lastLoss?.end === true,');
    expect(app).toContain('      options.losses.ended();\n      endSession(LOSS_ENDED_LINE, { why: "device_lost", losses: loss?.losses ?? 0, recent: loss?.recent ?? 0 });');
    // The page's count is one record for every hike of the page, and the landing's line is the same constant.
    const main = stripComments(readFileSync(at("shell.ts"), "utf8"));
    expect([...main.matchAll(/\bcreateLossRecord\(/g)].length).toBe(1);
    expect(main).toContain("    note: () => lostDevices.note(performance.now()),");
    expect(main).toContain("    ended: () => void leaveNotice(pageSessionStorage(), LOSS_ENDED_LINE, Date.now()),");
    expect(main).toContain("      engineFailed,\n      losses,");
    // The line's words stand in one constant, and the bound's numbers in one module.
    const naming = (pattern: RegExp): string[] =>
      sourceFiles(SRC).flatMap((file) => [...stripComments(readFileSync(file, "utf8")).matchAll(pattern)].map(() => logical(file)));
    expect(naming(/\bLOSS_ENDED_LINE = /g)).toEqual(["game/lossBound.ts"]);
    expect(naming(/\bLOSS_BOUND_(?:COUNT|WINDOW_MS) = /g)).toEqual(["game/lossBound.ts", "game/lossBound.ts"]);
  });

  /**
   * The hike's renderer is drawn with Babylon Lite, and nothing of it is
   * Babylon.js: not a module under `game/lite/`, and not anything one of
   * them loads. What it is made with beside Lite is the game's own
   * arithmetic, which loads no engine, and types, which load nothing.
   */
  it("draws the hike with Babylon Lite alone: nothing under game/lite/ loads Babylon.js, whatever it imports", () => {
    const loaded = (file: string): string[] =>
      [...readFileSync(file, "utf8").matchAll(/^\s*(?:import|export)\s+(?!type\s)(?:[^"'();]*?\s+from\s+)?["']([^"']+)["']/gm)].map((m) => m[1] as string);
    const own = sourceFiles(at("game", "lite"));
    expect(own.length).toBeGreaterThan(5);
    const seen = new Set<string>();
    const stack = [...own];
    const bad: string[] = [];
    const lite: string[] = [];
    while (stack.length > 0) {
      const file = stack.pop() as string;
      if (seen.has(file)) continue;
      seen.add(file);
      for (const spec of loaded(file)) {
        if (spec === "@babylonjs/lite") lite.push(logical(file));
        else if (spec.startsWith("@babylonjs")) bad.push(`${logical(file)} imports ${spec}`);
        {
          const next = followed(file, spec);
          if (next !== null) stack.push(next);
        }
      }
    }
    expect(seen.size).toBeGreaterThan(own.length);
    expect(bad).toEqual([]);
    // Lite itself is loaded only by the modules that draw: the plugins, the pose and the light name its types alone.
    expect(lite.sort()).toEqual([
      "game/lite/bladeMeshes.ts", "game/lite/brushMeshes.ts", "game/lite/capMesh.ts", "game/lite/cliffMeshes.ts", "game/lite/clutterMeshes.ts", "game/lite/crowdCardMeshes.ts", "game/lite/crowdEyeMeshes.ts", "game/lite/dragonflyMeshes.ts", "game/lite/duffMeshes.ts", "game/lite/entityMeshes.ts", "game/lite/forestMeshes.ts", "game/lite/forestModels.ts", "game/lite/gpuTimeReadout.ts", "game/lite/groundTextures.ts", "game/lite/impostorBake.ts",
      "game/lite/lakeMeshes.ts", "game/lite/lakeMirror.ts", "game/lite/lakePanorama.ts", "game/lite/lipMeshes.ts", "game/lite/listMeshes.ts", "game/lite/midgeMeshes.ts", "game/lite/mistMeshes.ts", "game/lite/motes.ts", "game/lite/postChain.ts", "game/lite/propMeshes.ts", "game/lite/rain.ts", "game/lite/rainMap.ts", "game/lite/rainSplash.ts", "game/lite/renderer.ts", "game/lite/sceneActor.ts", "game/lite/sceneryMeshes.ts", "game/lite/sceneryModels.ts", "game/lite/sceneryPaint.ts", "game/lite/seaFft.ts", "game/lite/seaMeshes.ts", "game/lite/shadeMask.ts", "game/lite/shadeVeil.ts", "game/lite/shaderUniforms.ts",
      "game/lite/skinnedModels.ts", "game/lite/skyCapture.ts", "game/lite/skyDome.ts", "game/lite/surfSpray.ts", "game/lite/terrainMeshes.ts", "game/lite/waterBed.ts", "game/lite/waterBehind.ts", "game/lite/waterPlantMeshes.ts", "game/lite/wayFieldMesh.ts", "game/lite/wayLightMeshes.ts", "game/lite/wildlifeMeshes.ts", "game/lite/wornLamps.ts",
    ]);
    // And the hike is handed that renderer by a module that loads it and nothing else that draws.
    // With Day Hike's side of it (`lite/hikeParts.ts`), which the renderer calls at its own points.
    expect(readFileSync(at("game/hikeRenderer.ts"), "utf8")).toContain("  return createLiteRenderer(canvas, level, forest, options, hikeParts);");
    expect(loaded(at("game/hikeRenderer.ts"))).toEqual([`${ENGINE_PACKAGE}game/lite/renderer`, "./lite/hikeParts.js"]);
  });

  /**
   * A renderer is held by types alone (`rendererTypes.ts`): the hike, the
   * ladders that swap one renderer for another, the staged scenes and the
   * renderer on Babylon Lite name them there, and naming them loads nothing.
   */
  it("holds a renderer by types that load nothing: the hike's, the swap's, the staged scenes' and the renderer's name them in one module", () => {
    const loaded = (file: string): string[] =>
      [...readFileSync(file, "utf8").matchAll(/^\s*(?:import|export)\s+(?!type\s)(?:[^"'();]*?\s+from\s+)?["']([^"']+)["']/gm)].map((m) => m[1] as string);
    const types = at("game/rendererTypes.ts");
    // Every import of it is a type's, and it names nothing of an engine's own package.
    expect(loaded(types)).toEqual([]);
    expect(importsOf(types).length).toBeGreaterThan(10);
    expect(importsOf(types).filter((spec) => spec.startsWith("@babylonjs"))).toEqual([]);
    const text = readFileSync(types, "utf8");
    for (const name of ["FreecamView", "FrameView", "RendererOptions"]) expect(text, name).toContain(`export type ${name} = {`);
    // The engine's renderer of the world, whatever state a game hands it; the hike's own is that over Day Hike's state
    // with Day Hike's own methods beside it, in a module of types as bare.
    expect(text).toContain("export type WorldRenderer<S> = {");
    const hike = at("game/hikeRendererTypes.ts");
    expect(loaded(hike)).toEqual([]);
    expect(importsOf(hike).filter((spec) => spec.startsWith("@babylonjs"))).toEqual([]);
    expect(readFileSync(hike, "utf8")).toContain("export type Renderer = WorldRenderer<WorldState> & HikeApi;");
    // Each of them is defined once in src/.
    const defined = sourceFiles(SRC).flatMap((file) =>
      [...stripComments(readFileSync(file, "utf8")).matchAll(/\bexport type (?:FreecamView|FrameView|Renderer|RendererOptions) =/g)].map(() => logical(file)),
    );
    expect(defined.sort()).toEqual(["game/hikeRendererTypes.ts", "game/rendererTypes.ts", "game/rendererTypes.ts", "game/rendererTypes.ts"]);
    // Who holds a renderer takes the types from there.
    for (const holder of ["app.ts", "game/hikeRenderer.ts", "game/rendererSwap.ts", "game/lite/renderer.ts", "game/lite/notDrawn.ts", "game/lite/probeScene.ts", "game/lite/sceneRoute.ts", "game/lite/sceneStage.ts", "game/lite/sceneryMeshes.ts"]) {
      const specs = importsOf(at(holder));
      expect(specs.some((spec) => /\/(?:rendererTypes|hikeRendererTypes)(?:\.js)?$/.test(spec)), holder).toBe(true);
    }
  });

  /**
   * A hike loads no Babylon.js: not `app.ts` by an import of its own (the
   * test above) and not anything it imports, by an import or by a dynamic
   * one, however deep. What it loads of an engine is Babylon Lite, through
   * the renderer it is handed (`hikeRenderer.ts`). So what it is told by
   * comes from the modules that compute it with no engine (`skyWait.ts`,
   * `droppedCap.ts`, `loadReport.ts`), and the scenery it places once is
   * asked of its renderer (`hikeScenery.ts`).
   */
  it("loads no Babylon.js under a hike: nothing app.ts imports, by an import or a dynamic one, reaches a module that loads it", () => {
    const loads = (file: string): string[] => {
      const text = readFileSync(file, "utf8");
      const imported = [...text.matchAll(/^\s*(?:import|export)\s+(?!type\s)(?:[^"'();]*?\s+from\s+)?["']([^"']+)["']/gm)].map((m) => m[1] as string);
      const asked = [...stripComments(text).matchAll(/\bimport\(\s*["']([^"']+)["']\s*\)/g)].map((m) => m[1] as string);
      return [...imported, ...asked];
    };
    /** Every module `entry` loads, with the Babylon.js each loads (and the chain it is reached by) and the modules that load Babylon Lite. */
    const reach = (entry: string): { seen: number; babylon: string[]; lite: string[] } => {
      const from = new Map<string, string | null>([[entry, null]]);
      const queue = [entry];
      const babylon: string[] = [];
      const lite: string[] = [];
      for (let at = 0; at < queue.length; at++) {
        const file = queue[at] as string;
        if (!existsSync(file)) continue;
        for (const spec of loads(file)) {
          if (spec === "@babylonjs/lite") lite.push(logical(file));
          else if (spec.startsWith("@babylonjs")) {
            const chain: string[] = [];
            for (let f: string | null = file; f !== null; f = from.get(f) ?? null) chain.unshift(logical(f));
            babylon.push(`${chain.join(" > ")} loads ${spec}`);
          }
          const next = followed(file, spec);
          if (next === null) continue;
          if (!from.has(next)) {
            from.set(next, file);
            queue.push(next);
          }
        }
      }
      return { seen: from.size, babylon, lite: [...new Set(lite)] };
    };
    // A hike is the page's half (`app.ts`) and the game it is handed (`hikeGame.ts`), which the page names by type alone:
    // the walk starts from both.
    const page = reach(at("app.ts"));
    const hike = reach(at("hikeGame.ts"));
    // Guards against the guard: the walk goes through the whole hike and finds the engine it does load.
    expect(hike.seen).toBeGreaterThan(300);
    expect(page.seen).toBeGreaterThan(50);
    expect(hike.lite).toContain("game/lite/renderer.ts");
    expect(hike.babylon).toEqual([]);
    expect(page.babylon).toEqual([]);
    // What the hike is told by is taken where it is computed, and its scenery is asked of its renderer alone.
    // `app.ts`, `hike.ts` (the hike's own half) and `hikeGame.ts` (the game as the page is handed it) are told by them
    // between them.
    // Each import is followed to its file, since the page's half is the engine's and names its neighbours by path
    // where the game names them by the package.
    const told = [at("app.ts"), at("hike.ts"), at("hikeGame.ts")].flatMap((file) =>
      importsOf(file).map((spec) => followed(file, spec)).filter((to): to is string => to !== null).map(logical),
    );
    for (const home of ["game/skyWait.ts", "game/droppedCap.ts", "game/loadReport.ts", "game/hikeRenderer.ts", "game/hikeScenery.ts"]) expect(told, home).toContain(home);
    expect(loads(at("game/hikeScenery.ts")).filter((spec) => spec.startsWith("./"))).toEqual(["./boardImages.js", "./boardDraw.js", "./posterPanel.js", "./lite/sceneryMeshes.js"]);
  });

  /**
   * The game is drawn with Babylon Lite and names no other library of that
   * family: no file of `src/` or `test/` imports a package under
   * `@babylonjs/` but `@babylonjs/lite`, for a value or for a type, by an
   * import or a dynamic one, and no file of `src/` spells such a package any
   * other way. What Babylon.js once gave the tests is a record on disk
   * (`test/fixtures/babylon/`), read as text and numbers by a helper that
   * loads nothing.
   */
  it("names no Babylon.js: no file of src/ or test/ imports a package under @babylonjs/ but Babylon Lite, and the record of what it gave is read with none", () => {
    const everyImport = (file: string): string[] => {
      const asked = [...stripComments(readFileSync(file, "utf8")).matchAll(/\bimport\(\s*["']([^"']+)["']\s*\)/g)].map((m) => m[1] as string);
      return [...new Set([...importsOf(file), ...asked])];
    };
    // A package's name or a path into it: what an import can ask for (this file's own rules spell the family in
    // patterns, which are no imports).
    const ofBabylon = (spec: string): boolean => /^@babylonjs\/[\w.@/-]+$/.test(spec) && spec !== "@babylonjs/lite";
    expect(["@babylonjs/core", "@babylonjs/core/Engines/engine.js", "@babylonjs/loaders/glTF/index.js", "@babylonjs/lite"].map(ofBabylon)).toEqual([true, true, true, false]);
    const files = [...sourceFiles(SRC), ...sourceFiles(TESTS)];
    const named: string[] = [];
    let lite = 0;
    for (const file of files) {
      const specs = everyImport(file);
      if (specs.includes("@babylonjs/lite")) lite++;
      for (const spec of specs) if (ofBabylon(spec)) named.push(`${relative(at(".."), file)} names ${spec}`);
    }
    // Guards against the guard: the walk reads the whole of src/ and test/ and finds the library where it is named.
    expect(sourceFiles(SRC).length).toBeGreaterThan(400);
    expect(sourceFiles(TESTS).length).toBeGreaterThan(400);
    expect(lite).toBeGreaterThan(40);
    expect(named).toEqual([]);
    // Nor is such a package spelt in src/ outside an import: a path into it, a `require`, a URL.
    const spelt = sourceFiles(SRC)
      .filter((file) => /@babylonjs\/(?!lite\b)/.test(stripComments(readFileSync(file, "utf8"))))
      .map((file) => logical(file));
    expect(spelt).toEqual([]);
    // The record's reader loads the file system and nothing else.
    expect(importsOf(join(TESTS, "helpers/babylonFixture.ts"))).toEqual(["node:fs"]);
    // And the swap and the renderer's types load nothing at all.
    const loaded = (file: string): string[] =>
      [...readFileSync(file, "utf8").matchAll(/^\s*(?:import|export)\s+(?!type\s)(?:[^"'();]*?\s+from\s+)?["']([^"']+)["']/gm)].map((m) => m[1] as string);
    expect(loaded(at("game/rendererSwap.ts"))).toEqual([]);
    expect(loaded(at("game/rendererTypes.ts"))).toEqual([]);
  });

  /**
   * A hike is handed no engine. Its renderer makes its own from the canvas
   * it is built on, keeps its own watch on it and lets it go with itself, so
   * the hike, the swap and the type a renderer is held by carry nothing that
   * was written for an engine made elsewhere: none handed to a start or to
   * a renderer, none kept for the next hike with its shaders pinned, no
   * watchers of one, no start held or switch's cover kept up until one had
   * drawn a whole frame, no log of one heard, and no override of one in the
   * address.
   */
  it("hands a hike no engine, keeps none after it and waits on none: its renderer makes its own and lets it go with itself", () => {
    const code = (name: string): string => stripComments(readFileSync(at(name), "utf8"));
    const app = code("app.ts");
    expect(app).not.toMatch(/\b(?:unowned|keepEngine|KeptEngine|watchers|EngineWatchers|pipelinesFor|AsyncPipelines|asyncPipelines|pinCompiles|keepShaders|retire)\b/);
    expect(app).not.toMatch(/\b(?:holdReveal|whenFrameWhole|endRevealHold|firstWholeFrame|revealWhenWhole|revealHold|reveal:)/);
    expect(app).not.toMatch(/options\.engine\b(?!F)/);
    // A renderer is made from its canvas, its tier and the world, at the start and for every swap: no engine among them.
    expect([...app.matchAll(/\bgame\.renderer\(next, level, forest, \{ tier: (?:at|target), /g)].length).toBe(2);
    expect(app).not.toMatch(/engine: engine|pipelines:/);
    // A switch's ladder is handed a tier and no engine, and its cover waits for the new renderer's world alone.
    expect(app).toContain("          { tier: target, fallbackTier: tier },");
    expect(code("game/rendererSwap.ts")).not.toMatch(/\bEngineHandle\b|engineFailed|engineFellBack/);
    expect(app).toContain("      await renderer.whenReady(readyMaxMs);\n      return tier;\n    } finally {");
    // The hike's end lets its renderer go, engine and all.
    const dispose = app.slice(app.lastIndexOf("    dispose() {\n      disposed = true;"));
    expect(dispose).toMatch(/unwatchCompiles\?\.\(\);\s+renderer\.dispose\(\);\s+\}/);
    // The page makes a canvas and nothing more, and the swap holds it as that.
    // A switch is handed its canvas at once, and one the page refuses is a throw; a start's chain takes the same canvas as a promise.
    const main = code("shell.ts");
    expect(main).toContain('  function sessionCanvasNow(): EngineOnCanvas {\n    if (verdict !== null && !verdict.play) throw new Error(`this browser cannot draw a hike (${verdict.reason})`);\n    return { canvas: document.createElement("canvas") };\n  }');
    expect(main).toContain("    return new Promise((resolve) => resolve(sessionCanvasNow()));");
    expect(main).toContain("        launch(onCanvas, route.token, decided, () => sessionCanvasNow(), opening, takeSampled);");
    expect(app).toContain("  engineFor(tier: QualityTier): EngineOnCanvas;");
    const swap = code("game/rendererSwap.ts");
    expect(swap).toContain("export type EngineOnCanvas = { canvas: HTMLCanvasElement };");
    // The swap waits for no canvas: it keeps no timer and no bound but the two its callers pass.
    expect(swap).not.toMatch(/\b(?:setTimeout|setTimer|engineWithinBound|SWAP_SCENE_MIN_MS)\b|\bnow\(\)/);
    expect(swap).not.toMatch(/\b(?:EngineWatchers|AsyncPipelines|whenSceneReady|walkSceneReady)\b/);
    // The type every renderer is held by names no engine handed in, no pipelines, no kept shaders and no retiring;
    // the hike's renderer answers none, and the start's gate waits on no frame of one.
    const types = code("game/rendererTypes.ts");
    expect(types).not.toMatch(/\b(?:keepShaders|retire|pipelines|AsyncPipelines)\b|\bengine\?:/);
    const lite = code("game/lite/renderer.ts");
    expect(lite).not.toMatch(/\b(?:keepShaders|retire)\b|options\.engine|options\.pipelines/);
    expect(code("game/startReady.ts")).not.toMatch(/\breveal\b/);
    // The address's `?engine=` and `?wgsl=` are no page's own, and the page's error capture hears no library's log.
    expect(code("game/router.ts")).toContain('const OVERRIDES = ["tier", "probe"] as const;');
    expect(code("net/telemetry.ts")).not.toMatch(/babylon|EngineLog/i);
  });

  /**
   * Babylon Lite names what a pass of the hike's own is drawn with
   * (`getGpuDevice`, `getFrameEncoder`, `getRenderTargetAttachments`,
   * `createCustomTask`), so nothing under `game/lite/` reaches into an
   * engine, a render target or a task for a field Lite keeps to itself: such
   * a read breaks without a word when Lite renames the field.
   */
  it("reads none of Babylon Lite's private fields under game/lite/: the device, the frame's encoder, a target's attachments, a task's passes", () => {
    const PRIVATE = /\b_(?:device|currentEncoder|colorView|colorTexture|depthView|depthTexture|passes|width|height)\b/;
    const own = sourceFiles(at("game", "lite"));
    expect(own.length).toBeGreaterThan(5);
    expect(own.filter((file) => PRIVATE.test(readFileSync(file, "utf8"))).map((file) => logical(file))).toEqual([]);
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
   *   and the headlamp's direction (`entityPoses.ts`, render-only, never
   *   hashed), so an engine difference is unobservable either way.
   * - `hollow.ts` — the Hollow's two facings, one in `walkToward` and one in
   *   `faceToward` for the states that do not walk, both written inside the
   *   authoritative branch (`stepHollows`) and never replayed; render-only
   *   downstream.
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
      "hollow.ts Math.atan2(",
      "movement.ts Math.cos(",
      "movement.ts Math.sin(",
      "view.ts Math.cos(",
      "view.ts Math.cos(",
      "view.ts Math.sin(",
      "view.ts Math.sin(",
    ];

    const found: string[] = [];
    for (const file of sourceFiles(at("sim"))) {
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
    for (const file of sourceFiles(at("sim"))) {
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
    expect(existsSync(at("sim", "combat.ts"))).toBe(false);
  });

  it("holds or frees the controls only through the play gate", () => {
    // `createPlayGate` owns suppression outright: the bar, the menu, the
    // match's end and the governor's cover all go through it, so no path can
    // free the controls one of the others holds. Every mention of the name is
    // counted, not only `x.setSuppressed(` calls, so optional chaining,
    // brackets, a split line, `.bind` or destructuring cannot slip past:
    // input.ts declares and defines it, pauseMenu.ts declares the gate's
    // dependency and calls it once, app.ts hands the gate `input`'s.
    const mentions: Record<string, number> = {};
    for (const file of sourceFiles(SRC)) {
      const count = [...stripComments(readFileSync(file, "utf8")).matchAll(/\bsetSuppressed\b/g)].length;
      if (count > 0) mentions[logical(file).split("\\").join("/")] = count;
    }
    expect(mentions).toEqual({ "app.ts": 2, "game/input.ts": 2, "game/pauseMenu.ts": 2 });
    expect(readFileSync(at("app.ts"), "utf8")).toContain("setSuppressed: (on) => input.setSuppressed(on),");
  });
});

/**
 * The game's WGSL is kept in `.wgsl` files under `game/shaders/`, each imported where it is used with `?raw`, and
 * not written out in a TypeScript module. What stays in a module is what code makes at run time: a number
 * formatted in, lines written by a loop, a binding made from a layout, and the choice between pieces.
 */
describe("the game's WGSL is kept in files", () => {
  /** What WGSL is told by: a stage's entry point, a binding, a built-in, a sampling call, a function's return type, the tag. */
  const TOKENS: readonly RegExp[] = [
    /@vertex/, /@fragment/, /@compute/, /@group\(/, /@binding\(/, /@location\(/, /@builtin\(/,
    /\bfn\s+\w+\s*\([^)]*\)\s*->/, /textureSample/, /var<uniform>/, /\/\*\s*wgsl\s*\*\//,
  ];
  /** The lines of a module that carry such a token and are not static shader text, each with why. A line is named by a piece of its text. */
  const ALLOWED: readonly { file: string; text: string; why: string }[] = [
    { file: "game/lite/postWgsl.ts", text: "const taps = offsets.map(", why: "one blur tap for each of the kernel's taps, with its two numbers formatted in: lines made by a loop" },
    { file: "game/lite/postWgsl.ts", text: "halation ? \"@group(0)@binding(5)var halationSampler", why: "one declaration under 120 characters that the grade's halation switches on" },
  ];
  const wgslFiles = [...walkFiles(SRC, ".wgsl"), ...walkFiles(ENGINE, ".wgsl")];
  const modules = sourceFiles(SRC);

  it("can actually see the files and the modules", () => {
    expect(wgslFiles.length).toBeGreaterThan(100);
    expect(modules.length).toBeGreaterThan(100);
  });

  it("holds no static WGSL in a TypeScript module but the lines it lists, each with its reason", () => {
    const found: string[] = [];
    const used = new Set<number>();
    for (const file of modules) {
      const name = logical(file).split("\\").join("/");
      stripComments(readFileSync(file, "utf8")).split("\n").forEach((line, i) => {
        if (!TOKENS.some((token) => token.test(line))) return;
        const at = ALLOWED.findIndex((a) => a.file === name && line.includes(a.text));
        if (at >= 0) used.add(at);
        else found.push(`${name}:${i + 1}: ${line.trim().slice(0, 100)}`);
      });
    }
    expect(found, "shader text belongs in a .wgsl file under game/shaders/, imported with ?raw").toEqual([]);
    expect(ALLOWED.filter((_, at) => !used.has(at)).map((a) => `${a.file}: ${a.text}`), "an allowance no line needs: remove it").toEqual([]);
  });

  /** For each module, the `.wgsl` files it imports with `?raw` (by the name it gives them) and the slots each `fill(wgsl(name), {...})` gives. */
  const readImports = (file: string): { imported: Map<string, string>; fills: Map<string, string[]> } => {
    const source = ts.createSourceFile(file, readFileSync(file, "utf8"), ts.ScriptTarget.Latest, true);
    const imported = new Map<string, string>();
    const fills = new Map<string, string[]>();
    const visit = (node: ts.Node): void => {
      if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier) && node.moduleSpecifier.text.endsWith(".wgsl?raw") && node.importClause?.name !== undefined) {
        imported.set(node.importClause.name.text, join(file, "..", node.moduleSpecifier.text.slice(0, -"?raw".length)));
      }
      if (ts.isCallExpression(node) && ts.isIdentifier(node.expression)) {
        const named = (call: ts.Node): string | null =>
          ts.isCallExpression(call) && ts.isIdentifier(call.expression) && call.expression.text === "wgsl" && call.arguments[0] !== undefined && ts.isIdentifier(call.arguments[0]) ? call.arguments[0].text : null;
        if (node.expression.text === "fill" && node.arguments[0] !== undefined) {
          const name = named(node.arguments[0]);
          const slots = node.arguments[1];
          if (name !== null && slots !== undefined && ts.isObjectLiteralExpression(slots)) {
            fills.set(name, slots.properties.map((property) => (ts.isShorthandPropertyAssignment(property) || ts.isPropertyAssignment(property) ? property.name.getText() : "?")));
          }
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(source);
    return { imported, fills };
  };
  const slotsOf = (file: string): string[] => [...new Set([...readFileSync(file, "utf8").matchAll(/\$\{([^}]*)\}/g)].map((m) => m[1] as string))];

  it("has every file imported by some module", () => {
    const imported = new Set<string>();
    for (const file of modules) for (const path of readImports(file).imported.values()) imported.add(path);
    for (const path of imported) expect(existsSync(path), `${path} is imported and is not there`).toBe(true);
    expect(wgslFiles.filter((file) => !imported.has(file)).map((file) => logical(file))).toEqual([]);
  });

  it("has every slot of a file filled by the module that imports it, and no value for a slot the file does not have", () => {
    const wrong: string[] = [];
    for (const file of modules) {
      const { imported, fills } = readImports(file);
      for (const [name, path] of imported) {
        const slots = slotsOf(path);
        for (const slot of slots) if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(slot)) wrong.push(`${logical(path)}: \${${slot}} is not a slot name`);
        const given = fills.get(name);
        const where = `${logical(file)} imports ${logical(path)}`;
        if (given === undefined) {
          if (slots.length > 0) wrong.push(`${where} and does not fill ${slots.join(", ")}`);
        } else {
          for (const slot of slots) if (!given.includes(slot)) wrong.push(`${where} and gives no value for \${${slot}}`);
          for (const key of given) if (!slots.includes(key)) wrong.push(`${where} and gives a value for ${key}, which the file does not have`);
        }
      }
    }
    expect(wrong).toEqual([]);
  });

  it("is told by the one helper, which imports nothing", () => {
    expect(importsOf(at("game/shaders/shaderText.ts"))).toEqual([]);
  });
});

function scannedTestFiles(): ScannedFile[] {
  return sourceFiles(TESTS)
    .filter((f) => f.endsWith(".test.ts"))
    .map((f) => ({ file: relative(TESTS, f), scan: scanTestSource(f, readFileSync(f, "utf8")) }));
}

describe("test time limits", () => {
  const files = scannedTestFiles();

  // Guards against the guard: a scan that finds no test files or no limits
  // would pass the rule below vacuously.
  it("can see the test files and the limits in them", () => {
    expect(files.length).toBeGreaterThan(100);
    const scaled = files.flatMap(({ scan }) => scan.calls.flatMap((c) => c.limits)).filter((l) => l.kind === "scaled");
    expect(scaled.length).toBeGreaterThan(50);
  });

  /**
   * A limit guards against a hang and must scale with the machine running the
   * suite, so every explicit one goes through `timeLimit` (test/helpers/
   * timeLimit.ts), which multiplies it by TEST_TIME_SCALE. A bare number, or a
   * const holding one, would stay the same on a machine three times slower.
   * A limit written after the callback of a call that also has an options
   * object is worse: vitest ignores it, so it goes inside the options instead.
   * Waits (`vi.waitFor`, `vi.waitUntil`, `expect.poll`) give up after a limit
   * too, a guard of the same kind, so they state theirs through `timeLimit`;
   * their 1 s default would not scale. `vi.setConfig`'s `testTimeout` and
   * `hookTimeout` are test limits and follow the same rule.
   *
   * What the scan cannot see, by design, because it reads one file and follows
   * only names declared in it: options or limits imported from another file
   * or returned from a helper (no advice is given for them here; the
   * wall-clock rule below reports them as "cannot tell whether this is
   * tagged"), a
   * limit computed in a helper function and passed in, a computed property
   * key, a spread of anything but a const in the same file, a `let` that is
   * reassigned after its declaration (read by its first value), and a limit
   * given to a hook reached through the test context (`ctx.onTestFinished`)
   * rather than imported. A parameter named in `{ timeout }` shorthand is read
   * as bare, so a helper that takes an already-scaled limit would be told to
   * scale it again. The around-hooks, the finish hooks and tests made with
   * `test.extend` are read like the others.
   */
  it("sends every explicit test, suite, hook and wait limit through timeLimit", () => {
    expect(limitOffenders(files)).toEqual([]);
  });
});

describe("wall-clock tests", () => {
  const files = scannedTestFiles();

  /**
   * A test that asserts on elapsed time measures the machine as much as the
   * code: its bar was set on the development machine and means nothing on a
   * shared or slower one. Those tests carry the `wall-clock` tag (defined in
   * vite.config.ts), which CI leaves out and `npm run test:wall-clock` runs
   * alone. Any clock read in a test puts it under this rule; a test that only
   * prints a timing, asserting nothing on it, is listed here with why.
   *
   * The converse holds too: the tag keeps a test off CI with `gates` still
   * green, so it goes only on a test that reads a clock, and the count of
   * tagged tests is a literal below, so adding one is a deliberate edit.
   *
   * Tags come from the call's options, from every suite around it, and from
   * the file's module-tag pragma, which vitest reads from the source and
   * applies to every test in the file. Tags the scan cannot resolve to string
   * literals on an options object in this file fail closed: the call is
   * reported as "cannot tell whether this is tagged".
   *
   * What the scan cannot see, by design, because it reads one file: a clock
   * read inside a helper imported from another file, and a clock function
   * passed around as a value (`measure(performance.now)`) rather than bound to
   * a const. It sees `now()` on any receiver ending in `performance`/`Date`
   * (`globalThis.performance?.now()`, `performance["now"]()`, a `perf_hooks`
   * import under another name, a const alias, `{ performance: p } =
   * globalThis`), `performance.mark`/`measure`, a destructured or bound
   * `now`, `process.hrtime` and `process.uptime` (also imported from
   * `node:process`), `vi.getRealSystemTime()`, `new Date()`/`Date()`, and
   * `console.time`.
   */
  const PRINTED_NOT_ASSERTED: Record<string, string> = {
  };
  const report = wallClockOffenders(files, PRINTED_NOT_ASSERTED);

  it("tags exactly the tests that assert on a clock, and lists the ones that only print one", () => {
    expect(report.offenders).toEqual([]);
  });

  it("tags exactly these tests wall-clock: adding or removing one is a deliberate edit here", () => {
    expect(
      [...report.tagged].sort(),
      "the wall-clock tests changed: if that is meant, update this list and the files test:wall-clock names; if not, remove the tag",
    ).toEqual([
      "game/forestField.test.ts > keeps a warm one-cell-move collect fast — the 25-33 ms rescan must not return",
      "game/oceanBreaker.test.ts > costs under 0.3 ms an update on average over 600 updates of the widest cove",
      "game/swashTable.test.ts > costs under 0.2 ms an update on average over 600 updates of the widest cove",
      "sim/trailSystem.test.ts > builds a world in budget",
    ]);
  });

  /**
   * The script loads only the files that hold tagged tests, on one worker, so
   * nothing else runs on the machine while the bars are measured. It names the
   * files, so it must name exactly the ones the tag is on.
   */
  it("test:wall-clock runs exactly the files that hold wall-clock tests", () => {
    const pkg = JSON.parse(readFileSync(fileURLToPath(new URL("../../package.json", import.meta.url)), "utf8")) as { scripts: Record<string, string> };
    const script = pkg.scripts["test:wall-clock"] ?? "";
    const named = [...script.matchAll(/\btest\/\S+\.test\.ts\b/g)].map((m) => m[0].slice("test/".length)).sort();
    const holding = [...new Set(report.tagged.map((key) => key.split(" > ")[0] ?? ""))].sort();
    expect(named).toEqual(holding);
    expect(script).toMatch(/--maxWorkers=1\b/);
    expect(script).toMatch(/--tags-filter=wall-clock\b/);
  });
});
