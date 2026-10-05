# The intro's staging, as it looks on the scene route

**Date:** 2026-09-30
**Commit:** `b075a82` on `worktree-intro-scene-2` (main `1fe1a65` plus the scene player).
**Spec:** [`2026-09-29-intro-scene.md`](2026-09-29-intro-scene.md), §2, §3 and §8.1's last bullet.
**Machine:** Apple M4 (`ANGLE (Apple, ANGLE Metal Renderer: Apple M4)`), Chrome 154 headless through DevTools, the dev server, a 1280 by 640 viewport, `?tier=high` on WebGL2 (this Chrome's WebGPU adapter does not answer; [the playback's note](2026-09-30-intro-playback-verification.md) says so).
**Stand-ins:** today's car (`trailhead.car`, no wheels, door or interior as parts), `ranger.nathan` with its four game clips, no voices. The frames are in the look's archive outside the repository.

## What was seen

Each shot at the middle of its span (`?step=` 108, 288, 480, 660, 792, 948, 1116, 1320):

| # | Shot | Result |
| --- | --- | --- |
| 1 | The wide from the sea | **Changed, then met.** From 380 m out and 140 m up with the 0.12 rad lens the frame was fog: the film's world is in the `mist` preset, which hides everything past about 100 m. The shot is now from 70 m out over the water and 38 m up, a 0.25 rad lens, 45 m ahead of the car's start: the car small on the road in the mist, the trailhead out of frame. The spec's long lens (0.10 to 0.14 rad, §2) would need a thinner mist for the film; that is a choice the asset side's record can make in `INTRO_WEATHER`. |
| 2 | Along the road from the sea side | **Changed, then met.** The camera rode beside the car looking the way it faced, with the car at the frame's right edge and out. It now keeps the car in the centre (`followLookingAt`): the car three-quarters from behind, the forest to the tarmac, the mist. |
| 3 | The cab from the back seat | **Met as a stand-in.** The camera sits in the cab looking through the windscreen at the road and the forest, the caption under it. The car has no interior: the shell's outside is seen from within (the door lettering mirrored, the wheel wells); the asset side's `intro.car` supplies the seats, the dashboard and the handset. |
| 4 | The handset insert | **Met as a stand-in.** The same shell, dark, with a 0.3 rad lens where the handset will be; depth of field is asked for and is nothing yet (the post chain has none). |
| 5 | Low on the shoulder | **Met.** The car has just passed the camera and drives into the treeline, the road and the mist, line 9's caption. |
| 6 | The wide by the board | **Changed, then met.** The car stopped in its lane; it now eases onto the shoulder over the brake and stops where the hike's car stands (`x` −315.8 on this world). The board was not on the route at all (the hike builds it, not the renderer); it is now, with its poster, beside the trail's entrance. |
| 7 | The door and the step | **Met.** The ranger walks from the car toward the trail, seen from behind over the car's tail; the door does not open (no part). |
| 8 | The push onto the trail | **Changed, then met.** The board was out of frame; the look is aimed between the trail ahead and the board with a 0.5 rad lens, and the held frame shows the board's map and poster at the trail's entrance with the trail going in. |

Other checks:

- `dayhikeScene.seek(33.5)` then `frame()`: the caption is line 9's first ("Four-one, be advised, / radio won't carry past the road."), `time()` reads 33.5 after. Two `frame()` calls at the same time give the same picture to within the grain: 0.03 % of pixels differ by at most 6 of 255; half a second apart, 97 % differ. A recorder averaging sub-frames is unaffected.
- `?step=480` holds frame 480 (20 s) and its caption (line 3); nothing moves.
- `?step=` opened black on the first look: with a held clock the loop did not run and no frame was ever drawn. The loop now runs on a held frame too (every tick the same frame); a recorder's `frame()` stops it.
- The party roster drew as an empty dark bar over every frame (it shows full on any route but a hike's); it is hidden on a scene route.
- A hidden tab holds the clock (0 s over 1.5 s hidden) and a visible one resumes it where it was.
- Leaving the route through the router leaves no canvas, no caption, no black and no `dayhikeScene`; the title page renders with its roster.
- The car slides along the road as a whole (no wheel spin, no door), stops beside the board at 43 s; the ranger appears at the door at 43.5 s, walks to the spawn and stands facing the trail by 48.5 s.

## After checking the whole branch, on `c66de97`

- The route's loop drew outside the engine's `beginFrame`/`endFrame` (no delta time on WebGL2, nothing presented on WebGPU); every frame is drawn inside them now, `frame()` included. Not re-driven in the browser; pinned by the route's frame count moving under the loop.
- The car's parts: a node the loader made carries a rotation quaternion, under which the stage's Euler writes were ignored; folded and cleared, pinned by a part with a quaternion turning as a bare node does.
- The film ended on three seconds of fade to black, so the frame the playback holds and the title still would have been black; it ends on the held picture now (`fade(2, 60, 60)`), the black after it the playback's (spec §5.4).
- The wings' beat and the water's ripple read the wall clock; both read the renderer's clock now, so a stepped scene moves them in step and a held frame holds them.

## What is owed

- The look with the film's assets: the car's parts (wheels, door, interior), the ranger's six clips, the voices — the asset side's.
- The WebGPU engine on the route (the record is meant for the high tier on WebGPU): the route makes the WebGL2 engine; a headed Chrome and the start's WebGPU rule are needed there.
- Depth of field for the insert: the post chain has none; the record can add the blur.
- The mist for the film: the spec's coastal long lens against the `mist` preset's reach, a choice to make in `INTRO_WEATHER` before the record.
- The wildlife director steps once per render when the sim's tick does not move (`wildlifeMeshes.ts`, the `TICK_DT` floor), so on the route the birds advance a tick a frame however the scene's clock moves: eight ticks a recorded frame with the recorder's sub-frames, and on a held `?step=` page they keep moving. A hike renders many frames a tick at high refresh rates and steps the director on each, so the floor is the game's own behaviour and is left as it is here; the record should hold the wildlife or hand the director a tick from the scene's clock.
