import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { TURNED_AWAY_REASONS } from "../../src/game/loadCheck.js";
import { FIRST_OPEN_NOTE, FIRST_RUN_NOTE_WINDOWS } from "../../src/game/landingModel.js";
import { appWouldRun, turnedAwayModel, visitorDevice, type TurnedAwayInput } from "../../src/game/turnedAwayModel.js";
import * as words from "../../src/game/turnedAwayWords.js";

const CHROME_WIN = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/109.0.0.0 Safari/537.36";
const CHROME_WIN7 = "Mozilla/5.0 (Windows NT 6.1; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/109.0.0.0 Safari/537.36";
const SAFARI_MAC = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.6 Safari/605.1.15";
const SAFARI_IPHONE = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.6 Mobile/15E148 Safari/604.1";
const CHROME_ANDROID = "Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36";
const FIREFOX_LINUX = "Mozilla/5.0 (X11; Linux x86_64; rv:150.0) Gecko/20100101 Firefox/150.0";
const SHELL_WIN = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) day-hike-desktop/0.3.0 Chrome/152.0.7977.65 Electron/44.1.1 Safari/537.36 DayHike/0.3.0";

const MAC = { url: "https://storage.googleapis.com/fps-csarko-downloads/desktop/DayHike-1.2.0-arm64.dmg", sha256: "a".repeat(64), size: 148_400_000 };
const WIN = { url: "https://storage.googleapis.com/fps-csarko-downloads/desktop/DayHike-Setup-1.2.0-x64.exe", sha256: "b".repeat(64), size: 118_000_000 };
const latest = { version: "1.2.0", platforms: { "darwin-arm64": MAC, "win32-x64": WIN } };

/** A visitor on a Windows computer in an old Chrome, the release in. */
const input = (over: Partial<TurnedAwayInput> = {}): TurnedAwayInput => ({
  reason: "no-webgpu",
  short: null,
  desktop: false,
  device: "windows",
  host: "win32-x64",
  userAgent: CHROME_WIN,
  renderer: "ANGLE (NVIDIA, NVIDIA GeForce GTX 1060 Direct3D11 vs_5_0 ps_5_0, D3D11)",
  latest,
  ...over,
});

describe("the visitor's kind of device", () => {
  it("tells a Windows computer, a Mac, an Android phone, an iPhone and an iPad, and calls the rest other", () => {
    expect(visitorDevice("windows", false, CHROME_WIN)).toBe("windows");
    expect(visitorDevice("mac", false, SAFARI_MAC)).toBe("mac");
    expect(visitorDevice("android", true, CHROME_ANDROID)).toBe("android");
    expect(visitorDevice("other", true, SAFARI_IPHONE)).toBe("appleMobile");
    // An iPad says it is a Mac, and has a touch screen.
    expect(visitorDevice("mac", true, SAFARI_MAC)).toBe("appleMobile");
    expect(visitorDevice("other", false, FIREFOX_LINUX)).toBe("other");
    // A phone that is neither: nothing is said of it that may not hold.
    expect(visitorDevice("other", true, "Mozilla/5.0 (Mobile; rv:48.0) Gecko/48.0 Firefox/48.0 KAIOS/2.5")).toBe("other");
  });
});

describe("whether the desktop app would run the game here", () => {
  it("is offered where the browser is what is missing, on Windows 10 or later and on a Mac not known to be another maker's", () => {
    expect(appWouldRun(input())).toBe(true);
    expect(appWouldRun(input({ device: "mac", host: "darwin-arm64", userAgent: SAFARI_MAC, renderer: "Apple GPU" }))).toBe(true);
    expect(appWouldRun(input({ device: "mac", host: "darwin-arm64", userAgent: SAFARI_MAC, renderer: "ANGLE (Apple, ANGLE Metal Renderer: Apple M2, Unspecified Version)" }))).toBe(true);
    expect(appWouldRun(input({ device: "mac", host: "darwin-arm64", userAgent: SAFARI_MAC, renderer: null }))).toBe(true);
  });

  it("is not offered where the app could not run: an older Windows, a Mac with another maker's GPU, a phone, a device with no build", () => {
    expect(appWouldRun(input({ userAgent: CHROME_WIN7 }))).toBe(false);
    expect(appWouldRun(input({ device: "mac", host: "darwin-arm64", userAgent: SAFARI_MAC, renderer: "Intel(R) Iris(TM) Plus Graphics 655" }))).toBe(false);
    expect(appWouldRun(input({ device: "mac", host: "darwin-arm64", userAgent: SAFARI_MAC, renderer: "AMD Radeon Pro 5500M OpenGL Engine" }))).toBe(false);
    expect(appWouldRun(input({ device: "android", host: "other", userAgent: CHROME_ANDROID }))).toBe(false);
    expect(appWouldRun(input({ device: "appleMobile", host: "darwin-arm64", userAgent: SAFARI_MAC }))).toBe(false);
    expect(appWouldRun(input({ device: "other", host: "other", userAgent: FIREFOX_LINUX }))).toBe(false);
  });

  it("is not offered where the graphics card is what is missing, or in the app itself", () => {
    for (const reason of ["no-adapter", "software", "short"] as const) expect(appWouldRun(input({ reason })), reason).toBe(false);
    expect(appWouldRun(input({ desktop: true, userAgent: SHELL_WIN }))).toBe(false);
  });
});

describe("the page for those turned away, as data", () => {
  it("says what is wrong in one sentence and what to do, for every reason, in a browser", () => {
    for (const reason of TURNED_AWAY_REASONS) {
      const view = turnedAwayModel(input({ reason, short: reason === "short" ? "maxTextureDimension2D 4096 < 8192" : null }));
      expect(view.title).toBe("Day Hike");
      expect(view.headline, reason).toBe(words.TURNED_AWAY_HEADLINE[reason]);
      expect(view.advice, reason).toBe(words.TURNED_AWAY_ADVICE[reason]);
      expect(view.browsers, reason).toEqual({ intro: words.TURNED_AWAY_BROWSERS_INTRO, lines: words.TURNED_AWAY_BROWSERS.windows });
    }
  });

  it("gives a phone or a tablet advice it can act on: no setting to turn on, no driver to update", () => {
    for (const reason of TURNED_AWAY_REASONS) {
      for (const device of ["android", "appleMobile"] as const) {
        const view = turnedAwayModel(input({ reason, device, host: "other", userAgent: CHROME_ANDROID }));
        expect(view.advice, `${reason} ${device}`).toBe(words.TURNED_AWAY_ADVICE_PHONE[reason]);
        expect(view.advice.join(" "), `${reason} ${device}`).not.toMatch(/settings|driver|acceleration|computer/);
      }
      for (const device of ["windows", "mac", "other"] as const) expect(turnedAwayModel(input({ reason, device })).advice, `${reason} ${device}`).toBe(words.TURNED_AWAY_ADVICE[reason]);
    }
  });

  it("lists the browsers that run the game on the visitor's own kind of device", () => {
    for (const device of ["windows", "mac", "android", "appleMobile", "other"] as const) {
      expect(turnedAwayModel(input({ device })).browsers?.lines, device).toBe(words.TURNED_AWAY_BROWSERS[device]);
    }
  });

  it("offers the app's own build for this computer under its intro, with the landing page's card", () => {
    expect(turnedAwayModel(input()).app).toEqual({
      intro: words.TURNED_AWAY_APP_INTRO,
      card: { platform: "win32-x64", url: WIN.url, label: "Download for Windows (x64)", caption: "v1.2.0 · 118 MB", note: FIRST_RUN_NOTE_WINDOWS },
    });
    const mac = turnedAwayModel(input({ device: "mac", host: "darwin-arm64", userAgent: SAFARI_MAC, renderer: "Apple GPU" }));
    expect(mac.app?.card).toEqual({ platform: "darwin-arm64", url: MAC.url, label: "Download for Mac (Apple silicon)", caption: "v1.2.0 · 148 MB", note: FIRST_OPEN_NOTE });
  });

  it("offers no app before the release is in, where the release has no build for this computer, or where the app would not run", () => {
    expect(turnedAwayModel(input({ latest: null })).app).toBeNull();
    expect(turnedAwayModel(input({ latest: { version: "1.2.0", platforms: { "darwin-arm64": MAC } } })).app).toBeNull();
    expect(turnedAwayModel(input({ reason: "software" })).app).toBeNull();
    expect(turnedAwayModel(input({ device: "android", host: "other", userAgent: CHROME_ANDROID })).app).toBeNull();
  });

  it("names no browser in the desktop app, and offers neither a list nor a download there", () => {
    for (const reason of TURNED_AWAY_REASONS) {
      const view = turnedAwayModel(input({ reason, desktop: true, userAgent: SHELL_WIN }));
      // The reason itself rides the view, in the app and in a browser: the page carries it as data.
      expect(view.reason, reason).toBe(reason);
      expect(turnedAwayModel(input({ reason })).reason, reason).toBe(reason);
      expect(view.headline, reason).toBe(words.TURNED_AWAY_HEADLINE_APP[reason]);
      expect(view.advice).toBe(words.TURNED_AWAY_ADVICE_APP);
      expect(view.browsers).toBeNull();
      expect(view.app).toBeNull();
      expect(`${view.headline} ${view.advice.join(" ")} ${view.detail}`, reason).not.toMatch(/browser/i);
    }
  });

  it("keeps the credits within reach, in a browser and in the app, under the landing page's own word", () => {
    expect(words.TURNED_AWAY_CREDITS).toBe("Credits");
    for (const reason of TURNED_AWAY_REASONS) {
      expect(turnedAwayModel(input({ reason })).credits, reason).toBe("Credits");
      expect(turnedAwayModel(input({ reason, desktop: true, userAgent: SHELL_WIN })).credits, reason).toBe("Credits");
    }
    // The page takes the works themselves from the credits' own list, each written by the Credits screen's own hand.
    const page = readFileSync(fileURLToPath(new URL("../../src/game/turnedAway.ts", import.meta.url)), "utf8");
    expect(page).toContain("options: { still: string | null; credits: readonly CreditEntry[]; onDownload?(platform: Platform): void },");
    expect(page).toContain("  for (const e of options.credits) creditsList.append(creditItem(e));");
    const screen = readFileSync(fileURLToPath(new URL("../../src/game/credits.ts", import.meta.url)), "utf8");
    expect(screen).toContain("  for (const e of entries) list.append(creditItem(e));");
    const main = readFileSync(fileURLToPath(new URL("../../src/main.ts", import.meta.url)), "utf8");
    expect(main).toContain("    credits: creditsEntries(),");
  });

  it("ends with the one technical line, with what the graphics card is short of where the check named it", () => {
    expect(turnedAwayModel(input()).detail).toBe(words.TURNED_AWAY_DETAIL["no-webgpu"]);
    expect(turnedAwayModel(input({ reason: "short", short: "maxTextureDimension2D 4096 < 8192" })).detail).toBe(`${words.TURNED_AWAY_DETAIL.short} (maxTextureDimension2D 4096 < 8192).`);
    expect(turnedAwayModel(input({ reason: "short", short: null })).detail).toBe(`${words.TURNED_AWAY_DETAIL.short}.`);
    expect(turnedAwayModel(input({ reason: "short", short: "maxBindGroups 2 < 4", desktop: true })).detail).toBe(`${words.TURNED_AWAY_DETAIL_APP.short} (maxBindGroups 2 < 4).`);
  });
});

describe("the words a visitor turned away reads", () => {
  /** Every sentence of the module, by the constant it stands in. */
  const sentences: [string, string][] = Object.entries(words).flatMap(([name, value]) =>
    typeof value === "string"
      ? [[name, value] as [string, string]]
      : Object.entries(value as Record<string, string | readonly string[]>).flatMap(([key, v]) => (typeof v === "string" ? [v] : [...v]).map((text) => [`${name}.${key}`, text] as [string, string])),
  );

  it("stand in one module, a constant a sentence: the page and its model write none of their own", () => {
    expect(sentences.length).toBeGreaterThan(20);
    for (const file of ["turnedAway.ts", "turnedAwayModel.ts"]) {
      const code = readFileSync(fileURLToPath(new URL(`../../src/game/${file}`, import.meta.url)), "utf8").replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, "");
      // A string of the code with a space in it would be words: the DOM's class names and the checks' patterns have none but these.
      const worded = [...code.matchAll(/"((?:[^"\\\n]|\\.)*)"/g)].map((m) => m[1] as string).filter((text) => /[A-Za-z] [A-Za-z]/.test(text));
      expect(worded, file).toEqual(file === "turnedAway.ts" ? ["caption note"] : []);
    }
  });

  it("name nothing the game is built with but WebGPU, and that once a page, in the line at the foot", () => {
    for (const [name, text] of sentences) {
      expect(text, name).not.toMatch(/Babylon|\bLite\b|WebGL\b|adapter|shader|\bGPU\b|\bengine\b|renderer|pipeline|Vulkan|\bMetal\b|Direct3D/);
      if (name.startsWith("TURNED_AWAY_DETAIL")) expect(text.match(/WebGPU/g), name).toHaveLength(1);
      else expect(text, name).not.toContain("WebGPU");
    }
  });

  it("are whole sentences a visitor can read: a headline is one sentence, and nothing is long", () => {
    for (const [name, text] of sentences) {
      expect(text.length, name).toBeGreaterThan(3);
      expect(text.length, name).toBeLessThan(170);
      expect(text, name).toBe(text.trim());
    }
    for (const table of [words.TURNED_AWAY_HEADLINE, words.TURNED_AWAY_HEADLINE_APP]) {
      for (const reason of TURNED_AWAY_REASONS) {
        expect(table[reason].endsWith("."), reason).toBe(true);
        expect(table[reason].slice(0, -1), reason).not.toContain(". ");
      }
    }
  });

  it("give every reason its own headline, advice and detail, in a browser and in the app", () => {
    for (const table of [words.TURNED_AWAY_HEADLINE, words.TURNED_AWAY_HEADLINE_APP, words.TURNED_AWAY_ADVICE, words.TURNED_AWAY_ADVICE_PHONE, words.TURNED_AWAY_DETAIL, words.TURNED_AWAY_DETAIL_APP]) {
      expect(Object.keys(table).sort()).toEqual([...TURNED_AWAY_REASONS].sort());
    }
    expect(new Set(Object.values(words.TURNED_AWAY_HEADLINE)).size).toBe(TURNED_AWAY_REASONS.length);
  });
});
