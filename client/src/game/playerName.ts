import { sanitiseName } from "../net/lobby.js";

/**
 * The name shown in the roster. Kept in localStorage so it
 * survives visits, generated once so the default is stable rather than a new
 * number every reload. Storage access is wrapped: a private window or a
 * browser set to block site data throws on the accessor itself.
 */
export const NAME_KEY = "dayhike.playerName";

export type NameStore = Pick<Storage, "getItem" | "setItem">;

function browserStore(): NameStore | null {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    return null;
  }
}

export function defaultName(random: () => number = Math.random): string {
  const n = Math.min(9999, Math.floor(random() * 10000));
  return `Hiker-${String(n).padStart(4, "0")}`;
}

export function loadName(store: NameStore | null = browserStore(), random: () => number = Math.random): string {
  try {
    const stored = store?.getItem(NAME_KEY);
    if (typeof stored === "string") return sanitiseName(stored);
  } catch {
    /* storage refused: fall through to a per-visit default */
  }
  const fresh = defaultName(random);
  try {
    store?.setItem(NAME_KEY, fresh);
  } catch {
    /* ditto */
  }
  return fresh;
}

export function saveName(raw: string, store: NameStore | null = browserStore()): string {
  const clean = sanitiseName(raw);
  try {
    store?.setItem(NAME_KEY, clean);
  } catch {
    /* the name is still in force for this visit */
  }
  return clean;
}
