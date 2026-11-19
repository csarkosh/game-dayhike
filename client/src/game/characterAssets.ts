/**
 * The characters the game draws, as the catalog names them: each one's
 * model file, the clip that plays each role in it, and which of a fixed
 * list an entity wears. Plain data and arithmetic, so whichever renderer
 * draws a character asks the same file for the same clip.
 */
import { modelUrl } from "./assetUrls.js";

export type ClipKind = "idle" | "walk" | "attack" | "death";

const SYNONYMS: Record<ClipKind, string[]> = {
  idle: ["idle", "stand"],
  walk: ["walk", "run", "move", "jog"],
  attack: ["attack", "punch", "swipe", "hit", "melee"],
  death: ["death", "die", "dead"],
};

export function pickClip(names: string[], want: ClipKind): string | null {
  const wanted = SYNONYMS[want];
  for (const synonym of wanted) {
    for (const name of names) {
      // Match against the segment after any exporter prefix like
      // "CharacterArmature|Attack_01", but fall back to the whole string.
      const tail = name.includes("|") ? (name.split("|").pop() as string) : name;
      if (tail.toLowerCase().includes(synonym) || name.toLowerCase().includes(synonym)) {
        return name;
      }
    }
  }
  return null;
}
export type CharacterAsset = {
  /** The catalog's own `id`. Keys the pool's loaded-model map. */
  id: string;
  /** The catalog's `output`, relative to `client/assets/`. */
  output: string;
  url: string;
  clips: Partial<Record<ClipKind, string>>;
};

/**
 * Every character asset in the catalog, in catalog order.
 *
 * The URL is derived rather than hardcoded: shipped output lives under
 * `client/assets/`, keyed by the catalog's `output` field. `modelUrl` turns
 * that into whatever Vite serves the file at — content-hashed in production.
 * Reading the catalog here means adding a character needs no code change and
 * the two cannot drift apart; going through `modelUrl` means a catalog entry
 * with no shipped file behind it throws at startup instead of 404ing into a
 * capsule.
 *
 * Returns an empty array when no character asset is present. Every character
 * then stays a capsule.
 */
export function resolveCharacterAssets(
  source: unknown,
  urlFor: (output: string) => string = modelUrl,
): CharacterAsset[] {
  if (typeof source !== "object" || source === null) return [];
  const entries = (source as { assets?: unknown }).assets;
  if (!Array.isArray(entries)) return [];

  const found: CharacterAsset[] = [];
  for (const entry of entries) {
    if (typeof entry !== "object" || entry === null) continue;
    const asset = entry as {
      id?: unknown;
      kind?: unknown;
      output?: unknown;
      animations?: unknown;
    };
    if (asset.kind !== "character") continue;
    if (typeof asset.id !== "string" || asset.id.length === 0) continue;
    if (typeof asset.output !== "string" || asset.output.length === 0) continue;

    const clips: Partial<Record<ClipKind, string>> = {};
    const named = asset.animations;
    if (typeof named === "object" && named !== null) {
      for (const kind of ["idle", "walk", "attack", "death"] as const) {
        const value = (named as Record<string, unknown>)[kind];
        if (typeof value === "string" && value.length > 0) clips[kind] = value;
      }
    }
    found.push({ id: asset.id, output: asset.output, url: urlFor(asset.output), clips });
  }
  return found;
}

/**
 * Which entry of a fixed list an entity wears, derived from its id.
 *
 * Round-robin rather than a hash. The host and every client build views
 * independently, so deriving the choice from the id makes it replicated by
 * construction — nothing about model assignment crosses the wire, and nothing
 * has to. A random draw at spawn would show two players different models for
 * the same entity. Round-robin also guarantees a mix at small counts, where a
 * hash would clump. The list must be a fixed one, never whatever happened to
 * load, or peers would disagree the moment one of them failed a download.
 */
export function variantForId<T>(list: readonly T[], id: number): T | null {
  if (list.length === 0) return null;
  return list[Math.abs(Math.trunc(id)) % list.length] ?? null;
}

/**
 * Which clip in a shipped file plays a given role, for one asset.
 *
 * The catalog's mapping wins, because a mapped clip that is absent from the
 * shipped file fails validation before it ships — so a declared name that is
 * present is verified, not guessed. `pickClip` is the fallback for a model
 * whose clips were never mapped, or one that renamed them in a later release.
 */
export function clipNameFor(
  asset: Pick<CharacterAsset, "clips">,
  available: readonly string[],
  kind: ClipKind,
): string | null {
  const declared = asset.clips[kind];
  if (declared !== undefined && available.includes(declared)) return declared;
  return pickClip([...available], kind);
}
