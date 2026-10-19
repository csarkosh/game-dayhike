import { describe, it, expect } from "vitest";
import { MUTE_HOTKEY, MUTE_KEY, createMuteButton, isMuteKey, muteLabel, readMuted, writeMuted, type KeyPress } from "../../src/game/muteButton.js";
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
    const mute = createMuteButton(asHtml(host), { muted: false, showKey: false, onChange: (on) => heard.push(on) });
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
    mute.setHike(true);
    expect(button.classList.contains("hike")).toBe(true);
    mute.setHike(false);
    expect(button.classList.contains("hike")).toBe(false);
    mute.dispose();
    expect(host.querySelector("button")).toBeNull();
    expect(host.querySelector("style")).toBeNull();
  });

  it("takes M as its key, by the letter the layout types, never with a modifier, a repeat or a form control's letter", () => {
    const press = (over: Partial<KeyPress>): KeyPress => ({ key: "m", code: "KeyM", ctrlKey: false, altKey: false, metaKey: false, repeat: false, target: null, ...over });
    expect(MUTE_HOTKEY).toBe("M");
    expect(isMuteKey(press({}))).toBe(true);
    expect(isMuteKey(press({ key: "M" }))).toBe(true);
    // AZERTY types M one key along and a comma in M's place.
    expect(isMuteKey(press({ code: "Semicolon" }))).toBe(true);
    expect(isMuteKey(press({ key: "," }))).toBe(false);
    // A layout of another script: the key in M's place.
    expect(isMuteKey(press({ key: "ь" }))).toBe(true);
    expect(isMuteKey(press({ key: "ь", code: "KeyN" }))).toBe(false);
    expect(isMuteKey(press({ key: "n", code: "KeyN" }))).toBe(false);
    expect(isMuteKey(press({ ctrlKey: true }))).toBe(false);
    expect(isMuteKey(press({ altKey: true }))).toBe(false);
    expect(isMuteKey(press({ metaKey: true }))).toBe(false);
    expect(isMuteKey(press({ repeat: true }))).toBe(false);
    for (const tagName of ["INPUT", "TEXTAREA", "SELECT"]) expect(isMuteKey(press({ target: { tagName } as unknown as EventTarget }))).toBe(false);
    expect(isMuteKey(press({ target: { tagName: "DIV", isContentEditable: true } as unknown as EventTarget }))).toBe(false);
    expect(isMuteKey(press({ target: { tagName: "BUTTON" } as unknown as EventTarget }))).toBe(true);
  });

  it("carries its key beside the speaker for a keyboard, and is the speaker alone on a touch screen", () => {
    const doc = installStandInDom();
    const keyed = createMuteButton(asHtml(doc.body), { muted: false, showKey: true, onChange: () => undefined });
    const button = doc.body.querySelector("button.mute") as StandInElement;
    expect(button.classList.contains("keyed")).toBe(true);
    expect(button.getAttribute("aria-keyshortcuts")).toBe("M");
    expect(button.querySelector("span.key")?.textContent).toBe("M");
    // Pressed, the speaker is struck through and the key stays.
    button.click();
    expect(button.querySelector("svg")?.descendants()).toHaveLength(3);
    expect(button.querySelector("span.key")?.textContent).toBe("M");
    keyed.dispose();
    const plain = createMuteButton(asHtml(doc.body), { muted: false, showKey: false, onChange: () => undefined });
    const touch = doc.body.querySelector("button.mute") as StandInElement;
    expect(touch.classList.contains("keyed")).toBe(false);
    expect(touch.querySelector("span.key")).toBeNull();
    expect(touch.getAttribute("aria-keyshortcuts")).toBe("M");
    plain.dispose();
  });

  it("is pressed by its key on the page, not by an M typed into a field, and no longer once taken down", () => {
    const doc = installStandInDom();
    const heard: boolean[] = [];
    const mute = createMuteButton(asHtml(doc.body), { muted: false, showKey: false, onChange: (on) => heard.push(on) });
    doc.body.dispatch("keydown", { key: "m", code: "KeyM" });
    expect(mute.muted()).toBe(true);
    const field = doc.createElement("input");
    doc.body.append(field);
    field.dispatch("keydown", { key: "m", code: "KeyM" });
    expect(mute.muted()).toBe(true);
    doc.body.dispatch("keydown", { key: "m", code: "KeyM", metaKey: true });
    expect(mute.muted()).toBe(true);
    doc.body.dispatch("keydown", { key: "M", code: "KeyM" });
    expect(heard).toEqual([true, false]);
    mute.dispose();
    doc.body.dispatch("keydown", { key: "m", code: "KeyM" });
    expect(heard).toEqual([true, false]);
  });
});
