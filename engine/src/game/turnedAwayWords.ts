/**
 * Every word a visitor reads on the page for those who cannot play
 * (`turnedAway.ts`), and nothing else: one constant a sentence, so the
 * words are changed here alone and the page, its model and its tests follow.
 *
 * The wording is plain on purpose: what is wrong in one sentence, then
 * what to do. No name of anything the game is built with appears but one:
 * WebGPU, once, in the small line at the foot
 * (`TURNED_AWAY_DETAIL`), because it is the word a visitor's browser uses
 * for this in its own settings and help pages, and the one to search for.
 *
 * No game is named either: a sentence says `{game}` where the game's name
 * goes (`GAME`), and the page's model puts in the name the game is handed
 * to the shell with (`named`), which is also the page's title.
 *
 * The versions in the browsers' lines are where each browser turned WebGPU
 * on for everyone, from the WebGPU working group's implementation status
 * page as edited 2026-10-02:
 * https://github.com/gpuweb/gpuweb/wiki/Implementation-Status
 */
import type { TurnedAwayReason } from "./loadCheck.js";

/** Where a sentence names the game: what the game's own name is put in for (`named`). */
export const GAME = "{game}";

/** A sentence of this file with the game's name in it, as the page shows it. */
export function named(line: string, title: string): string {
  return line.replaceAll(GAME, title);
}

/** What is wrong, in one sentence, by reason, in a browser. */
export const TURNED_AWAY_HEADLINE: Readonly<Record<TurnedAwayReason, string>> = {
  "no-webgpu": "This browser cannot run {game}.",
  "no-adapter": "This browser could not reach the graphics card, so {game} cannot run in it.",
  software: "This browser has graphics acceleration turned off, so {game} cannot run in it.",
  short: "The graphics card in this device cannot run {game}.",
};

/** What is wrong, in one sentence, by reason, in the desktop app, where there is no browser to name. */
export const TURNED_AWAY_HEADLINE_APP: Readonly<Record<TurnedAwayReason, string>> = {
  "no-webgpu": "{game} cannot run on this computer.",
  "no-adapter": "{game} could not reach the graphics card in this computer.",
  software: "{game} could not use the graphics card in this computer.",
  short: "The graphics card in this computer cannot run {game}.",
};

/** What to do, by reason, in a browser on a computer: one or two sentences, before the list of browsers. */
export const TURNED_AWAY_ADVICE: Readonly<Record<TurnedAwayReason, readonly string[]>> = {
  "no-webgpu": ["Update this browser, or open this page in one of the browsers below."],
  "no-adapter": [
    "Update this browser, and check in its settings that graphics acceleration (also called hardware acceleration) is turned on.",
    "Then restart the browser and come back to this page.",
  ],
  software: [
    "Turn on graphics acceleration (also called hardware acceleration) in this browser's settings, restart it, and come back to this page.",
    "If it is already on, the browser has set this graphics card aside: updating the graphics driver may bring it back.",
  ],
  short: ["A newer phone or computer will run it. On this one, another browser from the list below is worth a try."],
};

/**
 * What to do, by reason, in a browser on a phone or a tablet, where there
 * is no setting for graphics acceleration and no driver to update: the
 * browser and the system are what a visitor can bring up to date.
 */
export const TURNED_AWAY_ADVICE_PHONE: Readonly<Record<TurnedAwayReason, readonly string[]>> = {
  "no-webgpu": ["Update this browser and this device's system software, or open this page in the browser below."],
  "no-adapter": ["Update this browser and this device's system software, then come back to this page."],
  software: ["Update this browser and this device's system software, then come back to this page."],
  short: ["A newer phone or tablet will run it."],
};

/** What to do in the desktop app, whatever the reason: there is no other browser to send the player to. */
export const TURNED_AWAY_ADVICE_APP: readonly string[] = ["Updating the graphics driver may help. Then open {game} again."];

/** Over the list of browsers. */
export const TURNED_AWAY_BROWSERS_INTRO = "{game} runs in:";

/** The list's lines, by the device the visitor is on: what runs the game there. */
export const TURNED_AWAY_BROWSERS = {
  windows: ["Chrome or Edge, version 113 or later", "Firefox, version 141 or later"],
  mac: ["Chrome or Edge, version 113 or later", "Safari 26 or later", "Firefox 147 or later, on a Mac with Apple silicon"],
  android: ["Chrome, version 121 or later, on Android 12 or later"],
  appleMobile: ["Safari on iOS 26 or iPadOS 26, or later"],
  /** A device the page cannot name (Linux, a Chromebook, anything else): every line. */
  other: [
    "Chrome or Edge, version 113 or later, on Windows, a Mac or a Chromebook",
    "Chrome, version 121 or later, on Android 12 or later",
    "Safari 26 or later, on a Mac, an iPhone or an iPad",
    "Firefox, version 141 or later, on Windows",
  ],
} as const satisfies Record<string, readonly string[]>;

/** Over the desktop app's download, where the app would run on this computer. */
export const TURNED_AWAY_APP_INTRO = "Or play in the {game} app, which needs no browser:";

/**
 * The small line at the foot, by reason: the page's one technical sentence,
 * and the one place WebGPU is named. For `short` the page adds what the
 * graphics card is short of, as the check names it.
 */
export const TURNED_AWAY_DETAIL: Readonly<Record<TurnedAwayReason, string>> = {
  "no-webgpu": "{game} is drawn with WebGPU, which this browser does not have.",
  "no-adapter": "{game} is drawn with WebGPU, which this browser has but could not start on this device.",
  software: "{game} is drawn with WebGPU, which this browser is running without the graphics card.",
  short: "{game} is drawn with WebGPU, and this graphics card offers less of it than the game needs",
};

/** The word the credits open under, at the foot: the landing page's own. */
export const TURNED_AWAY_CREDITS = "Credits";

/** The same line in the desktop app, where there is no browser to name. */
export const TURNED_AWAY_DETAIL_APP: Readonly<Record<TurnedAwayReason, string>> = {
  "no-webgpu": "{game} is drawn with WebGPU, which is not available on this computer.",
  "no-adapter": "{game} is drawn with WebGPU, which could not start on this computer.",
  software: "{game} is drawn with WebGPU, which is running without the graphics card on this computer.",
  short: "{game} is drawn with WebGPU, and this graphics card offers less of it than the game needs",
};
