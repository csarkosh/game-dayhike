/**
 * A game as the page that runs a session of it is handed it: one definition
 * (`SessionGame`), the game's own half of a session on a screen
 * (`SessionSide`), which the page calls at a session's own points, and what
 * that half reads of the page (`SessionHost`). The page is written over
 * these and names no game; a game's own world, state, player, renderer,
 * sound's bus and HUD are the definition's type parameters.
 */
import type { AmbientAudio } from "@csarkosh/engine/game/ambientAudio";
import type { FreecamState } from "@csarkosh/engine/game/freecam";
import type { InputSampler } from "@csarkosh/engine/game/input";
import type { RenderPlayer, RenderState } from "@csarkosh/engine/game/lite/renderGame";
import type { ModeList } from "@csarkosh/engine/game/modeList";
import type { PlayGate } from "@csarkosh/engine/game/pauseMenu";
import type { QualityTier } from "@csarkosh/engine/game/quality";
import type { RendererOptions, WorldRenderer } from "@csarkosh/engine/game/rendererTypes";
import type { TouchModel } from "@csarkosh/engine/game/touchControls";
import type { WeatherParams, WeatherPresetName } from "@csarkosh/engine/game/weather";
import type { WildlifeAudio } from "@csarkosh/engine/game/wildlifeAudio";
import type { Presence } from "@csarkosh/engine/game/wildlifeBehaviour";
import type { ClientSession } from "@csarkosh/engine/net/client";
import type { HostSession } from "@csarkosh/engine/net/host";
import type { Telemetry } from "@csarkosh/engine/net/telemetry";
import type { Transport } from "@csarkosh/engine/net/transport";
import type { ActionBits, InputCommand } from "@csarkosh/engine/sim/core";
import type { Forest } from "@csarkosh/engine/sim/forest";
import type { Level } from "@csarkosh/engine/sim/level";

/** The console's hour and weather: what shows where a game's own sky departs from nothing, and what it departs from where it does. */
export type AtmosphereBase = { weather: WeatherParams; hour: number };

/** What the page asks of a game's HUD; the rest of it is the game's own. */
export type PageHud = {
  setStatus(line: string | null): void;
  flash(line: string, ms: number): void;
  setLamp(lamp: { key: string; on: boolean } | null): void;
  setPause(pause: { key: string } | null): void;
  dispose(): void;
};

/** What the page asks of a game's renderer beyond the engine's own: the unsettling's level, which the console holds and a swap of renderers puts back. */
export type PageRenderer<S> = WorldRenderer<S> & { setUnsettle(level: number): void };

/** A session's world as the page holds it: its state, which is all the page reads of it. */
export type PageWorld<S> = { readonly state: S };

/**
 * What a game's half of a session reads of the page that runs it, and the
 * few of the page's variables it writes: the page's own, handed over as they
 * stand each time they are read, so a renderer swapped for another is the
 * one the game sees.
 */
export type SessionHost<W, R, A, H> = {
  readonly made: (undo: () => void) => void;
  readonly canvas: HTMLCanvasElement;
  readonly seed: number;
  /** `?cmd=debug` is in the address. */
  readonly debugOn: boolean;
  /** The mode this world is played in, one of the game's list. */
  readonly mode: string;
  readonly telemetry: Telemetry | null;
  readonly renderer: R;
  readonly tier: QualityTier;
  readonly ambient: A;
  readonly wildlifeAudio: WildlifeAudio | null;
  weatherName: WeatherPresetName;
  readonly base: AtmosphereBase;
  wildlifePresence: Presence;
  readonly touchStart: boolean;
  readonly touchModel: TouchModel;
  readonly input: InputSampler;
  readonly container: HTMLElement;
  readonly hud: H;
  readonly freecam: FreecamState | null;
  appliedHour: number;
  appliedWeather: WeatherParams;
  readonly activeWorld: W | null;
  extrasToCome: { cancel(): void } | null;
  readonly gate: PlayGate;
  readonly progressRounded: () => number;
  landingTimer: ReturnType<typeof setTimeout> | null;
  readonly sessionOver: () => void;
};

/** A game's own half of a session on a screen, called by the page at the session's own points. */
export type SessionSide<W, S, P, R, HostS, ClientS> = {
  // A session's start and end.
  /** The game as a session starts it, the host's and a follower's alike. */
  atRest(): void;
  /** The host's session is made: the game's hands on the host's own player. */
  hostStarted(host: HostS): void;
  /** A session's world is in. */
  worldIn(world: W): void;
  /** A session's own events, heard. */
  hears(session: HostS | ClientS): void;
  /** A match starts, where there is telemetry to report it to. */
  matchStarted(world: W): void;
  dispose(): void;
  // A frame, in the order the page calls them.
  /** Before the host's frame's ticks. */
  beforeTicks(): void;
  /** A command as the game lets it through to a tick. */
  command(sample: InputCommand, me: P | undefined, world: W): InputCommand;
  /** What the renderer's sync reads of the game, stepped before it. */
  beforeSync(world: W, state: S, localId: number, dt: number): void;
  /** The game's own sound of a frame, once the listener is placed and the drips are set. */
  sound(): void;
  /** Whether the local player's lamp is on, for the page's lamp button. */
  lampOn(self: P | undefined): boolean;
  /** The game's reading of a frame after the sync and the world's sound. */
  afterSync(world: W, state: S, localId: number, self: P | undefined, cmd: InputCommand | null): void;
  /** The game's report of a frame, its last step before the draw. */
  report(state: S, self: P | undefined, sprinting: boolean): void;
  // What the page asks of the game's state.
  /** The match is decided on this screen. */
  decided(): boolean;
  /** Play is over for this player. */
  over(): boolean;
  /** A scene of the game's has the frame, and a renderer must not be swapped under it. */
  holdsFrame(): boolean;
  /** How far the party has come, 0 to 1. */
  progress(): number;
  /** What a match's last row says of how it ended on this screen. */
  matchEnd(): Record<string, boolean | number | string>;
  /** How many entities a state holds, for the netgraph's row. */
  entities(state: S): number;
  /** A view command of the game's own, applied; false where it is not one of the game's. */
  applyOwnView(name: string, args: readonly string[]): boolean;
  // What the game builds for a renderer and lets go with it.
  buildExtras(renderer: R): void;
  disposeExtras(): void;
  /** Whether any is built. */
  extrasStand(): boolean;
};

/** A game, as the page that runs a session of it is handed it. */
export type SessionGame<
  W extends PageWorld<S>,
  S extends RenderState<P>,
  P extends RenderPlayer,
  R extends PageRenderer<S>,
  A extends AmbientAudio,
  H extends PageHud,
  HostS extends HostSession<W, unknown>,
  ClientS extends ClientSession<W, P, S, unknown>,
> = {
  /** The level the renderer and both sessions are shaped by, as its JSON. */
  level: unknown;
  /** The modes the game is played in, as the settings and the address hold them. */
  modes: ModeList;
  /** The game's bits for an interaction and the lamp's switch. */
  actions: ActionBits;
  /** Where a world's players start, from the seed alone; null where the game says nowhere. */
  startOf(seed: number): { x: number; z: number; yaw: number } | null;
  /** Whether the weather is the mode's own to turn: a preset asked for at the console is then answered, not set. */
  weatherIsOwn(mode: string): boolean;
  /** The game's renderer on a canvas. */
  renderer(canvas: HTMLCanvasElement, level: Level, forest: Forest | null, options: RendererOptions): R;
  /** The sound's bus with the game's voices on it. */
  audio(): A;
  /** The game's HUD in the page's container. */
  hud(container: HTMLElement, hooks: { onPause(): void }): H;
  /** The game's own half of a session. */
  side(host: SessionHost<W, R, A, H>): SessionSide<W, S, P, R, HostS, ClientS>;
  /** A host's session on the world of a mode. */
  host(level: Level, seed: number, clock: () => number, o: { forest: Forest; hostPeerId: string; mode: string }): HostS;
  /** A follower's session on the world of a mode. */
  join(level: Level, seed: number, transport: Transport, clock: () => number, o: { expectedLevelId: string; forest: Forest; mode: string }): ClientS;
};
