import { describe, it, expect } from "vitest";
import { createModeKeeper, isMode, readMode, writeMode, type ModeList } from "@csarkosh/engine/game/modeList";

const LIST: ModeList = {
  modes: [
    { id: "calm", label: "Calm", line: "Nothing happens." },
    { id: "busy", label: "Busy", line: "Everything happens." },
  ],
  initial: "calm",
  key: "test.mode",
  restarts: "Picking another restarts.",
};

function storageOf(initial: Record<string, string> = {}): Storage & { data: Record<string, string> } {
  const data = { ...initial };
  return {
    data,
    getItem: (k: string) => data[k] ?? null,
    setItem: (k: string, v: string) => void (data[k] = v),
  } as unknown as Storage & { data: Record<string, string> };
}

const refusing = {
  getItem: () => {
    throw new Error("refused");
  },
  setItem: () => {
    throw new Error("refused");
  },
} as unknown as Storage;

describe("isMode", () => {
  it("recognises the list's ids and nothing else", () => {
    expect(isMode(LIST, "calm")).toBe(true);
    expect(isMode(LIST, "busy")).toBe(true);
    expect(isMode(LIST, "game")).toBe(false);
    expect(isMode(LIST, "")).toBe(false);
    expect(isMode(LIST, null)).toBe(false);
    expect(isMode(LIST, 3)).toBe(false);
  });
});

describe("readMode", () => {
  it("reads the saved choice", () => {
    expect(readMode(LIST, storageOf({ "test.mode": "busy" }))).toBe("busy");
  });

  it("falls back to the initial mode on nothing saved, an unknown value, no storage and a storage that throws", () => {
    expect(readMode(LIST, storageOf())).toBe("calm");
    expect(readMode(LIST, storageOf({ "test.mode": "game" }))).toBe("calm");
    expect(readMode(LIST, null)).toBe("calm");
    expect(readMode(LIST, refusing)).toBe("calm");
  });
});

describe("writeMode", () => {
  it("keeps the choice under the list's key and says so", () => {
    const s = storageOf();
    expect(writeMode(LIST, s, "busy")).toBe(true);
    expect(s.data).toEqual({ "test.mode": "busy" });
  });

  it("reports false on no storage or a storage that throws", () => {
    expect(writeMode(LIST, null, "busy")).toBe(false);
    expect(writeMode(LIST, refusing, "busy")).toBe(false);
  });
});

describe("createModeKeeper", () => {
  it("reads from and writes to the storage", () => {
    const s = storageOf();
    const keeper = createModeKeeper(LIST, () => s);
    expect(keeper.mode()).toBe("calm");
    keeper.save("busy");
    expect(s.data["test.mode"]).toBe("busy");
    expect(keeper.mode()).toBe("busy");
  });

  it("holds a choice the storage refused", () => {
    const keeper = createModeKeeper(LIST, () => refusing);
    keeper.save("busy");
    expect(keeper.mode()).toBe("busy");
    expect(createModeKeeper(LIST, () => null).mode()).toBe("calm");
  });
});
