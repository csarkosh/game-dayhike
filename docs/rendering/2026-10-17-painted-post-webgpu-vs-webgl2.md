# The painted post chain on WebGPU and WebGL2

**Question:** the painted look (`2026-10-17-painted-look-design.md`) is two
fragment shaders written once in GLSL, the paint pass and the grade with its
palette, run by Babylon 9.18 on WebGPU for the high tier and on WebGL2 for the
rest. The scene-depth work (`2026-10-16-scene-depth-webgpu-vs-webgl2.md`)
found six places the two APIs part ways for a post process that reads depth.
Which did a painterly post chain meet, and what does the same shader cost on
each engine?

**Short answer:** four places, and the one that cost most was not an API's
rule but a translation's habit. The paint pass's loops, bounded by the radius
uniform with a `continue` inside, translate and run. Its textbook shape, the
eight sectors' sums in function-scope arrays indexed by the sector loop,
costs 12.5 ms on WebGPU against 2.1 ms on WebGL2 at the medium tier; the same
sums as named variables, a function called eight times a tap with the
sector a constant, cost 2.3 ms on both. The uniformity analysis accepts the
pass's reads, which are inside loops whose exits depend on uniforms, and the
reads are made at an explicit level besides; the finish pass turns the
analysis off for itself with Babylon's per-shader define, which the WGSL
lookup keys on. The palette's nine uniforms are nine calls a draw on WebGL2
and one buffer with 16-byte alignment on WebGPU, which the engine hides. And a
frame rate read with no post chain at all is the display's 60 on WebGPU
unless the cap is turned off in Chrome, so a cost measured as a difference
of frame rates was wrong by the whole cap until it was. The trap that took
longest was the same on both: strokes on linear HDR colour.

## 1. The pass's three shapes

The generalized Kuwahara filter (`paint.fragment.fx`), 8 sectors, radius 2 px
on the medium tier (25 taps), measured at the meadow pose (`seed pine`, free
camera at 90, -316, yaw 0.8), 1200 by 675, frames counted over 15 s after
30 s of settling, Chrome with `--disable-frame-rate-limit --disable-gpu-vsync`,
on the apple-base Mac:

| Shape | WebGL2 | WebGPU |
|---|---|---|
| no pass | 55.3 fps, 18.1 ms | 76.9 fps, 13.0 ms |
| sector arrays, loops to the reach | 49.6 fps, 20.2 ms (+2.1 ms) | 39.3 fps, 25.5 ms (+12.5 ms) |
| named sums, loops to the radius | 49.1 fps, 20.4 ms (+2.3 ms) | 65.5 fps, 15.3 ms (+2.3 ms) |

A third shape, the sectors one after another with their own scan of the
window each (no array, eight times the reads), measured with the cap on and
under it: 34.4 fps on WebGL2 and 37.0 on WebGPU, worse than the arrays on
WebGL2 and about the arrays' on WebGPU, so the reads were its cost.

Why the arrays: on WebGL2, ANGLE translates GLSL ES 3.00 to Metal directly;
on WebGPU, Babylon translates GLSL to SPIR-V with glslang and that to WGSL
with Tint, and Dawn compiles the WGSL to Metal. A function-scope array
indexed by a loop variable is a variable in WGSL's function address space
whose elements are addressed at run time; the compiler at the end of the
longer chain kept the eight accumulators in memory and every tap's eight
updates went through it. Named variables, each updated by an inlined call
with its sector's direction a constant, stay in registers on both. The
window's loops now run to the radius (`int reach = int(ceil(r))`), not to the
fixed reach of 6 with a `continue` for every tap past it, which was 169
iterations for 25 taps.

The radius-1 measurement, 9 taps, was a check on the cause: 87.7 fps on
WebGPU with the array shape, no slower than no pass at all, and 49.7 on
WebGL2, the same as radius 2. On WebGPU the cost rose with the taps' array
updates; on WebGL2 the loop's 169 iterations were the cost whatever the
radius.

## 2. Uniformity

The paint pass reads the scene inside loops. WGSL refuses a `textureSample`
that is not in uniform control flow (the scene-depth doc §2); the loops' exits
here depend on the loop counters, on the radius uniform and on the tap's
place in its sector, none per pixel, so the analysis accepts them. The reads
are `textureLod` at level 0 besides, the explicit-level form that needs no
analysis, which costs nothing on a one-level target (measured: no difference
between the two forms on either engine).

The finish pass (`finish.fragment.fx`) reads the scene a second time under a
branch on `vUV`, the peripheral overlap, and turns the analysis off for
itself: `finishFragmentFor(webgpu)` in `post.ts` prepends Babylon's
`#define DISABLE_UNIFORMITY_ANALYSIS`, which the WebGPU engine reads from the
stage's code and hands Tint as `diagnostic(off, derivative_uniformity)`. The
corpus records such a stage as `<id>.fragment.uniformity-off.glsl`
(`tools/wgsl/lib/corpus.mjs`), 153 of 1094 stages at this writing, and the
lookup's key carries both the page-wide switch
(`WebGPUTintWASM.DisableUniformityAnalysis`, left on) and the stage's own
(`wgslFormat.ts` `uniformityOff`), so a translation made under one setting is
never served under the other.

## 3. The palette's uniforms

The grade takes nine more uniforms for the palette (three `vec3` tints, three
`vec2` amounts, a saturation, a `vec2` curve, a `vec3` lift), set from the
`PaintPalette` record in `grade.onApply`. On WebGL2 each is a uniform location
and a call; on WebGPU Babylon packs a post process's uniforms into one uniform
buffer under WGSL's layout rules, a `vec3<f32>` 12 bytes in size and aligned to
16, a `vec2<f32>` aligned to 8. Nothing in the shader or the record changes for
that; what it decides is the shape to declare a palette in if it ever grows
to many sets a frame: a tint and its density as one `vec4`, the saturation
beside the next, 16 bytes a band and one set each.

## 4. The targets

The chain runs on linear colour in a half-float target: `EXT_color_buffer_float`
on WebGL2, `rgba16float` on WebGPU, `fxSupportedBy` asking for either. The
paint pass is first in the chain where there is no prepass and second after
`farSoft` where there is one (`first = farSoft ?? paint ?? scenePass ??
grade`), and carries the chain's multisampling on its input as the first pass
always did. Nothing here differed between the engines beyond what the
scene-depth doc found for the prepass.

## 5. The trap that was the same on both

Strokes on linear HDR colour: at a low sun the crowns against the sky went
cyan-white with holes on both engines (the painted-look doc §3 has the
account). The statistics are taken on the colour compressed toward 1, the
output is the sectors' mean of the linear colour, capped at 64, and a sector
far from the pixel's own colour weighs less. The grade's value curve rolls
off above the upper midtones for the same leaf.

## 6. Not measured

The rig pairs on a discrete GPU, where the array shape may cost what it
should. The anisotropic form of the filter, whose structure tensor is a pass
of its own, a fragment pass to a texture on WebGL2 and that or a compute pass
on WebGPU. And whether Tint, given the array shape directly in WGSL rather
than through SPIR-V, would keep the accumulators in registers: the shape was
changed instead.
