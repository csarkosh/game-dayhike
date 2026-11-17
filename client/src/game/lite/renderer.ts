/**
 * The hike's renderer on Babylon Lite: the terrain, the forest's trees near
 * and far, the ground clutter, the blade grass, the duff and the cliffs under the
 * atmosphere and the sky's dome, the valley mist banks and the motes in the air
 * and the ground cloud marched through it, the rain with its drips, its
 * splashes and the cover it falls under, and in that world the other
 * hikers' bodies, the Hollows' eyes and their figures' shadows, the dropped cap, the animals, the
 * lakes' water with the reeds and the lilies that grow in it and the
 * insects over it, and the sea with its swell, its wind waves, its white
 * water, its swash, its lip's curl and its spray, lit by
 * the sun, the sky's fill and the sky's capture as the image-based light for
 * the hour and the weather, by the local player's headlamp and by the lamps
 * the other hikers wear, seen from the player's eye or the free camera. It
 * answers the whole of `Renderer` (`renderer.ts`), and what it does not draw
 * yet it answers as nothing (`notDrawn.ts` has the list).
 *
 * What it draws with is the game's own, computed with no engine: the
 * terrain's uniforms, tables, layers and vertex data, the forest's, the
 * clutter's and the grass's instance lists and their materials' uniforms,
 * the air's uniforms, the sky's, the lights and the lens. This module is
 * where those meet Lite: an engine, a scene, a camera, three lights, the
 * sky's dome (`skyDome.ts`) and its capture as the scene's environment
 * (`skyCapture.ts`), the terrain's two materials and their meshes,
 * the forest's buckets (`forestMeshes.ts`), the
 * clutter's (`clutterMeshes.ts`) and the cliffs' (`cliffMeshes.ts`), which
 * land as their models do, the grass's and the duff's
 * (`bladeMeshes.ts`, `duffMeshes.ts`), on the tiers that draw them, the
 * chunk props' boxes (`propMeshes.ts`) or, in a world with no forest, a
 * hand-authored level's brushes (`brushMeshes.ts`), the mist banks (`mistMeshes.ts`), the
 * motes (`motes.ts`) and the rain (`rain.ts`, `rainSplash.ts`, under the
 * cover map of `rainMap.ts`), the hikers' bodies and the Hollows' eyes
 * (`entityMeshes.ts`), the lamps the other hikers wear (`wornLamps.ts`), the
 * dropped cap (`capMesh.ts`), the animals (`wildlifeMeshes.ts`), the
 * lakes' water (`lakeMeshes.ts`), their plants (`waterPlantMeshes.ts`) and
 * their life (`waterLifeMeshes.ts`), and the sea (`seaMeshes.ts`, with the
 * wind sea's cascades of `seaFft.ts`, the lip's curl of `lipMeshes.ts` and
 * the spray of `surfSpray.ts`), over the bed's square the two waters share
 * (`waterBed.ts`), and the scenery a hike places once (`sceneryMeshes.ts`).
 *
 * **The engine is Lite's own, made from the canvas, and making it takes
 * time**: a device is asked for, the ground's images are decoded, the scene
 * is registered. So the renderer is handed back at once and stands empty
 * until that is done: `sync` places the camera and keeps the lights' and the
 * air's numbers, `drawFrame` draws nothing, and `skyReady` and `whenReady`
 * resolve only once it stands, so no start draws a frame before it. A
 * renderer that cannot be made (no WebGPU device, a shader refused) says so
 * in the console and stays empty.
 *
 * **A lost device is the hike's to answer** (`engineWatch.ts`): the renderer
 * says the loss, tells whoever watches it (`ownWatch`, which the hike's
 * ladders put on once a renderer stands) and draws nothing more; the hike
 * covers play and builds a new renderer on a new engine and a fresh canvas,
 * as it does for any engine that fails under it (`answerFailures`). Lite's
 * own recovery in place is not used. A GPU error nobody caught is said in
 * the console, the first few of them, and is not answered by a rebuild.
 *
 * **What the engine tells on Babylon.js is told here in WebGPU's terms.** A
 * shader's compile is no event in WGSL: a module is handed to the device,
 * which compiles it when a pipeline first needs it, and a pipeline made the
 * synchronous way holds the frame that asked. So `onShaderCompiled` tells
 * of each frame that asked the device for a shader module or a pipeline
 * (`deviceMakes.ts`, counted at the device's own calls), which is what the
 * hike voids when it judges the frame rate. `keepShaders` keeps nothing:
 * the device goes with the renderer. In the measurement mode `gpuTime`
 * reads the GPU's own time for the frame and for each of its tasks from
 * Lite's timers (`gpuTimeReadout.ts`), as `window.__gpuTime()` and the
 * corner's line; outside it no timestamp is written.
 *
 * **The frame is sized by the game's rule, not by the display**
 * (`frameSize.ts`): the canvas's box in CSS pixels over the tier's scaling,
 * the display's pixel ratio unread, as the game sizes it on Babylon.js, and
 * kept through a zoom made while the hike runs. Where a paint pass draws,
 * the render scale steps the frame down while the page's frames are slow
 * and back up when they have room (`renderScale.ts`), never in the
 * measurement mode. The surface is sized before anything is made for it,
 * and again by the frame drawn after the box, the ratio or the scale has
 * moved: Lite then makes the frame's own targets again at the new size,
 * and nothing else.
 *
 * **The world changes under the game's scheduler** (`syncJobs.ts`), by the
 * rules the renderer on Babylon.js gives it: a rebuild a crossing starts
 * (the rings, the patches, the forest's lists, the ground cover's) is a job
 * a shell begins in its `update`, and `sync` runs the frame's share of them
 * once every shell has seen the view, the terrain's first, in the order the
 * game's shells are handed it. A job's last slice shows its result whole.
 *
 * **What a frame hands to the GPU is counted, and the streamed part of it
 * bounded** (`frameUploads.ts`): every shell says what it hands to Lite,
 * a job's hand-over waits for a frame whose budget has room for it, and
 * the frame's record is closed once its jobs have run. In the measurement
 * mode the record of the last frame is read out as
 * `window.__frameUploads()`, beside the jobs' `window.__syncJobs()`.
 *
 * **What every material reads alike is one block** (`frameBlock.ts`): the
 * air, the wet line and the weather, the wind and the players, the eye and
 * the frame's height, and the terrain's record are written once a frame to
 * one uniform buffer every material's plugins name. A material's own
 * uniforms are written when it is made, and again only when its own values
 * change: the terrain's two when the weather moves the ground's colour.
 *
 * **The sky is drawn again as the light moves**: the dome's uniforms, and its
 * table where the sun's altitude has moved, are written for each new sky
 * state the light makes (an hour or a weather set, each frame of a fade),
 * and the six faces of its capture drawn in the same frame, before the
 * frame's own draws read them, as the game's probe is drawn again
 * (`skyProbeParams.ts`); at no other frame.
 *
 * **The see-through draws follow the opaque ones and the sky**, in the
 * places `drawOrder.ts` names for them. The motes and the mist banks are
 * handed the weather, the hour, the wind and the clock as the game's are,
 * once the sky has its first slices; what a frame writes for them is theirs
 * to decide (`mistMeshes.ts`: nothing where no bank has moved; `motes.ts`:
 * the clock while a mote is shown).
 *
 * **The ground cloud is marched once a pixel by the post chain** on the
 * tiers the game marches it on (none on low), in the far softening's pass,
 * as the game's chain marches it; a material's air marches it only on a tier
 * that has the cloud and no chain, and no other material binds its map. Its
 * density is the game's: the night's under the haunt and the chase's cast by
 * how far the mist has come in, or the level the console holds it at
 * (`setMist`, which says what is drawn). The ground it rests on is a map
 * round the eye, built again at once when the eye has left the last one's
 * middle, as the game builds it, and counted with the streamed world.
 *
 * **The rain is drawn while it falls, and costs nothing while it does
 * not.** The streaks and the drips are one draw and the splashes another,
 * last of the see-through draws, each hidden while it shows nothing; what a
 * frame writes for them is their materials' uniforms, once each, while a
 * drop or a ring is shown. On the tiers with a cover map (none on low) the
 * map is a pass of the frame's own, drawn before it and only on a frame
 * that wants it: the map has moved a step with the player, or the camera in
 * freecam, since it was last drawn, and a drop or a ring reads it. The
 * canopy's water is the rain's own count, stepped every frame, and the
 * canopy over the lens is read from the forest's field (`lensCanopy.ts`),
 * for whoever hears the drips by them.
 *
 * **The hikers, the Hollows and the animals are instances.** Where each
 * hiker and each Hollow stands, and how, is the game's own for the frame
 * (`entityPoses.ts`), stepped by the page's frame as the game steps it, and
 * the wildlife is the game's own too (`wildlifeScene.ts`), handed the
 * simulation's tick, the players' places and the director's view as the
 * game hands them (`wildlifeInputs.ts`): the animals are where and when the
 * game puts them, with the same events for whoever voices them. A skinned
 * model is baked once and every body of it is an instance of one draw a
 * primitive (`skinnedModels.ts`), all read by one clock, which is run every
 * frame and sent only on a frame that shows a skinned body: a ranger worn,
 * a pair of eyes come, a ground animal in its disc. A part that shows
 * nothing draws nothing and writes nothing: no other hiker, no ranger
 * fetched and no light made; no bird of a model in the air, its mesh
 * hidden. The local hiker's own body is drawn only in a scene's shot,
 * where the camera stands elsewhere: in a hike the camera is its eyes.
 *
 * **A lamp's light is made for a hiker, not for a seat** (`wornLamps.ts`):
 * the scene holds the lens's lamp, the sun, the fill and a spot light for
 * each other hiker there has been at once, made before the scene is
 * registered for those already there, so a hike alone lights with three.
 *
 * **A lake's water is one blended draw, last of the see-through ones**, and
 * none while no view holds its lake (`lakeMeshes.ts`). It is the game's
 * blended water (`lakePlugin.ts`, `waterWgsl.ts`): the depth of the bed
 * under each pixel from a square of heights that follows the world's
 * centre, the ripples and the rain's rings on its normal, the skin on a
 * murky lake, and where it is glass the forest's shade under the lake's
 * skyline in place of the sky's reflection, by the lake's calm at the hour
 * and under the weather's name (`setWeatherName`, through its fade). What
 * every lake reads alike rides in the frame's block; a lake's own buffer is
 * written when its calm, its shade or the bed's square moves. On the tiers
 * with a cover map the surface stands in it as open water, shown for the
 * frame that draws the map where the view does not hold it. A murky lake's
 * reeds, cattails and lilies are five instanced draws, placed once, each
 * shown while the view holds a cell of its plants (`waterPlantMeshes.ts`).
 *
 * **On the tier with a shore panorama a lake's glass reflects its shore
 * under the skyline** (`lakePanorama.ts`): the ground as one flat lit
 * colour, the far forest's billboards, the cliffs' far ring, the props and
 * the lake's plants, seen from the lake's centre in sixteen sectors, one a
 * frame, each a pass of its own drawn before the frame's and copied into
 * its column of one picture the water reads. A capture is asked for under
 * each new sky state and when something it draws lands late, as the game
 * asks, and runs only on frames whose view holds the lake's glass: with
 * no lake in view there is no pass, no copy and no write. The mirror a
 * lake reflects its shore in on the tier that draws one, and the tier that
 * reads through the surface, are not drawn yet.
 *
 * **A lake's life is the game's, stepped for the lakes within the camera's
 * reach** (`waterLifeMeshes.ts`, over `waterLifeScene.ts`): the midges one
 * draw for every swarm, its frame one buffer written while the view holds
 * a swarm in sight; the dragonflies a draw a kind with a unit in view,
 * their matrices sent when one moved; the frogs heard. Out of view neither
 * draws nor writes. Last of the see-through draws. The life
 * heard is the nearest lake's, and silent on a frame that stepped none.
 *
 * **The sea is one blended draw, before the lakes', and none while no view
 * holds water** (`seaMeshes.ts`). Its seven rings round the world's centre
 * are one lattice made once, placed by the vertex stage from where each
 * ring and its hole stand, which ride in the frame's block; a ring that
 * moves sends the depths under its vertices and nothing else. It is the
 * game's blended sea (`seaPlugin.ts`, `seaWgsl.ts`): the swell summed at
 * each vertex from the game's tables and moving it, the swash's sheet up the
 * cove's face, the water's edge on the bed and on the cove's profile, the
 * swell's normal under the ripple bump that draws the wind sea on the tier
 * with no field of it, the rain's rings, the white water through its lace,
 * the whitecaps and the plunging lip. What moves it every frame (the
 * swell's phases, the wind sea's numbers as the sea follows its wind, the
 * clock) is the frame's; the swash's table is sent on a frame that shows
 * the sea. Its edge is stepped every frame, shown or not
 * (`seaEdge.ts`): the wet ground on the cove reads the swash's table, and
 * the surf is heard by it (`surfSound`, `hasSea`). On the tiers above low
 * the wind sea is a field, moving the vertices and tilting the normal, and
 * the sea stands in the rain's cover map as open water at rest, shown for
 * the frame that draws the map where the view does not hold it. The field
 * is the loop the game bakes in a worker, its 64 frames sent once when the
 * bake lands, on the tier that bakes one.
 *
 * **On the tier that computes its wind sea each frame the field is the
 * game's FFT on Lite's compute** (`seaFft.ts`): three cascades, four
 * dispatches in one compute pass before the frame's draws, on a frame
 * whose view holds the sea and on no other; the spectrum's amplitudes go
 * up when the sea's wind has moved by a step. Which field is drawn is the
 * game's rule (`windSeaField.ts`): the cascades once they run, the baked
 * loop where they fail or are still compiling past their deadline. With
 * the cascades the plunging lip is the swept curl (`lipMeshes.ts`): a strip
 * over the cove's face, after the sea among the see-through draws, drawn
 * and sent its crests only while a crest is in mid-plunge and the view
 * holds the face. And the plunges throw the surf's spray
 * (`surfSpray.ts`): one instanced draw after the water, hidden while no
 * burst is alive. The water's surface on that tier is blended, as on the
 * tier below: the read of what lies under it through the surface is not
 * drawn yet.
 *
 * **Colour is the tier's own path** (`postFeaturesFor`). With no post chain
 * it is the material path: Lite's display curve as Babylon's image
 * processing has it there (Khronos PBR Neutral, contrast 1.1), under the
 * weather's and the hour's exposure less what the stare takes of it, with
 * the grade Babylon's image processing lays on there in every material: the
 * vignette, the colour curves that carry the weather's split-tone and the
 * chase's cast, and the dither (`materialGrade.ts`, read from the frame's
 * block by the air's plugin at the material's last point, and by the
 * dome's, the mist banks', the motes' and the rain's own stages). No pass is
 * added for it. With a chain every material
 * and every stage hands its linear colour on, unexposed, into a half-float
 * target four samples a pixel, and the chain grades the frame
 * (`postChain.ts`): the far softening, the temporal anti-aliasing and its
 * sharpen, the paint, the grade with its palette (`setPalette`), the chase's
 * cast (`setChase`), the stare's shade and the dread on the lens
 * (`setUnsettle`), and the rain on the lens while there is any. The canvas
 * then takes the grade's one sample a pixel, and the sky leaves the frame's
 * depth as nothing drawn, which the chain reads as the far sky. Lite's linear
 * output is the whole page's once it is on: a tier with no chain made in a
 * page that has drawn one lays the display curve on in its own materials
 * (`linearPage`).
 *
 * **The stare's lens is stepped on every tier** (`stare`, `stareLens.ts`):
 * from the local player's own stare and the Hollow nearest their aim, for
 * the grade's shade and for whoever voices the heartbeat.
 *
 * **The scenery a hike places once is the hike's to ask for**
 * (`hikeScenery.ts`, through `scenery`): the fingerposts at the junctions,
 * the trailhead's car and board and the body at the crest, each made when
 * the renderer stands and its models land (`sceneryMeshes.ts`). Every post
 * is an instance of one draw and every plank of another, their lettering
 * one mesh under one picture; a placed model is a mesh a material. Each is
 * drawn while the view holds it within its reach, and shown for the frame
 * that draws the rain's cover map where it stands in the map's square.
 *
 * **A scene plays on the hike's one camera** (`scenePlay.ts`): the summit's
 * five shots and the cap's turn are stepped once a frame on the player's
 * eye, after it is placed, and what comes back is the frame's camera and
 * its lens, as on Babylon.js, whose renderer steps the same play. Nothing
 * is made, built again or recorded again for a scene. The chain's passes
 * rebuild a pixel's ray from the pose the frame is drawn with, and its
 * anti-aliasing weighs its history by how far that pose has moved since
 * the last frame and clips it to the new frame's neighbourhood, so a cut is
 * a large move like any other, as it is in the game's own chain; the mask,
 * the rain and every part's test against the view read the same pose. The
 * rain's cover map and a lake's panorama have cameras of their own, which
 * no scene moves.
 *
 * **The endings are the same play.** The death takes the camera down to
 * the ground and closes its dark through the stare's shade, a frame late as
 * the game's passes read it: the grade's on a tier with a chain, the veil's
 * and the exposure's on a tier with none; undone, it lifts over the seconds
 * given. The game never softens the picture at an end (`endingPose` asks
 * for no blur), so no pass is added for one. The end scene is its four
 * shots, the local hiker's own body in the run, the other bodies at the
 * car's door hidden, the world built round the runner, the rain's cover
 * following the camera down the road, and the scenery's car stood at its
 * pose each frame (`sceneryMeshes.ts` `LiteCar`), out of the rain's cover
 * once it has left its place, its tail lamps lit at the catch. The local
 * player's one lamp is worn at the eye of their body wherever a scene shows
 * it and is the car's headlamp from the catch: one light all game, as on
 * Babylon.js, so no scene adds a light and nothing is built again for one.
 *
 * **The sun casts no shadow**: no tier of the game has a shadow map
 * (`quality.ts`), so there is no pass for one and no material reads one.
 * The dark under the parked car is a patch of the scenery's own
 * (`carShadow.ts`), the same on every tier.
 *
 * **A Hollow's figure is a shadow from a mask** (`shadeMask.ts`): its body
 * drawn through its smoke into a target of its own, on the frames with a
 * figure in it, from the bodies its eyes are drawn from. With a chain the
 * grade reads the mask; with none the veil does (`shadeVeil.ts`): one
 * triangle multiplied into the frame, last of the see-through draws, with
 * the stare's darkness, hidden while there is neither.
 */
import {
  NeutralToneMapping, addToScene, createBankedFreeCamera, createTexture2DFromPixels, createDirectionalLight, createEngine, createHemisphericLight, createPbrMaterial, createSpotLight,
  createPluginUniformBlock, createSceneContext, disposeEngine, disposeScene, enableMaterialPlugins, enablePbrLinearOutput, enablePbrMaterialPluginVertexData,
  getProjectionMatrix,
  markLightDirty, markMaterialUboDirty, onEngineDeviceLost, onEngineGpuError, registerScene, renderFrame, setSurfaceSize, vec3,
  writePluginUniformBlock,
  type BankedFreeCamera, type DirectionalLight, type EngineContext, type HemisphericLight, type MaterialPlugin, type PbrMaterialProps,
  type PluginUniformBlock, type SceneContext, type SpotLight,
} from "@babylonjs/lite";
import { MAX_PLAYERS, PLAYER_EYE_OFFSET } from "../../sim/constants.js";
import type { Forest } from "../../sim/forest.js";
import { FOG_DISTANCE } from "../../sim/forestConstants.js";
import type { Level } from "../../sim/level.js";
import { activeTerrainVariant, elevationAt, type LakeSource } from "../../sim/terrain.js";
import type { ListenerPose } from "../ambientAudio.js";
import { GRADIENT_MID_STEP, atmosphereUniforms, emptyAtmosphereUniforms, fogGradientAt } from "../atmosphereParams.js";
import { BASE_SPACING_BY_TIER } from "../clipmap.js";
import { clutterReachFor } from "../clutterField.js";
import { cloudDensityNow, cloudFor, cloudGroundDue, cloudGroundMap, cloudMarchSteps, cloudOn, cloudStepsFor, cloudUniforms, emptyCloudUniforms, noCloud } from "../cloudParams.js";
import type { EngineHandle } from "../engineHandle.js";
import { createDeviceMakes, type MakesDevice } from "../deviceMakes.js";
import { createEngineWatch } from "../engineWatch.js";
import { HEADLAMP_CONE, HEADLAMP_INTENSITY, HEADLAMP_RANGE } from "../endScene.js";
import { createEntityPoses, type EntityFrame } from "../entityPoses.js";
import { blendedEye, type EyePose } from "../eyeBlend.js";
import { FACE_PATCH_Z_OFFSET, FACE_PATCH_Z_UNITS } from "../facePatches.js";
import { featureTableFor } from "../featureTable.js";
import { FOLIAGE_PLAYERS, FOLIAGE_PLAYER_PARKED, setFoliageWind } from "../foliageUniforms.js";
import { createFrameFit } from "../frameSize.js";
import { nearRadiusFor } from "../forestField.js";
import { GAME_FOV, lensProjection } from "../gameLens.js";
import { PAINT_PALETTES, gradeRecordUnder, sightUnder, type PaintPaletteName } from "../gradeParams.js";
import { brushBoxes } from "../propBoxes.js";
import { emptyMaterialGradeUniforms, materialGradeUniforms } from "../materialGrade.js";
import { isHollow } from "../../sim/hollow.js";
import { LAMP_ANGLE, LAMP_COLOUR, LAMP_EXPONENT, LAMP_RANGE, lampPlace, lampUnder, type LampState } from "../lampParams.js";
import { createCalmFade } from "../lakeCalmFrame.js";
import { createLakeChoice } from "../lakeChoice.js";
import { createLensCanopy } from "../lensCanopy.js";
import { lensSmooth, lensStrengthUnder } from "../lensParams.js";
import { droppedCapAt } from "../droppedCap.js";
import type { CullPose } from "../grassCull.js";
import { writeListenerPose } from "../listenerPose.js";
import { sharedSeconds } from "../oceanWindSea.js";
import type { PostView } from "../postFrame.js";
import { shadeSmokeSeconds } from "../shadeMaskParams.js";
import { postFeaturesFor } from "../postParams.js";
import { fittingBed, fittingFeatureTable, fittingLake, fittingOcean, fittingRings, fittingWaterBump, fittingWaterRings } from "../preparedScene.js";
import { QUALITY, detectTier } from "../quality.js";
import type { RainLamp } from "../rainField.js";
import { RAIN_MAP } from "../rainParams.js";
import { renderScaleRuns } from "../renderScale.js";
import type { FreecamView, Renderer, RendererOptions } from "../renderer.js";
import { createScenePlay, stareWithDark, type EndSceneSetup, type PlayNow } from "../scenePlay.js";
import type { EndingKind } from "../ending.js";
import { emptySeaFrameUniforms } from "../seaUniforms.js";
import { startSkySource, type SkySource } from "../skyWorker.js";
import { createSprayThrow, type SprayLight } from "../sprayField.js";
import { SILENT_SURF_SOUND, createSurfSound, fillSurfSound, type SurfSound } from "../surfSound.js";
import type { SkyState } from "../skyState.js";
import { STARE_LENS_REST, stareShadeUnder, stareSide, stepStareLens, type StareLens } from "../stareLens.js";
import { DEFAULT_HOUR, sunAltitudeDeg, whenSkyHeld } from "../skyWait.js";
import { createSyncJobs, finish, stepSlices, type SyncJobs } from "../syncJobs.js";
import { followRoadCentre, terrainTablesFor, type TerrainTables } from "../terrainTables.js";
import { terrainCoverFor, terrainSurfaceUnder, terrainUniforms, type TerrainUniformInputs } from "../terrainUniforms.js";
import { createViewBob } from "../viewBob.js";
import { wetSurfaceUnder } from "../weather.js";
import { createWildlifeInputs } from "../wildlifeInputs.js";
import { wingTime } from "../wingParams.js";
import { WATER_ROWS, lakeWaterRow } from "../waterShading.js";
import { SILENT_WATER_LIFE, createPlayerSlots, pixelAtOneMetre, skyLumaOf } from "../waterLifeInputs.js";
import type { WaterLifeFrame } from "../waterLifeScene.js";
import { emptyWaterFrameUniforms } from "../waterSurface.js";
import { WET_CAP, emptyWetUniforms, setWetCove, setWetSwash, setWetWeather, wetLineFor, wetUniforms, type WetBody, type WetUniforms } from "../wetSurface.js";
import { windRecordUnder, type WindRecord } from "../windParams.js";
import { atmospherePlugin } from "./atmospherePlugin.js";
import { createBladeMeshes, type BladeMeshes } from "./bladeMeshes.js";
import { createLiteBrushes, type LiteBrushes } from "./brushMeshes.js";
import { cameraAxes, projectToCanvas, restAxes, restPlanes, viewCorners, viewPlanes, type CameraPose } from "./cameraPose.js";
import { createCapMesh, type CapMesh } from "./capMesh.js";
import { createCliffMeshes, type CliffMeshes } from "./cliffMeshes.js";
import { createClutterMeshes, type ClutterMeshes } from "./clutterMeshes.js";
import { createDuffMeshes, type DuffMeshes } from "./duffMeshes.js";
import { createEntityMeshes, type EntityMeshes } from "./entityMeshes.js";
import { createForestMeshes, type ForestMeshes } from "./forestMeshes.js";
import { FADE_ROWS_NAME, FRAME_BLOCK, FRAME_FIELDS, FRAME_PROJECTION_NAME, writeFrameBlock, type FrameValues, type StageRecord } from "./frameBlock.js";
import { createFrameUploads, uploadCountsCopy, type FrameUploadCounts } from "./frameUploads.js";
import { createLiteGpuTime } from "./gpuTimeReadout.js";
import { GROUND_IMAGES, cloudMapTexture, loadGroundArrays, tableTexture, type CloudMapTexture, type TableTexture } from "./groundTextures.js";
import { createLiteLakes, type LakeFrame, type LiteLakes } from "./lakeMeshes.js";
import { createLitePanorama, type LitePanorama, type ReflectionRegistry } from "./lakePanorama.js";
import { createLiteMistMeshes, type LiteMistMeshes, type MistFrame } from "./mistMeshes.js";
import { createLiteMotes, type LiteMotes, type MotesFrame } from "./motes.js";
import { notDrawnMembers } from "./notDrawn.js";
import { createLitePostChain, type LitePostChain } from "./postChain.js";
import { createLiteShadeMask, type LiteShadeMask } from "./shadeMask.js";
import { createLiteShadeVeil, type LiteShadeVeil } from "./shadeVeil.js";
import { createPropMeshes, type PropMeshes } from "./propMeshes.js";
import { createLiteRain, type LiteRain, type RainFrame } from "./rain.js";
import { createLiteRainMap, type CoverRegistry, type LiteRainMap } from "./rainMap.js";
import { createLiteRainSplash, type LiteRainSplash, type SplashFrame } from "./rainSplash.js";
import { createLiteScenery, deferredScenery, type LiteCar, type LiteScenery, type SceneryHost, type SceneryView } from "./sceneryMeshes.js";
import { createLiteSeaFft } from "./seaFft.js";
import { createLiteSea, seaLookFor, type LiteSea, type SeaFrame } from "./seaMeshes.js";
import { createSkinClock, type SkinClock } from "./skinnedModels.js";
import { SKY_CAPTURE_BYTES, createLiteSkyCapture, type LiteSkyCapture } from "./skyCapture.js";
import { createLiteSkyDome, type LiteSkyDome } from "./skyDome.js";
import { createLiteSurfSpray, type LiteSurfSpray } from "./surfSpray.js";
import { createTerrainMeshes, type TerrainMeshes } from "./terrainMeshes.js";
import { createLiteWaterBed, type LiteWaterBed } from "./waterBed.js";
import { createLiteWaterLife, type LiteWaterLife } from "./waterLifeMeshes.js";
import { createLiteWaterPlants, type LiteWaterPlants } from "./waterPlantMeshes.js";
import { createLiteWildlifeMeshes, type LiteWildlifeMeshes } from "./wildlifeMeshes.js";
import { emptyTerrainMaterialUniforms, terrainPlugin, terrainSplitPlugin, terrainWetPlugin } from "./terrainPlugins.js";
import { createWorldLight } from "./worldLight.js";
import { createWornLamps, type WornLamps } from "./wornLamps.js";

/**
 * Whether a renderer of this page has drawn a tier with a post chain. Lite's
 * linear output is the whole page's and stays on, so a tier with no chain
 * made after it lays the display curve on in its own materials
 * (`atmospherePlugin`'s `curve`).
 */
let linearPage = false;

/** The display curve's contrast on the material colour path, as the lighting sets Babylon's. */
const DISPLAY_CONTRAST = 1.1;

/** How far ahead of the eye the point the camera looks at is put, metres. */
const LOOK_AHEAD = 10;

/** GPU errors said in the console before the rest are left out: one broken
 * shader reports again every frame. */
const GPU_ERRORS_SAID = 8;

/**
 * The steepest angle from facing the eye the slope-scaled depth offset is worked out at. Past it the vertex normal
 * overstates the slope of the polygons that are drawn, and a patch came ahead of ground the game on Babylon.js draws
 * over it: at 82 degrees Lite stood nearest that renderer across a lake's bank, the trailhead and the forest (89 and 75
 * were tried).
 */
export const DEPTH_AHEAD_MAX_DEGREES = 82;
const DEPTH_AHEAD_MIN_COS = Math.cos((DEPTH_AHEAD_MAX_DEGREES * Math.PI) / 180);

/**
 * A depth offset toward the eye, for a surface drawn over another it lies
 * on: the steep ground's patches over the rings. Lite's PBR material has no
 * depth bias, so the vertex stage moves the clip-space depth itself, as
 * Babylon's two halves do. The constant half is `units` of a 24-bit depth
 * buffer's steps (`zOffsetUnits`). The slope-scaled half (`zOffset`) is
 * `slope` times the depth a pixel's step crosses on the surface, which the
 * rasteriser takes from each polygon and a vertex stage has to work out:
 * on a surface turned from the eye by an angle the view's depth changes by
 * its tangent times the depth times a pixel's angle, and the depth buffer's
 * value by that over the depth squared times the projection's constant
 * term. The angle is the vertex normal's, so it is a smooth surface's
 * slope and not each polygon's own, and it is held under
 * `DEPTH_AHEAD_MAX_DEGREES`. Without the slope's half a patch seen at a low
 * angle from near by stands only millimetres ahead of the ground under it,
 * whose coarser triangles show through in whole polygons. Lite's depth
 * runs from 1 at the near plane to 0 far away, so toward the eye is up.
 */
export function depthAheadPlugin(units: number, slope = 0): MaterialPlugin {
  const ahead = units / 2 ** 24;
  const constant = `out.clipPos.z+=${ahead.toExponential(6)}*out.clipPos.w;`;
  const sloped = `{let daC=clamp(abs(dot(normalize(out.worldNormal),normalize(scene.vEyePosition.xyz-out.worldPos))),${DEPTH_AHEAD_MIN_COS.toExponential(6)},1.0);`
    + `let daP=${FRAME_BLOCK}.${FRAME_PROJECTION_NAME};`
    + `out.clipPos.z+=${slope.toExponential(6)}*abs(daP[3].z)*sqrt(1.0-daC*daC)/daC*2.0/(abs(daP[1].y)*${FRAME_BLOCK}.${FADE_ROWS_NAME});}`;
  return {
    name: "DepthAhead",
    priority: 950,
    defines: slope === 0 ? { units } : { units, slope },
    getCustomCode: (stage) => (stage === "vertex" ? { CUSTOM_VERTEX_MAIN_END: slope === 0 ? constant : constant + sloped } : null),
  };
}

/** What stands once the renderer is made: Lite's engine and scene, and what is drawn in it. */
type Standing = {
  engine: EngineContext;
  scene: SceneContext;
  camera: BankedFreeCamera;
  sun: DirectionalLight;
  fill: HemisphericLight;
  /** The local player's headlamp, on the lens (`headlamp.ts`). */
  lamp: SpotLight;
  /** The sky's dome, drawn behind everything (`skyDome.ts`). */
  dome: LiteSkyDome;
  /** The dome's capture, the scene's image-based light (`skyCapture.ts`). */
  capture: LiteSkyCapture;
  /** The frame's block: what every material reads alike, written once a frame (`frameBlock.ts`). */
  shared: PluginUniformBlock;
  /** The post chain, on the tiers with one (`postChain.ts`). */
  chain: LitePostChain | null;
  /** The mask the haunt's figures are drawn into (`shadeMask.ts`), which the chain's grade reads. */
  mask: LiteShadeMask | null;
  /** The veil that lays the mask and the stare's shade over the frame on a tier with no chain (`shadeVeil.ts`). */
  veil: LiteShadeVeil | null;
  materials: PbrMaterialProps[];
  terrain: TerrainMeshes | null;
  road: TableTexture | null;
  /** The ground cloud's map, which the ground round the eye is laid into (`groundTextures.ts`). */
  cloudGround: CloudMapTexture | null;
  forest: ForestMeshes | null;
  blades: BladeMeshes | null;
  clutter: ClutterMeshes | null;
  duff: DuffMeshes | null;
  cliffs: CliffMeshes | null;
  props: PropMeshes | null;
  /** A hand-authored level's brushes (`brushMeshes.ts`); null in a forest's world, which draws terrain in their place. */
  brushes: LiteBrushes | null;
  /** The valley mist banks (`mistMeshes.ts`). */
  mist: LiteMistMeshes | null;
  /** The motes, on the tiers that draw them (`motes.ts`). */
  motes: LiteMotes | null;
  /** The rain's streaks and drips (`rain.ts`). */
  rain: LiteRain;
  /** The rain's cover map and the splashes that land on it, on the tiers that draw them (`rainMap.ts`, `rainSplash.ts`). */
  rainMap: LiteRainMap | null;
  /** The shore panorama a lake's glass reflects, on the tier that draws one (`lakePanorama.ts`); null with no lake. */
  panorama: LitePanorama | null;
  splash: LiteRainSplash | null;
  /** The clock every skinned model's clips are read by (`skinnedModels.ts`). */
  skinClock: SkinClock;
  /** The hikers' bodies and the Hollows' eyes (`entityMeshes.ts`), and the lamps the other hikers wear (`wornLamps.ts`). */
  entities: EntityMeshes | null;
  wornLamps: WornLamps;
  /** The missing hiker's cap, beside the trail (`capMesh.ts`). */
  cap: CapMesh | null;
  /** The animals (`wildlifeMeshes.ts`). */
  wildlife: LiteWildlifeMeshes | null;
  /** The scenery a hike places once: the fingerposts, the trailhead's car and board, the body at the crest (`sceneryMeshes.ts`). */
  scenery: LiteScenery | null;
  /** The bed's square every body of water reads its depth from (`waterBed.ts`), and the sea (`seaMeshes.ts`); null in a world with no sea level. */
  bed: LiteWaterBed | null;
  sea: LiteSea | null;
  /** The surf's spray, on the tier that draws it (`surfSpray.ts`), and the rule that throws a burst at a plunge; null elsewhere. */
  spray: { drawn: LiteSurfSpray; thrown: ReturnType<typeof createSprayThrow> } | null;
  /** The lakes' water (`lakeMeshes.ts`); null in a world with no lake. */
  lakes: LiteLakes | null;
  /** The lakes' reeds and lilies (`waterPlantMeshes.ts`); null in a world with no lake. */
  waterPlants: LiteWaterPlants | null;
  /** Each lake's midges, dragonflies and frogs (`waterLifeMeshes.ts`), by its place in the list; none in a world without them. */
  waterLives: LiteWaterLife[];
};

/**
 * A hike's renderer on `canvas` for `forest`'s world (null: a hand-authored
 * level, whose brushes are drawn under the same sky, air and light). Of `options` it reads the tier, the
 * clock, the start, the prepared scene's rings and feature table, whether
 * the rings' first build is deferred, the loader of first builds, the
 * measurement mode and the sky's table; the rest belong to parts not drawn
 * yet. It makes its own engine: one handed in is refused.
 */
export function createLiteRenderer(canvas: HTMLCanvasElement, level: Level, forest: Forest | null, options: RendererOptions = {}): Renderer {
  if (options.engine !== undefined) throw new Error("the hike's renderer makes its own engine from its canvas: none is handed to it");

  const tier = options.tier ?? detectTier(globalThis.navigator);
  const clock = options.clock ?? (() => performance.now());
  /** When the renderer was made, on its clock (ms): the shades' smoke rises from then. */
  const madeAt = clock();
  const lens = lensProjection();
  const { members: absent } = notDrawnMembers();

  // The sky's slices: the page's table or, given none, a source of this renderer's own.
  let ownSky: SkySource | null = null;
  if (options.skyTable === undefined) ownSky = startSkySource(sunAltitudeDeg(DEFAULT_HOUR));
  const skyTable = options.skyTable ?? (ownSky as SkySource).table;
  const light = createWorldLight(skyTable, FOG_DISTANCE);

  // What the terrain is drawn with, each one record filled in place a frame.
  const prepared = options.prepared?.tier === tier ? options.prepared : null;
  const featureTable = forest === null ? null : fittingFeatureTable(prepared, forest.seed) ?? featureTableFor(forest.seed);
  const tables: TerrainTables = forest === null ? { road: null, trail: null, features: null } : terrainTablesFor(forest.seed, featureTable);
  const cover = terrainCoverFor(tier);
  const drawnWith: TerrainUniformInputs = {
    eye: null, wetness: 0, rain: 0, seconds: 0,
    // The sward floor is the shaded ground between the blades: it runs on the tiers that draw them.
    sward: tier !== "low",
    relief: true,
    road: tables.road, trail: tables.trail, features: tables.features,
  };
  const terrainValues = emptyTerrainMaterialUniforms();
  const wetValues = emptyWetUniforms();
  // The wet look on the scenery's materials, a record a porosity cap: the cap is a material's own, and the rest of
  // the look is the frame's (`frameBlock.ts`), written from the terrain's record above.
  const wetByCap = new Map<number, WetUniforms>();
  const wetAt = (cap: number): WetUniforms => {
    let record = wetByCap.get(cap);
    if (record === undefined) {
      record = emptyWetUniforms();
      record.wetCap[0] = cap;
      wetByCap.set(cap, record);
    }
    return record;
  };
  const forestWet = { leaf: wetAt(WET_CAP.leaf), bark: wetAt(WET_CAP.bark), deadwood: wetAt(WET_CAP.deadwood) };
  /** The frame drawn into, in the engine's pixels: the forest's dither is laid on its rows. */
  const frameSize = { height: canvas.height };
  /** The players that bend the foliage, xyz each: a slot with no player is parked far off. */
  const windPlayers = new Float32Array(FOLIAGE_PLAYERS * 3);
  const airValues = emptyAtmosphereUniforms();
  // The ground cloud (`cloudParams.ts`): the night's mist as a volume the air's plugin marches through in each
  // material, on the tiers the game marches it on, resting on a map of the ground round the eye.
  let cloud = noCloud();
  // Who owns colour: a tier with a post chain draws its scene in linear light for the chain to grade; the rest end
  // every material with the display curve. Half-float targets are every WebGPU device's, so the tier alone decides.
  const postFeatures = postFeaturesFor(tier, true);
  const chained = postFeatures.pipeline;
  const cloudSteps = forest !== null ? cloudStepsFor(postFeatures) : 0;
  /** The cloud as the chain marches it (`cloudUniforms`): the materials march none where there is a chain. */
  const chainCloud = emptyCloudUniforms();
  /** The camera as the chain's passes rebuild a pixel's ray from it, filled in place a frame. */
  const postView: PostView = { eye: { x: 0, y: 0, z: 0 }, forward: { x: 0, y: 0, z: 1 }, right: { x: 1, y: 0, z: 0 }, up: { x: 0, y: 1, z: 0 }, fov: lens.fov, aspect: 1 };
  /** The rain on the lens, smoothed (`lensParams.ts`), and the local player's stare as their screen and ears take it (`stareLens.ts`). */
  let lensStrength = 0;
  let stareLens: StareLens = STARE_LENS_REST;
  /** The stare as the frame shows it: a death's closing dark rides its shade (`stareWithDark`). */
  let shownStare: StareLens = STARE_LENS_REST;
  /** The frame's exposure as shown: the weather's and the hour's, less what the stare takes of it where no chain's grade does (`sightUnder`). */
  const shownExposure = (): number => (chained ? light.exposure : light.exposure * sightUnder(shownStare.level));
  /** The material path's grade for the frame (`materialGrade.ts`), filled in place. */
  const gradeValues = emptyMaterialGradeUniforms();
  /** The chase's cast (`escalation.ts`) and how far the dread reaches the lens (`/unsettle`), as the app last set them. */
  let chaseCast = 0;
  let unsettle = 1;
  /** The painted palette asked for before the chain stood: worn at once when it does. */
  let palette: { name: PaintPaletteName; fadeSeconds?: number } | null = null;
  /** Where the ground's map is centred; none before its first build. */
  let cloudGroundAt: { x: number; z: number } | null = null;
  /** The density the console holds the cloud at, the density last drawn, how far the mist has come in and the haunt's level. */
  let cloudHold: number | null = null;
  let cloudDensity = 0;
  let mistIn = 0;
  let hauntLevel = 0;
  /** What the frame's block is written from: the records above, the eye and the frame's height. */
  const frameValues: FrameValues = {
    air: airValues, wet: wetValues, terrain: terrainValues, eye: { x: 0, y: 0, z: 0 }, rows: canvas.height, wingTime: 0, water: emptyWaterFrameUniforms(),
    exposure: light.exposure, contrast: DISPLAY_CONTRAST, clocks: [],
    sea: emptySeaFrameUniforms(),
  };
  /** The ground's colour and roughness the terrain's materials were last written with. */
  const groundWritten = { r: Number.NaN, g: Number.NaN, b: Number.NaN, roughness: Number.NaN };

  // A forest world has water exactly when its variant declares a sea level: the sea, and the lakes the variant lists.
  const waterLevel = forest === null ? undefined : activeTerrainVariant().waterLevel;
  const lakes: readonly LakeSource[] =
    forest !== null && waterLevel !== undefined
      ? (activeTerrainVariant().waterBodies?.(forest.seed).filter((body): body is LakeSource => body.kind === "lake") ?? [])
      : [];
  // The wet line follows the nearest body, sea or lake, whichever is drawn.
  const wetBodies: WetBody[] = [];
  if (waterLevel !== undefined) {
    wetBodies.push({ ...WATER_ROWS.sea, level: waterLevel, x: 0, z: 0, radius: Number.POSITIVE_INFINITY, bound: Number.POSITIVE_INFINITY });
  }
  for (const lake of lakes) {
    wetBodies.push({ ...lakeWaterRow(lake.murk), level: lake.level, x: lake.x, z: lake.z, radius: lake.shape.shoreMax, bound: lake.bound });
  }
  /** The weather's preset as the lakes' calm follows it (`lakeCalmFrame.ts`): `setWeatherName`. */
  const calmFade = createCalmFade();
  /** The sun and the fill as the spray takes its colour from them, refilled each frame it is aged. */
  const sprayLights: SprayLight[] = [];
  /** What a frame hands the sea (`SeaFrame`), filled in place. */
  const seaFrame: SeaFrame = { centreX: 0, centreZ: 0, planes: [], corners: new Float32Array(24), seconds: 0, dt: 0, wind: windRecordUnder(light.weather, 0), hour: light.hour, cover: null };
  /** The surf as heard, one record refilled each frame (`surfSound.ts`), and whether this frame's `sync` stepped it: the sound of a frame that did not is silence. */
  const surf: SurfSound = createSurfSound();
  let surfStepped = false;
  /** What a frame hands the lakes (`LakeFrame`), filled in place. */
  const lakeFrame: LakeFrame = {
    eye: { x: 0, y: 0, z: 0 }, forward: { fx: 0, fy: 0, fz: 1 }, planes: [], seconds: 0, dt: 0, weather: light.weather,
    wind: windRecordUnder(light.weather, 0), hour: light.hour, sky: null, environmentIntensity: 0, frameHeight: canvas.height, fov: lens.fov, cover: null,
  };
  /** The square the cover map is drawn over, where a frame draws it. */
  const coverSquare = { x: 0, z: 0, half: RAIN_MAP.extent / 2 };
  /** Whether this frame draws the rain's cover map. */
  let coverDrawn = false;
  /** Whether this frame draws a sector of a lake's shore panorama. */
  let shoreDrawn = false;

  // The view: where the camera stands and how it is turned, as `sync` last left it.
  const pose: CameraPose = { x: 0, y: 2, z: 0, yaw: 0, pitch: 0, roll: 0 };
  const axes = restAxes();
  let fov = lens.fov;
  /** The camera's pose as the grass is cut to it (`grassCull.ts`): filled in place a frame. */
  const cullPose: CullPose = { x: 0, y: 0, z: 0, yaw: 0, pitch: 0, roll: 0, fov: lens.fov, aspect: 1 };
  let freecam: FreecamView | null = null;
  const bob = createViewBob();
  const eyeScratch: EyePose = { x: 0, y: 0, z: 0, yaw: 0, pitch: 0 };
  const listenerPose: ListenerPose = { x: 0, y: 0, z: 0, fx: 0, fy: 0, fz: 1, ux: 0, uy: 1, uz: 0 };
  let wind: WindRecord = windRecordUnder(light.weather, 0);
  let windOverride: number | null = null;
  /** When the weather's fade was last stepped, on the renderer's clock (ms). */
  let steppedAt: number | null = null;

  // The rebuilds a crossing starts run as jobs over the frames after it, under the game's per-frame budget
  // (`syncJobs.ts`): `sync` runs this frame's share once every shell has seen the view.
  const jobs = createSyncJobs(() => performance.now());
  // The measurement mode (`?gpuTime`): the jobs' record of the last frame, read out as `window.__syncJobs()` as the
  // renderer on Babylon.js gives it. A copy each time: the record is written in place every frame.
  const measured = globalThis as { __syncJobs?: () => SyncJobs["last"]; __frameUploads?: () => FrameUploadCounts };
  if (options.gpuTime === true) measured.__syncJobs = () => ({ ...jobs.last, owners: { ...jobs.last.owners } });
  // What each frame hands to the GPU, and the budget its streamed part is held to (`frameUploads.ts`); the last
  // frame's record is read out beside the jobs', a copy each time too.
  const uploads = createFrameUploads();
  if (options.gpuTime === true) measured.__frameUploads = () => uploadCountsCopy(uploads.last);

  let disposed = false;
  /** The device has failed (`abandon`): the forest's bakes are ended, and a forest made after bakes none. */
  let abandoned = false;
  let standing: Standing | null = null;
  /** The light's version the lights and the cleared frame were last written for. */
  let litVersion = -1;
  /**
   * The local player's one lamp as the frame lights it. On the lens through a hike: on while the player's is, at the
   * weather's state (`lampUnder`). Worn at the eye of the local body wherever a scene shows it, lit for the shot
   * whether the player's was or not; dark in the end scene, whose camera is not the eye; and from the catch the car's
   * headlamp, at its nose, as bright as its two lamps and with no dread in it. One light for all of it, so the lights
   * every material reads are the same all game. `at` is where it stands and how it points, and what the light was
   * last written with is beside it.
   */
  const lensLamp: { on: boolean; state: LampState } = { on: false, state: lampUnder(light.weather, 0) };
  const lampAt = { x: 0, y: 0, z: 0, dx: 0, dy: 0, dz: 1, angle: LAMP_ANGLE, range: LAMP_RANGE };
  const carLamp: LampState = { intensity: HEADLAMP_INTENSITY, colour: { r: LAMP_COLOUR[0], g: LAMP_COLOUR[1], b: LAMP_COLOUR[2] } };
  const lampWritten = { intensity: Number.NaN, r: 0, g: 0, b: 0, x: 0, y: 0, z: 0, dx: 0, dy: 0, dz: 0, angle: LAMP_ANGLE, range: LAMP_RANGE };
  /** The sky's state the dome was last drawn for: the light makes a new one at each apply. */
  let domeSky: SkyState | null = null;
  /** What a frame draws the mist banks with (`MistFrame`), and the sky's state the haze's colours were last read for. */
  let mistFrame: MistFrame | null = null;
  let airSky: SkyState | null = null;
  /** What a frame draws the motes with beside the game's own arguments. */
  const motesFrame: MotesFrame = { seconds: 0, exposure: 0, contrast: DISPLAY_CONTRAST };
  /** The headlamp as the rain reads it: at the eye, along the view, at the frame's state, its intensity 0 while it is off. */
  const rainLamp: RainLamp = { x: 0, y: 0, z: 0, dx: 0, dy: 0, dz: 1, intensity: 0, angle: LAMP_ANGLE, r: 1, g: 1, b: 1 };
  /** What a frame draws the rain and its splashes with; none before the sky's first slices, as the mist banks'. */
  let rainFrame: RainFrame | null = null;
  let splashFrame: SplashFrame | null = null;
  /** The canopy's water as the rain last stepped it, and the canopy over the lens (`lensCanopy.ts`). */
  let canopyWater = 0;
  const canopyRead = forest === null ? null : createLensCanopy(forest.seed);
  /** The fog gradient's near end, the motes' colour and the one the cloud's is made from: black until the sky's first slices. */
  let nearColour = { r: 0, g: 0, b: 0 };
  /** The view's six planes for the frame (`cameraPose.ts`): what lies in one place is drawn while they hold it. */
  const planes = restPlanes();
  /** What the wildlife is handed each frame (`wildlifeInputs.ts`), and whether this world has any. */
  const wildlifeInputs = createWildlifeInputs();
  const hasWildlife = forest !== null && options.wildlife !== false;
  /** Whether this world has the lakes' insects and frogs: a forest world with a lake, the animals not turned off. */
  const hasWaterLife = hasWildlife && lakes.length > 0;
  /** The lake whose life is heard, and each lake's life's reach (`lakeChoice.ts`). */
  const lakeChoice = createLakeChoice(lakes);
  /** The players by the slots they keep, which a head swarm and a speed are kept by. */
  const playerSlots = createPlayerSlots(MAX_PLAYERS);
  /** What a frame hands the lakes' life, filled in place. */
  const waterLifeFrame: WaterLifeFrame = {
    camX: 0, camY: 0, camZ: 0, tick: 0, dt: 0, time: 0, players: [], weather: light.weather, hour: light.hour, wind: windRecordUnder(light.weather, 0),
    sky: null, skyLuma: 0, pixelAt1m: 0, hollowDistance: Infinity,
  };
  /** Whether this frame's `sync` stepped the lakes' life: the sound of a frame that did not is silence. */
  let waterLifeStepped = false;
  /** The life heard: the lake nearest the camera's (`lakeChoice.ts`). */
  let heardLife: LiteWaterLife | null = null;
  /** Where the hikers and the Hollows stand a frame, and how (`entityPoses.ts`). */
  const poses = createEntityPoses();
  /**
   * The scenes and the endings as the frames play them (`scenePlay.ts`): stepped once a frame on the player's eye,
   * which it hands back as the frame's camera with the shot's lens. Everything that reads the view reads it after:
   * the chain's passes and their last camera, the mask, the rain, every part's test against the view's planes. The
   * end scene's car is the scenery's own, stood where the scene has it; once it has left the rain's cover the map is
   * drawn again.
   */
  const play = createScenePlay({
    stage: (pose, car) => (car as LiteCar).stage(pose),
    coverLeft: () => standing?.rainMap?.redraw(),
  });
  /** What the frame's scene asks, as the play last said; null on a frame with no local player or under the free camera. */
  let playNow: PlayNow | null = null;
  /** The most hikers other than the local one the state has held at once: a lamp's light is made for each. */
  let othersSeen = 0;
  /**
   * The frame's size (`frameSize.ts`): the canvas's box over the tier's scaling, whatever the display's pixel ratio,
   * as the game sizes it on Babylon.js, and under the render scale where a paint pass hides its steps. The surface
   * is the engine's own, once it stands.
   */
  let surface: EngineContext | null = null;
  const frameFit = createFrameFit(tier, renderScaleRuns(postFeatures.paint, options.gpuTime === true), {
    clientWidth: () => canvas.clientWidth,
    clientHeight: () => canvas.clientHeight,
    ratio: () => globalThis.devicePixelRatio ?? 1,
    set: (width, height) => {
      if (surface !== null) setSurfaceSize(surface, width, height);
    },
  });
  /** Ground images still being fetched or decoded. */
  let loading = forest === null ? 0 : GROUND_IMAGES;
  let gpuErrors = 0;
  /**
   * What the device is asked to make of shaders (`deviceMakes.ts`): a frame that asked for a shader module or a
   * pipeline is told to whoever hears a shader compile on Babylon.js (`onShaderCompiled`).
   */
  const makes = createDeviceMakes();
  /** The measurement mode's readout of the GPU's own time (`gpuTimeReadout.ts`); none outside it. */
  const gpuTime = options.gpuTime === true ? createLiteGpuTime(canvas, import.meta.env.VITE_BUILD_SHA || "dev") : null;
  /** The watch on the renderer's own engine (`engineWatch.ts`): the hike is told when the device is lost under it. */
  const engineWatch = createEngineWatch();
  const disposal = new AbortController();

  let markSynced: () => void = () => undefined;
  const firstSynced = new Promise<void>((resolve) => {
    markSynced = resolve;
  });

  /** Lets go of what stands: the meshes, the scene, the engine and its device. */
  function release(made: Standing): void {
    made.chain?.dispose();
    made.panorama?.dispose();
    for (const life of made.waterLives) life.dispose();
    made.waterPlants?.dispose();
    made.lakes?.dispose();
    made.sea?.dispose();
    made.spray?.drawn.dispose();
    made.wildlife?.dispose();
    made.scenery?.dispose();
    made.cap?.dispose();
    made.entities?.dispose();
    made.veil?.dispose();
    made.mask?.dispose();
    made.wornLamps.dispose();
    made.skinClock.dispose();
    made.splash?.dispose();
    made.rain.dispose();
    made.rainMap?.dispose();
    made.motes?.dispose();
    made.mist?.dispose();
    made.props?.dispose();
    made.brushes?.dispose();
    made.cliffs?.dispose();
    made.duff?.dispose();
    made.clutter?.dispose();
    made.blades?.dispose();
    made.forest?.dispose();
    made.terrain?.dispose();
    disposeScene(made.scene);
    disposeEngine(made.engine);
  }

  async function make(): Promise<void> {
    // The tier's scaling of the canvas's pixels: Lite sizes its surface by the
    // device's pixel ratio, held at the ratio the tier draws at.
    // A chain's scene is multisampled in its own target: the canvas then takes the grade's one sample a pixel.
    const engine = await createEngine(canvas, { msaaSamples: chained ? 1 : 4, maxDevicePixelRatio: 1 / QUALITY[tier].hardwareScaling });
    if (disposed) {
      disposeEngine(engine);
      return;
    }
    // The frame at the game's own size before anything is made for it.
    surface = engine;
    frameFit.fit();
    // Counted from the device's first shader, and timed from its first frame where the page measures.
    makes.count((engine as unknown as { _device: MakesDevice })._device);
    gpuTime?.attach(engine);
    onEngineGpuError(engine, (error) => {
      if (gpuErrors++ < GPU_ERRORS_SAID) console.error(`the hike's renderer: ${error.message}`);
    });
    onEngineDeviceLost(engine, (info) => {
      // Its own letting go destroys the device too: only a loss it did not ask for is said, and told to the hike,
      // which builds the renderer again on a new engine. Nothing is drawn with a lost device meanwhile.
      if (disposed) return;
      console.error(`the hike's renderer lost its device (${info.reason === undefined ? "no reason given" : info.reason}): ${info.message}`);
      engineWatch.fail("lost");
    });
    // The frame's block, before any material: every material's plugins name it.
    const shared = createPluginUniformBlock(engine, FRAME_BLOCK, [...FRAME_FIELDS], "vertex-fragment");
    // Under a chain every material hands its linear colour on, unexposed, and the scene has no pass but the chain's.
    if (chained) {
      enablePbrLinearOutput();
      linearPage = true;
    }
    const scene = createSceneContext(engine, chained ? { defaultRenderTask: false } : undefined);
    scene.imageProcessing.toneMappingEnabled = !chained;
    scene.imageProcessing.toneMapping = NeutralToneMapping;
    scene.imageProcessing.contrast = DISPLAY_CONTRAST;
    scene.imageProcessing.exposure = chained ? 1 : light.exposure;

    // Never given controls: the camera is placed by `sync` alone.
    const camera = createBankedFreeCamera(vec3(pose.x, pose.y, pose.z), vec3(pose.x, pose.y, pose.z + LOOK_AHEAD), vec3(0, 1, 0));
    camera.fov = lens.fov;
    camera.nearPlane = lens.near;
    camera.farPlane = lens.far;
    addToScene(scene, camera);
    scene.camera = camera;

    // The local player's headlamp, made first as the game makes it, and off until a frame lights it.
    const lamp = createSpotLight([pose.x, pose.y, pose.z], [0, 0, 1], LAMP_ANGLE, LAMP_EXPONENT, 0);
    lamp.range = LAMP_RANGE;
    lamp.diffuse = [LAMP_COLOUR[0], LAMP_COLOUR[1], LAMP_COLOUR[2]];
    lamp.specular = [LAMP_COLOUR[0], LAMP_COLOUR[1], LAMP_COLOUR[2]];
    addToScene(scene, lamp);
    // The sun and the fill, set by the first frame's light.
    const sun = createDirectionalLight([0, -1, 0], 1);
    const fill = createHemisphericLight([0, 1, 0], 1);
    addToScene(scene, sun);
    addToScene(scene, fill);
    // The lamps the other hikers wear: a light for each one there already is, before any mesh is built.
    const wornLamps = createWornLamps(scene, othersSeen);
    // The sky's dome, the night sky alone until the first frame's light, and its capture as the scene's
    // environment, made before the scene is registered.
    const dome = createLiteSkyDome(engine, scene, shared, chained);
    const capture = await createLiteSkyCapture(engine, scene, dome.table);
    if (disposed) {
      disposeScene(scene);
      disposeEngine(engine);
      return;
    }

    const materials: PbrMaterialProps[] = [];
    let terrain: TerrainMeshes | null = null;
    let road: TableTexture | null = null;
    let trees: ForestMeshes | null = null;
    let blades: BladeMeshes | null = null;
    let clutter: ClutterMeshes | null = null;
    let duff: DuffMeshes | null = null;
    let cliffs: CliffMeshes | null = null;
    let props: PropMeshes | null = null;
    // The valley mist banks ride the same guard as the forest: a hand-authored level has no valley haze.
    const mist = forest === null ? null : createLiteMistMeshes(engine, scene, forest.seed, tier, shared, uploads, chained);
    // The motes are the air's everywhere, on the tiers with the capacity for them.
    const motes = createLiteMotes(engine, scene, tier, shared, uploads, chained);
    // The rain's cover map, on the tiers that draw one, over the terrain the rings draw: the rings, the patches, the
    // props and the cliffs' near buckets stand in it as they are made. Then the rain, which is the weather's
    // everywhere, and the splashes, which land on the map.
    const rainMap = forest === null ? null : createLiteRainMap(engine, scene, tier);
    // The shore panorama a lake's glass reflects under its skyline, on the tier that draws one: a pass of its own, made
    // before the scene is registered, which the ground, the far forest, the cliffs' far ring, the props and the lakes'
    // plants stand in as they are made.
    const firstLake = lakes[0];
    const panorama = forest !== null && firstLake !== undefined && tier === "medium" && chained ? createLitePanorama(engine, scene, firstLake, { shared, uploads }) : null;
    /** What stands in the panorama in its own material: `late` for what lands after the first frames, which the picture is taken again for. */
    const reflectedAs = (late: boolean): ReflectionRegistry | undefined =>
      panorama === null
        ? undefined
        : {
          add: (mesh) => {
            panorama.own.add(mesh);
            if (late) panorama.landed();
          },
          remove: (mesh) => panorama.own.remove(mesh),
        };
    const rain = createLiteRain(engine, scene, tier, rainMap, shared, uploads, chained);
    const splash = rainMap === null ? null : createLiteRainSplash(engine, scene, tier, rainMap, shared, uploads, chained);
    // Their clocks ride in the frame's block.
    frameValues.clocks = [motes?.clocks, rain.clocks, splash?.clocks].filter((clocks): clocks is StageRecord => clocks !== undefined);
    const coverAs = (kind: "terrain" | "hard" | "water"): CoverRegistry | undefined =>
      rainMap === null ? undefined : { add: (mesh) => rainMap.register(mesh, kind), remove: (mesh) => rainMap.unregister(mesh) };
    /** One registry for a shell that hands its meshes to two. */
    const both = (a: CoverRegistry | undefined, b: CoverRegistry | undefined): CoverRegistry | undefined =>
      a === undefined ? b : b === undefined ? a : { add: (mesh) => (a.add(mesh), b.add(mesh)), remove: (mesh) => (a.remove(mesh), b.remove(mesh)) };
    // The ground cloud's map: read by the chain's far softening, which marches the cloud once a pixel, or by every
    // material's air where a tier marches it with no chain.
    const cloudGround = forest === null && !chained ? null : cloudMapTexture(engine);
    const cloudMap = cloudGround?.texture ?? null;
    /** The air's plugin, one a material: with the cloud's march only where no chain has it, and with the material path's grade where no chain grades the frame. */
    const air = (): MaterialPlugin => atmospherePlugin(airValues, cloudMap as NonNullable<typeof cloudMap>, shared, !chained && cloudSteps > 0, !chained, !chained && linearPage);
    // The mask the haunt's figures are drawn into, before the scene is registered: the chain's grade reads it, and
    // where there is no chain the veil does, one triangle multiplied into the frame last of all.
    const mask = forest !== null ? createLiteShadeMask(engine, scene, { shared, linear: chained, near: lens.near, far: lens.far, fov: lens.fov }) : null;
    const veil = mask !== null && !chained ? createLiteShadeVeil(engine, scene, createTexture2DFromPixels(engine, new Uint8Array([0, 0, 0, 255]), 1, 1)) : null;
    // The chain: the scene's pass into its first target and its own passes after, before the scene is registered.
    const chain = chained && cloudMap !== null ? createLitePostChain(engine, scene, { features: postFeatures, camera, cloudMap, now: clock, uploads }) : null;
    if (forest !== null && cloudMap !== null) {
      const arrays = await loadGroundArrays(engine, disposal.signal, () => {
        loading--;
      });
      if (disposed) {
        disposeScene(scene);
        disposeEngine(engine);
        return;
      }
      road = tableTexture(engine, tables.road);
      const textures = {
        ...arrays,
        roadCenter: road.texture,
        trailTable: tableTexture(engine, tables.trail).texture,
        featureTex: tableTexture(engine, tables.features).texture,
      };
      const paints = { road: tables.road !== null, trail: tables.trail !== null, features: tables.features !== null };
      const surface = terrainSurfaceUnder(light.weather);
      const material = (extra: MaterialPlugin[]): PbrMaterialProps => {
        const made = createPbrMaterial({
          baseColorFactor: [surface.albedo[0], surface.albedo[1], surface.albedo[2], 1],
          metallicFactor: surface.metallic,
          roughnessFactor: surface.roughness,
          usePhysicalLightFalloff: true,
        });
        made.plugins = [
          terrainPlugin(terrainValues, textures, cover.farLow, paints, shared),
          terrainWetPlugin(wetValues, shared),
          terrainSplitPlugin(),
          air(),
          ...extra,
        ];
        materials.push(made);
        return made;
      };
      terrain = createTerrainMeshes(
        engine, scene,
        // The patches: the ground's material again, a depth offset ahead of the ground they lie on.
        { ground: material([]), patches: material([depthAheadPlugin(-FACE_PATCH_Z_UNITS, -FACE_PATCH_Z_OFFSET)]) },
        forest.seed, tier,
        {
          start: options.start,
          rings: fittingRings(prepared, forest.seed, options.start ?? { x: 0, z: 0 }, BASE_SPACING_BY_TIER[tier]),
          trail: activeTerrainVariant().trailGraph?.(forest.seed) ?? null,
          jobs,
          firstBuilds: options.firstBuilds,
          uploads,
          cover: coverAs("terrain"),
          reflections: panorama?.ground,
        },
      );
      if (options.deferClipmap !== true) finish(terrain.firstBuild());
    }
    enablePbrMaterialPluginVertexData();
    enableMaterialPlugins(scene);
    await registerScene(scene);
    if (forest !== null && cloudMap !== null && !disposed) {
      // The trees land as their models do: the frames go on meanwhile.
      trees = createForestMeshes(engine, scene, forest.seed, {
        tier,
        nearRadius: nearRadiusFor(tier),
        eye: pose,
        frame: frameSize,
        wet: forestWet,
        air, shared,
        jobs,
        firstBuilds: options.firstBuilds,
        uploads,
        reflections: reflectedAs(true),
      });
      // Settled either way: what landed is what the panorama can draw.
      if (panorama !== null) void trees.ready.then(panorama.landed, panorama.landed);
      if (abandoned) trees.abandon();
      // The near field of blade grass, on the tiers that can afford it.
      if (tier !== "low") {
        blades = createBladeMeshes(engine, scene, forest.seed, {
          quality: tier, eye: pose, frame: frameSize, air, shared, jobs, firstBuilds: options.firstBuilds,
          uploads,
        });
      }
      // The ground clutter, which lands as its models do. The tiers that draw the blade field draw it over the
      // meadow's near cards and cut the grass class's cards to the view; low draws the cards alone, whole.
      clutter = createClutterMeshes(engine, scene, forest.seed, {
        radiusScale: clutterReachFor(tier),
        nearBlades: tier !== "low",
        cull: tier !== "low",
        eye: pose,
        frame: frameSize,
        wet: wetAt,
        air, shared,
        jobs,
        firstBuilds: options.firstBuilds,
        uploads,
      });
      // The near field of dead leaves, twigs and small branches, on the same tiers as the blades beside it.
      if (tier !== "low") {
        duff = createDuffMeshes(engine, scene, forest.seed, {
          quality: tier, eye: pose, frame: frameSize, wet: wetAt(WET_CAP.duff), air, shared,
          jobs, firstBuilds: options.firstBuilds, uploads,
        });
      }
      // Rock-wall modules on the faces too steep to stand on, on every tier. At the shipped density the field
      // lays none and no model is fetched.
      cliffs = createCliffMeshes(engine, scene, forest.seed, {
        quality: tier, eye: pose, frame: frameSize, wet: wetAt(WET_CAP.cliff), air, shared, uploads,
        cover: coverAs("hard"), reflections: reflectedAs(true),
      });
      // Every chunk prop the simulation collides with that no other mesh draws, as its box. A world as the game makes
      // it today has none, and none is made.
      props = createPropMeshes(engine, scene, forest.grid, {
        wet: wetAt(WET_CAP.prop), air, shared, firstBuilds: options.firstBuilds, uploads,
        // The shore's props stand in a lake's reflections as they are.
        cover: both(coverAs("hard"), reflectedAs(false)),
      });
    }
    // A forest draws terrain instead of brushes: a hand-authored level's are drawn only where there is none.
    const brushes = forest === null && level.brushes.length > 0 && !disposed
      ? createLiteBrushes(engine, scene, brushBoxes(level.brushes), { air, uploads })
      : null;
    // The hikers' bodies and the Hollows' eyes, which land as their models do, under the air as the rest of the
    // world is. A body takes the water's line and not the rain: its porosity is none.
    const skinClock = createSkinClock(engine);
    const entities = forest === null || cloudMap === null || disposed
      ? null
      : createEntityMeshes(engine, scene, { wet: wetAt(0), air, shared, clock: skinClock, hollows: true, uploads, mask });
    // The missing hiker's cap, where the world's trail has a stem to lie beside.
    let cap: CapMesh | null = null;
    if (forest !== null && cloudMap !== null && !disposed) {
      const graph = activeTerrainVariant().trailGraph?.(forest.seed) ?? null;
      const at = graph === null ? null : droppedCapAt(graph, forest.seed);
      if (at !== null) cap = createCapMesh(engine, scene, at, elevationAt(forest.seed, at.x, at.z), air, uploads);
    }
    // The scenery a hike places once, which the hike asks for when its world is in (`hikeScenery.ts`): nothing until then.
    const scenery = forest === null || cloudMap === null || disposed
      ? null
      : createLiteScenery(engine, scene, { wet: wetAt(WET_CAP.prop), air, ahead: depthAheadPlugin, shared, linear: chained, uploads, cover: coverAs("hard") });
    // The animals, which land as their models do; low scales every species' disc to 60%, as the game does.
    const wildlife = !hasWildlife || forest === null || cloudMap === null || disposed
      ? null
      : createLiteWildlifeMeshes(engine, scene, forest.seed, {
        radiusScale: tier === "low" ? 0.6 : undefined, firstBuilds: options.firstBuilds, air, shared, clock: skinClock,
        planes: () => planes, uploads,
      });
    // The water, in a world with a sea level: the bed's square every body of it reads its depth from, round the
    // hike's start, then the sea, then the lakes, each lake one surface, where the world has any.
    let bed: LiteWaterBed | null = null;
    let sea: LiteSea | null = null;
    let spray: Standing["spray"] = null;
    let lakeMeshes: LiteLakes | null = null;
    let waterPlants: LiteWaterPlants | null = null;
    const waterLives: LiteWaterLife[] = [];
    const start = { x: options.start?.x ?? level.playerSpawns[0]?.x ?? 0, z: options.start?.z ?? level.playerSpawns[0]?.z ?? 0 };
    // The wind sea's cascades, on the tier that computes them: made before the sea, whose material binds their
    // pictures. Where they cannot be made the sea draws the baked loop.
    const seaFft = forest !== null && cloudMap !== null && waterLevel !== undefined && !disposed && seaLookFor(tier).fft === true
      ? await createLiteSeaFft(engine, scene, uploads).catch((error: unknown) => {
        console.warn("Ocean: the wind sea's field could not be made; the sea draws without it.", error);
        return null;
      })
      : null;
    // A renderer let go while they were made keeps nothing of them.
    if (disposed) seaFft?.dispose();
    if (forest !== null && cloudMap !== null && waterLevel !== undefined && !disposed) {
      bed = createLiteWaterBed(engine, tier, forest.seed, lakes, waterLevel, start.x, start.z, fittingBed(prepared, forest.seed, tier, start.x, start.z), uploads);
      sea = createLiteSea(engine, scene, forest.seed, tier, {
        start, waterLevel, bed, air, shared,
        rings: fittingWaterRings(prepared, forest.seed, start.x, start.z), ocean: fittingOcean(prepared, forest.seed, tier),
        bump: fittingWaterBump(prepared, forest.seed), uploads, fft: seaFft,
        cover: rainMap === null ? undefined : { add: (mesh, place) => rainMap.register(mesh, "water", place), remove: (mesh) => rainMap.unregister(mesh) },
      });
      // The spray of the plunges, on the tier whose sea is the cascades': thrown along the swell's travel while the
      // curl is the lip drawn, else along the face's normal.
      if (seaLookFor(tier).fft === true) {
        spray = { drawn: createLiteSurfSpray(engine, scene, shared, uploads, chained), thrown: createSprayThrow(sea.edge.tracker, sea.edge.cove, waterLevel) };
      }
    }
    if (forest !== null && cloudMap !== null && bed !== null && lakes.length > 0 && !disposed) {
      /** What the world's worker sampled for each lake, where it is that lake's. */
      const pieces = lakes.map((lake, i) => fittingLake(prepared, forest.seed, lake, i));
      lakeMeshes = createLiteLakes(engine, scene, forest.seed, lakes, tier, {
        bed, calm: calmFade, air, shared,
        made: pieces,
        bump: fittingWaterBump(prepared, forest.seed),
        uploads, cover: coverAs("water"), panorama: panorama?.texture,
      });
      // A murky lake's reeds, cattails and lilies: placed by the simulation, drawn once.
      waterPlants = createLiteWaterPlants(engine, scene, forest.seed, lakes, {
        eye: pose, frame: frameSize, air, ahead: depthAheadPlugin, shared,
        placements: pieces.map((piece) => piece?.plants ?? null), uploads,
      });
      // The reeds and the lilies stand in the shore's panorama on their own materials.
      for (const mesh of waterPlants.meshes) panorama?.own.add(mesh);
      // The midges, the dragonflies and the frogs of every lake, each placed once and stepped only while the camera is
      // within its lake's reach.
      if (hasWaterLife) {
        lakes.forEach((lake, i) => {
          waterLives.push(createLiteWaterLife(engine, scene, forest.seed, lake, tier, {
            air, shared, planes: () => planes, made: pieces[i]?.life, uploads, linear: chained,
          }));
        });
      }
    }
    const made: Standing = {
      engine, scene, camera, sun, fill, lamp, dome, capture, shared, chain, materials, terrain, road, cloudGround, forest: trees, blades, clutter, duff, cliffs, props, brushes, mist, motes,
      rain, rainMap, panorama, splash, skinClock, entities, mask, veil, wornLamps, cap, wildlife, scenery, bed, sea, spray, lakes: lakeMeshes, waterPlants, waterLives,
    };
    if (disposed) {
      release(made);
      return;
    }
    // A palette asked for while the renderer was being made is worn from the first frame.
    if (palette !== null) chain?.setPalette(PAINT_PALETTES[palette.name], 0);
    standing = made;
  }

  /** Resolved once the renderer stands, or cannot: a failure is said and leaves it empty. */
  const made: Promise<void> = make().catch((error: unknown) => {
    loading = 0;
    if (!disposed) console.error("the hike's renderer could not be made; nothing of the world is drawn", error);
  });

  /** The scenery as the hike asks for it (`hikeScenery.ts`): an ask made before the renderer stands is answered when it does. */
  const sceneryHost: SceneryHost = deferredScenery(made, () => (disposed ? null : (standing?.scenery ?? null)));
  /** The view the scenery is judged by, filled in place a frame. */
  const sceneryView: SceneryView = { planes, eye: pose, cover: null };
  const sceneryCover = { x: 0, z: 0, half: RAIN_MAP.extent / 2 };

  const handle = {
    isDisposed: false,
    dispose(): void {
      if (handle.isDisposed) return;
      handle.isDisposed = true;
      disposed = true;
      engineWatch.close();
      makes.stop();
      gpuTime?.dispose();
      stopLoop();
      disposal.abort();
      light.dispose();
      ownSky?.dispose();
      markSynced();
      if (standing !== null) release(standing);
      standing = null;
      surface = null;
      if (options.gpuTime === true) {
        if (measured.__syncJobs !== undefined) delete measured.__syncJobs;
        if (measured.__frameUploads !== undefined) delete measured.__frameUploads;
      }
    },
  };

  /** The frames the page is shown, each calling every function `runLoop` was given, then every frame's-end listener. */
  const frames = new Set<() => void>();
  const frameEnds = new Set<() => void>();
  let scheduled: number | null = null;
  function tick(): void {
    scheduled = requestAnimationFrame(tick);
    for (const frame of [...frames]) frame();
    for (const end of [...frameEnds]) end();
  }
  function stopLoop(frame?: () => void): void {
    if (frame === undefined) frames.clear();
    else frames.delete(frame);
    if (frames.size === 0 && scheduled !== null) {
      cancelAnimationFrame(scheduled);
      scheduled = null;
    }
  }

  /** The lights and the cleared frame, written again when the hour's or the weather's light has moved. */
  function relight(made: Standing): void {
    const lights = light.lights;
    if (lights === null || litVersion === light.version) return;
    litVersion = light.version;
    const { sun, fill, scene } = made;
    sun.direction.x = light.sunTravel.x;
    sun.direction.y = light.sunTravel.y;
    sun.direction.z = light.sunTravel.z;
    sun.intensity = lights.sun.intensity;
    // A highlight takes the light's own colour, as under Babylon's PBR, which reads no other.
    sun.diffuse = [lights.sun.colour.r, lights.sun.colour.g, lights.sun.colour.b];
    sun.specular = [lights.sun.colour.r, lights.sun.colour.g, lights.sun.colour.b];
    markLightDirty(sun);
    fill.intensity = lights.fill.intensity;
    fill.diffuseColor = [lights.fill.colour.r, lights.fill.colour.g, lights.fill.colour.b];
    fill.specularColor = [lights.fill.colour.r, lights.fill.colour.g, lights.fill.colour.b];
    fill.groundColor = [lights.fill.groundColour.r, lights.fill.groundColour.g, lights.fill.groundColour.b];
    markLightDirty(fill);
    // The cleared frame is the air over the horizon, as the fog's far colour is: what shows on any pixel the dome
    // has not drawn.
    scene.clearColor = { r: lights.air.r, g: lights.air.g, b: lights.air.b, a: 1 };
  }

  /**
   * The dome, drawn again for the sky's state of each apply: its uniforms, and its table where the slice has moved;
   * then its capture, the six faces at the scene's share of the image-based light, as the game's lighting draws its
   * probe again at each apply.
   */
  function redrawSky(made: Standing): void {
    const sky = light.sky;
    const lights = light.lights;
    if (sky === null || lights === null || sky === domeSky) return;
    domeSky = sky;
    const table = made.dome.update(sky, shownExposure(), DISPLAY_CONTRAST);
    if (table > 0) uploads.count("textures", table);
    uploads.marked();
    made.capture.capture(sky, lights.environmentIntensity, pose);
    uploads.count("uniforms", SKY_CAPTURE_BYTES);
  }

  /**
   * The headlamp where the frame has it (`lampAt`), at the frame's state, or at an intensity of 0: written only where
   * any of it has moved, so a still frame writes nothing. A lamp that is dark stands overhead (`lampPlace`), not
   * where it last shone, and is put there once: it is the first light of every mesh, and Lite's clear coat takes
   * what it dims a surface's direct light by from the first light's bearing whatever its intensity, so the car's
   * paint would lose light by where the lamp went dark.
   */
  function placeLamp(made: Standing): void {
    const { lamp } = made;
    const intensity = lensLamp.on ? lensLamp.state.intensity : 0;
    const w = lampWritten;
    const at = lampAt;
    const { r, g, b } = lensLamp.state.colour;
    const lit = intensity > 0;
    const stands = lampPlace(lit, at);
    const moved = w.x !== stands.x || w.y !== stands.y || w.z !== stands.z
      || (lit && (w.dx !== at.dx || w.dy !== at.dy || w.dz !== at.dz || w.angle !== at.angle || w.range !== at.range));
    const recoloured = lit && (w.r !== r || w.g !== g || w.b !== b);
    if (intensity === w.intensity && !moved && !recoloured) return;
    w.intensity = intensity;
    lamp.intensity = intensity;
    w.x = lamp.position.x = stands.x;
    w.y = lamp.position.y = stands.y;
    w.z = lamp.position.z = stands.z;
    if (lit) {
      w.dx = lamp.direction.x = at.dx;
      w.dy = lamp.direction.y = at.dy;
      w.dz = lamp.direction.z = at.dz;
      w.angle = lamp.angle = at.angle;
      w.range = lamp.range = at.range;
      // Its highlight takes its own colour, as the game's lamp's does.
      w.r = r;
      w.g = g;
      w.b = b;
      lamp.diffuse = [r, g, b];
      lamp.specular = [r, g, b];
    }
    markLightDirty(lamp);
  }

  /** The frame's numbers into what stands: the camera, the lights, the exposure and the terrain's materials. */
  function draw(made: Standing, wetness: number): void {
    const { camera, scene } = made;
    camera.position.x = pose.x;
    camera.position.y = pose.y;
    camera.position.z = pose.z;
    camera.target.x = pose.x + axes.fx * LOOK_AHEAD;
    camera.target.y = pose.y + axes.fy * LOOK_AHEAD;
    camera.target.z = pose.z + axes.fz * LOOK_AHEAD;
    camera.upVector.x = axes.ux;
    camera.upVector.y = axes.uy;
    camera.upVector.z = axes.uz;
    camera.fov = fov;
    relight(made);
    placeLamp(made);
    redrawSky(made);
    if (!chained) scene.imageProcessing.exposure = shownExposure();
    // The road's table follows the eye before the uniforms are made: they carry where it is centred.
    if (tables.road !== null && made.road !== null && followRoadCentre(tables.road, pose.z)) {
      made.road.write();
      uploads.stream("textures", made.road.bytes);
    }
    terrainUniforms(drawnWith, terrainValues);
    const surface = terrainSurfaceUnder(light.weather);
    terrainValues.terrainAlbedo[0] = surface.albedo[0];
    terrainValues.terrainAlbedo[1] = surface.albedo[1];
    terrainValues.terrainAlbedo[2] = surface.albedo[2];
    setWetWeather(wetness);
    // A level's brushes take the weather's wet as a whole: darker and glossier, written when it moves.
    if (made.brushes !== null) {
      const wet = wetSurfaceUnder(light.weather);
      made.brushes.wet(wet.albedoScale, wet.roughnessScale);
    }
    // Everywhere but under the water of the high tier's own path, the water above darkens what stands in it. The
    // terrain's cap is none; every other material's is its own, and the rest of the look is this record's.
    const wetLine = wetLineFor(wetBodies, pose.x, pose.z);
    wetUniforms({ ...wetLine, attenuate: true, cap: 0 }, wetValues);
    // The ground cloud is marched in the tier's steps while it has density: by the chain where there is one, and
    // then by no material.
    atmosphereUniforms(light.air, cloud, made.chain === null ? cloudMarchSteps(cloud) : 0, airValues);
    if (made.chain !== null) {
      // The chain's frame: the camera its passes rebuild a pixel's ray from, the sun and the cloud its far softening
      // marches, and the jitter's next step, before the projection is read for the frame's block.
      postView.eye = pose;
      postView.forward = { x: axes.fx, y: axes.fy, z: axes.fz };
      postView.right = { x: axes.rx, y: axes.ry, z: axes.rz };
      postView.up = { x: axes.ux, y: axes.uy, z: axes.uz };
      postView.fov = fov;
      postView.aspect = canvas.height > 0 ? canvas.width / canvas.height : 1;
      made.chain.frame(postView, airValues, cloudUniforms(cloud, cloudMarchSteps(cloud), chainCloud));
    }
    // The terrain's two materials carry the ground's colour and roughness under the weather: written again when it moves.
    if (surface.albedo[0] !== groundWritten.r || surface.albedo[1] !== groundWritten.g || surface.albedo[2] !== groundWritten.b || surface.roughness !== groundWritten.roughness) {
      groundWritten.r = surface.albedo[0];
      groundWritten.g = surface.albedo[1];
      groundWritten.b = surface.albedo[2];
      groundWritten.roughness = surface.roughness;
      for (const material of made.materials) {
        const colour = material.baseColorFactor;
        if (colour !== undefined) {
          colour[0] = surface.albedo[0];
          colour[1] = surface.albedo[1];
          colour[2] = surface.albedo[2];
        }
        material.roughnessFactor = surface.roughness;
        markMaterialUboDirty(material);
      }
      uploads.marked(made.materials.length);
    }
    // What every material reads alike, once: the air, the wet line, the wind and the players, the eye, the frame's
    // height and the terrain's record.
    frameSize.height = canvas.height;
    frameValues.eye = pose;
    frameValues.rows = canvas.height;
    frameValues.wingTime = wingTime(clock());
    frameValues.exposure = shownExposure();
    if (made.chain === null) {
      // No chain: the frame is graded in its materials, by the weather's curves, the chase's cast and the vignette.
      const record = gradeRecordUnder(light.weather, light.hour, light.sky?.night ?? 0, unsettle, (clock() - madeAt) / 1000, shownStare, chaseCast);
      frameValues.grade = materialGradeUniforms(light.weather, record, canvas.width, canvas.height, gradeValues);
    }
    // The projection as Lite makes it for the hike's own pass, at the canvas's shape.
    frameValues.projection = getProjectionMatrix(camera, canvas.height > 0 ? canvas.width / canvas.height : 1);
    writeFrameBlock(made.shared.data, made.shared.offsets, frameValues);
    writePluginUniformBlock(made.engine, made.shared);
    uploads.count("uniforms", made.shared.data.byteLength);
  }

  let skyWait: Promise<void> | null = null;

  /** The forest's first lists drawn, once the renderer stands; at once where it cannot, or in a world with no forest. */
  const forestReady: Promise<void> = made.then(() => standing?.forest?.ready);
  /** Everything that lands as its models do, drawn: the forest, the ground clutter and the cliffs. */
  const sceneryReady: Promise<void> = made.then(() => Promise.all([standing?.forest?.ready, standing?.clutter?.ready, standing?.cliffs?.ready, standing?.entities?.ready])).then(() => undefined);

  const renderer: Renderer & { scenery: SceneryHost } = {
    ...absent,
    scenery: sceneryHost,
    engine: handle as EngineHandle,
    engineName: "webgpu",
    ownWatch: engineWatch.watch,
    gpuTime,
    onShaderCompiled: (fn) => makes.onMade(fn),
    keepShaders() {
      // Nothing to keep: every shader module and pipeline is the device's, which goes with this renderer (`retire`
      // hands no engine on), and the next hike's renderer makes its own on a new one.
    },
    forestReady,
    firstSynced,
    skyReady() {
      // The sky's slices and the renderer itself: no frame is drawn before both.
      skyWait ??= Promise.all([whenSkyHeld(skyTable, () => light.hour, { signal: disposal.signal }), made]).then(() => {
        skyWait = null;
      });
      return skyWait;
    },
    hasWildlife,
    wildlifeEvents() {
      return wildlifeInputs.drain(standing?.wildlife?.events);
    },
    wildlifeDirectorLog() {
      return standing?.wildlife?.directorLog() ?? [];
    },
    hasSea: waterLevel !== undefined,
    surfSound() {
      return surfStepped ? surf : SILENT_SURF_SOUND;
    },
    hasWaterLife,
    waterLifeSound() {
      return heardLife !== null && waterLifeStepped ? heardLife.sound() : SILENT_WATER_LIFE;
    },
    whenReady(maxMs) {
      return new Promise<void>((resolve) => {
        const bound = setTimeout(resolve, Math.max(0, maxMs));
        void sceneryReady.then(() => {
          clearTimeout(bound);
          resolve();
        });
      });
    },
    waitingItems() {
      return loading + (standing?.forest?.waiting() ?? 0) + (standing?.clutter?.waiting() ?? 0) + (standing?.cliffs?.waiting() ?? 0) + (standing?.entities?.waiting() ?? 0);
    },
    sync(state, localId, alpha, frame = { dt: 0, sprinting: false }) {
      if (disposed) return;
      const now = clock();
      const seconds = now / 1000;
      /** The frame's duration on the renderer's clock, seconds. */
      const dt = steppedAt === null ? 0 : Math.max(0, (now - steppedAt) / 1000);
      // The weather's fade, a frame of the renderer's clock at a time.
      light.step(dt);
      steppedAt = now;
      const weather = light.weather;
      /** The seconds the wind and the water move on: the simulation's, so every peer's move alike; a clock handed in is kept. */
      const sharedNow = options.clock !== undefined ? seconds : sharedSeconds(state.tick, alpha);
      wind = windRecordUnder(weather, sharedNow, windOverride ?? undefined);
      // The players bend the foliage they stand in: up to five, the rest of the slots parked far off in XZ.
      windPlayers.fill(0);
      for (let i = 0; i < FOLIAGE_PLAYERS; i++) {
        windPlayers[i * 3] = FOLIAGE_PLAYER_PARKED;
        windPlayers[i * 3 + 2] = FOLIAGE_PLAYER_PARKED;
      }
      let bending = 0;
      for (const player of state.players.values()) {
        if (bending === FOLIAGE_PLAYERS) break;
        windPlayers[bending * 3] = player.pos.x;
        windPlayers[bending * 3 + 1] = player.pos.y;
        windPlayers[bending * 3 + 2] = player.pos.z;
        bending++;
      }
      setFoliageWind(wind, windPlayers);

      // The render scale under the paint is fed the page's frame, as the game feeds it: a step is fitted by the next frame drawn.
      frameFit.frame(frame.dt);
      othersSeen = Math.max(othersSeen, state.players.size - (state.players.has(localId) ? 1 : 0));
      // Where every body stands this frame, before the frame's scene is stepped: a body a scene shows or hides is
      // shown or hidden from the frame after the scene says so, as the game on Babylon.js has it.
      const bodies: EntityFrame | null = standing !== null && standing.entities !== null ? poses.step(state, localId, alpha, frame.dt, standing.entities.models) : null;
      // The death's dark as the last frame posed it: the passes read it a frame late.
      const darkWas = play.close;
      playNow = null;
      // The headlamp's state under the weather; lit below while the local player's is and the camera is the eye.
      const lampState = lampUnder(weather, seconds);
      lensLamp.state = lampState;
      lensLamp.on = false;
      // The world follows the camera in freecam, the player otherwise.
      let centre: { x: number; z: number } | null = null;
      /** Where the rain's cover map follows: the camera in freecam, as the rings do, and the player otherwise. */
      let coverAt: { x: number; y: number; z: number } | null = null;
      if (freecam !== null) {
        centre = freecam;
        coverAt = pose;
        pose.x = freecam.x;
        pose.y = freecam.y;
        pose.z = freecam.z;
        pose.yaw = freecam.yaw;
        pose.pitch = freecam.pitch;
        pose.roll = freecam.roll ?? 0;
        fov = freecam.fov ?? GAME_FOV;
        // Flying is not walking.
        bob.reset();
      } else {
        const local = state.players.get(localId);
        if (local !== undefined) {
          lensLamp.on = local.lamp.on;
          const offset = bob.update(
            {
              x: local.pos.x,
              z: local.pos.z,
              speed: Math.sqrt(local.vel.x * local.vel.x + local.vel.z * local.vel.z),
              velY: local.vel.y,
              grounded: local.grounded,
              sprinting: frame.sprinting,
            },
            frame.dt,
          );
          // The eye between the frame's last tick and the one before it; the
          // lateral bob rides the camera's right vector, (cos yaw, 0, -sin yaw).
          const eye = blendedEye(frame.before ?? null, local, alpha, eyeScratch);
          pose.x = eye.x + offset.dx * Math.cos(eye.yaw);
          pose.y = eye.y + PLAYER_EYE_OFFSET + offset.dy;
          pose.z = eye.z - offset.dx * Math.sin(eye.yaw);
          pose.yaw = eye.yaw;
          pose.pitch = eye.pitch;
          pose.roll = offset.roll;
          // The scenes and the endings, from the eye just placed (`scenePlay.ts`): the summit's scene or the cap's,
          // the end scene with its car, the death's fall; each takes the camera from the one before, with its lens.
          const now = play.step(seconds, pose, local, state.players, (id) => poses.drawnAt(id));
          playNow = now;
          fov = now.fov ?? GAME_FOV;
          // The local body stands in the summit's shots and runs in the end scene's; the others at the car's door are in it.
          poses.showLocal = now.showLocal;
          poses.hideNear = now.hideNear;
          // What the world is built round: the player, but in an end scene shown on another's run (who reached the
          // car while this screen's player was far up the mountain), that runner.
          const shownId = play.runnerId();
          centre = (shownId === undefined ? undefined : state.players.get(shownId))?.pos ?? local.pos;
          // The end scene's camera goes down the road from the player: the rain's cover goes with it.
          coverAt = now.endRun ? pose : local.pos;
        }
      }
      cameraAxes(pose.yaw, pose.pitch, pose.roll, axes);
      // The lamp: on the lens, at the eye and along the view; or where the frame's scene has it.
      lampAt.x = pose.x;
      lampAt.y = pose.y;
      lampAt.z = pose.z;
      lampAt.dx = axes.fx;
      lampAt.dy = axes.fy;
      lampAt.dz = axes.fz;
      lampAt.angle = LAMP_ANGLE;
      lampAt.range = LAMP_RANGE;
      if (playNow !== null) {
        if (playNow.lamp === "car") {
          const at = playNow.carLamp;
          lampAt.x = at.x;
          lampAt.y = at.y;
          lampAt.z = at.z;
          lampAt.dx = at.dx;
          lampAt.dy = at.dy;
          lampAt.dz = at.dz;
          lampAt.angle = HEADLAMP_CONE;
          lampAt.range = HEADLAMP_RANGE;
          lensLamp.state = carLamp;
          lensLamp.on = true;
        } else if (playNow.lamp === "body") {
          // Worn at the eye of the body as this frame stood it: off in the frame a scene first shows the body, which is not drawn yet.
          const worn = bodies?.players.find((body) => body.local && body.hidden === null);
          lensLamp.on = worn !== undefined;
          if (worn !== undefined) {
            lampAt.x = worn.eyeX;
            lampAt.y = worn.eyeY;
            lampAt.z = worn.eyeZ;
            lampAt.dx = worn.aimX;
            lampAt.dy = worn.aimY;
            lampAt.dz = worn.aimZ;
          }
        } else if (playNow.lensDark) lensLamp.on = false;
      }
      drawnWith.eye = pose;
      drawnWith.wetness = weather.wetness;
      drawnWith.rain = weather.rain;
      drawnWith.seconds = seconds;
      // The canopy over the lens, for whoever hears the drips by it: the forest's own, whatever is drawn.
      if (centre !== null) canopyRead?.over(pose.x, pose.z);
      waterLifeStepped = false;
      surfStepped = false;
      if (standing !== null) {
        // The terrain first, then the shells in the order the game's are handed the view: a frame's jobs go oldest
        // first, and those begun in one frame in this order.
        if (centre !== null) {
          standing.terrain?.update(centre.x, centre.z);
          standing.props?.update(centre.x, centre.z);
          standing.forest?.update(centre.x, centre.z);
          standing.cliffs?.update(centre.x, centre.z);
          standing.clutter?.update(centre.x, centre.z);
          standing.blades?.update(centre.x, centre.z);
          standing.duff?.update(centre.x, centre.z);
        }
        // The blades and the grass class's cards are cut to the view once the camera's pose for the frame is final.
        cullPose.x = pose.x;
        cullPose.y = pose.y;
        cullPose.z = pose.z;
        cullPose.yaw = pose.yaw;
        cullPose.pitch = pose.pitch;
        cullPose.roll = pose.roll;
        cullPose.fov = fov;
        cullPose.aspect = canvas.height > 0 ? canvas.width / canvas.height : 1;
        standing.blades?.cull(cullPose);
        standing.clutter?.cull(cullPose);
        // The haze's colours, read again for each new sky state. There are none until the sky's first slices are in,
        // and no mist bank or mote is drawn before.
        const sky = light.sky;
        const air = light.air;
        if (sky !== null && air !== null && sky !== airSky) {
          airSky = sky;
          mistFrame = { eye: pose, yaw: 0, colour: fogGradientAt(sky, GRADIENT_MID_STEP), air, exposure: 0, contrast: DISPLAY_CONTRAST };
          nearColour = fogGradientAt(sky, 0);
          rainFrame = { eye: pose, yaw: 0, dt: 0, lamp: rainLamp, air, exposure: 0, contrast: DISPLAY_CONTRAST };
          splashFrame = { eye: pose, seconds: 0, lamp: rainLamp, sunTravel: light.sunTravel, milk: standing.rain.milk, air, exposure: 0, contrast: DISPLAY_CONTRAST };
        }
        if (centre !== null && mistFrame !== null) {
          // The mist banks, round the camera's place and turned to its yaw.
          mistFrame.yaw = pose.yaw;
          mistFrame.exposure = shownExposure();
          standing.mist?.update(centre.x, centre.z, weather, wind, seconds, mistFrame);
          // The motes, round the camera the frame is drawn from, in the gradient's near colour.
          motesFrame.seconds = seconds;
          motesFrame.exposure = shownExposure();
          standing.motes?.update(weather, light.hour, nearColour, wind, motesFrame);
        }
        coverDrawn = false;
        shoreDrawn = false;
        if (coverAt !== null && rainFrame !== null && splashFrame !== null) {
          // The headlamp as the rain reads it: the frame's, where it stands and as it points.
          rainLamp.x = lampAt.x;
          rainLamp.y = lampAt.y;
          rainLamp.z = lampAt.z;
          rainLamp.dx = lampAt.dx;
          rainLamp.dy = lampAt.dy;
          rainLamp.dz = lampAt.dz;
          rainLamp.angle = lampAt.angle;
          rainLamp.intensity = lensLamp.on ? lensLamp.state.intensity : 0;
          rainLamp.r = lensLamp.state.colour.r;
          rainLamp.g = lensLamp.state.colour.g;
          rainLamp.b = lensLamp.state.colour.b;
          // The cover map is drawn with this frame only if a drop or a ring reads it; then the rain, and the
          // splashes on the map.
          coverDrawn = standing.rainMap?.update(coverAt, standing.rain.reads(weather)) ?? false;
          rainFrame.yaw = pose.yaw;
          rainFrame.dt = dt;
          rainFrame.exposure = shownExposure();
          standing.rain.update(weather, wind, rainFrame);
          canopyWater = standing.rain.canopyWater;
          splashFrame.seconds = seconds;
          splashFrame.exposure = shownExposure();
          standing.splash?.update(weather, splashFrame);
        }
        // The hikers' bodies, the Hollows' eyes and the lamps the other hikers wear, from the frame's poses: the
        // fades and the paces step by the page's frame, the clips by the renderer's clock.
        standing.skinClock.step(dt);
        if (standing.entities !== null && bodies !== null) {
          standing.entities.update(bodies, dt);
          standing.wornLamps.update(standing.entities.lamps(), lampState);
        }
        // The mask the figures were just written into: drawn from the frame's own camera, on the smoke's clock, and
        // read by the grade while a figure is in it.
        if (standing.mask !== null) {
          standing.mask.place(pose, axes, fov);
          frameValues.smokeTime = shadeSmokeSeconds(now - madeAt);
          standing.chain?.setShades(standing.mask.texture, standing.mask.any);
        }
        // The view's planes for the frame, and the cap while they hold it.
        viewPlanes(pose, axes, fov, canvas.height > 0 ? canvas.width / canvas.height : 1, lens.near, lens.far, planes);
        standing.cap?.seen(planes);
        // The scenery placed once, while the view holds it; what of it is cover, too, on a frame that draws the cover map.
        if (standing.scenery !== null) {
          sceneryView.cover = null;
          if (coverDrawn && standing.rainMap !== null) {
            sceneryCover.x = standing.rainMap.centre.x;
            sceneryCover.z = standing.rainMap.centre.z;
            sceneryView.cover = sceneryCover;
          }
          standing.scenery.update(sceneryView);
        }
        // The bed's square round the world's centre, for the sea and the lakes alike.
        if (centre !== null) standing.bed?.step(centre.x, centre.z);
        // The sea: its rings round the world's centre, its swell and wind sea on the shared seconds, its edge on the
        // cove, and whether the view holds water. What moves it goes to the frame's block below; the wet ground
        // reads the cove and the swash's table from the edge's first fill on, and the surf is heard by it.
        if (standing.sea !== null && centre !== null && waterLevel !== undefined) {
          const f = seaFrame;
          f.centreX = centre.x;
          f.centreZ = centre.z;
          f.planes = planes;
          viewCorners(pose, axes, fov, canvas.height > 0 ? canvas.width / canvas.height : 1, lens.near, lens.far, f.corners as Float32Array);
          f.seconds = sharedNow;
          f.dt = dt;
          f.wind = wind;
          f.hour = light.hour;
          f.cover = null;
          if (coverDrawn && standing.rainMap !== null) {
            coverSquare.x = standing.rainMap.centre.x;
            coverSquare.z = standing.rainMap.centre.z;
            f.cover = coverSquare;
          }
          standing.sea.update(f);
          frameValues.sea = standing.sea.frame;
          // The rain rings the sea as it does a lake: the lakes' record carries it where there are any.
          if (standing.lakes === null) frameValues.water.waterRain[0] = weather.rain;
          const { edge } = standing.sea;
          setWetCove(edge.cove.z0, edge.cove.halfWidth, edge.cove.toeD, edge.cove.faceGrade);
          setWetSwash(edge.table.data);
          fillSurfSound(surf, pose, edge.tracker, edge.table, edge.cove, waterLevel, standing.sea.hs, canopyRead?.value ?? 0, frame.dt);
          surfStepped = true;
          // The spray: this frame's plunges near the world's centre throw their bursts, then every burst is aged, and
          // the sprites drawn while one is alive, the foam's white under the sun and the fill.
          if (standing.spray !== null) {
            standing.spray.thrown(standing.sea.curl, standing.sea.travel, centre.x, centre.z, sharedNow, standing.spray.drawn.burst);
            const lights = light.lights;
            sprayLights.length = 0;
            if (lights !== null) {
              sprayLights.push({ r: lights.sun.colour.r, g: lights.sun.colour.g, b: lights.sun.colour.b, intensity: lights.sun.intensity });
              sprayLights.push({ r: lights.fill.colour.r, g: lights.fill.colour.g, b: lights.fill.colour.b, intensity: lights.fill.intensity });
            }
            standing.spray.drawn.update(sharedNow, wind, sprayLights);
          }
        }
        // The lakes' water: each lake's calm and numbers, and each shown while the view holds it. What every lake
        // reads alike goes to the frame's block below.
        if (standing.lakes !== null && centre !== null) {
          const f = lakeFrame;
          f.eye = pose;
          f.forward = axes;
          f.planes = planes;
          f.seconds = sharedNow;
          f.dt = dt;
          f.weather = weather;
          f.wind = wind;
          f.hour = light.hour;
          f.sky = sky;
          f.environmentIntensity = light.lights?.environmentIntensity ?? 0;
          f.frameHeight = canvas.height;
          f.fov = fov;
          f.cover = null;
          if (coverDrawn && standing.rainMap !== null) {
            coverSquare.x = standing.rainMap.centre.x;
            coverSquare.z = standing.rainMap.centre.z;
            f.cover = coverSquare;
          }
          // The lake the shore's panorama is of: the nearest past its bound, held until another is nearer by a lead.
          const served = standing.panorama === null ? null : lakeChoice.choose(pose.x, pose.z);
          f.served = served?.index ?? -1;
          if (served !== null) standing.panorama?.setLake(lakes[served.index] as LakeSource);
          standing.lakes.update(f);
          frameValues.water = standing.lakes.frame;
          // A sector of the panorama with this frame, while a capture is owed and that lake's glass reads the picture.
          shoreDrawn = served !== null && standing.panorama !== null && standing.panorama.update(sky, weather, standing.lakes.readsShore(served.index));
        }
        // The lakes' plants, each kind while the view holds it; and all of them on a frame that draws the shore's
        // panorama, which looks all the way round.
        standing.waterPlants?.seen(planes, shoreDrawn);
        // The animals, round the camera in freecam and the player otherwise, judged by the view's planes: the
        // director is handed the sim's place and aim, never the camera's own, which the walk's bob has moved.
        if (standing.wildlife !== null && centre !== null) {
          const aspect = canvas.height > 0 ? canvas.width / canvas.height : 1;
          const local = freecam === null ? state.players.get(localId) : undefined;
          if (local !== undefined) wildlifeInputs.look(state, local.pos.x, local.pos.y + PLAYER_EYE_OFFSET, local.pos.z, local.yaw, local.pitch, fov, aspect, light.hour, weather.mist);
          else wildlifeInputs.look(state, pose.x, pose.y, pose.z, pose.yaw, pose.pitch, fov, aspect, light.hour, weather.mist);
          standing.wildlife.update(centre.x, centre.z, state.tick, wildlifeInputs.players(state), weather, light.hour, wildlifeInputs.director, dt);
        }
        // The lakes' life, round the camera the frame is drawn from: stepped for a lake within reach, rested otherwise;
        // the life heard is the nearest lake's.
        if (standing.waterLives.length > 0 && centre !== null) {
          const f = waterLifeFrame;
          f.camX = pose.x;
          f.camY = pose.y;
          f.camZ = pose.z;
          f.tick = state.tick;
          f.dt = frame.dt;
          f.time = sharedNow;
          f.players = playerSlots.fill(state.players);
          f.weather = weather;
          f.hour = light.hour;
          f.wind = wind;
          f.sky = sky;
          f.skyLuma = skyLumaOf(sky);
          f.pixelAt1m = pixelAtOneMetre(fov, canvas.height);
          f.hollowDistance = wildlifeInputs.director.match.hollowDistance;
          const served = lakeChoice.choose(f.camX, f.camZ);
          standing.waterLives.forEach((life, i) => {
            if (lakeChoice.live[i] === 1) life.update(f, shownExposure(), DISPLAY_CONTRAST);
            else life.rest();
          });
          heardLife = served === null ? null : (standing.waterLives[served.index] ?? null);
          waterLifeStepped = true;
        }
        // The ground cloud: the ground round the eye, built again at once as the eye leaves the last map's middle, as
        // the game builds it, and counted with what follows the camera; then its density for the frame, from the
        // night, the haunt and the chase's cast by how far the mist has come in, or the level it is held at.
        if (cloudSteps > 0 && forest !== null && standing.cloudGround !== null) {
          if (cloudGroundDue(cloudGroundAt, pose.x, pose.z)) {
            cloudGroundAt = { x: pose.x, z: pose.z };
            const trailAt = activeTerrainVariant().trailDistance;
            const ground = cloudGroundMap(
              (x, z) => elevationAt(forest.seed, x, z), cloudGroundAt.x, cloudGroundAt.z, trailAt === undefined ? null : (x, z) => trailAt(forest.seed, x, z),
            );
            standing.cloudGround.lay(ground);
            uploads.stream("textures", standing.cloudGround.bytes);
            cloud = cloudOn(cloud, ground);
          }
          cloudDensity = cloudDensityNow(cloudHold, sky?.night ?? 0, hauntLevel, chaseCast, mistIn);
          cloud = cloudFor(cloud, cloudDensity, cloudSteps, seconds, hauntLevel, nearColour);
        }
        // The stare's lens: the dead have none, and the Hollow nearest the aim is the side its darkness closes from.
        const starer = state.players.get(localId);
        const stare = starer !== undefined && starer.health > 0 ? starer.stare : 0;
        let side: { x: number; y: number; cos: number } | null = null;
        if (stare > 0) {
          for (const enemy of state.enemies.values()) {
            if (!isHollow(enemy)) continue;
            const vx = enemy.pos.x - pose.x;
            const vy = enemy.pos.y - pose.y;
            const vz = enemy.pos.z - pose.z;
            const at = stareSide(vx * axes.rx + vy * axes.ry + vz * axes.rz, vx * axes.ux + vy * axes.uy + vz * axes.uz, vx * axes.fx + vy * axes.fy + vz * axes.fz);
            if (at !== null && (side === null || at.cos > side.cos)) side = at;
          }
        }
        stareLens = stepStareLens(stareLens, stare, side, dt);
        // Rain on the lens: strongest looking up, smoothed over a second.
        lensStrength = lensSmooth(lensStrength, lensStrengthUnder(weather.rain, pose.pitch), dt);
        // The chain's grade for the frame: before the sky's first slices there is no night factor, and the day's 0
        // stands in, for frames no one sees.
        // The death's closing dark rides the stare's shade, driven to full: the grade's on a tier with a chain, the
        // veil's and the exposure's on a tier with none.
        shownStare = stareWithDark(stareLens, darkWas);
        standing.chain?.update(weather, light.hour, sky?.night ?? 0, unsettle, shownStare, lensStrength, chaseCast);
        // With no chain the veil lays the mask and the stare's darkness over the frame, while there is either.
        standing.veil?.update(standing.mask?.texture ?? null, standing.mask?.any ?? false, stareShadeUnder(shownStare, seconds), canvas.width, canvas.height);
        draw(standing, weather.wetness);
      }
      // This frame's share of the rebuilds the updates above began, once every shell has seen the view.
      jobs.run();
      // What the frame hands over is all said: its record is closed, and the next frame's budget is whole.
      uploads.close();
      if (centre !== null) markSynced();
    },
    listener() {
      writeListenerPose(listenerPose, pose.x, pose.y, pose.z, pose.yaw, pose.pitch);
      return listenerPose;
    },
    cameraPosition() {
      return { x: pose.x, y: pose.y, z: pose.z };
    },
    project(pos) {
      return projectToCanvas(pose, axes, fov, lens.near, canvas.clientWidth, canvas.clientHeight, pos.x, pos.y, pos.z);
    },
    resize() {
      // Read again whatever was last seen.
      frameFit.refit();
      if (standing !== null) frameFit.fit();
    },
    drawFrame() {
      if (standing === null || engineWatch.failed("lost")) return;
      // While the scene is built again for a new hiker's lamp, nothing of it is drawn (`wornLamps.ts`).
      if (standing.wornLamps.rebuilding) return;
      // The frame sized again where the canvas's box, the display's ratio or the render scale has moved.
      frameFit.fit();
      // The hike's own surface alone: a billboard's bake has another, drawn when the bake is (`impostorBake.ts`).
      renderFrame(standing.engine, 1000 / 60, [standing.engine]);
      // The cover map is drawn with the frame that asked for it, and no other.
      standing.rainMap?.frameDrawn();
      // And a sector of the shore's panorama with the frame that drew it.
      standing.panorama?.frameDrawn();
      // And the wind sea's cascades with the frame that asked for them.
      standing.sea?.frameDrawn();
      // A frame that asked the device for a shader module or a pipeline is told of, and the measurement mode's line written.
      makes.frameEnd();
      gpuTime?.frameEnd();
    },
    runLoop(frame) {
      if (disposed) return;
      frames.add(frame);
      scheduled ??= requestAnimationFrame(tick);
    },
    stopLoop,
    onFrameEnd(fn) {
      frameEnds.add(fn);
      return () => void frameEnds.delete(fn);
    },
    impostorBakes() {
      return standing?.forest?.impostorBakes() ?? [];
    },
    abandon() {
      abandoned = true;
      standing?.forest?.abandon();
    },
    dispose() {
      handle.dispose();
    },
    retire() {
      // Nothing of a Lite engine is kept for the next hike yet: it goes with its renderer.
      handle.dispose();
      return handle;
    },
    setFreecam(view) {
      freecam = view;
    },
    setScene(kind, at, more, fromS = 0) {
      play.setScene(kind, at, more, fromS, clock() / 1000);
    },
    clearEnding(liftS = 0) {
      play.clearEnding(liftS, clock() / 1000);
    },
    setEnding(kind: EndingKind, scene?: EndSceneSetup) {
      play.setEnding(kind, scene, clock() / 1000);
    },
    endScene() {
      return play.endScene();
    },
    setHour(hour) {
      light.setHour(hour);
    },
    setWeather(next, fadeSeconds) {
      light.setWeather(next, fadeSeconds);
    },
    setWeatherName(name, fadeSeconds = 3) {
      calmFade.name(name, fadeSeconds, light.hour);
    },
    setView(hour, weather) {
      light.setView(hour, weather);
    },
    followHour(hour) {
      light.followHour(hour);
    },
    setBobScale(scale) {
      bob.setScale(scale);
    },
    setHaunt(level) {
      hauntLevel = Math.max(0, Math.min(1, level));
    },
    stare() {
      return stareLens;
    },
    setChase(cast) {
      chaseCast = Math.max(0, Math.min(1, cast));
    },
    setUnsettle(level) {
      unsettle = Math.max(0, Math.min(1, level));
    },
    setPalette(name, fadeSeconds) {
      // On the material path there is no grade and nothing changes, as on Babylon.js.
      palette = { name, fadeSeconds };
      standing?.chain?.setPalette(PAINT_PALETTES[name], fadeSeconds);
    },
    setDepthOfField() {
      // The game's chain has no depth of field: nothing to draw.
    },
    setMist(density) {
      cloudHold = density === null ? null : Math.max(0, Math.min(1, density));
      return cloudHold ?? cloudDensity;
    },
    setMistIn(level) {
      mistIn = Math.max(0, Math.min(1, level));
    },
    wind() {
      return wind;
    },
    canopyWater() {
      return canopyWater;
    },
    canopyOver() {
      return canopyRead?.value ?? 0;
    },
    setWindOverride(next) {
      windOverride = next === null ? null : Math.min(1, Math.max(0, next));
    },
    async buildFirstClipmap(sliceMs, onRing) {
      await made;
      const terrain = standing?.terrain ?? null;
      if (terrain !== null) await stepSlices(terrain.firstBuild(onRing), sliceMs, () => disposed);
    },
    buildClipmapNow() {
      const terrain = standing?.terrain ?? null;
      if (terrain !== null) finish(terrain.firstBuild());
    },
  };
  return renderer;
}
