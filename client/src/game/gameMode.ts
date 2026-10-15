/**
 * The mode a hike runs in: `game`, the hike as it is, the climb's three acts
 * and what walks out of the woods; `explore`, the same mountain with no one
 * in it and nothing to dread, under a day whose weather turns with the hour
 * (`exploreDay.ts`); `freecam`, explore with the camera freed at the start,
 * as `/freecam` frees it. Both peaceful modes keep the trail, the car, the
 * board and the headlamp.
 *
 * The mode is the world's: every peer runs the same one, so it travels as a
 * world entry of the address's script (`mode explore`, `commands.ts`), which
 * a follower takes from the host's address. The player's choice lives in
 * localStorage under `MODE_KEY`, read where the address names none; the
 * Settings screen keeps it (`settings.ts`), and a hike started on a saved
 * choice writes the entry into its address so an invite carries it.
 */
export type GameMode = "game" | "explore" | "freecam";

/** The modes, in the order the screen offers them: the hike first, and the default. */
export const GAME_MODES: readonly GameMode[] = ["game", "explore", "freecam"];

export const DEFAULT_MODE: GameMode = "game";

export const MODE_KEY = "dayhike.mode";

export const MODE_LABELS: Readonly<Record<GameMode, string>> = { game: "Game", explore: "Explore", freecam: "Free camera" };

/** One line a mode, under the select. */
export const MODE_LINES: Readonly<Record<GameMode, string>> = {
  game: "The hike as it is.",
  explore: "No one in the woods and nothing to dread; the weather turns with the hour.",
  freecam: "Explore, with the camera freed from the start.",
};

export function isGameMode(value: unknown): value is GameMode {
  return value === "game" || value === "explore" || value === "freecam";
}

/** Whether the mode's woods are empty and its sky never falls: explore and freecam. */
export function peaceful(mode: GameMode): boolean {
  return mode !== "game";
}

/** The saved choice, or the default where nothing (or nothing recognisable) is saved or the storage refuses. */
export function readMode(storage: Storage | null): GameMode {
  if (storage === null) return DEFAULT_MODE;
  try {
    const value = storage.getItem(MODE_KEY);
    return isGameMode(value) ? value : DEFAULT_MODE;
  } catch {
    return DEFAULT_MODE;
  }
}

/** Keeps the choice; false where there is no storage or it refuses. */
export function writeMode(storage: Storage | null, mode: GameMode): boolean {
  if (storage === null) return false;
  try {
    storage.setItem(MODE_KEY, mode);
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
export function createModeKeeper(storage: () => Storage | null): { mode(): GameMode; save(mode: GameMode): void } {
  let held: GameMode | null = null;
  return {
    mode: () => held ?? readMode(storage()),
    save(mode) {
      held = writeMode(storage(), mode) ? null : mode;
    },
  };
}
