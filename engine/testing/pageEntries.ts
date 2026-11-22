/**
 * The modules of the engine that a game's page and the game's own modules load by the package's name: the
 * engine's half of a rule that follows a game's modules into the engine's holds over the graph of these, and
 * a game's half of it records an import of `@csarkosh/engine/<path>` by its path and asserts it is one of these.
 * Paths are under the engine's `src/`, without the extension (`shell` is `src/shell.ts`).
 */

/**
 * The engine modules the game's page reaches: everything Day Hike's entry, its workers, its page, its hike and its
 * renderer's parts import from the engine. The engine's own suite holds the graph from each of them to load no
 * Babylon.js and to be one the game can be built with.
 */
export const PAGE_ENTRIES = [
  "game/ambientAudio", "game/assetUrls", "game/clipClock", "game/cloudParams", "game/colour", "game/commands", "game/credits", "game/downloadCard",
  "game/downloadTurns", "game/engineAssets", "game/fetchRetry", "game/glbParts", "game/gradeParams", "game/hollowLook", "game/icons",
  "game/instancePose", "game/lakeSkyline", "game/lampParams", "game/lite/displayCurve", "game/lite/drawOrder", "game/lite/forestModels",
  "game/lite/forestPlugins", "game/lite/frameBlock", "game/lite/listMeshes", "game/lite/renderer", "game/lite/shadeMask",
  "game/lite/shaderUniforms", "game/lite/skinnedModels", "game/loadProgress", "game/loadReport", "game/modeList", "game/modelBake",
  "game/propBoxes", "game/router", "game/seed", "game/settings", "game/shaders/shaderText", "game/skinInstances", "game/skyWait", "game/skyWorker",
  "game/stareLens", "game/startReady", "game/syncJobs", "game/tierChoice", "game/tokens", "game/veil", "game/weather", "game/wetSurface",
  "game/wildlifeBehaviour", "game/wildlifeInputs", "game/woodsSounds", "game/worldWork", "net/client", "net/desktopRelease", "net/host", "net/wire",
  "shell", "sim/boxGap", "sim/boxSource", "sim/chunk", "sim/cliffs", "sim/clutter", "sim/collision", "sim/constants", "sim/core", "sim/facing",
  "sim/features", "sim/field", "sim/forest", "sim/forestConstants", "sim/ground", "sim/lakeShape", "sim/landmarks", "sim/level", "sim/montane",
  "sim/movement", "sim/olympic", "sim/passes/cliffs", "sim/passes/clutter", "sim/passes/elevation", "sim/passes/trees", "sim/road",
  "sim/spawnGround", "sim/terrain", "sim/tick", "sim/trail", "sim/trailRoute", "sim/vegetation", "sim/view", "sim/waters",
] as const;

/**
 * The engine modules the game's computing modules (the hikers' poses and files, the scenes and the endings), which
 * load no Babylon at all, import from the engine. The engine's own suite holds the graph from each of them to
 * load no Babylon either, Babylon Lite included.
 */
export const PURE_ENTRIES = [
  "game/assetUrls", "game/clipClock", "game/downloadTurns", "game/hollowLook", "game/instancePose", "game/lakeSkyline", "game/lampParams",
  "game/seed", "game/weather", "sim/boxGap", "sim/boxSource", "sim/chunk", "sim/cliffs", "sim/clutter", "sim/collision", "sim/constants",
  "sim/core", "sim/facing", "sim/features", "sim/field", "sim/forest", "sim/forestConstants", "sim/ground", "sim/lakeShape", "sim/landmarks",
  "sim/level", "sim/montane", "sim/movement", "sim/olympic", "sim/passes/cliffs", "sim/passes/clutter", "sim/passes/elevation", "sim/passes/trees",
  "sim/road", "sim/spawnGround", "sim/terrain", "sim/tick", "sim/trail", "sim/trailRoute", "sim/vegetation", "sim/view", "sim/waters",
] as const;

/**
 * The ones of `PAGE_ENTRIES` that load the engine's terrain (`sim/terrain.ts`), itself or through what they load: a
 * thread of the game that names one of these needs the game's registration of its world. The engine's own suite
 * holds that this is exactly the set.
 */
export const TERRAIN_ENTRIES = [
  "game/lakeSkyline", "game/lite/forestPlugins", "game/lite/frameBlock", "game/lite/listMeshes", "game/lite/renderer", "game/lite/shadeMask",
  "game/lite/skinnedModels", "game/wetSurface", "game/wildlifeBehaviour", "game/worldWork", "net/client", "net/host", "shell", "sim/clutter",
  "sim/forest", "sim/ground", "sim/montane", "sim/movement", "sim/olympic", "sim/passes/cliffs", "sim/passes/clutter", "sim/passes/elevation",
  "sim/passes/trees", "sim/spawnGround", "sim/terrain", "sim/tick", "sim/vegetation", "sim/waters",
] as const;
