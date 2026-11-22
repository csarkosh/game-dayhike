/**
 * The card that offers the desktop app's build for one platform, with the note for its first
 * run; used by a landing page's downloads and by the page for those turned away.
 */
import { formatSize, type DesktopRelease, type Platform } from "@csarkosh/engine/net/desktopRelease";

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

export type DownloadCard = { platform: Platform; url: string; label: string; caption: string; note: string };

/** The card of one platform's build in a release, or null where the release has none for it. */
export function downloadCard(latest: DesktopRelease, platform: Platform): DownloadCard | null {
  const build = latest.platforms[platform];
  if (!build) return null;
  return {
    platform,
    url: build.url,
    label: COPY[platform].label,
    caption: `v${latest.version} · ${formatSize(build.size)}`,
    note: COPY[platform].note,
  };
}
