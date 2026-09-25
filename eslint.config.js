import tseslint from "typescript-eslint";

export default tseslint.config(
  // `.claude/worktrees/` holds whole second checkouts of this repository. Each
  // carries its own tsconfig.json, which gives typescript-eslint a second
  // candidate project root — it then fails to parse every file in the repo, so
  // one stray worktree breaks `npm run lint` for the main checkout too. Flat
  // config does not read .gitignore, so the path has to be named here as well.
  // client/public/libs/** is vendored third-party decoder/transcoder JS+wasm glue
  // (tools/vendor-ktx2.mjs) — not code this repo authors, so it is not linted.
  // tools/electron-spike/** is a throwaway Electron probe: Electron's sandboxed
  // preload must be CommonJS, which the repo's no-require-imports rule forbids.
  // desktop/** is the standalone desktop shell package: Electron's main is
  // CommonJS, same as above, and the shell has its own node --test suite.
  { ignores: ["**/dist/**", "**/node_modules/**", "site/**", ".claude/worktrees/**", "client/public/libs/**", "tools/electron-spike/**", "desktop/**"] },
  ...tseslint.configs.recommended,
  {
    files: ["client/src/sim/**/*.ts"],
    rules: {
      "no-restricted-imports": ["error", {
        patterns: [
          { group: ["@babylonjs/*"], message: "sim/ must not depend on Babylon." },
          { group: ["**/net/**", "**/game/**"], message: "sim/ must not depend on net/ or game/." },
        ],
      }],
    },
  },
  {
    files: ["client/src/net/**/*.ts"],
    rules: {
      "no-restricted-imports": ["error", {
        patterns: [
          { group: ["@babylonjs/*"], message: "net/ must not depend on Babylon." },
          { group: ["**/game/**"], message: "net/ must not depend on game/." },
        ],
      }],
    },
  },
);
