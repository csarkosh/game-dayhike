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

## What remains

The exact cascade removes the re-phasing; a residual blink (about 1.3 % of tree pixels a frame on the
loose threshold, under a fast turn at 975×776) is the alpha-tested cards' edges and the far cards
against the mist, the thing the earlier work was chasing. It is smaller than the shadow's share and
does not depend on the shadow map. Two things would reduce it without a per-frame cost: not letting
the render scale fall below the window's CSS pixels on a 2× display (today 975 wide for 1300), and
alpha-to-coverage for the leaf cards (prototyped on `worktree-tree-flutter`), to be judged by eye on
the Air, not on the rig.
