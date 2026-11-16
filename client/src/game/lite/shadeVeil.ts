/**
 * The shade veil on Babylon Lite: how a tier with no post chain draws the
 * haunt's figures and the stare, which the grade draws where there is a
 * chain. One triangle over the whole frame, last of the see-through draws,
 * multiplied into it, as the game's veil is on Babylon.js (`shadeVeil.ts`):
 * its fragment is the grade's shade block and its stare block, the same
 * text the grade's pass runs (`postWgsl.ts`), and the factor they leave is
 * raised to the display's gamma (`VEIL_GAMMA`), since the frame under it is
 * encoded for the display by then.
 *
 * It is a draw of the frame's own pass, not a pass: the tier gains no
 * full-screen pass by it. And it costs nothing while there is nothing to
 * draw: with no figure in the mask and the stare at rest the triangle is
 * hidden, so a day's frame is what it was. Its uniforms are its own, written
 * on a frame that shows it.
 *
 * What it reads is the mask while a figure is in it and a black texel
 * otherwise, bound again whenever the picture to read is another
 * (`shadeMask.ts`: a mask whose size has moved is another picture). Lite
 * counts the claims on a texture a material binds and destroys it when the
 * last is let go, and one nobody else has claimed goes with its first
 * unbinding: the veil holds a claim of its own on the black texel
 * (`holdTexture`), which is otherwise destroyed the first time the mask is
 * bound in its place, and the stare's darkness with no figure then reads a
 * destroyed texture.
 */
import {
  acquireTexture, addToScene, createMeshFromData, createShaderMaterial, disposeMeshGpu, releaseTexture, removeFromScene, setMeshVisible, setShaderTexture,
  setShaderUniform,
  type EngineContext, type Mesh, type SceneContext, type Texture2D,
} from "@babylonjs/lite";
import { SHADE_BLUR, SHADE_DARK, SHADE_MONSTER_DARK } from "../postFrame.js";
import { VEIL_GAMMA } from "../shadeVeilParams.js";
import type { StareShade } from "../stareLens.js";
import { SEE_THROUGH_ORDER } from "./drawOrder.js";
import { wgslFloat } from "./forestPlugins.js";
import { SHADE_BLOCK_WGSL, SHADE_HELPERS_WGSL, STARE_BLOCK_WGSL } from "./postWgsl.js";

/** The veil's uniforms, by the grade's names for them. */
export type VeilUniforms = { shadeShape: [number, number, number, number]; shadeMonster: [number]; stareShade: [number, number, number, number] };

/** The veil's uniforms for a frame `width` by `height`: the shades' shape, its gate 1 while `shades` (a figure is in the mask), and the stare's shade. */
export function veilUniforms(stare: StareShade, shades: boolean, width: number, height: number, out: VeilUniforms = { shadeShape: [0, 0, 0, 0], shadeMonster: [0], stareShade: [0, 0, 0, 0] }): VeilUniforms {
  out.shadeShape[0] = SHADE_BLUR;
  out.shadeShape[1] = SHADE_DARK;
  out.shadeShape[2] = width / height;
  out.shadeShape[3] = shades ? 1 : 0;
  out.shadeMonster[0] = SHADE_MONSTER_DARK;
  out.stareShade[0] = stare.x;
  out.stareShade[1] = stare.y;
  out.stareShade[2] = stare.reach;
  out.stareShade[3] = stare.time;
  return out;
}

/** Whether the veil has anything to draw: a figure in the mask, or the stare's darkness closed at all. */
export function veilShown(stare: StareShade, shades: boolean): boolean {
  return shades || stare.reach > 0;
}

/** The vertex stage: one triangle over the frame, at the near plane, `vUV` counting up from the frame's foot as the game's does. */
const VERTEX = /* wgsl */ `
struct VeilOut{@builtin(position)position:vec4<f32>,@location(0)vUV:vec2<f32>}
@vertex fn mainVertex(input:VertexInput)->VeilOut{
  var out:VeilOut;
  out.position=vec4<f32>(input.position.xy,1.0,1.0);
  out.vUV=input.position.xy*0.5+0.5;
  return out;
}`;

/** shadeVeil.fragment.fx: a factor of 1 where nothing darkens, the grade's two blocks on it, and the display's gamma. */
const FRAGMENT = /* wgsl */ `
struct VeilOut{@builtin(position)position:vec4<f32>,@location(0)vUV:vec2<f32>}
fn tx(uv:vec2<f32>)->vec2<f32>{return vec2<f32>(uv.x,1.0-uv.y);}
fn shadeRead(uv:vec2<f32>)->vec3<f32>{return textureSampleLevel(shadeSampler,shadeSamplerSampler,tx(uv),0.0).rgb;}
${SHADE_HELPERS_WGSL}
@fragment fn mainFragment(input:VeilOut)->@location(0)vec4<f32>{
  let u=shaderUniforms;
  let vUV=input.vUV;
  var c=vec3<f32>(1.0);
  let centred=(vUV-0.5)*2.0;
${SHADE_BLOCK_WGSL}
${STARE_BLOCK_WGSL}
  return vec4<f32>(pow(c,vec3<f32>(${wgslFloat(VEIL_GAMMA)})),1.0);
}`;

/**
 * A claim on `texture` for as long as its holder may bind it again; the
 * function handed back lets it go. Lite destroys a texture at the last
 * release of its claims, and a material's binding is a claim that goes when
 * another texture is bound in its place.
 */
export function holdTexture(texture: Texture2D): () => void {
  acquireTexture(texture);
  let held = true;
  return () => {
    if (!held) return;
    held = false;
    releaseTexture(texture);
  };
}

/** The stages' text, for the tests that hold it to the game's. */
export const SHADE_VEIL_WGSL = { vertex: VERTEX, fragment: FRAGMENT } as const;

/** The veil as it stands in a scene. */
export type LiteShadeVeil = {
  readonly mesh: Mesh;
  /** The frame's veil: the mask and whether a figure is in it, and the stare's shade. Shown only where it darkens anything. */
  update(mask: Texture2D | null, shades: boolean, stare: StareShade, width: number, height: number): void;
  /** Whether the veil is drawn. */
  readonly shown: boolean;
  dispose(): void;
};

/** The veil of `scene`, hidden until a frame has something for it to draw. `black`: a texel to read while no mask is bound. */
export function createLiteShadeVeil(engine: EngineContext, scene: SceneContext, black: Texture2D): LiteShadeVeil {
  const values = veilUniforms({ x: 0, y: 0, reach: 0, time: 0 }, false, 1, 1);
  const material = createShaderMaterial({
    name: "shadeVeil",
    vertexSource: VERTEX,
    fragmentSource: FRAGMENT,
    attributes: ["position"],
    uniforms: [
      { name: "shadeShape", type: "vec4<f32>", defaultValue: values.shadeShape },
      { name: "shadeMonster", type: "f32", defaultValue: values.shadeMonster },
      { name: "stareShade", type: "vec4<f32>", defaultValue: values.stareShade },
    ],
    samplers: ["shadeSampler"],
    needAlphaBlending: true,
    // Multiplied into the frame, whose alpha it leaves as it is.
    blend: {
      color: { srcFactor: "dst", dstFactor: "zero", operation: "add" },
      alpha: { srcFactor: "zero", dstFactor: "one", operation: "add" },
    },
    depthWrite: false,
    depthCompare: "always",
    backFaceCulling: false,
  });
  // The black texel is bound again whenever the stare darkens a frame with no figure in the mask.
  const letGo = holdTexture(black);
  setShaderTexture(material, "shadeSampler", black);
  const mesh = createMeshFromData(
    engine, "shade_veil", new Float32Array([-1, -1, 0, 3, -1, 0, -1, 3, 0]), new Float32Array([0, 0, 1, 0, 0, 1, 0, 0, 1]), new Uint32Array([0, 1, 2]),
  );
  mesh.material = material;
  mesh.renderOrder = SEE_THROUGH_ORDER.veil;
  setMeshVisible(mesh, false);
  addToScene(scene, mesh);

  let shown = false;
  let bound: GPUTextureView | null = null;
  let disposed = false;
  const sent = { shape: [Number.NaN, 0, 0, 0], stare: [Number.NaN, 0, 0, 0] };
  const moved = (was: number[], now: readonly number[]): boolean => {
    let changed = false;
    for (let i = 0; i < 4; i++) {
      if (was[i] !== now[i]) {
        was[i] = now[i] as number;
        changed = true;
      }
    }
    return changed;
  };

  return {
    mesh,
    get shown() {
      return shown;
    },
    update(mask, shades, stare, width, height) {
      if (disposed) return;
      const reads = shades && mask !== null;
      const now = veilShown(stare, reads);
      if (now !== shown) {
        shown = now;
        setMeshVisible(mesh, now);
      }
      if (!now) return;
      // The mask as it stands: another picture once its size has moved with the frame's.
      const view = reads ? (mask as Texture2D).view : black.view;
      if (view !== bound) {
        bound = view;
        setShaderTexture(material, "shadeSampler", reads ? (mask as Texture2D) : black);
      }
      veilUniforms(stare, reads, width, height, values);
      if (moved(sent.shape, values.shadeShape)) setShaderUniform(material, "shadeShape", values.shadeShape);
      if (moved(sent.stare, values.stareShade)) setShaderUniform(material, "stareShade", values.stareShade);
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      removeFromScene(scene, mesh);
      disposeMeshGpu(mesh);
      letGo();
    },
  };
}
