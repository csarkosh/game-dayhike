import { type Route } from "@csarkosh/engine/game/router";
import { renderLanding, type LandingHandle, type LandingPanel } from "./game/landing.js";
import { createIntroOverlay, type CutReason, type IntroOverlay } from "./game/introOverlay.js";
import { pageTurns, turnsLine } from "@csarkosh/engine/game/downloadTurns";
import { INTRO_CAPTIONS } from "./game/scene/intro.js";
import { setLoadProgress } from "@csarkosh/engine/game/loadReport";
import { titleStillUrl, titleVideoUrl, videoUrl } from "./game/dayhikeAssets.js";
import { createTitleLoop, titleLoopEnv, type TitleLoop } from "./game/titleLoop.js";
import { createFilmHead, fetchFilmHead, filmHeadWanted, onCellular, warmWhenLoaded } from "./game/filmHead.js";
import { landingModel, type LandingInput } from "./game/landingModel.js";
import { hostOs, isMobile, type NavigatorLike } from "@csarkosh/engine/game/gpuSignals";
import { creditsEntries } from "./game/credits.js";
import { renderTurnedAway, type TurnedAwayHandle } from "./game/turnedAway.js";
import { turnedAwayModel, visitorDevice, type TurnedAwayView } from "./game/turnedAwayModel.js";
import { HIKE_MODES, createModeKeeper, isGameMode, type GameMode } from "./game/gameMode.js";
import { pageStorage, parseTierOverride, pageSessionStorage, takeNotice } from "@csarkosh/engine/game/tierChoice";
import { VEIL_CUT_COVER_MS, VEIL_CUT_LIFT_MS } from "@csarkosh/engine/game/veil";
import type { LandingShell, Opening, PageHost, PageSide, TurnedAway } from "@csarkosh/engine/game/pageGame";

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
 * Day Hike's own of the page: the intro's film, the title's loop, the landing page, the page for
 * those turned away and the mode. The page's shell (`shell.ts`) makes it once
 * and calls it at its own points.
 */
export function createHikePage(h: PageHost): PageSide {
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

  /** What the page for those turned away shows now (`turnedAwayModel`). */
  function turnedAwayView(why: TurnedAway): TurnedAwayView {
    const nav = navigator as NavigatorLike;
    return turnedAwayModel({
      title: "Day Hike",
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
   * The page for a visitor who cannot play (`turnedAway.ts`), put up by the
   * shell once, in a container it has emptied (`shell.ts`, `turnAway`).
   * Day Hike's own goes first: the landing page it held and a film playing
   * or waiting.
   */
  function showTurnedAway(container: HTMLDivElement, why: TurnedAway): void {
    landing = null;
    endIntro(activeIntro);
    endIntro(pendingIntro);
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

  /** Play was pressed: the title's loop gives the bandwidth up, and the intro's film starts, to be carried into the game. */
  function played(): void {
    titleLoop?.stop();
    const src = introSource();
    if (src !== null) {
      endIntro(pendingIntro);
      pendingIntro = startIntro(src, false);
    }
  }

  /** The page's mute changed: the film playing follows it. */
  function muteChanged(): void {
    activeIntro?.overlay.setSound();
  }

  /** Whether a film Play started waits to be carried into the game: the page then changes with no veil, the film being the way in. */
  function carriesToGame(): boolean {
    return pendingIntro !== null;
  }

  /** The landing page is up. */
  function landingUp(): boolean {
    return landing !== null;
  }

  /** The landing page, already up, at the route's panel. */
  function showPanel(route: Route): void {
    landing?.setPanel(panelFor(route));
  }

  /** A page is left for another: the landing page's handle is let go, and the film playing ends. */
  function left(): void {
    landing = null;
    endIntro(activeIntro);
  }

  /** The film Play started stays in the page while a route waits: taken out of it, it would stop. */
  function keepOpening(container: HTMLElement): void {
    pendingIntro?.overlay.mount(container);
  }

  /**
   * The landing page, shown in `container` at the route's panel, with the
   * title's loop behind it. What it asks of the shell is `shell`'s. Returns
   * what lets it go.
   */
  function showLanding(container: HTMLDivElement, route: Route, shell: LandingShell): { dispose(): void } {
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
        onCreate: shell.play,
        onJoin: (text) => {
          if (!shell.join(text)) {
            handle.setView(
              landingModel(landingInput({ joinError: "That is not an invite link or lobby id." })),
            );
          }
        },
        onDownloads: () => shell.toPanel("downloads"),
        onDownload: (platform) => h.telemetry.event("download", { platform }),
        onSettings: () => shell.toPanel("settings"),
        onChooseTier: (choice) => {
          shell.chooseTier(choice);
          repaintLanding();
        },
        onChooseMode: (mode) => {
          // A value that is not one of the hike's modes is ignored.
          if (!isGameMode(mode)) return;
          saveMode(mode);
          repaintLanding();
        },
        onCredits: () => shell.toPanel("credits"),
        onBack: shell.back,
      },
      panelFor(route),
    );
    landing = handle;
    // Repaint with the release info once it lands — unless the player has
    // already left the landing page, in which case this handle is dead.
    void h.latestReady.then(() => {
      if (landing === handle) handle.setView(landingModel(landingInput()));
    });

    return {
      dispose: () => {
        titleLoop?.dispose();
        titleLoop = null;
        handle.dispose();
      },
    };
  }

  /**
   * A session's opening on a game's route: the film Play started, or, for a
   * follower the host's Play brought here with no click of its own, a film
   * started now with its sound off (a browser plays it no other way without
   * a gesture; the sound button turns it on). Mounted in `container`. Null
   * where there is no film.
   */
  function openingFor(container: HTMLElement, follower: boolean): Opening | null {
    let intro = pendingIntro;
    pendingIntro = null;
    if (intro === null && follower) {
      const src = introSource();
      if (src !== null) intro = startIntro(src, true);
    }
    activeIntro = intro;
    if (intro === null) return null;
    intro.overlay.mount(container);
    const run = intro;
    return {
      progress: run.overlay.progress,
      beforeEngine: () => waitForBuffer(run.overlay, INTRO_BUFFER_S, INTRO_BUFFER_MAX_MS),
      beforeBuild: () => waitForBuffer(run.overlay, INTRO_BUILD_BUFFER_S, INTRO_BUILD_BUFFER_MAX_MS),
      failed: () => endIntro(run),
      connectPanel: () => {
        if (activeIntro === run) cutIntro(run, "error");
      },
      launched: (handle) => {
        // Under the intro the hike is covered until the cut, which takes the
        // pointer on the gesture it was made with and lifts the cover once it has
        // it, so no pause menu shows between; a video that failed lets the hike
        // start as one with no intro does. Ready lets the intro be skipped.
        const release = handle.cover();
        // A start that fails while the world is made is the start's failure
        // (`failed` ends the intro); nothing is left for ready to say.
        handle.ready.then(
          () => run.overlay.ready(),
          () => undefined,
        );
        run.launched = (reason) => {
          // Watched to its end, cut early, or failed: which, for the timeline.
          h.telemetry.event("intro", { reason });
          if (reason === "error") release();
          else void handle.engage().then(release);
        };
        if (run.cutEarly !== null) run.launched(run.cutEarly);
      },
    };
  }

  /** A verdict of "cannot play" come while the page for those turned away is up: it is shown what the verdict adds. */
  function turnedAwayNow(next: TurnedAway): void {
    turnedAway?.setView(turnedAwayView(next));
  }

  return {
    // The landing page and what plays behind it.
    showLanding,
    landingUp,
    showPanel,
    repaint: repaintLanding,
    left,
    // What plays before a session starts.
    played,
    carriesToGame,
    keepOpening,
    openingFor,
    muteChanged,
    // The page for those turned away.
    showTurnedAway,
    turnedAwayNow,
    // The player's name and the mode.
    mode: currentMode,
    saveMode: (mode: string): void => {
      if (isGameMode(mode)) saveMode(mode);
    },
  };
}

/** Day Hike's own of the page, as the shell holds it. */
export type HikePage = ReturnType<typeof createHikePage>;
