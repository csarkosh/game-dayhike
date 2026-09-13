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
  type Route,
} from "./game/router.js";
import { renderLanding, type LandingHandle, type LandingPanel } from "./game/landing.js";
import { createLandingScene } from "./game/landingScene.js";
import { landingModel, type LandingInput } from "./game/landingModel.js";
import { isDesktop, hostPlatform, desktopVersion } from "./game/platform.js";
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

const app = document.querySelector<HTMLDivElement>("#app");
if (!app) throw new Error("#app not found");

let running: GameHandle | null = null;
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
let selfName = loadName();
let lobby: Lobby | null = null;
let lobbyError: string | undefined;
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

/** A follower goes where the host is. The host's route is "" until known. */
function follow(active: Lobby): void {
  if (active.state.role !== "client") return;
  const target = active.state.route;
  if (target === "" || target === currentRoutePath()) return;
  navigateTo(target);
}

/** Host side: tell the lobby where we are now. Called from render(). */
function announceRoute(): void {
  if (lobby !== null && lobby.state.role === "host") lobby.setRoute(currentRoutePath());
}

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
      route: currentRoutePath(),
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
    route.kind === "party"
  );
}

function onPlay(): void {
  // Solo or host: a fresh token, a fresh world. Followers never see Play.
  navigateToGame(createLobbyId());
}

// `app` is passed in rather than closed over: the null check above does not
// narrow inside a hoisted function declaration, which could be called first.
function render(container: HTMLDivElement): void {
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
    announceRoute();
    paintRoster();
    return;
  }

  running?.dispose();
  running = null;
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
    announceRoute();
    paintRoster();
    return;
  }

  const canvas = document.createElement("canvas");
  container.appendChild(canvas);
  running = startGame(canvas, route.token, {
    lobby,
    onExit: exitGame,
    onPauseChange: (next) => {
      paused = next;
      paintRoster();
    },
  });
  announceRoute();
  paintRoster();
}

window.addEventListener("popstate", () => render(app));
render(app);
