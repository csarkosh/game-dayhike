import { sanitiseName } from "@csarkosh/engine/net/lobby";

/**
 * The name shown in the roster. Kept in localStorage so it
 * survives visits, generated once so the default is stable rather than a new
 * number every reload. Storage access is wrapped: a private window or a
 * browser set to block site data throws on the accessor itself. Where it is
 * kept and what a made name starts with are the game's (`NameOf`).
 */

/** A game's own of the player's name: the key it is kept under between visits, and the word a name made for a new visitor starts with. */
export type NameOf = { key: string; prefix: string };

export type NameStore = Pick<Storage, "getItem" | "setItem">;

function browserStore(): NameStore | null {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    return null;
  }
}

export function defaultName(prefix: string, random: () => number = Math.random): string {
  const n = Math.min(9999, Math.floor(random() * 10000));
  return `${prefix}-${String(n).padStart(4, "0")}`;
}

export function loadName(of: NameOf, store: NameStore | null = browserStore(), random: () => number = Math.random): string {
  try {
    const stored = store?.getItem(of.key);
    if (typeof stored === "string") return sanitiseName(stored);
  } catch {
    /* storage refused: fall through to a per-visit default */
  }
  const fresh = defaultName(of.prefix, random);
  try {
    store?.setItem(of.key, fresh);
  } catch {
    /* ditto */
  }
  return fresh;
}

export function saveName(of: NameOf, raw: string, store: NameStore | null = browserStore()): string {
  const clean = sanitiseName(raw);
  try {
    store?.setItem(of.key, clean);
  } catch {
    /* the name is still in force for this visit */
  }
  return clean;
}
