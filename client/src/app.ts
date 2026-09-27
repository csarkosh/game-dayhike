import { parseLevel } from "./sim/level.js";
import { createForest } from "./sim/forest.js";
import { createRenderer, terrainMaterialFor, type FreecamView, type Renderer } from "./game/renderer.js";
import type { AbstractEngine } from "@babylonjs/core/Engines/abstractEngine.js";
import { FALLBACK_NOTICE_MS, takeNotice } from "./game/engineChoice.js";
import { createInputSampler } from "./game/input.js";
import { createTouchModel, createTouchLayer } from "./game/touchControls.js";
import { FixedStepAccumulator } from "./game/loop.js";
import { createHud } from "./game/hud.js";
import { createNetgraph, RateCounter } from "./game/netgraph.js";
import { navigateToLanding } from "./game/router.js";
import { createCommandBar } from "./game/commandBar.js";
import { createPauseMenu, createPlayGate } from "./game/pauseMenu.js";
import {
  findCommand,
  parseCommandLine,
  registerTerrainVariants,
  resolveTypedArgs,
  validateCommand,
} from "./game/commands.js";
import {
  lastEntry,
  parseScript,
  serialiseScript,
  setEntry,
  splitEntries,
  type ScriptEntry,
} from "./game/script.js";
import { stepFreecam, type FreecamState } from "./game/freecam.js";
import { DEFAULT_HOUR } from "./game/lighting.js";
import { seedFromToken } from "./game/seed.js";
import { createAmbientAudio } from "./game/ambientAudio.js";
import { createWildlifeAudio, listenerToAudio } from "./game/wildlifeAudio.js";
import { wildlifePresenceUnder } from "./game/wildlifeBehaviour.js";
import { DEFAULT_BOB_SCALE } from "./game/viewBob.js";
import { DEFAULT_WEATHER, WEATHER_PRESETS, type WeatherParams, type WeatherPresetName } from "./game/weather.js";
import {
  ESCALATION_REST,
  atmosphereUnder,
  escalationTargets,
  stepEscalation,
  type AtmosphereBase,
  type EscalationState,
} from "./game/escalation.js";
import {
  DEFAULT_TERRAIN_VARIANT,
  activeTerrainVariant,
  elevationAt,
  setActiveTerrainVariant,
  terrainVariantNames,
} from "./sim/terrain.js";
import { connectAsClient } from "./net/peer.js";
import { createHostSession } from "./net/hostSession.js";
import { createHostAdmission, type HostAdmission } from "./net/hostAdmission.js";
import { createClientSession } from "./net/clientSession.js";
import { degradeTransport, parseNetConditions } from "./net/channels.js";
import type { Transport } from "./net/transport.js";
import { isTouchDevice } from "./game/platform.js";
import { createInteractPrompt, promptModel } from "./game/interactPrompt.js";
import { createPosterPanel, posterModel } from "./game/posterPanel.js";
import { createEndPanel, endPanelModel } from "./game/endPanel.js";
import { createBodyMesh } from "./game/bodyMesh.js";
import { DEATH_LINE, END_LANDING_MS, roadLine } from "./game/passages.js";
import { InteractKind } from "./sim/register.js";
import { signPosts } from "./sim/signs.js";
import { createSignMeshes, type SignMeshes } from "./game/signMeshes.js";
import { CAR_MATERIAL, KIOSK_MATERIAL, kioskFacing, propSite, roadProp } from "./sim/passes/trailhead.js";
import { createTrailheadMeshes } from "./game/trailheadMeshes.js";
import { signSites } from "./sim/placeNames.js";
import { afterNextPaint } from "./game/paint.js";
import type { QualityTier } from "./game/quality.js";
import { settingsModel, type AutoSummary } from "./game/settings.js";
import { pageSessionStorage, resolveTier, type TierChoice, type TierSource } from "./game/tierChoice.js";
import {
  buildFirstRenderer,
  buildOrUndo,
  swapRenderer,
  switchOutcome,
  whenSceneReady,
  type SwapBindings,
} from "./game/rendererSwap.js";
import { releaseAtmosphere } from "./game/atmosphere.js";
import { GOVERNOR_IDLE_MAX_MS, actOnDrop, createGovernor, governorDecision, steadyFrame } from "./game/governor.js";
import { OVER_PLAY_Z, showProbeScreen, timeIdleCadence } from "./game/probeScreen.js";
import { connectFailure, createConnectPanel, sessionEndOutcome } from "./game/connectPanel.js";
import { pressedEdges, resolveInteract } from "./sim/interact.js";
import { Button, Outcome, type InputCommand, type PlayerState, type WorldState } from "./sim/types.js";
import type { World } from "./sim/world.js";
import type { Lobby } from "./net/lobby.js";
import sandbox01 from "../levels/sandbox01.json" with { type: "json" };

export type GameHandle = {
  dispose(): void;
  /**
   * A lobby opened after the game started — Invite pressed mid-match by a
   * player who pressed Play with no party. A host game starts answering
   * offers over it; a follower's game is never given one, because joining a
   * party goes through the landing page, which tears the game down first.
   */
  attachLobby(lobby: Lobby): void;
};

export type GameOptions = {
  lobby: Lobby | null;
  /**
   * This page's peer id on the signaling server, the same for the whole
   * visit whether or not a lobby exists yet. The host stamps its own Named
   * pairing with it, so a lobby that opens mid-game still lets followers
   * put the host's name to the host's figure.
   */
  peerId: string;
  onExit(): void;
  /** A follower whose connection to the host failed chose to play alone:
   * leave the party and start a fresh world. */
  onContinueOffline(): void;
  /** The pause menu opened (true) or closed (false); false again on dispose. */
  onPauseChange(paused: boolean): void;
  /** An engine already made for the canvas (WebGPU, where `main.ts` chose
   * it) for the first renderer at `tier`; absent, the renderer makes the
   * WebGL2 one. */
  engine?: AbstractEngine;
  /** The tier `main.ts` decided (`startupTier`): `?tier=`, the player's
   * choice, or Auto. The hike starts at it; the pause screen's Settings can
   * change it while the hike runs. */
  tier: QualityTier;
  /** Where `tier` came from: `?tier=`, the player's choice, or Auto. */
  tierSource: TierSource;
  /** The tiers to try, in order, should `tier` fail to build at the start:
   * the class's start tier, then low (`startFallbacks`). */
  fallbackTiers: readonly QualityTier[];
  /**
   * A tier failed to build, at the start or on a switch: `built` is the tier
   * that did (null when none did and the hike is ending). The page records it
   * (`recordFallback`) so it is not tried again each hike.
   */
  onTierFallback(fallback: { attempted: QualityTier; built: QualityTier | null; source: TierSource }): void;
  /** The governor lowered Auto's tier from `running` (`governor.ts`): the page
   * records it (`withGovernorDrop`) so the next hike starts there too. */
  onGovernorDrop(running: QualityTier): void;
  /** The graphics setting, for the pause screen's Settings: the player's
   * choice, whether the browser keeps it, Auto's pick, `?tier=`, a line for a
   * choice put back on Auto, and how to keep a new choice. */
  quality: {
    choice(): TierChoice;
    stored(): boolean;
    auto(): AutoSummary | null;
    override: QualityTier | null;
    notice(): string | null;
    save(choice: TierChoice): void;
  };
};

/**
 * Starts a hike on `canvas`. A start that throws part-way leaves nothing it
 * made behind (`buildOrUndo`): above all no engine, and no global plugin
 * registration for the next renderer to meet.
 */
export function startGame(canvas: HTMLCanvasElement, token: string, options: GameOptions): GameHandle {
  return buildOrUndo((made) => buildGame(canvas, token, options, made));
}

function buildGame(
  firstCanvas: HTMLCanvasElement,
  token: string,
  options: GameOptions,
  made: (undo: () => void) => void,
): GameHandle {
  // The renderer and its canvas are replaced when the tier changes mid-hike
  // (`applyTier`); everything reads them through these bindings when it runs.
  let canvas = firstCanvas;
  // The sim registry is the source of truth for variant names; the command
  // layer only validates against them. This MUST run before `parseScript`
  // below: `parseScript` validates every entry as it parses, so a `terrain`
  // entry in `?cmd=` is rejected outright — landing in `errors`, never
  // `entries` — if the registry is still empty when parsing happens. On a
  // genuinely cold page load (opening a shared link) this is the only call to
  // `startGame` there is, so there is no later chance to register before that
  // parse. Registered every start, not just the first, so a later /terrain
  // re-initialisation validates against the same list it will resolve from.
  registerTerrainVariants(terrainVariantNames());

  // sandbox01 stays imported as the fallback and as the shape `renderer.ts` and
  // both sessions expect. A forest world carries a stub level with no brushes, so
  // the brush-mesh path is simply a no-op rather than a second code path.
  const level = parseLevel(sandbox01);

  const params = new URLSearchParams(location.search);
  const { entries, errors } = parseScript(params.get("cmd") ?? "");
  const { world, view } = splitEntries(entries);

  // World entries are *resolved* here, never dispatched. Dispatching one would
  // rewrite `?cmd=` and re-initialise, which would re-read the script and
  // dispatch it again — an unbounded restart loop.
  // `lastEntry`, not `find`: a later entry wins, so `seed a;seed b` builds `b` —
  // which is also the only entry the write-back would leave in the URL.
  const seedEntry = lastEntry(world, "seed");
  const seed = seedFromToken(seedEntry ? (seedEntry.args[0] as string) : token);

  // `?cmd=debug`: registers the trailhead pad marker below (host only — the
  // registry is host-side truth) and turns on the Interacted console logging
  // on both sessions, so Interact can be proven end to end in the browser.
  const debugOn = lastEntry(world, "debug") !== undefined;

  // Resolved like `seed`, never dispatched — a dispatched world entry would
  // rewrite ?cmd= and re-initialise forever. The active variant is module
  // state that survives the popstate re-initialisation, so it is set
  // explicitly on EVERY start: an absent entry must reset to the default, not
  // inherit the previous world's. An unknown name (hand-edited URL) falls
  // back to the default rather than crashing the boot.
  const terrainEntry = lastEntry(world, "terrain");
  const requested = terrainEntry?.args[0];
  setActiveTerrainVariant(
    requested !== undefined && terrainVariantNames().includes(requested)
      ? requested
      : DEFAULT_TERRAIN_VARIANT,
  );

  const forest = createForest(seed);
  // The tier asked for, and should it fail to build, the class's start tier
  // and then low, each on a fresh canvas: only the renderer is retried, not
  // the world, which is built once.
  const first = buildFirstRenderer(
    canvas,
    [options.tier, ...options.fallbackTiers],
    {
      build: (next, at, engine) => createRenderer(next, level, forest, { tier: at, engine: engine ?? undefined }),
      freshCanvas: () => document.createElement("canvas"),
    },
    options.engine ?? null,
  );
  let renderer: Renderer = first.renderer;
  canvas = first.canvas;
  made(() => renderer.dispose());
  /** The tier the running renderer was built at, and where it came from. */
  let tier: QualityTier = first.tier;
  let tierSource: TierSource = options.tierSource;
  // The governor (`governor.ts`): fed every frame of play, restarted when the
  // session starts and after a switch, stopped when it ends, acting at most
  // once per hike.
  const governor = createGovernor(performance.now());
  /** A tier is being switched: no frame of it is steady play. */
  let switching = false;
  /** The governor is acting: timing the page's idle frames, then its switch. */
  let lowering = false;
  /** What the governor's cover does when the session ends: it lifts. */
  let onSessionOver: (() => void) | null = null;
  /** A shader compiled since the last frame: that frame is a known hitch. */
  let compiledSinceFrame = false;
  let unwatchCompiles: (() => void) | null = null;
  /** Marks the frames a shader compiled in, on the renderer now running. */
  function watchCompiles(r: Renderer): void {
    unwatchCompiles?.();
    const observer = r.engine.onAfterShaderCompilationObservable.add(() => {
      compiledSinceFrame = true;
    });
    unwatchCompiles = () => r.engine.onAfterShaderCompilationObservable.remove(observer);
  }
  watchCompiles(renderer);
  made(() => unwatchCompiles?.());
  if (first.fellBack) options.onTierFallback({ attempted: options.tier, built: tier, source: options.tierSource });
  /** What the last switch of tier said, until the next choice: a fallback's line. */
  let swapError: string | null = null;
  /** Both builds of a switch failed: there is no renderer left to dispose. */
  let broken = false;
  const ambient = createAmbientAudio();
  made(() => ambient.dispose());
  // Shares the ambient context — one AudioContext for the whole game, gated on
  // the same unlock gesture. Constructed here rather than inside the renderer
  // because the renderer owns no audio: it produces the events and the camera
  // pose, and this loop carries them across. Null on a hand-authored level,
  // where there are no animals to voice: the six clip fetches and the per-frame
  // listener write would both be for nothing.
  const wildlifeAudio = renderer.hasWildlife ? createWildlifeAudio(ambient, seed) : null;
  made(() => wildlifeAudio?.dispose());
  let weatherName: WeatherPresetName = DEFAULT_WEATHER;
  /**
   * The console's preset and hour: what the escalation departs from on a
   * forest world (escalation.ts), and simply what shows everywhere else.
   */
  let base: AtmosphereBase = { weather: WEATHER_PRESETS[DEFAULT_WEATHER], hour: DEFAULT_HOUR };
  /** The escalation's eased state, reset when a match starts. */
  let escalation: EscalationState = ESCALATION_REST;
  // Recomputed when the weather does: on a `weather` command directly below,
  // and on a forest world every frame by `syncAtmosphere`, as the escalation
  // moves the weather on its own. `wildlifePresenceUnder` builds a
  // per-species array, but that per-frame allocation is one it already
  // accepts (see its own doc comment).
  let wildlifePresence = wildlifePresenceUnder(WEATHER_PRESETS[DEFAULT_WEATHER]);
  // The audio graph is gated on a user gesture; this is the same click that
  // requests pointer lock, so unlocking here needs no dedicated UI of its own.
  // Named so dispose() can remove it: a world command (e.g. `/seed`) can
  // dispatch popstate — tearing this session down — before any pointerdown,
  // and an anonymous `{ once: true }` listener left on `window` would still
  // fire later, calling `unlock()` on an ambient whose `dispose()` already ran
  // and building a full oscillator/gain graph nothing references or disposes.
  const unlockOnPointerDown = () => ambient.unlock();
  window.addEventListener("pointerdown", unlockOnPointerDown, { once: true });
  made(() => window.removeEventListener("pointerdown", unlockOnPointerDown));
  let disposed = false;
  // The browser must never scroll, zoom or select on the game canvas: every
  // finger on it is a stick or a look.
  canvas.style.touchAction = "none";
  const touchStart = isTouchDevice();
  // Built on every device: a mouse machine that gets touched shows the layer
  // on that first touch and flips the sampler into touch mode.
  const touchModel = createTouchModel(
    { width: canvas.clientWidth, height: canvas.clientHeight },
    { onPause: () => input.disengage() },
  );
  const input = createInputSampler(canvas, { touch: touchModel, touchMode: touchStart });
  made(() => input.dispose());
  const accumulator = new FixedStepAccumulator();
  const container = canvas.parentElement ?? document.body;
  const hud = createHud(container);
  made(() => hud.dispose());
  const touchLayer = createTouchLayer(container, canvas, touchModel, {
    engaged: () => input.engaged,
    onFirstTouch: () => input.setTouchMode(true),
    visible: touchStart,
  });
  made(() => touchLayer.dispose());
  // A phone backgrounds the page constantly; coming back should land on the
  // pause menu, not mid-walk. Desktop already gets this from pointer lock.
  const onVisibility = () => {
    if (document.visibilityState === "hidden" && !disposed) input.disengage();
  };
  document.addEventListener("visibilitychange", onVisibility);
  made(() => document.removeEventListener("visibilitychange", onVisibility));

  let freecam: FreecamState | null = null;
  /**
   * Freecam is enabled but has no position yet. It cannot be given one at the
   * moment it is enabled: a script is applied before the first frame, when
   * `renderer.camera` still holds the `UniversalCamera` constructor value
   * (0, 2, 0) — underground on any seed whose ground at the origin is above 2 m,
   * which shows as a black screen. `stepFreecamView` seeds it once the renderer
   * has actually put the camera on the local player.
   */
  let freecamPending = false;
  /** Whether the last `renderer.sync` put the camera on the local player's eye. */
  let cameraOnPlayer = false;
  // Mirrors what the renderer was last told, so a bare typed `/wireframe` knows
  // what it is flipping.
  let wireframe = false;
  // Mirrors what the renderer was last told, so a bare typed `/skin` knows what
  // it is flipping. On by default: skin shading starts enabled.
  let skin = true;
  // Mirrors of what the view commands and the free camera last told the
  // renderer and nothing else keeps, so a renderer built mid-hike (`applyTier`)
  // is told them again.
  let bobScale = DEFAULT_BOB_SCALE;
  let unsettleLevel = 1;
  let windOverride: number | null = null;
  let lastFreecamView: FreecamView | null = null;

  function currentScript(): ScriptEntry[] {
    return parseScript(new URLSearchParams(location.search).get("cmd") ?? "").entries;
  }

  /** Writes one entry back, so the URL always describes what is on screen. */
  function persist(name: string, args: readonly string[]): void {
    const next = setEntry(currentScript(), name, args);
    const url = new URL(location.href);
    const text = serialiseScript(next);
    if (text.length === 0) url.searchParams.delete("cmd");
    else url.searchParams.set("cmd", text);
    // replaceState, so dev fiddling does not fill the back button.
    history.replaceState({}, "", url);
  }

  /** Whether a toggle view command is currently on, for typed bare toggles. */
  function isToggleOn(name: string): boolean {
    if (name === "freecam") return freecam !== null || freecamPending;
    if (name === "wireframe") return wireframe;
    if (name === "skin") return skin;
    return false;
  }

  // The hour and weather `syncAtmosphere` last actually pushed to the
  // renderer and the ambient bed: `renderer.setHour` and `renderer.setWeather`
  // both recompute the sky, the sun and the fog and re-render the reflection
  // probe, so calling both unconditionally every frame would pay that cost
  // twice a frame for a state that moves in fractions over seconds. `applyView`
  // below writes both locals directly after its own renderer pushes, so a
  // console override at full escalation is not read as no-op drift on the
  // next `syncAtmosphere` and left standing for the rest of the match.
  let appliedHour = base.hour;
  let appliedWeather: WeatherParams = base.weather;

  /**
   * Applies a view command. World commands re-initialise instead.
   *
   * Arguments arrive in the script's declarative dialect — bare means enable —
   * whether they came from `?cmd=` or from `resolveTypedArgs`.
   *
   * `instant` covers the one command whose default apply is a fade: the
   * startup loop below passes `instant: true` so restoring `?cmd=weather …`
   * on page load lands on that weather immediately, like every other view
   * command re-establishing state on load — see the `time` branch's "Instant,
   * like every other view command" comment. A typed `/weather` from
   * `onSubmit` omits `instant` and keeps the default 3 s fade.
   */
  function applyView(name: string, args: readonly string[], options: { instant?: boolean } = {}): void {
    const value = findCommand(name)?.scriptValue?.(args);
    if (name === "freecam") {
      if (value === true) {
        // Enabling an already-flying camera must not move it, so a re-applied
        // script leaves the view where it is.
        if (freecam === null) freecamPending = true;
      } else {
        freecam = null;
        freecamPending = false;
        lastFreecamView = null;
        renderer.setFreecam(null);
      }
    } else if (name === "wireframe") {
      wireframe = value === true;
      renderer.setWireframe(wireframe);
    } else if (name === "skin") {
      skin = value !== false;
      renderer.setSkinShading(skin);
    } else if (name === "time") {
      // Instant, like every other view command: the sun moves, the world is not
      // rebuilt. Validation has already bounded this to [0, 24), so the fallback
      // is unreachable and exists only to satisfy the union type. On a forest
      // world this is the base the escalation departs from, and syncAtmosphere
      // overrides the renderer next frame; elsewhere it is simply the hour.
      base = { ...base, hour: typeof value === "number" ? value : DEFAULT_HOUR };
      renderer.setHour(base.hour);
      // Also the local `syncAtmosphere` throttles against: without this, a
      // console override at full escalation reads as no-op drift on the next
      // frame's comparison and the console's hour stands for the rest of the
      // match instead of the escalation re-asserting itself.
      appliedHour = base.hour;
    } else if (name === "weather") {
      // `Object.hasOwn`, not `in`: `in` also passes prototype keys (e.g.
      // "toString"), which are not entries of WEATHER_PRESETS.
      const preset =
        typeof value === "string" && Object.hasOwn(WEATHER_PRESETS, value)
          ? (value as WeatherPresetName)
          : DEFAULT_WEATHER;
      weatherName = preset;
      // The three direct calls stay so a world without a register behaves
      // exactly as today; on a forest world `syncAtmosphere` overrides them
      // next frame — including the 3 s fade this starts, which its instant
      // (0 s) set cancels before it is seen.
      base = { ...base, weather: WEATHER_PRESETS[preset] };
      renderer.setWeather(base.weather, options.instant ? 0 : undefined);
      // Also the local `syncAtmosphere` throttles against — see the `time`
      // branch above.
      appliedWeather = base.weather;
      ambient.setWeather(base.weather);
      wildlifePresence = wildlifePresenceUnder(base.weather);
    } else if (name === "bob") {
      bobScale = typeof value === "number" ? value : DEFAULT_BOB_SCALE;
      renderer.setBobScale(bobScale);
    } else if (name === "unsettle") {
      unsettleLevel = (typeof value === "number" ? value : 100) / 100;
      renderer.setUnsettle(unsettleLevel);
    } else if (name === "wind") {
      // Bare `/wind` restores the weather-driven speed: `scriptValue`
      // returns `false` for it, not a level, so anything but a number means
      // no override.
      windOverride = typeof value === "number" ? value / 100 : null;
      renderer.setWindOverride(windOverride);
    } else if (name === "volume") {
      // No `scriptValue` on this command (it is not persisted — see
      // commands.ts): read the validated argument directly instead.
      ambient.setVolume(args.length > 0 ? Number(args[0]) : 0.5);
    }
  }

  /**
   * Moves the listener and plays the calls the renderer produced. Runs AFTER
   * `renderer.sync` on both loops, and only after it: `sync` is what steps the
   * animals — so it is what appends the events — and what puts the camera where
   * the listener has to be. Shared for the same reason `stepFreecamView` is.
   */
  function playWildlifeAudio(): void {
    if (wildlifeAudio === null) return;
    wildlifeAudio.setListener(renderer.listener());
    wildlifeAudio.play(renderer.wildlifeEvents(), wildlifePresence);
  }

  /**
   * Hands the ambient wind bed the record `sync` just recomputed — the
   * weather-driven speed, or the `/wind` override in its place. Both loops,
   * after `renderer.sync`, which is what recomputes it; `setWind` throttles
   * itself on the record's own clock, so calling this every frame is cheap.
   */
  function syncWind(): void {
    // The listener FIRST, and from here rather than only from
    // `playWildlifeAudio`: `setWind` samples the gust at the listener, and a
    // world with no wildlife never builds a `wildlifeAudio` to place one — so
    // the bed would read the gust at the world origin for the whole match.
    // Placing it twice on a world that does have wildlife is free.
    ambient.setListener(...listenerToAudio(renderer.listener()));
    ambient.setWind(renderer.wind());
  }

  /**
   * The world's interactables, registered identically on the host and on a
   * client's predicted world so both can resolve what is in reach. Nothing
   * crosses the wire: the registry is seeded like everything else. Today that
   * is only the debug pad marker: a lone interactable 2 m out from the
   * trailhead at chest height, provably in reach when standing on the pad and
   * facing it.
   */
  function registerInteractables(world: World): void {
    if (!debugOn) return;
    const th = activeTerrainVariant().trailGraph?.(seed).trailhead;
    if (th === undefined) return;
    const y = elevationAt(seed, th.x + 2, th.z) + 0.5;
    world.interactables.set(1, {
      id: 1,
      pos: { x: th.x + 2, y, z: th.z },
      radius: 0.5,
      kind: 0,
      onInteract: (id) => console.info("[debug] interact by", id),
    });
  }

  const prompt = createInteractPrompt(container, {
    onDown: () => touchModel.interactDown(),
    onUp: () => touchModel.interactUp(),
    touch: touchStart,
  });
  made(() => prompt.dispose());

  /** Resolves and paints the prompt. Both loops, after `renderer.sync`. */
  function syncPrompt(world: World, self: PlayerState | undefined): void {
    if (self === undefined || self.health <= 0 || freecam !== null || !input.engaged) {
      prompt.sync(null);
      return;
    }
    const target = resolveInteract(world, self);
    const projected = target === null ? null : renderer.project(target.pos);
    prompt.sync(
      promptModel(target, projected, { width: canvas.clientWidth, height: canvas.clientHeight }, touchStart),
    );
  }

  /**
   * The world answering the game (escalation.ts): on a forest world with a
   * poster, the sun, the weather, the ambient gains and the wildlife's
   * presence follow the escalation every frame — the renderer's own weather
   * fade is bypassed (0 s) because the model carries the easing. Elsewhere the
   * console's base stands and this does nothing. Both loops, before
   * `renderer.sync`, which reads the weather this sets.
   */
  function syncAtmosphere(world: World, state: WorldState, localId: number, dt: number): void {
    if (world.register === null || world.trail === null) return;
    const targets = escalationTargets(state, localId, world.trail, world.boxes, world.ground);
    escalation = stepEscalation(escalation, targets, dt);
    const a = atmosphereUnder(base, escalation);
    wildlifePresence = wildlifePresenceUnder(a.weather);
    // Skip the renderer and ambient pushes on a frame the eased state barely
    // moved: `renderer.setHour`/`setWeather` recompute the sky, the sun and
    // the fog and re-render the reflection probe on every call.
    const hourMoved = Math.abs(a.hour - appliedHour) > 0.01;
    const weatherMoved =
      Math.abs(a.weather.cloudCover - appliedWeather.cloudCover) > 0.005 ||
      Math.abs(a.weather.mist - appliedWeather.mist) > 0.005 ||
      Math.abs(a.weather.rain - appliedWeather.rain) > 0.005 ||
      Math.abs(a.weather.wetness - appliedWeather.wetness) > 0.005 ||
      Math.abs(a.weather.dread - appliedWeather.dread) > 0.005;
    if (!hourMoved && !weatherMoved) return;
    appliedHour = a.hour;
    appliedWeather = a.weather;
    renderer.setHour(a.hour);
    renderer.setWeather(a.weather, 0);
    ambient.setWeather(a.weather);
  }

  let signs: { dispose(): void } | null = null;
  /**
   * The crucified hiker at the crest, or null without a summit site. Lives and
   * dies with the signs: both are seeded scenery placed once and never moved.
   */
  let body: { dispose(): void } | null = null;
  /**
   * Junction posts, and the trailhead's car and kiosk with the poster on it,
   * from the same seed the sim used, in `r`'s scene: the renderer being
   * built, which during a live tier change is not yet `renderer`.
   */
  function createSigns(world: World, r: Renderer): { dispose(): void } | null {
    const register = world.register;
    const variant = activeTerrainVariant();
    const graph = variant.trailGraph?.(seed);
    const roadCenterX = variant.roadCenterX;
    if (register === null || graph === undefined || roadCenterX === undefined) return null;
    const kiosk = propSite(graph, roadCenterX, seed, roadProp(KIOSK_MATERIAL));
    const car = propSite(graph, roadCenterX, seed, roadProp(CAR_MATERIAL));
    const groundH = (x: number, z: number): number => elevationAt(seed, x, z);
    // The places the posts name: the summit where the body lies, and every
    // pond and meadow, never under the missing hiker's own first name.
    const hikerFirst = register.hiker.name.split(" ")[0] as string;
    const posts: SignMeshes = createSignMeshes(
      r.scene,
      signPosts(graph, signSites(seed, graph.features, hikerFirst, register.body.pos)),
      groundH,
      { materialFor: (name) => terrainMaterialFor(r.scene, name), shadows: r.shadows },
    );
    const trailhead = createTrailheadMeshes(
      r.scene,
      { car: { site: car, trailhead: graph.trailhead }, kiosk: { site: kiosk, facing: kioskFacing(kiosk, graph.trailhead) } },
      groundH,
      {
        materialFor: (name) => terrainMaterialFor(r.scene, name),
        lines: ["MISSING", register.hiker.name, "Last seen on the summit trail."],
        shadows: r.shadows,
      },
    );
    return {
      dispose() {
        posts.dispose();
        trailhead.dispose();
      },
    };
  }

  /** The session's world, once there is one: what the scene extras are built from. */
  let activeWorld: World | null = null;

  /** Everything built into the scene outside the renderer: the signs and the
   * body at the crest, from the session's world, in `r`'s scene. */
  function buildExtras(r: Renderer): void {
    if (activeWorld === null) return;
    signs = createSigns(activeWorld, r);
    body = activeWorld.register === null ? null : createBodyMesh(r.scene, activeWorld.register.body, { shadows: r.shadows });
  }

  function disposeExtras(): void {
    signs?.dispose();
    body?.dispose();
    signs = null;
    body = null;
  }
  made(disposeExtras);

  const posterPanel = createPosterPanel(container);
  made(() => posterPanel.dispose());
  const endPanel = createEndPanel(container);
  made(() => endPanel.dispose());
  let lastButtons = 0;
  /**
   * The poster is this player's own screen: it opens on an Interact press at
   * the box, and closes on the next press or the first step. Local only —
   * the host resolves the same press and does nothing with it.
   */
  function syncPoster(world: World, self: PlayerState | undefined, cmd: InputCommand): void {
    const edges = pressedEdges(lastButtons, cmd.buttons);
    lastButtons = cmd.buttons;
    if (self === undefined || self.health <= 0 || world.register === null) return;
    if (posterPanel.isOpen) {
      if ((edges & Button.Interact) !== 0 || cmd.moveX !== 0 || cmd.moveZ !== 0) posterPanel.hide();
      return;
    }
    if ((edges & Button.Interact) === 0) return;
    const target = resolveInteract(world, self);
    if (target === null || target.kind !== InteractKind.Register) return;
    posterPanel.show(posterModel(world.register));
  }

  let roadLineAt = -Infinity;
  /** The line at the wall, at most once every four seconds. */
  function syncRoadLine(self: PlayerState | undefined, state: WorldState): void {
    const roadCenterX = activeTerrainVariant().roadCenterX;
    if (self === undefined || roadCenterX === undefined) return;
    const u = self.pos.x - roadCenterX(seed, self.pos.z);
    const line = roadLine(u, state.phase);
    const now = performance.now();
    if (line === null || now - roadLineAt < 4000) return;
    roadLineAt = now;
    hud.flash(line, 3000);
  }

  let dead = false;
  /**
   * Death, once: the poster closed, the view faded onto the passage. Input
   * stays live — the sim already ignores a dead player's movement and
   * Interact (`tickWorld`'s dead branch), so nothing needs suppressing,
   * their view angles keep tracking under the fade, and Escape keeps opening
   * the pause menu on every platform.
   */
  function syncDeath(self: PlayerState | undefined): void {
    if (dead || self === undefined || self.health > 0) return;
    dead = true;
    posterPanel.hide();
    hud.fade(true);
    hud.setStatus(DEATH_LINE);
  }

  // Not const: a host with no party can open a lobby mid-game (`attachLobby`).
  let lobby = options.lobby;
  /**
   * Which peer each entity is, for the end panel. Filled from the Named
   * pairings — by the host as it admits each peer, by a follower through
   * `onNamed` — never from the snapshot: a name is the lobby's, not the
   * sim's. The peer id is stored, not the display name: a pairing can land
   * before the lobby's state broadcast does, and a name resolved then would
   * stick at the peer-id prefix for good. `nameOf` resolves it when needed.
   */
  const names = new Map<number, string>();
  const selfPeerId = options.peerId;
  /**
   * The lobby's name for a peer: "You" for this player, whichever side they
   * are on, and the short peer id for anyone the lobby has not named — at
   * least stable, and distinct between two strangers.
   */
  function nameOf(peerId: string): string {
    if (peerId === selfPeerId) return "You";
    return lobby?.state.members.find((m) => m.id === peerId)?.name ?? peerId.slice(0, 8);
  }
  let ended = false;
  /**
   * The end, once: the view fades onto the panel naming who came down and who
   * did not, and the match returns to the landing. Input is suppressed here
   * but not on death — a dead player still looks around under the fade, and
   * once the panel is up there is nothing left in the world to do.
   */
  function syncOutcome(state: WorldState): void {
    if (ended || state.outcome === Outcome.Playing) return;
    ended = true;
    // Names resolve here, as the panel is built, so a pairing that landed
    // before the lobby's state did still gets the lobby's name. Unsorted:
    // `endPanelModel` orders by id, and one sort is enough. The fallback
    // covers anyone no pairing ever named — a peer whose Named event has not
    // landed — rather than leaving them off the roll entirely.
    const players = [...state.players.values()].map((p) => {
      const peerId = names.get(p.id);
      return { id: p.id, name: peerId === undefined ? `Hiker ${p.id}` : nameOf(peerId), safe: p.safe, dead: p.health <= 0 };
    });
    gate.refresh();
    posterPanel.hide();
    hud.fade(true);
    // The death line is this player's last word, the panel the match's:
    // the HUD's status sits at 55% of the view the panel covers the middle of,
    // so leaving both up prints one across the other.
    hud.setStatus(null);
    endPanel.show(endPanelModel(players));
    if (landingTimer !== null) clearTimeout(landingTimer);
    landingTimer = setTimeout(navigateToLanding, END_LANDING_MS);
    sessionOver();
  }

  /** Advances and paints the touch layer. Both loops, after `renderer.sync`. */
  function syncTouch(lampOn: boolean): void {
    touchModel.tick(performance.now());
    touchModel.setLampOn(lampOn);
    touchLayer.sync();
  }

  /**
   * Advances the free camera by one frame and pushes the result to the
   * renderer. Shared by the host and client render loops below: those two
   * closures differ because they drive different session objects, but this
   * piece of them has no such reason to fork.
   */
  function stepFreecamView(dt: number): void {
    if (freecamPending) {
      // Wait for a real position. This runs *before* `renderer.sync` in both
      // loops, so on the frame freecam is enabled the camera has not been moved
      // yet; returning here leaves `renderer` on its player-following path for
      // one more frame and adopts the eye position it produces on the next.
      //
      // That position carries whatever walking-cue offset was applied on that
      // frame — at most a few centimetres (`viewBob.ts`), and deliberately not
      // corrected for: freecam flies at 12-144 m/s, so paying for exactness
      // here would mean new renderer API for an error no one can perceive.
      if (!cameraOnPlayer) return;
      const p = renderer.camera.position;
      freecam = { x: p.x, y: p.y, z: p.z };
      freecamPending = false;
    }
    if (freecam === null) return;
    // Typing a command leaves letter keys (e.g. `KeyA` in "freecam") in the
    // shared held-key set — see input.ts. `sample()` already reports neutral
    // movement while suppressed, but `stepFreecam` reads `input.keys` directly
    // and has no notion of suppression, so it must be skipped here or the
    // camera would drift while you type.
    if (input.suppressed) return;
    // `sample` only reads accumulated state, so re-reading it for the current
    // aim is free and avoids a second source of yaw and pitch that could drift
    // from the one the player uses.
    const aim = input.sample(seq);
    freecam = stepFreecam(freecam, { yaw: aim.yaw, keys: input.keys, dt });
    lastFreecamView = { ...freecam, yaw: aim.yaw, pitch: aim.pitch };
    renderer.setFreecam(lastFreecamView);
  }

  // The pause menu and the controls: the gate alone holds or frees them, as
  // the pointer's lock, the bar, the match's end and the governor's cover
  // come and go (`createPlayGate`).
  const gate = createPlayGate({
    engaged: () => input.engaged,
    barOpen: () => bar.isOpen,
    menuOpen: () => menu.isOpen,
    ended: () => ended,
    showMenu: () => menu.show(),
    hideMenu: () => menu.hide(),
    setSuppressed: (on) => input.setSuppressed(on),
    paused: (on) => options.onPauseChange(on),
  });
  const bar = createCommandBar(container, {
    // Not while a new tier is being applied: opening the bar hides the pause
    // menu, and with it the ground over the rebuild; nor under the governor's
    // cover, where closing it would hand the controls back unseen.
    canOpen: () => !menu.applying && !gate.covered,
    onOpenChange: (open) => {
      gate.barChanged(open);
      // Closing the bar hands the mouse back, so mouselook resumes without a
      // click on the canvas — worst right after `/freecam`, whose whole point is
      // looking around. Guarded on `disposed` because a world command dispatches
      // popstate, tearing this session down, *before* the bar closes: without
      // the guard this asks a disposed sampler to lock a detached canvas.
      if (!open && !disposed) input.engage();
    },
    onSubmit: (line) => {
      const parsed = parseCommandLine(line);
      if (parsed === null) return null;
      const error = validateCommand(parsed);
      if (error !== null) return error;

      // A bare `/weather` is a query, not a state change: answer it through the
      // bar's message channel and stop before anything is persisted or applied.
      if (parsed.name === "weather" && parsed.args.length === 0) {
        return `weather: ${weatherName}`;
      }

      // A bare toggle typed into the bar flips; the URL records the state that
      // results, not the keystroke that caused it.
      const args = resolveTypedArgs(parsed.name, parsed.args, isToggleOn(parsed.name));
      // /volume is not persisted — the URL feeds the invite link, and
      // a volume level is a listener preference, not part of the shared scene.
      // Applied below via applyView; never written back to `?cmd=`.
      if (parsed.name !== "volume") persist(parsed.name, args);
      if (findCommand(parsed.name)?.kind === "world") {
        // Re-initialise through the path `main.ts` already listens on.
        window.dispatchEvent(new PopStateEvent("popstate"));
      } else {
        applyView(parsed.name, args);
      }
      return null;
    },
  });
  made(() => bar.dispose());

  const menu = createPauseMenu(container, {
    onResume: () => {
      // Re-engaging hides the menu through `onEngagedChange`, not here: the
      // request can be refused, and a menu that vanished anyway would leave
      // the player staring at a live game that ignores their mouse.
      if (!disposed) input.engage();
    },
    onExit: () => {
      // Leaving tears the renderer down and builds the landing's backdrop,
      // which blocks the page for a second or more: show the press first.
      menu.setExiting();
      afterNextPaint(() => {
        if (!disposed) options.onExit();
      });
    },
    // Apply keeps the choice and switches the running hike to it, live: the
    // menu holds on "Applying…" until the promise `applyTier` returns settles.
    settings: {
      saved: () => options.quality.choice(),
      view: (selection, applying) =>
        settingsModel({
          context: "pause",
          choice: selection,
          selectionTier: tierFor(selection),
          auto: options.quality.auto(),
          running: tier,
          override: options.quality.override,
          stored: options.quality.stored(),
          applying,
          error: swapError ?? undefined,
          notice: options.quality.notice() ?? undefined,
        }),
      onApply: (choice) => applyTier(choice),
      onChoose: () => {
        swapError = null;
      },
    },
  });
  made(() => menu.dispose());

  /**
   * The pause menu is driven by the sampler's engaged state, not by who
   * changed it: Esc (the browser releases the lock), alt-tab, focus loss, the
   * touch Pause button — one rule covers them all. The command bar's own
   * unlock is the exception; the bar is already handling the keyboard.
   */
  // Set once a follower's first handshake is wired up (below); Retry re-runs it.
  let connectClient: (() => void) | null = null;
  const connectPanel = createConnectPanel(container, {
    onReconnect: () => {
      connectPanel.hide();
      connectClient?.();
    },
    // The one way a page running an older build catches up with the host.
    onReload: () => location.reload(),
    onOffline: () => options.onContinueOffline(),
  });
  made(() => connectPanel.dispose());

  input.onEngagedChange((engaged) => {
    if (disposed) return;
    // Look is dropped while paused, but a flick still coasting would pick back up
    // on a quick resume.
    if (!engaged) touchModel.stopCoast();
    gate.engagedChanged(engaged);
  });

  // Restoring from the URL on load, not a live edit: every view command
  // applies instantly, weather included — see `applyView`'s `instant` doc.
  for (const entry of view) applyView(entry.name, entry.args, { instant: true });
  if (errors.length > 0) bar.showError(errors.join("  •  "));

  const degradation = parseNetConditions(location.search);

  const netgraph = createNetgraph(container);
  made(() => netgraph.dispose());
  const snapshotRate = new RateCounter(1000);
  const byteRate = new RateCounter(1000);
  const frameRate = new RateCounter(1000);
  let lastSnapshots = 0;
  let lastBytes = 0;

  const onDebugKey = (e: KeyboardEvent) => {
    if (e.code === "F3" || e.code === "Backquote") {
      e.preventDefault();
      netgraph.toggle();
    }
  };
  window.addEventListener("keydown", onDebugKey);
  made(() => window.removeEventListener("keydown", onDebugKey));

  let seq = 0;
  // Populated once we know whether we host or join.
  let stepAndRender: (() => void) | null = null;
  // The live host or client session, so dispose() can close its transports.
  // Left open, a finished game's per-connection `onSignal` handler (registered
  // inside `peer.ts`, not tracked in `unsubscribe` below) stays live on the
  // lobby's socket — which now outlives the game — and would feed the next
  // game's offer/answer traffic into a dead RTCPeerConnection.
  let session: { dispose(): void } | null = null;
  made(() => session?.dispose());
  // The lobby is the reliable, immediate word on whether the host is still
  // there. Without it the only signal is the data channel closing, which is
  // indistinguishable from a network hiccup and costs an ICE timeout to
  // resolve — a client ends the session at once instead.
  let lobbyEnded = false;
  // What this game registered on the lobby's socket outside the admission
  // below, undone on dispose: the socket outlives the game.
  const unsubscribe: (() => void)[] = [];
  // Undone first should the start throw: whatever arrives later (a lobby's end,
  // a follower's handshake) finds the game gone.
  made(() => {
    disposed = true;
    for (const off of unsubscribe) off();
  });
  // How a host game takes in a lobby's members; null for a follower. Held
  // outside `runAsHost` because the lobby it answers offers over can arrive
  // after the game started.
  let admission: HostAdmission | null = null;
  made(() => admission?.dispose());

  const wrap = (t: Transport): Transport =>
    degradation === null ? t : degradeTransport(t, degradation);

  let last = performance.now();
  function frameSeconds(): number {
    const now = performance.now();
    const delta = (now - last) / 1000;
    last = now;
    return delta;
  }

  // Kept so dispose() can cancel it. Without that, a session ending seconds
  // before the game is torn down still navigates — landing on top of whatever
  // the player is doing by then, which for a follower is the host's next game.
  let landingTimer: ReturnType<typeof setTimeout> | null = null;

  function endSession(message: string): void {
    // A disposed game has no HUD to write to and no business steering the
    // page: whoever disposed it decided where the player goes next.
    if (disposed) return;
    hud.setStatus(message);
    // One timer, not one per call: two ends in the same session (a session-end
    // event and a lost transport, say) would otherwise push two history
    // entries. The later message wins, as the more recent explanation.
    if (landingTimer !== null) clearTimeout(landingTimer);
    landingTimer = setTimeout(navigateToLanding, 2000);
    sessionOver();
  }

  /** The session has ended, or the match has: its last seconds are not play,
   * so nothing more for the governor, and a governor's cover lifts at once so
   * the ending is seen; a switch under it finishes, or is abandoned, as it
   * would. */
  function sessionOver(): void {
    governor.stop();
    onSessionOver?.();
  }

  /**
   * Hosting covers solo play too: a host session with zero peers is exactly a
   * local game, so the only difference a lobby makes is whether offers are
   * answered — and the lobby can arrive at any time.
   */
  function runAsHost(): void {
    // `hostPeerId` stamps the host's own Named pairing, so a follower can
    // match it against the lobby.
    const host = createHostSession(level, seed, () => performance.now(), {
      forest,
      hostPeerId: selfPeerId,
    });
    session = host;
    governor.restart(performance.now());
    escalation = ESCALATION_REST;
    hud.setStatus(null);
    // The host names itself: its own Named pairing only goes out to followers.
    names.set(host.localEntityId, selfPeerId);

    registerInteractables(host.world);
    activeWorld = host.world;
    buildExtras(renderer);
    host.onInteracted((e) => {
      if (debugOn) console.info("[debug] interacted", e);
    });

    admission = createHostAdmission(host, {
      wrap,
      onAdmitted: (entityId, peerId) => names.set(entityId, peerId),
    });
    if (lobby !== null) admission.attach(lobby);

    stepAndRender = () => {
      const dt = frameSeconds();
      feedGovernor(dt);
      const ticks = accumulator.advance(dt);
      let cmd: InputCommand | null = null;
      for (let i = 0; i < ticks; i++) {
        cmd = input.sample(++seq);
        host.tick(cmd);
      }
      stepFreecamView(dt);

      const state: WorldState = host.world.state;
      const self = state.players.get(host.localEntityId);
      syncAtmosphere(host.world, state, host.localEntityId, dt);
      renderer.sync(state, host.localEntityId, accumulator.alpha, { dt, sprinting: input.sprinting });
      playWildlifeAudio();
      syncWind();
      syncTouch(self?.lamp.on ?? false);
      syncPrompt(host.world, self);
      if (cmd !== null) syncPoster(host.world, self, cmd);
      syncRoadLine(self, state);
      syncDeath(self);
      syncOutcome(state);
      // True exactly when `sync` took its player-following branch, which is
      // the only case in which `renderer.camera.position` is an eye position
      // a pending freecam can adopt.
      cameraOnPlayer = self !== undefined && freecam === null;
      renderer.scene.render();

      const now = performance.now();
      frameRate.add(1, now);
      // The host is the authority: it has no prediction error, and no RTT
      // or downstream traffic of its own.
      netgraph.update({
        fps: frameRate.perSecond(now),
        tick: state.tick,
        rttMs: 0,
        snapshotsPerSecond: 0,
        bytesPerSecond: 0,
        entities: state.players.size + state.enemies.size,
        unackedInputs: 0,
        predictionError: 0,
      });
    };
  }

  async function runAsClient(active: Lobby): Promise<void> {
    const signaling = active.signaling;
    let reconnecting = false;

    const onClose = () => {
      // One attempt only: a peer that cannot re-establish twice in a row
      // is not coming back, and a retry loop would hide that.
      // A channel that closed because the lobby ended has nothing to reconnect
      // to: the offer would go to a host that has left, and the answer that
      // never comes would strand this game behind a 15 s timeout.
      if (reconnecting || disposed || lobbyEnded) return;
      reconnecting = true;
      hud.setStatus("Reconnecting…");
      connectAsClient(signaling, active.state.hostId, onClose)
        .then(() => {
          reconnecting = false;
          hud.setStatus(null);
        })
        .catch(() => {
          // The handshake takes up to 15 s to fail, and by then this game may
          // be gone or the lobby may have explained itself already; either way
          // this is no longer the story to tell.
          if (disposed || lobbyEnded) return;
          endSession("Lost connection to the host.");
        });
    };

    const transport = wrap(await connectAsClient(signaling, active.state.hostId, onClose));
    if (disposed) {
      // dispose() ran while the handshake was in flight, so nothing owns this
      // transport yet — close it directly rather than orphaning it.
      transport.close();
      return;
    }
    const client = createClientSession(level, seed, transport, () => performance.now(), {
      expectedLevelId: forest.levelId,
      forest,
    });
    session = client;
    governor.restart(performance.now());
    escalation = ESCALATION_REST;
    registerInteractables(client.world);
    activeWorld = client.world;
    buildExtras(renderer);
    // Every peer names itself, host or follower. The host does echo a
    // newcomer's own pairing back to it, so this is belt and braces — but it
    // means "You" never depends on that echo arriving.
    names.set(client.localEntityId, selfPeerId);
    // Safe this late: `onNamed` replays the pairings already received.
    client.onNamed((e) => names.set(e.entityId, e.peerId));
    client.onInteracted((e) => {
      if (debugOn) console.info("[debug] interacted", e);
    });
    // Each end is explained where the player can act on it: the host's own
    // reason, or a move to another world, on the status line on the way to
    // the landing page; a different build on the panel, in plain words, with
    // the ids each side runs in the console.
    client.onSessionEnd((end) => {
      if (disposed) return;
      const outcome = sessionEndOutcome(end);
      if ("status" in outcome) {
        endSession(outcome.status);
        return;
      }
      // Different builds: a status line that vanishes into the landing page
      // left the player nothing to click, and joining again from this page
      // is refused the same way. The panel stays until they reload or play
      // alone. Which build each side runs goes to the console.
      console.warn(end.message);
      // Hang up so the host drops the player it spawned for this page
      // rather than keeping a figure at the trailhead that never moves. An
      // explicit close is not a peer leaving, so no reconnect starts here.
      client.dispose();
      hud.setStatus(null);
      // The player may have resumed into the game while it connected; a
      // locked pointer cannot reach the panel's buttons.
      input.disengage();
      connectPanel.show(outcome.panel);
    });
    // Not unconditionally: the lobby can end while the handshake is in flight,
    // and clearing the status here would wipe the explanation it just wrote.
    if (!lobbyEnded) hud.setStatus(null);

    // No signaling error handler here on purpose: by this point the transport
    // is up, and `signalingPolicy.ts` ignores every code once it is — a
    // reconnect's `host_away` or `room_full` says nothing about a match that
    // is already running. The one code that does end the session, `host_gone`,
    // arrives through `active.onEnd` above, which does not have to wait for
    // the peer connection to notice.

    stepAndRender = () => {
      const dt = frameSeconds();
      feedGovernor(dt);
      const ticks = accumulator.advance(dt);
      let cmd: InputCommand | null = null;
      for (let i = 0; i < ticks; i++) {
        cmd = input.sample(++seq);
        client.tick(cmd);
      }
      stepFreecamView(dt);

      const state = client.renderState(performance.now());
      const self = state.players.get(client.localEntityId);
      syncAtmosphere(client.world, state, client.localEntityId, dt);
      renderer.sync(state, client.localEntityId, accumulator.alpha, { dt, sprinting: input.sprinting });
      playWildlifeAudio();
      syncWind();
      syncTouch(self?.lamp.on ?? false);
      syncPrompt(client.world, self);
      if (cmd !== null) syncPoster(client.world, self, cmd);
      syncRoadLine(self, state);
      syncDeath(self);
      syncOutcome(state);
      // See the host loop: a pending freecam waits for this.
      cameraOnPlayer = self !== undefined && freecam === null;
      renderer.scene.render();

      const now = performance.now();
      frameRate.add(1, now);
      const s = client.stats;
      snapshotRate.add(s.snapshotsReceived - lastSnapshots, now);
      byteRate.add(s.bytesReceived - lastBytes, now);
      lastSnapshots = s.snapshotsReceived;
      lastBytes = s.bytesReceived;
      netgraph.update({
        fps: frameRate.perSecond(now),
        tick: state.tick,
        rttMs: s.rttMs,
        snapshotsPerSecond: snapshotRate.perSecond(now),
        bytesPerSecond: byteRate.perSecond(now),
        entities: state.players.size + state.enemies.size,
        unackedInputs: s.unackedInputs,
        predictionError: s.lastPredictionError,
      });
    };
  }

  if (lobby === null || lobby.state.role === "host") {
    runAsHost();
  } else {
    const active = lobby;
    unsubscribe.push(
      active.onEnd((reason) => {
        lobbyEnded = true;
        if (reason === "host_gone") endSession("The host ended this session.");
      }),
    );
    // A failed handshake used to leave the player in an empty world with a
    // line of text and only the pause menu's Exit; the panel offers another
    // try and a way to play on alone.
    connectClient = () => {
      hud.setStatus("Connecting…");
      void runAsClient(active).catch((err: unknown) => {
        if (disposed) return;
        hud.setStatus(null);
        // As for a different build above: the buttons need the pointer.
        input.disengage();
        connectPanel.show(connectFailure(err));
      });
    };
    connectClient();
  }

  // After a reload that followed a GPU error (`main.ts`), the line saying so,
  // once. Below the session's start, whose `setStatus(null)` would wipe it; a
  // reload leaves any party, so the start before it is the host's.
  const notice = takeNotice(pageSessionStorage());
  if (notice !== null) hud.flash(notice, FALLBACK_NOTICE_MS);

  /** One frame. Named, so a live tier change can stop it on the old engine and
   * run it on the new one; it reads `renderer` when it runs. */
  function loop(): void {
    if (stepAndRender === null) {
      // Not connected yet: keep the frame clock from accumulating a huge first
      // delta, and still draw the empty level behind the HUD.
      frameSeconds();
      renderer.scene.render();
      return;
    }
    stepAndRender();
  }
  renderer.engine.runRenderLoop(loop);

  const onResize = () => {
    if (broken) return;
    renderer.resize();
    touchModel.resize({ width: canvas.clientWidth, height: canvas.clientHeight });
    touchLayer.measure();
  };
  window.addEventListener("resize", onResize);
  made(() => window.removeEventListener("resize", onResize));

  // ---- the tier, changed mid-hike ------------------------------------------------
  // Apply on the pause screen rebuilds the renderer at the new tier on a fresh
  // canvas (`rendererSwap.ts`), with the session, its connections, the input
  // and the HUD carrying on. The rebuild is one synchronous job: for its length
  // nothing ticks, sends or reads (a host's peers keep predicting, and
  // reconcile after; `sessionStall.test.ts`), and the first frame after runs
  // at most the accumulator's 15 ticks and drops the rest.

  /** The tier a choice would run at now: `?tier=`, the choice, or Auto's pick. */
  function tierFor(choice: TierChoice): QualityTier {
    return resolveTier({ override: options.quality.override, choice, auto: options.quality.auto()?.tier ?? tier }).tier;
  }

  /** Puts back on a new renderer what the old one was told. */
  function restoreView(r: Renderer): void {
    r.setHour(appliedHour);
    r.setWeather(appliedWeather, 0);
    r.setWireframe(wireframe);
    r.setSkinShading(skin);
    r.setBobScale(bobScale);
    r.setUnsettle(unsettleLevel);
    r.setWindOverride(windOverride);
    r.setFreecam(lastFreecamView);
    // The new camera is on no one until its first sync.
    cameraOnPlayer = false;
    watchCompiles(r);
  }

  const swapBindings: SwapBindings = {
    // The engine is WebGL2, made by the renderer. The WebGPU rule, where it
    // applies, makes the target's engine before the swap and passes it here.
    build: (next, target, engine) => createRenderer(next, level, forest, { tier: target, engine: engine ?? undefined }),
    freshCanvas: () => document.createElement("canvas"),
    extras: { dispose: disposeExtras, build: buildExtras },
    rebind: (next) => {
      input.rebind(next);
      touchLayer.rebind(next);
      touchModel.resize({ width: next.clientWidth, height: next.clientHeight });
      touchLayer.measure();
    },
    restore: restoreView,
    loop,
  };

  /**
   * Switches the running hike to the tier `choice` resolves to, the player's
   * Apply on the pause screen. The choice is kept only when the switch reaches
   * its tier (`switchTo`).
   */
  async function applyTier(choice: TierChoice): Promise<void> {
    const target = tierFor(choice);
    // One switch at a time: the governor's may be under way.
    if (disposed || broken || switching || lowering) return;
    if (target === tier) {
      options.quality.save(choice);
      return;
    }
    const source = resolveTier({ override: options.quality.override, choice, auto: target }).source;
    await switchTo(target, source, choice);
  }

  /**
   * Switches the running hike to `target`: the page paints first (the pause
   * screen's opaque ground, or the governor's cover), then the synchronous
   * swap, then the wait for the new scene. `save`, when given, is kept only
   * when the switch reaches `target`; a fallback keeps the choice as it was,
   * says so, and reports the tier that failed so it is not tried again. When
   * no tier builds at all, the Settings page and the landing say why, and the
   * hike ends. Returns the tier now running.
   */
  async function switchTo(target: QualityTier, source: TierSource, save: TierChoice | null): Promise<QualityTier> {
    swapError = null;
    switching = true;
    try {
      await new Promise<void>((resolve) => afterNextPaint(resolve));
      if (disposed) return tier;
      let got: ReturnType<typeof swapRenderer>;
      try {
        got = swapRenderer({ renderer, canvas }, { tier: target, engine: null, fallbackTier: tier }, swapBindings);
      } catch (error) {
        broken = true;
        // Each failed rung has taken itself down; this is for a throw from the
        // old renderer's own dispose, which would leave its registration behind.
        releaseAtmosphere();
        console.error("quality: the renderer could not be rebuilt at any tier.", error);
        swapError = "The graphics could not be restarted; returning to the title screen.";
        options.onTierFallback({ attempted: target, built: null, source });
        endSession("The graphics could not be restarted.");
        throw error;
      }
      renderer = got.renderer;
      canvas = got.canvas;
      tier = got.tier;
      const outcome = switchOutcome(save ?? "auto", got);
      if (save !== null && outcome.save !== null) options.quality.save(outcome.save);
      swapError = outcome.line;
      if (got.fellBack) options.onTierFallback({ attempted: target, built: tier, source });
      else tierSource = source;
      governor.restart(performance.now());
      console.info(`quality: ${tier} (${got.fellBack ? "fallback" : source}), engine webgl2`);
      // The forest's billboards too: they bake outside what the scene
      // counts, and would otherwise fill in after the cover has lifted.
      await whenSceneReady(renderer.scene, undefined, renderer.forestReady);
      return tier;
    } finally {
      switching = false;
    }
  }

  /** Feeds the governor one frame of play, and acts on its verdict once. */
  function feedGovernor(dt: number): void {
    const steady = steadyFrame({
      engaged: input.engaged,
      menuOpen: menu.isOpen,
      barOpen: bar.isOpen,
      visible: document.visibilityState === "visible",
      waitingItems: renderer.scene.getWaitingItemsCount(),
      compiled: compiledSinceFrame,
      switching,
      freecam: freecam !== null || freecamPending,
    });
    compiledSinceFrame = false;
    if (governor.frame(dt * 1000, performance.now(), steady)) void lowerTier();
  }

  /**
   * The governor's drop, on Auto only and above low only, under the probe's
   * opaque screen with the controls held, so neither the rebuild nor the
   * scene coming back is seen mid-play (`actOnDrop`). While it is up, the
   * pointer's lock neither shows the pause menu nor hands the controls back,
   * and the bar stays shut (`gate`); it lifts at once if the session ends.
   * The loop stops while the page's idle frames are timed; a page drawing
   * below 60 Hz by itself is left as it is. Otherwise the drop is remembered
   * for the next hike and applied now through the live switch, once, with a
   * line saying so.
   */
  async function lowerTier(): Promise<void> {
    const decision = governorDecision(governor.verdict, tier, tierSource);
    if (decision === null || disposed || broken || switching || lowering || landingTimer !== null) return;
    lowering = true;
    try {
      await actOnDrop(tier, decision.next, {
        cover: () => {
          const screen = showProbeScreen(container, OVER_PLAY_Z);
          const release = gate.cover();
          return () => {
            screen.dispose();
            if (!disposed) release();
          };
        },
        stopLoop: () => {
          const stopped = renderer;
          stopped.engine.stopRenderLoop();
          return () => {
            if (!disposed && !broken && renderer === stopped) stopped.engine.runRenderLoop(loop);
          };
        },
        idleCadence: () => timeIdleCadence(AbortSignal.timeout(GOVERNOR_IDLE_MAX_MS)),
        record: (running) => options.onGovernorDrop(running),
        // A switch that builds no tier has ended the hike and said so.
        switchTo: (next) => switchTo(next, "auto", null),
        flash: (line, ms) => hud.flash(line, ms),
        log: (line) => console.info(line),
        alive: () => !disposed && !broken && landingTimer === null,
        whenEnded: (fn) => {
          onSessionOver = fn;
          return () => {
            if (onSessionOver === fn) onSessionOver = null;
          };
        },
      });
    } catch (error) {
      console.error("quality governor: the drop could not be acted on.", error);
    } finally {
      lowering = false;
    }
  }

  return {
    attachLobby(next) {
      // A follower's game has no admission to attach to, and a lobby this
      // page follows never reaches a running game (see `GameHandle`); the
      // role check is the belt to that brace.
      if (disposed || admission === null || next.state.role !== "host") return;
      lobby = next;
      admission.attach(next);
    },
    dispose() {
      disposed = true;
      options.onPauseChange(false);
      window.removeEventListener("resize", onResize);
      window.removeEventListener("keydown", onDebugKey);
      window.removeEventListener("pointerdown", unlockOnPointerDown);
      document.removeEventListener("visibilitychange", onVisibility);
      netgraph.dispose();
      if (landingTimer !== null) clearTimeout(landingTimer);
      if (!broken) renderer.engine.stopRenderLoop();
      session?.dispose();
      admission?.dispose();
      for (const off of unsubscribe) off();
      hud.dispose();
      bar.dispose();
      menu.dispose();
      connectPanel.dispose();
      posterPanel.dispose();
      endPanel.dispose();
      disposeExtras();
      touchLayer.dispose();
      prompt.dispose();
      input.dispose();
      if (!broken) renderer.dispose();
      wildlifeAudio?.dispose();
      ambient.dispose();
    },
  };
}
