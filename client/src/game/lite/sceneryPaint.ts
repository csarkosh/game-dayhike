/**
 * The scenery's painted and laid-on surfaces on Babylon Lite: the lettering
 * on the fingerposts' planks, the trailhead board's face, and the soft dark
 * patch under the car.
 *
 * - **The paint is the game's canvas** (`signParts.ts` `paintLabel`,
 *   `boardDraw.ts` `drawBoard`), made a texture as the game's is: the
 *   canvas's own bytes with their alpha as it stands, its smaller levels
 *   made from them, and its colour taken to linear in the material
 *   (`setPbrGammaAlbedo`), where Babylon.js's takes it too.
 * - **Every name's lettering is one picture** (`labelAtlas`): a row a name,
 *   a row as tall as the game's one texture a name, so a row's smaller
 *   levels are that texture's own down to the level where a row is three
 *   texels tall. Every plank face of a world is then one mesh and one draw,
 *   where the game draws a plane a face under a material a name.
 * - **A painted material is blended by its paint's alpha alone**
 *   (`paintAlphaPlugin`): the game turns off the reflection's and the
 *   highlight's share of the alpha, so the clear ground stays clear. Lite
 *   adds that share at its fragment's end, so the fragment is returned
 *   ahead of it. Its depth is set ahead of the surface it lies on, as the
 *   game's bias sets it.
 * - **The patch under the car is Babylon.js's Standard material as the game
 *   sets it there**, statement for statement: unlit and black, its darkness
 *   its texture's alpha, the scene's distance fog mixed in before the colour
 *   is taken to linear, then the tier's colour path. It writes no depth and
 *   is set ahead of the ground it lies on.
 * - **The film's car's tail lamps are the same material again, as the game
 *   sets it for them**: unlit, their red given off whole, and no fog on
 *   them (two red points down the highway into the mist, which the fog
 *   would take first); opaque, seen from behind the car alone, one mesh for
 *   the pair.
 */
import {
  createMeshFromData, createPbrMaterial, createShaderMaterial, createTexture2DFromExternalImage, createTexture2DFromPixels, setPbrGammaAlbedo, setShaderTexture,
  type EngineContext, type MaterialPlugin, type Mesh, type PbrMaterialProps, type PluginUniformBlock, type ShaderMaterial, type Texture2D,
} from "@babylonjs/lite";
import { CAR_SHADOW_BIAS, CAR_SHADOW_TEX, carShadowAlphaMap, type CarShadowGrid } from "../carShadow.js";
import { TAIL_LAMP_APART, TAIL_LAMP_BACK, TAIL_LAMP_H, TAIL_LAMP_UP, TAIL_LAMP_W } from "../endScene.js";
import { LABEL_TEXTURE, paintLabel, type LabelFace } from "../signParts.js";
import { DISPLAY_CURVE_WGSL, onColourPath } from "./displayCurve.js";
import { FRAME_CONTRAST_NAME, FRAME_EXPOSURE_NAME, stageOwn, stageReads } from "./frameBlock.js";
import { shaderUniformDecls, shaderUniformWriter } from "./shaderUniforms.js";

/** The most rows a column of the lettering's picture holds: a texture no taller than every device takes. */
export const ATLAS_ROWS = 32;

/** Where each name's lettering lies in the one picture: its column and row, and the picture's size in texels. */
export type LabelAtlas = { width: number; height: number; cells: ReadonlyMap<string, { column: number; row: number }> };

/** The picture's layout for `names`: a row a name down a column, a new column every `ATLAS_ROWS` names. */
export function labelAtlas(names: readonly string[]): LabelAtlas {
  const cells = new Map<string, { column: number; row: number }>();
  for (const [i, name] of names.entries()) cells.set(name, { column: Math.floor(i / ATLAS_ROWS), row: i % ATLAS_ROWS });
  const columns = Math.max(1, Math.ceil(names.length / ATLAS_ROWS));
  const rows = Math.max(1, Math.min(names.length, ATLAS_ROWS));
  return { width: columns * LABEL_TEXTURE.width, height: rows * LABEL_TEXTURE.height, cells };
}

/** Paints every name of `atlas` into its cell of `ctx`, a canvas of the atlas's size: each as the game paints its own texture, and nothing of it outside its cell. */
export function paintLabelAtlas(ctx: CanvasRenderingContext2D, atlas: LabelAtlas): void {
  ctx.clearRect(0, 0, atlas.width, atlas.height);
  for (const [name, cell] of atlas.cells) {
    ctx.save();
    ctx.translate(cell.column * LABEL_TEXTURE.width, cell.row * LABEL_TEXTURE.height);
    ctx.beginPath();
    ctx.rect(0, 0, LABEL_TEXTURE.width, LABEL_TEXTURE.height);
    ctx.clip();
    paintLabel(ctx, name, LABEL_TEXTURE.width, LABEL_TEXTURE.height);
    ctx.restore();
  }
}

/** Painted faces as one geometry in the world's own coordinates: four corners a face, read from the side its normal points to. */
export type FaceGeometry = { positions: Float32Array; normals: Float32Array; uvs: Float32Array; indices: Uint32Array };

/**
 * The geometry of `faces`, each a rectangle of four corners (bottom left,
 * bottom right, top right, top left, as it is read) and the part of the
 * picture it shows (`rect`: the left and top edges and the size, as shares
 * of the picture, its rows counted down from its top).
 */
export function faceGeometry(faces: readonly { corners: Float32Array; normal: { x: number; y: number; z: number }; rect: { u: number; v: number; width: number; height: number } }[]): FaceGeometry {
  const out: FaceGeometry = {
    positions: new Float32Array(faces.length * 12), normals: new Float32Array(faces.length * 12), uvs: new Float32Array(faces.length * 8),
    indices: new Uint32Array(faces.length * 6),
  };
  for (const [f, face] of faces.entries()) {
    out.positions.set(face.corners, f * 12);
    const { u, v, width, height } = face.rect;
    out.uvs.set([u, v + height, u + width, v + height, u + width, v, u, v], f * 8);
    for (let c = 0; c < 4; c++) out.normals.set([face.normal.x, face.normal.y, face.normal.z], f * 12 + c * 3);
    out.indices.set([f * 4, f * 4 + 1, f * 4 + 2, f * 4, f * 4 + 2, f * 4 + 3], f * 6);
  }
  return out;
}

/** The geometry of every plank face of a world, each showing its name's cell of `atlas`. */
export function labelGeometry(labels: readonly LabelFace[], atlas: LabelAtlas): FaceGeometry {
  const w = LABEL_TEXTURE.width / atlas.width;
  const h = LABEL_TEXTURE.height / atlas.height;
  return faceGeometry(labels.map((label) => {
    const cell = atlas.cells.get(label.name);
    if (cell === undefined) throw new Error(`no lettering for "${label.name}"`);
    return { corners: label.corners, normal: label.normal, rect: { u: cell.column * w, v: cell.row * h, width: w, height: h } };
  }));
}

/**
 * A painted material's alpha taken as its paint's: the fragment returned at
 * the last point before Lite's sum, which would add the square of the
 * reflected light to the alpha (`useRadianceOverAlpha` and
 * `useSpecularOverAlpha` off, on Babylon.js). After the air's plugin, whose
 * grade on a tier with no post chain stands at the same point.
 */
export function paintAlphaPlugin(): MaterialPlugin {
  return {
    name: "PaintAlpha",
    priority: 995,
    getCustomCode: (stage) => (stage === "fragment" ? { CUSTOM_FRAGMENT_BEFORE_FRAGCOLOR: "return vec4<f32>(color,alpha*material.materialAlpha);" } : null),
  };
}

/** A canvas of `width` by `height` with its context, of the page's own. */
export function paintCanvas(width: number, height: number): { canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D } {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (ctx === null) throw new Error("no canvas to paint on");
  return { canvas, ctx };
}

/** `canvas` as a texture: its own bytes, their alpha as it stands, the smaller levels made from them, its first row the picture's top. */
export function paintTexture(engine: EngineContext, canvas: HTMLCanvasElement): Promise<Texture2D> {
  return createTexture2DFromExternalImage(engine, canvas, {
    mipMaps: true, invertY: false, srgb: false, premultiplyAlpha: false, addressModeU: "clamp-to-edge", addressModeV: "clamp-to-edge", minFilter: "linear", magFilter: "linear",
  });
}

/**
 * The material of a painted surface showing `picture`: matt at `roughness`,
 * nothing in it metal, seen from its front alone, blended by the paint's
 * alpha, under the air, its depth set ahead by `ahead`.
 */
export function paintMaterial(picture: Texture2D, roughness: number, air: () => MaterialPlugin, ahead: MaterialPlugin): PbrMaterialProps {
  const material = createPbrMaterial({
    baseColorTexture: picture, baseColorFactor: [1, 1, 1, 1], metallicFactor: 0, roughnessFactor: roughness, doubleSided: false, alphaBlend: true,
    usePhysicalLightFalloff: true,
  });
  setPbrGammaAlbedo(material);
  material.plugins = [air(), ahead, paintAlphaPlugin()];
  return material;
}

/** A mesh of painted faces, at the world's origin as every see-through mesh stands; the caller gives it its place and adds it to the scene. */
export function faceMesh(engine: EngineContext, name: string, geometry: FaceGeometry, material: PbrMaterialProps): Mesh {
  const mesh = createMeshFromData(engine, name, geometry.positions, geometry.normals, geometry.indices, geometry.uvs);
  mesh.material = material;
  return mesh;
}

/** What the two stages of the patch hand each other. */
const PATCH_VARYINGS = "struct PatchOut{@builtin(position)position:vec4<f32>,@location(0)uv:vec2<f32>,@location(1)fogDistance:vec3<f32>}";

/** The patch's depth set ahead, in a 24-bit depth buffer's steps toward the eye: Lite's depth runs from 1 at the near plane. */
const PATCH_AHEAD = -CAR_SHADOW_BIAS / 2 ** 24;

/** The vertex stage: a corner of the grid, already in the world's coordinates, and the fog's distance in the view's space. */
const PATCH_VERTEX = /* wgsl */ `
${PATCH_VARYINGS}
@vertex fn mainVertex(input:VertexInput)->PatchOut{
  var out:PatchOut;
  let worldPos=vec4<f32>(input.position,1.0);
  out.position=scene.viewProjection*worldPos;
  out.position.z+=${PATCH_AHEAD.toExponential(6)}*out.position.w;
  out.fogDistance=(scene.view*worldPos).xyz;
  out.uv=input.uv;
  return out;
}`;

/**
 * The fragment stage: the Standard material's, with no light, no emissive
 * colour, an opacity texture and the scene's fog (`CalcFogFactor` at
 * `FOGMODE_EXP2`), in Babylon.js's order.
 */
const PATCH_FRAGMENT = /* wgsl */ `
${PATCH_VARYINGS}
${DISPLAY_CURVE_WGSL}
const PATCH_E:f32=2.71828;
fn patchFogFactor(vFogDistance:vec3<f32>,fogDensity:f32)->f32{
  let fogDistance=length(vFogDistance);
  let fogCoeff=1.0/pow(PATCH_E,fogDistance*fogDistance*fogDensity*fogDensity);
  return clamp(fogCoeff,0.0,1.0);
}
@fragment fn mainFragment(input:PatchOut)->@location(0)vec4<f32>{
  let u=shaderUniforms;
  var alpha=u.patchDark;
  let opacityMap=textureSample(patchMap,patchMapSampler,input.uv);
  alpha*=opacityMap.a;
  let emissiveColor=vec3<f32>(0.0);
  let finalDiffuse=clamp(emissiveColor,vec3<f32>(0.0),vec3<f32>(1.0));
  var color=vec4<f32>(finalDiffuse,alpha);
  color=vec4<f32>(max(color.rgb,vec3<f32>(0.0)),color.a);
  let fog=patchFogFactor(input.fogDistance,u.patchFogDensity);
  color=vec4<f32>(mix(u.patchFogColour,color.rgb,fog),color.a);
  color=vec4<f32>(pow(color.rgb,vec3<f32>(2.2)),color.a);
  color=vec4<f32>(displayColour(color.rgb,u.patchExposure,u.patchContrast),color.a);
  return color;
}`;

/** The stages' text, for the tests that hold it to the game's. */
export const PATCH_WGSL = { vertex: PATCH_VERTEX, fragment: PATCH_FRAGMENT } as const;

/** What the patch reads from the frame's block, by the block's names: the scene's fog and the display curve. */
export const PATCH_FRAME_READS = {
  patchFogColour: "atmFarColour", patchFogDensity: "atmBaseDensity", patchExposure: FRAME_EXPOSURE_NAME, patchContrast: FRAME_CONTRAST_NAME,
} as const;

/** The patch's material and its texture: one for every patch a trailhead lays. `linear`: a post chain grades the frame. */
export function patchMaterial(engine: EngineContext, frame: PluginUniformBlock, linear: boolean, darkness = 1): ShaderMaterial {
  const values = { patchDark: [darkness], patchFogColour: [0, 0, 0], patchFogDensity: [0], patchExposure: [1], patchContrast: [1] };
  const own = stageOwn(values, PATCH_FRAME_READS);
  const material = createShaderMaterial({
    name: "carShadow",
    vertexSource: stageReads(PATCH_VERTEX, PATCH_FRAME_READS),
    fragmentSource: stageReads(onColourPath(PATCH_FRAGMENT, linear), PATCH_FRAME_READS),
    attributes: ["position", "uv"],
    uniforms: shaderUniformDecls(own),
    uniformBlocks: [frame],
    samplers: ["patchMap"],
    needAlphaBlending: true,
    blendMode: "alpha",
    depthWrite: false,
    backFaceCulling: false,
  });
  // The texture as the game's shell makes it: its smaller levels filtered between, held at its edges.
  const map = createTexture2DFromPixels(engine, carShadowAlphaMap(), CAR_SHADOW_TEX.width, CAR_SHADOW_TEX.height, {
    addressModeU: "clamp-to-edge", addressModeV: "clamp-to-edge", minFilter: "linear", magFilter: "linear", mipMaps: true,
  });
  setShaderTexture(material, "patchMap", map);
  shaderUniformWriter(material, own)();
  return material;
}

/**
 * A patch's grid in the world's own coordinates: `grid` (`carShadowGrid`)
 * stood at its origin, scaled to its size and turned by `yaw` about the
 * vertical, as its mesh's transform stands it on Babylon.js.
 */
export function patchGeometry(grid: CarShadowGrid, yaw = 0): { positions: Float32Array; normals: Float32Array; uvs: Float32Array; indices: Uint32Array } {
  const sin = Math.sin(yaw), cos = Math.cos(yaw);
  const positions = new Float32Array(grid.positions.length);
  for (let i = 0; i + 2 < positions.length; i += 3) {
    const x = (grid.positions[i] as number) * grid.scale.x;
    const z = (grid.positions[i + 2] as number) * grid.scale.z;
    positions[i] = grid.origin.x + x * cos + z * sin;
    positions[i + 1] = grid.origin.y + (grid.positions[i + 1] as number) * grid.scale.y;
    positions[i + 2] = grid.origin.z - x * sin + z * cos;
  }
  return { positions, normals: grid.normals, uvs: grid.uvs, indices: Uint32Array.from(grid.indices) };
}

/** What the two stages of the tail lamps hand each other. */
const TAIL_VARYINGS = "struct TailOut{@builtin(position)position:vec4<f32>}";

/** The vertex stage: a corner of a lamp, already in the world's coordinates. */
const TAIL_VERTEX = /* wgsl */ `
${TAIL_VARYINGS}
@vertex fn mainVertex(input:VertexInput)->TailOut{
  var out:TailOut;
  let worldPos=vec4<f32>(input.position,1.0);
  out.position=scene.viewProjection*worldPos;
  return out;
}`;

/**
 * The fragment stage: the Standard material's, with no light, the lamp's
 * colour given off and no fog (`fogEnabled` false), in Babylon.js's order.
 */
const TAIL_FRAGMENT = /* wgsl */ `
${TAIL_VARYINGS}
${DISPLAY_CURVE_WGSL}
@fragment fn mainFragment(input:TailOut)->@location(0)vec4<f32>{
  let u=shaderUniforms;
  let alpha=1.0;
  let emissiveColor=u.tailColour;
  let finalDiffuse=clamp(emissiveColor,vec3<f32>(0.0),vec3<f32>(1.0));
  var color=vec4<f32>(finalDiffuse,alpha);
  color=vec4<f32>(max(color.rgb,vec3<f32>(0.0)),color.a);
  color=vec4<f32>(pow(color.rgb,vec3<f32>(2.2)),color.a);
  color=vec4<f32>(displayColour(color.rgb,u.tailExposure,u.tailContrast),color.a);
  return color;
}`;

/** The stages' text, for the tests that hold it to the patch's. */
export const TAIL_WGSL = { vertex: TAIL_VERTEX, fragment: TAIL_FRAGMENT } as const;

/** What the tail lamps read from the frame's block, by the block's names: the display curve. */
export const TAIL_FRAME_READS = { tailExposure: FRAME_EXPOSURE_NAME, tailContrast: FRAME_CONTRAST_NAME } as const;

/** The tail lamps' material, dark until `colour` is given, and the writer that sends a change of it. `linear`: a post chain grades the frame. */
export function tailLampMaterial(frame: PluginUniformBlock, linear: boolean): { material: ShaderMaterial; colour(r: number, g: number, b: number): void } {
  const values = { tailColour: [0, 0, 0], tailExposure: [1], tailContrast: [1] };
  const own = stageOwn(values, TAIL_FRAME_READS);
  const material = createShaderMaterial({
    name: "carTailLamp",
    vertexSource: TAIL_VERTEX,
    fragmentSource: stageReads(onColourPath(TAIL_FRAGMENT, linear), TAIL_FRAME_READS),
    attributes: ["position"],
    uniforms: shaderUniformDecls(own),
    uniformBlocks: [frame],
    // Seen from behind the car alone, as the game's planes are: a lamp's quad faces out of the tail.
    backFaceCulling: true,
  });
  const write = shaderUniformWriter(material, own);
  write();
  return {
    material,
    colour(r, g, b) {
      values.tailColour[0] = r;
      values.tailColour[1] = g;
      values.tailColour[2] = b;
      write();
    },
  };
}

/**
 * The two tail lamps of a car standing at (x, y, z) turned by `yaw`, in the
 * world's own coordinates, into `out` (eight corners, xyz each): a quad at
 * each rear corner, `TAIL_LAMP_BACK` behind the car's middle (or `back`: in
 * its middle, where they stand hidden in their first frames), facing out of
 * its tail: its corners in the order Babylon.js lays a plane's, so the side
 * that faces backward is its front.
 */
export function tailLampCorners(x: number, y: number, z: number, yaw: number, out: Float32Array, back = TAIL_LAMP_BACK): Float32Array {
  const sin = Math.sin(yaw), cos = Math.cos(yaw);
  let at = 0;
  for (const side of [-1, 1]) {
    for (const [cx, cy] of [[-1, -1], [1, -1], [1, 1], [-1, 1]] as const) {
      const lx = (side * TAIL_LAMP_APART) / 2 + (cx * TAIL_LAMP_W) / 2;
      const ly = TAIL_LAMP_UP + (cy * TAIL_LAMP_H) / 2;
      const lz = -back;
      out[at++] = x + lx * cos + lz * sin;
      out[at++] = y + ly;
      out[at++] = z - lx * sin + lz * cos;
    }
  }
  return out;
}

/** The triangles of the two tail lamps' quads, and a normal a corner (the stage reads none). */
export const TAIL_LAMP_INDICES = new Uint32Array([0, 1, 2, 0, 2, 3, 4, 5, 6, 4, 6, 7]);
