// What the push gate runs for a change, from the paths it touches. The development machine is never
// quiet (Cyrus, 2026-10-31: other work always runs on it), so nothing load-sensitive is gated on it:
//
//   none   nothing changed against main: nothing to gate.
//   light  only the repository's tooling, docs, branding and agent files changed: lint and the tools
//          suite, here. Neither has a time limit or a bar on elapsed time, so load cannot fail them,
//          and nothing the game ships or the client and server suites test is touched.
//   cloud  anything else (the game, the server, the build, the shader corpus or the WGSL tools that
//          make its maps, dependencies, CI): the whole gate, on the cloud, never here.

/** Paths outside the game: a change confined to these is gated `light`. A directory ends in `/`. */
export const LIGHT_PATHS = Object.freeze([
  'docs/',
  'branding/',
  'tools/',
  '.agents/',
  '.claude/',
  'README.md',
  'AGENTS.md',
  'CLAUDE.md',
  'ARCHITECTURE.md',
  'LICENSE',
]);

/** Under a light path, but feeding the shipped build (the WGSL maps; the field kernel's committed module): gated as the game is. */
export const HEAVY_UNDER_LIGHT = Object.freeze(['tools/wgsl/', 'tools/rust/']);

const under = (path, prefix) => (prefix.endsWith('/') ? path.startsWith(prefix) : path === prefix);

/** Whether a repository path (forward slashes, from the root) is outside the game. */
export function isLight(path) {
  if (HEAVY_UNDER_LIGHT.some((prefix) => under(path, prefix))) return false;
  return LIGHT_PATHS.some((prefix) => under(path, prefix));
}

/** The gate's plan for the paths a change touches: `{ kind, heavy }`, `heavy` the paths that make it `cloud`. */
export function gatePlan(paths) {
  const unique = [...new Set(paths.filter((p) => p.length > 0))];
  if (unique.length === 0) return { kind: 'none', heavy: [] };
  const heavy = unique.filter((p) => !isLight(p)).sort();
  return { kind: heavy.length === 0 ? 'light' : 'cloud', heavy };
}
