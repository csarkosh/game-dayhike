/**
 * What the post chain's passes are drawn with, a frame, with no engine: each
 * pass's uniforms as a record by the names its shader reads, the state that
 * runs from frame to frame (the anti-aliasing's last camera, the lens's
 * gate, the palette's fade), and the passes a tier runs with the size each
 * writes. `postParams.ts` has the tier ladder and the passes' constants,
 * `gradeParams.ts` the grade's record; the chain (`lite/postChain.ts`)
 * takes its values from here.
 *
 * Loads no engine.
 */
import { CHASE_LIFT, CHASE_TINT, mixPalette, PAINT_FADE_SECONDS, PAINT_OILS, type GradeRecord, type PaintPalette } from "./gradeParams.js";
import { LENS } from "@csarkosh/engine/game/lensParams";
import {
  PAINT_SCALE, PAINT_STRENGTH, TAA_BLEND, TAA_CLIP, TAA_SHARPEN, paintTargetSize, paintTexelRadius, taaBlendFor, taaCameraPixels, taaJitter,
  type PostFeatures,
} from "@csarkosh/engine/game/postParams";

/** How long the lens's strength sits under its floor before the pass is detached. */
export const LENS_IDLE_S = 1;
/** The shades' blur radius as a share of the frame's width, and how dark the mask makes the frame at full. */
export const SHADE_BLUR = 0.015;
/** How much darker a shade is than what stands behind it, the mist: a little, not black; and the real one, black, nearer to whole. */
export const SHADE_DARK = 0.3;
export const SHADE_MONSTER_DARK = 1;
/** The end's blur at its fullest, in texels: soft, not a wash. */
export const END_BLUR_KERNEL = 28;
/** The kernels the end's blur steps through: a blur pass compiles afresh for each kernel it is given, so a smooth ramp would compile every frame; three steps compile three times. */
export const END_BLUR_STEPS = 3;

/** The kernel for a blur of 0 to 1: none below the first step, then END_BLUR_STEPS even steps up to END_BLUR_KERNEL. */
export function endBlurKernel(blur: number): number {
  const step = Math.min(END_BLUR_STEPS, Math.ceil(Math.max(0, Math.min(1, blur)) * END_BLUR_STEPS));
  return (END_BLUR_KERNEL / END_BLUR_STEPS) * step;
}

/** The far softening's band of camera depth (m) and its radius at the band's end, in texels. */
export const FAR_SOFT_BAND: readonly [number, number] = [80, 450];
export const FAR_SOFT_RADIUS = 5;

/** The far softening's uniforms for the ground cloud it marches (farSoft.fragment.glsl). */
export const FAR_CLOUD_UNIFORMS = [
  "farEye", "farForward", "farRight", "farUp", "atmSunDir", "atmSunColour",
  "atmCloudDensity", "atmCloudSteps", "atmCloudRange", "atmCloudFalloff", "atmCloudSeat", "atmCloudGroundRange",
  "atmCloudNear", "atmCloudTrail", "atmCloudNoiseScale", "atmCloudWind", "atmCloudGlow", "atmCloudColour", "atmCloudGroundRect",
] as const;

/** The share of the frame, on each axis, every pass of the halation's chain reads and writes at: the extract, the two blurs. */
export const HALATION_RATIO = 0.25;
/** The halation's blur, in texels of its quarter-size targets. */
export const HALATION_KERNEL = 32;

/** The seconds the lens's clock folds over, so the sliding drops' saw-tooth keeps its precision on a long hike. */
export const LENS_FOLD_S = 3600;

/** A point or an axis in the world. */
export type PostVec = { readonly x: number; readonly y: number; readonly z: number };

/**
 * The camera a frame is seen through, as the chain's passes rebuild a
 * pixel's ray from it: its eye, its three unit axes (x right, y up, z
 * forward), its vertical field of view (radians) and the frame's width over
 * its height.
 */
export type PostView = { eye: PostVec; forward: PostVec; right: PostVec; up: PostVec; fov: number; aspect: number };

type V2 = [number, number];
type V3 = [number, number, number];
type V4 = [number, number, number, number];

function set3(out: V3, v: PostVec, scale = 1): void {
  out[0] = v.x * scale;
  out[1] = v.y * scale;
  out[2] = v.z * scale;
}

// ---- The far softening. ----

/** The far softening's own uniforms; the ground cloud's are the atmosphere's (`cloudUniforms`, the sun's two beside them). */
export type FarSoftUniforms = { texel: V2; soft: V3; farEye: V3; farForward: V3; farRight: V3; farUp: V3 };

export function emptyFarSoftUniforms(): FarSoftUniforms {
  return { texel: [0, 0], soft: [0, 0, 0], farEye: [0, 0, 0], farForward: [0, 0, 0], farRight: [0, 0, 0], farUp: [0, 0, 0] };
}

/**
 * The far softening's uniforms for a frame `width` by `height` seen through
 * `view`: a texel, the band and its radius, and the ray through a pixel as
 * the camera's forward plus the pixel's place across the view, the right
 * and up axes each at the half view's tangent.
 */
export function farSoftUniforms(view: PostView, width: number, height: number, out: FarSoftUniforms = emptyFarSoftUniforms()): FarSoftUniforms {
  out.texel[0] = 1 / width;
  out.texel[1] = 1 / height;
  out.soft[0] = FAR_SOFT_BAND[0];
  out.soft[1] = FAR_SOFT_BAND[1];
  out.soft[2] = FAR_SOFT_RADIUS;
  const tanY = Math.tan(view.fov / 2);
  const tanX = tanY * view.aspect;
  set3(out.farForward, view.forward);
  set3(out.farRight, view.right, tanX);
  set3(out.farUp, view.up, tanY);
  set3(out.farEye, view.eye);
  return out;
}

// ---- The temporal anti-aliasing. ----

/** The anti-aliasing's uniforms: a texel, the camera's basis this frame and last (the right and up axes each at the half view's tangent), and (the new frame's share, the clip, whether there is a history). */
export type TaaUniforms = {
  texel: V2; taaEye: V3; taaForward: V3; taaRight: V3; taaUp: V3; taaPrevEye: V3; taaPrevForward: V3; taaPrevRight: V3; taaPrevUp: V3; taaParams: V3;
};

export function emptyTaaUniforms(): TaaUniforms {
  return {
    texel: [0, 0], taaEye: [0, 0, 0], taaForward: [0, 0, 0], taaRight: [0, 0, 0], taaUp: [0, 0, 0],
    taaPrevEye: [0, 0, 0], taaPrevForward: [0, 0, 0], taaPrevRight: [0, 0, 0], taaPrevUp: [0, 0, 0], taaParams: [0, 0, 0],
  };
}

/** The anti-aliasing from frame to frame: the jitter's walk and the camera the last frame was seen through. */
export type TaaFrame = {
  /** The projection's offset for the next frame drawn, in clip units (`taaJitter`), a step on along the walk each call. */
  jitter(width: number, height: number): { x: number; y: number };
  /**
   * The pass's uniforms for a frame seen through `view`, which becomes the
   * last camera. The first frame, and the first after `reset`, has no
   * history: last frame's basis is this frame's, and the blend is held off.
   */
  step(view: PostView, width: number, height: number, out?: TaaUniforms): TaaUniforms;
  /** The history is gone (its targets were made again): the next frame starts one. */
  reset(): void;
  /** Whether a history stands. */
  readonly valid: boolean;
};

export function createTaaFrame(): TaaFrame {
  let frame = 0;
  let valid = false;
  const prev = { eye: [0, 0, 0] as V3, f: [0, 0, 0] as V3, r: [0, 0, 0] as V3, u: [0, 0, 0] as V3 };
  return {
    get valid() {
      return valid;
    },
    jitter: (width, height) => taaJitter(frame++, width, height),
    reset() {
      valid = false;
    },
    step(view, width, height, out = emptyTaaUniforms()) {
      out.texel[0] = 1 / width;
      out.texel[1] = 1 / height;
      const tanY = Math.tan(view.fov / 2);
      const tanX = tanY * view.aspect;
      set3(out.taaForward, view.forward);
      set3(out.taaRight, view.right, tanX);
      set3(out.taaUp, view.up, tanY);
      set3(out.taaEye, view.eye);
      if (!valid) {
        prev.eye = [...out.taaEye];
        prev.f = [...out.taaForward];
        prev.r = [...out.taaRight];
        prev.u = [...out.taaUp];
      }
      out.taaPrevEye = [...prev.eye];
      out.taaPrevForward = [...prev.f];
      out.taaPrevRight = [...prev.r];
      out.taaPrevUp = [...prev.u];
      // The blend by how far the camera moved since the last frame: its turn, the angle between the two forward axes,
      // and its step. A still camera blends gently, so the jitter's swing on a trunk thinner than a pixel does not
      // come through (TAA_BLEND_STILL).
      const [ax, ay, az] = prev.f;
      const [bx, by, bz] = out.taaForward;
      const cross = Math.hypot(ay * bz - az * by, az * bx - ax * bz, ax * by - ay * bx);
      const turn = Math.atan2(cross, ax * bx + ay * by + az * bz);
      const move = Math.hypot(prev.eye[0] - out.taaEye[0], prev.eye[1] - out.taaEye[1], prev.eye[2] - out.taaEye[2]);
      out.taaParams[0] = valid ? taaBlendFor(taaCameraPixels(turn, move, view.fov, height)) : TAA_BLEND;
      out.taaParams[1] = TAA_CLIP;
      out.taaParams[2] = valid ? 1 : 0;
      prev.eye = [...out.taaEye];
      prev.f = [...out.taaForward];
      prev.r = [...out.taaRight];
      prev.u = [...out.taaUp];
      valid = true;
      return out;
    },
  };
}

/** The sharpen's uniforms: a texel of the frame, and how far the detail is lifted. */
export type SharpenUniforms = { texel: V2; sharpen: [number] };

export function sharpenUniforms(width: number, height: number, out: SharpenUniforms = { texel: [0, 0], sharpen: [0] }): SharpenUniforms {
  out.texel[0] = 1 / width;
  out.texel[1] = 1 / height;
  out.sharpen[0] = TAA_SHARPEN;
  return out;
}

// ---- The paint and its compose. ----

/** The paint's uniforms: a texel of its own half-size target, and the stroke's radius in those texels. */
export type PaintUniforms = { texel: V2; radius: [number] };

/** The paint's uniforms for the tier's `strokes` (`PostFeatures.paint`) on a frame `width` by `height` (see `paintUniformsDrawn` for the size the game's chain hands it). */
export function paintUniforms(strokes: number, width: number, height: number, out: PaintUniforms = { texel: [0, 0], radius: [0] }): PaintUniforms {
  const target = paintTargetSize(width, height);
  out.texel[0] = 1 / target.width;
  out.texel[1] = 1 / target.height;
  out.radius[0] = paintTexelRadius(strokes, height);
  return out;
}

/**
 * The paint's uniforms as the chain draws them on a frame `width` by
 * `height`. The paint writes its own half-size target and lays its strokes
 * out by that target's size, so this hands `paintUniforms` that size where
 * the frame's is given (`lite/postChain.ts`). A texel is then two of the
 * half-size target's own on each axis, and the radius is that of a frame
 * half as tall.
 */
export function paintUniformsDrawn(strokes: number, width: number, height: number, out?: PaintUniforms): PaintUniforms {
  const own = paintTargetSize(width, height);
  return paintUniforms(strokes, own.width, own.height, out);
}

/** The compose's uniforms: a texel of the half-size strokes, and how far the painted frame replaces the rendered one. */
export type ComposeUniforms = { halfTexel: V2; strength: [number] };

export function composeUniforms(width: number, height: number, out: ComposeUniforms = { halfTexel: [0, 0], strength: [0] }): ComposeUniforms {
  const target = paintTargetSize(width, height);
  out.halfTexel[0] = 1 / target.width;
  out.halfTexel[1] = 1 / target.height;
  out.strength[0] = PAINT_STRENGTH;
  return out;
}

// ---- The halation's extract. ----

/** The extract's uniform: the frame's exposure, which the grade's record carries. */
export type ExtractUniforms = { exposure: [number] };

export function extractUniforms(record: GradeRecord, out: ExtractUniforms = { exposure: [0] }): ExtractUniforms {
  out.exposure[0] = record.exposure;
  return out;
}

// ---- The grade. ----

type M3 = [number, number, number, number, number, number, number, number, number];

/** The grade's uniforms by name (grade.fragment.glsl): the two matrices nine floats each, column by column. */
export type GradeUniforms = {
  texelSize: V2; time: [number]; exposure: [number]; whitePoint: M3; purkinje: M3; purkinjeThreshold: [number]; purkinjeStrength: [number];
  shadowTint: V3; shadowAmount: V2; midtoneTint: V3; midtoneAmount: V2; highlightTint: V3; highlightAmount: V2;
  saturation: [number]; lift: V3; vignetteWeight: [number]; vignetteColour: V3;
  paintShadowTint: V3; paintShadowAmount: V2; paintMidtoneTint: V3; paintMidtoneAmount: V2; paintHighlightTint: V3; paintHighlightAmount: V2;
  paintSaturation: [number]; paintCurve: V2; paintLift: V3;
  halationStrength: [number]; stareShade: V4; chaseTint: V4; chaseLift: V3; shadeShape: V4; shadeMonster: [number];
};

export function emptyGradeUniforms(): GradeUniforms {
  const m3 = (): M3 => [0, 0, 0, 0, 0, 0, 0, 0, 0];
  return {
    texelSize: [0, 0], time: [0], exposure: [0], whitePoint: m3(), purkinje: m3(), purkinjeThreshold: [0], purkinjeStrength: [0],
    shadowTint: [0, 0, 0], shadowAmount: [0, 0], midtoneTint: [0, 0, 0], midtoneAmount: [0, 0], highlightTint: [0, 0, 0], highlightAmount: [0, 0],
    saturation: [0], lift: [0, 0, 0], vignetteWeight: [0], vignetteColour: [0, 0, 0],
    paintShadowTint: [0, 0, 0], paintShadowAmount: [0, 0], paintMidtoneTint: [0, 0, 0], paintMidtoneAmount: [0, 0], paintHighlightTint: [0, 0, 0],
    paintHighlightAmount: [0, 0], paintSaturation: [0], paintCurve: [0, 0], paintLift: [0, 0, 0],
    halationStrength: [0], stareShade: [0, 0, 0, 0], chaseTint: [0, 0, 0, 0], chaseLift: [0, 0, 0], shadeShape: [0, 0, 0, 0], shadeMonster: [0],
  };
}

function tint(colour: V3, amount: V2, t: { r: number; g: number; b: number; density: number; saturation: number }): void {
  colour[0] = t.r;
  colour[1] = t.g;
  colour[2] = t.b;
  amount[0] = t.density;
  amount[1] = t.saturation;
}

/**
 * The grade's uniforms for a frame `width` by `height`: the record's values
 * under the shader's names, the dither's clock (`seconds`), and the shades'
 * shape, whose last value is 1 while `shades` (a mask is bound and a figure
 * is in it) and 0 to draw none of them.
 */
export function gradeUniforms(record: GradeRecord, width: number, height: number, seconds: number, shades: boolean, out: GradeUniforms = emptyGradeUniforms()): GradeUniforms {
  const r = record;
  out.texelSize[0] = 1 / width;
  out.texelSize[1] = 1 / height;
  out.time[0] = seconds;
  out.exposure[0] = r.exposure;
  for (let i = 0; i < 9; i++) {
    out.whitePoint[i] = r.whitePoint[i] as number;
    out.purkinje[i] = r.purkinje[i] as number;
  }
  out.purkinjeThreshold[0] = r.purkinjeThreshold;
  out.purkinjeStrength[0] = r.purkinjeStrength;
  tint(out.shadowTint, out.shadowAmount, r.shadows);
  tint(out.midtoneTint, out.midtoneAmount, r.midtones);
  tint(out.highlightTint, out.highlightAmount, r.highlights);
  out.saturation[0] = r.saturation;
  out.lift[0] = r.lift.r;
  out.lift[1] = r.lift.g;
  out.lift[2] = r.lift.b;
  out.vignetteWeight[0] = r.vignetteWeight;
  out.vignetteColour[0] = r.vignetteColour.r;
  out.vignetteColour[1] = r.vignetteColour.g;
  out.vignetteColour[2] = r.vignetteColour.b;
  const p = r.paint;
  tint(out.paintShadowTint, out.paintShadowAmount, p.shadows);
  tint(out.paintMidtoneTint, out.paintMidtoneAmount, p.midtones);
  tint(out.paintHighlightTint, out.paintHighlightAmount, p.highlights);
  out.paintSaturation[0] = p.saturation;
  out.paintCurve[0] = p.contrast;
  out.paintCurve[1] = p.pivot;
  out.paintLift[0] = p.lift.r;
  out.paintLift[1] = p.lift.g;
  out.paintLift[2] = p.lift.b;
  out.halationStrength[0] = r.halationStrength;
  out.stareShade[0] = r.stare.x;
  out.stareShade[1] = r.stare.y;
  out.stareShade[2] = r.stare.reach;
  out.stareShade[3] = r.stare.time;
  out.chaseTint[0] = CHASE_TINT.r;
  out.chaseTint[1] = CHASE_TINT.g;
  out.chaseTint[2] = CHASE_TINT.b;
  out.chaseTint[3] = r.chase;
  out.chaseLift[0] = CHASE_LIFT.r;
  out.chaseLift[1] = CHASE_LIFT.g;
  out.chaseLift[2] = CHASE_LIFT.b;
  out.shadeShape[0] = SHADE_BLUR;
  out.shadeShape[1] = SHADE_DARK;
  out.shadeShape[2] = width / height;
  out.shadeShape[3] = shades ? 1 : 0;
  out.shadeMonster[0] = SHADE_MONSTER_DARK;
  return out;
}

// ---- The rain on the lens. ----

/** The lens's uniforms: its strength, its clock folded, the frame's aspect and a texel. */
export type LensUniforms = { texelSize: V2; lensStrength: [number]; time: [number]; aspect: [number] };

export function lensUniforms(strength: number, seconds: number, width: number, height: number, out: LensUniforms = { texelSize: [0, 0], lensStrength: [0], time: [0], aspect: [0] }): LensUniforms {
  out.texelSize[0] = 1 / width;
  out.texelSize[1] = 1 / height;
  out.lensStrength[0] = strength;
  out.time[0] = seconds % LENS_FOLD_S;
  out.aspect[0] = width / height;
  return out;
}

/**
 * Whether the lens's pass runs. Below the strength's floor the pass is taken
 * out and not short-circuited in the shader: a pass that writes its input
 * back still costs a full-screen read and write. It comes in at the floor
 * and goes once the strength has sat under it for `LENS_IDLE_S`.
 */
export type LensGate = {
  /** One frame at `strength`, `seconds` on the chain's clock: whether the pass runs this frame. */
  step(strength: number, seconds: number): boolean;
  readonly on: boolean;
};

export function createLensGate(): LensGate {
  let on = false;
  let idleSince: number | null = null;
  return {
    get on() {
      return on;
    },
    step(strength, seconds) {
      if (strength >= LENS.floor) {
        idleSince = null;
        on = true;
      } else {
        idleSince ??= seconds;
        if (on && seconds - idleSince >= LENS_IDLE_S) on = false;
      }
      return on;
    },
  };
}

// ---- The painted palette's fade. ----

/** The painted palette the frames wear, faded from one to the next on a clock of milliseconds. */
export type PaletteFade = {
  /** The palette the frames wear from now, faded from the one they wear over `fadeSeconds` (PAINT_FADE_SECONDS unless given; 0 at once). */
  set(palette: PaintPalette, fadeSeconds?: number): void;
  /** The palette this moment, mid-fade included. */
  now(): PaintPalette;
};

export function createPaletteFade(clock: () => number): PaletteFade {
  let from: PaintPalette = PAINT_OILS;
  let to: PaintPalette = PAINT_OILS;
  let start = 0;
  let ms = 0;
  const now = (): PaintPalette => (ms <= 0 ? to : mixPalette(from, to, (clock() - start) / ms));
  return {
    now,
    set(palette, fadeSeconds = PAINT_FADE_SECONDS) {
      from = now();
      to = palette;
      ms = Math.max(0, fadeSeconds) * 1000;
      start = clock();
    },
  };
}

// ---- The passes a tier runs. ----

/** A pass of the chain: its name, and the share of the frame, on each axis, it writes at. */
export type PostPass = { readonly name: PostPassName; readonly scale: number };
export type PostPassName = "farSoft" | "taa" | "taaSharpen" | "paint" | "paintCompose" | "scene" | "halationExtract" | "halationBlurX" | "halationBlurY" | "grade" | "lens";

/**
 * The passes of `features`' chain in the order they run, each with the size
 * it writes: the far softening, the anti-aliasing and its sharpen, the paint
 * at `PAINT_SCALE` and its compose; with the halation, the full-size copy
 * its extract reads from and its three quarter-size passes; the grade; and
 * the lens, which runs only while there is rain on the glass. None where
 * there is no chain.
 */
export function postPasses(features: PostFeatures): PostPass[] {
  if (!features.pipeline) return [];
  const passes: PostPass[] = [{ name: "farSoft", scale: 1 }];
  if (features.taa) passes.push({ name: "taa", scale: 1 }, { name: "taaSharpen", scale: 1 });
  if (features.paint > 0) passes.push({ name: "paint", scale: PAINT_SCALE }, { name: "paintCompose", scale: 1 });
  if (features.halation) {
    passes.push({ name: "scene", scale: 1 }, { name: "halationExtract", scale: HALATION_RATIO }, { name: "halationBlurX", scale: HALATION_RATIO }, { name: "halationBlurY", scale: HALATION_RATIO });
  }
  passes.push({ name: "grade", scale: 1 });
  if (features.lens) passes.push({ name: "lens", scale: 1 });
  return passes;
}
