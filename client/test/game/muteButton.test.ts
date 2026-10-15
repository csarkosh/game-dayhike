import { describe, it, expect } from "vitest";
import { MUTE_KEY, createMuteButton, muteLabel, readMuted, writeMuted } from "../../src/game/muteButton.js";
import { StandInElement, asHtml, installStandInDom } from "./helpers/standInDom.js";

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

describe("the page's mute", () => {
  it("is kept under its key as a flag, off where nothing is kept or there is no storage", () => {
    const storage = memoryStorage();
    expect(readMuted(storage)).toBe(false);
    expect(writeMuted(storage, true)).toBe(true);
    expect(storage.getItem(MUTE_KEY)).toBe("1");
    expect(readMuted(storage)).toBe(true);
    expect(writeMuted(storage, false)).toBe(true);
    expect(storage.getItem(MUTE_KEY)).toBeNull();
    expect(readMuted(null)).toBe(false);
    expect(writeMuted(null, true)).toBe(false);
  });

  it("names what a press does", () => {
    expect(muteLabel(false)).toBe("Sound off");
    expect(muteLabel(true)).toBe("Sound on");
  });

  it("draws one button on its host, the speaker or the speaker struck through, pressed and told on a click, faint over a hike", () => {
    const doc = installStandInDom();
    const host = doc.createElement("div");
    doc.body.append(host);
    const heard: boolean[] = [];
    const mute = createMuteButton(asHtml(host), { muted: false, onChange: (on) => heard.push(on) });
    const button = host.querySelector("button") as StandInElement;
    expect(button.classList.contains("mute")).toBe(true);
    expect(button.getAttribute("aria-label")).toBe("Sound off");
    expect(button.getAttribute("aria-pressed")).toBe("false");
    expect(button.querySelector("svg")?.descendants()).toHaveLength(3);
    button.click();
    expect(mute.muted()).toBe(true);
    expect(heard).toEqual([true]);
    expect(button.getAttribute("aria-label")).toBe("Sound on");
    expect(button.getAttribute("aria-pressed")).toBe("true");
    expect(button.classList.contains("on")).toBe(true);
    // Set from outside: drawn and told once, and not again for the same state.
    mute.set(false);
    mute.set(false);
    expect(heard).toEqual([true, false]);
    expect(button.classList.contains("on")).toBe(false);
    mute.setFaint(true);
    expect(button.classList.contains("faint")).toBe(true);
    mute.setFaint(false);
    expect(button.classList.contains("faint")).toBe(false);
    mute.dispose();
    expect(host.querySelector("button")).toBeNull();
    expect(host.querySelector("style")).toBeNull();
  });
});
