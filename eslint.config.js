import tseslint from "typescript-eslint";

const SIM = [
  { group: ["@babylonjs/*"], message: "sim/ must not depend on Babylon." },
  { group: ["**/net/**", "**/game/**"], message: "sim/ must not depend on net/ or game/." },
];
const NET = [
  { group: ["@babylonjs/*"], message: "net/ must not depend on Babylon." },
  { group: ["**/game/**"], message: "net/ must not depend on game/." },
];
const ENGINE = [
  { group: ["**/client/**", "**/server/**"], message: "The engine must not depend on a game or on the server." },
  { group: ["@csarkosh/engine", "@csarkosh/engine/**"], message: "Inside the engine, name a module by its relative path." },
];

const GAME_ON_ENGINE = [
  { group: ["**/client/**", "**/server/**"], message: "The empty game must not depend on another game or on the server." },
  { group: ["../../src/**", "../../../src/**"], message: "The empty game names the engine by its package, as a game does." },
];

export default tseslint.config(
  // `.claude/worktrees/` holds whole second checkouts of this repository. Each
  // carries its own tsconfig.json, which gives typescript-eslint a second
  // candidate project root — it then fails to parse every file in the repo, so
  // one stray worktree breaks `npm run lint` for the main checkout too. Flat
  // config does not read .gitignore, so the path has to be named here as well.
  // client/public/libs/** (the visit counter) and engine/public/libs/** are vendored third-party decoder/transcoder JS+wasm glue
  // (tools/vendor-ktx2.mjs) — not code this repo authors, so it is not linted.
  // tools/electron-spike/** is a throwaway Electron probe: Electron's sandboxed
  // preload must be CommonJS, which the repo's no-require-imports rule forbids.
  // desktop/** is the standalone desktop shell package: Electron's main is
  // CommonJS, same as above, and the shell has its own node --test suite.
  // client/dist-admin/** is the admin page's build (client/vite.admin.config.ts), as dist/ is the game's.
  { ignores: ["**/dist/**", "client/dist-admin/**", "**/node_modules/**", "site/**", ".claude/worktrees/**", "client/public/libs/**", "engine/public/libs/**", "tools/electron-spike/**", "desktop/**"] },
  ...tseslint.configs.recommended,
  {
    files: ["client/src/sim/**/*.ts"],
    rules: { "no-restricted-imports": ["error", { patterns: [...SIM] }] },
  },
  {
    files: ["client/src/net/**/*.ts"],
    rules: { "no-restricted-imports": ["error", { patterns: [...NET] }] },
  },
  // The engine is no game's: nothing in it reaches the client or the server, by a path or by a
  // package's name, and it names its own modules by their paths, never as the package a game
  // imports. A file matched twice takes the last rule whole, so the engine's layers repeat it.
  {
    files: ["engine/**/*.ts"],
    rules: { "no-restricted-imports": ["error", { patterns: [...ENGINE] }] },
  },
  // The empty game stands in the engine's folder but is a game: it names the engine by the package,
  // as any game does, so that a copy of it is a new game's start; it never reaches into the engine's
  // files by a path, nor into another game or the server.
  {
    files: ["engine/empty/**/*.ts"],
    rules: { "no-restricted-imports": ["error", { patterns: [...GAME_ON_ENGINE] }] },
  },
  {
    files: ["engine/src/sim/**/*.ts"],
    rules: { "no-restricted-imports": ["error", { patterns: [...ENGINE, ...SIM] }] },
  },
  {
    files: ["engine/src/net/**/*.ts"],
    rules: { "no-restricted-imports": ["error", { patterns: [...ENGINE, ...NET] }] },
  },
);
