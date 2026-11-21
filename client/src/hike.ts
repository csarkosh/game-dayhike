import type { Renderer } from "./game/hikeRendererTypes.js";
import type { EndSceneSetup } from "./game/scenePlay.js";
import {
  endSceneRunner,
  END_FADE_AT_S,
  END_LANDING_AT_S,
  END_ROAD_AT_S,
  ESCAPE_FROM_M,
  ESCAPE_SETTLE_S,
  ESCAPE_WAIT_S,
  MASTER_FADE_S,
  PULL_AWAY_AT_S,
  RUN_MAX_S,
  TITLE_AT_S,
  WORLD_FADE_S,
  carHeard,
  endMistShare,
} from "./game/endScene.js";
import { navigateToLanding } from "@csarkosh/engine/game/router";
import { type FreecamState } from "@csarkosh/engine/game/freecam";
import { HOLLOW_CALL_AFTER, HOLLOW_CALL_RATE } from "./game/hikeAudio.js";
import { wildlifePresenceUnder } from "@csarkosh/engine/game/wildlifeBehaviour";
import { type WeatherParams, type WeatherPresetName } from "@csarkosh/engine/game/weather";
import {
  actsUnder,
  ESCALATION_REST,
  escalationAt,
  atmosphereUnder,
  escalationTargets,
  stepEscalation,
  type EscalationTargets,
  type AtmosphereBase,
  type EscalationState,
} from "./game/escalation.js";
import { activeTerrainVariant, elevationAt } from "@csarkosh/engine/sim/terrain";
import { type HostSession } from "./net/hostSession.js";
import { createInteractPrompt, promptModel } from "./game/interactPrompt.js";
import { createPosterPanel, posterModel } from "./game/posterPanel.js";
import { DEATH_LINE, DEATH_TITLE, DEATH_FADE_AFTER_MS, DEATH_SOUND_FADE_S, END_LANDING_MS, WON_LINE, WON_TITLE, atRoadWall } from "./game/passages.js";
import { InteractKind } from "./sim/search.js";
import { createHikeBody, createHikeSigns, loadFilmCar, type HikeSigns } from "./game/hikeScenery.js";
import { carDirection, doorSpot, trailEntrance, trailheadPlaces } from "./sim/trailhead.js";
import type { QualityTier } from "@csarkosh/engine/game/quality";
import { EXPLORE_HOUR_S, exploreHour, exploreNight, exploreWeather } from "./game/exploreDay.js";
import { pressedEdges, resolveInteract } from "./sim/interact.js";
import { Button, DeathCause, Outcome, Phase, type InputCommand, type PlayerState, type Vec3, type WorldState } from "./sim/types.js";
import { stepWay, wayOf } from "./sim/wayDraw.js";
import { wayDirection, wayPoint, wayProject } from "./sim/wayDown.js";
import { groundSpawn } from "./sim/spawn.js";
import { isOnCorridor } from "./sim/containment.js";
import { WATCH_SLOPE_NY } from "./sim/watcher.js";
import { CROWD_MOST, crowdGives, crowdLetGo, crowdOn, crowdScatter, crowdTakes, newCrowd, presenceOf, stepCrowd, type Crowd, type CrowdWorld } from "./game/crowdField.js";
import { threatOf } from "./game/chaseThreat.js";
import { RETURN_HOLD_S } from "./sim/checkpoint.js";
import { isShadeState } from "./sim/haunt.js";
import { wayLevelFor } from "./game/wayLevel.js";
import { hasLineOfSight } from "./sim/ai.js";
import { isHollowState, playerSees } from "./sim/hollow.js";
import { chaseLineDistance, chaseLinePoint } from "./sim/chaseLine.js";
import { AiState } from "./sim/types.js";
import { stepInnerVoice, voiceRest, VOICE_LINE_MS, type VoiceState, type VoiceScene } from "./game/innerVoice.js";
import { CAP_NEAR_M, droppedCapAt, type DroppedCap } from "./game/droppedCap.js";
import { createVoiceClips } from "./game/voiceClips.js";
import { CAP_SCENE_S, SHOTS, SUMMIT_SCENE_S, THRESHOLD_AT_S, thresholdAt, thresholdLook } from "./game/cutscene.js";
import { DIED_CLOSE_FROM_S } from "./game/ending.js";
import { RETURN_LIFT_MS, causeName, createDeathReturn } from "./game/deathReturn.js";
import { returnHollowAt } from "./sim/returns.js";
import { PLAYER_EYE_OFFSET, PLAYER_HALF } from "@csarkosh/engine/sim/constants";
import { ENEMY_HALF } from "./sim/dayhikeConstants.js";
import { HOLLOW_CALL_CLIP, stepWoods, WOODS_REST, type WoodsState } from "./game/woodsVoice.js";
import { stepWoodsSounds, WOODS_SOUNDS_REST, woodsSoundsFrom, type WoodsSoundsState } from "@csarkosh/engine/game/woodsSounds";
import type { World } from "./sim/world.js";
import { type Telemetry } from "@csarkosh/engine/net/telemetry";
import { DUSK_AT, MIST_AT, WET_AT } from "./sim/acts.js";
import type { InputSampler } from "@csarkosh/engine/game/input";
import type { WildlifeAudio } from "@csarkosh/engine/game/wildlifeAudio";
import type { TouchModel } from "@csarkosh/engine/game/touchControls";
import type { Presence } from "@csarkosh/engine/game/wildlifeBehaviour";
import type { PlayGate } from "@csarkosh/engine/game/pauseMenu";
import type { Hud } from "./game/hud.js";
import type { HikeAudio } from "./game/hikeAudio.js";

/** The way down's draw: milliseconds of it a frame through the climb, and once the scene or the chase is on; and the tick it starts at, ten seconds in, so nothing of it runs under the intro. */
const WAY_DRAW_MS = 1.5;
const WAY_DRAW_LATE_MS = 4;
/** The draw's slice while the summit scene's shots play: a find the draw was not done by (a console's `summit`, a peer admitted late) has until the threshold, where the player is turned to the way. */
const WAY_DRAW_SCENE_MS = 10;
const WAY_DRAW_FROM_TICK = 600;
/** Where the crowd is stepped from with no local player: nowhere, and it has no world then either. */
const CROWD_NOWHERE = { x: 0, z: 0, yaw: 0 };

/** Seconds after the last howl ends before the voice answers it, and the milliseconds into the cap's scene its line comes. */
const CRY_BEAT_S = 0.6;
const CAP_LINE_DELAY_MS = 1100;
/** Milliseconds between the lens's sight lines to a Hollow (`sightEvery`). */
const LENS_SIGHT_MS = 100;

/**
 * The marks of the climb a telemetry row names as the party passes them
 * (`sim/acts.ts`), in order: the wet, the dusk, the mist. The progress is the
 * escalation's ratchet, so each fires once a match.
 */
const ACT_MARKS: readonly (readonly [string, number])[] = [
  ["wet", WET_AT],
  ["dusk", DUSK_AT],
  ["mist", MIST_AT],
];
/** A phase's name for a row; the enum is const, so it has no runtime table. */
function phaseName(phase: Phase): string {
  return phase === Phase.Climb ? "climb" : phase === Phase.Scene ? "scene" : phase === Phase.Chase ? "chase" : String(phase);
}

/**
 * What the hike reads of the page that runs it, and the few of its variables it writes: the page's
 * own, handed over as they stand each time they are read.
 */
export type HikeHost = {
  readonly made: (undo: () => void) => void;
  readonly canvas: HTMLCanvasElement;
  readonly seed: number;
  readonly calm: boolean;
  readonly telemetry: Telemetry | null;
  readonly renderer: Renderer;
  readonly tier: QualityTier;
  readonly ambient: HikeAudio;
  readonly wildlifeAudio: WildlifeAudio | null;
  weatherName: WeatherPresetName;
  readonly base: AtmosphereBase;
  wildlifePresence: Presence;
  readonly touchStart: boolean;
  readonly touchModel: TouchModel;
  readonly input: InputSampler;
  readonly container: HTMLElement;
  readonly hud: Hud;
  readonly freecam: FreecamState | null;
  appliedHour: number;
  appliedWeather: WeatherParams;
  readonly activeWorld: World | null;
  extrasToCome: { cancel(): void } | null;
  readonly gate: PlayGate;
  readonly progressRounded: () => number;
  landingTimer: ReturnType<typeof setTimeout> | null;
  readonly sessionOver: () => void;
};

/**
 * Day Hike's own half of a hike on this screen: its state, the steps a frame runs for it, and its
 * hands on a session. The page (`app.ts`) makes it once and calls it at its own points.
 */
export function createHike(h: HikeHost) {
  /** The escalation's eased state, reset when a match starts. */
  let escalation: EscalationState = ESCALATION_REST;
  /** The `escalation` command's hold on the world's escalation for a look, or null for the climb's own. */
  let escalationHold: number | null = null;
  /** The way down's light (wayLevel.ts): the level shown, the console's hold on it (`way on|off`) or null, and the renderer and the way last given to it. */
  let wayShown = 0;
  let wayHeld: number | null = null;
  let wayGivenTo: Renderer | null = null;
  let wayGiven: World["way"] = null;
  let wayReported = false;
  /** This screen's crowd (crowdField.ts): the figures, the console's hold on their count (`crowd on|off|<count>`) or null, and the way its view of the world was made for. */
  let crowd: Crowd | null = null;
  let crowdHeld: number | null = null;
  let crowdWayFor: World["way"] = null;
  let crowdWorld: CrowdWorld | null = null;
  /** Whether the death of the player this screen's crowd has (`crowd.has`) has been seen: the host is told no more of it. */
  let crowdTook = false;
  /** The screen's seconds until which no figure may have its player: the hold after a return (sim/checkpoint.ts), through which the host would refuse the touch. */
  let crowdQuietUntil = 0;
  /** A command as the host is to hear it: with the word that a figure of this screen's crowd has its player (sim/taken.ts makes the death), until that death is seen. */
  const taken = (cmd: InputCommand): InputCommand => (crowd !== null && crowd.has !== 0 && !crowdTook ? { ...cmd, buttons: cmd.buttons | Button.Taken } : cmd);
  /** What can kill, as this screen last saw it in the state: where each stood, and whether it was a shade of the haunt (one that goes back into the crowd). */
  const crowdKnown = new Map<number, { x: number; z: number; shade: boolean }>();
  /** The explore day's clock (exploreDay.ts): seconds since the hike began, on a calm world. */
  let exploreClockS = 0;
  /** The woods' voice on the climb (woodsVoice.ts), reset with the escalation. */
  let woods: WoodsState = WOODS_REST;
  // The summit scene (cutscene.ts): from the flip, the controls are stilled and the camera is the scene's for SUMMIT_REVEAL_S.
  let wasChase = false;
  let sceneUntil = -1;
  // What telemetry has said of this match so far: the act marks reported, in
  // order; the phase last seen; the tick of the last position sample; and
  // the worst frame and the stalls since the last heartbeat, which the
  // heartbeat's sampler reads and clears.
  let actsReported = 0;
  let lastPhase: Phase = Phase.Climb;
  /** The escalation's last reading of the frame, for the trace and a death's row. */
  let lastTargets: EscalationTargets | null = null;
  let hollowSeen = false;
  /** Which scene `sceneUntil` is: the voice's lines are gated by it (innerVoice.ts VoiceScene). */
  let sceneKind: VoiceScene = "none";
  /** A scene's letterbox, off when the scene ends (the find's, a return's threshold): one timer, so a later scene's start, or the match's end, takes an earlier one's off. */
  let barsTimer: ReturnType<typeof setTimeout> | null = null;
  /** The cry: a line waits until every howl has ended (cryQuietAt), then answers once. */
  let cryPending = false;
  let cryQuietAt = -1;
  /** The `summit` command's hand on the host's own player, installed with the host session; null on a client. */
  let summitPreview: (() => void) | null = null;
  /** The `escape` command's hand on the host's own player, installed when this screen hosts; null on a client. */
  let escapeLook: (() => void) | null = null;
  /** The `stand` command's hand on the host's own player, installed with the host session; null on a client. */
  let standAt: ((x: number, z: number, yaw: number) => void) | null = null;
  /** The `lamp` command's hand on the host's own player's lamp, installed with the host session; null on a client. */
  let setLamp: ((on: boolean) => void) | null = null;
  /** Each host frame before its ticks: the `escape` look's step, which puts the player by the car once the film's car is in. */
  let escapeStep: (() => void) | null = null;
  let lastLook = { yaw: 0, pitch: 0 };
  const sceneOn = (): boolean => performance.now() < sceneUntil;
  /** The command with the player stilled: no move, no press, the look held where it was. */
  /** Metres back down the stem the threshold's turn aims at. */
  const DOWN_TRAIL_M = 10;
  /** The summit scene's threshold: the way down the trail from where the player stood at the flip, as a look (the yaw to the stem's point that far down, the pitch to its ground, so the trail is the centre of the frame, not the sky over it); null outside the summit's scene. */
  let downLook: { yaw: number; pitch: number } | null = null;
  /**
   * The end scene's run (endScene.ts): from the win on this screen the legs
   * are the scene's, a sprint at the car's door with the yaw to it and the
   * look level, until the renderer has the runner at the door; then still.
   * `endRunDoor` is null outside the scene.
   */
  let endRunDoor: { x: number; z: number } | null = null;
  let endRunYaw = 0;
  /** Whether the scene's run is this screen's own player's: not where it shows another's, who reached the car (endScene.ts `endSceneRunner`). */
  let endRunOwn = true;
  /**
   * The command with the run in it, for both loops after `stilled`, which
   * it overrides. A suppressed sample (the match ended) still comes here as
   * a command with no move in it, so the run is the scene's alone.
   */
  function ranToCar(cmd: InputCommand, me: PlayerState | undefined): InputCommand {
    if (endRunDoor === null) return cmd;
    // Another's run: this screen's own ranger stands where they are, out of it.
    if (!endRunOwn) return { ...cmd, moveX: 0, moveZ: 0, buttons: 0 };
    // A renderer with no scene (one built anew under it) runs nobody anywhere.
    const scene = h.renderer.endScene();
    if (me !== undefined && scene !== null && scene.arrival === null) {
      endRunYaw = Math.atan2(endRunDoor.x - me.pos.x, endRunDoor.z - me.pos.z);
      h.input.setLook(endRunYaw, 0);
      return { ...cmd, moveX: 0, moveZ: 1, buttons: Button.Sprint, yaw: endRunYaw, pitch: 0 };
    }
    return { ...cmd, moveX: 0, moveZ: 0, buttons: 0, yaw: endRunYaw, pitch: 0 };
  }
  /** The way down for the threshold, as a look from where `me` stands: to a point `DOWN_TRAIL_M` down the line the chase holds them to (sim/chaseLine.ts: the way down, or the stem where there is none), and its ground. Null with no player or no line. */
  function wayDownFrom(me: PlayerState | undefined, sim: World): { yaw: number; pitch: number } | null {
    const down = me === undefined ? null : chaseLinePoint(sim, me.pos.x, me.pos.z, DOWN_TRAIL_M, { x: 0, z: 0 });
    if (down === null || me === undefined) return null;
    const eyeY = me.pos.y + PLAYER_EYE_OFFSET;
    const groundY = sim.ground?.heightAt(down.x, down.z) ?? eyeY;
    return { yaw: Math.atan2(down.x - me.pos.x, down.z - me.pos.z), pitch: Math.atan2(eyeY - groundY, Math.hypot(down.x - me.pos.x, down.z - me.pos.z)) };
  }
  /** Whether the summit scene's threshold has begun on this screen: the shot in which the player is turned to the way down and run down it. */
  const thresholdOn = (): boolean => downLook !== null && sceneOn() && SUMMIT_SCENE_S - (sceneUntil - performance.now()) / 1000 >= THRESHOLD_AT_S;
  function stilled(cmd: InputCommand, me: PlayerState | undefined, sim: World): InputCommand {
    if (!sceneOn()) {
      lastLook = { yaw: cmd.yaw, pitch: cmd.pitch };
      return cmd;
    }
    const into = SUMMIT_SCENE_S - (sceneUntil - performance.now()) / 1000;
    if (downLook !== null && into >= THRESHOLD_AT_S) {
      // The threshold (cutscene.ts): the eye held on the Hollow's first steps, then turned to the
      // way down, then the legs: the player runs before the controls are theirs, and keeps the look.
      const stage = thresholdAt(into - THRESHOLD_AT_S);
      if (stage.stage === "look") return { ...cmd, moveX: 0, moveZ: 0, buttons: 0, yaw: lastLook.yaw, pitch: lastLook.pitch };
      // The way down from where they are now, asked for every tick: a way the find came too soon for is
      // turned to once it is drawn, and the run goes down it as it bends, never down the trail beside it.
      const fresh = wayDownFrom(me, sim);
      if (fresh !== null) downLook = fresh;
      const look = thresholdLook(stage, lastLook, downLook);
      h.input.setLook(look.yaw, look.pitch);
      if (stage.stage === "turn") return { ...cmd, moveX: 0, moveZ: 0, buttons: 0, yaw: look.yaw, pitch: look.pitch };
      return { ...cmd, moveX: 0, moveZ: 1, buttons: Button.Sprint, yaw: look.yaw, pitch: look.pitch };
    }
    return { ...cmd, moveX: 0, moveZ: 0, buttons: 0, yaw: lastLook.yaw, pitch: lastLook.pitch };
  }
  // The inner voice (innerVoice.ts): the ranger's own lines, local to this screen; and where the cap lies, found once a world.
  let voice: VoiceState = voiceRest(h.seed ^ 0x5a11);
  let capAt: (DroppedCap & { y: number }) | null | undefined;
  const voiceClips = createVoiceClips(h.ambient);
  h.made(() => voiceClips.dispose());
  /** The woods' other voices (woodsSounds.ts), on this screen's own stream. */
  let woodsSounds: WoodsSoundsState = WOODS_SOUNDS_REST;

  const prompt = createInteractPrompt(h.container, {
    onDown: () => h.touchModel.interactDown(),
    onUp: () => h.touchModel.interactUp(),
    touch: h.touchStart,
  });
  h.made(() => prompt.dispose());

  /** Resolves and paints the prompt. Both loops, after `renderer.sync`. */
  function syncPrompt(world: World, self: PlayerState | undefined): void {
    // Nothing to press in the end scene: the run is its own.
    if (self === undefined || self.health <= 0 || h.freecam !== null || !h.input.engaged || endRunDoor !== null) {
      prompt.sync(null);
      return;
    }
    const target = resolveInteract(world, self);
    const projected = target === null ? null : h.renderer.project(target.pos);
    prompt.sync(
      promptModel(target, projected, { width: h.canvas.clientWidth, height: h.canvas.clientHeight }, h.touchStart),
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
  /**
   * The lens's sight line to each Hollow, asked every LENS_SIGHT_MS and kept between: the lens
   * eases over LENS_EASE_S (1.5 s), so a sight a tenth of a second old cannot be seen in it, and
   * a ray through the ground every frame was a tenth of the chase's main thread. Kept by the
   * Hollow's place in the frame's order, which holds while the same Hollows stand.
   */
  const sightKept: { at: number; seen: boolean }[] = [];
  let sightIndex = 0;
  function sightEvery(eye: Vec3, h: Vec3, world: World): boolean {
    const now = performance.now();
    const k = (sightKept[sightIndex] ??= { at: -Infinity, seen: true });
    sightIndex++;
    if (now - k.at >= LENS_SIGHT_MS) {
      k.at = now;
      k.seen = hasLineOfSight(eye, h, world.boxes, world.ground);
    }
    return k.seen;
  }
  /**
   * The way down's draw (sim/wayDraw.ts), a slice a frame on the host and on a client alike, from ten seconds
   * into the match (never under the intro), so it is long done by the find; a larger slice once the scene or the
   * chase is on and it somehow is not (a console's `summit`, a peer admitted late).
   */
  function syncWayDraw(world: World, state: WorldState): void {
    if (world.wayDraw === null || (state.phase === Phase.Climb && state.tick < WAY_DRAW_FROM_TICK)) return;
    // The threshold turns the player to the way and runs them down it: what is left of the draw is done at its cut.
    if (thresholdOn()) {
      wayOf(world);
      return;
    }
    stepWay(world, state.phase === Phase.Climb ? WAY_DRAW_MS : state.phase === Phase.Scene ? WAY_DRAW_SCENE_MS : WAY_DRAW_LATE_MS, () => performance.now());
  }
  /**
   * The way down's light, a frame: whatever renderer is drawing has the world's way (a renderer made again for the
   * WebGPU swap or a lost device starts with none, and the way itself arrives when its draw ends), and the level
   * moves toward what the match asks, from the summit scene's threshold through the chase.
   */
  /**
   * This screen's crowd, a frame (crowdField.ts): stepped round the local player while the chase is on (or the
   * console holds it), from the world's way and ground, and given to the renderer. Nothing of it is the sim's,
   * and each screen has its own; a figure this player walks into has them, which the next commands say to the
   * host (`taken`). And what stands at the centre of their view (chaseThreat.ts) is told to the renderer, whose
   * dark beats faster by it.
   */
  function syncCrowd(world: World, state: WorldState, localId: number, dt: number): void {
    crowd ??= newCrowd((h.seed ^ Math.imul(localId + 1, 0x9e3779b1)) >>> 0);
    const way = world.way, ground = world.ground;
    if (way !== crowdWayFor) {
      crowdWayFor = way;
      const normal = { x: 0, y: 0, z: 0 };
      crowdWorld = way === null || ground === null ? null : {
        length: way.length,
        project: (x, z) => wayProject(way, x, z),
        point: (s, out) => wayPoint(way, s, out),
        direction: (s, out) => wayDirection(way, s, out),
        // Dry ground a figure can stand on, off the road, with nothing solid in it: what a shade of the sim's needs.
        admit: (x, z) => {
          if (groundSpawn(world.boxes, h.seed, x, z, ENEMY_HALF) === null || isOnCorridor(world, x, z)) return false;
          ground.normalAt(x, z, normal);
          return normal.y >= WATCH_SLOPE_NY;
        },
      };
    }
    const me = state.players.get(localId);
    const up = me !== undefined && (crowdHeld !== null ? crowdHeld > 0 : crowdOn(state.phase, state.outcome, wayShown));
    const seconds = performance.now() / 1000;
    // What can kill and the crowd: a killer first seen in the state has the nearest of the crowd to have been (it
    // goes as the killer comes), and a shade or a lunge gone from the state goes back among them where it stood.
    if (up && crowdWorld !== null) {
      for (const e of state.enemies.values()) if (!crowdKnown.has(e.id)) crowdGives(crowd, e.pos, seconds);
      for (const [id, was] of crowdKnown) if (was.shade && !state.enemies.has(id)) crowdTakes(crowd, was, seconds, crowdWorld);
    }
    for (const id of crowdKnown.keys()) if (!state.enemies.has(id)) crowdKnown.delete(id);
    for (const e of state.enemies.values()) {
      let known = crowdKnown.get(e.id);
      if (known === undefined) crowdKnown.set(e.id, (known = { x: 0, z: 0, shade: false }));
      known.x = e.pos.x;
      known.z = e.pos.z;
      known.shade = isShadeState(e.ai);
    }
    const prey = up && me !== undefined && me.health > 0 && state.phase === Phase.Chase && state.outcome === Outcome.Playing && !me.safe && !sceneOn() && seconds >= crowdQuietUntil;
    if (!prey && me !== undefined && me.health > 0) crowdLetGo(crowd, seconds);
    const eyeAt = me === undefined ? CROWD_NOWHERE : { x: me.pos.x, z: me.pos.z, yaw: me.yaw, prey };
    stepCrowd(crowd, up ? crowdWorld : null, eyeAt, crowdHeld ?? CROWD_MOST[h.tier], seconds, dt);
    if (crowd.has === 0) crowdTook = false;
    else if (me !== undefined && me.health <= 0) crowdTook = true;
    h.renderer.setCrowd(crowd.figures, seconds, up);
    let threat: number | null = null;
    if (prey) {
      threat = 0;
      for (const f of crowd.figures) if (f.gone < 0) threat = Math.max(threat, threatOf(eyeAt, f.x, f.z, presenceOf(f, seconds)));
      for (const e of state.enemies.values()) threat = Math.max(threat, threatOf(eyeAt, e.pos.x, e.pos.z));
    }
    h.renderer.setChaseThreat(threat);
  }
  function syncWayLight(world: World, dt: number): void {
    if (wayGivenTo !== h.renderer || wayGiven !== world.way) {
      const ground = world.ground;
      if (ground === null) h.renderer.setWay(null, () => 0);
      else h.renderer.setWay(world.way, (x, z) => ground.heightAt(x, z));
      // The way, once, as it settles: a fallback to the trail's stem, or a way longer than it should be, is a world to look at.
      const way = world.way;
      if (way !== null && !wayReported && h.telemetry !== null) {
        wayReported = true;
        h.telemetry.event("way", { length: Math.round(way.length), straight: Math.round(way.straight), fallback: way.fallback, tick: world.state.tick });
      }
      wayGivenTo = h.renderer;
      wayGiven = world.way;
    }
    const sceneInto = sceneOn() ? SUMMIT_SCENE_S - (sceneUntil - performance.now()) / 1000 : null;
    wayShown = wayHeld ?? wayLevelFor(world, sceneInto, wayShown, dt);
    h.renderer.setWayLevel(wayShown);
  }
  function syncAtmosphere(world: World, state: WorldState, localId: number, dt: number): void {
    if (world.search === null || world.trail === null) return;
    sightIndex = 0;
    const targets = escalationTargets(state, localId, world.trail, world.boxes, world.ground, (eye, h) => sightEvery(eye, h, world), (x, z) => chaseLineDistance(world, x, z));
    escalation = stepEscalation(escalation, targets, dt);
    lastTargets = targets;
    if (h.telemetry !== null) {
      // The acts, as the ratchet passes each mark; the phase, as the host's
      // truth flips it. Both are one comparison a frame.
      while (actsReported < ACT_MARKS.length && escalation.progressMax >= ACT_MARKS[actsReported]![1]) {
        h.telemetry.event("act", { act: ACT_MARKS[actsReported]![0], p: h.progressRounded(), tick: state.tick });
        actsReported += 1;
      }
      if (state.phase !== lastPhase) {
        lastPhase = state.phase;
        h.telemetry.event("phase", { phase: phaseName(state.phase), p: h.progressRounded(), tick: state.tick });
      }
    }
    // The `escalation` command's hold, for a look: the atmosphere and the acts
    // read it; the lens, the chase and the telemetry keep the climb's truth.
    // A calm world holds the sky's fall, the lens, the chase and the haunt at nothing.
    const shown = h.calm
      ? { ...escalation, world: 0, lens: 0, chase: 0, haunt: 0 }
      : escalationHold === null ? escalation : { ...escalation, world: escalationHold };
    // The end scene's road shot draws the mist back, so the car can be followed down the highway.
    // A calm world's weather and hour are the explore day's (exploreDay.ts), turning with its
    // clock from the hour the console set; the lake's calm follows the preset the day is nearest.
    let settled: AtmosphereBase;
    if (h.calm) {
      exploreClockS += dt;
      const hour = exploreHour(h.base.hour, exploreClockS);
      const day = exploreWeather(hour);
      settled = { weather: day.weather, hour };
      if (day.name !== h.weatherName) {
        h.weatherName = day.name;
        h.renderer.setWeatherName(h.weatherName, EXPLORE_HOUR_S / 2);
      }
    } else settled = atmosphereUnder(h.base, shown);
    const mist = endMistNow();
    const a = mist === 1 ? settled : { ...settled, weather: { ...settled.weather, mist: settled.weather.mist * mist } };
    // The chase's cast and its pulse, every frame: neither waits on the weather's gate below.
    h.renderer.setChase(shown.chase);
    h.renderer.setHaunt(shown.haunt);
    h.ambient.setChase(shown.chase, shown.lens);
    h.wildlifePresence = wildlifePresenceUnder(a.weather, a.hour);
    // The woods' voice: the birdsong's level, and the Hollow's call from up
    // the trail as the climb passes each mark. The call is the elk's bugle,
    // played wrong (`AmbientAudio.hollowCall`), and sounds from the crest's
    // direction: z is mirrored into Web Audio's frame, as a listener's is.
    let hollow = false;
    for (const e of state.enemies.values()) if (isHollowState(e.ai)) { hollow = true; break; }
    if (hollow && !hollowSeen) {
      hollowSeen = true;
      h.telemetry?.event("hollow_seen", { tick: state.tick, p: h.progressRounded() });
    }
    const ear = h.renderer.listener();
    const crest = world.search.body.pos;
    // A calm world's acts: its rain as the wet, and never the night's dread or its mist; the
    // birds alone hush under the sky's own night (the calls need the climb, held at zero).
    const acts = h.calm ? { wet: settled.weather.rain, night: 0, mist: 0 } : actsUnder(shown.world);
    h.renderer.setMistIn(acts.mist * mist);
    const voiced = stepWoods(woods, {
      climb: h.calm ? 0 : escalation.progressMax, wet: acts.wet, night: h.calm ? exploreNight(settled.hour) : acts.night, chase: state.phase !== Phase.Climb, hollow, rain: a.weather.rain,
      crest: Math.hypot(crest.x - ear.x, crest.y - ear.y, crest.z - ear.z),
    }, dt);
    woods = voiced.state;
    // The voice answers a cry once it is over: the clip at its slowest, its tail, and a beat; a second cry pushes that back.
    if (voiced.call !== null) {
      const clipS = h.wildlifeAudio?.clip(HOLLOW_CALL_CLIP)?.duration ?? 3;
      cryQuietAt = Math.max(cryQuietAt, performance.now() + (clipS / HOLLOW_CALL_RATE[0] + HOLLOW_CALL_AFTER[1] + CRY_BEAT_S) * 1000);
      cryPending = true;
    }
    const cryOver = cryPending && performance.now() >= cryQuietAt;
    if (cryOver) cryPending = false;
    // The find: the frame the phase flips, the scene begins on this screen.
    const chaseNow = state.phase !== Phase.Climb;
    // A flip first read with the match already decided (a follower's snapshot that carries the
    // phase and the win together, a tab back from hidden) has no find to show: the end scene's.
    if (chaseNow && !wasChase && state.outcome === Outcome.Playing) {
      sceneUntil = performance.now() + SUMMIT_SCENE_S * 1000;
      sceneKind = "summit";
      // The scene's sound takes the frame: a line still up or on its way is cut.
      voiceClips.cut();
      h.hud.hush();
      let hollow: { x: number; y: number; z: number } | null = null;
      for (const e of state.enemies.values()) if (e.ai === AiState.Emerge) { hollow = { x: e.pos.x, y: e.pos.y - ENEMY_HALF.y, z: e.pos.z }; break; }
      const me = state.players.get(localId);
      const party = me === undefined ? world.search.body.pos : { x: me.pos.x, y: me.pos.y + PLAYER_EYE_OFFSET, z: me.pos.z };
      downLook = wayDownFrom(me, world);
      h.renderer.setScene("summit", world.search.body.pos, hollow === null ? undefined : { hollow, party });
      h.hud.setBars(true);
      if (barsTimer !== null) clearTimeout(barsTimer);
      barsTimer = setTimeout(() => { barsTimer = null; h.hud.setBars(false); downLook = null; }, SUMMIT_SCENE_S * 1000);
    }
    wasChase = chaseNow;
    // The inner voice: what this player is in, this frame; one line at most.
    const self = state.players.get(localId);
    if (self !== undefined) {
      if (capAt === undefined) {
        const at = world.trail === null ? null : droppedCapAt(world.trail, h.seed);
        capAt = at === null ? null : { ...at, y: world.ground?.heightAt(at.x, at.z) ?? self.pos.y };
      }
      let shadeSeen = false;
      for (const e of state.enemies.values()) if (e.ai === AiState.Shade && playerSees(self, e, world)) { shadeSeen = true; break; }
      const body = world.search.body.pos;
      // A return's line is said on its frame (syncReturn), once.
      const returnedNow = returned;
      returned = DeathCause.None;
      const spoke = stepInnerVoice(voice, {
        climb: h.calm ? 0 : escalation.progressMax, wet: acts.wet, night: acts.night, mist: h.calm ? settled.weather.mist : acts.mist,
        chase: state.phase === Phase.Chase, ended: ended || dead, covered: h.gate.covered, scene: sceneOn() ? sceneKind : "none",
        offTrail: chaseLineDistance(world, self.pos.x, self.pos.z),
        lamp: self.lamp.on, stare: self.stare, moving: Math.hypot(self.vel.x, self.vel.z) > 0.2,
        shadeSeen, cry: cryOver && !sceneOn(),
        // The scene's reveal: the terror line in the predator's view, the fourth shot.
        hollowSeen: sceneOn() && sceneUntil - performance.now() <= (SUMMIT_SCENE_S - ((SHOTS[0] as number) + (SHOTS[1] as number) + (SHOTS[2] as number))) * 1000,
        nearCap: capAt !== null && Math.hypot(self.pos.x - capAt.x, self.pos.z - capAt.z) < CAP_NEAR_M && !sceneOn(),
        // The scene is the find on every screen (the flip comes at DISCOVERY_RADIUS, further than a step): the body's line in its second shot.
        nearBody: sceneOn() ? sceneUntil - performance.now() <= (SUMMIT_SCENE_S - (SHOTS[0] as number)) * 1000 : Math.hypot(self.pos.x - body.x, self.pos.z - body.z) < 4,
        safe: self.safe,
        calm: h.calm,
        atRoad,
        returned: returnedNow,
      }, dt);
      voice = spoke.state;
      if (spoke.line !== null) {
        if (spoke.line.scenario === "cap" && capAt !== null) {
          // The cap's scene: the camera turns to it, and the line comes once it is in view.
          sceneUntil = performance.now() + CAP_SCENE_S * 1000;
          sceneKind = "cap";
          voiceClips.cut();
          h.hud.hush();
          h.renderer.setScene("cap", { x: capAt.x, y: capAt.y, z: capAt.z });
          const said = spoke.line;
          setTimeout(() => { h.hud.say(said.text, VOICE_LINE_MS); voiceClips.speak(said); }, CAP_LINE_DELAY_MS);
        } else {
          h.hud.say(spoke.line.text, VOICE_LINE_MS);
          voiceClips.speak(spoke.line);
        }
      }
    }
    // The night's other voices, and the day's flies.
    const odd = stepWoodsSounds(woodsSounds, { night: acts.night, day: 1 - acts.wet, chase: state.phase !== Phase.Climb }, dt);
    woodsSounds = odd.state;
    if (odd.cue !== null) h.ambient.playOdd(odd.cue);
    h.ambient.setBirds(woods.birds);
    // The reveal's silence, then its call, from the body the Hollow stands behind.
    h.ambient.setHush(voiced.hush);
    const bugle = h.wildlifeAudio?.clip(HOLLOW_CALL_CLIP);
    if (voiced.call !== null && bugle !== undefined) {
      // The cry's variant is this screen's own draw: the sound is not on the wire.
      h.ambient.hollowCall(bugle, crest.x - ear.x, crest.y - ear.y, -(crest.z - ear.z), voiced.call.level, voiced.call.cutoffHz, Math.random());
    }
    // The sun's light follows the hour on every frame, so the shadows glide
    // with it: it is one vector, and the gate below stepped them 0.4 s apart
    // on the explore day's clock (`Lighting.followHour`).
    h.renderer.followHour(a.hour);
    // Skip the renderer and ambient pushes on a frame the eased state barely
    // moved: `renderer.setView` recomputes the sky, the sun and the fog and
    // re-renders the reflection probe on every call, once for both.
    const hourMoved = Math.abs(a.hour - h.appliedHour) > 0.01;
    const weatherMoved =
      Math.abs(a.weather.cloudCover - h.appliedWeather.cloudCover) > 0.005 ||
      Math.abs(a.weather.mist - h.appliedWeather.mist) > 0.005 ||
      Math.abs(a.weather.rain - h.appliedWeather.rain) > 0.005 ||
      Math.abs(a.weather.wetness - h.appliedWeather.wetness) > 0.005 ||
      Math.abs(a.weather.dread - h.appliedWeather.dread) > 0.005;
    if (!hourMoved && !weatherMoved) return;
    h.appliedHour = a.hour;
    h.appliedWeather = a.weather;
    // The wind is heard from the weather as it is: the mist the road shot draws back is the view's.
    h.renderer.setView(a.hour, a.weather);
    h.ambient.setWeather(settled.weather);
  }

  /**
   * The junction posts, and the trailhead's car and board (`hikeScenery.ts`),
   * in the scene of the renderer they were built for; null until they are
   * built, between a swap's two scenes, and on a world without them.
   */
  let signs: HikeSigns | null = null;
  /**
   * The crucified hiker at the crest, or null without a summit site. Lives and
   * dies with the signs: both are seeded scenery placed once and never moved.
   */
  let body: { dispose(): void } | null = null;
  /**
   * The film's car (`loadFilmCar`, `hikeScenery.ts`), the parked car's double
   * with wheels and a door, for the end scene: fetched into the trailhead as
   * the hike's scenery is built, and again into one built anew with the
   * extras, so its textures, its shaders and its pipelines are made while the
   * hike starts. Until 2026-11-09 it was fetched at the find, and landed in
   * the summit scene's first shots: the page held its frames for the car's
   * pipelines. A fetch that fails says so once and leaves the parked car.
   */
  let filmCarLoad: AbortController | null = null;
  /** The film's car, if it is not already here or on its way (the end's own asks: a look at the end before the scenery's fetch began). */
  function requestFilmCar(): void {
    fetchFilmCar(h.renderer);
  }
  function fetchFilmCar(r: Renderer): void {
    if (filmCarLoad !== null || signs === null) return;
    const loads = new AbortController();
    filmCarLoad = loads;
    loadFilmCar(r, signs, loads.signal);
  }

  /** What the end scene is played over: the car's site and heading, the road, the door, and the trailhead's car as it stands; null on a world with no road. */
  function endSceneSetup(): EndSceneSetup | null {
    const variant = activeTerrainVariant();
    const graph = variant.trailGraph?.(h.seed);
    const roadCenterX = variant.roadCenterX;
    if (graph === undefined || roadCenterX === undefined) return null;
    const site = trailheadPlaces(graph, roadCenterX, h.seed).car;
    const direction = carDirection(site, graph.trailhead);
    return {
      site,
      direction,
      road: { centerX: (z) => roadCenterX(h.seed, z), groundY: (x, z) => elevationAt(h.seed, x, z) },
      door: doorSpot(site, direction),
      car: () => signs?.car() ?? null,
    };
  }

  /** Everything built into the scene outside the renderer: the signs and the
   * body at the crest, from the session's world, in `r`'s scene. */
  function buildExtras(r: Renderer): void {
    if (h.activeWorld === null) return;
    signs = createHikeSigns(r, h.activeWorld, h.seed);
    fetchFilmCar(r);
    body = h.activeWorld.search === null ? null : createHikeBody(r, h.activeWorld.search.body);
  }

  function disposeExtras(): void {
    h.extrasToCome?.cancel();
    h.extrasToCome = null;
    filmCarLoad?.abort();
    filmCarLoad = null;
    signs?.dispose();
    body?.dispose();
    signs = null;
    body = null;
  }
  h.made(disposeExtras);

  const posterPanel = createPosterPanel(h.container);
  h.made(() => posterPanel.dispose());
  let lastButtons = 0;
  /**
   * The poster is this player's own screen: it opens on an Interact press at
   * the box, and closes on the next press or the first step. Local only —
   * the host resolves the same press and does nothing with it.
   */
  function syncPoster(world: World, self: PlayerState | undefined, cmd: InputCommand): void {
    const edges = pressedEdges(lastButtons, cmd.buttons);
    lastButtons = cmd.buttons;
    if (self === undefined || self.health <= 0 || world.search === null) return;
    if (posterPanel.isOpen) {
      if ((edges & Button.Interact) !== 0 || cmd.moveX !== 0 || cmd.moveZ !== 0) posterPanel.hide();
      return;
    }
    if ((edges & Button.Interact) === 0) return;
    const target = resolveInteract(world, self);
    if (target === null || target.kind !== InteractKind.Poster) return;
    h.telemetry?.event("poster", { p: h.progressRounded() });
    posterPanel.show(posterModel(world.search));
  }

  /** Whether this player stands at the road's wall this frame: the inner voice's line there (`road`). */
  let atRoad = false;
  function syncRoadLine(self: PlayerState | undefined, state: WorldState): void {
    const roadCenterX = activeTerrainVariant().roadCenterX;
    if (self === undefined || roadCenterX === undefined) {
      atRoad = false;
      return;
    }
    atRoad = atRoadWall(self.pos.x - roadCenterX(h.seed, self.pos.z), state.phase, h.calm);
  }

  let dead = false;
  /** This screen's death and return, read from its own player's health (deathReturn.ts). */
  const life = createDeathReturn();
  /** Why the player died, on the frame they come back: the voice's line for it (innerVoice.ts). None on every other frame. */
  let returned: DeathCause = DeathCause.None;
  let deathFadeTimer: ReturnType<typeof setTimeout> | null = null;
  let deathSoundTimer: ReturnType<typeof setTimeout> | null = null;

  let endFadeTimer: ReturnType<typeof setTimeout> | null = null;
  /**
   * Death, once: the poster closed, the view faded onto the passage. Input
   * stays live — the sim already ignores a dead player's movement and
   * Interact (`tickWorld`'s dead branch), so nothing needs suppressing,
   * their view angles keep tracking under the fade, and Escape keeps opening
   * the pause menu on every platform.
   */
  function syncDeath(self: PlayerState | undefined, state: WorldState, sim: World): void {
    const turn = life.step(self?.health);
    if (self === undefined || turn === null) return;
    if (turn === "returned") {
      syncReturn(self, state, sim);
      return;
    }
    dead = true;
    // What they were doing as the thing reached them (`sim/deathCause.ts`).
    h.telemetry?.event("death", {
      tick: state.tick,
      p: h.progressRounded(),
      phase: phaseName(lastPhase),
      cause: causeName(self.cause),
      near: Math.round((lastTargets?.near ?? 0) * 100) / 100,
      x: Math.round(self.pos.x * 10) / 10,
      z: Math.round(self.pos.z * 10) / 10,
    });
    posterPanel.hide();
    // The body goes down and the dark closes (ending.ts); the HUD's own fade
    // finishes the black after it, and the line sits on top.
    h.renderer.setEnding("died");
    if (deathFadeTimer !== null) clearTimeout(deathFadeTimer);
    deathFadeTimer = setTimeout(() => h.hud.fade(true), DEATH_FADE_AFTER_MS);
    // The sound goes with the dark: from its closing, gone as the black finishes.
    if (deathSoundTimer !== null) clearTimeout(deathSoundTimer);
    deathSoundTimer = setTimeout(() => h.ambient.fadeMaster(DEATH_SOUND_FADE_S), DIED_CLOSE_FROM_S * 1000);
    h.hud.setEnding({ title: DEATH_TITLE, line: DEATH_LINE });
  }

  /**
   * The return (`sim/returns.ts`): the player who died in the chase is alive
   * on the crest again, and this screen comes up with them. Everything the
   * death put on is taken off, the dark lifts and the sound comes back over
   * `RETURN_LIFT_MS`, and the summit scene's last shot plays again from its
   * start, the threshold: the eye held on the Hollow walking at them, turned
   * to the way down, the legs, the controls. The voice's line this time is
   * how they died.
   */
  function syncReturn(self: PlayerState, state: WorldState, sim: World): void {
    dead = false;
    if (deathFadeTimer !== null) clearTimeout(deathFadeTimer);
    if (deathSoundTimer !== null) clearTimeout(deathSoundTimer);
    deathFadeTimer = null;
    deathSoundTimer = null;
    // The match decided in the same breath: the end has the screen (syncOutcome).
    if (ended) return;
    h.renderer.clearEnding(RETURN_LIFT_MS / 1000);
    h.hud.setEnding(null);
    h.hud.fade(false);
    h.ambient.restoreMaster(RETURN_LIFT_MS / 1000);
    h.telemetry?.event("return", { tick: state.tick, cause: causeName(self.cause), n: life.returns() });
    // The crowd that came in round the body, and what stands down the way they ran, is not run back through.
    if (crowd !== null) {
      const now = performance.now() / 1000;
      crowdScatter(crowd, now);
      crowdQuietUntil = now + RETURN_HOLD_S;
    }
    sceneKind = "return";
    sceneUntil = performance.now() + (SHOTS[4] as number) * 1000;
    voiceClips.cut();
    h.hud.hush();
    // Where the Hollow that came for them steps out: worked out, not looked for. A follower's
    // enemies are a tenth of a second behind, so on this frame its state still has that Hollow
    // where it stood before; the place follows from the player's own (`sim/returns.ts`).
    const stepsOut = returnHollowAt(sim, self.pos);
    const hollow = stepsOut === null ? null : { x: stepsOut.x, y: stepsOut.y - ENEMY_HALF.y, z: stepsOut.z };
    const eye = { x: self.pos.x, y: self.pos.y + PLAYER_EYE_OFFSET, z: self.pos.z };
    // The eye on it, as the threshold begins: its middle, from where they stand.
    if (hollow !== null) {
      const yaw = Math.atan2(hollow.x - eye.x, hollow.z - eye.z);
      const pitch = Math.atan2(eye.y - (hollow.y + ENEMY_HALF.y), Math.hypot(hollow.x - eye.x, hollow.z - eye.z));
      h.input.setLook(yaw, pitch);
      lastLook = { yaw, pitch };
    }
    downLook = wayDownFrom(self, sim);
    h.renderer.setScene("summit", sim.search?.body.pos ?? self.pos, hollow === null ? undefined : { hollow, party: eye }, THRESHOLD_AT_S);
    h.hud.setBars(true);
    if (barsTimer !== null) clearTimeout(barsTimer);
    barsTimer = setTimeout(() => { barsTimer = null; h.hud.setBars(false); downLook = null; }, (SHOTS[4] as number) * 1000);
    returned = self.cause;
  }
  let ended = false;
  /**
   * The end, once: the view fades onto the panel naming who came down and who
   * did not, and the match returns to the landing. Input is suppressed here
   * but not on death — a dead player still looks around under the fade, and
   * once the panel is up there is nothing left in the world to do.
   */
  function syncOutcome(state: WorldState, localId: number): void {
    if (ended || state.outcome === Outcome.Playing) return;
    ended = true;
    h.gate.refresh();
    posterPanel.hide();
    // A scene still playing (a return's threshold, the find's) ends here: its letterbox timer would
    // take the end scene's bars off part-way, and its stilled turn and run are not the end's.
    if (barsTimer !== null) clearTimeout(barsTimer);
    barsTimer = null;
    sceneUntil = -1;
    downLook = null;
    // Won is won for every screen, wherever its player is: on the trail, or under their death's dark.
    const won = state.outcome === Outcome.Won;
    if (won && dead) {
      // The death's staging comes off: the end scene comes up out of the dark in place of a return.
      if (deathFadeTimer !== null) clearTimeout(deathFadeTimer);
      if (deathSoundTimer !== null) clearTimeout(deathSoundTimer);
      deathFadeTimer = null;
      deathSoundTimer = null;
      h.renderer.clearEnding(RETURN_LIFT_MS / 1000);
      h.hud.setEnding(null);
      h.hud.fade(false);
      h.ambient.restoreMaster(RETURN_LIFT_MS / 1000);
    }
    if (h.telemetry !== null) {
      let alive = 0;
      for (const p of state.players.values()) if (p.health > 0) alive += 1;
      h.telemetry.event("outcome", {
        result: state.outcome === Outcome.Won ? "won" : "lost",
        self: dead ? "dead" : "alive",
        alive,
        players: state.players.size,
        tick: state.tick,
        p: h.progressRounded(),
      });
    }
    // Won, and alive to see it: the end scene (endScene.ts), the run to the
    // car and the car down the road, its beats from the arrival
    // (`syncEndScene`). A dead player is already under their own last word,
    // which stays. There is no panel of names: the line is the end.
    const scene = won && startEndScene(true, endSceneRunner(localId, state.players.values()));
    if (won && !scene) {
      h.hud.setEnding({ title: WON_TITLE, line: WON_LINE });
      h.hud.fade(true);
    } else if (!won && !dead) h.hud.fade(true);
    if (h.landingTimer !== null) clearTimeout(h.landingTimer);
    // In the scene, the latest its landing can come: the arrival sets the true one.
    h.landingTimer = setTimeout(navigateToLanding, scene ? (RUN_MAX_S + END_ROAD_AT_S + END_LANDING_AT_S) * 1000 : END_LANDING_MS);
    h.sessionOver();
  }

  /** The end scene's world fade and title, set from the arrival; the dark is `endFadeTimer`, the landing `landingTimer`. */
  const endBeatTimers: ReturnType<typeof setTimeout>[] = [];
  let endArrived = false;
  /** Whether the scene ends at the title page: the match's does, the console's `end won` does not. */
  let endLands = false;
  /** The car as the ear hears it this frame (`carHeard`), one reused place. */
  const endHeard = { x: 0, y: 0, z: 0 };

  /** The end scene on this screen: the bars, the renderer's scene, the run; false on a world with no road. */
  function startEndScene(lands: boolean, runner: { id: number; own: boolean } | null = null): boolean {
    const setup = endSceneSetup();
    if (setup === null) return false;
    h.hud.setBars(true);
    endRunOwn = runner === null || runner.own;
    h.renderer.setEnding("won", endRunOwn ? setup : { ...setup, runner: runner!.id });
    endRunDoor = setup.door;
    endLands = lands;
    requestFilmCar();
    return true;
  }

  /**
   * The end scene's beats, from the frame the renderer has the runner at the
   * door: the car's sound started on that frame, its cues on the audio's
   * clock from there; the world's sound going from the pull-away; the title
   * and its line; the dark and the master's fade; the landing. Every frame
   * from the arrival, the car placed for the ear the last `setListener` (in
   * `syncWind`, earlier in the frame) left. Both loops, after `renderer.sync`.
   */
  function syncEndScene(): void {
    if (endRunDoor === null) return;
    const scene = h.renderer.endScene();
    if (scene === null || scene.arrival === null) return;
    const heard = carHeard(h.renderer.listener(), scene.car, endHeard);
    if (!endArrived) {
      endArrived = true;
      h.ambient.startCar(heard);
      endBeatTimers.push(setTimeout(() => h.ambient.fadeWorld(WORLD_FADE_S), PULL_AWAY_AT_S * 1000));
      endBeatTimers.push(setTimeout(() => h.hud.setEnding({ title: WON_TITLE, line: WON_LINE }), (END_ROAD_AT_S + TITLE_AT_S) * 1000));
      if (endFadeTimer !== null) clearTimeout(endFadeTimer);
      endFadeTimer = setTimeout(() => {
        h.hud.fade(true);
        h.ambient.fadeMaster(MASTER_FADE_S);
      }, (END_ROAD_AT_S + END_FADE_AT_S) * 1000);
      if (endLands) {
        if (h.landingTimer !== null) clearTimeout(h.landingTimer);
        h.landingTimer = setTimeout(navigateToLanding, (END_ROAD_AT_S + END_LANDING_AT_S) * 1000);
      }
    }
    h.ambient.setCar(scene.car.speed, heard);
  }

  /** The share of the mist the end scene leaves this frame (`endMistShare`): 1 outside its road shot. */
  function endMistNow(): number {
    const scene = endRunDoor === null ? null : h.renderer.endScene();
    if (scene === null || scene.arrival === null) return 1;
    return endMistShare(scene.t - scene.arrival - END_ROAD_AT_S);
  }

  /** What the hike reports of a match as one starts: no act reported, the climb, no Hollow seen, no targets yet. */
  function hikeReportAtRest(): void {
    actsReported = 0;
    lastPhase = Phase.Climb;
    hollowSeen = false;
    lastTargets = null;
  }

  /** The hike's own going with the page's: its panels, its timers, its signs and body, its prompt. */
  function disposeHike(): void {
    posterPanel.dispose();
    if (deathFadeTimer !== null) clearTimeout(deathFadeTimer);
    if (deathSoundTimer !== null) clearTimeout(deathSoundTimer);
    if (endFadeTimer !== null) clearTimeout(endFadeTimer);
    for (const timer of endBeatTimers) clearTimeout(timer);
    disposeExtras();
    prompt.dispose();
  }

  /**
   * The hike as a session starts it, the host's and a follower's alike: the
   * acts, the woods and the inner voice at rest, no cap dropped, no chase
   * seen, no scene held and no look down the trail, and the woods' other
   * sounds drawn afresh.
   */
  function hikeAtRest(): void {
    escalation = ESCALATION_REST;
    woods = WOODS_REST;
    voice = voiceRest(h.seed ^ 0x5a11);
    capAt = undefined;
    wasChase = false;
    sceneUntil = -1;
    downLook = null;
    woodsSounds = woodsSoundsFrom(h.seed ^ (Date.now() | 0));
  }

  /**
   * The hike's hands on the host's own player, installed with the host's
   * session: the console's looks (`summit`, `stand`, `lamp`, `escape`) and
   * the `escape` look's step before a frame's ticks. A follower has none.
   */
  function hikeHostLooks(host: HostSession): void {
    summitPreview = () => {
      const me = host.world.state.players.get(host.localEntityId);
      const body = host.world.search?.body.pos;
      if (me === undefined || body === undefined) return;
      me.pos = { x: body.x - 3, y: (host.world.ground?.heightAt(body.x - 3, body.z - 2) ?? me.pos.y - 0.9) + 0.9, z: body.z - 2 };
      me.vel = { x: 0, y: 0, z: 0 };
      me.yaw = Math.atan2(body.x - me.pos.x, body.z - me.pos.z);
    };
    standAt = (x, z, yaw) => {
      // The host's player on the ground at (x, z), still, facing the yaw (host truth, as
      // the summit's look stands them at the body); the look follows, so the frame does.
      const me = host.world.state.players.get(host.localEntityId);
      if (me === undefined) return;
      me.pos = { x, y: (host.world.ground?.heightAt(x, z) ?? me.pos.y - PLAYER_HALF.y) + PLAYER_HALF.y, z };
      me.vel = { x: 0, y: 0, z: 0 };
      me.yaw = yaw;
      h.input.setLook(yaw, 0);
    };
    setLamp = (on) => {
      // Host truth, as the Lamp button toggles it (hostSession.ts); the lamp has no drain, so it stays.
      const me = host.world.state.players.get(host.localEntityId);
      if (me !== undefined) me.lamp.on = on;
    };
    /** When the `escape` look was called, and when the film's car's first frames were over; null while not. */
    let escapeFrom: number | null = null;
    let escapeWarmed: number | null = null;
    escapeLook = () => {
      // The end scene for a look, as the real end plays: the film's car fetched now and the acts
      // at the crest's (night, mist and the chase's cast whole) at once; the win waits on the car
      // (`escapeStep`), so the scene opens on a car already drawn, as a match's does.
      if (escapeFrom !== null || endSceneSetup() === null) return;
      // Not into a scene playing or a match decided: the acts and the car would jump mid-scene.
      if (endRunDoor !== null || host.world.state.outcome !== Outcome.Playing) return;
      requestFilmCar();
      escalation = escalationAt(1, true);
      escapeFrom = performance.now();
      escapeWarmed = null;
    };
    escapeStep = () => {
      if (escapeFrom === null) return;
      // A scene already playing (the match won, or `end won`, while the look waited) is left to play.
      if (endRunDoor !== null || host.world.state.outcome !== Outcome.Playing) {
        escapeFrom = null;
        return;
      }
      const now = performance.now();
      const carIn = signs?.filmCarIn() ?? false;
      // A car that never lands: the scene on the parked one after ESCAPE_WAIT_S.
      if (!carIn && now - escapeFrom < ESCAPE_WAIT_S * 1000) return;
      if (carIn) {
        // Past its first frames, then ESCAPE_SETTLE_S on, at most ESCAPE_WAIT_S after those frames.
        if (signs?.warm() ?? false) return;
        escapeWarmed ??= now;
        const settled = now - escapeWarmed >= ESCAPE_SETTLE_S * 1000;
        if (!settled && now - escapeWarmed < ESCAPE_WAIT_S * 1000) return;
      }
      escapeFrom = null;
      // The host's player on the pad, ESCAPE_FROM_M from the car toward the trail's entrance,
      // facing the car, and the chase on if it is still the climb (host truth, a look only), so
      // the next tick's end rule wins the match and the scene plays.
      const world = host.world;
      const me = world.state.players.get(host.localEntityId);
      const setup = endSceneSetup();
      if (me === undefined || world.trail === null || setup === null) return;
      const e = trailEntrance(world.trail);
      const dx = e.x - setup.site.x, dz = e.z - setup.site.z;
      const len = Math.hypot(dx, dz);
      const ux = len > 1e-6 ? dx / len : 1, uz = len > 1e-6 ? dz / len : 0;
      const x = setup.site.x + ux * ESCAPE_FROM_M, z = setup.site.z + uz * ESCAPE_FROM_M;
      me.pos = { x, y: (world.ground?.heightAt(x, z) ?? me.pos.y - PLAYER_HALF.y) + PLAYER_HALF.y, z };
      me.vel = { x: 0, y: 0, z: 0 };
      me.yaw = Math.atan2(setup.site.x - x, setup.site.z - z);
      h.input.setLook(me.yaw, 0);
      // Only a player who was out on the mountain wins by reaching the road (sim/summit.ts): for a look, this one was.
      me.out = true;
      // The chase's flip is seen as already past, so the find's scene never starts for a look,
      // whatever frame the flip is first read on; a match's own flip comes only through the find.
      wasChase = true;
      if (world.state.phase === Phase.Climb) world.state.phase = Phase.Chase;
    };
  }

  return {
    get escalation() { return escalation; },
    get escalationHold() { return escalationHold; },
    set escalationHold(value) { escalationHold = value; },
    get wayHeld() { return wayHeld; },
    set wayHeld(value) { wayHeld = value; },
    get crowdHeld() { return crowdHeld; },
    set crowdHeld(value) { crowdHeld = value; },
    taken,
    get lastTargets() { return lastTargets; },
    get summitPreview() { return summitPreview; },
    get escapeLook() { return escapeLook; },
    get standAt() { return standAt; },
    get setLamp() { return setLamp; },
    get escapeStep() { return escapeStep; },
    get endRunDoor() { return endRunDoor; },
    ranToCar,
    stilled,
    syncPrompt,
    syncWayDraw,
    syncCrowd,
    syncWayLight,
    syncAtmosphere,
    get signs() { return signs; },
    get body() { return body; },
    buildExtras,
    disposeExtras,
    syncPoster,
    syncRoadLine,
    get dead() { return dead; },
    syncDeath,
    get ended() { return ended; },
    syncOutcome,
    startEndScene,
    syncEndScene,
    hikeReportAtRest,
    disposeHike,
    hikeAtRest,
    hikeHostLooks,
  };
}

/** The hike as the page holds it. */
export type Hike = ReturnType<typeof createHike>;
