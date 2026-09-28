// Checking the deployed WGSL map: the translations the build made of the
// shader corpus (`tools/wgsl/build-map.mjs`), which the WebGPU chunk names as
// a content-hashed asset (`client/src/game/gpuEngine.ts`,
// `virtual:dayhike-wgsl-map`; `findMapUrl` finds it). A pure function over
// the texts `verify.mjs` fetched, so it is testable without a network.

/**
 * What is wrong with a deployed map (`mapText`) for the WebGPU chunk that
 * names it (`chunkSource`), or nothing: it parses; its format is one the chunk
 * reads; its salt is the chunk's, the translators' digests the build baked in
 * (`__WGSL_TRANSLATORS__`) and the key's format; and it holds translations.
 * A map of another salt is never asked by the page: every stage would be
 * translated as if there were none.
 */
export function mapProblems(mapText, chunkSource) {
  let map;
  try {
    map = JSON.parse(mapText);
  } catch {
    return ['the map does not parse as JSON'];
  }
  if (typeof map !== 'object' || map === null) return ['the map is not an object'];
  const problems = [];
  if (typeof map.format !== 'string' || !/^dayhike-wgsl-map\/\d+$/.test(map.format) || !chunkSource.includes(map.format)) {
    problems.push(`its format ${JSON.stringify(map.format)} is not the one the WebGPU chunk reads`);
  }
  const translators = chunkSource.match(/glslang=[0-9a-f]{64}\|twgsl=[0-9a-f]{64}\|glslang\.js=[0-9a-f]{64}\|twgsl\.js=[0-9a-f]{64}/)?.[0];
  const salt = typeof map.salt === 'string' ? map.salt : '';
  const keyFormat = salt.split('|')[0];
  if (!translators) {
    problems.push('the WebGPU chunk carries no translators\' digests to check the salt against');
  } else if (!salt.includes(`|${translators}|`) || !/^dayhike-wgsl\/\d+$/.test(keyFormat) || !chunkSource.includes(keyFormat)) {
    problems.push(`its salt ${JSON.stringify(salt.slice(0, 80))}… is not this build's`);
  }
  const entries = map.entries;
  if (typeof entries !== 'object' || entries === null || Array.isArray(entries)) {
    problems.push('it has no entries');
  } else if (Object.keys(entries).length === 0) {
    problems.push('it is empty');
  } else if (!Object.values(entries).every((wgsl) => typeof wgsl === 'string' && wgsl.length > 0)) {
    problems.push('an entry is not WGSL text');
  }
  return problems;
}
