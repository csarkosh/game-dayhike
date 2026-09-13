import { formatSize, isNewer, PLATFORMS, type DesktopRelease, type Platform } from "../net/desktopRelease.js";

// Ad-hoc signed until a Developer ID exists: macOS blocks the first open with
// "Apple could not verify", and Open Anyway only appears in Settings after that
// one attempt — so the steps are spelled out. Windows SmartScreen does the same
// thing for an unsigned installer, behind its own two clicks.
export const FIRST_OPEN_NOTE =
  "First open: macOS will say it could not verify the app. Click Done, then " +
  "System Settings → Privacy & Security → Open Anyway. Only needed once.";
export const FIRST_RUN_NOTE_WINDOWS =
  "First run: Windows will say it protected your PC. Click More info, then Run anyway. Only needed once.";

const COPY: Record<Platform, { label: string; note: string }> = {
  "darwin-arm64": { label: "Download for Mac (Apple silicon)", note: FIRST_OPEN_NOTE },
  "win32-x64": { label: "Download for Windows (x64)", note: FIRST_RUN_NOTE_WINDOWS },
};

export const DOWNLOADS_UNAVAILABLE = "Downloads are not available right now.";
export const WAITING_FOR_HOST = "Waiting for the host…";

export type LandingInput = {
  desktop: boolean;
  /** Which build this machine runs (or would): orders the cards, picks the update. */
  host: Platform | "other";
  /** The desktop app's own version, read from its user agent; undefined on the web. */
  appVersion?: string;
  /** Parsed latest.json, or null while loading or when unavailable. */
  latest: DesktopRelease | null;
  /** A failed join attempt, reported inline under the join field. */
  joinError?: string;
  /** In a lobby someone else hosts. Followers do not start games or join
   * other lobbies; the host's navigation carries them. */
  follower?: boolean;
};

export type DownloadCard = { platform: Platform; url: string; label: string; caption: string; note: string };

export type LandingView = {
  /** The primary action. Absent for a follower, who gets `waiting` instead. */
  play?: { label: string };
  waiting?: string;
  /** The Downloads panel's content. Absent on the desktop shell: an app does
   * not download itself, and the update link on the home panel covers the
   * one thing it might want. */
  downloadsPage?: { label: string; cards: DownloadCard[]; empty?: string };
  /** Always present: the CC-BY assets' credit has to be reachable from every
   * build, web and desktop alike, so this is not conditional on anything. */
  credits: { label: string };
  join?: { placeholder: string; error?: string };
  versionLabel?: string;
  update?: { url: string; label: string };
};

/**
 * What the landing page shows, as data. The client has no DOM tests, so every
 * decision — which cards, in what order, banner or not — is made here where
 * vitest can reach it, and `renderLanding` only paints the result.
 */
export function landingModel(input: LandingInput): LandingView {
  const view: LandingView = { credits: { label: "Credits" } };
  if (input.follower) view.waiting = WAITING_FOR_HOST;
  else view.play = { label: "Play" };

  if (!input.desktop) {
    const cards: DownloadCard[] = [];
    if (input.latest) {
      // The visitor's own platform leads; the rest keep PLATFORMS' order. A
      // stable sort makes that one comparison enough.
      const order = [...PLATFORMS].sort((a, b) => Number(b === input.host) - Number(a === input.host));
      for (const platform of order) {
        const build = input.latest.platforms[platform];
        if (!build) continue;
        cards.push({
          platform,
          url: build.url,
          label: COPY[platform].label,
          caption: `v${input.latest.version} · ${formatSize(build.size)}`,
          note: COPY[platform].note,
        });
      }
    }
    view.downloadsPage = { label: "Downloads", cards };
    if (cards.length === 0) view.downloadsPage.empty = DOWNLOADS_UNAVAILABLE;
    return view;
  }

  if (!input.follower) view.join = { placeholder: "Paste an invite link or lobby id", error: input.joinError };
  if (input.appVersion) view.versionLabel = `v${input.appVersion}`;
  // A shell only ever updates itself: no build for the platform it runs on,
  // no banner.
  const own = input.host === "other" ? undefined : input.latest?.platforms[input.host];
  if (input.latest && own && input.appVersion && isNewer(input.latest.version, input.appVersion)) {
    view.update = { url: own.url, label: `Day Hike v${input.latest.version} is available — Download` };
  }
  return view;
}
