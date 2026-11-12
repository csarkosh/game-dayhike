// What a page's stops were spent on: each profile sample inside a stop named by its cause. A
// native call is named by what it is (a shader link, a texture upload); a script's frame by where
// its source lives (the simulation's sampling, the game's builders, Babylon). `sourceOf` is the
// report's: a frame's name and source path from the build's maps, or null without them.

/** The causes, in the order they print. */
export const CAUSES = [
  "world sampling (src/sim)",
  "shader links",
  "texture uploads",
  "Babylon",
  "garbage collection",
  "shader text processing",
  "forest and ground cover (src/game)",
  "terrain and water (src/game)",
  "other game code",
  "buffers",
  "readPixels",
  "browser's own work",
  "other",
];

const LINKS = /^(getProgramParameter|getShaderParameter|linkProgram|compileShader|getUniformLocation|getAttribLocation|getUniformBlockIndex|uniformBlockBinding|shaderSource|getActiveUniform|getActiveAttrib)$/;
const UPLOADS = /^(texImage2D|texSubImage2D|texImage3D|texSubImage3D|compressedTexImage2D|compressedTexSubImage2D|generateMipmap|texStorage2D|texStorage3D)$/;
const BUFFERS = /^(bufferData|bufferSubData)$/;

/** A sourced frame's cause, from its source path. */
function ofSource(source) {
  if (/(^|[\s/])src\/sim\//.test(source)) return "world sampling (src/sim)";
  if (/Engines\/Processors\//.test(source)) return "shader text processing";
  if (/@babylonjs|(^|[\s/])bjs\//.test(source)) return "Babylon";
  if (/src\/game\/(clipmap|terrain|facePatch|water|lake|ocean|swash|bedHeight|rockRelief)/.test(source)) return "terrain and water (src/game)";
  if (/src\/game\/(forest|clutter|impostor|blades|duff)/.test(source)) return "forest and ground cover (src/game)";
  if (/(^|[\s/])src\//.test(source)) return "other game code";
  return "other";
}

/** A sample's cause: its frame, with its callers nearest first; null for an idle sample. */
export function causeOf(callFrame, ancestors, sourceOf) {
  const name = callFrame.functionName;
  if (name === "(idle)") return null;
  if (name === "(garbage collector)") return "garbage collection";
  if (name === "(program)") return "browser's own work";
  if (!callFrame.url) {
    if (LINKS.test(name)) return "shader links";
    if (UPLOADS.test(name)) return "texture uploads";
    if (BUFFERS.test(name)) return "buffers";
    if (name === "readPixels") return "readPixels";
    for (const caller of ancestors) {
      const source = caller.url ? sourceOf(caller) : null;
      if (source) return ofSource(source);
    }
    return "other";
  }
  const source = sourceOf(callFrame);
  return source ? ofSource(source) : "other";
}

/**
 * The milliseconds inside `stops` (`[from, to)` pairs, page ms) by cause, and their sum. `samples`
 * is the report's profile laid on the page's clock: `{ ids, at, nodes, parent }`.
 */
export function stopsByCause(samples, stops, sourceOf) {
  const { ids, at, nodes, parent } = samples;
  const causes = new Map();
  const causeAt = (id) => {
    if (!causes.has(id)) {
      const ancestors = [];
      for (let p = parent.get(id); p !== undefined; p = parent.get(p)) ancestors.push(nodes.get(p).callFrame);
      causes.set(id, causeOf(nodes.get(id).callFrame, ancestors, sourceOf));
    }
    return causes.get(id);
  };
  const ms = new Map();
  let total = 0;
  for (let i = 0; i < ids.length - 1; i++) {
    if (!stops.some(([from, to]) => at[i] >= from && at[i] < to)) continue;
    const cause = causeAt(ids[i]);
    if (cause === null) continue;
    const dt = at[i + 1] - at[i];
    ms.set(cause, (ms.get(cause) ?? 0) + dt);
    total += dt;
  }
  return { ms, total };
}
