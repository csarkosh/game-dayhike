/** One mode a game can be played in: its id as the address and the storage hold it, its label, and the one line under the select. */
export type ModeChoice = { readonly id: string; readonly label: string; readonly line: string };

/** A game's modes, in the order the screen offers them. */
export type ModeList = {
  readonly modes: readonly ModeChoice[];
  /** The mode where nothing is chosen: one of the ids. */
  readonly initial: string;
  /** The localStorage key the player's choice is kept under. */
  readonly key: string;
  /** The pause screen's line under the mode: what picking another does there. */
  readonly restarts: string;
};

/** Whether `value` is the id of one of the list's modes. */
export function isMode(list: ModeList, value: unknown): value is string {
  return list.modes.some((m) => m.id === value);
}

/** The saved choice, or the initial mode where nothing (or nothing recognisable) is saved or the storage refuses. */
export function readMode(list: ModeList, storage: Storage | null): string {
  if (storage === null) return list.initial;
  try {
    const value = storage.getItem(list.key);
    return isMode(list, value) ? value : list.initial;
  } catch {
    return list.initial;
  }
}

/** Keeps the choice; false where there is no storage or it refuses. */
export function writeMode(list: ModeList, storage: Storage | null, mode: string): boolean {
  if (storage === null) return false;
  try {
    storage.setItem(list.key, mode);
    return true;
  } catch {
    return false;
  }
}

/**
 * The player's choice for the page's life: read from and kept in `storage()`
 * where it can be, and held here where a write is refused, as the graphics
 * choice is kept (`tierChoice.ts`).
 */
export function createModeKeeper(list: ModeList, storage: () => Storage | null): { mode(): string; save(mode: string): void } {
  let held: string | null = null;
  return {
    mode: () => held ?? readMode(list, storage()),
    save(mode) {
      held = writeMode(list, storage(), mode) ? null : mode;
    },
  };
}
