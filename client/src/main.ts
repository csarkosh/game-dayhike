import {
  BASE,
  parseRoute,
  createLobbyId,
  currentRoutePath,
  navigateTo,
  navigateToGame,
  navigateToLanding,
  navigateToPanel,
  replaceWithLanding,
  leavePanel,
  browserExit,
  followsTo,
  hostRoute,
  type Route,
} from "./game/router.js";
import { renderLanding, type LandingHandle, type LandingPanel } from "./game/landing.js";
import { afterNextPaint } from "./game/paint.js";
import { createRouteAnnouncer } from "./game/routeAnnounce.js";
import { createLandingScene } from "./game/landingScene.js";
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
import { startGame, type GameHandle } from "./app.js";
import type { EngineOnCanvas, EngineWatchers } from "./game/rendererSwap.js";
import { recordEngineFailure, startOnEngine } from "./game/engineFailure.js";
import { AbstractEngine } from "@babylonjs/core/Engines/abstractEngine.js";
import { browserEnv, browserMajor, readSignals, type GpuSignals } from "./game/gpuSignals.js";
import { LOADING_LINE, START_FAILED_LINE, autoPick, launchLine, startFallbacks, startHike, startupTier, type StartupTier } from "./game/frameProbe.js";
import { createHud } from "./game/hud.js";
import { probeDeps } from "./game/probeScene.js";
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
import {
  adapterFromSignals,
  chooseEngine,
  engineForTier,
  fallbackHolds,
  parseEngineOverride,
  readFallback,
  recordFailure,
  resolveWebGpu,
  signalsFit,
  withEngine,
  writeFallback,
  WEBGPU_ENABLED,
  type EngineEnv,
  type EngineInput,
} from "./game/engineChoice.js";

const app = document.querySelector<HTMLDivElement>("#app");
if (!app) throw new Error("#app not found");

let running: { dispose(): void } | null = null;
// The match on this page, when the route is the game's: what a lobby opened
// mid-game is handed to. Null on the landing page.
let game: GameHandle | null = null;
let landing: LandingHandle | null = null;
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

// ---- the lobby ---------------------------------------------------------------
// One per page visit, above routes: navigating never closes it. `selfId` is the
// peer id on the signaling server for the whole visit; a reload is a new peer.
// The router's id generator rather than crypto.randomUUID directly: randomUUID
// needs a secure context, and this runs at module load, so a bare http:// LAN
// address — exactly where two-machine testing happens — would take the whole
// page down rather than one feature.
const selfId = createLobbyId();
// What the browser says of the GPU, read once at load: tens of milliseconds,
// at most 2 s for the WebGPU adapter. A hike's tier is decided from it, and
// the WebGPU rule reads the adapter from the same request (`adapterFromSignals`).
const signalsRead = readSignals(browserEnv());
const signalsReady = signalsRead.signals;
let signals: GpuSignals | null = null;
// The Settings panel's Auto line waits on them.
void signalsReady.then((read) => {
  signals = read;
  repaintLanding();
});

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
    const engine = verdictEngineNow(signals);
    const pick = autoPick(signals, { record, pixels, now, engine });
    const out = recordFallback({ ...fallback, record, gpu: pick.gpu, browser: signals.browser, cls: pick.cls, choice: currentChoice(), pixels, now, engine });
    if (out.record !== null) writeAutoRecord(pageStorage(), out.record);
    if (out.choice !== null) saveChoice(out.choice);
    if (out.notice !== null) choiceNotice = out.notice;
  }
  if (fallback.built === null) leaveNotice(pageSessionStorage(), "The last hike ended because the graphics could not be restarted.", Date.now());
}

/** The governor lowered Auto's tier: remembered for this GPU, browser and
 * class, so the next hike starts one step down too (`withGovernorDrop`). */
function onGovernorDrop(running: QualityTier): void {
  if (signals === null) return;
  const pixels = app === null ? 0 : containerPixels(app);
  const record = readAutoRecord(pageStorage());
  const now = Date.now();
  const engine = verdictEngineNow(signals);
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
  const pick = autoPick(signals, { record: readAutoRecord(pageStorage()), pixels, now: Date.now(), engine: verdictEngineNow(signals) });
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
  onRename: (raw) => {
    selfName = saveName(raw);
    lobby?.setName(selfName);
    // The repaint the roster's rename contract requires: it is what removes
    // the edit field, so it must happen on every onRename.
    paintRoster();
  },
});

function paintRoster(): void {
  roster.setView(
    rosterModel({
      lobby: lobby?.state ?? null,
      selfId,
      selfName,
      inviteUrl: (id) => inviteLink(id, webBase),
      inGame: parseRoute(location.pathname).kind === "game",
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
  const offChange = next.onChange(() => {
    paintRoster();
    follow(next);
  });
  const offEnd = next.onEnd((reason) => {
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
 * overrides (`?engine=`, `?tier=`, `?probe=`) are each page's own: they
 * neither make a route differ nor leave the follower's URL when it moves
 * (`navigateTo` carries them). */
function follow(active: Lobby): void {
  if (active.state.role !== "client") return;
  const target = active.state.route;
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
    attachLobby(created);
  } catch (err) {
    if (epoch !== attemptEpoch) return;
    signaling.close();
    endAttempt();
    lobbyError = lobbyErrorMessage(err instanceof Error ? err.message : String(err));
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
    attachLobby(joined);
  } catch (err) {
    if (epoch !== attemptEpoch) return;
    signaling.close();
    endAttempt();
    lobbyError = lobbyErrorMessage(err instanceof Error ? err.message : String(err));
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
  if (lobby !== null && lobby.state.role === "client") {
    lobby.leave();
    detach();
  }
  navigateToLanding();
}

/** A follower whose connection to the host failed plays on alone: leave the
 * party and start a fresh world, as if the invite had never been opened. */
function continueOffline(): void {
  if (lobby !== null && lobby.state.role === "client") {
    lobby.leave();
    detach();
  }
  navigateToGame(createLobbyId());
}

// Say goodbye on the way out so departures are immediate rather than waiting
// on the server's grace window. `pagehide` fires on close, reload, and
// navigation away — every case a socket close would otherwise have to imply.
window.addEventListener("pagehide", () => lobby?.leave());

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
  repaintLanding();
  afterNextPaint(() => {
    launching = false;
    navigateToGame(createLobbyId());
  });
}

// ---- the engine ----------------------------------------------------------------
// WebGL2 unless `engineChoice.ts`'s rule says WebGPU and the adapter agrees.
// Every way WebGPU can fail ends on WebGL2, and none by a reload, which would
// end a party: before the game starts, in the same start; once it runs, by a
// live rebuild of the renderer (`app.ts`), remembered (`dayhike.engine`), or
// by `?engine=webgl2` in the URL where storage refuses the record.

type GpuModule = typeof import("./game/gpuEngine.js");
/** A WebGPU engine made for a canvas, and its module's watchers. */
type MadeEngine = { engine: AbstractEngine; watchers: EngineWatchers };

function engineEnv(): EngineEnv {
  return { browser: browserMajor(navigator.userAgent), babylon: AbstractEngine.Version };
}

/**
 * The engine the WebGPU rule gives the probed tiers (high, medium) now, which
 * Auto's verdicts are kept for (`AutoVerdict.engine`): a verdict measured on
 * one engine does not decide a hike on the other. An adapter not known yet
 * counts as WebGPU, which the start then tries.
 */
function verdictEngineNow(read: GpuSignals): VerdictEngine {
  return chooseEngine({ ...engineInput("high"), fits: signalsFit(read) }) === "webgl2" ? "webgl2" : "webgpu";
}

/** The rule's input for `tier` now: the address's override, the remembered
 * fallback, the switch; the adapter not yet asked (`resolveWebGpu` asks). */
function engineInput(tier: QualityTier): EngineInput {
  return {
    tier,
    override: parseEngineOverride(location.search),
    remembered: fallbackHolds(readFallback(pageStorage()), engineEnv(), Date.now()),
    on: WEBGPU_ENABLED,
    fits: null,
  };
}

/**
 * The engine the WebGPU rule gives `tier` now, on a fresh canvas: WebGL2
 * unless the rule, with the adapter from the GPU's signals (`read`), gives
 * WebGPU and it starts. A start that failed may have taken its canvas's
 * context for WebGPU, and a canvas holds one kind of context for life, so
 * WebGL2 then gets another fresh canvas. `current` says whether the page
 * still wants the engine.
 */
function engineFor(tier: QualityTier, read: GpuSignals, current: () => boolean): Promise<EngineOnCanvas> {
  const canvas = document.createElement("canvas");
  const input = engineInput(tier);
  const webgl2 = { engine: null, watchers: null };
  const tried = chooseEngine(input) !== "webgl2";
  return engineForTier(input, () => makeWebGpu(canvas, input, read, current)).then((made) =>
    made !== null ? { canvas, ...made } : { canvas: tried ? document.createElement("canvas") : canvas, ...webgl2 },
  );
}

/**
 * A failure of a running WebGPU engine, or a renderer that could not be built
 * on one (`"pipeline"`): remembered, and `engine=webgl2` pinned in this tab's
 * URL where the rule would otherwise give WebGPU again
 * (`recordEngineFailure`), so the rebuild's `engineFor` gives the engine the
 * failure asks for. The HUD's line for that engine.
 */
function engineFailed(reason: "pipeline" | "lost"): string {
  return recordEngineFailure(reason, {
    storage: pageStorage(),
    env: engineEnv(),
    now: Date.now(),
    override: parseEngineOverride(location.search),
    pin: () => history.replaceState(history.state, "", withEngine(location.href, "webgl2")),
  });
}

/**
 * Remembers a failure of a WebGPU start (`init`), and what it left. Where
 * storage refuses the record and `pin` is set, this tab's URL is pinned to
 * `engine=webgl2` instead, so the rule gives WebGL2 in this tab from then on.
 */
function rememberFailure(reason: "init" | "pipeline" | "lost", pin = true): { stored: boolean; holds: boolean } {
  const local = pageStorage();
  const env = engineEnv();
  const now = Date.now();
  const record = recordFailure(readFallback(local), reason, env, now);
  const stored = writeFallback(local, record);
  if (!stored && pin) history.replaceState(history.state, "", withEngine(location.href, "webgl2"));
  return { stored, holds: fallbackHolds(record, env, now) };
}

/**
 * The WebGPU engine for `canvas`, or null for WebGL2, by `resolveWebGpu`: the
 * module, the adapter (the GPU's signals', `read`; where they timed out, the
 * same request's later answer within the GPU's budget), and only where it fits
 * the translators and the engine, within the fetch's budget and the GPU's,
 * every failure caught. A page without `navigator.gpu` fetches nothing. The
 * URL is pinned only while the page still wants the engine (`current`).
 */
function makeWebGpu(canvas: HTMLCanvasElement, input: EngineInput, read: GpuSignals, current: () => boolean): Promise<MadeEngine | null> {
  let translators: Awaited<ReturnType<GpuModule["loadTranslators"]>> | undefined;
  return resolveWebGpu<MadeEngine>(input, {
    available: () => (navigator as { gpu?: unknown }).gpu !== undefined,
    load: async () => {
      const gpu: GpuModule = await import("./game/gpuEngine.js");
      return {
        probe: () => adapterFromSignals(read, () => signalsRead.adapter),
        fetchTranslators: async () => {
          translators = await gpu.loadTranslators();
        },
        create: async (ms, features) => ({
          engine: await gpu.createWebGpuEngine(canvas, { ms, features, translators }),
          watchers: { failures: gpu.watchWebGpu, pipelines: gpu.watchPipelines },
        }),
      };
    },
    remember: (reason) => void rememberFailure(reason, current()),
    warn: (message, detail) => {
      if (detail === undefined) console.warn(message);
      else console.warn(message, detail);
    },
  });
}

// `app` is passed in rather than closed over: the null check above does not
// narrow inside a hoisted function declaration, which could be called first.
function render(container: HTMLDivElement): void {
  const token = ++renderToken;
  const route = parseRoute(location.pathname);

  // An invite: consume it (so back/forward never re-join), show the landing
  // page, and join in the background. The roster reports how that went.
  if (route.kind === "party") {
    replaceWithLanding();
    void enterLobby(route.lobbyId);
  }

  // Landing and its panels are one page, so moving between them swaps a class
  // rather than rebuilding: a rebuild would replace the nodes the transition is
  // running on, and it would also tear down and re-create the backdrop scene.
  if (isLandingRoute(route) && landing !== null) {
    landing.setPanel(panelFor(route));
    announcer.now();
    paintRoster();
    return;
  }

  running?.dispose();
  running = null;
  game = null;
  paused = false;
  landing = null;
  container.replaceChildren();

  if (isLandingRoute(route)) {
    // The canvas is appended first so the UI overlay paints above it, but the
    // scene is built last, once renderLanding has put its stylesheet in the
    // DOM: the backdrop starts hidden through a class, and the engine must not
    // render a frame before that rule can apply.
    const backdrop = document.createElement("canvas");
    backdrop.className = "landing-bg";
    container.appendChild(backdrop);
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
        onSettings: () => navigateToPanel("settings"),
        onChooseTier: (choice) => {
          saveChoice(choice);
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

    // Null when WebGL is unavailable; the landing page works flat in that case.
    const scenery = createLandingScene(backdrop);
    running = {
      dispose: () => {
        scenery?.dispose();
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
  // whose GPU the browser will not name); then the engine the WebGPU rule
  // gives that tier, on the game's canvas, made only now that the probe is
  // done ("Loading…" again meanwhile); then the launch. `running` covers the
  // wait, so a render that moves on stops the probe, and disposes its
  // renderer, before building its own. A throw anywhere in the chain leaves a
  // line rather than a blank page.
  const cancelled = (): boolean => token !== renderToken;
  // Each probe step draws on the engine the WebGPU rule gives its tier, on
  // its own canvas, and a WebGPU step that fails is the rule's start failure
  // (`measureOnRuleEngine`); the game's failure handling never hears of it.
  const probe = probeDeps(container, {
    engineFor: async (tier) => {
      const { canvas, engine, watchers } = await engineFor(tier, await signalsReady, () => !cancelled());
      return { canvas, engine, watch: watchers?.failures ?? null };
    },
    failed: () => void rememberFailure("init", !cancelled()),
  });
  running = { dispose: () => probe.abort() };
  /** The GPU's signals this start read, for the engines made later. */
  let hikeSignals: GpuSignals | null = null;
  void startHike<EngineOnCanvas>({
    signals: signalsReady,
    current: () => !cancelled(),
    showLoading: () => {
      const line = createHud(container);
      line.setStatus(LOADING_LINE);
      return line;
    },
    decide: (read, hideLoading) =>
      startupTier(read, { search: location.search, choice: currentChoice(), cancelled, engine: verdictEngineNow(read) }, {
        ...probe,
        showScreen: () => {
          hideLoading();
          return probe.showScreen();
        },
      }),
    engine: (decided, read) => {
      hikeSignals = read;
      return engineFor(decided.tier, read, () => !cancelled());
    },
    discard: (onCanvas) => onCanvas.engine?.dispose(),
    build: (decided, onCanvas) => {
      container.appendChild(onCanvas.canvas);
      const read = hikeSignals;
      if (read === null) throw new Error("the GPU's signals were not read");
      launch(container, onCanvas, route.token, decided, (tier) => engineFor(tier, read, () => !cancelled()));
    },
    fail: (error) => {
      console.error("The game could not start.", error);
      // Whichever canvas the start left: a renderer that fell back builds on
      // a fresh one in the first one's place.
      for (const left of container.querySelectorAll("canvas")) left.remove();
      const line = createHud(container);
      line.setStatus(START_FAILED_LINE);
      running = { dispose: () => line.dispose() };
    },
  });
}

/**
 * Starts the game on `onCanvas` at the tier decided, on the engine made for
 * it: WebGL2 when there is none, as always; otherwise WebGPU, which the game
 * listens to and answers live (`app.ts`). A start that throws on a WebGPU
 * engine, once the game has undone all it made, is started again at the same
 * tier on WebGL2 on a fresh canvas that takes the place of every canvas in
 * the container, and the throw is held against the engine once that stands
 * (`startOnEngine`); a throw on WebGL2 goes up to the start's one catch
 * (`startHike`). `engineForGame` makes the engine for a switch of tier or a
 * rebuild later.
 */
function launch(
  container: HTMLElement,
  onCanvas: EngineOnCanvas,
  worldToken: string,
  decided: StartupTier,
  engineForGame: (tier: QualityTier) => Promise<EngineOnCanvas>,
): void {
  const handle = startOnEngine<GameHandle>(onCanvas, {
    start: ({ canvas, engine, watchers }, startFailed) => {
      // While the game is being started, a WebGPU fault its ladder finds is
      // the start's (recorded once, `startOnEngine`); after, the hike's.
      let starting = true;
      try {
        return startGame(canvas, worldToken, {
          lobby,
          peerId: selfId,
          onExit: exitGame,
          onContinueOffline: continueOffline,
          onPauseChange: (next) => {
            paused = next;
            paintRoster();
          },
          engine: engine ?? undefined,
          watchers: watchers ?? undefined,
          engineFor: engineForGame,
          engineFailed: (reason) => (starting && reason === "pipeline" ? startFailed(reason) : engineFailed(reason)),
          tier: decided.tier,
          tierSource: decided.source,
          fallbackTiers: signals === null ? ["low"] : startFallbacks(decided.tier, decided.cls, signals.cores, signals.memoryGb),
          onTierFallback,
          onGovernorDrop,
          quality: {
            choice: currentChoice,
            stored: choiceStored,
            auto: autoSummary,
            override: parseTierOverride(location.search),
            notice: () => choiceNotice,
            save: saveChoice,
          },
        });
      } finally {
        starting = false;
      }
    },
    engineFailed,
    // A canvas holds one kind of context for life.
    freshCanvas: () => document.createElement("canvas"),
    place: (fresh) => {
      for (const left of container.querySelectorAll("canvas")) left.remove();
      container.appendChild(fresh);
    },
    log: (message, error) => console.error(message, error),
  });
  game = handle;
  console.info(launchLine(decided, handle.graphics()));
  running = handle;
  announcer.afterPaint();
  paintRoster();
}

window.addEventListener("popstate", () => render(app));
render(app);
