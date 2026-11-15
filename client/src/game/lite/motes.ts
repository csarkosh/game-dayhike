/**
 * The motes on Babylon Lite: the pollen by day and the frost by night, every
 * slot of the tier's capacity an instance of one quad that the vertex stage
 * places from its number and the clock (`moteField.ts` says how, and how
 * that keeps the look of the game's two particle systems; `motesParams.ts`
 * gives the hour's and the weather's settings).
 *
 * Lite has particle systems of its own; none is used. They are built from
 * node graphs, stepped on the page a particle at a time and drawn as
 * billboard sprites in the sprite renderer's own colour, a buffer a frame.
 * The motes want the game's colour (the air's through the material colour
 * path a mote at a time, then added to the frame, as Babylon.js draws a
 * particle on the low tier's path) and are placed by the GPU.
 *
 * - **Nothing is kept or sent a frame but the clock.** The slots go up
 *   once. A frame writes the material's uniforms where they have moved: the
 *   clock while a mote is shown, the wind's carry while it blows, the rest
 *   when the hour or the weather moves them.
 * - **The fragment stage is Babylon.js's particle stage** with no ramp and
 *   no fog (a particle system takes the scene's fog only where it is asked
 *   to, and the game's are not): the sprite times the mote's colour, to
 *   linear, the material colour path (`displayCurve.ts`).
 * - **Added to the frame by its alpha, tested against the depth and never
 *   written to it**, a quad facing the view as a particle's does, at the
 *   motes' place among the see-through draws (`SEE_THROUGH_ORDER`): before
 *   the mist banks, as Babylon.js draws particles before blended meshes.
 *
 * None on a tier with no capacity: the low tier draws no mote.
 */
import {
  addToScene, createPlane, createShaderMaterial, createTexture2DFromPixels, disposeMeshGpu, removeFromScene, setMeshVisible, setShaderTexture,
  setShaderUniform, setThinInstances,
  type EngineContext, type Mesh, type SceneContext, type ShaderMaterial,
} from "@babylonjs/lite";
import type { Rgb } from "../colour.js";
import {
  MOTE_BOX, MOTE_SALT, emptyMoteUniforms, moteSlots, moteUniforms, motesShown, stepMoteTravel, type MoteUniforms,
} from "../moteField.js";
import { MOTE_TEX_SIZE, moteDiscMap, motesUnder } from "../motesParams.js";
import type { QualityTier } from "../quality.js";
import type { WeatherParams } from "../weather.js";
import type { WindRecord } from "../windParams.js";
import { DISPLAY_CURVE_WGSL } from "./displayCurve.js";
import { SEE_THROUGH_ORDER } from "./drawOrder.js";
import { wgslFloat } from "./forestPlugins.js";
import type { FrameUploads } from "./frameUploads.js";

const f = wgslFloat;

/** What the two stages hand each other. */
const VARYINGS = "struct MoteOut{@builtin(position)position:vec4<f32>,@location(0)uv:vec2<f32>,@location(1)colour:vec4<f32>}";

/**
 * The vertex stage: `moteAt`'s steps (`moteField.ts`), then the quad's
 * corner laid out in the view's space as Babylon.js lays a particle's that
 * faces the camera. A slot not shown is put outside the view.
 */
const VERTEX = /* wgsl */ `
${VARYINGS}
const MOTE_BOX:vec3<f32>=vec3<f32>(${f(MOTE_BOX[0])},${f(MOTE_BOX[1])},${f(MOTE_BOX[2])});
fn moteHash(n:u32)->u32{
  var h=n*747796405u+2891336453u;
  h=((h>>((h>>28u)+4u))^h)*277803737u;
  return (h>>22u)^h;
}
fn moteRandom(slot:u32,life:u32,salt:u32)->f32{
  return f32(moteHash(slot^moteHash(life*0x9e3779b9u+salt))>>8u)/16777216.0;
}
@vertex fn mainVertex(input:VertexInput)->MoteOut{
  var out:MoteOut;
  let u=shaderUniforms;
  let slot=u32(input.world0.x);
  let frost=input.world0.y>0.5;
  let span=select(u.motePollenSpan,u.moteFrostSpan,frost);
  let drift=select(u.motePollenDrift,u.moteFrostDrift,frost);
  let life=sqrt(span.z*span.z+(span.w*span.w-span.z*span.z)*moteRandom(slot,0u,${MOTE_SALT.life}u));
  let t=u.moteClock+moteRandom(slot,0u,${MOTE_SALT.phase}u)*life;
  let lives=floor(t/life);
  let age=t-lives*life;
  let n=u32(lives)+1u;
  let born=vec3<f32>(moteRandom(slot,n,${MOTE_SALT.x}u),moteRandom(slot,n,${MOTE_SALT.y}u),moteRandom(slot,n,${MOTE_SALT.z}u));
  let carried=vec3<f32>(u.moteTravel.x,0.0,u.moteTravel.y);
  let eye=shaderSystem.cameraPosition;
  let jitter=vec3<f32>(moteRandom(slot,n,${MOTE_SALT.driftX}u),moteRandom(slot,n,${MOTE_SALT.driftY}u),moteRandom(slot,n,${MOTE_SALT.driftZ}u))*2.0-1.0;
  let velocity=vec3<f32>(drift.y*jitter.x,drift.x+0.5*drift.y*jitter.y,drift.y*jitter.z);
  let anchored=(born-0.5)*MOTE_BOX+carried-eye;
  let place=eye+(fract(anchored/MOTE_BOX+0.5)-0.5)*MOTE_BOX+velocity*age;
  let size=span.x+(span.y-span.x)*moteRandom(slot,n,${MOTE_SALT.size}u);
  let cornerPos=input.position.xy*size;
  let viewPos=(shaderSystem.view*vec4<f32>(place,1.0)).xyz+vec3<f32>(cornerPos,0.0);
  out.position=select(vec4<f32>(2.0,2.0,2.0,1.0),shaderSystem.projection*vec4<f32>(viewPos,1.0),input.world0.z<drift.z);
  out.uv=input.uv;
  out.colour=vec4<f32>(u.moteColour.rgb,u.moteColour.a*(1.0-age/life));
  return out;
}`;

/** The fragment stage: Babylon.js's particle stage on the material colour path. */
const FRAGMENT = /* wgsl */ `
${VARYINGS}
${DISPLAY_CURVE_WGSL}
@fragment fn mainFragment(input:MoteOut)->@location(0)vec4<f32>{
  let u=shaderUniforms;
  let textureColor=textureSample(moteSprite,moteSpriteSampler,input.uv);
  var baseColor=textureColor*input.colour;
  baseColor=vec4<f32>(pow(baseColor.rgb,vec3<f32>(2.2)),baseColor.a);
  baseColor=vec4<f32>(displayColour(baseColor.rgb,u.moteExposure,u.moteContrast),baseColor.a);
  return baseColor;
}`;

/** The stages' text, for the tests that hold it to the game's. */
export const MOTES_WGSL = { vertex: VERTEX, fragment: FRAGMENT } as const;

/** What a frame draws the motes with, beside the game's own arguments: the render clock and the display curve. */
export type MotesFrame = { seconds: number; exposure: number; contrast: number };

/** The motes as they stand in a scene. */
export type LiteMotes = {
  readonly mesh: Mesh;
  readonly material: ShaderMaterial;
  /** The motes under `w` at `hour`, coloured `air`, in `wind`, as the game's shell is handed them. The emitter's box is
   * round the camera the frame is drawn from. */
  update(w: WeatherParams, hour: number, air: Rgb, wind: WindRecord, frame: MotesFrame): void;
  /** Slots drawn by the last update, both species'. */
  readonly shown: number;
  dispose(): void;
};

/** The tier's motes in `scene`, none shown until a frame has some; null on a tier that draws none. */
export function createLiteMotes(engine: EngineContext, scene: SceneContext, tier: QualityTier, uploads?: FrameUploads): LiteMotes | null {
  const slots = moteSlots(tier);
  if (slots === null) return null;
  const values = emptyMoteUniforms();
  const written = emptyMoteUniforms();
  const types = { 1: "f32", 2: "vec2<f32>", 4: "vec4<f32>" } as const;
  const material = createShaderMaterial({
    name: "motes",
    vertexSource: VERTEX,
    fragmentSource: FRAGMENT,
    attributes: ["position", "uv"],
    uniforms: [
      "view", "projection", "cameraPosition",
      ...Object.entries(values).map(([name, value]) => ({ name, type: types[value.length as 1 | 2 | 4], defaultValue: value })),
    ],
    samplers: ["moteSprite"],
    needAlphaBlending: true,
    // Faint alone, bright where many overlap in lit air.
    blendMode: "additive",
    depthWrite: false,
    backFaceCulling: false,
  });
  // The soft disc as the game's shell makes it: its smaller levels filtered between, repeating.
  const sprite = createTexture2DFromPixels(engine, moteDiscMap(), MOTE_TEX_SIZE, MOTE_TEX_SIZE, {
    addressModeU: "repeat", addressModeV: "repeat", minFilter: "linear", magFilter: "linear", mipMaps: true,
  });
  setShaderTexture(material, "moteSprite", sprite);

  const mesh = createPlane(engine, { size: 1 });
  mesh.material = material;
  // At the world's origin, as every see-through mesh stands: Lite orders them by their places (`drawOrder.ts`).
  mesh.renderOrder = SEE_THROUGH_ORDER.motes;
  setThinInstances(mesh, slots.data, slots.count);
  uploads?.count("instances", slots.data.byteLength);
  setMeshVisible(mesh, false);
  addToScene(scene, mesh);

  const travel = { x: 0, z: 0 };
  let lastSeconds: number | null = null;
  let visible = false;
  let shown = 0;

  return {
    mesh,
    material,
    get shown() {
      return shown;
    },
    update(w, hour, air, wind, frame) {
      const record = motesUnder(w, hour, air, tier, wind);
      // The wind's carry is stepped whether or not a mote is shown, as the clock is.
      stepMoteTravel(travel, record.drift, lastSeconds === null ? 0 : frame.seconds - lastSeconds);
      lastSeconds = frame.seconds;
      moteUniforms(record, tier, frame.seconds, travel, frame.exposure, frame.contrast, values);
      const any = motesShown(values);
      shown = any ? Math.round((values.motePollenDrift[2] + values.moteFrostDrift[2]) * slots.count / 2) : 0;
      if (any !== visible) {
        visible = any;
        setMeshVisible(mesh, any);
      }
      if (!any) return;
      let changed = false;
      for (const [name, value] of Object.entries(values) as [keyof MoteUniforms, number[]][]) {
        const last = written[name] as number[];
        if (value.every((v, i) => Math.fround(v) === last[i])) continue;
        for (let i = 0; i < value.length; i++) last[i] = Math.fround(value[i] as number);
        setShaderUniform(material, name, value.length === 1 ? (value[0] as number) : value);
        changed = true;
      }
      if (changed) uploads?.marked();
    },
    dispose() {
      removeFromScene(scene, mesh);
      disposeMeshGpu(mesh);
    },
  };
}
