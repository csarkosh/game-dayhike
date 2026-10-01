# Rain system: verification

The measurements behind [2026-10-01-rain-system-design](2026-10-01-rain-system-design.md),
gate by gate, on one named machine. Every number here was measured, not estimated; the
estimates the design started from are in the design and in the published survey it follows.

## 1. Method

**Hardware.** One machine: an Apple M4 (8 cores, 16 GB), running Chrome headless through
the `chrome-devtools` CLI. WebGL2 runs through ANGLE over Metal; WebGPU through Chrome's
Dawn over Metal. The renderer string each round reads from the page is recorded with its
table.

**Builds.** Two checkouts on two ports, each serving its own Vite dev build: the branch
(port 5174) and a control detached at `origin/main` as the branch started, `b43952d`
(port 5175). Three never-committed hooks are applied to both for a gate and reverted after
it:

- a pose hook in `client/src/app.ts` and `client/src/game/renderer.ts` that exposes
  `__fcSet(x, y, z, yaw, pitch)`, pinning the free camera at a pose every frame (positive
  pitch looks down), `__scene` and `__engine` for the frame timing, and `__lampOn`, which
  forces the local headlamp on in freecam;
- the dev server's port in `client/vite.config.ts`, one per checkout;
- on the branch only, `__rainLayers({...})`, which switches each rain layer off so the
  stack can be measured whole and by parts on one page.

The tier is `?tier=high|medium|low` on the URL, which the launch decides from; each sample
confirms the tier by the shadow map it finds (2048 on high, 1024 on medium, none on low).

**Page.** `/dayhike/game/<fresh uuid>?cmd=seed%20atmo;freecam;time%20<hour>;weather%20<preset>&tier=<tier>`,
in a viewport of 1920 by 1080 CSS pixels at device pixel ratio 1, so the engine renders
1920 by 1080 at native and 3840 by 2160 at "4×" (hardware scaling 0.5, off the 60 Hz vsync
cap). Each page is given 10 s after its title appears, the pose is set, 3 s to settle, then
8 s of `onAfterRenderObservable` intervals: the mean and the p95 of the frame interval, and
the frame's draw calls. Every page is closed before the next opens; a warm-up page starts
every run and is discarded.

**The pair method.** On one page the weather is one preset; the pair is the same pose on a
fresh page with the other preset (`rain` against `clear`, or `rain` with a layer off against
`rain` with it on), in alternating order across rounds, at least two rounds. Only quiet
rounds are read: every page within 0.5 ms of its build's lowest mean at that pose. The
order-averaged delta is the figure.

**What is reported**, per tier and engine, at each pose: (1) the control's rain minus its
clear, the particle rain's cost today; (2) the branch's rain minus its rain with every layer
off, the stack's cost, which is the bar; (3) each layer's own cost; (4) the branch's clear
minus the control's clear, which must sit in the noise floor; (5) draw calls beside each.

## 2. Poses

| pose | command | camera (x, y, z, yaw, pitch) | lamp |
| --- | --- | --- | --- |
| canopy | `seed atmo;freecam;time 12;weather <preset>` | 263.9, 85.77, 118, 1.571, 0.12 | off |
| meadow | `seed atmo;freecam;time 12;weather <preset>` | -216.1, 22.38, 414, 0.393, 0.08 | off |
| night | `seed atmo;freecam;time 22;weather <preset>` | 263.9, 85.77, 118, 1.571, 0.12 | on |

The canopy pose stands on the trail under old growth looking along it; the meadow pose
looks across open ground; the night pose is the canopy pose at 22:00 with the headlamp on,
where the streaks are lit by the lamp.

## 3. The method as run, and the noise floor

The fresh-page pair method of §1 did not hold on this machine on the day: the
reference machine is shared with other work (dev servers, test runs and other
browser pages on the same GPU), and fresh pages at one pose drifted by 3 to 5 ms
between rounds whatever the build. Two corrections were made before any figure
was read:

- **Same-page toggles.** Each figure is one page per build and pose: the rain
  preset, the pose, then six cycles in which the rain layer is switched off and on
  (the branch through its layer hook; the control by stopping and starting its
  particle system), each state held 3 s with the last 2 s measured, the cycles
  alternating which state comes first. The figure is the mean of the six on-off
  differences and its standard deviation across the cycles. A slow drift cancels;
  what remains is the frame-to-frame noise, about ±0.5 ms per cycle at native
  on WebGPU and ±1 to 1.5 ms on WebGL2, so a six-cycle mean resolves about 0.2
  to 0.6 ms. Every sample waited for a one-minute load average under 4 and no
  test runner on the machine; the load at the sample is recorded beside it.
- **The engine pinned.** On high the launch picks WebGPU by itself, so every
  page names its engine on the URL (`&engine=webgl2|webgpu`); the renderer string
  read from the page is `ANGLE (Apple, ANGLE Metal Renderer: Apple M4, Unspecified
  Version)` for WebGL2 and the engine's own name for WebGPU.

At 4× (hardware scaling 0.5) the noise on the shared GPU was 2 to 10 ms per
cycle on the day, and nothing at 4× is read below.

## 4. Gate 1: the air and the far field

Branch at `e9b1e52` (the streak volume, the fog, the sky fade and the lamp term);
control at `b43952d`. Frame mean with the layer on and off, their difference with
its spread over six cycles, and the draw calls on and off. Native 1920 by 1080.

**High, WebGPU.**

| pose | build | on (ms) | off (ms) | on minus off (ms) | draws on / off |
| --- | --- | --- | --- | --- | --- |
| canopy | branch | 23.46 | 23.56 | -0.09 ± 0.58 | 246 / 246 |
| canopy | control | 23.88 | 24.27 | -0.39 ± 0.51 | 245 / 244 |
| meadow | branch | 22.62 | 22.35 | +0.27 ± 0.73 | 276 / 275 |
| meadow | control | 23.01 | 23.53 | -0.52 ± 0.70 | 275 / 275 |
| night | branch | 25.49 | 23.79 | +1.70 ± 2.68 | 241 / 241 |
| night | control | 24.95 | 24.68 | +0.27 ± 0.86 | 242 / 242 |

**High, WebGL2.**

| pose | build | on (ms) | off (ms) | on minus off (ms) | draws on / off |
| --- | --- | --- | --- | --- | --- |
| canopy | branch | 28.26 | 27.64 | +0.62 ± 1.53 | 242 / 241 |
| canopy | control | 28.57 | 29.63 | -1.05 ± 1.30 | 244 / 243 |
| meadow | branch | 25.53 | 25.70 | -0.17 ± 0.97 | 274 / 273 |
| meadow | control | 25.98 | 25.60 | +0.39 ± 1.26 | 275 / 274 |
| night | branch | 27.42 | 27.58 | -0.15 ± 0.93 | 240 / 239 |
| night | control | 26.96 | 27.35 | -0.40 ± 0.98 | 242 / 240 |

**Medium, WebGPU.**

| pose | build | on (ms) | off (ms) | on minus off (ms) | draws on / off |
| --- | --- | --- | --- | --- | --- |
| canopy | branch | 21.15 | 20.87 | +0.27 ± 0.60 | 241 / 240 |
| canopy | control | 21.11 | 21.05 | +0.06 ± 0.41 | 239 / 240 |
| meadow | branch | 20.01 | 19.05 | +0.96 ± 0.93 | 269 / 268 |
| meadow | control | 21.04 | 20.98 | +0.05 ± 0.10 | 268 / 268 |

**Medium, WebGL2.**

| pose | build | on (ms) | off (ms) | on minus off (ms) | draws on / off |
| --- | --- | --- | --- | --- | --- |
| canopy | branch | 24.24 | 24.12 | +0.12 ± 0.41 | 240 / 239 |
| canopy | control | 24.23 | 24.50 | -0.27 ± 0.70 | 238 / 238 |
| meadow | branch | 22.00 | 22.56 | -0.56 ± 0.52 | 269 / 267 |
| meadow | control | 21.99 | 22.85 | -0.86 ± 1.70 | 268 / 267 |

**Reading.** At every pose, tier and engine the streak volume's cost is inside
the measurement's spread: no figure is more than one standard deviation from
zero except the medium meadow on WebGPU (+0.96 ± 0.93), and the night pose on
WebGPU (+1.70 ± 2.68) is the noisiest page of the run rather than a cost. The
control's particle rain reads the same way. So the air layer at 24,000 streaks
on high and 10,000 on medium costs under about 0.5 ms on an Apple M4 at native
1080p, under the 1.0 ms and 0.5 ms bars, and the measurement cannot tell it from
the 2,000-particle system it replaces. One draw call is added. A tighter figure
needs more cycles on a quieter GPU; the final table (§7) is taken with twelve.

**The no-rain frame.** Measured on fresh pages before the toggles (the one
reading that survives the drift, because both builds were paired in the same
round): at the canopy pose on high, branch `clear` 20.94 ms against control
`clear` 20.61 ms, and at the meadow 19.51 against 20.92, both inside that
round's page-to-page spread. The branch adds nothing under clear weather that
the method can see.

**Stills.** On the branch at `73341a7` (gate 2's checkout, which carries this
layer unchanged), WebGPU and WebGL2 at the spawn, the canopy pose at noon and at
22:00 with the lamp, the meadow pose, and a frame taken after 2.5 s of the free
camera moving at 7 m/s along the trail: rain at every height on both engines,
slanted by the wind, fogged at distance, lit inside the lamp's cone at night, and
no dry leading edge in the sprinting frame. The stills are kept beside this
note outside the repository. No console error or warning on any page.

## 5. Gate 2: the height map

Branch at `73341a7` (the map, the cover fade), measured by the toggle method of §3
with the map forced to re-render every frame against never, so the figure is the
cost of one refresh frame, an upper bound: in play the map refreshes once per 8 m
of movement, about every 1.5 s of walking, and never on a turn. Native 1920 by
1080, six cycles.

| tier, engine | pose | refresh every frame (ms) | never (ms) | per refresh (ms) | draws on / off |
| --- | --- | --- | --- | --- | --- |
| high, WebGPU | canopy | 21.36 | 21.30 | +0.06 ± 0.08 | 289 / 244 |
| high, WebGPU | meadow | 19.43 | 19.41 | +0.02 ± 0.06 | 319 / 274 |
| high, WebGL2 | canopy | 28.70 | 25.81 | +2.89 ± 1.63 | 288 / 244 |
| high, WebGL2 | meadow | 29.06 | 26.19 | +2.87 ± 0.53 | 320 / 275 |
| medium, WebGPU | canopy | 21.39 | 20.99 | +0.39 ± 0.37 | 286 / 241 |
| medium, WebGPU | meadow | 20.10 | 20.10 | +0.00 ± 0.34 | 316 / 269 |

**Reading.** A refresh adds 45 draws (seven terrain rings, the props, the cliff
buckets, the water) into the 512-texel target. On WebGPU that is free to the
measurement (under 0.1 ms on high, under 0.4 on medium). On WebGL2 the same
draws cost about 2.9 ms on the frame they fall on, which is the price of a
render-target pass with that many draws under ANGLE over Metal; amortised over
the 90 or so frames between refreshes while walking it is about 0.03 ms, but as
a single-frame hitch it is one frame 10 percent longer than its neighbours every
1.5 s of walking. Five of the seven rings lie wholly outside the map's 96 m
square and are clipped whole after their draw, so the next commit lists only
the two inner rings; the figure is re-taken in §7. The cover itself (the fade
read in the streak shader) adds a vertex-stage fetch per streak and is inside
gate 1's spread.

**Stills.** The canopy pose at noon with and without the map on the same build
(§4's stills): with it the streaks under the canopy thin to about a third, as
the terrain's canopy density says they should. The trailhead spawn under
WebGPU and WebGL2 shows the same cover on both engines, which closes the
question of the render target's row order on WebGPU: the engine flips the clip
position for render targets, so the streak's map read is the same on both.
