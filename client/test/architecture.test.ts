import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, existsSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { limitOffenders, scanTestSource, wallClockOffenders, type ScannedFile } from "@csarkosh/engine/testing/testCalls";
import { PAGE_ENTRIES, PURE_ENTRIES, TERRAIN_ENTRIES } from "@csarkosh/engine/testing/pageEntries";

// Resolve against this file, never process.cwd(). Vitest is launched from the
// repo root with `--root client`, so cwd is the repo root: a relative "src/sim"
// silently points at nothing and every check below passes vacuously forever.
const SRC = fileURLToPath(new URL("../src", import.meta.url));
const TESTS = fileURLToPath(new URL(".", import.meta.url));
/**
 * The engine is a package Day Hike imports (`@csarkosh/engine/<path>`), and these rules read Day Hike's own source
 * alone: a rule over the engine's modules is the engine's repository's own (`test/architecture.test.ts` there). A rule that follows Day Hike's modules
 * into the engine's is held in two halves. This one follows Day Hike's modules only and records each import of the
 * package by its path (`engineModule`) without following it; it asserts that the engine's modules it names are among the
 * lists the engine's half walks (`@csarkosh/engine/testing/pageEntries`).
 */
const ENGINE_PACKAGE = "@csarkosh/engine/";

function at(...parts: string[]): string {
  return join(SRC, ...parts);
}

function logical(file: string): string {
  return relative(SRC, file);
}

/** The engine module an import names by the package (`@csarkosh/engine/game/colour` is `game/colour`): null for any other. */
function engineModule(spec: string): string | null {
  return spec.startsWith(ENGINE_PACKAGE) ? spec.slice(ENGINE_PACKAGE.length).replace(/\?.*$/, "") : null;
}

/** The file of Day Hike's own that a module's import names: null for a package's (the engine's included) or a file that is not a module. */
function followed(file: string, spec: string): string | null {
  if (spec.startsWith(".") && spec.endsWith(".js")) return join(file, "..", spec.replace(/\.js$/, ".ts"));
  return null;
}

/** The module an import names, as a path under `src/` of the game or of the engine (`game/colour.ts`): null for a package's or a file that is not a module. */
function moduleOf(file: string, spec: string): string | null {
  const named = engineModule(spec);
  if (named !== null) return `${named}.ts`;
  const to = followed(file, spec);
  return to === null ? null : logical(to);
}

/** The names of `named` that are not in `list`: the engine modules a game's graph reaches that the engine's half does not walk. */
function unlisted(named: Iterable<string>, list: readonly string[]): string[] {
  return [...named].filter((name) => !list.includes(name)).sort();
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
  for (const file of filesUnder(dir)) {
    for (const spec of importsOf(file)) {
      if (forbidden.some((rx) => rx.test(spec))) found.push(`${file} imports ${spec}`);
    }
  }
  return found;
}

/** What a module loads when it is built: its imports and re-exports that are not types' (a type's import is erased and loads nothing). */
function loaded(file: string): string[] {
  return [...readFileSync(file, "utf8").matchAll(/^\s*(?:import|export)\s+(?!type\s)(?:[^"'();]*?\s+from\s+)?["']([^"']+)["']/gm)].map((m) => m[1] as string);
}

/**
 * Day Hike's modules that load from `roots`, followed through one another, each import of Babylon (Lite's included)
 * found in them, and the engine's modules they name, which are recorded and not followed.
 */
function babylonIn(roots: string[]): { seen: Set<string>; bad: string[]; engine: Set<string> } {
  const seen = new Set<string>();
  const engine = new Set<string>();
  const stack = [...roots];
  const bad: string[] = [];
  while (stack.length > 0) {
    const file = stack.pop() as string;
    if (seen.has(file)) continue;
    seen.add(file);
    for (const spec of loaded(file)) {
      if (spec.startsWith("@babylonjs")) bad.push(`${logical(file)} imports ${spec}`);
      const named = engineModule(spec);
      if (named !== null) engine.add(named);
      const next = followed(file, spec);
      if (next !== null) stack.push(next);
    }
  }
  return { seen, bad, engine };
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
    expect(filesUnder(SRC).length).toBeGreaterThan(0);
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

  it("registers Day Hike's world in every thread that asks for one: the page, the admin page and each worker that reaches the terrain reach the registration", () => {
    // The engine's terrain registers nothing of its own, so a thread that reaches it without the
    // game's registration (`sim/passes/index.ts`: the coast with the mountain on it, and every
    // pass) would throw at its first world, or worse, build one that is not Day Hike's. A thread reaches the
    // engine's terrain by naming it or a module that loads it: `TERRAIN_ENTRIES`, which the engine's half holds
    // to be exactly the ones of `PAGE_ENTRIES` that do.
    const loads = (file: string): string[] => {
      const text = stripComments(readFileSync(file, "utf8"));
      return [
        ...[...text.matchAll(/^\s*(?:import|export)\s+(?!type\s)(?:[^"'();]*?\s+from\s+)?["']([^"'?]+)["']/gm)].map((m) => m[1] as string),
        ...[...text.matchAll(/\bimport\(\s*["']([^"'?]+)["']\s*\)/g)].map((m) => m[1] as string),
      ];
    };
    /** Day Hike's modules a thread loads, and the engine's modules they name. */
    const reach = (entry: string): { files: Set<string>; engine: Set<string> } => {
      const files = new Set<string>();
      const engine = new Set<string>();
      const stack = [entry];
      while (stack.length > 0) {
        const file = stack.pop() as string;
        if (files.has(file) || !existsSync(file)) continue;
        files.add(file);
        for (const spec of loads(file)) {
          const named = engineModule(spec);
          if (named !== null) engine.add(named);
          const next = followed(file, spec);
          if (next !== null) stack.push(next);
        }
      }
      return { files, engine };
    };
    const entries = [at("main.ts"), at("admin", "main.ts"), ...filesUnder(SRC).filter((file) => file.endsWith(".worker.ts"))];
    expect(entries.length).toBeGreaterThan(3);
    const registration = at("sim", "passes", "index.ts");
    const threads = entries.map((entry) => ({ entry, ...reach(entry) }));
    // The engine's modules the threads name are the ones the engine's half walks.
    expect(unlisted(threads.flatMap((thread) => [...thread.engine]), PAGE_ENTRIES)).toEqual([]);
    const asking = threads.filter((thread) => [...thread.engine].some((name) => (TERRAIN_ENTRIES as readonly string[]).includes(name)));
    expect(asking.map((thread) => logical(thread.entry))).toEqual(expect.arrayContaining(["main.ts", "game/world.worker.ts"]));
    expect(asking.filter((thread) => !thread.files.has(registration)).map((thread) => logical(thread.entry))).toEqual([]);
  });

  it("registers Day Hike's shipped files as the page starts, and nowhere else", () => {
    // The engine's modules ask for a model, a texture or a clip by name (`game/assetUrls.ts`) and
    // answer from what a game registered; nothing is registered until Day Hike's own file runs.
    expect(importsOf(at("main.ts"))).toContain("./game/dayhikeAssets.js");
    const callers = filesUnder(SRC)
      .filter((file) => /\bregisterAssets\(/.test(stripComments(readFileSync(file, "utf8"))))
      .map(logical)
      .sort();
    expect(callers).toEqual(["game/dayhikeAssets.ts"]);
  });

  it("sim/ imports nothing but node builtins and itself", () => {
    expect(violations(at("sim"), [/^@babylonjs/, /net\//, /game\//])).toEqual([]);
  });

  it("sim/ has no external package dependencies at all", () => {
    const external = filesUnder(at("sim"))
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
    for (const top of ["main.ts"]) {
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
    // The helpers stand in the engine (`game/tierChoice.ts`, `game/gpuSignals.ts`); the game defines none of its own.
    const definitions = (name: string): string[] =>
      filesUnder(SRC).flatMap((file) =>
        [...stripComments(readFileSync(file, "utf8")).matchAll(new RegExp(`\\bfunction ${name}\\(`, "g"))].map(() => logical(file)),
      );
    expect(definitions("parseTierOverride")).toEqual([]);
    expect(definitions("browserMajor")).toEqual([]);
    expect(definitions("pageStorage")).toEqual([]);
    expect(definitions("pageSessionStorage")).toEqual([]);
    expect(definitions("safeStorage")).toEqual([]);
    // The landing notice's pair: the engine's own reload notice is gone with
    // the reload.
    expect(definitions("leaveNotice")).toEqual([]);
    expect(definitions("takeNotice")).toEqual([]);
  });

  it("answers a WebGPU failure without reloading the page: the one reload left is the player's, on a build mismatch", () => {
    const calls = (pattern: RegExp): string[] =>
      filesUnder(SRC).flatMap((file) =>
        [...stripComments(readFileSync(file, "utf8")).matchAll(pattern)].map((m) => `${logical(file)}: ${m[0]}`),
      );
    expect(calls(/location\.replace\(/g)).toEqual([]);
    expect(calls(/.*location\.reload\(.*/g)).toEqual([]);
  });

  it("asks for a WebGPU adapter in one place, the GPU's signals, and never through Babylon's support check", () => {
    const naming = (pattern: RegExp): string[] =>
      filesUnder(SRC).flatMap((file) =>
        [...stripComments(readFileSync(file, "utf8")).matchAll(pattern)].map(() => logical(file)),
      );
    expect(naming(/\.requestAdapter\(/g)).toEqual([]);
    expect(naming(/\bIsSupportedAsync\b/g)).toEqual([]);
  });

  it("measures every step of the tier check on the hike's own renderer: the page makes no engine, for a step or for anything", () => {
    // The page's deps are the probe's on the hike's own renderer, which makes each step's renderer, canvas and engine
    // and lets them go with the step. The page makes them itself, on the game's level and renderer and the empty state
    // the game hands it (`page.probeState`); the game's page names no probe.
    const game = stripComments(readFileSync(at("hikePageGame.ts"), "utf8"));
    expect([...game.matchAll(/\bliteProbeDeps\(/g)].length).toBe(0);
    expect(game).toContain("  probeState: (level, seed) => createWorld(level, seed, false).state,");
    expect(importsOf(at("hikePageGame.ts"))).not.toContain("@csarkosh/engine/game/lite/probeScene");
    expect(importsOf(at("hikePageGame.ts"))).not.toContain("./game/probeScene.js");
  });

  it("loads no Babylon.js with the page: nothing the page's entry (main.ts), the engine's shell (shell.ts) and the game's page (hikePageGame.ts) import for themselves reaches it, by an import or a dynamic one", () => {
    // The page's own imports, each followed through everything of Day Hike's it loads, static or dynamic, name no module of
    // Babylon.js (the hike, `hike.ts`, and the game it is handed, `hikeGame.ts`, imported by the game's page, `hikePageGame.ts`,
    // has its own test below and is left out here). Babylon Lite, which the hike is drawn with, is another library.
    // An import of the engine is recorded by its path and not followed: the engine's half walks it, from `PAGE_ENTRIES`.
    const code = (file: string): string => stripComments(readFileSync(file, "utf8"));
    const loads = (file: string): string[] => [
      ...[...code(file).matchAll(/^\s*(?:import|export)\s+(?!type\s)(?:[^"'();]*?\s+from\s+)?["']([^"']+)["']/gm)].map((m) => m[1] as string),
      ...[...code(file).matchAll(/\bimport\(\s*["']([^"']+)["']\s*\)/g)].map((m) => m[1] as string),
    ];
    // The entry (`main.ts`) loads Day Hike's registrations, then the shell and the game's page by name: each of those
    // two stands for its own loads. The shell is the engine's and is handed the game's page.
    const main = at("main.ts");
    const entry = loads(main);
    const shellSpec = `${ENGINE_PACKAGE}shell`;
    expect(entry, shellSpec).toContain(shellSpec);
    expect(entry, "./hikePageGame.js").toContain("./hikePageGame.js");
    // The game's page names the hike: its own loads stand in for that one.
    const gamePage = at("hikePageGame.ts");
    const ofGame = loads(gamePage);
    expect(ofGame, "./hikeGame.js").toContain("./hikeGame.js");
    for (const specs of [entry, ofGame]) {
      expect(specs.filter((spec) => !spec.startsWith(".") && !spec.startsWith(ENGINE_PACKAGE))).toEqual([]);
    }
    const seen = new Map<string, string | null>();
    const named = new Set<string>();
    const stack: [string, string | null][] = [];
    for (const [from, specs] of [[main, entry], [gamePage, ofGame]] as [string, string[]][]) {
      for (const spec of specs) {
        const engine = engineModule(spec);
        if (engine !== null) named.add(engine);
        if (spec === "./hikePageGame.js" || spec === "./hikeGame.js") continue;
        const next = followed(from, spec);
        if (next !== null) stack.push([next, null]);
      }
    }
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
        const engine = engineModule(path);
        if (engine !== null) named.add(engine);
        const next = followed(file, path);
        if (next !== null) stack.push([next, file]);
      }
    }
    // This is Day Hike's part of the page's graph (the engine's half holds the rest, the two over three hundred modules), and
    // the renderer on Babylon Lite is among what it names of the engine, whose modules are all ones the engine's half walks.
    expect(seen.size).toBeGreaterThan(50);
    expect([...named]).toContain("game/lite/renderer");
    expect(unlisted(named, PAGE_ENTRIES)).toEqual([]);
    expect(bad).toEqual([]);
  });

  it("decides once whether the browser can play, with no engine and no request of its own, and starts nothing of a hike where it cannot", () => {
    // The check, the shell and the page for those turned away are the engine's (the engine's half). The page for
    // those turned away is drawn in one place in the shell and nowhere in Day Hike's own of the page.
    expect([...readFileSync(at("hikePage.ts"), "utf8").matchAll(/\brenderTurnedAway\(/g)].length).toBe(0);
  });

  it("loads no module of Babylon.js with the page, the hike under it included, followed into whatever a library's module loads in turn", () => {
    const NODE_MODULES = fileURLToPath(new URL("../../node_modules", import.meta.url));
    const engine = new Set<string>();
    const runtimeImports = (file: string): string[] =>
      [...readFileSync(file, "utf8").matchAll(/^\s*(?:import|export)\s+(?!type\s)(?:[^"'();]*?\s+from\s+)?["']([^"'?]+)["']/gm)].map((m) => m[1] as string);
    const resolveIn = (from: string, spec: string): string | null => {
      // Babylon Lite is a library of its own, imported whole by its package's name: it holds no
      // module of Babylon.js and registers nothing on Babylon.js's classes.
      if (spec === "@babylonjs/lite") return null;
      if (spec.startsWith("@babylonjs/")) return join(NODE_MODULES, spec);
      // The engine's modules are recorded by their paths and followed by the engine's half, from `PAGE_ENTRIES`.
      const named = engineModule(spec);
      if (named !== null) {
        engine.add(named);
        return null;
      }
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
    expect(unlisted(engine, PAGE_ENTRIES)).toEqual([]);
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
      at("game", "filmHead.ts"),
      at("game", "wayLightGeometry.ts"),
      at("game", "wayLight.ts"),
      at("game", "wayMistFieldGeometry.ts"),
      at("game", "wayMistField.ts"),
      at("game", "crowdField.ts"),
      at("game", "crowdEyes.ts"),
      at("game", "crowdCards.ts"),
      at("game", "passages.ts"),
      at("game", "escalation.ts"),
      at("game", "woodsVoice.ts"),
      at("game", "oddSounds.ts"),
      at("game", "stareAudio.ts"),
      at("game", "world.worker.ts"),
      at("game", "carAudio.ts"),
      at("game", "characterAssets.ts"),
      at("game", "entityPoses.ts"),
      at("game", "droppedCap.ts"),
      at("game", "signParts.ts"),
      at("game", "sceneryParts.ts"),
      at("game", "boardDraw.ts"),
      at("game", "scenePlay.ts"),
      at("game", "cutscene.ts"),
      at("game", "ending.ts"),
      at("game", "endScene.ts"),
      at("game", "carParts.ts"),
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
   * What the hikers, the Hollows, the dropped cap and the animals are drawn
   * with: where each body stands and how (the poses), which file and which clip it is, and the cap's place and shape.
   * The meshes that draw them take their values from these. What they load of the engine is the modules of `PURE_ENTRIES`,
   * which the engine's half holds to load no Babylon either.
   */
  it("what the hikers, the Hollows, the cap and the animals are drawn with is computed without loading Babylon, whatever it imports", () => {
    const ENGINE_FREE = ["characterAssets.ts", "entityPoses.ts", "droppedCap.ts"];
    const stack = ENGINE_FREE.map((name) => at("game", name));
    for (const file of stack) expect(existsSync(file), file).toBe(true);
    const { seen, bad, engine } = babylonIn(stack);
    expect(seen.size).toBeGreaterThan(ENGINE_FREE.length);
    expect(bad).toEqual([]);
    expect(unlisted(engine, PURE_ENTRIES)).toEqual([]);
  });

  /**
   * What a scene and an ending are played with: the summit's shots and the cap's, the death's
   * fall and its closing dark, the end scene's four shots, its car along the
   * road and its lamps, and the state that runs between them from frame to
   * frame (whose camera the frame has, the local body in a shot, who is in
   * the car, where the one lamp is worn). The renderer steps the play. What they load of the engine is the modules of
   * `PURE_ENTRIES`, which the engine's half holds to load no Babylon either.
   */
  it("what the scenes and the endings are played with is computed without loading Babylon, whatever it imports", () => {
    const ENGINE_FREE = [
      "scenePlay.ts", "shotBodies.ts", "cutscene.ts", "ending.ts", "endScene.ts", "carAudio.ts", "carParts.ts", "scene/roadPath.ts", "scene/timeline.ts", "scene/shots.ts",
      "scene/routeWorld.ts", "scene/scenePlayer.ts", "scene/actorPose.ts", "scene/stageParts.ts", "scene/cordTubeGeometry.ts", "scene/cord.ts",
    ];
    const stack = ENGINE_FREE.map((name) => at("game", name));
    for (const file of stack) expect(existsSync(file), file).toBe(true);
    const { seen, bad, engine } = babylonIn(stack);
    expect(seen.size).toBeGreaterThan(ENGINE_FREE.length);
    expect(bad).toEqual([]);
    expect(unlisted(engine, PURE_ENTRIES)).toEqual([]);
    // On Lite the frame's bodies take up who the scene shows in the frame that says so.
    expect(readFileSync(at("game/lite/hikeParts.ts"), "utf8")).toContain("bodies = bodiesInShot(poses, bodies, now, state, localId, alpha, host.stands() ? (entities?.models ?? null) : null);");
  });

  /**
   * What the GPU says went wrong under a hike is told through the engine's record (`gpuFaults.ts`); the line's
   * words stand in one function and the bound's numbers in one module, the engine's (`game/lossBound.ts`), and the
   * game defines none of its own.
   */
  it("tells the hike's record of the device's errors and losses, and ends a hike by the page's count of losses, through its one line", () => {
    const naming = (pattern: RegExp): string[] =>
      filesUnder(SRC).flatMap((file) => [...stripComments(readFileSync(file, "utf8")).matchAll(pattern)].map(() => logical(file)));
    expect(naming(/\bfunction lossEndedLine\(/g)).toEqual([]);
    expect(naming(/\bLOSS_BOUND_(?:COUNT|WINDOW_MS) = /g)).toEqual([]);
  });

  /**
   * The hike's renderer is drawn with Babylon Lite, and nothing of it is
   * Babylon.js: not a module under `game/lite/`, and not anything one of
   * them loads. What it is made with beside Lite is the game's own
   * arithmetic, which loads no engine, and types, which load nothing. What these load of the
   * engine is the modules of `PAGE_ENTRIES`, which the engine's half holds to load none either.
   */
  it("draws the hike with Babylon Lite alone: nothing under game/lite/ loads Babylon.js, whatever it imports", () => {
    const own = filesUnder(at("game", "lite"));
    expect(own.length).toBeGreaterThan(5);
    const seen = new Set<string>();
    const engine = new Set<string>();
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
        const named = engineModule(spec);
        if (named !== null) engine.add(named);
        const next = followed(file, spec);
        if (next !== null) stack.push(next);
      }
    }
    expect(seen.size).toBeGreaterThan(own.length);
    expect(bad).toEqual([]);
    expect(unlisted(engine, PAGE_ENTRIES)).toEqual([]);
    // Lite itself is loaded only by the modules that draw: the plugins, the pose and the light name its types alone.
    expect(lite.sort()).toEqual([
      "game/lite/capMesh.ts", "game/lite/crowdCardMeshes.ts", "game/lite/crowdEyeMeshes.ts", "game/lite/entityMeshes.ts", "game/lite/sceneActor.ts",
      "game/lite/sceneryMeshes.ts", "game/lite/sceneryModels.ts", "game/lite/sceneryPaint.ts", "game/lite/wayFieldMesh.ts",
      "game/lite/wayLightMeshes.ts", "game/lite/wornLamps.ts",
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
    // The engine's renderer of the world, whatever state a game hands it (the engine's half); the hike's own is that over Day Hike's state
    // with Day Hike's own methods beside it, in a module of types as bare.
    const hike = at("game/hikeRendererTypes.ts");
    expect(loaded(hike)).toEqual([]);
    expect(importsOf(hike).filter((spec) => spec.startsWith("@babylonjs"))).toEqual([]);
    expect(readFileSync(hike, "utf8")).toContain("export type Renderer = WorldRenderer<WorldState> & HikeApi;");
    // Each of them is defined once in src/.
    const defined = filesUnder(SRC).flatMap((file) =>
      [...stripComments(readFileSync(file, "utf8")).matchAll(/\bexport type (?:FreecamView|FrameView|Renderer|RendererOptions) =/g)].map(() => logical(file)),
    );
    expect(defined.sort()).toEqual(["game/hikeRendererTypes.ts"]);
    // Who holds a renderer takes the types from there.
    for (const holder of ["game/hikeRenderer.ts", "game/lite/sceneRoute.ts", "game/lite/sceneStage.ts", "game/lite/sceneryMeshes.ts"]) {
      const specs = importsOf(at(holder));
      expect(specs.some((spec) => /\/(?:rendererTypes|hikeRendererTypes)(?:\.js)?$/.test(spec)), holder).toBe(true);
    }
  });

  /**
   * A hike loads no Babylon.js: not `hike.ts` by an import of its own (the
   * test above) and not anything it imports, by an import or by a dynamic
   * one, however deep. What it loads of an engine is Babylon Lite, through
   * the renderer it is handed (`hikeRenderer.ts`). So what it is told by
   * comes from the modules that compute it with no engine (`droppedCap.ts`), and the scenery it places once is
   * asked of its renderer (`hikeScenery.ts`). The engine's modules it names are the ones the engine's half walks.
   */
  it("loads no Babylon.js under a hike: nothing app.ts imports, by an import or a dynamic one, reaches a module that loads it", () => {
    const loads = (file: string): string[] => {
      const text = readFileSync(file, "utf8");
      const imported = [...text.matchAll(/^\s*(?:import|export)\s+(?!type\s)(?:[^"'();]*?\s+from\s+)?["']([^"']+)["']/gm)].map((m) => m[1] as string);
      const asked = [...stripComments(text).matchAll(/\bimport\(\s*["']([^"']+)["']\s*\)/g)].map((m) => m[1] as string);
      return [...imported, ...asked];
    };
    /** Every module of Day Hike's `entry` loads, with the Babylon.js each loads (and the chain it is reached by), the modules that load Babylon Lite and the engine's modules named. */
    const reach = (entry: string): { seen: number; babylon: string[]; lite: string[]; engine: Set<string> } => {
      const from = new Map<string, string | null>([[entry, null]]);
      const queue = [entry];
      const babylon: string[] = [];
      const lite: string[] = [];
      const engine = new Set<string>();
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
          const named = engineModule(spec);
          if (named !== null) engine.add(named);
          const next = followed(file, spec);
          if (next === null) continue;
          if (!from.has(next)) {
            from.set(next, file);
            queue.push(next);
          }
        }
      }
      return { seen: from.size, babylon, lite: [...new Set(lite)], engine };
    };
    // A hike is the page's half (`app.ts`, the engine's) and the game it is handed (`hikeGame.ts`), which the page names by type alone:
    // this walk is the game's, from `hikeGame.ts`.
    const hike = reach(at("hikeGame.ts"));
    // Guards against the guard: the walk goes through the whole of the game's hike and finds the engine it does load.
    expect(hike.seen).toBeGreaterThan(50);
    expect(hike.lite).toContain("game/lite/sceneryMeshes.ts");
    expect([...hike.engine]).toContain("game/lite/renderer");
    expect(hike.babylon).toEqual([]);
    expect(unlisted(hike.engine, PAGE_ENTRIES)).toEqual([]);
    // What the hike is told by is taken where it is computed, and its scenery is asked of its renderer alone.
    // `hike.ts` (the hike's own half) and `hikeGame.ts` (the game as the page is handed it) are told by them
    // between them. Each import is followed to its file, the engine's by its path.
    const told = [at("hike.ts"), at("hikeGame.ts")].flatMap((file) => importsOf(file).map((spec) => moduleOf(file, spec)).filter((to): to is string => to !== null));
    for (const home of ["game/droppedCap.ts", "game/hikeRenderer.ts", "game/hikeScenery.ts"]) expect(told, home).toContain(home);
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
    const files = [...filesUnder(SRC), ...filesUnder(TESTS)];
    const named: string[] = [];
    let lite = 0;
    for (const file of files) {
      const specs = everyImport(file);
      if (specs.includes("@babylonjs/lite")) lite++;
      for (const spec of specs) if (ofBabylon(spec)) named.push(`${relative(join(SRC, ".."), file)} names ${spec}`);
    }
    // Guards against the guard: the walk reads the whole of src/ and test/ and finds the library where it is named.
    expect(filesUnder(SRC).length).toBeGreaterThan(100);
    expect(filesUnder(TESTS).length).toBeGreaterThan(400);
    expect(lite).toBeGreaterThan(15);
    expect(named).toEqual([]);
    // Nor is such a package spelt in src/ outside an import: a path into it, a `require`, a URL.
    const spelt = filesUnder(SRC)
      .filter((file) => /@babylonjs\/(?!lite\b)/.test(stripComments(readFileSync(file, "utf8"))))
      .map((file) => logical(file));
    expect(spelt).toEqual([]);
    // The record's reader loads the file system and nothing else.
    expect(importsOf(join(TESTS, "helpers/babylonFixture.ts"))).toEqual(["node:fs"]);
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
    const own = filesUnder(at("game", "lite"));
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
    // Game's own: `ai.ts` and `hollow.ts`. `movement.ts` and `view.ts` are the engine's (the engine's half).
    const EXPECTED = [
      "ai.ts Math.atan2(",
      "hollow.ts Math.atan2(",
      "hollow.ts Math.atan2(",
    ];

    const found: string[] = [];
    for (const file of filesUnder(at("sim"))) {
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
    for (const file of filesUnder(at("sim"))) {
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
    for (const file of filesUnder(SRC)) {
      const src = stripComments(readFileSync(file, "utf8"));
      if (/Button\.(Fire|Reload)\b/.test(src)) offenders.push(`${file} uses Button.Fire/Reload`);
      if (/sim\/combat\.js/.test(src)) offenders.push(`${file} imports sim/combat.js`);
    }
    expect(offenders).toEqual([]);
    expect(existsSync(at("sim", "combat.ts"))).toBe(false);
  });

  it("holds or frees the controls only through the play gate", () => {
    // `createPlayGate` owns suppression outright (the engine's: `game/input.ts`, `game/pauseMenu.ts`, `app.ts`, which the
    // engine's half counts); no module of Day Hike's names it.
    const mentions: Record<string, number> = {};
    for (const file of filesUnder(SRC)) {
      const count = [...stripComments(readFileSync(file, "utf8")).matchAll(/\bsetSuppressed\b/g)].length;
      if (count > 0) mentions[logical(file).split("\\").join("/")] = count;
    }
    expect(mentions).toEqual({});
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
  const ALLOWED: readonly { file: string; text: string; why: string }[] = [];
  const wgslFiles = walkFiles(SRC, ".wgsl");
  const modules = filesUnder(SRC);

  it("can actually see the files and the modules", () => {
    expect(wgslFiles.length).toBeGreaterThan(10);
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
});

function scannedTestFiles(): ScannedFile[] {
  return filesUnder(TESTS)
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

describe("the game's tests reach no file of the engine by a path", () => {
  /**
   * The engine is installed into Day Hike as a package, where the game has no path to the engine's folder:
   * Day Hike's tests read the engine's shipped files through `@csarkosh/engine/testing/engineFiles` and the lists
   * their rules share with the engine's through `@csarkosh/engine/testing/pageEntries`, and its source text is read in
   * the engine's own suite.
   */
  it("has no file under client/ that names a relative path into the engine's folder", () => {
    const root = fileURLToPath(new URL("..", import.meta.url));
    const TEXT = /\.(?:ts|json|mjs|js|md|txt|html|glsl|wgsl)$/;
    const everything = (dir: string): string[] =>
      readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
        if (entry.name === "node_modules" || entry.name.startsWith("dist")) return [];
        const full = join(dir, entry.name);
        return entry.isDirectory() ? everything(full) : TEXT.test(entry.name) ? [full] : [];
      });
    const own = readdirSync(root, { withFileTypes: true }).filter((entry) => entry.isFile() && /\.(?:ts|json)$/.test(entry.name)).map((entry) => join(root, entry.name));
    const named: string[] = [];
    for (const file of [...everything(join(root, "src")), ...everything(join(root, "test")), ...own]) {
      // The one path that is allowed: the package's own place in node_modules, in tsconfig.json.
      const text = readFileSync(file, "utf8").replaceAll("../node_modules/@csarkosh/engine/", "");
      if (/(?:\.\.\/)+engine\//.test(text)) named.push(relative(root, file));
    }
    expect(named).toEqual([]);
  });
});
