# Quality tier detection: verification

What is measured against the quality tier detection design's gates
([`2026-09-26-quality-tier-detection-design.md`](2026-09-26-quality-tier-detection-design.md),
§13), how, and what the numbers were; and what changed in the build because of
them. This build draws with WebGL2 only: the design's WebGPU readings belong to
the WebGPU work and are not part of this note.

## 1. Method

**Builds.** The branch, served by the dev server from a checkout of its own, at
the commit each reading names:

| build | what it carried | read on it |
| --- | --- | --- |
| `cb2e053` | tier detection, the probe, the Settings screen with four buttons, the live swap, the governor | detection (§2); the first Settings run (§5) |
| `5071e0c` | `cb2e053` and a refused pointer lock from a canvas click handled quietly | the live swap, solo and in a party (§6); the governor (§7) |
| `6efd2b4` | `5071e0c`, the Graphics choice as one drop-down, and a renderer torn down early ending quietly | the Settings steps on the drop-down (§5); the early teardown (§6); Safari and Firefox (§8) |
| `60a9bd3` | `6efd2b4`, the probe skipped where shaders compile on the page's thread, and the cover's two bounds | the probe's verdicts (§2), the probe against the pair method (§3), the frame per tier in both windows (§4) |
| `5ba234f` | `60a9bd3`, `main`'s halation blurred at quarter size, a probe step ending early as a miss, the probe's count kept through a cut and through a governor's or a build's verdict, a step's time to be ready bounded by the cap, and a host's `?tier=` and `?probe=` kept off its followers | **the build that ships**: the probe's verdicts and the deciding frame cells again (§2–§4), a ten-minute hike on Auto (§7), the cover's two bounds (§6, §7), Firefox (§8) |

Where a number was read on both `60a9bd3` and `5ba234f`, both are given side
by side. The high tier reads 0.4–0.7 ms faster on `5ba234f`: that is the
halation's quarter-size target, and this is its first measurement.

**The measurement patch**, applied to the served checkout for a reading and
never committed: `__scene` and `__engine`, the scene and the engine the renderer
was given, re-pointed at the new ones by a live swap; and `__fcSet(x, y, z,
yaw, pitch)`, pinning the free camera at a pose every frame (positive pitch
looks down), which acts only in the free camera. Every reading at a pose first
checks that the three exist, or it is a reading of the spawn point and void.

**Browser.** Chrome on the reference machine (an Apple M4 laptop with no
fan), driven with the `chrome-devtools` command-line tool. The renderer string,
read on the page before any reading, is `ANGLE (Apple, ANGLE Metal Renderer:
Apple M4, Unspecified Version)`. Detection (§2) was first read in a headless
Chrome 153, window 1200 × 2029 at device pixel ratio 1. The probe's loads and
the frame rounds (§2–§4) were read in a headless Chrome 154 at device pixel
ratio 1, in a window of 1920 × 1080 or 1200 × 2029, each measured page the
third opened in its browser start after a discarded warm-up page, with
`requestAnimationFrame` firing 60.0–60.5 times a second and the page
`visible`. The swap, the governor and the Settings steps need a window: a
headless browser refuses every pointer lock, and two game pages connect to
each other only in a windowed browser. There the page was 1200 × 736 CSS
pixels at device pixel ratio 2: Chrome 153.0.8010.53 on `5071e0c`; the page's
UA string read Chrome 154 on `6efd2b4` and `5ba234f`.

**Quiet.** A timing reading counts only with no test run on the machine and
the 1- and 5-minute load averages under 3.5; the 1-minute load average before
each page is written beside its reading, and a reading taken above the bar is
marked as under load. Functional bars (a line in the console, a figure that
moves, a count) were read under load where the machine would not go quiet, and
say so.

**Cool pages.** The machine's heat decides the reading. On back-to-back pages
the medium and high cells scattered by 3–7 ms at ordinary load, and one high
page at the canopy pose, sampled eight times in a row at a load of about 1.4,
climbed from 28.6 to 31.3 ms over 60 s. With 240 s of idle before each page,
every cell repeated within 0.12 ms. The operating system records no thermal
warning, so the cause is inferred, not shown. A page marked **cool** below had
240 s of idle before it; the pair method's figures are read on cool pages,
since the probe runs in the first seconds of a hike and so reads the machine
cool.

**The pair method's page rule** (design §13): the pose, 3 s to settle, 8 s of
`onAfterRenderObservable` intervals, mean and p95; seed `atmo`, `weather mist`,
`time 12`, the free camera at the canopy pose `__fcSet(123, 110.87, -105.5,
1.571, 0.3)` or the meadow pose `__fcSet(369, 51.01, -855, 0, 0.3)`. A page is
kept when its mean is within 0.5 ms of its cell's lowest; the pages left out
are listed.

**One condition of every timing reading.** The machine's lock screen was
playing a video wallpaper throughout, so something else was drawing on the GPU
while every frame here was timed.

**Instruments, in the page.** A `PerformanceObserver` for long tasks, a
capture listener stamping the Apply click, and a `MutationObserver` stamping
the moment the pause screen's opaque ground ("Applying…") comes off: "the
ground lifted" below. It lifted, in every swap, in the same mutation that put
up "This hike is using <tier>." and gave Apply its label back. After each lift:
`EngineStore.Instances.length` (as `__engine.constructor.Instances`), the
number of canvases and whether the canvas is a new element, and
`__scene.meshes`, `materials`, `textures` and `onBeforeRenderObservable`
observers, their names kept for a diff against a fresh page. Errors were
captured in the page across its own route changes (`console.error` and
`console.warn` wrapped, `unhandledrejection` and `error` listeners), because
the command-line tool's console list starts again at every route. A WebGL
trace, installed before the hike, numbered each context and counted the
programs each created and deleted, and reported any call on a deleted or
foreign program or a lost context; a second one logged any program deleted
before its link was seen complete.

**Stills.** Two screenshots 1 s apart after the ground lifted, compared pixel
by pixel: the largest channel difference, the share of pixels differing by
more than 24/255, and the connected regions of change on a 16 px grid. At 6×
CPU throttling a screenshot from the command line lands 3–4 s late, so the
`6efd2b4` readings grab the WebGL canvas inside `onAfterRenderObservable`
instead: the first frame after the lift, then at +0.25, 0.5, 1, 1.5, 2, 3, 4,
6, 8 and 12 s, with the tree meshes active and the scene's waiting items at
each.

**The pointer lock.** A real Chrome pointer lock was taken on the first
readings of `5071e0c`. After that the browser's window lost the system's focus,
and Chrome then refused every lock, swap or no swap, with `WrongDocumentError:
The root document of this element is not valid for pointer lock.` From there a
script injected before the first click stands in for the lock: it grants a
request only under the click's user activation, to the element asked, fires
`pointerlockchange`, and refuses a re-lock for about 1.25 s after a release, as
Chrome does. Readings that engage play say which lock they used.

**Touch.** `emulate` with touch reloads the page, so touch readings are of a
hike **started** under touch emulation (the game then starts in touch mode),
with synthetic touch pointer events on the stick and the right half of the
screen.

**CPU throttling.** 6× is `emulate --cpuThrottlingRate 6` on the running
page, which does not reload it.

**The party.** Two game pages in the one windowed browser, each in its own
isolated browser context (its own storage): the host creates the party and
the follower opens the invite link.

## 2. Detection

Read on `cb2e053`, headless Chrome 153, a fresh profile, window 1200 × 2029 at
device pixel ratio 1:

| signal | value |
| --- | --- |
| `navigator.deviceMemory` | 16 |
| `navigator.hardwareConcurrency` | 10 |
| `RENDERER` | `WebKit WebGL` |
| unmasked renderer (debug extension) | `ANGLE (Apple, ANGLE Metal Renderer: Apple M4, Unspecified Version)` |
| unmasked vendor | `Google Inc. (Apple)` |
| WebGPU adapter info | vendor `apple`, architecture `metal-3`, device and description empty, `isFallbackAdapter` false |

The page's line: `quality: medium (auto, apple-base), engine webgl2`. The
class is `apple-base` and Auto's tier `medium`, as the design expects. The same
line opened the fresh-profile hikes on `5071e0c`, and the Settings screen's
Auto line read "Auto picks Medium on this computer." on `cb2e053` and
`6efd2b4`.

**The probe's verdicts.** `/dayhike/game/<fresh uuid>?probe=high` in a fresh
profile, three loads per window; the probe renders the canopy pose. Each
reading is the mean, the p95 and the frames measured; "early" is a step that
ended as a miss once its frames passed 2,100 ms, which `60a9bd3` did not have.
The screen's time is from the navigation.

| build | window | load | cool | high | medium | verdict | "Setting up graphics…" |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `60a9bd3` | 1920 × 1080 | 2.39 | no | 24.74 / 26.7 / 120 | 18.25 / 23.1 / 120 | low | not recorded |
| `60a9bd3` | 1920 × 1080 | 2.30 | no | 24.77 / 26.5 / 120 | 18.24 / 22.4 / 120 | low | not recorded |
| `60a9bd3` | 1920 × 1080 | 2.21 | no | 24.71 / 26.5 / 120 | 18.46 / 22.9 / 120 | low | not recorded |
| `60a9bd3` | 1200 × 2029 | 3.46 | no | 24.20 / 26.0 / 120 | 18.26 / 22.5 / 120 | low | not recorded |
| `60a9bd3` | 1200 × 2029 | 3.53 | no | 24.94 / 26.6 / 120 | 19.27 / 24.2 / 120 | low | not recorded |
| `60a9bd3` | 1200 × 2029 | 2.35 | no | 24.55 / 26.2 / 120 | 18.12 / 21.9 / 120 | low | not recorded |
| `5ba234f` | 1920 × 1080 | 2.92 | yes | 24.20 / 26.1 / 87 early | 18.14 / 22.9 / 116 early | low | 0.36 → 19.13 s |
| `5ba234f` | 1920 × 1080 | 1.81 | yes | 24.14 / 26.0 / 87 early | 18.32 / 23.4 / 115 early | low | 0.34 → 19.15 s |
| `5ba234f` | 1920 × 1080 | 3.01 | yes | 24.26 / 26.1 / 87 early | 18.70 / 22.8 / 113 early | low | 0.34 → 19.46 s |

Every load logged `quality probe: verdict low (apple-base)` and `quality: low
(auto, apple-base), engine webgl2`, and stored a probe's verdict of low with
`attempts: 0`. On `5ba234f` the `quality:` line came within 1 ms of the screen
going off. Both tiers miss the 17.5 ms bar at both windows on both builds.

**The verdict is the same on all three loads at 1920 × 1080: met. The verdict
(low) equals the class table's tier for the machine (medium): missed.** §4
says what each tier draws here, and what the class table's row now is.

## 3. The probe against the pair method

The probe's readings at 1920 × 1080 against the pair method's at the same
tier, pose (canopy) and window. The bar (design §13.1): within 1.0 ms.

| build | tier | the probe's three loads | pair method, cool pages (load) | difference |
| --- | --- | --- | --- | --- |
| `60a9bd3` | high | 24.74, 24.77, 24.71 | 24.61 (1.60), 24.63 (2.08) | 0.08–0.16 ms: **met** |
| `5ba234f` | high | 24.20, 24.14, 24.26 | 24.23 (1.48), 24.21 (1.28) | 0.01–0.09 ms: **met** |
| `60a9bd3` | medium | 18.25, 18.24, 18.46 (average 18.32) | 19.15 (1.52), 19.27 (2.30) | +0.83 and +0.95 against the average: **met**; +1.03 against the lowest single load (18.24): **missed by 0.03 ms** |
| `5ba234f` | medium | 18.14, 18.32, 18.70 (average 18.39) | 19.18 (1.92), 19.30 (1.62) | +0.79 and +0.91 against the average: **met**; +1.04 and +1.16 against the lowest single load (18.14): **missed by 0.04 and 0.16 ms** |

On back-to-back pages, which read the machine warm (§1), the pair method on
`60a9bd3` gave 24.90, 29.30, 29.90 and 32.06 ms for high (load 2.88–3.36),
0.16–7.32 ms over the probe's three loads' average, and 21.38, 21.89, 22.19
and 24.57 ms for medium (load 2.84–3.34), 3.06–6.25 ms over it: **missed**,
for all but one high page. The probe reads the machine as it is at the start
of a hike, cool, and the pair method agrees with it only on cool pages: at
high within 0.16 ms, and at medium with the probe's average 0.79–0.95 ms under
the cool pages.

## 4. Frame per tier

The pair method's page rule (§1) at each tier and pose, in both windows; mean
/ p95 in milliseconds, the 1-minute load before each page, **c** for a cool
page. Low draws at two-thirds scale (1280 × 720 in the 1920 × 1080 window, 800
× 1352 in the tall one).

| window | tier | pose | `60a9bd3` | `5ba234f` |
| --- | --- | --- | --- | --- |
| 1920 × 1080 | low | canopy | 16.67 / 18.2 (2.47), 16.66 / 18.5 (2.46): at the cap | — |
| 1920 × 1080 | low | meadow | 16.67 / 18.4 (3.29), 16.67 / 18.8 (3.01): at the cap | — |
| 1920 × 1080 | medium | canopy | 19.15 / 23.6 c (1.52), 19.27 / 23.2 c (2.30) | 19.18 / 24.0 c (1.92), 19.30 / 24.0 c (1.62) |
| 1920 × 1080 | medium | meadow | 17.26 / 20.6 c (1.44), 17.32 / 20.5 (2.45), 17.34 / 21.0 c (2.20) | 17.25 / 20.5 c (1.92), 17.22 / 20.4 c (3.44) |
| 1920 × 1080 | high | canopy | 24.61 / 26.6 c (1.60), 24.63 / 26.7 c (2.08), 24.90 / 27.3 (3.36) | 24.23 / 26.4 c (1.48), 24.21 / 26.6 c (1.28) |
| 1920 × 1080 | high | meadow | 19.99 / 23.7 c (2.27), 20.10 / 23.9 c (2.29) | 19.37 / 23.3 c (1.40), 19.33 / 23.0 c (1.63) |
| 1200 × 2029 | low | canopy | 16.67 / 18.6 (3.39), 16.67 / 19.3 (2.75): at the cap | — |
| 1200 × 2029 | low | meadow | 16.67 / 18.5 (2.59), 16.67 / 18.7 (3.13): at the cap | — |
| 1200 × 2029 | medium | canopy | 18.46 / 22.3 (3.46), 18.91 / 22.5 (2.55) | — |
| 1200 × 2029 | medium | meadow | 16.67 / 18.4 (2.93), 17.15 / 20.3 (2.58) | — |
| 1200 × 2029 | high | canopy | 23.70 / 25.6 c (1.66), 23.78 / 25.5 c (1.73) | — |
| 1200 × 2029 | high | meadow | 18.51 / 21.2 (2.74), 18.57 / 21.3 c (2.28), 18.80 / 21.1 c (1.87) | — |

Pages on `60a9bd3` left out under the 0.5 ms rule, all quiet, all warm:
1920 × 1080 medium canopy 24.57, 21.89, 21.38 and 22.19 ms; medium meadow
18.30, 23.51 and 21.82; high canopy 29.90, 29.30 and 32.06; high meadow 20.66,
22.82, 25.39 and 23.86; 1200 × 2029 high canopy 25.01 and 27.47; high meadow
23.88. The tall window reads faster than 1920 × 1080 in every medium and high
cell, with 17 % more pixels (medium canopy 18.5 against 19.2 ms). The consoles
held no warning and no error on any tier, and no `quality governor` line.

The high tier on `5ba234f` is 0.4 ms faster at the canopy and 0.7 ms at the
meadow than on `60a9bd3`: the halation's quarter-size target. Medium is
unchanged, as it draws no halation.

**The tier Auto picks (medium) holds the display's rate at both poses at 1920
× 1080: missed** (19.2 ms at the canopy and 17.3 ms at the meadow, cool; about
22 ms at the canopy after four minutes of drawing, §7). **The next tier up
(high) does not hold: met** (24.2–24.6 ms at the canopy, 19.3–20.1 ms at the
meadow). Only low holds, at the cap.

**The class table's row, as it stands.** `apple-base` starts at medium, its
ceiling is medium, and it is not probed. By these readings a player on this
machine at 1920 × 1080 gets about 52 frames a second at the heaviest standard
view (19.2 ms) and about 58 at the meadow (17.3 ms) on a cool machine, and
about 45 at the heaviest view (22 ms) on a warm one. The governor's limit is a
mean over 20.8 ms in three 10 s windows of engaged play in a row; in ten
minutes standing at the trailhead on Auto it did not act (17.8–20.0 ms, §7).
The rule written for a verdict that differs from the row (design §14) moves the
row to the probe's verdict, low, which holds the display's rate at both poses,
drawing at two-thirds scale. The row is unchanged by the commit that carries
this note; which of the two stands is open.

## 5. Settings

**On the drop-down** (`6efd2b4`, windowed, a fresh profile, load 1-min 3–5.5;
engaged play by the stand-in lock):

- **The screen.** The title's buttons in order: Play, Downloads, Settings,
  Credits. From the keyboard alone, Tab reaches the landing's background
  canvas, then Play, Downloads and Settings in turn, and Enter on Settings
  opens `/dayhike/settings` with the focus on the Graphics select, its focus
  ring drawn. The select has an id and a name, is labelled "Graphics" by its
  `<label>`, and offers Auto (Recommended), High,
  Medium and Low in that order, with Auto selected; the line under it reads
  "Auto picks Medium on this computer." The browser's Back returns to the
  title with the focus on Settings. Opened by a mouse click, the screen puts
  the focus on its heading, with no ring on a page whose first interaction is
  the click; on a page where the keyboard had just been used, Chrome drew its
  ring on the heading, which the design allows for keyboard focus.
- **A choice.** High, picked with the command-line tool's `fill` (which fires
  `input` then `change` on the native select), is stored at once, adds
  "Higher than recommended for this computer.", and is still selected after a
  reload. Play: `quality: high (choice, apple-base), engine webgl2`. Low, Play:
  `quality: low (choice, apple-base), engine webgl2`.
- **The pause screen.** In the Low hike, Escape shows Resume, Settings and
  Exit; Tab then Enter opens Settings with the select focused, reading "This
  hike is using Low." with Apply disabled. Escape returns to the pause panel,
  Escape again resumes play.
- **The override.** `/dayhike/?tier=high`, then Settings: "The address sets
  High (?tier=high), which overrides this setting." above the Auto line. A hike
  loaded at `/dayhike/game/<uuid>?tier=high` logs `quality: high (override,
  apple-base), engine webgl2`, and its pause Settings shows the override line,
  "This hike is using High." and Apply disabled, which stays disabled after
  Medium is picked. **As built on this branch, Play from `/dayhike/?tier=high`
  does not carry the query:** the hike opens at `/dayhike/game/<uuid>` with no
  query and starts at the saved choice (`quality: low (choice, apple-base),
  engine webgl2`), and its pause Settings shows no override line.
- **Storage refused.** A page whose `localStorage` getter throws
  `SecurityError` (made so by a script run before the page's own): Auto, and
  "This browser is not keeping settings, so this choice lasts until the page
  closes."; High then gives `quality: high (choice, apple-base), engine
  webgl2` for Play and is still selected back on Settings; a reload returns to
  Auto with the storage line. A private window cannot be opened from the
  command-line tool.

The drop-down's own checks, on the same build (movement read as the camera's
travel for W, A, S and D held 700 ms and the highest point of a Space; in play
with the focus on the canvas: 3.5–4.1 m and a rise of 1.27 m):

| check | read |
| --- | --- |
| Space on the focused select | opens its list (`select.matches(":open")` true) |
| arrows, Enter and Escape with the list open | reach the page as `keydown` on the select, not the list: the value is unchanged and `:open` stays true, so choosing inside the open list could not be driven; Escape leaves the Settings screen in place while the list reports open |
| a click elsewhere, then Escape | the list closes, the select loses the focus; Escape returns to the pause panel |
| Enter on the closed select | nothing opens, nothing changes |
| type-ahead on the closed select | `h` picks High, `m` Medium; ArrowDown opens the list (Chrome on macOS) |
| Back, then Resume | the unapplied pick is discarded; the focus is on the body; W, A, S, D 3.88–3.97 m; Space rises 1.27 m |
| a mouse click opening the list, `fill` High while open, Back | the list closes; Resume: focus on the body, W, A, S, D 3.87–3.97 m, Space 1.27 m |
| typing into the command bar | "/wwwasd" typed and W held 800 ms at the field: the camera does not move; Escape closes it and play moves again |
| the desktop shell's UA string (`Electron/44.1.1`) | the title's join field takes W, A, S, D, Space and `/` as text ("wasd /") with no route change and no command bar; the pause screen's read-only invite field keeps the focus and the hiker does not move; Resume by Escape with that field focused leaves the focus on the body and W moves the hiker 3.88 m |
| style at 1200, 400 and 320 px wide | the select is 37 px tall like the join field, with the same border, font and background; its keyboard ring is the buttons' 2 px ring; nothing overflows the page at any width |
| touch (a hike started under emulation, Low) | stick 6.95 m and a 150 px drag 0.675 rad before; High applied (ground lifted 11 999 ms after Apply); on the new canvas stick 9.01 m, drag 0.675 rad; High → Medium: 9.06 m, 0.675 rad |

**The first Settings run** was read on `cb2e053`, on the four-button control
the drop-down replaced, and is superseded by the above. Its console lines, the
override and storage lines and the `?tier=` behaviour on the title were the
same. In it, a Low choice made in an isolated browser context was kept through
a reload and in a second window of the same context, and a new context started
at Auto. The dev server's forwarded console carried two unhandled rejections,
`WrongDocumentError: The root document of this element is not valid for
pointer lock.`, from that run's headless browser, which refuses every lock.

**What moved.** A pointer lock refused after a canvas click is now handled
quietly, as one asked for by `engage()` already was, whether the request
rejects, returns nothing or throws (`5071e0c`). The Graphics choice became a
drop-down (`747dc0b`) for its own sake, not from a reading; this section was
read on it.

**Left to a person at a keyboard or a device:** choosing inside the native
select's open list with the arrows and Enter, and with a click on an option,
then Escape once (the list closes, Settings stays); a real pointer lock on
Resume after Settings and after an Apply; the select's picker on a phone or a
tablet; a screen reader; the join and invite fields in the real desktop shell.

## 6. The live swap

**The stall** (`5071e0c`, solo, the hike at the spawn, the machine reserved:
load 1-min 2.9–4.2, 5-min 3.6–4.0, the page itself adding to it):

| swap | 1×: long task at Apply | 1×: Apply → ground lifted | 6×: long task at Apply | 6×: Apply → ground lifted |
| --- | --- | --- | --- | --- |
| Medium → High | 710 ms | 3818 ms | 4211 ms | 14438 ms |
| High → Low | 731 ms | 4351 ms | 4161 ms | 14311 ms |
| Low → Medium | 719 ms | 3498 ms | 4154 ms | 14186 ms |

The long task starts 7–8 ms after the click at 1× and 18–28 ms at 6×; the ones
after it are 103–254 ms at 1× and up to 1590 ms at 6×. The same swaps under
load (1-min 4.7–7.5) read 823–1075 ms and 3.9–4.1 s at 1×, 4.5–4.9 s and
14.8–15.7 s at 6×. The long task at 1× is under the 3 s past which the design's
§14 would have the pause screen warn a host before Apply.

At 6× the lift is not the scene becoming ready. Read on `6efd2b4` with the
timers watched: the build's long task is 4187–4624 ms in each of 18 swaps at
6×, and in the three swaps where the timer was watched, the 10 s bound that
`whenSceneReady` then allowed fired 7–16 ms before the lift; the lifts came
14.3–15.7 s after Apply with 2–8 items still waiting. At 1× the bound was
cleared by readiness, 3.5–3.8 s after Apply.

**The counts** (`5071e0c`, seed `atmo`, at the spawn; the swapped page read
about 60 s after its lift, a fresh page with `?tier=<tier>` about 65 s after
load):

| tier | swapped: meshes / materials / textures / observers / engines | fresh page | the difference, by name |
| --- | --- | --- | --- |
| Medium | 375 / 83 / 144 / 3 / 1 | 374 / 83 / 144 / 3 / 1 at 65 s; 376 / 84 / 145 / 3 / 1 at 95 s | within the page's own drift over 30 s |
| Low | 324 / 79 / 140 / 2 / 1 | 323 / 78 / 140 / 2 / 1 | an elk and a squirrel on the swapped page, the antlered figure on the fresh one |
| High | 369 / 81 / 141 / 3 / 1 | 376 / 82 / 144 / 3 / 1 | the antlered figure, a deer and a squirrel on the fresh page |

Every other name matches one for one; the BRDF lookup texture differs only in
its global counter's suffix. Engines read 1 after every swap and drop on
`5071e0c`, with one canvas, a new element each time. On `6efd2b4`, ten swaps in
one hike: each replaced context deleted exactly the programs it had created
(51 to 89 per context), each was lost on its dispose, engines 1 after each, and
0 calls on a deleted or foreign program or a lost context out of 703 904 traced.

**Stills** (`5071e0c`). At 1×: 0 of 13 pairs changed. At 6×: 1 of 6 pairs
changed: after a High → Low lift, 5.6 % of the pixels changed in five compact
regions over the stand of trees behind the trailhead, sparse in the first
still and filled in the second; two later 6× High → Low swaps were clean.

**What moved.** The cover then also
waited for the forest's billboard bakes (`a9fd04a`). Read again on `6efd2b4`,
facing the trees, with the canvas grabbed from the lift on: at 6× **0 of 12**
swaps had the forest at the lift; the 10 s bound lifted the cover on bare
hillside, the first trees appeared 1.7–4.2 s later and the stand was whole
3.2–6.1 s after the lift. At 1×, 3 of 3 had the whole forest at the lift, 17
tree meshes active (15 303–15 476 thin instances). One touch swap at 1×, under
load 12–15, also lifted on the 10 s bound though the forest was there and
nothing was waiting; what held readiness is not visible from outside the page.
From the 6× reading, the bound became **20 s after Apply**
(`APPLY_SWAP_READY_MAX_MS`, `4e5e73f`) and **10 s after a governor's drop**
(`GOVERNOR_SWAP_READY_MAX_MS`, `012f545`, §7), each counted from the end of
the new renderer's build.

**Read again on `5ba234f`** (windowed, facing the trees, the stand-in lock):
six Applies at 6× (High, Low and Medium, twice; load 1-min 1.96–2.85) lifted
22.28, 19.59, 22.29, 22.91, 20.86 and 22.68 s after Apply, **every one on
readiness**: the 20 s timer, set at the end of the build, was cleared 17.98,
15.19, 17.99, 18.61, 16.51 and 18.39 s after it was set, the closest 1.4 s
inside the bound. At the lift and 1 s later: 17 tree meshes active, the
forest's thin instances full (15 476 on high and medium, 15 303 on low), 0
items waiting. **The forest was there at the lift in 6 of 6.** Three Applies at
1× (load 1.90–3.04) lifted 3.33, 3.10 and 3.31 s after Apply, on readiness,
the forest full. Console: 0 errors, and no warning but the wind filter's.

**Resume** (`5071e0c`). A real Chrome pointer lock on the new canvas after 4
swaps; then by the stand-in lock, 13 of 13 at 1× and 6×: the first click asks
for the lock on the new canvas with the click's activation, play engages on it,
and the view equals the one read at Apply to four decimals. Touch, on a hike
started under emulation (load 1-min 10–23):

| swap | ground lifted | stick: the player moved | drag: yaw turned | view at the lift |
| --- | --- | --- | --- | --- |
| High → Low | +9234 ms | 8.62 m | +0.675 rad | unchanged |
| Low → Medium | +11283 ms | 8.16 m | +0.675 rad | unchanged |
| Medium → High | +12618 ms | 8.94 m | +0.675 rad | unchanged |

**The party** (`5071e0c`, host and follower, load 1-min 6–31; the bars here are
functional). The follower held W or S from 1 s before the host's Apply until 3 s
after the host's lift, and the host recorded the follower's figure every frame:

| host swap | load 1-min | host long task at Apply | ground lifted | the follower's figure first moved | moved in the next 1 s |
| --- | --- | --- | --- | --- | --- |
| Medium → High | 6.75 → 5.75 | 1707 ms | +9971 ms | 14 ms after the lift | 7.20 m |
| High → Low | 11.96 → 14.42 | 1427–1739 ms | +8254 ms | 20 ms | 6.04 m |
| Low → Medium | 23.89 → 25.23 | 1880–2494 ms | +12507 ms | 20 ms | 6.71 m |

Then the follower's own swaps, Low → High, High → Low and Low → Medium (load
1-min 15.56–31.09): ground lifted at +12208, +12619 and +12824 ms; engines 1,
one new canvas; the host's roster kept `PARTY 2 / 5`. Neither page ever showed
"Reconnecting…" or a session end. The first party of the run is not counted:
its host page was closed from outside the game partway.

**The console.** Every swap logs `quality: <tier> (choice), engine webgl2`
after a new Babylon.js line. On `5071e0c`, 0 errors from any swap made once a
hike had settled; but a swap applied within about 0.5 s of the hike appearing
printed `cliff modules: keeping whatever loaded — RuntimeError: Unable to load
from /dayhike/assets/models/cliff.wall_b.glb: Scene has been disposed` (2 of 5
such swaps), and so did a hike left early:

| teardown after Play (`5071e0c`, load 1-min 3–7) | tries | unhandled `TypeError` + `Uncaught (in promise)` | the cliff error |
| --- | --- | --- | --- |
| before about 2.2 s (Back, or Exit as early as the pause menu allows) | 7 | 7 | 7 |
| 2.2–2.7 s | 3 | 0 | 3 |
| 3.0 s | 2 | 0 | 0 |

The unhandled rejection was named in the page: `TypeError: Cannot read
properties of null (reading 'postProcessManager')`, thrown by Babylon's BRDF
lookup texture, whose effect finishes compiling after its scene and engine are
disposed and then reads the gone scene. The cliff error is a model load of the
disposed renderer rejecting and being reported as a failure.

**What moved.** A disposed renderer now ends its model loads, bakes and ground
map downloads quietly (`1a88b48`, `a7a0a58`, `d75790a`, `ef3686e`,
`6519614`), and releases its engine only once its BRDF texture has expanded
(`d68ad4b`), waiting at most 125 polls 16 ms apart that actually run
(`d695fba`). Re-read on `6efd2b4`:

- **24 of 24** Play-then-leave tries (Exit or Back at 0.5–2 s after Play, 1×
  and 6×, load 1-min 2.2–4.9): 0 errors, 0 `Uncaught (in promise)`, 0 cliff
  lines, 0 warnings; the BRDF texture was still expanding at the teardown in 16
  of them, and in the 14 of those whose dispose was traced, the engine was
  disposed only once the texture was ready. The title was
  whole after every try, and Play again gave one engine and its quality line.
- **15** early Applies (46 ms to 1.6 s after the hike's first frame, 1× and 6×):
  0 errors and 0 unhandled rejections in all 15; never 3 engines, never stuck
  at 2; 2 for 0.1–0.3 s only where Apply beat the old scene's BRDF expansion
  (6×, no pause between the menu steps, 3 of 3).
- The wait itself: from the engine's creation the BRDF texture was ready after
  951–1169 ms at 1× and 6077–7124 ms at 6×, in 4–5 and 6–7 polls that ran
  (swapped renderers: 4–6 and 7–8): at most 8 of the 125.

**The `glGetProgramiv` warnings.** `GL_INVALID_VALUE: glGetProgramiv: Program
object expected.`, twelve at once, printed as a warning with no error beside
it. On `5071e0c`: after 1 of about 50 Apply swaps, and after 2 of 6 governor
drops (§7). The page itself never called a deleted program (0 such calls
traced); in the one case traced closely, the twelve followed the only program
of the new context deleted while its parallel link was still pending, 318 ms
into it; with the parallel-compile extension turned off under the same
conditions, there were none. They were taken to be the GPU process's report of
that deletion, with no effect on what is drawn. On `6efd2b4`: 0 in 52 Apply
swaps. Nothing was built against them.

## 7. The governor

Read on `5071e0c`, on Auto at medium, engaged by the stand-in lock, standing at
the spawn point of seed `atmo`. Not at the canopy pose, and not at the design's
scaling:

- the pose patch flies the free camera, and a frame with the free camera on is
  never steady play (§10), so with it every window is void;
- at `setHardwareScalingLevel(0.5)` the quiet frame was 20.7–21.4 ms in 3 s
  means and about 20.8 ms in 10 s windows, the governor's own limit, so windows
  alternated between counting and resetting and nothing dropped in 113 s (load
  1-min 2.1–2.8, 5-min 3.1–3.5); the reading was taken at 0.4, where the
  windows read 28.6–28.7 ms.

**The drop** (a fresh context, load 1-min 2.4–2.9, 5-min 3.0–3.2):
`quality governor: medium → low, 30 s of play under 48 fps` at **70.24 s** after
the hike's first frame. The windows from 30 to 40 s (28.62 ms) and 40 to 50 s
(28.66 ms) counted; the one from 50 to 60 s held three shader compiles, at
+52.28, +52.29 and +55.59 s, with the player standing still, so it was void by
design; the window from 60 to 70 s counted and closed the run. An earlier
reading under load (1-min 42–73) dropped at 69.9 s after the first frame, 72.1
s after the hike's scene was made. The times are from the hike's first frame,
as the pages stamped it; the design's bar counts from the session's start.
Something on this seed compiles new shaders 40–55 s into a hike (compiles at
+42.7 and +52.3 s in the 0.5 run), so the drop came one window after the
earliest it can. The design's 60–61 s is worded for a run whose windows hold no
compile; as built, the bar holds only where nothing compiles 30–60 s into a
hike, which is not so at this spawn.

Then `quality: low (auto), engine webgl2` at +71.14 s; the cover, then the HUD
line "Graphics lowered to Low to keep the game smooth." once, for 6.001 s. In
five drops the line showed once, for 6.000–6.001 s. Settings afterwards: Auto
selected, "Auto picks Low on this computer.", "This hike is using Low.", Apply
disabled; Low leaves it disabled; Medium gives "Higher than recommended for
this computer." and enables it. A reload: `quality: low (auto, apple-base),
engine webgl2`, no probe, the Auto record `source: "governor"`. Console: 0
errors, and no warning but the wind filter's (below).

**Without the scaling** (a fresh context, load 1-min 2.0–4.0, 5-min
2.97–3.47): medium at the spawn, 16.67 ms mean over 17 887 frames (p95 18.6 ms,
max 33.3 ms), at the display's cap. For 328 s after the first frame: no
governor line, no HUD line, no Auto record written.

**In a party.** A follower on Auto dropped twice on its own while two game
pages loaded the machine to about 10–20: the same line, the HUD line for 6.0 s,
and after the drop the follower's pause menu open, since the swap took the
canvas that held the lock. Two more follower drops were made at 0.4 scaling
after walking somewhere new, one of them 32 s after the scaling. Of the six
drops read in all, the `glGetProgramiv` warnings of §6 followed 2, both on
followers soon after arriving somewhere new; the follower drop made with the
parallel-compile extension turned off printed none.

**What moved.** The drop's cover now lifts at **10 s** after the build at most
(`GOVERNOR_SWAP_READY_MAX_MS`, `012f545`), not the Apply's 20 s. The 70 s drop
moved nothing: the design's bar is worded for a run whose windows hold no
compile.

**The drop's cover, read on `5ba234f`** (windowed, 6× CPU throttling, on
Auto, engaged by the stand-in lock; load 1-min 2.14–4.61, above the bar for
part of it, a functional reading). 6× alone kept the frame at 16.67 ms;
`setHardwareScalingLevel(0.5)` raised it to 20.5–23.7 ms, and about 35 s later
the console read `quality governor: medium → low, 30 s of play under 48 fps`,
then `quality: low (auto), engine webgl2` 4.3 s later. The cover lifted **on
the 10 s bound**: its timer fired 10.03 s after the build, with 2 items
waiting and no tree mesh active. At the lift the screen showed bare hillside,
the car and the sign; the first trees appeared 1.9 s later and the forest was
full 3.05 s after the lift. That is the case the design's §9.6 accepts for a
drop: on a machine as slow as the 6× one, the forest fills in after the lift,
in view. Console: 0 errors.

**A ten-minute hike on Auto** (`5ba234f`, headless, 1920 × 1080, a fresh
profile, cool at the start; 8 s of intervals every 30 s for 10 minutes). Both
pages logged `quality: medium (auto, apple-base), engine webgl2` and stored
nothing.

- **At the canopy pose, in the free camera** (load 1.43–3.02): 19.09, 19.39,
  19.26, 19.23, 19.61, 19.86, 20.23, 22.14, 21.70, 22.05, 22.13, 21.76, 21.93,
  21.99, 22.08, 22.08, 22.26, 22.44, 22.46 and 22.27 ms, at 25, 55, 85 … 598 s.
  The frame starts at the cool 19.1–19.4 ms, passes 20 ms at about 3.5
  minutes and holds at 21.7–22.5 ms from 4 minutes on; the p95 went from 23.9
  to 28.4 ms. The governor cannot act here: a frame with the free camera on is
  never steady play.
- **Engaged play, standing at the trailhead facing the trees** (the stand-in
  lock, no free camera; load 1.68–3.59): 16.67 ms five times (at the cap),
  then 17.75, 18.33, 19.04, 20.02, 18.83, 18.67, 18.36, 18.35, 18.47, 18.38,
  18.65, 18.33, 18.77, 19.08 and 19.90 ms. No 10 s window reached 20.8 ms, and
  no governor line.

On a warm machine medium settles about 3 ms over its cool reading at the
canopy pose, about 22 ms, over the governor's 20.8 ms; standing at the
trailhead it stays at 17.8–20.0 ms. Whether the governor acts on a long hike
through the heavier stretches, where a warm machine reads the canopy's
number, is not shown: a hiker standing at the spawn cannot reach them.

**The console's other warning.** `BiquadFilter.frequency.setTargetAtTime value
-X outside nominal range [0, 24000]; value will be clamped.`, by the hundred in
most hikes (606 in the one hike of ten swaps on `6efd2b4`), before any swap as
after: the wind filter's cutoff going negative in `ambientAudio.ts`, which this
branch does not touch.

## 8. Safari and Firefox

Read on `6efd2b4`, on the reference machine, a fresh profile each, Auto.

**Firefox 156.0.1**, driven over its remote protocol from a throwaway profile:

- Signals, headless and windowed alike: `RENDERER` `Apple M1, or similar`
  (also through the debug extension), `VENDOR` `Mozilla`,
  `navigator.deviceMemory` null, 10 cores, `navigator.gpu` present. Class
  `apple-unknown`.
- The probe ran on the first hike and gave no verdict, three times: "Setting
  up graphics…" from about 0.5 s to 17.7–19.5 s, then `quality probe: no
  verdict; starting at medium (apple-unknown)` and `quality: medium (auto,
  apple-unknown), engine webgl2`, and a record with `verdict: null`. Each later
  hike probed again (attempts 2, then 3); the fourth started at medium at 0.3 s
  with no probe (the attempt cap).
- Why, read in the page: Firefox exposes no `KHR_parallel_shader_compile`, so
  every program links on the page's thread. 73 link-status reads blocked for
  169–337 ms each, 14.4 s in all; about 75 programs linked in the probe's 15 s;
  the step's scene never had 1.5 s without a compile, and the step gave up with
  no reading. The load average was over 3.5 during part of this.

**What moved.** The probe is now skipped, before its screen, where a step would
draw with WebGL2 and the browser does not expose the extension (`22eec94`;
the line for a machine with no WebGL2 context at all, `f0cf119`): the class's
start tier, nothing written, one line.

**Read on `5ba234f`**, Firefox 156.0.1 headless, a throwaway profile, two
hikes on Auto: no probe screen on either; the console read `quality probe:
skipped, this browser compiles shaders on the page's thread; starting at medium
(apple-unknown)`, then `quality: medium (auto, apple-unknown), engine webgl2`;
`dayhike.quality.auto` and `dayhike.quality` stayed empty after both. The
renderer read `Apple M1, or similar`. The first frame came 2.17 s and 2.90 s
after the navigation, and the page drew a steady 60 frames a second from about
12 s. In each hike Firefox's script timeout cut one render-loop frame, once
inside the world's tick and once inside the renderer's terrain-wetness update, after
6.5–7.1 s of slow shader and program calls on the page's thread; the game ran
on at 60 frames a second with no console error. The same warning is in the
`6efd2b4` Firefox runs. Whether a frame cut inside a tick leaves its state
half-updated was not checked.

**Safari 26.6.2** (macOS 26.6.2), through a local proxy that gave a fresh
origin and forwarded the page's console; the page visible and focused
throughout. A first attempt with the screen locked read nothing: Safari hides
every page then, and the probe waits for the tab to be seen.

- Signals: `RENDERER` `WebKit WebGL`, unmasked `Apple GPU`, `deviceMemory`
  null, 8 cores, WebGPU present, `KHR_parallel_shader_compile` present, 1324 ×
  790 CSS pixels at device pixel ratio 2. Class `apple-unknown`.
- Hike 1: "Setting up graphics…" from 0.63 s to 31.55 s, idle frames at 60 a
  second before it. `quality probe: high 34.30 ms mean, 39 p95, 120 frames,
  1324×790, webgl2 → misses`, `quality probe: medium 36.68 ms mean, 45 p95, 120
  frames, 1324×790, webgl2 → misses`, `quality probe: verdict low
  (apple-unknown)`, `quality: low (auto, apple-unknown), engine webgl2`. The
  record: verdict low, `source: "probe"`, both readings kept.
- Hike 2: no probe screen; `quality: low (auto, apple-unknown), engine
  webgl2` at 0.51 s.

On the same machine Chrome's Auto gives medium and Safari's probe gives low.
Safari draws on the display's beat: while each step measured, the page drew
26–31 frames a second, so a frame that misses 16.7 ms is shown at 33.3 ms, and
both readings, 34.30 ms at high and 36.68 ms at medium, are "missed one beat",
not costs in milliseconds; medium reading slower than high says the same. They
were taken with other work running on the machine (load average at the end
5.35 / 5.01 / 3.99) and are not quiet readings. A quiet reading would say
whether medium holds in Safari here.

## 9. Close

Each bar of the design's §13, on the build it was read on, with the section
that holds the evidence.

| bar (design §13) | result | build | section |
| --- | --- | --- | --- |
| 13.1 the signals recorded; class `apple-base`, Auto `medium` | **met** | `cb2e053`; the Auto line again on `5071e0c` | §2 |
| 13.1 `?probe=high`, three loads: one verdict at 1920 × 1080 | **met**: low on all three | `60a9bd3`, `5ba234f` | §2 |
| 13.1 that verdict equals the class table's tier for the machine | **missed**: low against medium; the row is unchanged and the choice is open | `60a9bd3`, `5ba234f` | §2, §4 |
| 13.1 the probe within 1.0 ms of the pair method, high | **met** on cool pages (0.01–0.16 ms); missed on back-to-back pages | `60a9bd3`, `5ba234f` | §3 |
| 13.1 the probe within 1.0 ms of the pair method, medium | **met** against the three loads' average (+0.79 to +0.95 ms); **missed** against the lowest single load by 0.03 ms (`60a9bd3`) and 0.04 and 0.16 ms (`5ba234f`); missed on back-to-back pages | `60a9bd3`, `5ba234f` | §3 |
| 13.2 the tier Auto picks (medium) holds at both poses at 1920 × 1080 | **missed**: 19.2 ms at the canopy, 17.3 ms at the meadow, cool | `60a9bd3`, `5ba234f` | §4 |
| 13.2 the next tier up (high) does not | **met** | `60a9bd3`, `5ba234f` | §4 |
| 13.3 both entries open the one screen; four choices in order; Auto on a fresh profile; the Auto line names the tier | **met** | `6efd2b4` | §5 |
| 13.3 a choice on the title survives a reload; Play starts at it | **met** for High and Low | `6efd2b4` | §5 |
| 13.3 `?tier=high` shows the override line and disables Apply | **met**; Play from the title with `?tier=high` starts at the saved choice, as built | `6efd2b4` | §5 |
| 13.3 storage refused: the storage line, Auto, a choice that lasts the page | **met** with storage refused by a script; a real private window not read | `6efd2b4` | §5 |
| 13.4 the stall and the time to the lift at 1× and 6×: reported | **reported** | `5071e0c`, `6efd2b4`, `5ba234f` | §6 |
| 13.4 engines 1; the scene's counts equal to a fresh page's but for the streaming | **met** | `5071e0c`, `6efd2b4` | §6 |
| 13.4 stills 1 s apart: nothing appears or vanishes | **met** at 1×; at 6× **missed** on `5071e0c` (1 of 6) and `6efd2b4` (0 of 12 with the forest at the lift), **met** on `5ba234f` (6 of 6) | `5071e0c`, `6efd2b4`, `5ba234f` | §6 |
| 13.4 Resume locks on the first click with the view kept; touch stick and look work | **met**: a real lock on 4 swaps, the stand-in on 13; touch 3 of 3 | `5071e0c`, `6efd2b4` | §6 |
| 13.4 the follower stays connected; its figure moves within 1 s of the lift | **met**: 14, 20 and 20 ms | `5071e0c` | §6 |
| 13.4 zero console errors | **missed** on `5071e0c` for a swap within about 0.5 s of the hike appearing; **met** on `6efd2b4` (15 early Applies, 24 Play-then-leave tries) and `5ba234f` (6 Applies at 6× and a governor's drop) | `5071e0c`, `6efd2b4`, `5ba234f` | §6, §7 |
| 13.5 the drop logged between 60 and 61 s after the hike's session starts | **missed**: 70.24 s after the first frame, one window late, the 50–60 s window void for three shader compiles | `5071e0c` | §7 |
| 13.5 the opaque screen covers the switch and the hike goes on at low | **met**; on `5ba234f` at 6× the cover lifted on its 10 s bound on bare hillside and the forest was full 3.05 s later, as the design allows for a drop | `5071e0c`, `5ba234f` | §7 |
| 13.5 the HUD line shows once | **met**: 6.000–6.001 s, five drops | `5071e0c` | §7 |
| 13.5 Settings' Auto line says Low with nothing to apply | **met** | `5071e0c` | §7 |
| 13.5 a reload starts at low from the verdict | **met** | `5071e0c` | §7 |
| 13.5 the pause screen or a hidden tab in that minute puts the drop off; a drop made as the pause screen opens waits for Resume | **not read** | | below |
| 13.5 flying the free camera through that minute drops nothing | **not read** | | below |
| 13.5 without the scaling, nothing in 5 min | **met** at the spawn (328 s, at the cap) and at the trailhead (10 minutes, 17.8–20.0 ms); no §13.2 pose holds medium at 1920 × 1080 to read it at | `5071e0c`, `5ba234f` | §7 |
| 13.5 Safari in Low Power Mode: the "held" line, nothing written | **not read** | | below |
| 13.6 Safari: the class, the probe, its verdict, the second hike at it with no probe | **met**, from readings that were not quiet | `6efd2b4` | §8 |
| 13.6 Firefox: the class `apple-unknown` | **met** | `6efd2b4`, `5ba234f` | §8 |
| 13.6 Firefox: no probe screen, the skip line, medium, nothing stored, the second hike the same | **missed** on `6efd2b4` (a screen up to 19.5 s and no verdict, three hikes); **met** on `5ba234f` | `6efd2b4`, `5ba234f` | §8 |
| 13.6 the unit suite | **met**: the test workflow passed on `5ba234f` | `5ba234f` | — |

**Not read**, and why:

- **Safari on the shipping build, and on a quiet machine.** Safari was read
  once, on `6efd2b4`, with other work running on the machine; whether medium
  holds in Safari here, and whether the steps that now end early change its
  screen's 31 s, is not known.
- **A first hike with the window covered by another application's.** Every
  page here was visible; the probe waits for a hidden tab, but a visible window
  under another was not tried.
- **A governor's drop with the browser's real pointer lock.** The drop takes
  the canvas that holds the lock; every engaged reading after the first four
  swaps used the stand-in, because Chrome refused every lock once its window
  lost the system's focus.
- **The governor's other bars:** a pause or a hidden tab within its minute, the
  free camera's void (read from the code, which is why the drops were read
  without it, not seen in a browser), and Safari's Low Power Mode. None was
  driven.
- **A display faster than 60 Hz.** Every page here drew at 60 frames a
  second; no faster display was used.
- **The native drop-down's open list by keyboard and mouse, a phone's picker,
  a screen reader.** The command-line tool's keys reach the page but not the
  browser's open list; no phone and no screen reader were used.
- **A real private window.** The command-line tool cannot open one; storage
  refused by a script stood in for it.

And one condition of every timing reading above: the machine's lock screen was
playing a video wallpaper, so something else was drawing on the GPU
throughout.
