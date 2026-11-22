import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, existsSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { limitOffenders, scanTestSource, wallClockOffenders, type ScannedFile } from "../testing/testCalls.js";

/**
 * The engine's own rules of layout: what its modules may import, what its pages and shell may name, and the
 * rules its tests keep. The engine imports nothing outside itself and names itself by no package, so every path
 * below is inside this package. Day Hike's own rules of layout are `client/test/architecture.test.ts`'s.
 */

// Resolve against this file, never process.cwd(): a relative path silently points at nothing and every check
// below passes vacuously forever.
const SRC = fileURLToPath(new URL("../src", import.meta.url));
const ENGINE = SRC;
/** The engine's own shipped files and their catalog, beside its source: a part of the engine that its source may name. */
const ENGINE_ASSETS = fileURLToPath(new URL("../assets", import.meta.url));
const ENGINE_PACKAGE = "@csarkosh/engine/";
/** The engine's own tests and their shared helpers. */
const TESTS = fileURLToPath(new URL(".", import.meta.url));
const ENGINE_TESTING = fileURLToPath(new URL("../testing", import.meta.url));

function at(...parts: string[]): string {
  return join(SRC, ...parts);
}

function logical(file: string): string {
  return relative(SRC, file);
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

/** Every module under a folder. */
function sourceFiles(dir: string): string[] {
  return filesUnder(dir);
}

/** Every file of the engine's test folders: `test` and `testing`. */
function testFiles(): string[] {
  return [...filesUnder(TESTS), ...filesUnder(ENGINE_TESTING)];
}

/** A test file's path under the test folder it stands in. */
function testPath(file: string): string {
  const root = [ENGINE_TESTING].find((r) => !relative(r, file).startsWith("..")) ?? TESTS;
  return relative(root, file);
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
        if (!target.startsWith(`${ENGINE}/`) && !target.startsWith(`${ENGINE_ASSETS}/`)) bad.push(`${logical(file)} refers outside the engine: ${spec}`);
      }
    }
    expect(bad).toEqual([]);
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

  it("measures every step of the tier check on the hike's own renderer: the page makes no engine, for a step or for anything: the engine's half", () => {
    const main = stripComments(readFileSync(at("shell.ts"), "utf8"));
    // The page's deps are the probe's on the hike's own renderer, which makes each step's renderer, canvas and engine
    // and lets them go with the step. The page makes them itself, on the game's level and renderer and the empty state
    // the game hands it (`page.probeState`); the game's page names no probe.
    expect(main).toContain("    const probe = liteProbeDeps(container, { level: page.game.level, renderer: page.game.renderer, state: page.probeState });");
    expect([...main.matchAll(/\bliteProbeDeps\(/g)].length).toBe(1);
    expect(importsOf(at("shell.ts"))).toContain("./game/lite/probeScene.js");
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

  it("keeps the hike and the page clear of Babylon: app.ts, shell.ts and main.ts import nothing of it, and reach what draws the world only through the game: the engine's half", () => {
    for (const top of ["app.ts", "shell.ts"]) {
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

  // Guards against the guard: if these directories ever stop resolving, every
  // boundary check silently degrades into a no-op.
  it("can actually see the source tree: the engine's half", () => {
    expect(existsSync(SRC)).toBe(true);
    expect(sourceFiles(SRC).length).toBeGreaterThan(0);
  });

  it("sim/ imports nothing but node builtins and itself: the engine's half", () => {
    expect(violations(at("sim"), [/^@babylonjs/, /net\//, /game\//])).toEqual([]);
  });

  it("sim/ has no external package dependencies at all: the engine's half", () => {
    const external = sourceFiles(at("sim"))
      .flatMap((f) => importsOf(f).map((s) => `${f} imports ${s}`))
      .filter((line) => {
        const spec = line.split(" imports ")[1] ?? "";
        // The engine's own sim is the one package the game's sim builds on.
        return !spec.startsWith(".") && !spec.startsWith("node:") && !spec.startsWith(`${ENGINE_PACKAGE}sim/`);
      });
    expect(external).toEqual([]);
  });

  it("net/ does not import Babylon or game/: the engine's half", () => {
    expect(violations(at("net"), [/^@babylonjs/, /game\//])).toEqual([]);
  });

  it("keeps the quality modules out of sim/ and net/: the engine's half", () => {
    const quality = /game\/(quality|gpuSignals|gpuClass|tierChoice|frameProbe|governor|rendererSwap|settings)(\.js)?$/;
    expect(violations(at("sim"), [quality])).toEqual([]);
    expect(violations(at("net"), [quality])).toEqual([]);
  });

  /**
   * Babylon Lite names what a pass of the hike's own is drawn with
   * (`getGpuDevice`, `getFrameEncoder`, `getRenderTargetAttachments`,
   * `createCustomTask`), so nothing under `game/lite/` reaches into an
   * engine, a render target or a task for a field Lite keeps to itself: such
   * a read breaks without a word when Lite renames the field.
   */
  it("reads none of Babylon Lite's private fields under game/lite/: the device, the frame's encoder, a target's attachments, a task's passes: the engine's half", () => {
    const PRIVATE = /\b_(?:device|currentEncoder|colorView|colorTexture|depthView|depthTexture|passes|width|height)\b/;
    const own = sourceFiles(at("game", "lite"));
    expect(own.length).toBeGreaterThan(5);
    expect(own.filter((file) => PRIVATE.test(readFileSync(file, "utf8"))).map((file) => logical(file))).toEqual([]);
  });

  /**
   * Banned for the same reason Math.pow is: ES Number::exponentiate is
   * implementation-approximated, so two engines could raise the same base
   * to the same power and disagree in the last bit — which in sim/ means
   * two peers generating different worlds from one seed, with nothing on
   * the wire to correct it. Repeated multiplication is exact and is what
   * `montane.ts` uses to raise uplift to a power.
   */
  it("sim/ uses no exponentiation operator: the engine's half", () => {
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

  it("has no rifle left in src/: no Fire or Reload button: the engine's half", () => {
    const offenders: string[] = [];
    for (const file of sourceFiles(SRC)) {
      const src = stripComments(readFileSync(file, "utf8"));
      if (/Button\.(Fire|Reload)\b/.test(src)) offenders.push(`${file} uses Button.Fire/Reload`);
      if (/sim\/combat\.js/.test(src)) offenders.push(`${file} imports sim/combat.js`);
    }
    expect(offenders).toEqual([]);
    expect(existsSync(at("sim", "combat.ts"))).toBe(false);
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
  it("names no Babylon.js: no file of src/ or test/ imports a package under @babylonjs/ but Babylon Lite, and the record of what it gave is read with none: the engine's half", () => {
    const everyImport = (file: string): string[] => {
      const asked = [...stripComments(readFileSync(file, "utf8")).matchAll(/\bimport\(\s*["']([^"']+)["']\s*\)/g)].map((m) => m[1] as string);
      return [...new Set([...importsOf(file), ...asked])];
    };
    // A package's name or a path into it: what an import can ask for (this file's own rules spell the family in
    // patterns, which are no imports).
    const ofBabylon = (spec: string): boolean => /^@babylonjs\/[\w.@/-]+$/.test(spec) && spec !== "@babylonjs/lite";
    expect(["@babylonjs/core", "@babylonjs/core/Engines/engine.js", "@babylonjs/loaders/glTF/index.js", "@babylonjs/lite"].map(ofBabylon)).toEqual([true, true, true, false]);
    const files = [...sourceFiles(SRC), ...testFiles()];
    const named: string[] = [];
    let lite = 0;
    for (const file of files) {
      const specs = everyImport(file);
      if (specs.includes("@babylonjs/lite")) lite++;
      for (const spec of specs) if (ofBabylon(spec)) named.push(`${relative(at(".."), file)} names ${spec}`);
    }
    // Guards against the guard: the walk reads the whole of src/ and test/ and finds the library where it is named.
    expect(sourceFiles(SRC).length).toBeGreaterThan(300);
    expect(testFiles().length).toBeGreaterThan(150);
    expect(lite).toBeGreaterThan(40);
    expect(named).toEqual([]);
    // Nor is such a package spelt in src/ outside an import: a path into it, a `require`, a URL.
    const spelt = sourceFiles(SRC)
      .filter((file) => /@babylonjs\/(?!lite\b)/.test(stripComments(readFileSync(file, "utf8"))))
      .map((file) => logical(file));
    expect(spelt).toEqual([]);
    // And the swap loads only the identity (for its line's word), and the renderer's types load nothing at all.
    const loaded = (file: string): string[] =>
      [...readFileSync(file, "utf8").matchAll(/^\s*(?:import|export)\s+(?!type\s)(?:[^"'();]*?\s+from\s+)?["']([^"']+)["']/gm)].map((m) => m[1] as string);
    expect(loaded(at("game/rendererSwap.ts"))).toEqual(["../identity.js"]);
    // The identity it reads is a record and two functions, and loads nothing itself: so the swap still reaches no module but that one.
    expect(loaded(at("identity.ts"))).toEqual([]);
    expect(importsOf(at("identity.ts"))).toEqual([]);
    expect(loaded(at("game/rendererTypes.ts"))).toEqual([]);
  });
});

function scannedTestFiles(): ScannedFile[] {
  return testFiles()
    .filter((f) => f.endsWith(".test.ts"))
    .map((f) => ({ file: testPath(f), scan: scanTestSource(f, readFileSync(f, "utf8")) }));
}

describe("test time limits", () => {
  const files = scannedTestFiles();

  // Guards against the guard: a scan that finds no test files or no limits
  // would pass the rule below vacuously.
  it("can see the test files and the limits in them: the engine's half", () => {
    expect(files.length).toBeGreaterThan(100);
    const scaled = files.flatMap(({ scan }) => scan.calls.flatMap((c) => c.limits)).filter((l) => l.kind === "scaled");
    expect(scaled.length).toBeGreaterThan(30);
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
  it("sends every explicit test, suite, hook and wait limit through timeLimit: the engine's half", () => {
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

  it("tags exactly the tests that assert on a clock, and lists the ones that only print one: the engine's half", () => {
    expect(report.offenders).toEqual([]);
  });

  it("tags exactly these tests wall-clock: adding or removing one is a deliberate edit here: the engine's half", () => {
    expect(
      [...report.tagged].sort(),
      "the wall-clock tests changed: if that is meant, update this list and the files test:wall-clock names; if not, remove the tag",
    ).toEqual([]);  });
});

describe("the engine stands alone", () => {
  /**
   * The engine is installed into a game as a package, where its tests have no path to the game's folder: no
   * file of `test/` or `testing/` imports from `client/`, or names the engine by its package name (a test names
   * a module of its own by the relative path).
   */
  it("has no test file that imports from client/ or names the engine as a package", () => {
    const bad: string[] = [];
    for (const file of testFiles()) {
      const text = readFileSync(file, "utf8");
      // An import statement, an `export ... from`, a dynamic import and a worker's URL: not a line of prose that quotes one.
      const specs = [
        ...[...text.matchAll(/^\s*(?:import|export)\s+(?:[^"';]*?\s+from\s+)?["']([^"']+)["']/gm)].map((m) => m[1] as string),
        ...[...text.matchAll(/\bimport\(\s*["']([^"']+)["']/g)].map((m) => m[1] as string),
        ...[...text.matchAll(/new URL\(\s*["']([^"']+)["']\s*,\s*import\.meta\.url/g)].map((m) => m[1] as string),
      ];
      for (const spec of specs) {
        if (spec.startsWith(ENGINE_PACKAGE)) bad.push(`${relative(SRC, file)} names the engine as a package: ${spec}`);
        if (/(?:^|\/)client\//.test(spec)) bad.push(`${relative(SRC, file)} reaches into client/: ${spec}`);
      }
    }
    expect(bad).toEqual([]);
  });
});
