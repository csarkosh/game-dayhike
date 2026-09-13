// Is a desktop release due? The shell ships no game, so the only reason to cut
// one is a new Electron on the mirror. Pure: the gh call lives in
// desktopOutdated.mjs so this can be tested on sample output.
import { isGreater, parseSemver } from './desktopRelease.mjs';

/** The highest stable `v<x.y.z>` tag among `gh release list --json` rows, or null. */
export function latestMirrorVersion(releases) {
  let best = null;
  for (const r of releases) {
    if (r.isDraft || r.isPrerelease) continue;
    const m = /^v(\d+\.\d+\.\d+)$/.exec(r.tagName ?? '');
    if (!m || !parseSemver(m[1])) continue;
    if (best === null || isGreater(m[1], best)) best = m[1];
  }
  return best;
}

export function outdatedVerdict(pinned, latest) {
  if (latest === null) {
    return { outdated: false, message: `desktop is current: the mirror has no stable release to compare with (pinned ${pinned})` };
  }
  if (isGreater(latest, pinned)) {
    return {
      outdated: true,
      message: `desktop is outdated: pinned ${pinned}, mirror has v${latest} → bump desktop/package.json and run deploy:desktop`,
    };
  }
  return { outdated: false, message: `desktop is current: electron ${pinned} is the mirror's latest (v${latest})` };
}
