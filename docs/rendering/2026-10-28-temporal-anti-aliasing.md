# Temporal anti-aliasing: the leaf cards' edges settled over frames

**Status:** built and measured (2026-10-28); `client/src/game/post.ts`, `client/src/game/postParams.ts`,
`client/src/game/shaders/taa.fragment.fx`, `client/src/game/shaders/taaSharpen.fragment.fx`.

## What remained after the shadow cascade was held still

The shadow cascade's three flicker causes were found and fixed on 2026-10-27
(`docs/rendering/2026-10-27-shadow-cascade-flicker.md`): the camera's motion re-phasing the
texel grid, the sun's motion re-phasing it, and the leaf-card silhouettes popping a texel at a time
in a map too coarse for the explore day's fast sun. The owner's third recording, at the explore
trailhead with the sun low behind the trees and the camera still, still blinked: 3.9 % of its
pixels, two thirds of them in the canopy against the bright sky. Captures at that hour on the Air
showed it is not shadow-driven there: the sun's direction held changed nothing, and the wind off
took it to nothing. It is the leaf cards themselves. Every card's edge is an alpha test, a whole
pixel in or out, the cards flutter in the wind, and on the medium tier the frame is 975 by 776
pixels upscaled 2.7 times onto the Air's display, so each pixel that flips is a visible speck.
Multisampling does nothing for an alpha-tested edge, and FXAA, which the chain had for exactly
this, smooths an edge within one frame but cannot stop it moving between frames.

## What the pass does

The scene is drawn each frame with the projection moved by a fraction of a pixel along an
eight-step Halton walk (`taaJitter` in `postParams.ts`, bases 2 and 3, centred, every step within
half a pixel), and the pass blends the frame into the history of the frames before it, so a pixel
over a crown averages many samples of it instead of jumping between leaf and sky. The jitter is
put on the projection matrix's third row (which multiplies by the depth, so it is the same offset
at every depth) after Babylon computes the matrix and before the scene renders, and the matrix is
computed afresh after the render so nothing else sees it.

The history is found where this pixel's point was last frame: the point is rebuilt from the
prepass's camera-space depth on the camera's ray through the pixel, as the far softening builds
it, then projected with the last frame's camera (its eye, forward axis, and right and up axes at
the half view's tangents, kept from frame to frame in `post.ts`). The sky dome, which draws no
depth, is taken as a direction. That is exact for anything that does not move by itself. What
does, the swaying leaves and the animals, is held to the colours round the pixel this frame: the
history is clipped toward the box of its 3 by 3 neighbourhood in YCoCg, narrowed to `TAA_CLIP`
standard deviations of that neighbourhood, so a stale colour cannot trail behind. The history is
read with a five-tap Catmull-Rom so it stays sharp over many frames and blended in linear light at
`TAA_BLEND` for the new frame, so a flickering speck settles at its mean brightness. A sharpen
pass follows (`taaSharpen.fragment.fx`, `TAA_SHARPEN`): an unsharp mask on the four neighbours
held inside their range, applied as the frame goes on down the chain, never to the history, so it
cannot build up.

The pass writes into one of two history targets in turn, at the frame's size and the chain's
texture type; the sharpen's input is swapped to the one just written at the anti-aliasing's
activation, which is why the sharpen never clears its target. The targets are remade when the
frame's size changes, and the first frame after, like the very first, blends nothing: the last
frame's basis is set to this frame's and the blend held off.

## Where it sits in the chain

Right after the far softening, on the scene's linear colour, before the paint: the paint smears
the frame into strokes by its edges, and an edge settled before it is a stroke that holds still.
The far softening is what asks the prepass for the depth, so the anti-aliasing is built only
where the softening is (`features.taa`, true on medium and high with the pipeline; the engine
must draw to several targets at once). Where it is built, FXAA is not: the anti-aliasing does
what FXAA did for the cards' edges, better, and the chain is a pass shorter after the grade.
Without a prepass, FXAA follows the grade as before.

## What was measured

All of it on the Air (M4, a 1300 by 1035 window at DPR 2), explore mode, the medium tier, WebGL2,
the camera still at the trailhead, the wind on. Each pair is the same page with the pass on and
off, captured one after the other, scored by the still-camera metric (each pixel's luminance
detrended by a nine-frame moving average; the share of pixels whose residual's standard deviation
exceeds 1.5 levels). The new frame's share was 0.1, down from the prototype's 0.2.

| Condition | On | Off |
|---|---|---|
| 17 h, the sun's direction held: the leaf flutter alone | 3.5 %, 0.9 % | 8.4 %, 6.0 % |
| 17 h, the sun moving, after sunset | 0.07 %, 0.01 % | 0.02 %, 0.02 % |
| 7 h, the sun's direction held | 0.16 %, 8.6 % | 0.29 %, 7.6 % |
| 7 h, the sun moving: the sunrise's dapple sweeping | 8.3 %, 14.1 % | 29.5 %, 35.6 % |

Two numbers in a cell are the pair's two captures. The one pair where the pass did nothing (7 h,
held, second pair) straddled a weather ramp that brightened the whole frame, which is not flicker.
The sunrise numbers are far above the owner's recording because at 7 h the explore day sweeps
every shadow edge across the ground within seconds.

The cost, by the frame-budget tool's interleaved A/B (`tools/frame-budget/measure.mjs`, the same
build with and without the pass, the trailhead view at the tier's standard size, three pairs):
25.6 ms a frame without, 26.5 with, a median of +0.9 ms. Both are over the medium bar on this
view, which the pass is not what decides. Dropping FXAA, which the prototype still ran, gives part
of that back.

Ghosting: a side-by-side of the captures shows the leaf silhouettes a touch smoother with the pass
and no trail behind the swaying cards; the frame-to-frame difference is the same on and off, so
the history is not smearing. A turning camera and the animals exercise the reprojection and the
clip, which a still camera cannot; see "As built" below.

## Not done, and why

- **Alpha-to-coverage on the leaf cards** would soften the same edges within a frame, but needs
  the multisampling, which WebGL2's medium tier does not get at the prepass; the anti-aliasing
  covers both engines.
- **A render-scale floor** (never below the display's CSS pixels) was measured at a third of the
  frame rate on the Air and did not lower the metric.
- **Drawing the shadow map every frame** halves one source at the cost of a pass a frame.

## As built

The finished chain (FXAA gone, the blend at 0.1), captured as above at 17 h with the sun's
direction held, the pass detached from the camera for the off captures: 5.6 % of pixels blinking
against 8.3 % in the first pair, 0.1 % against 10.8 % in the second (the sun all but set by
then). A turning capture (2 px of mouse a frame, 10 h) shows the trunks' edges clean against the
sky and no doubled or trailing silhouette, the reprojection holding under rotation; the leaf
clusters read as shapes where the chain without the pass draws them as blocks. The WebGPU and
WebGL2 consoles are clean with the pass in the chain. The unit tests pin the feature ladder, the
jitter's walk and bounds, the chain's order with and without a prepass, the jitter on the
projection and its restoration, the bindings of the first and second frames, and the two history
targets' making, remaking and disposal (`client/test/game/postParams.test.ts`,
`client/test/game/post.test.ts`).

## Amendment, the same day: a gentler blend while the camera is still

At noon the pass made a flicker of its own. The jitter moves a trunk thinner than a pixel in and out
of it, and against the bright noon fog that swing is large; the blend passes it on at its share, a
tenth, so short vertical streaks blinked down the far trunks with the camera still (the low sun of
the evening lights that fog less, which is why it showed at high sun only). Measured in the page
itself, the finished canvas read back every frame with no image codec between (a screencast's
JPEG noise is as large as the flicker), at the explore trailhead at 12 h with the wind off: 1.8 %
of the far trunks' band flickered by over a level; with the jitter off, none; with the sun held,
the shadows off, the trunks' axis shading off or the sharpen off, no change; with the history's
clip widened, no change; with the jitter halved or the blend halved, half.

So the blend follows the camera (`taaBlendFor`, `taaCameraPixels`, `postParams.ts`): the frame's
share is `TAA_BLEND_STILL`, 0.03, while the camera is still, rising in a straight line to
`TAA_BLEND` at a pixel of motion in the frame (`TAA_MOVING_PX`), the motion being the turn between
the two frames' forward axes plus the step seen at 2 m (`TAA_NEAR`), each in pixels of the
frame's height under its field of view. A walk or a turn is many pixels a frame, so a moving view
keeps the blend it had; a still one converges in under a second at the game's frame rate, and the
neighbourhood clip still keeps what moves of itself from trailing. The pass's code computes the
blend each frame and sets it as the uniform it already had, so the shader is unchanged.

In one page, alternating with the blend held at 0.1: the far trunks' band 0.19 to 0.25 % against
1.1 % (over two levels, 0.03 % against 0.35 %); the whole frame 0.10 to 0.16 % against 0.8 %.
Turning (2 px of mouse a frame) the two are the same. The pass's tests add the still frame's blend
and a turn of half a pixel's angle taking the blend half way.

