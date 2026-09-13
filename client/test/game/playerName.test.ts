import { describe, it, expect } from "vitest";
import { NAME_KEY, defaultName, loadName, saveName } from "../../src/game/playerName.js";

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
    expect(defaultName(() => 0)).toBe("Hiker-0000");
    expect(defaultName(() => 0.99999)).toBe("Hiker-9999");
    expect(defaultName()).toMatch(/^Hiker-\d{4}$/);
  });
});

describe("loadName", () => {
  it("generates, saves, and then returns the same default", () => {
    const store = new MemoryStore();
    const first = loadName(store, () => 0.4821);
    expect(first).toBe("Hiker-4821");
    expect(store.getItem(NAME_KEY)).toBe("Hiker-4821");
    expect(loadName(store, () => 0.1)).toBe("Hiker-4821");
  });
  it("sanitises whatever is stored", () => {
    const store = new MemoryStore();
    store.setItem(NAME_KEY, "   ");
    expect(loadName(store)).toBe("Hiker");
    store.setItem(NAME_KEY, "x".repeat(40));
    expect(loadName(store)).toBe("x".repeat(24));
  });
  it("survives a browser that refuses storage", () => {
    expect(loadName(new RefusingStore(), () => 0.5)).toBe("Hiker-5000");
    expect(loadName(null, () => 0.5)).toBe("Hiker-5000");
  });
});

describe("saveName", () => {
  it("trims, clamps, stores, and returns what it stored", () => {
    const store = new MemoryStore();
    expect(saveName("  Sam ", store)).toBe("Sam");
    expect(store.getItem(NAME_KEY)).toBe("Sam");
    expect(saveName("", store)).toBe("Hiker");
  });
  it("still returns a usable name when storage refuses", () => {
    expect(saveName("Sam", new RefusingStore())).toBe("Sam");
  });
});
