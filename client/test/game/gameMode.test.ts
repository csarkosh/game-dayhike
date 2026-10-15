import { describe, it, expect } from "vitest";
import {
  DEFAULT_MODE, GAME_MODES, MODE_KEY, MODE_LABELS, MODE_LINES, createModeKeeper, isGameMode, peaceful, readMode, writeMode,
} from "../../src/game/gameMode.js";

function memoryStorage(): Storage {
  const map = new Map<string, string>();
  return {
    get length() { return map.size; },
    clear: () => map.clear(),
    getItem: (k) => map.get(k) ?? null,
    key: (i) => [...map.keys()][i] ?? null,
    removeItem: (k) => void map.delete(k),
    setItem: (k, v) => void map.set(k, v),
  };
}

function refusingStorage(): Storage {
  const s = memoryStorage();
  return { ...s, setItem: () => { throw new Error("refused"); } };
}

describe("the mode", () => {
  it("offers the hike first and as the default, then explore and the free camera, each with a label and a line", () => {
    expect(GAME_MODES).toEqual(["game", "explore", "freecam"]);
    expect(DEFAULT_MODE).toBe("game");
    for (const mode of GAME_MODES) {
      expect(MODE_LABELS[mode].length).toBeGreaterThan(0);
      expect(MODE_LINES[mode].length).toBeGreaterThan(0);
    }
    expect(MODE_LABELS).toEqual({ game: "Game", explore: "Explore", freecam: "Free camera" });
  });

  it("knows its own names and no other", () => {
    for (const mode of GAME_MODES) expect(isGameMode(mode)).toBe(true);
    expect(isGameMode("peaceful")).toBe(false);
    expect(isGameMode(null)).toBe(false);
    expect(isGameMode(undefined)).toBe(false);
  });

  it("is peaceful in the two explore modes and not in the hike", () => {
    expect(peaceful("game")).toBe(false);
    expect(peaceful("explore")).toBe(true);
    expect(peaceful("freecam")).toBe(true);
  });

  it("reads the saved mode under its key, and the default where nothing or nonsense is saved, or there is no storage", () => {
    const storage = memoryStorage();
    expect(readMode(storage)).toBe("game");
    expect(writeMode(storage, "explore")).toBe(true);
    expect(storage.getItem(MODE_KEY)).toBe("explore");
    expect(readMode(storage)).toBe("explore");
    storage.setItem(MODE_KEY, "haunted");
    expect(readMode(storage)).toBe("game");
    expect(readMode(null)).toBe("game");
    expect(writeMode(null, "freecam")).toBe(false);
  });

  it("keeps the choice for the page where the storage refuses a write, and lets it go once one succeeds", () => {
    const refusing = refusingStorage();
    let storage: Storage | null = refusing;
    const keeper = createModeKeeper(() => storage);
    expect(keeper.mode()).toBe("game");
    keeper.save("freecam");
    expect(keeper.mode()).toBe("freecam");
    const keeping = memoryStorage();
    storage = keeping;
    keeper.save("explore");
    expect(keeper.mode()).toBe("explore");
    expect(keeping.getItem(MODE_KEY)).toBe("explore");
    keeping.setItem(MODE_KEY, "game");
    expect(keeper.mode()).toBe("game");
  });
});
