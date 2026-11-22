/**
 * A game as the page's shell is handed it: one definition (`PageGame`), the
 * game's own of the page (`PageSide`: its landing page, what plays before a
 * session starts and the mode), which the
 * shell calls at the page's own points, and what that side
 * reads of the shell (`PageHost`). The shell is written over these and names
 * no game; the game a session is of (`SessionGame`) is carried through with
 * its own type parameters.
 */
import type { AmbientAudio } from "./ambientAudio.js";
import type { CreditEntry } from "./credits.js";
import type { RenderPlayer, RenderState } from "./lite/renderGame.js";
import type { LoadVerdict } from "./loadCheck.js";
import type { LoadProgress } from "./loadProgress.js";
import type { MuteButton } from "./muteButton.js";
import type { QualityTier } from "./quality.js";
import type { Route } from "./router.js";
import type { PageHud, PageRenderer, PageWorld, SessionGame } from "./sessionGame.js";
import type { AutoSummary } from "./settings.js";
import type { TierChoice } from "./tierChoice.js";
import type { Veil } from "./veil.js";
import type { GameIdentity } from "../identity.js";
import type { ClientSession } from "../net/client.js";
import type { DesktopRelease, Platform } from "../net/desktopRelease.js";
import type { HostSession } from "../net/host.js";
import type { Lobby } from "../net/lobby.js";
import type { Telemetry } from "../net/telemetry.js";
import type { Forest } from "../sim/forest.js";
import type { Level } from "../sim/level.js";

/** A verdict of "cannot play", with its reason. */
export type TurnedAway = Exclude<LoadVerdict, { play: true }>;

/** What a game's landing page asks of the page's shell. */
export type LandingShell = {
  /** Play was pressed. */
  play(): void;
  /** An invite link or lobby id was entered; false where the text is neither. */
  join(text: string): boolean;
  toPanel(panel: "downloads" | "settings" | "credits"): void;
  /** A graphics choice was picked: kept. */
  chooseTier(choice: TierChoice): void;
  back(): void;
};

/**
 * A session's opening, as the shell holds it while it starts the session
 * under it: what a game plays over the start (a film, say).
 */
export type Opening = {
  /** The bar the loads report to. */
  readonly progress: LoadProgress;
  /** Before the engine is made: what the opening waits for first. */
  beforeEngine(): Promise<void>;
  /** Before the build, which stops the page while it runs. */
  beforeBuild(): Promise<void>;
  /** The start failed: the opening ends. */
  failed(): void;
  /** The connect panel is up: the opening gives way to it. */
  connectPanel(): void;
  /** The session is launched under the opening, and covered until the opening lets it go. */
  launched(handle: { ready: Promise<void>; cover(): () => void; engage(): Promise<boolean> }): void;
};

/**
 * What a game's own of the page reads of the page's shell: the shell's own,
 * handed over as they stand each time they are read, and none of them the
 * game's to write.
 */
export type PageHost = {
  readonly app: HTMLDivElement;
  readonly veil: Veil;
  readonly VEIL_SETTLE_MS: number;
  readonly mute: MuteButton;
  readonly desktop: boolean;
  readonly touch: boolean;
  readonly host: Platform | "other";
  readonly appVersion: string | undefined;
  readonly latest: DesktopRelease | null;
  readonly latestReady: Promise<void>;
  readonly telemetry: Telemetry;
  readonly currentChoice: () => TierChoice;
  readonly choiceStored: () => boolean;
  readonly choiceNotice: string | null;
  readonly autoSummary: () => AutoSummary | null;
  readonly lobby: Lobby | null;
  readonly launching: boolean;
};

/** A game's own of the page, called by the shell at the page's own points. */
export type PageSide = {
  // The landing page and what plays behind it.
  /** The landing page, shown in `container` at the route's panel; returns what lets it go. */
  showLanding(container: HTMLDivElement, route: Route, shell: LandingShell): { dispose(): void };
  /** The landing page is up. */
  landingUp(): boolean;
  /** The landing page, already up, at the route's panel. */
  showPanel(route: Route): void;
  /** The landing page shows what the shell holds now. */
  repaint(): void;
  /** A page is left for another. */
  left(): void;
  // What plays before a session starts.
  /** Play was pressed. */
  played(): void;
  /** Whether what Play started carries the landing page into the game, so the page changes with no veil. */
  carriesToGame(): boolean;
  /** What Play started stays in the page while a route waits. */
  keepOpening(container: HTMLElement): void;
  /** A session's opening on a game's route, mounted in `container`; null where the game plays none. */
  openingFor(container: HTMLElement, follower: boolean): Opening | null;
  /** The page's mute changed. */
  muteChanged(): void;
  // A visitor turned away.
  /**
   * A visitor cannot play, and the shell is about to show the page for those turned away (`turnedAway.ts`) in place of
   * every route: the game lets go of what is its own on the page or starting. The shell has already let go of the
   * session, the mute and the roster, and emptied the page.
   */
  turnedAway(): void;
  // The mode.
  /** The mode saved, one of the game's list. */
  mode(): string;
  /** Keeps a mode; one that is not of the game's list is ignored. */
  saveMode(mode: string): void;
};

/** A game, as the page's shell is handed it. */
export type PageGame<
  W extends PageWorld<S>,
  S extends RenderState<P>,
  P extends RenderPlayer,
  R extends PageRenderer<S>,
  A extends AmbientAudio,
  H extends PageHud,
  HostS extends HostSession<W, unknown>,
  ClientS extends ClientSession<W, P, S, unknown>,
> = {
  /** The game a session is of, as the page that runs one is handed it (`app.ts`). */
  game: SessionGame<W, S, P, R, A, H, HostS, ClientS>;
  /** The game's own of the page, made once. */
  side(host: PageHost): PageSide;
  /** Which game this is: its name, its words and the prefix of what it keeps in the browser (`identity.ts`). */
  identity: GameIdentity;
  /** What the page for those turned away shows of the game's: the still it is laid over, or null, and the works credited at its foot (none, and no credits are offered). */
  away: { still(): string | null; credits(): readonly CreditEntry[] };
  /** The version of the game's wire, which every telemetry row names: two pages play together only at the same one. */
  protocol: number;
  /** A line of status in `container`, for a start's waits and its failure. */
  statusLine(container: HTMLElement): { setStatus(line: string | null): void; dispose(): void };
  /** Starts the worker that makes a session's world off the page's thread (`worldPrep.ts`). */
  worldWorker(): Worker;
  /** A staged scene of the game's on its own route, drawn on `canvas` at `tier`. */
  scene(
    at: { canvas: HTMLCanvasElement; container: HTMLElement; tier: QualityTier },
    search: { t: number | null; step: number | null },
    name: Extract<Route, { kind: "scene" }>["name"],
  ): { dispose(): void };
  /**
   * The state of a world on the game's level with no player in it and nothing stepping it: what the tier check
   * draws as it measures each step on the game's own renderer (`lite/probeScene.ts`).
   */
  probeState(level: Level, seed: number, forest: Forest): S;
};
