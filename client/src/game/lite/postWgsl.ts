/**
 * The post chain's passes in WGSL, for Babylon Lite: the game's fragment
 * shaders (`farSoft.fragment.glsl`, `taa.fragment.glsl`,
 * `taaSharpen.fragment.glsl`, `paint.fragment.glsl`, `paintCompose.fragment.glsl`,
 * `halationExtract.fragment.glsl`, `grade.fragment.glsl`, `lens.fragment.glsl`)
 * statement for statement, and how a pass's uniforms are laid out from the
 * record `postFrame.ts` makes of them.
 *
 * What differs from the GLSL is where a pass reads and writes, never what
 * it computes:
 *
 * - **A pass computes in the game's coordinates**, `vUV` counting up the
 *   frame from its foot, and turns it over only where it reads a texture
 *   (`tx`): a texture's rows count down from its top.
 * - **The depth is the frame's own.** The game draws each pixel's distance
 *   along the view as a second target of its scene's pass, four samples a
 *   pixel, resolved to their mean, 0 where nothing was drawn. Here the
 *   scene's pass has one target, and its depth buffer is read instead: a
 *   pass of four reads a pixel (`DEPTH_RESOLVE`) turns each sample's depth
 *   into its distance (Lite's depth runs from 1 at the near plane to 0 where
 *   nothing was drawn) and writes their mean, which the far softening and
 *   the anti-aliasing then read as the game's passes read theirs.
 * - **The compose is the grade's first statement.** The game's compose
 *   writes a frame that only the grade reads, each pixel at its own place,
 *   so the two are one pass here (`gradeWgsl`), and on the tier with the
 *   halation the extract makes the composed frame's four texels under each
 *   of its own for itself (`HALATION_EXTRACT`), as the bilinear read of the
 *   game's does.
 * - **What a frame does not show is not worked out.** The grade's shade
 *   block (seventeen reads of the mask) runs only while a figure is in the
 *   mask, its stare block only while the darkness has closed at all and the
 *   chase's cast only while it is in; the halation is read only on the tier
 *   that makes it. In the GLSL each is multiplied by its gate.
 *
 * Loads nothing.
 */
import { PAINT_REACH } from "../postParams.js";
import postVertexSource from "../shaders/post/post.vertex.wgsl?raw";
import depthResolveFragmentSource from "../shaders/post/depthResolve.fragment.wgsl?raw";
import farSoftFragmentSource from "../shaders/post/farSoft.fragment.wgsl?raw";
import taaFragmentSource from "../shaders/post/taa.fragment.wgsl?raw";
import taaSharpenFragmentSource from "../shaders/post/taaSharpen.fragment.wgsl?raw";
import paintFragmentSource from "../shaders/post/paint.fragment.wgsl?raw";
import composeSource from "../shaders/post/compose.wgsl?raw";
import halationExtractFragmentSource from "../shaders/post/halationExtract.fragment.wgsl?raw";
import blurFragmentSource from "../shaders/post/blur.fragment.wgsl?raw";
import shadeHelpersSource from "../shaders/post/shadeHelpers.wgsl?raw";
import shadeBlockSource from "../shaders/post/shadeBlock.wgsl?raw";
import stareBlockSource from "../shaders/post/stareBlock.wgsl?raw";
import gradeHalationSource from "../shaders/post/gradeHalation.wgsl?raw";
import gradeFragmentSource from "../shaders/post/grade.fragment.wgsl?raw";
import lensFragmentSource from "../shaders/post/lens.fragment.wgsl?raw";
import { fill, wgsl } from "../shaders/shaderText.js";

/** A uniform's WGSL type by how many floats its record holds: nine are a 3 by 3 matrix, column by column. */
const TYPES: Readonly<Record<number, { type: string; align: number; size: number }>> = {
  1: { type: "f32", align: 4, size: 4 },
  2: { type: "vec2<f32>", align: 8, size: 8 },
  3: { type: "vec3<f32>", align: 16, size: 12 },
  4: { type: "vec4<f32>", align: 16, size: 16 },
  9: { type: "mat3x3<f32>", align: 16, size: 48 },
};

/** A pass's uniforms as WGSL lays them out: the struct's text, each field's offset in floats, and the struct's size in bytes. */
export type PassLayout = { readonly struct: string; readonly offsets: ReadonlyMap<string, number>; readonly bytes: number };

/** The layout of `record`'s fields, in the record's own order, as the struct `U`. */
export function passLayout(record: Readonly<Record<string, ArrayLike<number>>>): PassLayout {
  const offsets = new Map<string, number>();
  const fields: string[] = [];
  let at = 0;
  for (const [name, value] of Object.entries(record)) {
    const kind = TYPES[value.length];
    if (kind === undefined) throw new Error(`the uniform ${name} has ${value.length} floats, which no WGSL type holds`);
    at = Math.ceil(at / kind.align) * kind.align;
    offsets.set(name, at / 4);
    fields.push(`${name}:${kind.type}`);
    at += kind.size;
  }
  return { struct: `struct U{${fields.join(",")}}`, offsets, bytes: Math.max(16, Math.ceil(at / 16) * 16) };
}

/** Writes `record` into `data` from float `base` on, by `layout`: a matrix's columns three floats each, a column every four. */
export function writePass(data: Float32Array, base: number, layout: PassLayout, record: Readonly<Record<string, ArrayLike<number>>>): void {
  for (const name in record) {
    const offset = layout.offsets.get(name);
    if (offset === undefined) throw new Error(`no uniform ${name} in the pass's layout`);
    const value = record[name] as ArrayLike<number>;
    const at = base + offset;
    if (value.length === 9) {
      for (let column = 0; column < 3; column++) for (let row = 0; row < 3; row++) data[at + column * 4 + row] = value[column * 3 + row] as number;
    } else {
      for (let i = 0; i < value.length; i++) data[at + i] = value[i] as number;
    }
  }
}

/** The stage every pass shares: one triangle over the frame, `vUV` counting up from the frame's foot as the game's does. */
export const POST_VERTEX_WGSL = wgsl(postVertexSource);

/**
 * The depth's resolve: each of a pixel's samples as its distance along the
 * view, `depthTerms.y / (d - depthTerms.x)` with the projection's two depth
 * terms, 0 where nothing was drawn, and their mean. `samples` is how many
 * samples a pixel the scene's pass has.
 */
export function depthResolveWgsl(samples: number): string {
  return fill(wgsl(depthResolveFragmentSource), { samples });
}

/** farSoft.fragment.glsl. */
export const FAR_SOFT_WGSL = wgsl(farSoftFragmentSource);

/** taa.fragment.glsl. */
export const TAA_WGSL = wgsl(taaFragmentSource);

/** taaSharpen.fragment.glsl. */
export const TAA_SHARPEN_WGSL = wgsl(taaSharpenFragmentSource);

/** paint.fragment.glsl: its eight sectors' sums as arrays, where the GLSL names each. */
export const PAINT_WGSL = fill(wgsl(paintFragmentSource), { paintReach: PAINT_REACH });

/**
 * paintCompose.fragment.glsl as a function of the place: `composed(uv)` is
 * the pixel the game's compose writes there, from the strokes
 * (`paintSampler`, the GLSL's `textureSampler`) and the frame they were
 * painted from (`sceneSampler`).
 */
const COMPOSE_WGSL = wgsl(composeSource);

/**
 * halationExtract.fragment.glsl, at a quarter of the frame on each axis. The
 * game's reads the composed frame once, bilinearly, at its own texel's
 * centre, which is the mean of the four composed texels round it; here
 * those four are composed in place (`texel` is the full frame's).
 */
export const HALATION_EXTRACT_WGSL = fill(wgsl(halationExtractFragmentSource), { compose: COMPOSE_WGSL });

/** The kernel Babylon.js's blur pass takes for the one it is asked for: the nearest odd one whose half is even, so its taps pair up either side of the centre. */
export function blurKernel(ideal: number): number {
  const v = Math.round(Math.max(ideal, 1));
  for (const k of [v, v - 1, v + 1, v - 2, v + 2]) {
    if (k % 2 !== 0 && Math.floor(k / 2) % 2 === 0 && k > 0) return Math.max(k, 3);
  }
  return Math.max(v, 3);
}

/** A blur's reads, in texels from the centre along its axis, and the weight of each, as Babylon.js's blur pass makes them for `kernel`. */
export function blurTaps(kernel: number): { offsets: number[]; weights: number[] } {
  // Babylon.js's `BlurPostProcess`: a Gaussian of sigma a third of the kernel's half-width, its weights summing to
  // one, neighbouring taps joined into one linear read each.
  const n = blurKernel(kernel);
  const centre = (n - 1) / 2;
  const gaussian = (x: number): number => {
    const sigma = 1 / 3;
    const denominator = Math.sqrt(2.0 * Math.PI) * sigma;
    const exponent = -((x * x) / (2.0 * sigma * sigma));
    return (1.0 / denominator) * Math.exp(exponent);
  };
  let offsets: number[] = [];
  let weights: number[] = [];
  let total = 0;
  for (let i = 0; i < n; i++) {
    const u = i / (n - 1);
    const w = gaussian(u * 2.0 - 1);
    offsets[i] = i - centre;
    weights[i] = w;
    total += w;
  }
  for (let i = 0; i < weights.length; i++) weights[i] = (weights[i] as number) / total;
  // Pairs either side of the centre become one read between them, by their weights.
  const linearOffsets: number[] = [];
  const linearWeights: number[] = [];
  const merged: [number, number][] = [];
  for (let i = 0; i <= centre; i += 2) {
    const j = Math.min(i + 1, Math.floor(centre));
    if (i === j) merged.push([offsets[i] as number, weights[i] as number]);
    else {
      const shared = j === centre;
      const weightLinear = (weights[i] as number) + (weights[j] as number) * (shared ? 0.5 : 1.0);
      const offsetLinear = (offsets[i] as number) + 1 / (1 + (weights[i] as number) / (weights[j] as number));
      if (offsetLinear === 0) {
        merged.push([offsets[i] as number, weights[i] as number]);
        merged.push([(offsets[i] as number) + 1, weights[i + 1] as number]);
      } else {
        merged.push([offsetLinear, weightLinear]);
        merged.push([-offsetLinear, weightLinear]);
      }
    }
  }
  for (const [o, w] of merged) {
    linearOffsets.push(o);
    linearWeights.push(w);
  }
  offsets = linearOffsets;
  weights = linearWeights;
  return { offsets, weights };
}

/** A blur pass along `delta` (a texel along its axis): Babylon.js's kernel blur, its taps as `blurTaps` gives them. */
export function blurWgsl(kernel: number): string {
  const { offsets, weights } = blurTaps(kernel);
  // Eight decimals each, as Babylon.js writes them into its shader.
  const taps = offsets.map((o, i) => `  blend+=textureSampleLevel(textureSampler,postSampler,tx(vUV+u.delta*${o.toFixed(8)}),0.0)*${(weights[i] as number).toFixed(8)};`).join("\n");
  return fill(wgsl(blurFragmentSource), { taps });
}

/** grade.fragment.glsl's blotches for the shades' going: one octave of value noise on a hash. */
export const SHADE_HELPERS_WGSL = wgsl(shadeHelpersSource);

/**
 * grade.fragment.glsl's shade block: the mask read back through its blur
 * (`shadeRead`, the reader's own) and the frame `c` darkened by the figure,
 * only while a figure is in the mask. The veil on the tiers with no chain
 * runs the same text (`shadeVeil.ts`), as the game's veil carries the
 * grade's block.
 */
export const SHADE_BLOCK_WGSL = wgsl(shadeBlockSource);

/** grade.fragment.glsl's stare block: the darkness closing on an open centre (`centred` the place from the frame's middle), only while it has closed at all. */
export const STARE_BLOCK_WGSL = wgsl(stareBlockSource);

/**
 * grade.fragment.glsl, the compose ahead of it. `halation`: the tier makes a
 * halation, read from `halationSampler`; without it the GLSL screens the
 * frame with black, which changes nothing, and nothing is read here.
 */
export function gradeWgsl(halation: boolean): string {
  return fill(wgsl(gradeFragmentSource), { halationBinding: halation ? "@group(0)@binding(5)var halationSampler:texture_2d<f32>;" : "", compose: COMPOSE_WGSL, shadeHelpers: SHADE_HELPERS_WGSL, shadeBlock: SHADE_BLOCK_WGSL, halation: halation ? wgsl(gradeHalationSource) : "", stareBlock: STARE_BLOCK_WGSL });
}

/** lens.fragment.glsl. */
export const LENS_WGSL = wgsl(lensFragmentSource);
