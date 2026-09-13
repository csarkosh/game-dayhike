// Pure decisions of the desktop release, kept out of desktop.mjs so they can
// be tested without a network, a bucket, or a Mac.
import path from 'node:path';

const SEMVER = /^(\d+)\.(\d+)\.(\d+)$/;
const SHA256 = /^[0-9a-f]{64}$/;

export function parseSemver(v) {
  const m = SEMVER.exec(v);
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null;
}

export function isGreater(a, b) {
  const x = parseSemver(a);
  const y = parseSemver(b);
  if (!x || !y) return false;
  for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] > y[i];
  return false;
}

/** Must match `mac.artifactName` in desktop/electron-builder.cjs. */
export function dmgName(version) {
  return `DayHike-${version}-arm64.dmg`;
}

export function frameworkPathIn(appDir) {
  return path.join(appDir, 'Contents', 'Frameworks', 'Electron Framework.framework', 'Versions', 'A', 'Electron Framework');
}

/** `<sha256> *<name>` per line — upstream's and the mirror's SHASUMS256.txt. */
export function parseShasums(text) {
  const out = new Map();
  for (const line of text.split('\n')) {
    const m = /^([0-9a-f]{64}) \*?(.+)$/.exec(line.trim());
    if (m) out.set(m[2], m[1]);
  }
  return out;
}

export const PLATFORMS = ['darwin-arm64', 'win32-x64'];

/** Must match `win.artifactName` in desktop/electron-builder.cjs. */
export function installerName(version) {
  return `DayHike-Setup-${version}-x64.exe`;
}

/**
 * The bucket object a local artifact is uploaded as: its electron-builder name
 * with the first 8 hex characters of its own sha256 inserted before the
 * extension.
 *
 * Uploads are immutable and cached for a year, so a fixed per-version name is a
 * trap: builds are not deterministic, and a retried release of the same version
 * would overwrite the object with different bytes while the CDN went on serving
 * the earlier, unsmoked ones under the advertised URL. Naming each attempt after
 * its own bytes makes that impossible — a new attempt is a new object, and
 * latest.json (the only pointer) names the one that was actually smoked.
 */
export function objectName(localName, sha256) {
  if (typeof localName !== 'string' || localName === '') throw new Error('objectName: localName is required');
  if (typeof sha256 !== 'string' || !SHA256.test(sha256)) throw new Error(`objectName: ${sha256} is not a lowercase sha256`);
  const sha8 = sha256.slice(0, 8);
  const dot = localName.lastIndexOf('.');
  return dot <= 0 ? `${localName}-${sha8}` : `${localName.slice(0, dot)}-${sha8}${localName.slice(dot)}`;
}

function checkEntry(platform, e) {
  if (!e || typeof e !== 'object') throw new Error(`latest.json: ${platform}: not an object`);
  if (typeof e.url !== 'string' || !e.url.startsWith('https://')) throw new Error(`latest.json: ${platform}: bad url ${e.url}`);
  if (typeof e.sha256 !== 'string' || !SHA256.test(e.sha256)) throw new Error(`latest.json: ${platform}: bad sha256`);
  if (!Number.isInteger(e.size) || e.size <= 0) throw new Error(`latest.json: ${platform}: bad size ${e.size}`);
  return { url: e.url, sha256: e.sha256, size: e.size };
}

/**
 * The exact document the site and the app read. Top-level url/sha256/size are
 * the macOS build — desktop 0.1.x reads only those — and `platforms` carries
 * every build. Validated: a bad one would be served to every player.
 */
export function latestJson({ version, publishedAt, platforms }) {
  if (!parseSemver(version)) throw new Error(`latest.json: bad version ${version}`);
  if (Number.isNaN(Date.parse(publishedAt))) throw new Error(`latest.json: bad publishedAt ${publishedAt}`);
  if (!platforms || typeof platforms !== 'object') throw new Error('latest.json: platforms missing');
  for (const p of Object.keys(platforms)) if (!PLATFORMS.includes(p)) throw new Error(`latest.json: unknown platform ${p}`);
  if (!platforms['darwin-arm64']) throw new Error('latest.json: darwin-arm64 entry is required');
  const clean = Object.fromEntries(PLATFORMS.filter((p) => platforms[p]).map((p) => [p, checkEntry(p, platforms[p])]));
  const mac = clean['darwin-arm64'];
  return `${JSON.stringify({ version, url: mac.url, sha256: mac.sha256, size: mac.size, publishedAt, platforms: clean }, null, 2)}\n`;
}

/**
 * The same rules `latestJson` enforces, applied to a document fetched off the
 * network rather than one this process built — so `verify.mjs` never trusts a
 * malformed `latest.json` far enough to read its fields. `null` on any
 * violation; the caller turns that into one failure rather than a crash deep
 * inside the HEAD checks that follow.
 */
export function validateLatest(json) {
  if (json === null || typeof json !== 'object') return null;
  const { version, url, sha256, size, publishedAt, platforms } = json;
  if (!parseSemver(version)) return null;
  if (typeof publishedAt !== 'string' || Number.isNaN(Date.parse(publishedAt))) return null;
  let top;
  try {
    top = checkEntry('top-level', { url, sha256, size });
  } catch {
    return null;
  }
  let clean;
  if (platforms === undefined) {
    clean = { 'darwin-arm64': top };
  } else {
    if (platforms === null || typeof platforms !== 'object') return null;
    try {
      for (const p of Object.keys(platforms)) if (!PLATFORMS.includes(p)) throw new Error(p);
      clean = Object.fromEntries(Object.keys(platforms).map((p) => [p, checkEntry(p, platforms[p])]));
    } catch {
      return null;
    }
    const mac = clean['darwin-arm64'];
    if (!mac || mac.url !== top.url || mac.sha256 !== top.sha256 || mac.size !== top.size) return null;
  }
  return { version, url, sha256, size, publishedAt, platforms: clean };
}

/**
 * Does this binary still carry the patch?
 *
 * The mirror publishes `electron-v<ver>-<platform>.patches.json` beside each
 * zip: for every patch site, the file offset and the `old`/`new` bytes. Reading
 * those bytes straight out of a packaged binary answers the release's actual
 * question — "is the pointer-lock patch in the thing a player will run?" —
 * without going through the checksum chain or the section compare. Those prove
 * provenance (these bytes came from the mirror); this proves content, and would
 * still fail if the mirror itself ever shipped an unpatched zip under a
 * correct checksum.
 *
 * Pure: a Buffer and the parsed record in, `{ ok, checked, mismatches }` out.
 * `checked === 0` is reported, not rejected — a record with no sites is an
 * empty proof, and the caller is the one who knows that is unacceptable.
 */
export function sitesMatch(buffer, record) {
  const patches = record?.patches ?? [];
  if (!Array.isArray(patches)) throw new Error('patches record: `patches` is not an array');
  const mismatches = [];
  let checked = 0;
  for (const patch of patches) {
    for (const site of patch?.sites ?? []) {
      const expected = String(site?.new ?? '').toLowerCase();
      if (!/^([0-9a-f]{2})+$/.test(expected)) {
        throw new Error(`patches record: ${patch?.name}: site at offset ${site?.offset} has no usable \`new\` bytes (${JSON.stringify(site?.new)})`);
      }
      if (!Number.isInteger(site.offset) || site.offset < 0) {
        throw new Error(`patches record: ${patch?.name}: site has a bad \`offset\` (${JSON.stringify(site.offset)})`);
      }
      checked++;
      const found = buffer.subarray(site.offset, site.offset + expected.length / 2).toString('hex');
      if (found !== expected) {
        mismatches.push({ patch: patch?.name, symbol: site.symbol, offset: site.offset, expected, found });
      }
    }
  }
  return { ok: mismatches.length === 0, checked, mismatches };
}

/**
 * A cached download is only as trustworthy as the digest it was last checked
 * against. Skip-if-exists plus a cached checksum file is a closed loop: the
 * mirror can re-cut a tag and both stale files go on agreeing with each other
 * while the build packages bytes nobody publishes any more. So the checksum is
 * always fetched fresh, and this decides what to do with the file: download it
 * when missing, and on a digest mismatch delete it and re-download exactly
 * once — never in a loop, because a mirror serving the wrong bytes is a
 * failure to report, not to retry through.
 *
 * `io` is injected ({ exists, digest, remove, download }) so the decision is
 * testable without a network or a filesystem.
 *
 * `downloaded` is reported separately from `refetched` because the caller has
 * to invalidate anything it unpacked from the previous file, and "the zip was
 * missing" is as much a reason to do that as "the zip was stale": a
 * hand-deleted zip beside a leftover unpacked directory is otherwise the one
 * case where fresh bytes land on disk and the stale tree is still used.
 */
export async function verifyOrRefetch(dest, expected, io) {
  if (!io.exists(dest)) {
    await io.download(dest);
    const first = io.digest(dest);
    if (first !== expected) throw new Error(`${dest} does not match the mirror's checksum (expected ${expected}, got ${first})`);
    return { path: dest, downloaded: true, refetched: false };
  }
  if (io.digest(dest) === expected) return { path: dest, downloaded: false, refetched: false };
  io.remove(dest);
  await io.download(dest);
  const got = io.digest(dest);
  if (got !== expected) {
    throw new Error(`${dest} still does not match the mirror's checksum after re-downloading (expected ${expected}, got ${got})`);
  }
  return { path: dest, downloaded: true, refetched: true };
}
