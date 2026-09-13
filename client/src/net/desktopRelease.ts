/**
 * The desktop release metadata the site and the app both read: `latest.json`
 * in the downloads bucket, written last by `tools/deploy/desktop.mjs`.
 *
 * Pure and dependency-free so it can live in net/ and be tested headless.
 */
export type Platform = "darwin-arm64" | "win32-x64";
export const PLATFORMS: readonly Platform[] = ["darwin-arm64", "win32-x64"];

export type DesktopBuild = { url: string; sha256: string; size: number };

/** The desktop release the site and the app both read. */
export type DesktopRelease = {
  version: string;
  platforms: Partial<Record<Platform, DesktopBuild>>;
};

const SEMVER = /^(\d+)\.(\d+)\.(\d+)$/;
const SHA256 = /^[0-9a-f]{64}$/;

export function parseVersion(v: string): [number, number, number] | null {
  const m = SEMVER.exec(v);
  if (!m) return null;
  return [Number(m[1]), Number(m[2]), Number(m[3])];
}

/** True when `candidate` is a strictly newer semver than `current`. */
export function isNewer(candidate: string, current: string): boolean {
  const a = parseVersion(candidate);
  const b = parseVersion(current);
  if (a === null || b === null) return false;
  for (let i = 0; i < 3; i++) {
    if (a[i] !== b[i]) return (a[i] as number) > (b[i] as number);
  }
  return false;
}

function parseBuild(o: unknown): DesktopBuild | null {
  if (typeof o !== "object" || o === null || Array.isArray(o)) return null;
  const { url, sha256, size } = o as Record<string, unknown>;
  if (typeof url !== "string" || !url.startsWith("https://")) return null;
  if (typeof sha256 !== "string" || !SHA256.test(sha256)) return null;
  if (typeof size !== "number" || !Number.isInteger(size) || size <= 0) return null;
  return { url, sha256, size };
}

/**
 * Validates `latest.json`. Two shapes are accepted: the 0.1.x document, whose
 * top-level url/sha256/size describe the macOS build, and the current one,
 * which adds a `platforms` map. Anything malformed is `null` rather than a
 * partial object; an unknown platform key is ignored, a malformed known one
 * rejects the document.
 */
export function parseLatest(json: unknown): DesktopRelease | null {
  if (typeof json !== "object" || json === null || Array.isArray(json)) return null;
  const o = json as Record<string, unknown>;
  if (typeof o.version !== "string" || parseVersion(o.version) === null) return null;
  const top = parseBuild(o);
  if (top === null) return null;
  const platforms: Partial<Record<Platform, DesktopBuild>> = {};
  if (o.platforms === undefined) {
    platforms["darwin-arm64"] = top;
  } else {
    if (typeof o.platforms !== "object" || o.platforms === null) return null;
    for (const [key, entry] of Object.entries(o.platforms as Record<string, unknown>)) {
      if (!(PLATFORMS as readonly string[]).includes(key)) continue;
      const build = parseBuild(entry);
      if (build === null) return null;
      platforms[key as Platform] = build;
    }
  }
  return { version: o.version, platforms };
}

/** "155 MB": SI megabytes, whole numbers — a download size, not a disk audit. */
export function formatSize(bytes: number): string {
  return `${Math.max(1, Math.round(bytes / 1_000_000))} MB`;
}
