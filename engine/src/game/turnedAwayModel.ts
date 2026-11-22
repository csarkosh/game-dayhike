/**
 * What the page for those who cannot play shows, as data: the sentence that
 * says what is wrong, what to do about it, the browsers that run the game on
 * the visitor's kind of device, and the desktop app's download where the app
 * would run on this computer. Every word is `turnedAwayWords.ts`'s but the
 * game's name, which is handed in (`TurnedAwayInput.title`); every
 * decision is made here, where a test can reach it, and `turnedAway.ts`
 * only paints the result.
 */
import type { DesktopRelease, Platform } from "../net/desktopRelease.js";
import type { HostOs } from "./gpuSignals.js";
import { downloadCard, type DownloadCard } from "./downloadCard.js";
import type { TurnedAwayReason } from "./loadCheck.js";
import {
  TURNED_AWAY_ADVICE,
  TURNED_AWAY_ADVICE_APP,
  TURNED_AWAY_ADVICE_PHONE,
  TURNED_AWAY_APP_INTRO,
  TURNED_AWAY_BROWSERS,
  TURNED_AWAY_BROWSERS_INTRO,
  TURNED_AWAY_CREDITS,
  TURNED_AWAY_DETAIL,
  TURNED_AWAY_DETAIL_APP,
  TURNED_AWAY_HEADLINE,
  TURNED_AWAY_HEADLINE_APP,
  named,
} from "./turnedAwayWords.js";

/** The kind of device the visitor is on, as far as the list of browsers differs by it. */
export type VisitorDevice = keyof typeof TURNED_AWAY_BROWSERS;

/**
 * The visitor's kind of device: an iPhone or an iPad by its user agent, or
 * an iPad that calls itself a Mac and has a touch screen (`isMobile`); an
 * Android phone or tablet; a Windows computer; a Mac; and `other` for
 * everything the page cannot name, a phone of another kind among them.
 */
export function visitorDevice(os: HostOs, mobile: boolean, userAgent: string): VisitorDevice {
  if (/\biPhone|\biPad|\biPod/.test(userAgent) || (os === "mac" && mobile)) return "appleMobile";
  if (os === "android") return "android";
  if (mobile) return "other";
  return os === "windows" ? "windows" : os === "mac" ? "mac" : "other";
}

export type TurnedAwayInput = {
  /** The game's name: the page's title, and what every sentence that names the game says. */
  title: string;
  reason: TurnedAwayReason;
  /** What the adapter is short of, for the reason `short` (`LoadVerdict.short`). */
  short: string | null;
  /** In the desktop app (`isDesktop`): there is no browser to name and no app to offer. */
  desktop: boolean;
  device: VisitorDevice;
  /** Which of the app's builds this computer would run (`hostPlatform`). */
  host: Platform | "other";
  userAgent: string;
  /** The GPU's name where the browser gives one (`GpuSignals.renderer`), or null. */
  renderer: string | null;
  /** The app's release (`latest.json`), or null while it loads or where there is none. */
  latest: DesktopRelease | null;
};

export type TurnedAwayView = {
  /** Why the visitor is turned away (`loadCheck.ts`): no word of the page, but carried by it as data, for a program that reads the page (the desktop app's own check of itself). */
  reason: TurnedAwayReason;
  title: string;
  /** What is wrong, in one sentence. */
  headline: string;
  /** What to do, a sentence or two. */
  advice: readonly string[];
  /** The browsers that run the game on this kind of device; null in the desktop app. */
  browsers: { intro: string; lines: readonly string[] } | null;
  /** The desktop app's download, where the app would run on this computer. */
  app: { intro: string; card: DownloadCard } | null;
  /** The small technical line at the foot. */
  detail: string;
  /** What the credits open under: the page shows the title's still, so the credit its works are owed is here too. */
  credits: string;
};

/** A GPU's name that is not Apple's own: a Mac it names is not one with Apple silicon. */
const OTHER_GPU = /Intel|AMD|Radeon|NVIDIA|GeForce/i;

/**
 * Whether the desktop app would run the game on the visitor's computer, as
 * far as the page can tell. The app brings its own browser, so it helps
 * exactly where this browser is what is missing (`no-webgpu`): where the
 * browser has WebGPU and no graphics card behind it, the app's browser
 * would meet the same graphics card and the same driver. It is built for
 * Windows on x64 and for Macs with Apple silicon alone, and its browser
 * needs Windows 10 or later (which is what a user agent's `Windows NT 10.0`
 * says of both 10 and 11); a Mac whose GPU the browser names as another
 * maker's is not one with Apple silicon. Never on a phone or a tablet, and
 * never in the app itself.
 */
export function appWouldRun(input: Pick<TurnedAwayInput, "reason" | "desktop" | "device" | "host" | "userAgent" | "renderer">): boolean {
  if (input.desktop || input.reason !== "no-webgpu") return false;
  if (input.device === "windows") return input.host === "win32-x64" && /\bWindows NT 10\.0\b/.test(input.userAgent);
  if (input.device === "mac") return input.host === "darwin-arm64" && !(input.renderer !== null && OTHER_GPU.test(input.renderer));
  return false;
}

/** The page, from why the visitor is turned away and what they are on. */
export function turnedAwayModel(input: TurnedAwayInput): TurnedAwayView {
  /** A sentence with the game's name in it. */
  const say = (line: string): string => named(line, input.title);
  if (input.desktop) {
    return {
      reason: input.reason,
      title: input.title,
      headline: say(TURNED_AWAY_HEADLINE_APP[input.reason]),
      advice: TURNED_AWAY_ADVICE_APP.map(say),
      browsers: null,
      app: null,
      detail: withShort(say(TURNED_AWAY_DETAIL_APP[input.reason]), input),
      credits: TURNED_AWAY_CREDITS,
    };
  }
  const card = appWouldRun(input) && input.latest !== null && input.host !== "other" ? downloadCard(input.latest, input.host) : null;
  return {
    reason: input.reason,
    title: input.title,
    headline: say(TURNED_AWAY_HEADLINE[input.reason]),
    // A phone or a tablet has no setting for graphics acceleration and no driver to update. A browser's advice names no game.
    advice: (input.device === "android" || input.device === "appleMobile" ? TURNED_AWAY_ADVICE_PHONE : TURNED_AWAY_ADVICE)[input.reason],
    browsers: { intro: say(TURNED_AWAY_BROWSERS_INTRO), lines: TURNED_AWAY_BROWSERS[input.device] },
    app: card === null ? null : { intro: say(TURNED_AWAY_APP_INTRO), card },
    detail: withShort(say(TURNED_AWAY_DETAIL[input.reason]), input),
    credits: TURNED_AWAY_CREDITS,
  };
}

/** The foot's line, with what the graphics card is short of after it where the check named something. */
function withShort(line: string, input: Pick<TurnedAwayInput, "reason" | "short">): string {
  return input.reason === "short" && input.short !== null ? `${line} (${input.short}).` : input.reason === "short" ? `${line}.` : line;
}
