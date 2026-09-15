import type { Platform } from "../net/desktopRelease.js";

/**
 * Whether the page is running inside the desktop shell (`desktop/main.cjs`).
 *
 * Electron's default user agent carries an `Electron/<version>` token that no
 * browser sends. Detecting it here keeps the shell a plain launcher — no preload
 * script, no IPC — and keeps every desktop-specific behaviour a small branch in
 * client code with a test.
 */
export function isDesktop(userAgent: string = navigator.userAgent): boolean {
  return /\bElectron\/\d/.test(userAgent);
}

/**
 * Which of our two builds this machine would run. From the user agent, which
 * both browsers and the shell carry; Apple silicon is assumed for any Mac
 * since it is the only Mac build we ship.
 */
export function hostPlatform(userAgent: string = navigator.userAgent): Platform | "other" {
  if (/\bWindows NT\b/.test(userAgent)) return "win32-x64";
  if (/\bMacintosh\b|\bMac OS X\b/.test(userAgent)) return "darwin-arm64";
  return "other";
}

/**
 * The desktop shell's own version, from the `DayHike/<x.y.z>` token it appends
 * to the user agent (`desktop/main.cjs`); undefined on the web. The page is
 * the same web build everywhere, so this is the only way the shell can tell
 * it what it is.
 */
export function desktopVersion(userAgent: string = navigator.userAgent): string | undefined {
  return /\bDayHike\/(\d+\.\d+\.\d+)\b/.exec(userAgent)?.[1];
}

export type TouchFacts = { coarsePointer: boolean; maxTouchPoints: number };

/**
 * Whether this device should start with the touch layer up. A coarse primary
 * pointer AND a touch point: a coarse pointer alone is a TV remote, touch
 * points alone are a touch laptop that should keep its mouse. The layer's own
 * first-touch fallback covers what this deliberately says no to.
 *
 * A different question from the quality tier's `mobile` (device class, by
 * user agent): a touch Windows laptop should keep its tier.
 */
export function isTouchDevice(facts: TouchFacts = browserTouchFacts()): boolean {
  return facts.coarsePointer && facts.maxTouchPoints > 0;
}

function browserTouchFacts(): TouchFacts {
  const g = globalThis as { matchMedia?: (q: string) => { matches: boolean }; navigator?: { maxTouchPoints?: number } };
  return {
    coarsePointer: g.matchMedia?.("(pointer: coarse)").matches ?? false,
    maxTouchPoints: g.navigator?.maxTouchPoints ?? 0,
  };
}
