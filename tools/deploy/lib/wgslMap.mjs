// Checking the deployed WGSL map: the translations the build made of the
// shader corpus (`tools/wgsl/build-map.mjs`), which the WebGPU chunk names as
// a content-hashed asset (`client/src/game/gpuEngine.ts`,
// `virtual:dayhike-wgsl-map`; `findMapUrl` finds it). A pure function over
// the texts `verify.mjs` fetched, so it is testable without a network.

/**
 * What is wrong with a deployed map (`mapText`) for the WebGPU chunk that
 * names it (`chunkSource`) and the rest of the bundle (`bundleSource`, the
 * entry chunk, which carries Babylon), or nothing: it parses; its format is
 * one the chunk reads; its salt is the bundle's, the translators' digests the
 * build baked in (`__WGSL_TRANSLATORS__`), the key's format, Babylon's version
 * and, where the bundle shows it, Babylon's page-wide uniformity switch; and
 * it holds translations: a table of lines, each a text without a newline, and
 * entries, each runs of lines in the table (`[start, length, ...]`, as the
 * page reads them: `readMap`), at least one expanding to text. A map of
 * another salt is never asked by the page, nor a damaged one read: every
 * stage would be translated as if there were none.
 */
export function mapProblems(mapText, chunkSource, bundleSource = '') {
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
  const bundle = `${chunkSource}\n${bundleSource}`;
  const babylon = salt.match(/\|babylon=([^|]*)\|/)?.[1];
  if (babylon === undefined) {
    problems.push('its salt names no Babylon version');
  } else if (!new RegExp(`["'\`]${babylon.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}["'\`]`).test(bundle)) {
    problems.push(`its salt was made against Babylon ${babylon}, which the bundle does not carry`);
  }
  const switched = bundle.match(/DisableUniformityAnalysis\s*=\s*(!0|!1|true|false)\b/)?.[1];
  const bundleUA = switched === undefined ? undefined : switched === '!0' || switched === 'true' ? 'true' : 'false';
  const saltUA = salt.match(/\|staticUA=(true|false)$/)?.[1];
  if (bundleUA !== undefined && saltUA !== bundleUA) {
    problems.push(`its salt's uniformity switch, ${saltUA}, is not the bundle's, ${bundleUA}`);
  }
  const lines = map.lines;
  const entries = map.entries;
  if (!Array.isArray(lines)) {
    problems.push('it has no table of lines');
  } else if (!lines.every((line) => typeof line === 'string' && !line.includes('\n'))) {
    problems.push('a line of its table is not text without a newline');
  } else if (typeof entries !== 'object' || entries === null || Array.isArray(entries)) {
    problems.push('it has no entries');
  } else if (Object.keys(entries).length === 0) {
    problems.push('it is empty');
  } else if (!Object.values(entries).every((runs) => runsInTable(runs, lines.length))) {
    problems.push('an entry is not runs of the lines in its table');
  } else if (!Object.values(entries).some((runs) => expandsToText(runs, lines))) {
    problems.push('no entry expands to WGSL text');
  }
  return problems;
}

/** Whether `runs` is `[start, length, ...]`, at least one run, each of whole
 * numbers, of one line or more, inside a table of `count` lines. */
function runsInTable(runs, count) {
  if (!Array.isArray(runs) || runs.length === 0 || runs.length % 2 !== 0) return false;
  for (let i = 0; i < runs.length; i += 2) {
    const [start, length] = [runs[i], runs[i + 1]];
    if (!Number.isInteger(start) || !Number.isInteger(length) || start < 0 || length < 1 || start + length > count) return false;
  }
  return true;
}

/** Whether the entry of `runs` expands to text: more than one line, or one
 * that is not empty. */
function expandsToText(runs, lines) {
  let count = 0;
  for (let i = 1; i < runs.length; i += 2) count += runs[i];
  return count > 1 || lines[runs[0]].length > 0;
}
