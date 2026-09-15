import { describe, it, expect } from "vitest";
import { desktopVersion, hostPlatform, isDesktop, isTouchDevice } from "../../src/game/platform.js";

const ELECTRON_UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) " +
  "day-hike-desktop/1.0.0 Chrome/132.0.6834.83 Electron/44.1.1 Safari/537.36";
const CHROME_UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) " +
  "Chrome/132.0.0.0 Safari/537.36";

describe("isDesktop", () => {
  it("recognises Electron's user agent", () => {
    expect(isDesktop(ELECTRON_UA)).toBe(true);
  });
  it("is false in a browser", () => {
    expect(isDesktop(CHROME_UA)).toBe(false);
  });
  it("needs the Electron/<version> token, not just the word", () => {
    expect(isDesktop("Mozilla/5.0 Electronics/1.0")).toBe(false);
    expect(isDesktop("Mozilla/5.0 electron/44.1.1")).toBe(false);
  });
});

describe("hostPlatform", () => {
  const mac = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0 Safari/537.36";
  const win = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0 Safari/537.36";
  const shellWin = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) day-hike-desktop/0.2.0 Chrome/132.0 Electron/44.1.1 Safari/537.36";
  it("maps user agents to the two builds we ship", () => {
    expect(hostPlatform(mac)).toBe("darwin-arm64");
    expect(hostPlatform(win)).toBe("win32-x64");
    expect(hostPlatform(shellWin)).toBe("win32-x64");
  });
  it("is 'other' for anything else", () => {
    expect(hostPlatform("Mozilla/5.0 (X11; Linux x86_64) Chrome/128.0")).toBe("other");
    expect(hostPlatform("")).toBe("other");
  });
});

describe("desktopVersion", () => {
  const shell = ELECTRON_UA + " DayHike/0.3.0";
  it("reads the shell's own token", () => {
    expect(desktopVersion(shell)).toBe("0.3.0");
  });
  it("is undefined in a browser and in a shell without the token", () => {
    expect(desktopVersion(CHROME_UA)).toBeUndefined();
    expect(desktopVersion(ELECTRON_UA)).toBeUndefined();
  });
  it("needs a full x.y.z", () => {
    expect(desktopVersion(ELECTRON_UA + " DayHike/0.3")).toBeUndefined();
    expect(desktopVersion(ELECTRON_UA + " DayHike/v0.3.0")).toBeUndefined();
    expect(desktopVersion("MyDayHike/1.2.3")).toBeUndefined();
  });
});

describe("isTouchDevice", () => {
  it("needs a coarse primary pointer and at least one touch point", () => {
    expect(isTouchDevice({ coarsePointer: true, maxTouchPoints: 5 })).toBe(true);
  });
  it("is false for a mouse-driven desktop", () => {
    expect(isTouchDevice({ coarsePointer: false, maxTouchPoints: 0 })).toBe(false);
  });
  it("is false for a touch laptop whose primary pointer is fine", () => {
    // Such a machine still gets the layer on its first real touch (the layer's
    // own fallback); the probe only decides the starting state.
    expect(isTouchDevice({ coarsePointer: false, maxTouchPoints: 10 })).toBe(false);
  });
  it("is false for a coarse pointer with no touch points, such as a TV remote", () => {
    expect(isTouchDevice({ coarsePointer: true, maxTouchPoints: 0 })).toBe(false);
  });
  it("reads false with no browser at all", () => {
    expect(isTouchDevice()).toBe(false);
  });
});
