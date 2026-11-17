import {
  BASE,
  parseRoute,
  createLobbyId,
  currentRoutePath,
  navigateTo,
  navigateToGame,
  navigateToLanding,
  navigateToPanel,
  parseSceneSearch,
  replaceWithLanding,
  leavePanel,
  browserExit,
  followsTo,
  hostRoute,
  stripOverrides,
  type Route,
} from "./game/router.js";
import { renderLanding, type LandingHandle, type LandingPanel } from "./game/landing.js";
import { afterNextPaint } from "./game/paint.js";
import { createIntroOverlay, type CutReason, type IntroOverlay } from "./game/introOverlay.js";
import { INTRO_CAPTIONS } from "./game/scene/intro.js";
import { setLoadProgress } from "./game/loadReport.js";
import { markedProgress } from "./game/loadProgress.js";
import { titleStillUrl, titleVideoUrl, videoUrl } from "./game/assetUrls.js";
import { createRouteAnnouncer } from "./game/routeAnnounce.js";
import { createTitleLoop, titleLoopEnv, type TitleLoop } from "./game/titleLoop.js";
import { createFilmHead, fetchFilmHead, filmHeadWanted, onCellular, warmWhenLoaded } from "./game/filmHead.js";
import { worldInputs } from "./game/worldInputs.js";
import { sceneLine, startWorldPrep, worldPrepLine, type WorldPrepOutcome } from "./game/worldPrep.js";
import type { PreparedScene } from "./game/preparedScene.js";
import { runLiteSceneRoute } from "./game/lite/sceneRoute.js";
import { liteProbeDeps } from "./game/lite/probeScene.js";
import { landingModel, type LandingInput } from "./game/landingModel.js";
import { isDesktop, isTouchDevice, hostPlatform, desktopVersion } from "./game/platform.js";
import { inviteLink, parseJoinLink } from "./game/joinLink.js";
import { loadName, saveName } from "./game/playerName.js";
import { createRoster } from "./game/roster.js";
import { rosterModel, attemptPending } from "./game/rosterModel.js";
import { startAttemptClock, type AttemptClock } from "./game/attemptClock.js";
import { parseLatest, type DesktopRelease } from "./net/desktopRelease.js";
import { createSignalingClient, type SignalingClient } from "./net/signaling.js";
import { signalingUrl } from "./net/signalingUrl.js";
import { createLobby, joinLobby, lobbyErrorMessage, type Lobby } from "./net/lobby.js";
import { browserDeps, createTelemetry, installErrorCapture, referrerOf, telemetryUrl, testerMark, visitorId, type EarlyCatch, type Telemetry } from "./net/telemetry.js";
import { PROTOCOL_VERSION } from "./net/protocol.js";
import { GEN_VERSION } from "./sim/forest.js";
import { startGame, type GameHandle } from "./app.js";
import type { EngineOnCanvas } from "./game/rendererSwap.js";
import { LOSS_ENDED_LINE, createLossRecord } from "./game/lossBound.js";
import { browserEnv, browserMajor, hostOs, isMobile, offersWebGpu, readSignals, type GpuSignals, type NavigatorLike } from "./game/gpuSignals.js";
import { adapterVerdict, loadVerdict, type LoadVerdict } from "./game/loadCheck.js";
import { creditsEntries } from "./game/credits.js";
import { renderTurnedAway, type TurnedAwayHandle } from "./game/turnedAway.js";
import { turnedAwayModel, visitorDevice, type TurnedAwayView } from "./game/turnedAwayModel.js";
import {
  LOADING_LINE,
  START_FAILED_LINE,
  autoPick,
  launchLine,
  liteProbeSteps,
  startFallbacks,
  startHike,
  startupTier,
  type ProbeSteps,
  type StartupTier,
} from "./game/frameProbe.js";
import { createHud } from "./game/hud.js";
import { createModeKeeper, type GameMode } from "./game/gameMode.js";
import { createMuteButton, readMuted, writeMuted } from "./game/muteButton.js";
import { containerPixels, withGovernorDrop, type QualityTier, type VerdictEngine } from "./game/quality.js";
import type { AutoSummary } from "./game/settings.js";
import {
  createChoiceKeeper,
  leaveNotice,
  pageSessionStorage,
  pageStorage,
  parseTierOverride,
  readAutoRecord,
  recordFallback,
  takeNotice,
  writeAutoRecord,
  type TierChoice,
  type TierSource,
} from "./game/tierChoice.js";
import { NOTICE_RESTARTED } from "./game/engineFailure.js";
import { createVeil, VEIL_CUT_COVER_MS, VEIL_CUT_LIFT_MS } from "./game/veil.js";

const found = document.querySelector<HTMLDivElement>("#app");
if (!found) throw new Error("#app not found");
const app: HTMLDivElement = found;
/** The veil the pages switch behind (veil.ts), and the milliseconds a new page gets to settle before it lifts. */
const veil = createVeil(document.body);
const VEIL_SETTLE_MS = 250;
/** The page's mute (muteButton.ts), on the body beside the veil: over every
 * page and film, and the hike's ambient through `gameMute` while one runs. */
let gameMute: ((muted: boolean) => void) | null = null;
const mute = createMuteButton(document.body, {
  muted: readMuted(pageStorage()),
  showKey: !isTouchDevice(),
  onChange: (on) => {
    writeMuted(pageStorage(), on);
    gameMute?.(on);
    activeIntro?.overlay.setSound();
  },
});

let running: { dispose(): void } | null = null;
// The match on this page, when the route is the game's: what a lobby opened
// mid-game is handed to. Null on the landing page.
let game: GameHandle | null = null;
let landing: LandingHandle | null = null;
/** The title page's loop behind its still, while the title page is up. */
let titleLoop: TitleLoop | null = null;
/** The intro film, loading its head from the title page on, for Play to take (`filmHead.ts`). */
const filmHead = createFilmHead({
  video: () => document.createElement("video"),
  // Chrome preloads a film's metadata only on a cellular connection: there the page fetches the head itself first.
  fetchHead: (src) => (onCellular(navigator as { connection?: { type?: string } }) ? fetchFilmHead(src) : null),
});
// Whether the game's pause menu is open. Only the game sets it; leaving the
// game route resets it, so the roster never stays "full" on a stale flag.
let paused = false;

// The shell identifies itself through the user agent alone — its version is a
// DayHike/x.y.z token, unset on the web. The base the invite is built on comes
// from the build (VITE_WEB_BASE) and falls back to the page's own origin plus
// the router's base, which is the same address everywhere now that the shell
// loads the site itself.
const desktop = isDesktop();
const touch = isTouchDevice();
const host = hostPlatform();
const appVersion = desktopVersion();
const webBase = import.meta.env.VITE_WEB_BASE || `${location.origin}${BASE.replace(/\/+$/, "")}`;
const latestUrl = import.meta.env.VITE_DOWNLOADS_URL;

// latest.json is fetched once per page load and never blocks the landing.
let latest: DesktopRelease | null = null;
const latestReady: Promise<void> = latestUrl
  ? fetch(latestUrl, { cache: "no-cache" })
      .then((res) => (res.ok ? res.json() : null))
      .then((json: unknown) => {
        latest = parseLatest(json);
      })
      .catch(() => {
        latest = null;
      })
  : Promise.resolve();

// ---- telemetry -----------------------------------------------------------------
// What this page tells of itself (net/telemetry.ts): a session id for the
// visit, a visitor id for the browser, the build, the version of the library
// its hikes are drawn with and the versions that decide whether two pages
// can play together, the platform, and the page's own facts
// (where it came from, which path, the language, the zone, the viewport, the
// user agent, whether a robot drives it, whether a tester's browser). Made
// before anything else runs, so the start's own failures are heard; off
// without a URL, which development has none of unless asked (`telemetryUrl`,
// which also takes the tester mark, so it is read after).
const telemetry: Telemetry = createTelemetry(
  telemetryUrl(import.meta.env, location, pageStorage()),
  {
    sid: createLobbyId(),
    vid: visitorId(pageStorage(), createLobbyId) ?? "",
    build: import.meta.env.VITE_BUILD_SHA || "dev",
    // The tag of Babylon Lite the build pins, which the hike is drawn with.
    lite: __LITE_VERSION__,
    proto: PROTOCOL_VERSION,
    gen: GEN_VERSION,
    desktop,
    shell: appVersion ?? "",
    os: host,
    browser: browserMajor(navigator.userAgent),
    touch,
    ref: referrerOf(document.referrer),
    path: location.pathname,
    lang: navigator.language,
    tz: timeZone(),
    vw: window.innerWidth,
    vh: window.innerHeight,
    ua: navigator.userAgent.slice(0, 120),
    wd: navigator.webdriver === true,
    tester: testerMark(pageStorage()),
  },
  browserDeps(),
);
// What the hike's renderer and its library print is the console's, which
// the capture wraps: nothing of theirs is printed past it.
installErrorCapture(telemetry, window, console, (window as unknown as { __dh?: EarlyCatch }).__dh);
// Every change of visibility is a row: the last `hidden` is "last seen" for a
// page that never says goodbye. On the way out, everything held goes by
// beacon with the session's counts; a tab put in the background flushes too,
// since it may never come back.
document.addEventListener("visibilitychange", () => {
  telemetry.event("visibility", { state: document.visibilityState });
  if (document.visibilityState === "hidden") telemetry.flush({ beacon: true });
});

/** The IANA zone the browser keeps time in, or "" where it will not say. */
function timeZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone;
  } catch {
    return "";
  }
}

// ---- the lobby ---------------------------------------------------------------
// One per page visit, above routes: navigating never closes it. `selfId` is the
// peer id on the signaling server for the whole visit; a reload is a new peer.
// The router's id generator rather than crypto.randomUUID directly: randomUUID
// needs a secure context, and this runs at module load, so a bare http:// LAN
// address — exactly where two-machine testing happens — would take the whole
// page down rather than one feature.
const selfId = createLobbyId();
// What the browser says of the GPU, read once at load: tens of milliseconds,
// at most 2 s for the WebGPU adapter. A hike's tier is decided from it.
const signalsRead = readSignals(browserEnv());
const signalsReady = signalsRead.signals;
let signals: GpuSignals | null = null;
// The Settings panel's Auto line waits on them, and the load check's verdict.
void signalsReady.then((read) => {
  signals = read;
  telemetry.set({ gpu: (read.renderer ?? "").slice(0, 120), adapter: read.adapterStatus, cores: read.cores ?? 0, mem: read.memoryGb ?? 0, mobile: read.mobile });
  const known = loadVerdict(webgpuOffered, read);
  if (known !== null) settleVerdict(known);
  // The adapter had not answered when the signals went on without it: not
  // known, and nothing is refused meanwhile. The same request's answer
  // decides when it comes, however late.
  else void signalsRead.adapter.then((later) => settleVerdict(adapterVerdict(later)));
  repaintLanding();
});

// ---- the load check ------------------------------------------------------------
// Whether this browser and GPU can play (`loadCheck.ts`), decided once a
// page: at once, before the first render, where the browser offers no WebGPU
// at all; else when the GPU's signals are in, from the adapter their one
// request was answered with. While it is not known (null) nothing is
// refused: the landing page is shown, and a hike or a staged scene asked for
// meanwhile waits for the signals before anything of it starts (`render`).
// Once it is "cannot", every route shows the page for those turned away
// (`showTurnedAway`), and nothing of a hike is fetched, made or drawn.
const webgpuOffered = offersWebGpu(navigator as NavigatorLike);
let verdict: LoadVerdict | null = loadVerdict(webgpuOffered, null);
/** The page for those turned away, once it is up: it stays for the page's life. */
let turnedAway: TurnedAwayHandle | null = null;
/** Whether the visitor's `turned_away` row has been sent: one a page. */
let turnedAwayTold = false;

/**
 * The verdict is in. Where it is "cannot": the visitor's one row says why
 * (`turned_away`: the reason, and what the adapter is short of where the
 * check named it), sent once the GPU's signals are in, so that it carries
 * what every row says of the GPU; a lobby joined or being joined meanwhile
 * is left, so no host waits on a hiker who cannot play; and the page for
 * those turned away takes the place of whatever is shown, a hike that had
 * started on an adapter request still unanswered among it.
 */
function settleVerdict(next: LoadVerdict): void {
  verdict = next;
  if (next.play) return;
  if (!turnedAwayTold) {
    turnedAwayTold = true;
    telemetry.event("turned_away", next.short === null ? { reason: next.reason } : { reason: next.reason, short: next.short });
  }
  if (joining) abandonAttempt();
  if (lobby !== null) {
    lobby.leave();
    detach();
  }
  // Already up (no WebGPU, known as the page loaded): what the signals add is the GPU's name, for the app's offer.
  if (turnedAway !== null) turnedAway.setView(turnedAwayView(next));
  else render(app);
}

/** What the page for those turned away shows now (`turnedAwayModel`). */
function turnedAwayView(why: Exclude<LoadVerdict, { play: true }>): TurnedAwayView {
  const nav = navigator as NavigatorLike;
  return turnedAwayModel({
    reason: why.reason,
    short: why.short,
    desktop,
    device: visitorDevice(hostOs(nav), isMobile(nav), navigator.userAgent),
    host,
    userAgent: navigator.userAgent,
    renderer: signals?.renderer ?? null,
    latest,
  });
}

// ---- the graphics setting ------------------------------------------------------
// The player's choice lives in localStorage; where the storage refuses a write
// it is held for the page's life instead, and the Settings screen says so
// until a write succeeds (`createChoiceKeeper`).

const tierChoice = createChoiceKeeper(pageStorage);
const currentChoice = (): TierChoice => tierChoice.choice();
const choiceStored = (): boolean => tierChoice.stored();
/** The line for a stored choice put back on Auto after its tier did not
 * start, shown on the Settings screen until the next choice. */
let choiceNotice: string | null = null;
const saveChoice = (choice: TierChoice): void => {
  tierChoice.save(choice);
  choiceNotice = null;
  telemetry.event("settings", { choice });
};
// The mode (gameMode.ts), kept the same way; the hike reads it where its address names none.
const modeChoice = createModeKeeper(pageStorage);
const currentMode = (): GameMode => modeChoice.mode();
const saveMode = (mode: GameMode): void => {
  modeChoice.save(mode);
  telemetry.event("settings", { mode });
};

/**
 * A tier failed to build, at a hike's start or on a switch mid-hike: what it
 * leaves is `recordFallback`'s (a `build` verdict so Auto does not try it
 * again, a stored choice of it put back on Auto with a line saying so, nothing
 * under `?tier=`). When nothing built and the hike is ending, the landing gets
 * a line saying why.
 */
function onTierFallback(fallback: { attempted: QualityTier; built: QualityTier | null; source: TierSource }): void {
  if (signals !== null) {
    const pixels = app === null ? 0 : containerPixels(app);
    const record = readAutoRecord(pageStorage());
    const now = Date.now();
    const engine = verdictEngineNow();
    const pick = autoPick(signals, { record, pixels, now, engine });
    const out = recordFallback({ ...fallback, record, gpu: pick.gpu, browser: signals.browser, cls: pick.cls, choice: currentChoice(), pixels, now, engine });
    if (out.record !== null) writeAutoRecord(pageStorage(), out.record);
    if (out.choice !== null) saveChoice(out.choice);
    if (out.notice !== null) choiceNotice = out.notice;
  }
  telemetry.event("tier_fallback", { attempted: fallback.attempted, built: fallback.built ?? "none", source: fallback.source });
  if (fallback.built === null) leaveNotice(pageSessionStorage(), "The last hike ended because the graphics could not be restarted.", Date.now());
}

/** The governor lowered Auto's tier: remembered for this GPU, browser and
 * class, so the next hike starts one step down too (`withGovernorDrop`). */
function onGovernorDrop(running: QualityTier): void {
  telemetry.event("governor_drop", { running });
  if (signals === null) return;
  const pixels = app === null ? 0 : containerPixels(app);
  const record = readAutoRecord(pageStorage());
  const now = Date.now();
  const engine = verdictEngineNow();
  const pick = autoPick(signals, { record, pixels, now, engine });
  const next = withGovernorDrop(record, pick.gpu, signals.browser, pick.cls, running, pixels, now, engine);
  if (next !== null) writeAutoRecord(pageStorage(), next);
}

/** A line left for the landing by the hike that just ended, taken when the landing is built. */
let landingNotice: string | null = null;

/** What Auto would pick here now, or null until the GPU's signals are in. */
function autoSummary(): AutoSummary | null {
  if (signals === null) return null;
  const pixels = app === null ? 0 : containerPixels(app);
  const pick = autoPick(signals, { record: readAutoRecord(pageStorage()), pixels, now: Date.now(), engine: verdictEngineNow(), stepSettles: probeSteps(signals).settle });
  return { tier: pick.tier, probePending: pick.probeFrom !== null, ceiling: pick.ceiling };
}
// Bumped by every render, so a hike whose tier is still being decided for a
// page that has since been left is never built.
let renderToken = 0;
let selfName = loadName();
let lobby: Lobby | null = null;
let lobbyError: string | undefined;
// Play was pressed; the world builds on the next frame (see `onPlay`).
let launching = false;

/**
 * The intro over a start (`introOverlay.ts`). Made on Play, in the click,
 * so the video plays with sound; taken by the game route's render, which
 * mounts it over the hike, gates the download on its buffer and feeds it the
 * loading bar; cut by a hold, the step-out click or the video failing, when
 * the hike takes the pointer and the overlay goes.
 */
type IntroRun = {
  overlay: IntroOverlay;
  /** The animation frame drawing it, until the cut. */
  frame: number;
  /** Set once the hike is launched: what the cut does to it. */
  launched: ((reason: CutReason) => void) | null;
  /** A cut before the launch (the video failed at once), kept for it. */
  cutEarly: CutReason | null;
};
/** Made by Play, waiting for the game route's render. */
let pendingIntro: IntroRun | null = null;
/** Playing over the hike being started. */
let activeIntro: IntroRun | null = null;

/** The intro's file: `?intro=<url>` names one for development, `?intro=off`
 * plays none, else the film shipped with the build, if any. */
function introSource(): string | null {
  const asked = new URLSearchParams(location.search).get("intro");
  if (asked === "off") return null;
  if (asked !== null && asked !== "") return asked;
  return videoUrl();
}

/** Seconds of video in hand before the download starts, and the longest the
 * download waits for them: the film has the line to itself under its fade in. */
const INTRO_BUFFER_S = 6;
const INTRO_BUFFER_MAX_MS = 3000;
/**
 * Seconds of video in hand before the build begins, and the longest the
 * build waits for them. The build stops the page while it runs (1.7 to 2.3 s
 * on a laptop, 4.4 to 5.1 s on a phone, as measured 2026-11-11), and a film
 * is fed its file through the page: it plays through a stop on what it has
 * buffered and stands when that runs out. On a slow machine it does stand:
 * a rented rig's film fell 4 to 20 s behind in a start, a page stop at a
 * time. The six seconds of the download's gate are partly played by the time
 * the engine is made; a browser keeps about ten seconds ahead, so nine is
 * asked for. (A phone's film was first read as standing through its build;
 * that reading was the page's stop, not the film's. Measured rightly, its
 * film plays through a build of 4 to 6 s.)
 */
const INTRO_BUILD_BUFFER_S = 9;
const INTRO_BUILD_BUFFER_MAX_MS = 2000;

/** Resolves once the video has `seconds` buffered ahead, or `maxMs` have passed. */
function waitForBuffer(overlay: IntroOverlay, seconds: number, maxMs: number): Promise<void> {
  return new Promise((resolve) => {
    const began = performance.now();
    const check = (): void => {
      if (overlay.bufferedAhead() >= seconds || performance.now() - began >= maxMs) resolve();
      else setTimeout(check, 100);
    };
    check();
  });
}

function endIntro(run: IntroRun | null): void {
  if (run === null) return;
  cancelAnimationFrame(run.frame);
  run.overlay.dispose();
  setLoadProgress(null);
  if (pendingIntro === run) pendingIntro = null;
  if (activeIntro === run) activeIntro = null;
}

/**
 * The intro cut: the overlay goes, and the hike, once launched, takes over.
 * Behind a quick dip of the veil (veil.ts), so the film's last frame and the
 * hike's first are not one hard cut; a film that failed cuts at once.
 */
function cutIntro(run: IntroRun, reason: CutReason): void {
  const cut = (): void => {
    endIntro(run);
    if (run.launched !== null) run.launched(reason);
    else run.cutEarly = reason;
  };
  if (reason === "error" || activeIntro !== run) {
    cut();
    return;
  }
  void veil.cover(VEIL_CUT_COVER_MS).then(() => {
    cut();
    setTimeout(() => veil.lift(VEIL_CUT_LIFT_MS), VEIL_SETTLE_MS);
  });
}

/**
 * Starts the intro film's head start once the page has loaded, where the connection is one to
 * spend on film: the title page makes the film's element early, so the film has its first seconds
 * and its decoder by the time Play is tapped.
 */
function warmFilmHead(): void {
  warmWhenLoaded(
    {
      loaded: () => document.readyState === "complete",
      onLoad: (run) => window.addEventListener("load", run, { once: true }),
      // Play before the page's load plays the film from an element of its own: no second fetch then.
      still: () => landing !== null && pendingIntro === null,
    },
    () => {
      const src = introSource();
      if (src !== null && filmHeadWanted(titleLoopEnv(), src)) filmHead.warm(src);
    },
  );
}

function startIntro(src: string, muted: boolean): IntroRun {
  const run: IntroRun = { overlay: null as unknown as IntroOverlay, frame: 0, launched: null, cutEarly: null };
  // The film the title page has been loading, when there is one for this file; else one made here.
  const deps = { video: () => filmHead.take(src) ?? document.createElement("video"), now: () => performance.now() };
  run.overlay = createIntroOverlay(app, { src, captions: INTRO_CAPTIONS, muted, sound: () => !mute.muted(), onCut: (reason) => cutIntro(run, reason) }, deps);
  const draw = (now: number): void => {
    run.overlay.render(now);
    run.frame = requestAnimationFrame(draw);
  };
  run.frame = requestAnimationFrame(draw);
  // A browser that refuses the play (no gesture it accepts) is a video that
  // failed: the hike starts as one with no intro does.
  run.overlay.play().catch(() => cutIntro(run, "error"));
  return run;
}
let detachLobby: (() => void) | null = null;
// One create-or-join in flight at a time. The button now disables itself the
// moment an attempt starts, but this guard is what actually holds the line:
// without it a double-click during an ordinary server round trip runs
// `openLobby` twice with `lobby === null` both times. The second attach
// overwrites `lobby` and `detachLobby`, and the first lobby is then
// unreachable but very much alive: still subscribed, so its `onChange` keeps
// calling `follow` and can steer navigation, and its socket still has
// `closedByUs === false` with `membership` set, so it reconnects forever and
// the orphaned room stays hosted. The desktop join form has the same window.
let joining = false;

// ---- the attempt in flight (the roster's pending bar) -----------------------
// A cold Cloud Run instance puts 1-4 s between clicking Invite and the reply,
// and until this existed the panel spent all of it looking untouched. The
// clock owns the timers behind the bar; the epoch is how an attempt is
// abandoned without waiting for its socket to answer — Retry bumps it, and
// every callback still in the air from the old attempt sees the mismatch and
// does nothing.
let clock: AttemptClock | null = null;
let attemptSignaling: SignalingClient | null = null;
let attemptRestart: (() => void) | null = null;
let attemptEpoch = 0;

const roster = createRoster({
  onInvite: () => void openLobby(),
  onRetry: retryAttempt,
  onInviteCopied: () => telemetry.event("invite_copied"),
  onRename: (raw) => {
    selfName = saveName(raw);
    lobby?.setName(selfName);
    // The repaint the roster's rename contract requires: it is what removes
    // the edit field, so it must happen on every onRename.
    paintRoster();
  },
});

function paintRoster(): void {
  // Gone with everything else of the game once a visitor is turned away.
  if (turnedAway !== null) return;
  roster.setView(
    rosterModel({
      lobby: lobby?.state ?? null,
      selfId,
      selfName,
      inviteUrl: (id) => inviteLink(id, webBase),
      inGame: parseRoute(location.pathname).kind === "game",
      hidden: parseRoute(location.pathname).kind === "scene",
      paused,
      attempt: clock?.attempt ?? null,
      touch,
      error: lobbyError,
    }),
  );
}

function newSignaling() {
  return createSignalingClient(signalingUrl(import.meta.env, location));
}

/**
 * Start reporting an attempt, and return the epoch that identifies it.
 *
 * `restart` is what Retry re-runs, so it must close over everything the verb
 * needs — for a join, the lobby id, which is otherwise gone by the time the
 * overrun row appears.
 */
function beginAttempt(kind: "invite" | "join", restart: () => void): number {
  attemptStartedAt = performance.now();
  telemetry.event(kind);
  clock = startAttemptClock({
    kind,
    onRepaint: paintRoster,
    // Only the bar has moved, so only the bar is touched: a full repaint here
    // would rebuild the panel ten times a second. See `Roster.setPendingProgress`.
    onTick: () => {
      if (clock === null) return;
      const pending = attemptPending(clock.attempt);
      if (pending !== null) roster.setPendingProgress(pending.progress);
    },
  });
  attemptRestart = restart;
  attemptEpoch += 1;
  return attemptEpoch;
}

function endAttempt(): void {
  clock?.stop();
  clock = null;
  attemptSignaling = null;
  attemptRestart = null;
}

/**
 * Drop the attempt in flight without waiting for its socket to answer. The
 * epoch bump is what makes that safe: the pending `create`/`join` promise
 * still settles later, and its handler finds the mismatch and returns.
 */
function abandonAttempt(): void {
  attemptEpoch += 1;
  attemptSignaling?.close();
  endAttempt();
  joining = false;
}

/** When the attempt in flight began, for its row's duration. */
let attemptStartedAt = 0;
const attemptMs = (): number => Math.round(performance.now() - attemptStartedAt);

/** A lobby joined or made: its row, and every row names it from here to `lobby_end`. */
function lobbyEntered(kind: "invite" | "join", joined: Lobby): void {
  telemetry.context({ lobby: joined.state.id });
  telemetry.event("lobby_joined", { kind, ms: attemptMs(), members: joined.state.members.length, role: joined.state.role });
}

function retryAttempt(): void {
  const restart = attemptRestart;
  abandonAttempt();
  lobbyError = undefined;
  restart?.();
}

function attachLobby(next: Lobby): void {
  lobby = next;
  lobbyError = undefined;
  // A game already running started without this lobby, so it has not heard
  // that there is one to answer offers over. Without this the joiner the
  // roster shows never connects: their offer reaches a host with no handler
  // for it, and they time out with the wrong explanation.
  game?.attachLobby(next);
  // The roster's ids, so a change says who came and who went, not only the
  // new size: a swap of one for one is two moves at the same count.
  let members = new Set(next.state.members.map((m) => m.id));
  const offChange = next.onChange(() => {
    const now = new Set(next.state.members.map((m) => m.id));
    let joined = 0;
    let left = 0;
    for (const id of now) if (!members.has(id)) joined += 1;
    for (const id of members) if (!now.has(id)) left += 1;
    if (joined > 0 || left > 0) {
      members = now;
      telemetry.event("lobby_change", { members: now.size, joined, left });
    }
    paintRoster();
    follow(next);
  });
  const offEnd = next.onEnd((reason) => {
    telemetry.event("lobby_end", { reason, members: next.state.members.length });
    // The row above still names the lobby; none after it does.
    telemetry.context({ lobby: null });
    detach();
    if (reason === "host_gone") lobbyError = "The host left.";
    paintRoster();
    // A follower's page is wherever the host last sent it; a lobby that ends
    // mid-game is handled by the game's own session-end path, but a lobby that
    // ends on a landing page just needs the roster to say so.
    if (parseRoute(location.pathname).kind !== "game") repaintLanding();
  });
  detachLobby = () => {
    offChange();
    offEnd();
  };
  paintRoster();
  repaintLanding();
  follow(next);
}

function detach(): void {
  detachLobby?.();
  detachLobby = null;
  lobby = null;
}

/** A follower goes where the host is (`followsTo`). The host's route is ""
 * until known, and the landing page and its panels are one place: a follower
 * in its own Settings stays there while the host is on the landing. The
 * overrides (`?tier=`, `?probe=`) are each page's own: the route
 * is taken without them (`stripOverrides`), which a host that still announces
 * them would otherwise impose on this machine; they neither make a route
 * differ nor leave the follower's URL when it moves (`navigateTo` carries
 * them). */
function follow(active: Lobby): void {
  if (active.state.role !== "client") return;
  const target = stripOverrides(active.state.route);
  if (followsTo(target, currentRoutePath())) navigateTo(target);
}

/** Host side: tell the lobby where we are now, a landing panel as the landing
 * page (`announcedPath`), without this page's own overrides. Called from
 * render(). */
function announceRoute(): void {
  if (lobby !== null && lobby.state.role === "host") lobby.setRoute(hostRoute(currentRoutePath()));
}

// Landing routes are announced at once; the game route only after its first
// frame has painted, so no follower is invited while the world build still
// holds this page's thread (see routeAnnounce.ts).
const announcer = createRouteAnnouncer(announceRoute);

async function openLobby(): Promise<void> {
  if (lobby !== null || joining) return;
  joining = true;
  // A failed attempt must not haunt the next one: without this the line from a
  // create that could not reach the server rides along into a later solo game.
  lobbyError = undefined;
  const epoch = beginAttempt("invite", () => void openLobby());
  const signaling = newSignaling();
  attemptSignaling = signaling;
  const offOpen = signaling.onOpen(() => {
    if (epoch === attemptEpoch) clock?.connected();
  });
  paintRoster();
  try {
    const created = await createLobby({
      signaling,
      peerId: selfId,
      lobbyId: createLobbyId(),
      name: selfName,
      route: hostRoute(currentRoutePath()),
    });
    // Abandoned while the reply was in the air. The room is real and hosted by
    // us, so say goodbye properly rather than dropping the socket and leaving
    // an orphan for the server's grace window to clear.
    if (epoch !== attemptEpoch) {
      created.leave();
      return;
    }
    endAttempt();
    lobbyEntered("invite", created);
    attachLobby(created);
  } catch (err) {
    if (epoch !== attemptEpoch) return;
    signaling.close();
    endAttempt();
    const code = err instanceof Error ? err.message : String(err);
    telemetry.event("lobby_error", { kind: "invite", code, ms: attemptMs() });
    lobbyError = lobbyErrorMessage(code);
    paintRoster();
  } finally {
    offOpen();
    if (epoch === attemptEpoch) joining = false;
  }
}

async function enterLobby(lobbyId: string): Promise<void> {
  // Answered before the in-flight guard: arriving at the lobby we are already
  // in is a no-op in its own right, not something the guard should swallow.
  if (lobby !== null && lobby.state.id === lobbyId) return;
  if (joining) return;
  joining = true;
  if (lobby !== null) {
    lobby.leave();
    detach();
  }
  lobbyError = undefined;
  const epoch = beginAttempt("join", () => void enterLobby(lobbyId));
  const signaling = newSignaling();
  attemptSignaling = signaling;
  const offOpen = signaling.onOpen(() => {
    if (epoch === attemptEpoch) clock?.connected();
  });
  paintRoster();
  try {
    const joined = await joinLobby({ signaling, peerId: selfId, lobbyId, name: selfName });
    if (epoch !== attemptEpoch) {
      joined.leave();
      return;
    }
    endAttempt();
    lobbyEntered("join", joined);
    attachLobby(joined);
  } catch (err) {
    if (epoch !== attemptEpoch) return;
    signaling.close();
    endAttempt();
    const code = err instanceof Error ? err.message : String(err);
    telemetry.event("lobby_error", { kind: "join", code, ms: attemptMs() });
    lobbyError = lobbyErrorMessage(code);
    paintRoster();
    repaintLanding();
  } finally {
    offOpen();
    if (epoch === attemptEpoch) joining = false;
  }
}

/** Leaving a game: a follower leaves the lobby too; a host stays
 * and carries everyone home through render()'s announce. */
function exitGame(): void {
  telemetry.event("exit");
  if (lobby !== null && lobby.state.role === "client") {
    lobby.leave();
    detach();
  }
  navigateToLanding();
}

/** A follower whose connection to the host failed plays on alone: leave the
 * party and start a fresh world, as if the invite had never been opened. */
function continueOffline(): void {
  telemetry.event("continue_offline");
  if (lobby !== null && lobby.state.role === "client") {
    lobby.leave();
    detach();
  }
  navigateToGame(createLobbyId());
}

// Say goodbye on the way out so departures are immediate rather than waiting
// on the server's grace window. `pagehide` fires on close, reload, and
// navigation away — every case a socket close would otherwise have to imply.
window.addEventListener("pagehide", () => {
  lobby?.leave();
  telemetry.end("pagehide");
});

// ---- rendering ---------------------------------------------------------------

function landingInput(over: Partial<LandingInput> = {}): LandingInput {
  return {
    desktop,
    host,
    appVersion,
    latest,
    follower: lobby !== null && lobby.state.role === "client",
    touch,
    launching,
    quality: {
      choice: currentChoice(),
      auto: autoSummary(),
      override: parseTierOverride(location.search),
      stored: choiceStored(),
      notice: choiceNotice ?? undefined,
      mode: currentMode(),
    },
    notice: landingNotice ?? undefined,
    ...over,
  };
}

function repaintLanding(): void {
  landing?.setView(landingModel(landingInput()));
}

function panelFor(route: Route): LandingPanel {
  // The shell has no downloads panel to show — an app does not download
  // itself, so landingModel omits the content — and a direct /downloads there
  // would slide in an empty page. Home is what that route means on desktop.
  if (route.kind === "downloads") return desktop ? "home" : "downloads";
  if (route.kind === "credits") return "credits";
  if (route.kind === "settings") return "settings";
  return "home";
}

// A type predicate, not a boolean: the game branch at the end of render()
// reads `route.token`, and that only narrows if this call tells the compiler
// what the early return ruled out.
function isLandingRoute(route: Route): route is Exclude<Route, { kind: "game" }> {
  return (
    route.kind === "landing" ||
    route.kind === "downloads" ||
    route.kind === "credits" ||
    route.kind === "settings" ||
    route.kind === "party"
  );
}

function onPlay(): void {
  // Solo or host: a fresh token, a fresh world. Followers never see Play.
  // The button shows Loading… first and the build starts once that has
  // painted: `startGame` blocks the page for a second or more, and a tap
  // that changed nothing reads as a tap that missed.
  if (launching) return;
  launching = true;
  telemetry.event("play", { party: lobby === null ? 1 : lobby.state.members.length });
  // The game's load gets the bandwidth: the loop's download stops here.
  titleLoop?.stop();
  const src = introSource();
  if (src !== null) {
    endIntro(pendingIntro);
    pendingIntro = startIntro(src, false);
  }
  repaintLanding();
  afterNextPaint(() => {
    launching = false;
    navigateToGame(createLobbyId());
  });
}

// ---- the engine ----------------------------------------------------------------
// The page makes no engine. A hike, a staged scene and every step of the tier
// check are drawn by the hike's own renderer, which makes its engine from the
// canvas it is handed and draws with WebGPU alone. An engine that fails under
// a hike is answered by a live rebuild of the renderer (`app.ts`), never by a
// reload, which would end a party; there is no other engine to remember it
// against or to fall back to, and the address's `?engine=` is read by
// nothing.

/**
 * The engine a hike is drawn with, which Auto's verdicts are kept for
 * (`AutoVerdict.engine`) and looked up under: WebGPU, in every browser, since
 * the hike's own renderer draws with nothing else and the tier check is
 * measured on it.
 */
function verdictEngineNow(): VerdictEngine {
  return "webgpu";
}

/**
 * The tier check's steps as the page measures them, on the hike's own
 * renderer: whether one can be measured in this browser, and why not where
 * it cannot (`liteProbeSteps`). A browser that offers no WebGPU, or offers
 * it and has no adapter (the GPU's signals, `read`, from the page's one
 * adapter request), has nothing to measure with, and no start reaches here
 * there: the load check has turned the visitor away (`settleVerdict`). What
 * does reach here with no adapter read is a request that had not answered
 * when the signals went on without it, which may yet be measured.
 */
function probeSteps(read: GpuSignals): ProbeSteps {
  return liteProbeSteps(read.adapterStatus !== "none");
}

/**
 * A hike's canvas: a fresh one, with no engine on it. The hike's renderer
 * makes its own engine from its canvas (`createHikeRenderer`), so the page
 * makes none for a hike, at its start or for a switch of tier or a rebuild
 * later, and none is kept from one hike for the next: a hike's renderer
 * lets its engine go with itself. No canvas is made
 * where the load check's verdict is "cannot": no route reaches here then
 * (`render` shows the page for those turned away first), and a renderer a
 * running hike asks for after a verdict that came late is refused.
 */
function hikeCanvas(): Promise<EngineOnCanvas> {
  if (verdict !== null && !verdict.play) return Promise.reject(new Error(`this browser cannot draw a hike (${verdict.reason})`));
  return Promise.resolve({ canvas: document.createElement("canvas"), engine: null, watchers: null });
}

/**
 * A failure of the engine a hike is drawn with: its row, and the HUD's line
 * for the renderer built again in its place. Nothing is remembered of it for
 * a later hike and nothing is pinned in the address: the rebuild is on
 * WebGPU as the hike was, and how often a device may be lost is the page's
 * own count (`lostDevices`).
 */
function engineFailed(reason: "pipeline" | "lost"): string {
  telemetry.event("engine_failed", { reason });
  return NOTICE_RESTARTED;
}

/**
 * The devices this page's hikes have lost (`lossBound.ts`), by the page's
 * clock: every hike's, since the machine is the same in the next one. A
 * hike notes each loss here and reads what the bound on rebuilds makes of
 * it; one that ends by the bound leaves the landing page its line, as a
 * hike whose graphics could not be restarted does (`onTierFallback`).
 */
const lostDevices = createLossRecord();
const losses = {
  note: () => lostDevices.note(performance.now()),
  ended: () => void leaveNotice(pageSessionStorage(), LOSS_ENDED_LINE, Date.now()),
};

// `app` is passed in rather than closed over: the null check above does not
// narrow inside a hoisted function declaration, which could be called first.
/** Which page a route is, for the veil: the title, the game, or a scene. */
function pageOf(route: ReturnType<typeof parseRoute>): "landing" | "game" | "scene" {
  if (route.kind === "scene") return "scene";
  return isLandingRoute(route) ? "landing" : "game";
}
/** The page the last render put up, so a change of page can go behind the veil. */
let shownPage: "landing" | "game" | "scene" | null = null;
/** Set for the one render a route asks for itself once the GPU's signals are in: the same navigation, so no second `page` row. */
let rendersAgain = false;

/**
 * The page for a visitor who cannot play (`turnedAway.ts`), in place of
 * every route: the landing page and its panels, an invitation, a game's
 * address, a staged scene. Put up once and left up, since the verdict does
 * not change while the page lives; whatever was shown or starting goes
 * first, and nothing of a hike is asked for after. The address is left as
 * it is, so the same link works once the visitor has a browser that plays.
 */
function showTurnedAway(container: HTMLDivElement, route: Route, why: Exclude<LoadVerdict, { play: true }>): void {
  // Whatever start was waiting on this page is no longer the page's.
  renderToken += 1;
  telemetry.mark("turned-away");
  if (turnedAway !== null) return;
  running?.dispose();
  running = null;
  game = null;
  paused = false;
  landing = null;
  endIntro(activeIntro);
  endIntro(pendingIntro);
  container.replaceChildren();
  // Nothing here makes a sound or starts a party: the page's mute goes, and its key with it, and the roster, which
  // hidden would still take the keyboard's focus and a screen reader's.
  mute.dispose();
  roster.dispose();
  if (veil.down) veil.lift();
  // The navigation's row, where no route's own render sent it first: a visitor turned away as the page loads.
  if (shownPage === null) {
    telemetry.event("page", { kind: route.kind });
    window.visits?.page?.();
  }
  const handle = renderTurnedAway(container, turnedAwayView(why), {
    still: titleStillUrl(),
    // The credit the still's works are owed, within reach here as from the landing page.
    credits: creditsEntries(),
    onDownload: (platform) => telemetry.event("download", { platform }),
  });
  turnedAway = handle;
  // The app's offer waits on the release, which lands after the page is up.
  void latestReady.then(() => handle.setView(turnedAwayView(why)));
}

function render(container: HTMLDivElement): void {
  const route = parseRoute(location.pathname);
  if (verdict !== null && !verdict.play) {
    showTurnedAway(container, route, verdict);
    return;
  }
  // A change of page goes behind the veil (veil.ts): it comes down first,
  // this render runs again under it, and it lifts once the page is up. The
  // intro's own film carries the title into the game, so it goes without.
  const page = pageOf(route);
  if (shownPage !== null && page !== shownPage && !veil.down && pendingIntro === null) {
    void veil.cover().then(() => render(container));
    return;
  }
  const switched = shownPage !== page;
  shownPage = page;
  if (switched && veil.down) setTimeout(() => veil.lift(), VEIL_SETTLE_MS);
  const token = ++renderToken;
  // One row a navigation: which page, and which of the landing's panels. Sent
  // once a running game is torn down, so a landing row never carries the match
  // it left (`app.ts` clears the context when the game is disposed).
  let pageSent = rendersAgain;
  rendersAgain = false;
  const pageRow = (): void => {
    if (pageSent) return;
    pageSent = true;
    telemetry.event("page", { kind: route.kind });
    // csarko.sh's analytics (index.html): the route is a page of the visitor's journey there.
    window.visits?.page?.();
  };
  telemetry.mark(route.kind);

  // An invite: consume it (so back/forward never re-join), show the landing
  // page, and join in the background. The roster reports how that went.
  if (route.kind === "party") {
    pageRow();
    replaceWithLanding();
    // Joined once the load check has the GPU's signals and has not turned the visitor away: a host's roster
    // never shows a hiker who cannot play. A verdict not known by then (the adapter had not answered) joins.
    void signalsReady.then(() => {
      if (verdict === null || verdict.play) void enterLobby(route.lobbyId);
    });
  }

  // Landing and its panels are one page, so moving between them swaps a class
  // rather than rebuilding: a rebuild would replace the nodes the transition is
  // running on, and it would also drop and re-place the still behind them.
  if (isLandingRoute(route) && landing !== null) {
    landing.setPanel(panelFor(route));
    pageRow();
    announcer.now();
    paintRoster();
    return;
  }

  running?.dispose();
  pageRow();
  running = null;
  game = null;
  paused = false;
  landing = null;
  endIntro(activeIntro);
  container.replaceChildren();
  // The mute sits faint over a hike, under its Pause button; plain on every other page.
  mute.setHike(route.kind === "game");

  // A staged scene and a hike wait for the load check: where the GPU's
  // signals are not in yet (a game's or a scene's own address, as the page
  // loads), nothing of either starts, no worker, no film of the route's own,
  // no canvas, until they are, under the start's own line. The signals'
  // first listener settles the verdict before this one runs: turned away,
  // this render is no longer the page's; else the route is rendered again,
  // now with the signals, as the same navigation.
  if (!isLandingRoute(route) && signals === null) {
    const line = createHud(container);
    line.setStatus(LOADING_LINE);
    // The film Play started stays in the page meanwhile: taken out of it, it would stop.
    pendingIntro?.overlay.mount(container);
    running = { dispose: () => line.dispose() };
    paintRoster();
    void signalsReady.then(() => {
      if (token !== renderToken) return;
      rendersAgain = true;
      render(container);
    });
    return;
  }

  // The staged intro on its fixed world, a frame at a time for its recording:
  // the film is made on the high tier, which is what Auto means here, drawn
  // by the hike's own renderer on a canvas of its own, as a hike is
  // (`hikeCanvas`); the address's `?tier=` and a saved choice are the page's
  // own as everywhere.
  if (route.kind === "scene") {
    const choice = parseTierOverride(location.search) ?? currentChoice();
    const tier = choice === "auto" ? "high" : choice;
    void hikeCanvas().then(
      ({ canvas }) => {
        if (token !== renderToken) return;
        container.appendChild(canvas);
        const scene = runLiteSceneRoute({ canvas, container, tier }, parseSceneSearch(location.search), route.name);
        running = { dispose: () => scene.dispose() };
      },
      (error: unknown) => console.error("The scene could not be drawn.", error),
    );
    paintRoster();
    return;
  }

  if (isLandingRoute(route)) {
    endIntro(pendingIntro);
    // The still goes in first so the UI paints above it; the loop behind it
    // fetches nothing until the page has loaded. Nothing of the game is built
    // before Play, and of it only the intro film's head is fetched, so the
    // film starts at the tap.
    titleLoop = createTitleLoop(container, titleStillUrl(), titleVideoUrl(), titleLoopEnv());
    warmFilmHead();
    landingNotice = takeNotice(pageSessionStorage(), Date.now());

    const handle = renderLanding(
      container,
      landingModel(landingInput()),
      {
        onCreate: onPlay,
        onJoin: (text) => {
          const lobbyId = parseJoinLink(text, webBase);
          if (lobbyId === null) {
            handle.setView(
              landingModel(landingInput({ joinError: "That is not an invite link or lobby id." })),
            );
            return;
          }
          void enterLobby(lobbyId);
        },
        onDownloads: () => navigateToPanel("downloads"),
        onDownload: (platform) => telemetry.event("download", { platform }),
        onSettings: () => navigateToPanel("settings"),
        onChooseTier: (choice) => {
          saveChoice(choice);
          repaintLanding();
        },
        onChooseMode: (mode) => {
          saveMode(mode);
          repaintLanding();
        },
        onCredits: () => navigateToPanel("credits"),
        // Popping history where we can, so the Back button and the browser's
        // own back button do the same thing; router.ts owns the decision and
        // the case where there is nothing of ours to pop.
        onBack: () => leavePanel(browserExit),
      },
      panelFor(route),
    );
    landing = handle;
    // Repaint with the release info once it lands — unless the player has
    // already left the landing page, in which case this handle is dead.
    void latestReady.then(() => {
      if (landing === handle) handle.setView(landingModel(landingInput()));
    });

    running = {
      dispose: () => {
        titleLoop?.dispose();
        titleLoop = null;
        handle.dispose();
      },
    };
    announcer.now();
    paintRoster();
    return;
  }

  // One chain, in order (`startHike`): "Loading…" from the first moment; the
  // GPU's signals; the tier (`startupTier`: the address's override, else the
  // saved choice, else Auto, with its probe behind its own screen on a machine
  // whose GPU the browser will not name); then the hike's canvas, made only
  // now that the probe is done and its last step's renderer, canvas and
  // device have gone ("Loading…" again meanwhile); then the launch. `running`
  // covers the wait, so a render that moves on stops the probe, and disposes
  // its renderer, before building its own. A throw anywhere in the chain
  // leaves a line rather than a blank page.
  const cancelled = (): boolean => token !== renderToken;
  // The intro Play started, over the hike from here: its bar is the one the
  // loads report to, and the download waits for its buffer (`before`). A
  // follower is brought here by the host's Play, with no click of its own,
  // so its intro starts with the sound off (a browser plays it no other way
  // without a gesture) and the sound button turns it on.
  let intro = pendingIntro;
  pendingIntro = null;
  if (intro === null && lobby !== null && lobby.state.role === "client") {
    const src = introSource();
    if (src !== null) intro = startIntro(src, true);
  }
  activeIntro = intro;
  if (intro !== null) intro.overlay.mount(container);
  // The loads report to the intro's bar when there is one, and in every case
  // name their stage as telemetry's breadcrumb, so an error mid-load says
  // which stage was in progress.
  setLoadProgress(markedProgress(intro?.overlay.progress ?? null, (stage) => telemetry.mark(`load:${stage}`)));
  // The hike's trail and level check, made off this thread from now, while
  // the tier is decided, the film buffers and the engine starts: the build
  // waits for them (`beforeBuild`) and finds them made. With no worker, or
  // one that fails, the build makes them as it always did (`worldPrep.ts`).
  const prep = startWorldPrep(worldInputs(route.token, location.search));
  let prepOutcome: WorldPrepOutcome | null = null;
  // The hike's first scene (`preparedScene.ts`): asked of the same worker
  // once the tier is decided, waited for before the build, and taken by the
  // first renderer made, whose builders use its arrays in place of sampling
  // the ground. Where there is none, the build samples as it always did.
  // Nothing here holds it once it is taken: these closures live as long as
  // the hike, and a renderer made later samples its own.
  let sampling: Promise<PreparedScene | null> = Promise.resolve(null);
  let sampled: PreparedScene | null = null;
  /** The tier the scene was asked for, and the tier of the one that came (null: none came). */
  let sceneTier: QualityTier | null = null;
  let sampledFor: QualityTier | null = null;
  const takeSampled = (): PreparedScene | null => {
    const scene = sampled;
    sampled = null;
    return scene;
  };
  // Each probe step is measured on the hike's own renderer, which makes its
  // engine from the step's own canvas and lets both go with the step
  // (`runLiteProbeStep`): the page makes no engine for it. A step whose
  // renderer cannot be made, or whose device fails under it, reads nothing;
  // the game's failure handling never hears of it.
  const probe = liteProbeDeps(container);
  running = {
    dispose: () => {
      probe.abort();
      prep.dispose();
    },
  };
  // How long each step of the start took, for its `load` row: the tier's
  // decision (with its probe, where one ran), the intro's buffer, the engine,
  // the film's top-up, what the start then still waited for the world's
  // worker and then for its scene, and the build. Each lap is measured from the end of the one
  // before, and named `<step>Ms` so none shadows the row's `build` or `engine`.
  const laps: Record<string, number> = {};
  let lapStart = performance.now();
  const lap = (name: "decide" | "intro" | "engine" | "film" | "world" | "scene" | "build"): void => {
    const now = performance.now();
    laps[`${name}Ms`] = Math.round(now - lapStart);
    lapStart = now;
  };
  telemetry.mark("start:decide");
  void startHike<EngineOnCanvas>({
    signals: signalsReady,
    current: () => !cancelled(),
    showLoading: () => {
      const line = createHud(container);
      line.setStatus(LOADING_LINE);
      return line;
    },
    decide: (read, hideLoading) =>
      Promise.resolve(
        startupTier(read, { search: location.search, choice: currentChoice(), cancelled, engine: verdictEngineNow(), steps: probeSteps(read) }, {
          ...probe,
          showScreen: () => {
            hideLoading();
            return probe.showScreen();
          },
        }),
      ).then((decided) => {
        lap("decide");
        telemetry.mark("start:engine");
        sceneTier = decided.tier;
        sampling = prep.scene(decided.tier);
        return decided;
      }),
    before:
      intro === null
        ? undefined
        : () => waitForBuffer(intro.overlay, INTRO_BUFFER_S, INTRO_BUFFER_MAX_MS).then(() => lap("intro")),
    beforeBuild: async () => {
      if (intro !== null) {
        await waitForBuffer(intro.overlay, INTRO_BUILD_BUFFER_S, INTRO_BUILD_BUFFER_MAX_MS);
        lap("film");
      }
      prepOutcome = await prep.ready;
      lap("world");
      console.info(worldPrepLine(prepOutcome));
      sampled = await sampling;
      sampling = Promise.resolve(null);
      sampledFor = sampled?.tier ?? null;
      lap("scene");
      if (sceneTier !== null) console.info(sceneLine(sceneTier, sampled, laps.sceneMs ?? 0));
    },
    paint: () => new Promise((resolve) => afterNextPaint(resolve)),
    engine: () => hikeCanvas(),
    // A canvas the start has left carries no engine: there is nothing to let go.
    discard: () => undefined,
    build: (decided, onCanvas) => {
      container.appendChild(onCanvas.canvas);
      // The engine's lap ends here, a paint after it was made.
      lap("engine");
      telemetry.mark("start:build");
      launch(onCanvas, route.token, decided, () => hikeCanvas(), intro, takeSampled);
      lap("build");
      // The build has what it wanted of the worker: the worker ends, and the scene is let go of.
      prep.dispose();
      telemetry.event("load", {
        ...laps,
        tier: decided.tier,
        source: decided.source,
        engine: game?.graphics().engine ?? "none",
        prep: prepOutcome?.why ?? "none",
        prepMs: Math.round(prepOutcome?.ms ?? 0),
        scene: sampledFor === null ? "none" : "made",
      });
      telemetry.mark("game");
    },
    fail: (error) => {
      telemetry.event("start_fail", { ...laps, msg: error instanceof Error ? error.message : String(error) });
      console.error("The game could not start.", error);
      prep.dispose();
      endIntro(intro);
      // Whichever canvas the start left: a renderer that fell back to a lower
      // tier builds on a fresh one in the first one's place.
      for (const left of container.querySelectorAll("canvas")) left.remove();
      const line = createHud(container);
      line.setStatus(START_FAILED_LINE);
      running = { dispose: () => line.dispose() };
    },
  });
}

/**
 * Starts the game on `onCanvas` at the tier decided: the hike's renderer
 * makes its engine from the canvas, and the game listens to it and answers
 * its failures live (`app.ts`). A start that throws goes up to the start's
 * one catch (`startHike`). `engineForGame` hands the canvas a switch of tier
 * or a rebuild later builds on. `takeSampled` gives up the hike's first
 * scene from the world's worker, once: the first renderer made takes its
 * arrays, and one made after it samples the ground for itself.
 */
function launch(
  onCanvas: EngineOnCanvas,
  worldToken: string,
  decided: StartupTier,
  engineForGame: (tier: QualityTier, wanted: () => boolean) => Promise<EngineOnCanvas>,
  intro: IntroRun | null,
  takeSampled: () => PreparedScene | null,
): void {
  const handle = startGame(onCanvas.canvas, worldToken, {
    lobby,
    peerId: selfId,
    onExit: exitGame,
    onContinueOffline: continueOffline,
    onPauseChange: (next) => {
      paused = next;
      paintRoster();
    },
    onConnectPanel: () => {
      if (intro !== null && activeIntro === intro) cutIntro(intro, "error");
    },
    deferClipmap: intro !== null,
    takePrepared: takeSampled,
    engineFor: engineForGame,
    engineFailed,
    losses,
    tier: decided.tier,
    tierSource: decided.source,
    fallbackTiers: signals === null ? ["low"] : startFallbacks(decided.tier, decided.cls, signals.cores, signals.memoryGb),
    onTierFallback,
    onGovernorDrop,
    telemetry,
    quality: {
      choice: currentChoice,
      stored: choiceStored,
      auto: autoSummary,
      override: parseTierOverride(location.search),
      notice: () => choiceNotice,
      save: saveChoice,
    },
    mode: { choice: currentMode, save: saveMode },
    mute: {
      bind: (apply) => {
        gameMute = apply;
        apply(mute.muted());
        return () => {
          if (gameMute === apply) gameMute = null;
        };
      },
    },
  });
  game = handle;
  console.info(launchLine(decided, handle.graphics()));
  running = handle;
  const launchedAt = performance.now();
  handle.ready.then(
    () => telemetry.event("ready", { ms: Math.round(performance.now() - launchedAt) }),
    () => undefined,
  );
  // Under the intro the hike is covered until the cut, which takes the
  // pointer on the gesture it was made with and lifts the cover once it has
  // it, so no pause menu shows between; a video that failed lets the hike
  // start as one with no intro does. Ready lets the intro be skipped.
  if (intro !== null) {
    const release = handle.cover();
    // A start that fails while the world is made is the start's failure
    // (`fail` above ends the intro); nothing is left for ready to say.
    handle.ready.then(
      () => intro.overlay.ready(),
      () => undefined,
    );
    intro.launched = (reason) => {
      // Watched to its end, cut early, or failed: which, for the timeline.
      telemetry.event("intro", { reason });
      if (reason === "error") release();
      else void handle.engage().then(release);
    };
    if (intro.cutEarly !== null) intro.launched(intro.cutEarly);
  }
  announcer.afterPaint();
  paintRoster();
}

window.addEventListener("popstate", () => render(app));
render(app);
