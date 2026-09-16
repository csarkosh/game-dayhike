import { parseLevel } from "./sim/level.js";
import { createForest } from "./sim/forest.js";
import { createRenderer } from "./game/renderer.js";
import { createInputSampler } from "./game/input.js";
import { createTouchModel, createTouchLayer } from "./game/touchControls.js";
import { FixedStepAccumulator } from "./game/loop.js";
import { createHud } from "./game/hud.js";
import { createNetgraph, RateCounter } from "./game/netgraph.js";
import { navigateToLanding } from "./game/router.js";
import { createCommandBar } from "./game/commandBar.js";
import { createPauseMenu } from "./game/pauseMenu.js";
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
import { acceptAsHost, connectAsClient } from "./net/peer.js";
import { createHostSession } from "./net/hostSession.js";
import { createClientSession } from "./net/clientSession.js";
import { degradeTransport, parseNetConditions } from "./net/channels.js";
import type { Transport } from "./net/transport.js";
import { isDesktop, isTouchDevice } from "./game/platform.js";
import { createInteractPrompt, promptModel } from "./game/interactPrompt.js";
import { createRegisterPanel, registerPanelModel } from "./game/registerPanel.js";
import { DEATH_LINE, LOSS_LANDING_MS, LOSS_LINE, roadLine, WIN_LINE } from "./game/registerHud.js";
import { InteractKind, SIGN_OUT_TICKS } from "./sim/register.js";
import { signPosts } from "./sim/signs.js";
import { createSignMeshes, type SignMeshes } from "./game/signMeshes.js";
import { PROPS, propSite, type RoadProp } from "./sim/passes/trailhead.js";
import { afterNextPaint } from "./game/paint.js";
import { connectFailureMessage, createConnectPanel } from "./game/connectPanel.js";
import { pressedEdges, resolveInteract } from "./sim/interact.js";
import { Button, NO_CARRIER, NO_ITEM, Outcome, type InputCommand, type PlayerState, type WorldState } from "./sim/types.js";
import type { World } from "./sim/world.js";
import type { Lobby } from "./net/lobby.js";
import sandbox01 from "../levels/sandbox01.json" with { type: "json" };

export type GameHandle = { dispose(): void };

export type GameOptions = {
  lobby: Lobby | null;
  onExit(): void;
  /** A follower whose connection to the host failed chose to play alone:
   * leave the party and start a fresh world. */
  onContinueOffline(): void;
  /** The pause menu opened (true) or closed (false); false again on dispose. */
  onPauseChange(paused: boolean): void;
};

export function startGame(canvas: HTMLCanvasElement, token: string, options: GameOptions): GameHandle {
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
  const renderer = createRenderer(canvas, level, forest);
  const ambient = createAmbientAudio();
  // Shares the ambient context — one AudioContext for the whole game, gated on
  // the same unlock gesture. Constructed here rather than inside the renderer
  // because the renderer owns no audio: it produces the events and the camera
  // pose, and this loop carries them across. Null on a hand-authored level,
  // where there are no animals to voice: the six clip fetches and the per-frame
  // listener write would both be for nothing.
  const wildlifeAudio = renderer.hasWildlife ? createWildlifeAudio(ambient, seed) : null;
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
  const accumulator = new FixedStepAccumulator();
  const container = canvas.parentElement ?? document.body;
  const hud = createHud(container);
  const touchLayer = createTouchLayer(container, canvas, touchModel, {
    engaged: () => input.engaged,
    onFirstTouch: () => input.setTouchMode(true),
    visible: touchStart,
  });
  // A phone backgrounds the page constantly; coming back should land on the
  // pause menu, not mid-walk. Desktop already gets this from pointer lock.
  const onVisibility = () => {
    if (document.visibilityState === "hidden" && !disposed) input.disengage();
  };
  document.addEventListener("visibilitychange", onVisibility);

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
      renderer.setBobScale(typeof value === "number" ? value : DEFAULT_BOB_SCALE);
    } else if (name === "unsettle") {
      renderer.setUnsettle((typeof value === "number" ? value : 100) / 100);
    } else if (name === "wind") {
      // Bare `/wind` restores the weather-driven speed: `scriptValue`
      // returns `false` for it, not a level, so anything but a number means
      // no override.
      renderer.setWindOverride(typeof value === "number" ? value / 100 : null);
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

  /** Resolves and paints the prompt. Both loops, after `renderer.sync`. */
  function syncPrompt(world: World, self: PlayerState | undefined): void {
    if (self === undefined || self.health <= 0 || freecam !== null || !input.engaged) {
      prompt.sync(null);
      return;
    }
    const target = resolveInteract(world, self);
    const projected = target === null ? null : renderer.project(target.pos);
    const carrying =
      self.carrying === NO_ITEM ? null : (world.register?.hikers[self.carrying]?.name ?? null);
    prompt.sync(
      promptModel(target, projected, { width: canvas.clientWidth, height: canvas.clientHeight }, touchStart, {
        carrying,
        hold: self.signOutTicks / SIGN_OUT_TICKS,
      }),
    );
  }

  /**
   * The world answering the game (escalation.ts): on a forest world with a
   * register, the sun, the weather, the ambient gains and the wildlife's
   * presence follow the escalation every frame — the renderer's own weather
   * fade is bypassed (0 s) because the model carries the easing. Elsewhere the
   * console's base stands and this does nothing. Both loops, before
   * `renderer.sync`, which reads the weather this sets.
   */
  function syncAtmosphere(world: World, state: WorldState, localId: number, dt: number): void {
    if (world.register === null || world.trail === null) return;
    const targets = escalationTargets(state, localId, world.register, world.trail, world.boxes, world.ground);
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

  let signs: SignMeshes | null = null;
  /** Junction posts and the trailhead board, from the same seed the sim used. */
  function createSigns(world: World): SignMeshes | null {
    const register = world.register;
    const variant = activeTerrainVariant();
    const graph = variant.trailGraph?.(seed);
    const roadCenterX = variant.roadCenterX;
    if (register === null || graph === undefined || roadCenterX === undefined) return null;
    const sign = propSite(graph, roadCenterX, seed, PROPS[1] as RoadProp);
    // The face toward the pad: the sign stands SIGN_ROAD_Z along the road from the trailhead.
    const facing = { dx: 0, dz: sign.z > graph.trailhead.z ? -1 : 1 };
    return createSignMeshes(
      renderer.scene,
      signPosts(graph, register.hikers.map((h) => h.site)),
      { x: sign.x, z: sign.z, facing, lines: ["TRAILHEAD REGISTER", ...register.hikers.map((h) => `${h.name} — ${h.site.name}`)] },
      (x, z) => elevationAt(seed, x, z),
    );
  }

  const registerPanel = createRegisterPanel(container);
  let lastButtons = 0;
  /**
   * The book is this player's own screen: it opens on an Interact press at
   * the box with empty hands, and closes on the next press or the first step.
   * Local only — the host resolves the same press and does nothing with it.
   */
  function syncBook(world: World, self: PlayerState | undefined, cmd: InputCommand, state: WorldState): void {
    const edges = pressedEdges(lastButtons, cmd.buttons);
    lastButtons = cmd.buttons;
    if (self === undefined || self.health <= 0 || world.register === null) return;
    if (registerPanel.isOpen) {
      if ((edges & Button.Interact) !== 0 || cmd.moveX !== 0 || cmd.moveZ !== 0) registerPanel.hide();
      return;
    }
    if ((edges & Button.Interact) === 0 || self.carrying !== NO_ITEM) return;
    const target = resolveInteract(world, self);
    if (target === null || target.kind !== InteractKind.Register) return;
    // No carrier names yet: lobby members are keyed by signaling peer id and
    // the items by entity id, and nothing in the game maps one to the other.
    // A carried item reads "carried"; naming the carrier is a follow-up.
    registerPanel.show(registerPanelModel(world.register, state.items, new Map()));
  }

  let roadLineAt = -Infinity;
  /** The line at the wall, at most once every four seconds. */
  function syncRoadLine(self: PlayerState | undefined, state: WorldState): void {
    const roadCenterX = activeTerrainVariant().roadCenterX;
    if (self === undefined || roadCenterX === undefined || state.items.length === 0) return;
    const u = self.pos.x - roadCenterX(seed, self.pos.z);
    const line = roadLine(u, state.items.every((it) => it.signedOut));
    const now = performance.now();
    if (line === null || now - roadLineAt < 4000) return;
    roadLineAt = now;
    hud.flash(line, 3000);
  }

  let lastCarriers: number[] = [];
  /** Item carrier transitions become sounds; the pen runs while this player's hold does. */
  function syncRegisterAudio(state: WorldState, self: PlayerState | undefined): void {
    for (const item of state.items) {
      const was = lastCarriers[item.id];
      if (was === undefined) continue;
      if (was === NO_CARRIER && item.carrier !== NO_CARRIER) {
        const p = state.players.get(item.carrier);
        // Web Audio's frame is right-handed: -z, as wildlifeAudio.ts mirrors it.
        if (p !== undefined) ambient.objectSound("pickup", p.pos.x, p.pos.y, -p.pos.z);
      } else if (was !== NO_CARRIER && item.carrier === NO_CARRIER && !item.signedOut) {
        ambient.objectSound("putdown", item.pos.x, item.pos.y, -item.pos.z);
      }
    }
    lastCarriers = state.items.map((it) => it.carrier);
    ambient.setPen(self !== undefined && self.signOutTicks > 0);
  }

  let dead = false;
  /**
   * Death, once: the book closed, the view faded onto the passage. Input
   * stays live — the sim already ignores a dead player's movement and
   * Interact (`tickWorld`'s dead branch, `pickUp`'s `dead(player)` check),
   * so nothing needs suppressing, their view angles keep tracking under the
   * fade, and Escape keeps opening the pause menu on every platform.
   */
  function syncDeath(self: PlayerState | undefined): void {
    if (dead || self === undefined || self.health > 0) return;
    dead = true;
    registerPanel.hide();
    hud.fade(true);
    hud.setStatus(DEATH_LINE);
  }

  let ended = false;
  /** The end, once: the view fades to one line and the match returns to the landing. */
  function syncOutcome(state: WorldState): void {
    if (ended || state.outcome === Outcome.Playing) return;
    ended = true;
    const won = state.outcome === Outcome.Won;
    input.setSuppressed(true);
    registerPanel.hide();
    hud.fade(true);
    hud.setStatus(won ? WIN_LINE : LOSS_LINE);
    if (landingTimer !== null) clearTimeout(landingTimer);
    landingTimer = setTimeout(navigateToLanding, won ? 5000 : LOSS_LANDING_MS);
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
    renderer.setFreecam({ ...freecam, yaw: aim.yaw, pitch: aim.pitch });
  }

  const bar = createCommandBar(container, {
    onOpenChange: (open) => {
      // The bar outranks the pause menu: `/` over the menu switches to typing.
      if (open) menu.hide();
      input.setSuppressed(open || menu.isOpen);
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
  });

  /**
   * The pause menu is driven by the sampler's engaged state, not by who
   * changed it: Esc (the browser releases the lock), alt-tab, focus loss, the
   * touch Pause button — one rule covers them all. The command bar's own
   * unlock is the exception; the bar is already handling the keyboard.
   */
  // Set once a follower's first handshake is wired up (below); Retry re-runs it.
  let connectClient: (() => void) | null = null;
  const connectPanel = createConnectPanel(container, {
    onRetry: () => {
      connectPanel.hide();
      connectClient?.();
    },
    onOffline: () => options.onContinueOffline(),
  });

  input.onEngagedChange((engaged) => {
    if (disposed) return;
    if (engaged) {
      menu.hide();
      input.setSuppressed(bar.isOpen);
      options.onPauseChange(false);
    } else if (!bar.isOpen) {
      menu.show();
      input.setSuppressed(true);
      options.onPauseChange(true);
    }
  });

  // Restoring from the URL on load, not a live edit: every view command
  // applies instantly, weather included — see `applyView`'s `instant` doc.
  for (const entry of view) applyView(entry.name, entry.args, { instant: true });
  if (errors.length > 0) bar.showError(errors.join("  •  "));

  const degradation = parseNetConditions(location.search);

  const netgraph = createNetgraph(container);
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

  const lobby = options.lobby;
  let seq = 0;
  // Populated once we know whether we host or join.
  let stepAndRender: (() => void) | null = null;
  // The live host or client session, so dispose() can close its transports.
  // Left open, a finished game's per-connection `onSignal` handler (registered
  // inside `peer.ts`, not tracked in `unsubscribe` below) stays live on the
  // lobby's socket — which now outlives the game — and would feed the next
  // game's offer/answer traffic into a dead RTCPeerConnection.
  let session: { dispose(): void } | null = null;
  // The lobby is the reliable, immediate word on whether the host is still
  // there. Without it the only signal is the data channel closing, which is
  // indistinguishable from a network hiccup and costs an ICE timeout to
  // resolve — a client ends the session at once instead.
  let lobbyEnded = false;
  // Everything this game registered on the lobby's socket, undone on dispose:
  // the socket outlives the game.
  const unsubscribe: (() => void)[] = [];

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
  }

  /**
   * Hosting covers solo play too: a host session with zero peers is exactly a
   * local game, so the only difference a lobby makes is whether offers are
   * answered.
   */
  function runAsHost(): void {
    const host = createHostSession(level, seed, () => performance.now(), { forest });
    session = host;
    escalation = ESCALATION_REST;
    hud.setStatus(null);

    registerInteractables(host.world);
    signs = createSigns(host.world);
    host.onInteracted((e) => {
      if (debugOn) console.info("[debug] interacted", e);
    });

    if (lobby !== null) {
      const signaling = lobby.signaling;
      unsubscribe.push(
        signaling.onSignal((from, payload) => {
          const data = payload as { sdp?: RTCSessionDescriptionInit };
          if (!data.sdp || data.sdp.type !== "offer") return;
          void acceptAsHost(signaling, from, data.sdp, () => host.removePeer(from))
            .then((transport) => {
              host.addPeer(from, wrap(transport));
            })
            .catch(() => undefined);
        }),
      );
      // A data channel only closes when the other side closes it. A closed tab
      // or a dead phone never does, and the lobby is told at once either way
      // (`pagehide` says goodbye; the server reaps a silent socket), so the
      // lobby's list decides who is still in the world.
      unsubscribe.push(
        lobby.onChange((s) => host.retainPeers(new Set(s.members.map((m) => m.id)))),
      );
    }

    stepAndRender = () => {
      const dt = frameSeconds();
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
      if (cmd !== null) syncBook(host.world, self, cmd, state);
      syncRoadLine(self, state);
      syncRegisterAudio(state, self);
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
      ...(isDesktop()
        ? { staleClientAdvice: "Download the latest desktop version from the landing page." }
        : {}),
    });
    session = client;
    escalation = ESCALATION_REST;
    registerInteractables(client.world);
    signs = createSigns(client.world);
    client.onInteracted((e) => {
      if (debugOn) console.info("[debug] interacted", e);
    });
    // Show the reason the session actually gave. Hardcoding one message here
    // made every failure read as a deliberate host shutdown, including the
    // level-mismatch check, whose whole purpose is to say what went wrong.
    client.onSessionEnd((reason) =>
      endSession(reason.length > 0 ? reason : "The host ended this session."),
    );
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
      if (cmd !== null) syncBook(client.world, self, cmd, state);
      syncRoadLine(self, state);
      syncRegisterAudio(state, self);
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
        connectPanel.show(connectFailureMessage(err));
      });
    };
    connectClient();
  }

  renderer.engine.runRenderLoop(() => {
    if (stepAndRender === null) {
      // Not connected yet: keep the frame clock from accumulating a huge first
      // delta, and still draw the empty level behind the HUD.
      frameSeconds();
      renderer.scene.render();
      return;
    }
    stepAndRender();
  });

  const onResize = () => {
    renderer.resize();
    touchModel.resize({ width: canvas.clientWidth, height: canvas.clientHeight });
    touchLayer.measure();
  };
  window.addEventListener("resize", onResize);

  return {
    dispose() {
      disposed = true;
      options.onPauseChange(false);
      window.removeEventListener("resize", onResize);
      window.removeEventListener("keydown", onDebugKey);
      window.removeEventListener("pointerdown", unlockOnPointerDown);
      document.removeEventListener("visibilitychange", onVisibility);
      netgraph.dispose();
      if (landingTimer !== null) clearTimeout(landingTimer);
      renderer.engine.stopRenderLoop();
      session?.dispose();
      for (const off of unsubscribe) off();
      hud.dispose();
      bar.dispose();
      menu.dispose();
      connectPanel.dispose();
      registerPanel.dispose();
      signs?.dispose();
      touchLayer.dispose();
      prompt.dispose();
      input.dispose();
      renderer.dispose();
      wildlifeAudio?.dispose();
      ambient.dispose();
    },
  };
}
