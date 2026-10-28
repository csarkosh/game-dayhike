# The light on the trees flickers as the camera moves: the shadow cascade re-phased

**Status:** root cause found and measured (2026-10-27); fix in `client/src/game/cascadeFrustum.ts`.

## The report

In the forest, the light on the trees and the ground cover shimmers whenever the player walks or
turns, on both engines and on medium and high; standing still, nothing moves. First reported
2026-10-25 and worked on for two days under other theories (crown fill, leaf coverage, matte
cover, temporal anti-aliasing), none of which removed it: the rig those were judged on ran at
60 Hz on a 1× display at full render scale and never showed what the owner's Air shows at
30–48 fps on a 2× display, where the medium tier draws 975×776 pixels for a 1300×1035 window and
every rendered pixel is 2.7 device pixels wide.

## What was measured

Two instruments, both against the live game on this Air (`tools/flicker/probe.mjs`, and a
screencast capture whose frames were aligned for the camera's yaw and scored for pixels that differ
from both neighbouring frames in the same direction, a one-frame blink that motion cannot make):

- **The sun's shadow map is not stable in the world while the camera turns.** A fixed world point,
  projected into the first cascade every frame, lands at a different fraction of a texel on every
  redraw (.744 → .601 → .744 → .473 …), and the cascade's bounding-sphere radius wobbles between
  26.375 and 26.9375 m for a slice whose exact radius is 26.6517 m. With the camera still, both hold.
- Babylon's stabilisation (`stabilizeCascades`) snaps the map's texel grid to the **world origin**.
  A 1 % change of texel size, 560 m from the origin, moves the grid under the player by a fraction
  of a texel, so each redraw rasterises every shadow edge (every leaf, every trunk, every blade of
  the cover under the `grassshadow` option) at a new sub-texel offset. That is the flicker, and the
  map drawn every second frame (`SHADOW_MAP_REFRESH_RATE`) steps it at 15–24 Hz, which the eye reads
  as a flutter in the light rather than a blur.
- The radius wobbles because `CascadedShadowGenerator._computeFrustumInWorldSpace` finds the slice's
  corners by inverting the camera's **single-precision** view-projection matrix and unprojecting the
  clip cube. With the game's camera (near 0.05 m, far 10,000 m, a ratio of 2×10⁵) that inverse is
  ill-conditioned at the far plane: the far corners carry an error near 1 % that changes with the
  camera's orientation, and the slice's corners are a fraction of that ray. Computed from the camera's
  pose in doubles, the radius is constant to 1e-9 across a full turn.
- On the capture, a 28°/s turn in the forest at 15:00 under a clear sky: drawing the map every frame
  halved the blinking pixels in the trees (0.96 % → 0.40 %); shadows off tripled them (everything
  lit, so every aliased edge at full contrast); 2× supersampling did not reduce them. The exact
  cascade halves them against `main` on the same turn (0.34 % → 0.19 % strict, 2.6 % → 1.3 % loose).

## The fix

`installExactCascadeFrustum` (`cascadeFrustum.ts`), called where the lighting makes the generator,
replaces the generator's corner computation with the slice's eight corners found from the camera's
world axes, field of view, aspect and Babylon's own split distances, in doubles, the axes
re-orthonormalised so the slice's shape is exactly the lens's. Babylon's sphere, snap, view and
projection are untouched. No GPU cost; a few dozen vector operations a cascade a redraw.

`client/test/game/cascadeFrustum.test.ts` reproduces the defect in Node (Babylon's own method, on a
stand-in with the camera, wobbles by more than its 1/16 m rounding step across a turn) and holds
the fix (constant radius equal to the analytic value; agreement with Babylon's corners where its
inverse is well conditioned, in both handednesses and both fov modes).

## The same flicker with the camera still: the sun moved (amendment, later the same day)

With the exact cascade live, the owner recorded the forest flickering at the explore trailhead
before taking a step. The explore day turns the sun through the whole sky in sixteen minutes
(`exploreDay.ts`, 40 s an hour), the light's direction followed every frame (`followHour`); the
escalation moves it the same way in the game. Measured on screen-recordings and on captures of the
live site with the camera still (a trunk's mean brightness, detrended, over four seconds): every
trunk in dappled light stepped by two to four levels on every second frame, the map's redraw rate;
with the sun's direction held at one value for the capture, nothing moved (0.01–0.02 against
0.1–0.5); with the wind off, or the trunks' axis shading off, it moved as before. In the game mode
at its start, where the sun stands still, no capture showed it.

The cause is the snap's anchor. The cascade's light space turns with the sun about the slice's
centre, and a world point `r` metres from that centre moves `r·δ` across the map when the sun
turns by `δ`. Babylon holds the **world origin** on a texel corner, 560 m from the forest view:
0.0003 rad a redraw moves it 17 cm, six texels, and the rounding leaves the grid at a new random
fraction of a texel each time, every edge rasterised afresh twenty times a second.

`installAnchoredSnap` (`cascadeFrustum.ts`), installed with the exact frustum: after Babylon's own
`_computeMatrices`, each cascade's projection is shifted again so that a world point within 2 m of
the slice's centre (`ANCHOR_RANGE`) lands on a texel corner. The anchor is fixed in the world while
the centre stays within its range, so the camera's motion does not move it and the sun's turn moves
it by at most 2 m · δ, a fortieth of a texel a redraw; the shadows themselves move more. When the
centre has left the range the anchor steps after it by whole texels along the map's own axes
(`moveAlongLattice`), the same grid before and after, so the step shows nothing. A few vector
operations a cascade a redraw, no GPU cost. `client/test/game/cascadeAnchor.test.ts` holds it on a
stand-in built as Babylon builds its matrices: the origin snap re-phases by more than 0.15 texel a
redraw under the explore day's turn, the anchored snap by less than the point's own motion, and a
22 m walk under a fixed sun keeps the grid still through the anchor's steps.

`tools/flicker/probe.mjs` takes `--turn 0 --cmd "mode explore" --phase 0.25` for this case: the
point it projects, 20 m ahead of the camera and 11 m from the first cascade's centre, moves 0.13
texel a redraw of its own as the light turns, so the tolerance allows that and still catches the
random re-phasing (0.37 texel measured on `main`; 0.17 with the anchor at 8 m, within the point's
own motion at 2 m).

With the anchored snap live the owner still saw the trunks shimmer at the explore trailhead, on
both engines alike (the same captures on WebGPU and WebGL2, and with the shader lookup off, spread
over the same range from run to run). What is left is the shadow map's own content: the leaf cards'
alpha-tested silhouettes move across the map's texels as the sun turns, and each edge pops a whole
texel at a time, so a trunk's axis column (and, a few pixels at a time, every shadow edge) changes
at random on every redraw. The sun held still, nothing moves (0.03 % of pixels against 0.5–2 %); the
wind off, the trunks' axis shading off, the map drawn every frame, none of them change it; medium's
percentage-closer filter is already Babylon's highest. Halving the texel does: medium's map is 2048
from 1024 (`quality.ts`), 2.6 cm a texel in the forest slice, which left 0.1–0.2 % of pixels blinking
where 0.5–2 % had, at no change in the shadow pass's GPU time on the Air (its cost is the forest's
instances, not the fill). 4096 did not do better and cost a third of the frame rate.

## What remains

The exact cascade removes the re-phasing; a residual blink (about 1.3 % of tree pixels a frame on the
loose threshold, under a fast turn at 975×776) is the alpha-tested cards' edges and the far cards
against the mist, the thing the earlier work was chasing. It is smaller than the shadow's share and
does not depend on the shadow map. Two things would reduce it without a per-frame cost: not letting
the render scale fall below the window's CSS pixels on a 2× display (today 975 wide for 1300), and
alpha-to-coverage for the leaf cards (prototyped on `worktree-tree-flutter`), to be judged by eye on
the Air, not on the rig.

**Later (2026-10-28):** the scale floor was measured at a third of the frame rate on the Air and did
not lower the blink; what settled the cards' edges, and the shadow's residual pops with them, is the
temporal anti-aliasing (`docs/rendering/2026-10-28-temporal-anti-aliasing.md`), at under a
millisecond a frame.
