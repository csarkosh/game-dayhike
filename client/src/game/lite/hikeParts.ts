/**
 * Day Hike's side of a renderer (`renderGame.ts`): what is this game's own to draw and to say
 * in a frame the engine draws. The hikers' bodies and the Hollows' eyes and figures, the lamps
 * the others wear, the dropped cap and the scenery placed once; the crowd and the way down's
 * lights and haze; the scenes and endings, which take the frame's camera and its lamp; and how
 * far the stare and the chase turn the horror look. The renderer calls each point at its own
 * step, in its own order; nothing here draws a frame.
 */
import type { SceneContext } from "@babylonjs/lite";
import { elevationAt, activeTerrainVariant } from "@csarkosh/engine/sim/terrain";
import { WAY_MIST_EDGE_M, WAY_MIST_FADE_M, cloudColourUnder } from "@csarkosh/engine/game/cloudParams";
import { CHASE_TINT } from "@csarkosh/engine/game/gradeParams";
import { LAMP_COLOUR, type LampState } from "@csarkosh/engine/game/lampParams";
import { STARE_LENS_REST, stareSide, stepStareLens, type StareLens } from "@csarkosh/engine/game/stareLens";
import { WET_CAP } from "@csarkosh/engine/game/wetSurface";
import { isHollow } from "../../sim/hollow.js";
import type { PlayerState, WorldState } from "../../sim/types.js";
import { wayDistanceWithin, type WayDown } from "../../sim/wayDown.js";
import { CROWD_CARDS_TO_M } from "../crowdCards.js";
import { CROWD_MOST, crowdHeights, type CrowdGround } from "../crowdField.js";
import { KILLERS_MOST, createKillerShadows } from "../crowdKillers.js";
import { droppedCapAt } from "../droppedCap.js";
import { HEADLAMP_CONE, HEADLAMP_INTENSITY, HEADLAMP_RANGE } from "../endScene.js";
import type { EndingKind } from "../ending.js";
import { createEntityPoses, type EntityFrame, type HollowPose } from "../entityPoses.js";
import type { HikeApi } from "../hikeRendererTypes.js";
import { createScenePlay, stareWithDark, type EndSceneSetup, type PlayNow } from "../scenePlay.js";
import { bodiesInShot } from "../shotBodies.js";
import { wayHazeInto } from "../wayHaze.js";
import { wayDimAt } from "../wayLevel.js";
import type { WayColourPath } from "../wayLight.js";
import { wayTint } from "../wayLightGeometry.js";
import { createWildlifeInputs } from "../wildlifeInputs.js";
import { readHikeMatch } from "../hikeWildlife.js";
import { createCapMesh, type CapMesh } from "./capMesh.js";
import { createLiteCrowdCards, type LiteCrowdCards } from "./crowdCardMeshes.js";
import { createLiteCrowdEyes, type LiteCrowdEyes } from "./crowdEyeMeshes.js";
import { createEntityMeshes, type EntityMeshes } from "./entityMeshes.js";
import type { RenderCloudPath, RenderGame, RenderHost, RenderLook, RenderMakeMasked, RenderShot, RenderSide } from "@csarkosh/engine/game/lite/renderGame";
import { createLiteScenery, deferredScenery, type LiteCar, type LiteScenery, type SceneryHost, type SceneryView } from "./sceneryMeshes.js";
import { createLiteWayField, type LiteWayField } from "./wayFieldMesh.js";
import { createLiteWayLight, type LiteWayLight } from "./wayLightMeshes.js";
import { createWornLamps, type WornLamps } from "./wornLamps.js";

/** The crowd's figures at the most, on the tier that draws the most of them, with the chase's killers drawn among them. */
const CROWD_MOST_ANY = Math.max(CROWD_MOST.low, CROWD_MOST.medium, CROWD_MOST.high) + KILLERS_MOST;
const NO_BODIES: readonly HollowPose[] = [];
const CROWD_NONE_HELD: ReadonlySet<number> = new Set();
/** How far under the eye the crowd's ground is taken to lie where the way's own height is not known (m). */
const CROWD_EYE_OVER_GROUND_M = 1.7;

/** What the hike's renderer wears beside the engine's own: Day Hike's methods, and the scenery a hike asks to be placed. */
export type HikeRendererApi = HikeApi & { scenery: SceneryHost };

export const hikeParts: RenderGame<WorldState, PlayerState, HikeRendererApi> = (host: RenderHost) => {
  const { chained, forest, pose, jobs, uploads } = host;
  /** How far the horror look is turned, as the hike last set it (`setChase`, `setUnsettle`, `setWayLevel`, `setHaunt`, `setMistIn`). */
  const look: RenderLook = { cast: 0, unsettle: 1, dim: 1, haunt: 0, mistIn: 0 };
  /** The local player's stare as their screen and ears take it (`stareLens.ts`). */
  let stareLens: StareLens = STARE_LENS_REST;
  /** What stands at the centre of the local player's view in the chase (`setChaseThreat`), or null outside it: the lens's dark is the chase's own while it is given. */
  let chaseThreat: number | null = null;
  /** The way down the app last gave (`setWay`) with the ground its mist stands on, and the level its mist is held at (`setWayLevel`). */
  let way: WayDown | null = null;
  let wayHeightAt: ((x: number, z: number) => number) | null = null;
  let wayLevel = 0;
  /** Which path the way's mist and the crowd's rims are toned for. */
  const wayPath: WayColourPath = chained ? "post" : "material";
  /** The ground under the crowd's figures, kept between frames (`crowdHeights`), and the frame's heights. */
  const crowdGround: CrowdGround = new Map();
  const crowdHeightsOut: number[] = [];
  /** The chase's killers drawn among the crowd (crowdKillers.ts), and the screen's seconds the crowd was last told at, which their figures come and go by. */
  const killers = createKillerShadows();
  let crowdSeconds = 0;
  /** Where the hikers and the Hollows stand a frame, and how (`entityPoses.ts`). */
  const poses = createEntityPoses();
  /** The frame's bodies, from the frame's opening to its bodies' draw: a scene may pose them again in between. */
  let bodies: EntityFrame | null = null;
  /**
   * The scenes and the endings as the frames play them (`scenePlay.ts`): stepped once a frame on the player's eye,
   * which it hands back as the frame's camera with the shot's lens. Everything that reads the view reads it after:
   * the chain's passes and their last camera, the mask, the rain, every part's test against the view's planes. The
   * end scene's car is the scenery's own, stood where the scene has it; once it has left the rain's cover the map is
   * drawn again.
   */
  const play = createScenePlay({
    stage: (at, car) => (car as LiteCar).stage(at),
    coverLeft: () => host.redrawCover(),
  });
  /** What the frame's scene asks, as the play last said; null on a frame with no local player or under the free camera. */
  let playNow: PlayNow | null = null;
  /** The death's dark as the last frame posed it: the passes read it a frame late. */
  let darkWas = 0;
  /** The most hikers other than the local one the state has held at once: a lamp's light is made for each. */
  let othersSeen = 0;
  /** The end scene's car's headlamps, as the one lamp the lens carries is lit while it stands at the car's nose. */
  const carLamp: LampState = { intensity: HEADLAMP_INTENSITY, colour: { r: LAMP_COLOUR[0], g: LAMP_COLOUR[1], b: LAMP_COLOUR[2] } };
  const wildlife = createWildlifeInputs(readHikeMatch);

  // The parts of a standing renderer: made with it (`lights`, `early`, `late`), let go with it (`release`).
  let mask: RenderMakeMasked["mask"] = null;
  let wornLamps: WornLamps | null = null;
  let wayLight: LiteWayLight | null = null;
  let wayField: LiteWayField | null = null;
  let crowdCards: LiteCrowdCards | null = null;
  let crowdEyes: LiteCrowdEyes | null = null;
  let entities: EntityMeshes | null = null;
  let cap: CapMesh | null = null;
  let scenery: LiteScenery | null = null;
  const sceneryHost: SceneryHost = deferredScenery(host.whenMade, () => (host.disposed() ? null : scenery));
  const sceneryView: SceneryView = { planes: [], eye: pose, cover: null };
  /** What the frame's shot asks, written each frame for the renderer to read at once. */
  const shotSay: RenderShot = { fov: null, centre: null, coverAtEye: false };
  /** The way the ground cloud stands off, as the renderer is handed it: made again only when the way is another. */
  let cloudWay: WayDown | null = null;
  let cloudWayPath: RenderCloudPath | null = null;

  const side: RenderSide<WorldState, PlayerState> = {
    look,
    wildlife,

    lights(scene: SceneContext) {
      wornLamps = createWornLamps(scene, othersSeen);
    },
    early({ engine, scene }) {
      wayLight = forest === null ? null : createLiteWayLight(engine, scene, wayPath, jobs, uploads);
      // The way's mist as a field of its own where no chain marches the ground cloud.
      wayField = forest === null || chained ? null : createLiteWayField(engine, scene, uploads);
    },
    masked({ engine, scene, mask: made }) {
      mask = made;
      // The crowd's figures are shadows from the mask, and their eyes: none in a world with no mask.
      crowdCards = made === null ? null : createLiteCrowdCards(engine, scene, CROWD_MOST_ANY, uploads);
      crowdEyes = made === null ? null : createLiteCrowdEyes(engine, scene, CROWD_MOST_ANY, uploads);
      if (made !== null && crowdCards !== null) made.addCards(crowdCards.mesh, crowdCards.maskMaterial);
    },
    late({ engine, scene, shared, mask: made, air, wetAt, ahead, skinClock, hardCover }) {
      if (forest === null) return;
      entities = createEntityMeshes(engine, scene, { wet: wetAt(0), air, shared, clock: skinClock, hollows: true, uploads, mask: made });
      const graph = activeTerrainVariant().trailGraph?.(forest.seed) ?? null;
      const at = graph === null ? null : droppedCapAt(graph, forest.seed);
      if (at !== null) cap = createCapMesh(engine, scene, at, elevationAt(forest.seed, at.x, at.z), air, uploads);
      scenery = createLiteScenery(engine, scene, { wet: wetAt(WET_CAP.prop), air, ahead, shared, linear: chained, uploads, cover: hardCover });
    },
    stood() {
      if (way !== null && wayHeightAt !== null) wayLight?.setWay(way, wayHeightAt);
    },
    releaseBodies() {
      scenery?.dispose();
      cap?.dispose();
      entities?.dispose();
      scenery = null;
      cap = null;
      entities = null;
    },
    release() {
      wornLamps?.dispose();
      crowdEyes?.dispose();
      crowdCards?.dispose();
      wayField?.dispose();
      wayLight?.dispose();
      wornLamps = null;
      crowdEyes = null;
      crowdCards = null;
      wayField = null;
      wayLight = null;
      mask = null;
    },
    ready: () => entities?.ready,
    waiting: () => entities?.waiting() ?? 0,
    rebuilding: () => wornLamps?.rebuilding ?? false,

    begin(state, localId, alpha, dt) {
      othersSeen = Math.max(othersSeen, state.players.size - (state.players.has(localId) ? 1 : 0));
      // Where every body stands this frame, before the frame's scene is stepped, which reads where the others are
      // drawn. Who the scene then shows or hides is taken up in `shot`, in this same frame.
      bodies = host.stands() && entities !== null ? poses.step(state, localId, alpha, dt, entities.models) : null;
      // The chase's killers that are drawn as shadows this frame: figures among the crowd's, where their bodies stand.
      killers.step(bodies === null ? NO_BODIES : bodies.hollows, crowdSeconds);
      // The death's dark as the last frame posed it: the passes read it a frame late.
      darkWas = play.close;
      playNow = null;
    },
    lampOn: (local) => local.lamp.on,
    shot(seconds, eye, local, state, localId, alpha) {
      // The scenes and the endings, from the eye just placed (`scenePlay.ts`): the summit's scene or the cap's,
      // the end scene with its car, the death's fall; each takes the camera from the one before, with its lens.
      const now = play.step(seconds, eye, local, state.players, (id) => poses.drawnAt(id));
      playNow = now;
      // Who the shot shows: the local hiker's own body while the camera stands elsewhere, posed again at once.
      bodies = bodiesInShot(poses, bodies, now, state, localId, alpha, host.stands() ? (entities?.models ?? null) : null);
      // The end scene follows whoever runs for the car: the world is built round them.
      const shownId = play.runnerId();
      const shown = shownId === undefined ? undefined : state.players.get(shownId);
      // The end scene's camera goes down the road from the player: the rain's cover goes with it.
      shotSay.fov = now.fov;
      shotSay.centre = shown === undefined ? null : shown.pos;
      shotSay.coverAtEye = now.endRun;
      return shotSay;
    },
    lamp({ at, lit }) {
      if (playNow === null) return;
      if (playNow.lamp === "car") {
        const stands = playNow.carLamp;
        at.x = stands.x;
        at.y = stands.y;
        at.z = stands.z;
        at.dx = stands.dx;
        at.dy = stands.dy;
        at.dz = stands.dz;
        at.angle = HEADLAMP_CONE;
        at.range = HEADLAMP_RANGE;
        lit.state = carLamp;
        lit.on = true;
      } else if (playNow.lamp === "body") {
        // Worn at the eye of the body as this frame stands it, from the shot's first frame: off only while no body is drawn for it.
        const worn = bodies?.players.find((body) => body.local && body.hidden === null);
        lit.on = worn !== undefined;
        if (worn !== undefined) {
          at.x = worn.eyeX;
          at.y = worn.eyeY;
          at.z = worn.eyeZ;
          at.dx = worn.aimX;
          at.dy = worn.aimY;
          at.dz = worn.aimZ;
        }
      } else if (playNow.lensDark) lit.on = false;
    },
    afterAir(seconds) {
      if (wayLight === null) return;
      const wayMist = cloudColourUnder(host.nearColour());
      wayLight.update(wayLevel, 1 / wayDimAt(wayLevel), wayMist, seconds, look.cast);
      wayField?.update(pose, wayLevel, wayMist, seconds, look.cast, way, wayHeightAt);
    },
    bodies(dt, lampState) {
      if (entities === null || bodies === null) return;
      entities.update(bodies, dt);
      wornLamps?.update(entities.lamps(), lampState);
    },
    seen(planes, cover) {
      // The cap while the view's planes hold it.
      cap?.seen(planes);
      // The scenery placed once, while the view holds it; what of it is cover, too, on a frame that draws the cover map.
      if (scenery !== null) {
        sceneryView.planes = planes;
        sceneryView.cover = cover;
        scenery.update(sceneryView);
      }
    },
    cloudPath() {
      const over = way !== null && wayLevel > 0 ? way : null;
      if (over === null) return null;
      if (over !== cloudWay || cloudWayPath === null) {
        cloudWay = over;
        cloudWayPath = { distance: (x, z) => wayDistanceWithin(over, x, z, WAY_MIST_FADE_M), edge: WAY_MIST_EDGE_M, fade: WAY_MIST_FADE_M };
      }
      return cloudWayPath;
    },
    stare(state, localId, eye, axes, dt) {
      const starer = state.players.get(localId);
      const stare = starer !== undefined && starer.health > 0 ? starer.stare : 0;
      // Which side of the view the nearest Hollow the stare is held on stands to: the dark closes from there.
      let towards: { x: number; y: number; cos: number } | null = null;
      if (stare > 0) {
        for (const enemy of state.enemies.values()) {
          if (!isHollow(enemy)) continue;
          const vx = enemy.pos.x - eye.x;
          const vy = enemy.pos.y - eye.y;
          const vz = enemy.pos.z - eye.z;
          const at = stareSide(vx * axes.rx + vy * axes.ry + vz * axes.rz, vx * axes.ux + vy * axes.uy + vz * axes.uz, vx * axes.fx + vy * axes.fy + vz * axes.fz);
          if (at !== null && (towards === null || at.cos > towards.cos)) towards = at;
        }
      }
      stareLens = stepStareLens(stareLens, stare, towards, dt, chaseThreat);
      // A death's closing dark rides the stare's shade (`stareWithDark`).
      return stareWithDark(stareLens, darkWas);
    },
    haze(air) {
      wayHazeInto(air, wayLevel, wayTint("material", cloudColourUnder(host.nearColour()), 1, look.cast, CHASE_TINT));
    },
    facts: () => ({ scene: playNow !== null && playNow.fov !== null, ending: play.endScene() !== null || play.close > 0, dark: play.close }),
  };

  const api: HikeRendererApi = {
    scenery: sceneryHost,
    setScene(kind, at, more, fromS = 0) {
      play.setScene(kind, at, more, fromS, host.clock() / 1000);
    },
    clearEnding(liftS = 0) {
      play.clearEnding(liftS, host.clock() / 1000);
    },
    setEnding(kind: EndingKind, scene?: EndSceneSetup) {
      play.setEnding(kind, scene, host.clock() / 1000);
    },
    endScene() {
      return play.endScene();
    },
    setHaunt(level) {
      look.haunt = Math.max(0, Math.min(1, level));
    },
    stare() {
      return stareLens;
    },
    setChase(cast) {
      look.cast = Math.max(0, Math.min(1, cast));
    },
    setUnsettle(level) {
      look.unsettle = Math.max(0, Math.min(1, level));
    },
    setMistIn(level) {
      look.mistIn = Math.max(0, Math.min(1, level));
    },
    setWay(next, heightAt) {
      way = next;
      wayHeightAt = heightAt;
      if (host.stands()) wayLight?.setWay(next, heightAt);
    },
    setWayLevel(level) {
      wayLevel = Math.max(0, Math.min(1, level));
      look.dim = wayDimAt(wayLevel);
    },
    setChaseThreat(threat) {
      chaseThreat = threat;
    },
    setCrowd(figures, seconds, shadows) {
      crowdSeconds = seconds;
      if (!host.stands() || crowdCards === null || crowdEyes === null) {
        poses.shadows = false;
        return;
      }
      poses.shadows = shadows;
      const shown = killers.shown(figures);
      const under = pose.y - CROWD_EYE_OVER_GROUND_M;
      const heights = crowdHeights(crowdGround, shown, wayHeightAt ?? (() => under), under, crowdHeightsOut);
      const tint = wayTint(wayPath, cloudColourUnder(host.nearColour()), 1 / wayDimAt(wayLevel), look.cast, CHASE_TINT);
      const cards = crowdCards.sync(shown, heights, pose, seconds, CROWD_NONE_HELD, 0, CROWD_CARDS_TO_M, tint);
      mask?.cards(cards > 0);
      crowdEyes.sync(shown, heights, pose, seconds, CROWD_NONE_HELD);
    },
  };
  return { side, api };
};
