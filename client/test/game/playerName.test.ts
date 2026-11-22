import { describe, it, expect } from "vitest";
import { defaultName, loadName, saveName, type NameOf } from "@csarkosh/engine/game/playerName";
import { sourceText } from "../helpers/source.js";

/** Day Hike's own: where its name is kept, and what a made one starts with. */
const HIKE_NAME: NameOf = { key: "dayhike.playerName", prefix: "Hiker" };
const NAME_KEY = HIKE_NAME.key;

class MemoryStore {
  map = new Map<string, string>();
  getItem(k: string): string | null {
    return this.map.get(k) ?? null;
  }
  setItem(k: string, v: string): void {
    this.map.set(k, v);
  }
}

class RefusingStore {
  getItem(): string | null {
    throw new Error("SecurityError");
  }
  setItem(): void {
    throw new Error("SecurityError");
  }
}

describe("defaultName", () => {
  it("is Hiker- plus four digits, driven by the random source", () => {
    expect(defaultName("Hiker", () => 0)).toBe("Hiker-0000");
    expect(defaultName("Hiker", () => 0.99999)).toBe("Hiker-9999");
    expect(defaultName("Hiker")).toMatch(/^Hiker-\d{4}$/);
  });
});

describe("loadName", () => {
  it("generates, saves, and then returns the same default", () => {
    const store = new MemoryStore();
    const first = loadName(HIKE_NAME, store, () => 0.4821);
    expect(first).toBe("Hiker-4821");
    expect(store.getItem(NAME_KEY)).toBe("Hiker-4821");
    expect(loadName(HIKE_NAME, store, () => 0.1)).toBe("Hiker-4821");
  });
  it("sanitises whatever is stored", () => {
    const store = new MemoryStore();
    store.setItem(NAME_KEY, "   ");
    expect(loadName(HIKE_NAME, store)).toBe("Hiker");
    store.setItem(NAME_KEY, "x".repeat(40));
    expect(loadName(HIKE_NAME, store)).toBe("x".repeat(24));
  });
  it("survives a browser that refuses storage", () => {
    expect(loadName(HIKE_NAME, new RefusingStore(), () => 0.5)).toBe("Hiker-5000");
    expect(loadName(HIKE_NAME, null, () => 0.5)).toBe("Hiker-5000");
  });
});

describe("saveName", () => {
  it("trims, clamps, stores, and returns what it stored", () => {
    const store = new MemoryStore();
    expect(saveName(HIKE_NAME, "  Sam ", store)).toBe("Sam");
    expect(store.getItem(NAME_KEY)).toBe("Sam");
    expect(saveName(HIKE_NAME, "", store)).toBe("Hiker");
  });
  it("still returns a usable name when storage refuses", () => {
    expect(saveName(HIKE_NAME, "Sam", new RefusingStore())).toBe("Sam");
  });
});

describe("a game's own of the name", () => {
  it("is Day Hike's key and word for Day Hike, as they have always been", () => {
    expect(sourceText("hikePageGame.ts")).toContain('  name: { key: "dayhike.playerName", prefix: "Hiker" },');
    // The shell loads and saves it under whatever key the game hands it.
    expect(sourceText("shell.ts")).toContain("  let selfName = loadName(page.name);");
    expect(sourceText("shell.ts")).toContain("      selfName = saveName(page.name, raw);");
  });
  it("keeps another game's name under that game's key, made from that game's word", () => {
    const other: NameOf = { key: "other.playerName", prefix: "Walker" };
    const store = new MemoryStore();
    expect(loadName(other, store, () => 0.0731)).toBe("Walker-0731");
    expect(store.getItem("other.playerName")).toBe("Walker-0731");
    expect(store.getItem(NAME_KEY)).toBeNull();
    expect(saveName(other, " Ana ", store)).toBe("Ana");
    expect(store.getItem("other.playerName")).toBe("Ana");
    expect(loadName(HIKE_NAME, store, () => 0.5)).toBe("Hiker-5000");
    expect(loadName(other, store)).toBe("Ana");
  });
});
