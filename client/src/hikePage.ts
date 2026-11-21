import { type Route } from "@csarkosh/engine/game/router";
import { type LandingHandle, type LandingPanel } from "./game/landing.js";
import { createIntroOverlay, type CutReason, type IntroOverlay } from "./game/introOverlay.js";
import { pageTurns, turnsLine } from "@csarkosh/engine/game/downloadTurns";
import { INTRO_CAPTIONS } from "./game/scene/intro.js";
import { setLoadProgress } from "@csarkosh/engine/game/loadReport";
import { titleStillUrl, videoUrl } from "./game/dayhikeAssets.js";
import { titleLoopEnv, type TitleLoop } from "./game/titleLoop.js";
import { createFilmHead, fetchFilmHead, filmHeadWanted, onCellular, warmWhenLoaded } from "./game/filmHead.js";
import { landingModel, type LandingInput } from "./game/landingModel.js";
import { loadName } from "./game/playerName.js";
import { type DesktopRelease } from "@csarkosh/engine/net/desktopRelease";
import { type Lobby } from "@csarkosh/engine/net/lobby";
import { type Telemetry } from "@csarkosh/engine/net/telemetry";
import { type GameHandle } from "@csarkosh/engine/app";
import { hostOs, isMobile, type GpuSignals, type NavigatorLike } from "@csarkosh/engine/game/gpuSignals";
import { type LoadVerdict } from "@csarkosh/engine/game/loadCheck";
import { creditsEntries } from "./game/credits.js";
import { renderTurnedAway, type TurnedAwayHandle } from "./game/turnedAway.js";
import { turnedAwayModel, visitorDevice, type TurnedAwayView } from "./game/turnedAwayModel.js";
import { HIKE_MODES, createModeKeeper, type GameMode } from "./game/gameMode.js";
import type { AutoSummary } from "@csarkosh/engine/game/settings";
import { pageStorage, parseTierOverride, type TierChoice } from "@csarkosh/engine/game/tierChoice";
import { VEIL_CUT_COVER_MS, VEIL_CUT_LIFT_MS } from "@csarkosh/engine/game/veil";
import type { Veil } from "@csarkosh/engine/game/veil";
import type { Roster } from "@csarkosh/engine/game/roster";
import type { Platform } from "@csarkosh/engine/net/desktopRelease";
import type { MuteButton } from "@csarkosh/engine/game/muteButton";

/**
 * The intro over a start (`introOverlay.ts`). Made on Play, in the click,
 * so the video plays with sound; taken by the game route's render, which
 * mounts it over the hike, gates the download on its buffer and feeds it the
 * loading bar; cut by a hold, the step-out click or the video failing, when
 * the hike takes the pointer and the overlay goes.
 */
export type IntroRun = {
  overlay: IntroOverlay;
  /** The animation frame drawing it, until the cut. */
  frame: number;
  /** Set once the hike is launched: what the cut does to it. */
  launched: ((reason: CutReason) => void) | null;
  /** A cut before the launch (the video failed at once), kept for it. */
  cutEarly: CutReason | null;
  /** Takes the film away from the hike's downloads, which then start as they are asked for. */
  untell: () => void;
};

/**
 * What Day Hike's own of the page reads of the page's shell, and the few of its variables it
 * writes: the shell's own, handed over as they stand each time they are read.
 */
export type HikePageHost = {
  readonly app: HTMLDivElement;
  readonly veil: Veil;
  readonly VEIL_SETTLE_MS: number;
  readonly mute: MuteButton;
  running: { dispose(): void } | null;
  game: GameHandle | null;
  paused: boolean;
  readonly desktop: boolean;
  readonly touch: boolean;
  readonly host: Platform | "other";
  readonly appVersion: string | undefined;
  readonly latest: DesktopRelease | null;
  readonly latestReady: Promise<void>;
  readonly telemetry: Telemetry;
  readonly signals: GpuSignals | null;
  readonly currentChoice: () => TierChoice;
  readonly choiceStored: () => boolean;
  readonly choiceNotice: string | null;
  readonly autoSummary: () => AutoSummary | null;
  renderToken: number;
  readonly lobby: Lobby | null;
  readonly launching: boolean;
  readonly roster: Roster;
  readonly shownPage: "landing" | "game" | "scene" | null;
};

/**
 * Day Hike's own of the page: the intro's film, the title's loop, the landing page, the page for
 * those turned away, the player's name and the mode. The page's shell (`main.ts`) makes it once
 * and calls it at its own points.
 */
export function createHikePage(h: HikePageHost) {
  let landing: LandingHandle | null = null;
  /** The title page's loop behind its still, while the title page is up. */
  let titleLoop: TitleLoop | null = null;
  /** The intro film, loading its head from the title page on, for Play to take (`filmHead.ts`). */
  const filmHead = createFilmHead({
    video: () => document.createElement("video"),
    // Chrome preloads a film's metadata only on a cellular connection: there the page fetches the head itself first.
    fetchHead: (src) => (onCellular(navigator as { connection?: { type?: string } }) ? fetchFilmHead(src) : null),
  });
  /** The page for those turned away, once it is up: it stays for the page's life. */
  let turnedAway: TurnedAwayHandle | null = null;
  /** Whether the visitor's `turned_away` row has been sent: one a page. */
  let turnedAwayTold = false;

  /** What the page for those turned away shows now (`turnedAwayModel`). */
  function turnedAwayView(why: Exclude<LoadVerdict, { play: true }>): TurnedAwayView {
    const nav = navigator as NavigatorLike;
    return turnedAwayModel({
      reason: why.reason,
      short: why.short,
      desktop: h.desktop,
      device: visitorDevice(hostOs(nav), isMobile(nav), navigator.userAgent),
      host: h.host,
      userAgent: navigator.userAgent,
      renderer: h.signals?.renderer ?? null,
      latest: h.latest,
    });
  }
  // The mode (gameMode.ts), kept the same way; the hike reads it where its address names none.
  const modeChoice = createModeKeeper(pageStorage);
  const currentMode = (): GameMode => modeChoice.mode();
  const saveMode = (mode: GameMode): void => {
    modeChoice.save(mode);
    h.telemetry.event("settings", { mode });
  };

  /** A line left for the landing by the hike that just ended, taken when the landing is built. */
  let landingNotice: string | null = null;
  let selfName = loadName();
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
    run.untell();
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
    void h.veil.cover(VEIL_CUT_COVER_MS).then(() => {
      cut();
      setTimeout(() => h.veil.lift(VEIL_CUT_LIFT_MS), h.VEIL_SETTLE_MS);
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
    const run: IntroRun = { overlay: null as unknown as IntroOverlay, frame: 0, launched: null, cutEarly: null, untell: () => undefined };
    // The film the title page has been loading, when there is one for this file; else one made here.
    const deps = { video: () => filmHead.take(src) ?? document.createElement("video"), now: () => performance.now() };
    run.overlay = createIntroOverlay(h.app, { src, captions: INTRO_CAPTIONS, muted, sound: () => !h.mute.muted(), onCut: (reason) => cutIntro(run, reason) }, deps);
    // While the film plays, the hike's downloads take turns behind it, so its
    // low-priority request keeps its share of the link (`downloadTurns.ts`);
    // the film is taken away when it ends or fails, and when the intro goes.
    const untell = pageTurns.film(() => run.overlay.film(), (course) => console.info(turnsLine(course)));
    run.untell = untell;
    run.overlay.video.addEventListener("ended", untell, { once: true });
    run.overlay.video.addEventListener("error", untell, { once: true });
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

  // ---- rendering ---------------------------------------------------------------

  function landingInput(over: Partial<LandingInput> = {}): LandingInput {
    return {
      desktop: h.desktop,
      host: h.host,
      appVersion: h.appVersion,
      latest: h.latest,
      follower: h.lobby !== null && h.lobby.state.role === "client",
      touch: h.touch,
      launching: h.launching,
      quality: {
        choice: h.currentChoice(),
        auto: h.autoSummary(),
        override: parseTierOverride(location.search),
        stored: h.choiceStored(),
        notice: h.choiceNotice ?? undefined,
        mode: currentMode(),
        modes: HIKE_MODES,
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
    if (route.kind === "downloads") return h.desktop ? "home" : "downloads";
    if (route.kind === "credits") return "credits";
    if (route.kind === "settings") return "settings";
    return "home";
  }

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
    h.renderToken += 1;
    h.telemetry.mark("turned-away");
    if (turnedAway !== null) return;
    h.running?.dispose();
    h.running = null;
    h.game = null;
    h.paused = false;
    landing = null;
    endIntro(activeIntro);
    endIntro(pendingIntro);
    container.replaceChildren();
    // Nothing here makes a sound or starts a party: the page's mute goes, and its key with it, and the roster, which
    // hidden would still take the keyboard's focus and a screen reader's.
    h.mute.dispose();
    h.roster.dispose();
    if (h.veil.down) h.veil.lift();
    // The navigation's row, where no route's own render sent it first: a visitor turned away as the page loads.
    if (h.shownPage === null) {
      h.telemetry.event("page", { kind: route.kind });
      window.visits?.page?.();
    }
    const handle = renderTurnedAway(container, turnedAwayView(why), {
      still: titleStillUrl(),
      // The credit the still's works are owed, within reach here as from the landing page.
      credits: creditsEntries(),
      onDownload: (platform) => h.telemetry.event("download", { platform }),
    });
    turnedAway = handle;
    // The app's offer waits on the release, which lands after the page is up.
    void h.latestReady.then(() => handle.setView(turnedAwayView(why)));
  }

  return {
    get landing() { return landing; },
    set landing(value) { landing = value; },
    get titleLoop() { return titleLoop; },
    set titleLoop(value) { titleLoop = value; },
    get turnedAway() { return turnedAway; },
    get turnedAwayTold() { return turnedAwayTold; },
    set turnedAwayTold(value) { turnedAwayTold = value; },
    turnedAwayView,
    currentMode,
    saveMode,
    get landingNotice() { return landingNotice; },
    set landingNotice(value) { landingNotice = value; },
    get selfName() { return selfName; },
    set selfName(value) { selfName = value; },
    get pendingIntro() { return pendingIntro; },
    set pendingIntro(value) { pendingIntro = value; },
    get activeIntro() { return activeIntro; },
    set activeIntro(value) { activeIntro = value; },
    introSource,
    INTRO_BUFFER_S,
    INTRO_BUFFER_MAX_MS,
    INTRO_BUILD_BUFFER_S,
    INTRO_BUILD_BUFFER_MAX_MS,
    waitForBuffer,
    endIntro,
    cutIntro,
    warmFilmHead,
    startIntro,
    landingInput,
    repaintLanding,
    panelFor,
    showTurnedAway,
  };
}

/** Day Hike's own of the page, as the shell holds it. */
export type HikePage = ReturnType<typeof createHikePage>;
