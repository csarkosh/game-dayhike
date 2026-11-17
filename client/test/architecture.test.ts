import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, existsSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { limitOffenders, scanTestSource, wallClockOffenders, type ScannedFile } from "./helpers/testCalls.js";

// Resolve against this file, never process.cwd(). Vitest is launched from the
// repo root with `--root client`, so cwd is the repo root: a relative "src/sim"
// silently points at nothing and every check below passes vacuously forever.
const SRC = fileURLToPath(new URL("../src", import.meta.url));
const TESTS = fileURLToPath(new URL(".", import.meta.url));

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

  it("keeps the scene player pure of Babylon but its stage, and out of the sim's writes", () => {
    const dir = join(SRC, "game/scene");
    for (const pure of ["timeline.ts", "shots.ts", "roadPath.ts", "sceneClock.ts", "intro.ts", "scenePlayer.ts", "routeWorld.ts", "cord.ts", "cordTubeGeometry.ts", "actorPose.ts", "stageParts.ts"]) {
      expect(readFileSync(join(dir, pure), "utf8"), pure).not.toMatch(/from "@babylonjs/);
    }
    // The route's world is made in one place, with no local player, and is only ever read: by the route on Babylon.js and by the one on Babylon Lite.
    const world = readFileSync(join(dir, "routeWorld.ts"), "utf8");
    expect(world).toContain("createWorld(level, seed, false)");
    expect(world).not.toMatch(/world\.(step|apply|input)/);
    const route = readFileSync(join(dir, "sceneRoute.ts"), "utf8");
    expect(route).toContain("= routeWorld(name);");
    expect(route).toContain("renderer.sync(world.state, -1, 0)");
    expect(route).not.toMatch(/world\.(step|apply|input)/);
    const lite = readFileSync(join(SRC, "game/lite/sceneRoute.ts"), "utf8");
    expect(lite).toContain("const route = routeWorld(name);");
    expect(lite).toContain("renderer.sync(world.state, -1, 0)");
    expect(lite).not.toMatch(/world\.(step|apply|input)/);
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

  it("keeps the hike and the page clear of Babylon: app.ts and main.ts import nothing of it, and reach what draws the world only through the game", () => {
    for (const top of ["app.ts", "main.ts"]) {
      const file = join(SRC, top);
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

  it("reaches the WebGPU engine from main.ts only through a dynamic import", () => {
    const staticImports = (file: string): string[] =>
      [...readFileSync(file, "utf8").matchAll(/^\s*import\s+(?!type\s)(?:[^"'();]*?\s+from\s+)?["']([^"']+)["']/gm)].map((m) => m[1] as string);
    const seen = new Set<string>();
    const stack = [join(SRC, "main.ts")];
    const bad: string[] = [];
    while (stack.length > 0) {
      const file = stack.pop() as string;
      if (seen.has(file)) continue;
      seen.add(file);
      for (const spec of staticImports(file)) {
        if (/^@babylonjs\/core\/Engines\/(?:webgpuEngine|WebGPU\/)/.test(spec)) bad.push(`${file} imports ${spec}`);
        if (spec.startsWith(".") && spec.endsWith(".js")) stack.push(join(file, "..", spec.replace(/\.js$/, ".ts")));
      }
    }
    expect(seen.size).toBeGreaterThan(20);
    expect(bad).toEqual([]);
  });

  it("loads the WebGPU engine's extensions with the engine, and only there", () => {
    // The dynamic texture the fingerposts paint, the compute and multi-render
    // paths: the WebGPU engine's own versions, which no WebGL2 import reaches.
    // In `gpuEngine.ts`, so the dynamic chunk carries them; the static-graph
    // test above keeps them out of the page's first load.
    expect(readFileSync(join(SRC, "game/gpuEngine.ts"), "utf8")).toContain(
      'import "@babylonjs/core/Engines/WebGPU/Extensions/index.js";',
    );
  });

  it("never turns WebGPU's uniformity analysis off for every shader", () => {
    // The terrain's material turns it off for itself (`TERRAIN_UNIFORMITY_OFF`); replacing
    // the engine's stage-descriptor method would hide every other shader's
    // uniformity fault too. The shader lookup calls it, with WGSL already
    // translated (each stage's switch read as Babylon reads it), and nothing
    // replaces it.
    const found = sourceFiles(SRC).filter((f) => readFileSync(f, "utf8").includes("_createPipelineStageDescriptor"));
    expect(found.map((f) => relative(SRC, f))).toEqual(["game/shaderLookup.ts"]);
    const lookup = readFileSync(join(SRC, "game/shaderLookup.ts"), "utf8");
    expect(lookup).not.toMatch(/_createPipelineStageDescriptor\s*=[^=]/);
    expect([...lookup.matchAll(/own\._createPipelineStageDescriptor\(([^)]*)\)/g)].map((m) => m[1])).toEqual([
      "vertexStage.wgsl, fragmentStage.wgsl, WGSL, false, false",
    ]);
  });

  it("keeps `forgetTranslators` for tests: nothing in src/ but its definition names it", () => {
    // A page keeps its started translators for its life (`loadTranslators`);
    // dropping them is only for tests, which start them afresh each time.
    const named = sourceFiles(SRC).flatMap((file) =>
      [...stripComments(readFileSync(file, "utf8")).matchAll(/\bforgetTranslators\b/g)].map(() => relative(SRC, file)),
    );
    expect(named).toEqual(["game/gpuEngine.ts"]);
    expect(readFileSync(join(SRC, "game/gpuEngine.ts"), "utf8")).toContain("export function forgetTranslators(): void {");
  });

  it("keeps the engine choice out of sim/ and net/", () => {
    const named = [/engineChoice/, /gpuEngine/, /webgpuVertexBuffer/];
    expect(violations(join(SRC, "sim"), named)).toEqual([]);
    expect(violations(join(SRC, "net"), named)).toEqual([]);
  });

  it("defines each helper the tier and engine code share once: the tier override, the browser's version, the storage accessors", () => {
    const definitions = (name: string): string[] =>
      sourceFiles(SRC).flatMap((file) =>
        [...stripComments(readFileSync(file, "utf8")).matchAll(new RegExp(`\\bfunction ${name}\\(`, "g"))].map(() => relative(SRC, file)),
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
        [...stripComments(readFileSync(file, "utf8")).matchAll(pattern)].map((m) => `${relative(SRC, file)}: ${m[0]}`),
      );
    expect(calls(/location\.replace\(/g)).toEqual([]);
    expect(calls(/.*location\.reload\(.*/g)).toEqual(["app.ts:     onReload: () => location.reload(),"]);
  });

  it("asks for a WebGPU adapter in one place, the GPU's signals, and never through Babylon's support check", () => {
    const naming = (pattern: RegExp): string[] =>
      sourceFiles(SRC).flatMap((file) =>
        [...stripComments(readFileSync(file, "utf8")).matchAll(pattern)].map(() => relative(SRC, file)),
      );
    expect(naming(/\.requestAdapter\(/g)).toEqual(["game/gpuSignals.ts"]);
    expect(naming(/\bIsSupportedAsync\b/g)).toEqual([]);
  });

  it("starts a hike through one chain: one render token, the tier decided before the engine, one catch", () => {
    const main = stripComments(readFileSync(join(SRC, "main.ts"), "utf8"));
    expect([...main.matchAll(/\blet renderToken\b/g)].length).toBe(1);
    // The tier comes from the start's decision (`startupTier`), never from
    // the older rule, and the engine from the tier decided.
    expect(main).not.toContain("detectTier");
    expect([...main.matchAll(/\bstartHike</g)].length).toBe(1);
    // A hike's canvas carries no engine: its renderer makes its own from it, at the start and for every switch after.
    expect(main).toContain("    engine: () => hikeCanvas(),");
    expect(main).toContain("launch(container, onCanvas, route.token, decided, () => hikeCanvas(), intro, takeSampled);");
    // The scene route is drawn by the same renderer, on a canvas of the same kind: the one other caller.
    expect(main).toContain("    void hikeCanvas().then(");
    expect(main).toContain("runLiteSceneRoute({ canvas, container, tier }, parseSceneSearch(location.search), route.name);");
    expect([...main.matchAll(/\bhikeCanvas\(/g)].length).toBe(4);
    // Nothing of the start hangs off a promise outside the chain's catch.
    expect(main).not.toMatch(/makeWebGpu\([^)]*\)\.then\(/);
  });

  it("wires the failure answer to the engine that failed and the renderer that runs, and the game to the start's recorder", () => {
    // What `engineFailure.test.ts` cannot see: the page's side of it.
    const app = stripComments(readFileSync(join(SRC, "app.ts"), "utf8"));
    // The watcher reports the engine it watches, captured when it is put on.
    expect(app).toContain("      const engine = r.engine;\n      stopWatching = detector(engine, (reason) => void answerFailure(engine, reason));");
    // The answer compares it with the engine the running renderer draws with.
    expect(app).toContain("    running: () => renderer.engine,");
    expect(app).toContain('    runningOnWebGpu: () => renderer.engineName === "webgpu",');
    // The game records every WebGPU failure through the recorder
    // `startOnEngine` hands its start, which tells the start's from the hike's.
    const main = stripComments(readFileSync(join(SRC, "main.ts"), "utf8"));
    expect(main).toContain("    start: ({ canvas, engine, watchers }, record) =>");
    expect([...main.matchAll(/engineFailed: record,/g)].length).toBe(1);
    expect(main).not.toMatch(/\bstarting\b/);
  });

  it("decides the tier at launch only: with the governor off the hike makes none, feeds none, times no idle frames and acts on no drop", () => {
    // What `governor.test.ts` cannot see: the page's side of the switch.
    const app = stripComments(readFileSync(join(SRC, "app.ts"), "utf8"));
    const body = (from: string): string => app.slice(app.indexOf(from), app.indexOf("\n  }\n", app.indexOf(from)));
    // The one governor a hike has comes from `governHike`, null while
    // `GOVERNOR_ENABLED` is off; none is made any other way.
    expect([...app.matchAll(/\bgovernHike\(/g)].length).toBe(1);
    expect(app).toContain("  const governor = governHike(performance.now(), () => void lowerTier());");
    expect(app).not.toMatch(/\bcreateGovernor\(/);
    // Without one, a frame feeds nothing, no compile is marked for it, and no
    // drop is decided, covered, timed, recorded or switched to.
    expect(body("  function feedGovernor(")).toMatch(/^ {2}function feedGovernor\(dt: number\): void \{\n {4}if \(governor === null\) return;\n/);
    expect(body("  function watchCompiles(")).toMatch(/^ {2}function watchCompiles\(r: Renderer\): void \{\n {4}unwatchCompiles\?\.\(\);\s+if \(governor === null\) return;\n/);
    expect(body("  async function lowerTier(")).toMatch(/^ {2}async function lowerTier\(\): Promise<void> \{\n {4}if \(governor === null\) return;\n/);
    // The idle frames are timed, and a drop recorded, only inside `lowerTier`.
    expect([...app.matchAll(/\btimeIdleCadence\(/g)].length).toBe(1);
    expect(body("  async function lowerTier(")).toContain("timeIdleCadence(");
    expect([...app.matchAll(/\bonGovernorDrop\(/g)].length).toBe(2);
    expect(body("  async function lowerTier(")).toContain("options.onGovernorDrop(running)");
    // Every other use of it is a no-op without one.
    expect(app).not.toMatch(/\bgovernor\.(restart|stop)\(/);
  });

  it("shows one line after a failure rebuild: the swap itself shows none, a switch its engine's, the answer its own", () => {
    const app = stripComments(readFileSync(join(SRC, "app.ts"), "utf8"));
    const body = (from: string, to: string): string => app.slice(app.indexOf(from), app.indexOf(to, app.indexOf(from)));
    // `switchNow` is the swap both paths run: it shows no line.
    expect(body("  async function switchNow(", "\n  }\n")).not.toContain("hud.flash");
    expect(body("  async function switchNow(", "\n  }\n")).not.toContain("flashEngineNotice");
    // A switch (Apply, the governor) shows the line of an engine that could
    // not build its tier…
    expect(body("  function switchTo(", "\n  }\n")).toContain("flashEngineNotice");
    // …and a failure's rebuild leaves the line to the answer (`answerFailures`).
    expect(app).toContain("    rebuild: (readyMaxMs) => switchNow(tier, tierSource, null, readyMaxMs).then(() => {\n      engineNotice = null;\n    }),");
  });

  it("measures every step of the tier check on the hike's own renderer: the page makes no engine, for a step or for anything", () => {
    const main = stripComments(readFileSync(join(SRC, "main.ts"), "utf8"));
    // The page's deps are the probe's on the hike's own renderer, which makes each step's renderer, canvas and engine
    // and lets them go with the step.
    expect(main).toContain("  const probe = liteProbeDeps(container);");
    expect([...main.matchAll(/\bliteProbeDeps\(/g)].length).toBe(1);
    expect(importsOf(join(SRC, "main.ts"))).toContain("./game/lite/probeScene.js");
    expect(importsOf(join(SRC, "main.ts"))).not.toContain("./game/probeScene.js");
    // No step is handed an engine, and none is measured on WebGL2 in WebGPU's place.
    expect(main).not.toMatch(/\b(?:probeDeps|probeStepEngine|probeStepCanSettle|measureOnRuleEngine)\b/);
    // Nor does the page make an engine any other way: no rule is asked which, and the only canvases it makes are a
    // hike's (`hikeCanvas`) and the one a hike's start takes when it is made again.
    expect(main).not.toMatch(/\b(?:makeWebGpu|engineForTier|resolveWebGpu|chooseEngine|startWebGpu|loadTranslators)\b/);
    expect(main).not.toMatch(/\bengineFor\(/);
    expect(main).not.toContain("gpuEngine");
    expect([...main.matchAll(/document\.createElement\("canvas"\)/g)].length).toBe(2);
    // A verdict is kept for, and looked up under, the one engine a hike is drawn with, at the start and in Settings;
    // and the page says for itself whether a step can be measured: not where the browser offers no WebGPU, or no
    // adapter, which the GPU's signals say of both (`AdapterStatus`).
    expect(main).toContain('function verdictEngineNow(): VerdictEngine {\n  return "webgpu";\n}');
    expect([...main.matchAll(/\bverdictEngineNow\(\)/g)].length).toBe(5);
    expect(main).toContain('  return liteProbeSteps(read.adapterStatus !== "none");');
    expect(main).toContain("engine: verdictEngineNow(), steps: probeSteps(read) }, {");
    expect(main).toContain("engine: verdictEngineNow(), stepSettles: probeSteps(signals).settle });");
  });

  it("starts no engine, so the page has no failed start to record: a step of the tier check that fails is the step's own to end", () => {
    const main = stripComments(readFileSync(join(SRC, "main.ts"), "utf8"));
    // A WebGPU start that failed (the first load's, a switch's, a retry's, a probe step's) was remembered through
    // `recordStartFailure`, which `engineFailure.ts` keeps with its tests: no page has such a start now.
    expect(main).not.toMatch(/\b(?:rememberFailure|recordStartFailure)\b/);
    expect(main).not.toContain("webgpu_start_failed");
    // A step that fails ends with no reading (`lite/probeScene.ts`): nothing of it is recorded against the engine.
    const step = stripComments(readFileSync(join(SRC, "game/lite/probeScene.ts"), "utf8"));
    expect(step).not.toMatch(/\b(?:recordFailure|recordStartFailure|recordEngineFailure|writeFallback)\b/);
    expect(main).not.toMatch(/\b(recordFailure|writeFallback)\(/);
  });

  it("decides once whether the browser can play, with no engine and no request of its own, and starts nothing of a hike where it cannot", () => {
    // The check and the page for those turned away are made with no engine, whatever they import.
    const loaded = (file: string): string[] =>
      [...readFileSync(file, "utf8").matchAll(/^\s*(?:import|export)\s+(?!type\s)(?:[^"'();]*?\s+from\s+)?["']([^"']+)["']/gm)].map((m) => m[1] as string);
    const ENGINE_FREE = ["loadCheck.ts", "turnedAway.ts", "turnedAwayModel.ts", "turnedAwayWords.ts", "gpuSignals.ts"];
    const seen = new Set<string>();
    const stack = ENGINE_FREE.map((name) => join(SRC, "game", name));
    for (const file of stack) expect(existsSync(file), file).toBe(true);
    const bad: string[] = [];
    while (stack.length > 0) {
      const file = stack.pop() as string;
      if (seen.has(file)) continue;
      seen.add(file);
      for (const spec of loaded(file)) {
        if (spec.startsWith("@babylonjs")) bad.push(`${relative(SRC, file)} imports ${spec}`);
        if (spec.startsWith(".") && spec.endsWith(".js")) stack.push(join(file, "..", spec.replace(/\.js$/, ".ts")));
      }
    }
    expect(seen.size).toBeGreaterThan(ENGINE_FREE.length);
    expect(bad).toEqual([]);
    // The verdict reads the answer to the page's one adapter request (the test above holds that there is one):
    // the check itself asks the browser nothing.
    const check = stripComments(readFileSync(join(SRC, "game/loadCheck.ts"), "utf8"));
    expect(check).not.toMatch(/\bnavigator\b|requestAdapter|requestDevice|document\b|window\b/);
    expect(loaded(join(SRC, "game/loadCheck.ts"))).toEqual([]);

    const main = stripComments(readFileSync(join(SRC, "main.ts"), "utf8"));
    // One verdict a page: known at once where the browser offers no WebGPU, else settled from the signals, or
    // from the same request's later answer where the signals went on without it; set in that one place after.
    expect(main).toContain("const webgpuOffered = offersWebGpu(navigator as NavigatorLike);\nlet verdict: LoadVerdict | null = loadVerdict(webgpuOffered, null);");
    expect(main).toContain("  const known = loadVerdict(webgpuOffered, read);\n  if (known !== null) settleVerdict(known);");
    expect(main).toContain("  else void signalsRead.adapter.then((later) => settleVerdict(adapterVerdict(later)));");
    expect([...main.matchAll(/\bverdict = /g)].length).toBe(1);
    expect(main).toContain("function settleVerdict(next: LoadVerdict): void {\n  verdict = next;\n  if (next.play) return;");
    // Every route is refused in one place, before anything of it is looked at: the page for those turned away.
    expect(main).toContain(
      "function render(container: HTMLDivElement): void {\n  const route = parseRoute(location.pathname);\n  if (verdict !== null && !verdict.play) {\n    showTurnedAway(container, route, verdict);\n    return;\n  }",
    );
    expect([...main.matchAll(/\brenderTurnedAway\(/g)].length).toBe(1);
    // A hike or a staged scene asked for before the signals are in waits for them, and that wait stands before
    // everything either starts with: the world's worker, the tier check, a follower's film, a canvas.
    const body = main.slice(main.indexOf("function render(container: HTMLDivElement): void {"), main.indexOf("\nfunction launch("));
    const wait = body.indexOf("  if (!isLandingRoute(route) && signals === null) {");
    expect(wait).toBeGreaterThan(0);
    for (const start of ["void hikeCanvas().then(", "runLiteSceneRoute(", "startIntro(src, true)", "startWorldPrep(", "liteProbeDeps(container)", "void startHike<EngineOnCanvas>("]) {
      expect(body.indexOf(start), start).toBeGreaterThan(wait);
      expect(body.lastIndexOf(start), start).toBe(body.indexOf(start));
    }
    // No canvas is made under a verdict of "cannot", for a route or for a hike that was running when it came.
    expect(main).toContain("  if (verdict !== null && !verdict.play) return Promise.reject(");
    // An invitation is joined once the signals are in, and not by a visitor turned away; one who is leaves a
    // lobby joined meanwhile, by the lobby's own leaving.
    expect([...main.matchAll(/\benterLobby\(route\.lobbyId\)/g)].length).toBe(1);
    expect(main).toContain("    void signalsReady.then(() => {\n      if (verdict === null || verdict.play) void enterLobby(route.lobbyId);\n    });");
    expect(main).toContain("  if (joining) abandonAttempt();\n  if (lobby !== null) {\n    lobby.leave();\n    detach();\n  }");
    // The visitor's one row, said in one place.
    expect([...main.matchAll(/"turned_away"/g)].length).toBe(1);
    expect(main).toContain('    telemetry.event("turned_away", next.short === null ? { reason: next.reason } : { reason: next.reason, short: next.short });');
  });

  it("bounds the cover over every switch by what its caller passes: no path picks its own bound", () => {
    // The Settings Apply passes `APPLY_SWAP_READY_MAX_MS` (`pauseMenu.ts`),
    // the governor and a failure's rebuild `GOVERNOR_SWAP_READY_MAX_MS`
    // (`governor.ts`, `engineFailure.ts`); a fallback's rung and a switch
    // that crosses engines are inside `switchNow` and wait on its bound.
    const app = stripComments(readFileSync(join(SRC, "app.ts"), "utf8"));
    expect([...app.matchAll(/(?<!function )\bswitch(?:To|Now)\([^()]*\)/g)].map((m) => m[0])).toEqual([
      "switchTo(target, source, choice, readyMaxMs)",
      "switchNow(target, source, save, readyMaxMs)",
      "switchNow(tier, tierSource, null, readyMaxMs)",
      'switchTo(next, "auto", null, readyMaxMs)',
    ]);
    // The engine's making counts against the bound: the scene waits on what
    // is left of it (`engineWithinBound`).
    expect(app).toContain("const made = await engineWithinBound((wanted) => options.engineFor(target, wanted), readyMaxMs, ");
    expect([...app.matchAll(/\bwhenReady\([^;]*;/g)].map((m) => m[0])).toEqual(["whenReady(made.leftMs);"]);
    // The renderer's wait is its scene's and its forest's layers', bounded by what it is passed alone.
    expect(stripComments(readFileSync(join(SRC, "game/renderer.ts"), "utf8"))).toContain(
      "    whenReady(maxMs) {\n      return whenSceneReady(scene, maxMs, renderer.forestReady);\n    },",
    );
    expect(app).not.toMatch(/SWAP_READY_MAX_MS/);
  });

  it("loads nothing with the WebGPU engine that registers what the WebGL2 path does not, but the engine's own", () => {
    // A module that registers something on load (a getter on a texture, a
    // fallback image, an audio engine) changes what every engine of the page
    // does once the WebGPU chunk has loaded. The spherical harmonics registered
    // by the non-pure PBR module lit WebGPU's frame 1.23 times brighter.
    const NODE_MODULES = fileURLToPath(new URL("../../node_modules", import.meta.url));
    const runtimeImports = (file: string): string[] =>
      [...readFileSync(file, "utf8").matchAll(/^\s*(?:import|export)\s+(?!type\s)(?:[^"'();]*?\s+from\s+)?["']([^"'?]+)["']/gm)].map((m) => m[1] as string);
    const resolveIn = (from: string, spec: string): string | null => {
      // Babylon Lite is a library of its own, imported whole by its package's name: it holds no
      // module of Babylon.js and registers nothing on Babylon.js's classes.
      if (spec === "@babylonjs/lite") return null;
      if (spec.startsWith("@babylonjs/")) return join(NODE_MODULES, spec);
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
    const webgl2 = graph(join(SRC, "main.ts"));
    const webgpu = [...graph(join(SRC, "game/gpuEngine.ts"))].filter((f) => f.includes("@babylonjs") && !webgl2.has(f));
    // What registers on load, at the top level of a module: a call such as
    // `RegisterTools();`, a bare import, a class registered by name, a
    // prototype assigned to, or a property defined.
    const REGISTRATIONS = [
      /^[A-Z][A-Za-z]*\(\);$/m,
      /^import\s+["'][^"']+["'];$/m,
      /^RegisterClass\(/m,
      /^[A-Za-z_$][\w$.]*\.prototype\.[\w$]+\s*=[^=]/m,
      /^Object\.defineProperty\(/m,
    ];
    const registers = (text: string): boolean => REGISTRATIONS.some((pattern) => pattern.test(text));
    // The shapes a later Babylon might write a registration in, each caught.
    expect(
      [
        "RegisterTools();",
        'import "./engine.alpha.js";',
        'RegisterClass("BABYLON.PBRMaterial", PBRMaterial);',
        "ThinEngine.prototype.createDynamicTexture = function () {};",
        'Object.defineProperty(BaseTexture.prototype, "sphericalPolynomial", {',
        "    Engine.prototype.inside = function () {};",
        'import { Engine } from "./engine.js";',
      ].map(registers),
    ).toEqual([true, true, true, true, true, false, false]);
    const registering = webgpu
      .filter((f) => registers(readFileSync(f, "utf8")))
      .map((f) => f.slice(f.indexOf("@babylonjs/core/") + "@babylonjs/core/".length))
      .sort();
    expect(registering).toEqual([
      // A vertex buffer's realignment, which only an engine asking for
      // 4-byte-aligned strides and offsets (WebGPU's) calls.
      "Buffers/buffer.align.js",
      // The WebGPU engine's own extensions: methods on its prototype, which no
      // WebGL2 engine has.
      "Engines/WebGPU/Extensions/engine.alpha.js",
      "Engines/WebGPU/Extensions/engine.computeShader.js",
      "Engines/WebGPU/Extensions/engine.cubeTexture.js",
      "Engines/WebGPU/Extensions/engine.debugging.js",
      "Engines/WebGPU/Extensions/engine.dynamicTexture.js",
      "Engines/WebGPU/Extensions/engine.multiRender.js",
      "Engines/WebGPU/Extensions/engine.query.js",
      "Engines/WebGPU/Extensions/engine.rawTexture.js",
      "Engines/WebGPU/Extensions/engine.readTexture.js",
      "Engines/WebGPU/Extensions/engine.renderTarget.js",
      "Engines/WebGPU/Extensions/engine.renderTargetCube.js",
      "Engines/WebGPU/Extensions/engine.renderTargetTexture.js",
      "Engines/WebGPU/Extensions/engine.videoTexture.js",
      "Engines/WebGPU/Extensions/index.js",
    ]);
    // And the game's own WebGPU module takes every Babylon class it names from
    // the pure form of its module, where there is one (a bare import is a
    // registration, held by the list above).
    const own = [...readFileSync(join(SRC, "game/gpuEngine.ts"), "utf8").matchAll(/^import\s+(?!type\s)[^"';]+\s+from\s+["']([^"'?]+)["']/gm)]
      .map((m) => m[1] as string)
      .filter((spec) => spec.startsWith("@babylonjs/"));
    const impure = own.filter((spec) => spec.endsWith(".js") && !spec.endsWith(".pure.js") && existsSync(join(NODE_MODULES, spec.replace(/\.js$/, ".pure.js"))));
    expect(impure).toEqual([]);
  });

  it("keeps the quality modules out of sim/ and net/", () => {
    const quality = /game\/(quality|gpuSignals|gpuClass|tierChoice|frameProbe|governor|rendererSwap|settings)(\.js)?$/;
    expect(violations(join(SRC, "sim"), [quality])).toEqual([]);
    expect(violations(join(SRC, "net"), [quality])).toEqual([]);
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
      join(SRC, "game", "engineChoice.ts"),
      join(SRC, "game", "terrainSurface.ts"),
      join(SRC, "game", "waterGround.ts"),
      join(SRC, "game", "panoramaTurn.ts"),
      join(SRC, "game", "mirrorGround.ts"),
      join(SRC, "game", "firstBuilds.ts"),
      join(SRC, "game", "filmHead.ts"),
      join(SRC, "game", "atmosphereParams.ts"),
      join(SRC, "game", "cloudParams.ts"),
      join(SRC, "game", "clipmap.ts"),
      join(SRC, "game", "facePatches.ts"),
      join(SRC, "game", "roadPaint.ts"),
      join(SRC, "game", "trailPaint.ts"),
      join(SRC, "game", "water.ts"),
      join(SRC, "game", "forestField.ts"),
      join(SRC, "game", "mistField.ts"),
      join(SRC, "game", "mistBanks.ts"),
      join(SRC, "game", "weather.ts"),
      join(SRC, "game", "skinParams.ts"),
      join(SRC, "game", "viewBob.ts"),
      join(SRC, "game", "gradeParams.ts"),
      join(SRC, "game", "groundHexParams.ts"),
      join(SRC, "game", "trailBenchParams.ts"),
      join(SRC, "game", "postParams.ts"),
      join(SRC, "game", "windParams.ts"),
      join(SRC, "game", "motesParams.ts"),
      join(SRC, "game", "moteField.ts"),
      join(SRC, "game", "rainField.ts"),
      join(SRC, "game", "splashField.ts"),
      join(SRC, "game", "rainCover.ts"),
      join(SRC, "game", "lensCanopy.ts"),
      join(SRC, "game", "lampParams.ts"),
      join(SRC, "game", "forestLookParams.ts"),
      join(SRC, "game", "barkParams.ts"),
      join(SRC, "game", "coverAlbedoParams.ts"),
      join(SRC, "game", "mossParams.ts"),
      join(SRC, "game", "passages.ts"),
      join(SRC, "game", "escalation.ts"),
      join(SRC, "game", "stareLens.ts"),
      join(SRC, "game", "woodsVoice.ts"),
      join(SRC, "game", "woodsSounds.ts"),
      join(SRC, "game", "oddSounds.ts"),
      join(SRC, "game", "stareAudio.ts"),
      join(SRC, "game", "bladeClump.ts"),
      join(SRC, "game", "bladeField.ts"),
      join(SRC, "game", "rockRelief.ts"),
      join(SRC, "game", "gpuSignals.ts"),
      join(SRC, "game", "gpuClass.ts"),
      join(SRC, "game", "tierChoice.ts"),
      join(SRC, "game", "frameProbe.ts"),
      join(SRC, "game", "probePage.ts"),
      join(SRC, "game", "probeScreen.ts"),
      join(SRC, "game", "gpuTimeReport.ts"),
      join(SRC, "game", "settings.ts"),
      join(SRC, "game", "governor.ts"),
      join(SRC, "game", "rainParams.ts"),
      join(SRC, "game", "lensParams.ts"),
      join(SRC, "game", "shadeVeilParams.ts"),
      join(SRC, "game", "oceanLoopBake.ts"),
      join(SRC, "game", "oceanLoop.worker.ts"),
      join(SRC, "game", "oceanWindSea.ts"),
      join(SRC, "game", "oceanWaves.ts"),
      join(SRC, "game", "oceanTables.ts"),
      join(SRC, "game", "oceanSwell.ts"),
      join(SRC, "game", "oceanPhysics.ts"),
      join(SRC, "game", "oceanSpectrum.ts"),
      join(SRC, "game", "oceanFft.ts"),
      join(SRC, "game", "skyModel.ts"),
      join(SRC, "game", "skyTable.ts"),
      join(SRC, "game", "sky.worker.ts"),
      join(SRC, "game", "skyWorker.ts"),
      join(SRC, "game", "world.worker.ts"),
      join(SRC, "game", "worldPrep.ts"),
      join(SRC, "game", "preparedScene.ts"),
      join(SRC, "game", "lakeSurfaceGrid.ts"),
      join(SRC, "game", "waterPlantField.ts"),
      join(SRC, "game", "waterBump.ts"),
      join(SRC, "game", "featureTable.ts"),
      join(SRC, "game", "extrasLater.ts"),
      join(SRC, "game", "impostorField.ts"),
      join(SRC, "game", "impostorField.worker.ts"),
      join(SRC, "game", "impostorFieldWorker.ts"),
      join(SRC, "game", "skyState.ts"),
      join(SRC, "game", "skyDomeParams.ts"),
      join(SRC, "game", "skyProbeParams.ts"),
      join(SRC, "game", "halfFloat.ts"),
      join(SRC, "game", "waterLifeParams.ts"),
      join(SRC, "game", "waterLifeField.ts"),
      join(SRC, "game", "midgeMotion.ts"),
      join(SRC, "game", "dragonflyBehaviour.ts"),
      join(SRC, "game", "frogChorus.ts"),
      join(SRC, "game", "lakeCalm.ts"),
      join(SRC, "game", "mirrorView.ts"),
      join(SRC, "game", "lakeSkyline.ts"),
      join(SRC, "game", "lakeRipples.ts"),
      join(SRC, "game", "swashRunUp.ts"),
      join(SRC, "game", "swashTable.ts"),
      join(SRC, "game", "oceanBreaker.ts"),
      join(SRC, "game", "surfSound.ts"),
      join(SRC, "game", "shoreAtlas.ts"),
      join(SRC, "game", "lakeChoice.ts"),
      join(SRC, "game", "carAudio.ts"),
      join(SRC, "game", "terrainTables.ts"),
      join(SRC, "game", "terrainUniforms.ts"),
      join(SRC, "game", "groundLayers.ts"),
      join(SRC, "game", "wetSurface.ts"),
      join(SRC, "game", "terrainVertices.ts"),
      join(SRC, "game", "sceneLights.ts"),
      join(SRC, "game", "gameLens.ts"),
      join(SRC, "game", "skyWait.ts"),
      join(SRC, "game", "listenerPose.ts"),
      join(SRC, "game", "characterAssets.ts"),
      join(SRC, "game", "hollowLook.ts"),
      join(SRC, "game", "entityPoses.ts"),
      join(SRC, "game", "droppedCap.ts"),
      join(SRC, "game", "creatureAssets.ts"),
      join(SRC, "game", "wingParams.ts"),
      join(SRC, "game", "wildlifeScene.ts"),
      join(SRC, "game", "skinInstances.ts"),
      join(SRC, "game", "wildlifeInputs.ts"),
      join(SRC, "game", "waterSurface.ts"),
      join(SRC, "game", "bedFollow.ts"),
      join(SRC, "game", "lakeCalmFrame.ts"),
      join(SRC, "game", "lakeSeen.ts"),
      join(SRC, "game", "waterPlantShapes.ts"),
      join(SRC, "game", "waterLifeScene.ts"),
      join(SRC, "game", "waterLifeInputs.ts"),
      join(SRC, "game", "midgeLook.ts"),
      join(SRC, "game", "dragonflyShapes.ts"),
      join(SRC, "game", "oceanFrame.ts"),
      join(SRC, "game", "seaEdge.ts"),
      join(SRC, "game", "oceanFftPasses.ts"),
      join(SRC, "game", "windSeaField.ts"),
      join(SRC, "game", "lipStrip.ts"),
      join(SRC, "game", "sprayField.ts"),
      join(SRC, "game", "seaLattice.ts"),
      join(SRC, "game", "seaUniforms.ts"),
      join(SRC, "game", "postFrame.ts"),
      join(SRC, "game", "materialGrade.ts"),
      join(SRC, "game", "shadeMaskParams.ts"),
      join(SRC, "game", "signParts.ts"),
      join(SRC, "game", "sceneryParts.ts"),
      join(SRC, "game", "boardDraw.ts"),
      join(SRC, "game", "scenePlay.ts"),
      join(SRC, "game", "cutscene.ts"),
      join(SRC, "game", "ending.ts"),
      join(SRC, "game", "endScene.ts"),
      join(SRC, "game", "carParts.ts"),
      join(SRC, "game", "loadReport.ts"),
      join(SRC, "game", "scene", "routeWorld.ts"),
      join(SRC, "game", "scene", "scenePlayer.ts"),
      join(SRC, "game", "scene", "actorPose.ts"),
      join(SRC, "game", "scene", "stageParts.ts"),
      join(SRC, "game", "scene", "cordTubeGeometry.ts"),
      join(SRC, "game", "scene", "cord.ts"),
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
    const stack = ENGINE_FREE.map((name) => join(SRC, "game", name));
    for (const file of stack) expect(existsSync(file), file).toBe(true);
    const bad: string[] = [];
    while (stack.length > 0) {
      const file = stack.pop() as string;
      if (seen.has(file)) continue;
      seen.add(file);
      for (const spec of loaded(file)) {
        if (spec.startsWith("@babylonjs")) bad.push(`${relative(SRC, file)} imports ${spec}`);
        if (spec.startsWith(".") && spec.endsWith(".js")) stack.push(join(file, "..", spec.replace(/\.js$/, ".ts")));
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
   * what is read of a model's file and baked into its vertices. The shell that draws them on Babylon.js
   * (`forestMeshes.ts`) and its plugins take their values from these.
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
    const stack = ENGINE_FREE.map((name) => join(SRC, "game", name));
    for (const file of stack) expect(existsSync(file), file).toBe(true);
    const bad: string[] = [];
    while (stack.length > 0) {
      const file = stack.pop() as string;
      if (seen.has(file)) continue;
      seen.add(file);
      for (const spec of loaded(file)) {
        if (spec.startsWith("@babylonjs")) bad.push(`${relative(SRC, file)} imports ${spec}`);
        if (spec.startsWith(".") && spec.endsWith(".js")) stack.push(join(file, "..", spec.replace(/\.js$/, ".ts")));
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
   * built in code, and a prop's box and colour. The shells that draw them on Babylon.js
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
    const stack = ENGINE_FREE.map((name) => join(SRC, "game", name));
    for (const file of stack) expect(existsSync(file), file).toBe(true);
    const bad: string[] = [];
    while (stack.length > 0) {
      const file = stack.pop() as string;
      if (seen.has(file)) continue;
      seen.add(file);
      for (const spec of loaded(file)) {
        if (spec.startsWith("@babylonjs")) bad.push(`${relative(SRC, file)} imports ${spec}`);
        if (spec.startsWith(".") && spec.endsWith(".js")) stack.push(join(file, "..", spec.replace(/\.js$/, ".ts")));
      }
    }
    expect(seen.size).toBeGreaterThan(ENGINE_FREE.length);
    expect(bad).toEqual([]);
  });

  /**
   * What the hikers, the Hollows, the dropped cap and the animals are drawn
   * with, for a renderer that is not Babylon.js to draw them by: where each
   * body stands and how (the poses), which file and which clip it is, a
   * lamp's state, the cap's place and shape, and the wildlife a frame at a
   * time with its field, its behaviour and its director. The shells that
   * draw them on Babylon.js take their values from these.
   */
  it("what the hikers, the Hollows, the cap and the animals are drawn with is computed without loading Babylon, whatever it imports", () => {
    const ENGINE_FREE = [
      "characterAssets.ts", "entityPoses.ts", "hollowLook.ts", "lampParams.ts", "skinParams.ts", "droppedCap.ts", "creatureAssets.ts", "wingParams.ts",
      "wildlifeScene.ts", "wildlifeField.ts", "wildlifeBehaviour.ts", "wildlifeDirector.ts", "groundTilt.ts", "skinInstances.ts", "wildlifeInputs.ts",
    ];
    const loaded = (file: string): string[] =>
      [...readFileSync(file, "utf8").matchAll(/^\s*(?:import|export)\s+(?!type\s)(?:[^"'();]*?\s+from\s+)?["']([^"']+)["']/gm)].map((m) => m[1] as string);
    const seen = new Set<string>();
    const stack = ENGINE_FREE.map((name) => join(SRC, "game", name));
    for (const file of stack) expect(existsSync(file), file).toBe(true);
    const bad: string[] = [];
    while (stack.length > 0) {
      const file = stack.pop() as string;
      if (seen.has(file)) continue;
      seen.add(file);
      for (const spec of loaded(file)) {
        if (spec.startsWith("@babylonjs")) bad.push(`${relative(SRC, file)} imports ${spec}`);
        if (spec.startsWith(".") && spec.endsWith(".js")) stack.push(join(file, "..", spec.replace(/\.js$/, ".ts")));
      }
    }
    expect(seen.size).toBeGreaterThan(ENGINE_FREE.length);
    expect(bad).toEqual([]);
  });

  /**
   * What the lakes' water is drawn with, for a renderer that is not
   * Babylon.js to draw it by: a surface's numbers and its uniforms by name,
   * the bed's square following the camera, a lake's calm through the
   * weather's fade, whether a view holds a lake, its surface's grid, its
   * skyline, the ripple bump and the rows it is shaded by; its plants as
   * shapes and lists; and its life a frame at a time, with the midges' and
   * the dragonflies' draws as numbers. The shells that draw them on
   * Babylon.js take their values from these.
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
    const stack = ENGINE_FREE.map((name) => join(SRC, "game", name));
    for (const file of stack) expect(existsSync(file), file).toBe(true);
    const bad: string[] = [];
    while (stack.length > 0) {
      const file = stack.pop() as string;
      if (seen.has(file)) continue;
      seen.add(file);
      for (const spec of loaded(file)) {
        if (spec.startsWith("@babylonjs")) bad.push(`${relative(SRC, file)} imports ${spec}`);
        if (spec.startsWith(".") && spec.endsWith(".js")) stack.push(join(file, "..", spec.replace(/\.js$/, ".ts")));
      }
    }
    expect(seen.size).toBeGreaterThan(ENGINE_FREE.length);
    expect(bad).toEqual([]);
  });

  /**
   * What the sea is drawn with, for a renderer that is not Babylon.js to
   * draw it by: the swell and the wind sea as numbers, the sea following its
   * wind, the wind sea's loop asked of its worker, which field draws the wind sea and the passes of the one that
   * is computed each frame, its edge on the cove with the swash's table and the breaker's
   * tracker, the strips of the plunging lip's curl and the spray's bursts, the rings as one lattice, their samples and the box each has
   * water in, the sea's uniforms by name, and the surf as heard. The shell
   * that draws it on Babylon.js takes its values from these.
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
    const stack = ENGINE_FREE.map((name) => join(SRC, "game", name));
    for (const file of stack) expect(existsSync(file), file).toBe(true);
    const bad: string[] = [];
    while (stack.length > 0) {
      const file = stack.pop() as string;
      if (seen.has(file)) continue;
      seen.add(file);
      for (const spec of loaded(file)) {
        if (spec.startsWith("@babylonjs")) bad.push(`${relative(SRC, file)} imports ${spec}`);
        if (spec.startsWith(".") && spec.endsWith(".js")) stack.push(join(file, "..", spec.replace(/\.js$/, ".ts")));
      }
    }
    expect(seen.size).toBeGreaterThan(ENGINE_FREE.length);
    expect(bad).toEqual([]);
    // And the shells on Babylon.js read them: the sea's numbers, its wind's lag and its edge are made in one place.
    expect(readFileSync(join(SRC, "game/oceanRender.ts"), "utf8")).toContain("createOceanFrame(seed, tier, made)");
    expect(readFileSync(join(SRC, "game/windSeaField.ts"), "utf8")).toContain("createSeaWindLag()");
    expect(readFileSync(join(SRC, "game/oceanWindSource.ts"), "utf8")).toContain("createWindSeaField<BaseTexture>(seed, tier, {");
    expect(readFileSync(join(SRC, "game/renderer.ts"), "utf8")).toContain("createSeaEdgeStep(seed, ocean.field)");
    // The FFT's passes, the curl's strips and the spray's bursts likewise.
    expect(readFileSync(join(SRC, "game/oceanGpuFft.ts"), "utf8")).toContain('from "./oceanFftPasses.js";');
    expect(readFileSync(join(SRC, "game/oceanLip.ts"), "utf8")).toContain("lipReach(cove, level)");
    expect(readFileSync(join(SRC, "game/surfSpray.ts"), "utf8")).toContain("createSprayBursts(plugin.bursts)");
    expect(readFileSync(join(SRC, "game/renderer.ts"), "utf8")).toContain("createSprayThrow(tracker, cove, waterLevel)");
  });

  /**
   * What a scene and an ending are played with, for a renderer that is not
   * Babylon.js to play them by: the summit's shots and the cap's, the death's
   * fall and its closing dark, the end scene's four shots, its car along the
   * road and its lamps, and the state that runs between them from frame to
   * frame (whose camera the frame has, the local body in a shot, who is in
   * the car, where the one lamp is worn). The renderer on Babylon.js steps
   * the same play.
   */
  it("what the scenes and the endings are played with is computed without loading Babylon, whatever it imports", () => {
    const ENGINE_FREE = [
      "scenePlay.ts", "shotBodies.ts", "cutscene.ts", "ending.ts", "endScene.ts", "carAudio.ts", "carParts.ts", "scene/roadPath.ts", "scene/timeline.ts", "scene/shots.ts",
      "scene/routeWorld.ts", "scene/scenePlayer.ts", "scene/actorPose.ts", "scene/stageParts.ts", "scene/cordTubeGeometry.ts", "scene/cord.ts",
    ];
    const loaded = (file: string): string[] =>
      [...readFileSync(file, "utf8").matchAll(/^\s*(?:import|export)\s+(?!type\s)(?:[^"'();]*?\s+from\s+)?["']([^"']+)["']/gm)].map((m) => m[1] as string);
    const seen = new Set<string>();
    const stack = ENGINE_FREE.map((name) => join(SRC, "game", name));
    for (const file of stack) expect(existsSync(file), file).toBe(true);
    const bad: string[] = [];
    while (stack.length > 0) {
      const file = stack.pop() as string;
      if (seen.has(file)) continue;
      seen.add(file);
      for (const spec of loaded(file)) {
        if (spec.startsWith("@babylonjs")) bad.push(`${relative(SRC, file)} imports ${spec}`);
        if (spec.startsWith(".") && spec.endsWith(".js")) stack.push(join(file, "..", spec.replace(/\.js$/, ".ts")));
      }
    }
    expect(seen.size).toBeGreaterThan(ENGINE_FREE.length);
    expect(bad).toEqual([]);
    // And the shells on Babylon.js read them: the scenes' state is kept in one place, and the car's parts are turned by one rule.
    expect(readFileSync(join(SRC, "game/renderer.ts"), "utf8")).toContain("const play = createScenePlay({");
    // On Lite the frame's bodies take up who the scene shows in the frame that says so.
    expect(readFileSync(join(SRC, "game/lite/renderer.ts"), "utf8")).toContain("bodies = bodiesInShot(poses, bodies, now, state, localId, alpha, standing?.entities?.models ?? null);");
    expect(readFileSync(join(SRC, "game/scene/sceneStage.ts"), "utf8")).toContain("wheel.node.rotation.z = wheelSpinTurn(pose);");
    // The handset's grip and the cord's ends, the cord's tube and the route's world likewise.
    expect(readFileSync(join(SRC, "game/scene/sceneStage.ts"), "utf8")).toContain("new Vector3(GRIP_OFFSET[0], GRIP_OFFSET[1], GRIP_OFFSET[2])");
    expect(readFileSync(join(SRC, "game/scene/cordTube.ts"), "utf8")).toContain("radius: CORD_TUBE_RADIUS, tessellation: CORD_TUBE_SIDES");
  });

  /**
   * What stands between a renderer and the page it draws on is the game's
   * own arithmetic too: the frame's size from the canvas's box, the tier's
   * scaling and the render scale under the paint, the watch a renderer
   * keeps on an engine it made for itself, the count of what a device is
   * asked to make of shaders, and the measurement mode's report. Both
   * renderers read the rule that says where the render scale runs.
   */
  it("what a renderer is sized and started by is computed without loading Babylon, whatever it imports", () => {
    const ENGINE_FREE = ["frameSize.ts", "renderScale.ts", "quality.ts", "engineWatch.ts", "deviceMakes.ts", "gpuTimeTasks.ts", "gpuTimeReport.ts", "gpuFaults.ts", "deviceHeld.ts", "lossBound.ts"];
    const loaded = (file: string): string[] =>
      [...readFileSync(file, "utf8").matchAll(/^\s*(?:import|export)\s+(?!type\s)(?:[^"'();]*?\s+from\s+)?["']([^"']+)["']/gm)].map((m) => m[1] as string);
    const seen = new Set<string>();
    const stack = ENGINE_FREE.map((name) => join(SRC, "game", name));
    for (const file of stack) expect(existsSync(file), file).toBe(true);
    const bad: string[] = [];
    while (stack.length > 0) {
      const file = stack.pop() as string;
      if (seen.has(file)) continue;
      seen.add(file);
      for (const spec of loaded(file)) {
        if (spec.startsWith("@babylonjs")) bad.push(`${relative(SRC, file)} imports ${spec}`);
        if (spec.startsWith(".") && spec.endsWith(".js")) stack.push(join(file, "..", spec.replace(/\.js$/, ".ts")));
      }
    }
    expect(seen.size).toBeGreaterThan(ENGINE_FREE.length);
    expect(bad).toEqual([]);
    expect(readFileSync(join(SRC, "game/renderer.ts"), "utf8")).toContain("renderScaleRuns(postFeatures.paint, options.gpuTime === true)");
    const lite = readFileSync(join(SRC, "game/lite/renderer.ts"), "utf8");
    expect(lite).toContain("createFrameFit(tier, renderScaleRuns(postFeatures.paint, options.gpuTime === true), {");
    // The surface is sized by the game's rule alone: Lite's own fit to the display's ratio is not called.
    expect(lite).not.toContain("resizeEngine");
    // A lost device is told to the hike, which builds the renderer again: Lite's recovery in place is not used.
    expect(lite).toContain('engineWatch.fail("lost");');
    expect(lite).toContain("ownWatch: engineWatch.watch,");
    expect(lite).not.toContain("enableDeviceLostSceneRecovery");
    // What the engine tells on Babylon.js is told from the device's own calls, and timed by Lite's own timers.
    expect(lite).toContain("onShaderCompiled: (fn) => makes.onMade(fn),");
    expect(readFileSync(join(SRC, "game/lite/gpuTimeReadout.ts"), "utf8")).toContain("taskTimeReport({");
    // The renderer on Babylon.js is watched by whoever made its engine.
    expect(readFileSync(join(SRC, "game/renderer.ts"), "utf8")).toContain("ownWatch: null,");
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
    const lite = readFileSync(join(SRC, "game/lite/renderer.ts"), "utf8");
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
    const app = stripComments(readFileSync(join(SRC, "app.ts"), "utf8"));
    expect([...app.matchAll(/\bcreateGpuFaults\(/g)].length).toBe(1);
    expect(app).toContain("      faults.attach(r);\n      const engine = r.engine;");
    expect(app).toContain("    loss: () => options.losses.note(),");
    // The loss that is one too many is not answered by another renderer: the hike ends as any hike that cannot go on.
    expect(app).toContain('    ends: (reason) => reason === "lost" && faults.lastLoss?.end === true,');
    expect(app).toContain('      options.losses.ended();\n      endSession(LOSS_ENDED_LINE, { why: "device_lost", losses: loss?.losses ?? 0, recent: loss?.recent ?? 0 });');
    // The page's count is one record for every hike of the page, and the landing's line is the same constant.
    const main = stripComments(readFileSync(join(SRC, "main.ts"), "utf8"));
    expect([...main.matchAll(/\bcreateLossRecord\(/g)].length).toBe(1);
    expect(main).toContain("  note: () => lostDevices.note(performance.now()),");
    expect(main).toContain("  ended: () => void leaveNotice(pageSessionStorage(), LOSS_ENDED_LINE, Date.now()),");
    expect(main).toContain("        engineFailed: record,\n        losses,");
    // The line's words stand in one constant, and the bound's numbers in one module.
    const naming = (pattern: RegExp): string[] =>
      sourceFiles(SRC).flatMap((file) => [...stripComments(readFileSync(file, "utf8")).matchAll(pattern)].map(() => relative(SRC, file)));
    expect(naming(/\bLOSS_ENDED_LINE = /g)).toEqual(["game/lossBound.ts"]);
    expect(naming(/\bLOSS_BOUND_(?:COUNT|WINDOW_MS) = /g)).toEqual(["game/lossBound.ts", "game/lossBound.ts"]);
  });

  /**
   * The hike's renderer is drawn with Babylon Lite, and nothing of it is
   * Babylon.js: not a module under `game/lite/`, and not anything one of
   * them loads. What it shares with the renderer on Babylon.js is the game's
   * own arithmetic, which loads no engine, and types, which load nothing.
   */
  it("draws the hike with Babylon Lite alone: nothing under game/lite/ loads Babylon.js, whatever it imports", () => {
    const loaded = (file: string): string[] =>
      [...readFileSync(file, "utf8").matchAll(/^\s*(?:import|export)\s+(?!type\s)(?:[^"'();]*?\s+from\s+)?["']([^"']+)["']/gm)].map((m) => m[1] as string);
    const own = sourceFiles(join(SRC, "game", "lite"));
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
        if (spec === "@babylonjs/lite") lite.push(relative(SRC, file));
        else if (spec.startsWith("@babylonjs")) bad.push(`${relative(SRC, file)} imports ${spec}`);
        if (spec.startsWith(".") && spec.endsWith(".js")) stack.push(join(file, "..", spec.replace(/\.js$/, ".ts")));
      }
    }
    expect(seen.size).toBeGreaterThan(own.length);
    expect(bad).toEqual([]);
    // Lite itself is loaded only by the modules that draw: the plugins, the pose and the light name its types alone.
    expect(lite.sort()).toEqual([
      "game/lite/bladeMeshes.ts", "game/lite/brushMeshes.ts", "game/lite/capMesh.ts", "game/lite/cliffMeshes.ts", "game/lite/clutterMeshes.ts", "game/lite/dragonflyMeshes.ts", "game/lite/duffMeshes.ts", "game/lite/entityMeshes.ts", "game/lite/forestMeshes.ts", "game/lite/forestModels.ts", "game/lite/gpuTimeReadout.ts", "game/lite/groundTextures.ts", "game/lite/impostorBake.ts",
      "game/lite/lakeMeshes.ts", "game/lite/lakePanorama.ts", "game/lite/lipMeshes.ts", "game/lite/listMeshes.ts", "game/lite/midgeMeshes.ts", "game/lite/mistMeshes.ts", "game/lite/motes.ts", "game/lite/postChain.ts", "game/lite/propMeshes.ts", "game/lite/rain.ts", "game/lite/rainMap.ts", "game/lite/rainSplash.ts", "game/lite/renderer.ts", "game/lite/sceneActor.ts", "game/lite/sceneryMeshes.ts", "game/lite/sceneryModels.ts", "game/lite/sceneryPaint.ts", "game/lite/seaFft.ts", "game/lite/seaMeshes.ts", "game/lite/shadeMask.ts", "game/lite/shadeVeil.ts", "game/lite/shaderUniforms.ts",
      "game/lite/skinnedModels.ts", "game/lite/skyCapture.ts", "game/lite/skyDome.ts", "game/lite/surfSpray.ts", "game/lite/terrainMeshes.ts", "game/lite/waterBed.ts", "game/lite/waterPlantMeshes.ts", "game/lite/wildlifeMeshes.ts", "game/lite/wornLamps.ts",
    ]);
    // And the hike is handed that renderer, which reaches the Babylon.js one's module for its types alone.
    const renderer = readFileSync(join(SRC, "game/renderer.ts"), "utf8");
    expect(renderer).toContain("  return createLiteRenderer(canvas, level, forest, options);");
    expect(loaded(join(SRC, "game/lite/renderer.ts")).filter((spec) => spec === "../renderer.js")).toEqual([]);
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
    const own = sourceFiles(join(SRC, "game", "lite"));
    expect(own.length).toBeGreaterThan(5);
    expect(own.filter((file) => PRIVATE.test(readFileSync(file, "utf8"))).map((file) => relative(SRC, file))).toEqual([]);
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
      if (count > 0) mentions[file.slice(SRC.length + 1).split("\\").join("/")] = count;
    }
    expect(mentions).toEqual({ "app.ts": 2, "game/input.ts": 2, "game/pauseMenu.ts": 2 });
    expect(readFileSync(join(SRC, "app.ts"), "utf8")).toContain("setSuppressed: (on) => input.setSuppressed(on),");
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
    "game/bladeMeshes.test.ts > keeps, at the two gate poses, the cells the widened frustum holds, and pins how many":
      "logs one cull pass's time; asserts only the cell and draw counts",
    "game/clutterMeshes.test.ts > keeps, at the two gate poses, the cards the widened frustum holds, and pins how many":
      "logs one cull pass's time; asserts only the card counts",
    "sim/trailSystem.test.ts > finds the longest way home the graph offers":
      "logs the guide walk's time over the seed set; asserts only the walks themselves",
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
      "game/facePatchMeshes.test.ts > keeps the first update to the near band, and a crossing's frames to the share and a slice",
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
