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
    for (const pure of ["timeline.ts", "shots.ts", "roadPath.ts", "sceneClock.ts", "intro.ts", "scenePlayer.ts"]) {
      expect(readFileSync(join(dir, pure), "utf8"), pure).not.toMatch(/from "@babylonjs/);
    }
    const route = readFileSync(join(dir, "sceneRoute.ts"), "utf8");
    expect(route).toContain("createWorld(level, seed, false)");
    expect(route).toContain("renderer.sync(world.state, -1, 0)");
    expect(route).not.toMatch(/world\.(step|apply|input)/);
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
    // The finish pass turns it off for itself (`finishFragmentFor`); replacing
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
    expect(main).toContain("      return engineFor(decided.tier, read, () => !cancelled());");
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
    expect(app).toContain("    runningOnWebGpu: () => renderer.engine.isWebGPU,");
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

  it("measures the probe's steps on WebGL2 where the rule draws their tiers on WebGPU and a WebGPU step cannot settle", () => {
    const main = stripComments(readFileSync(join(SRC, "main.ts"), "utf8"));
    expect(main).toContain(
      '      if (probeStepEngine(read, verdictEngineNow(read)) === "webgl2") return { canvas: document.createElement("canvas"), engine: null, watch: null };',
    );
  });

  it("records every failed WebGPU start through the one pin rule: the first load's, a switch's, a retry's, a probe step's", () => {
    const main = stripComments(readFileSync(join(SRC, "main.ts"), "utf8"));
    expect(main).toContain("  return recordStartFailure(reason, {");
    expect(main).toContain("    remember: (reason) => {\n      if (wanted()) void rememberFailure(reason, current());\n    },");
    // A probe step's engine that failed in its build or frames did not run
    // out of time: its start's timeout is the rule's (`remember`).
    expect(main).toContain('    failed: () => void rememberFailure("init", !cancelled()),');
    expect([...main.matchAll(/\brememberFailure\(/g)].length).toBe(3);
    expect(main).not.toMatch(/\b(recordFailure|writeFallback)\(/);
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
    expect([...app.matchAll(/\bwhenSceneReady\([^;]*;/g)].map((m) => m[0])).toEqual([
      "whenSceneReady(renderer.scene, made.leftMs, renderer.forestReady);",
    ]);
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
      join(SRC, "game", "passages.ts"),
      join(SRC, "game", "escalation.ts"),
      join(SRC, "game", "bladeClump.ts"),
      join(SRC, "game", "bladeField.ts"),
      join(SRC, "game", "rockRelief.ts"),
      join(SRC, "game", "gpuSignals.ts"),
      join(SRC, "game", "gpuClass.ts"),
      join(SRC, "game", "tierChoice.ts"),
      join(SRC, "game", "frameProbe.ts"),
      join(SRC, "game", "settings.ts"),
      join(SRC, "game", "governor.ts"),
      join(SRC, "game", "rainParams.ts"),
      join(SRC, "game", "lensParams.ts"),
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
      join(SRC, "game", "skyState.ts"),
      join(SRC, "game", "halfFloat.ts"),
      join(SRC, "game", "waterLifeParams.ts"),
      join(SRC, "game", "waterLifeField.ts"),
      join(SRC, "game", "midgeMotion.ts"),
      join(SRC, "game", "dragonflyBehaviour.ts"),
      join(SRC, "game", "frogChorus.ts"),
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
      "game/forestField.test.ts > keeps a warm one-cell-move collect fast — the 25-33 ms rescan must not return",
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
