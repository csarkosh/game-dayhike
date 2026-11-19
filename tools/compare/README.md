# Compare

Two builds of the game, one still each of the same views, and a score of how far apart the stills
are. It is what a change to the renderer is looked at with: the same place in the same world from
build A and from build B, and their difference as numbers and as a picture.

```bash
npm run compare -- --a <base url of build A> --b <base url of build B> --out <dir> \
  [--views forest,trailhead] [--tier low|medium|high] [--engine webgpu|webgl2] \
  [--settle 30] [--frames 320] [--remote <port>] [--floor]
```

A base is what the frame budget and the previews take: the dev server
(`http://localhost:5173/dayhike`), the live site, a preview channel. The views are the frame
budget's (`tools/frame-budget/views.json`, the places of `tools/previews/stills.json`), every view
without `check` unless `--views` names some. Without `--remote` the script starts Google Chrome
(or `CHROME`) from a fresh profile, as a window; with it, it drives a Chrome already running behind
a forwarded port (a rig's), on a page of its own that it alone closes.

## How a still is made the same twice

1. **The link pins the world.** A view's `?cmd=` script names the seed, the camera's place and the
   day (`escalation 0`, `unsettle 0`); the comparison adds `wind 0`. The page is opened on the tier
   asked for, at the frame budget's size for it (low at medium's), and in the measurement mode
   (`?gpuTime`), under which the game keeps the render scale at the window's pixels however slow
   the frames are.
2. **The world is waited for** (`body.world-ready`) **and settled** (`--settle`, 30 s): the place
   streamed in, the fades over.
3. **The page's clock is held.** `performance.now` and `Date.now` are replaced in the page with
   functions that answer the instant of the hold. Everything in the game that moves reads one of
   them (Babylon's frame delta too), so from then on each frame is a frame of no seconds: nothing
   advances, and the game's own loop goes on drawing. `requestAnimationFrame` is left as it is.
4. **The game draws `--frames` frames on the held clock** (320): the temporal anti-aliasing blends
   3 % of a new frame into its history a frame when the view is still, so it needs a few hundred
   frames to settle on one picture.
5. **The canvas's picture is taken** (`Page.captureScreenshot`, clipped to the canvas, PNG), with
   everything else in the page hidden.

Build A and build B go through the same steps on the same Chrome, one page at a time.

A still's row records how often the game read the held clock over those frames (`reads`); a still
whose game never read it is refused, since its loop was not drawing. Exceptions the page threw on
the held clock are kept in the row (`errors`).

## The score

On the 0..255 scale, B against A (`lib/score.mjs`):

| | |
|---|---|
| `mean` | the mean absolute difference over every pixel's red, green and blue |
| `blurMean` | the same after a 9 by 9 box blur of both pictures |
| `p99`, `max` | the 99th percentile and the largest of the pixels' differences (a pixel's is its worst channel's) |
| `over4`, `over16` | the share of pixels off by more than 4, and by more than 16 |

An edge drawn a fraction of a pixel aside is a large difference on few pixels, which the blur
averages away; a colour that differs over an area is the same before and after it. So a `mean` well
above its `blurMean` says edges, and the two alike say colour.

## What is written

In `--out`: `<view>-a.png`, `<view>-b.png`, `<view>-diff.jpg` (A, B and their absolute difference
times 8, left to right) and `compare.json` (the run's settings and a row a view: the links, the
scores, and each still's `readyS`, `heldAt`, `canvas`, `reads` and `errors`). One line a view is
printed; the progress goes to stderr.

It is a report, not a verdict: the exit is 0 whatever the scores say. It is 2 for arguments it
cannot run with, and 1 when a still could not be taken.

## The floor

`--floor` shoots build A a second time (`<view>-a2.png`) and scores it against the first
(`<view>-floor.jpg`, and `floor` in the row, printed beside the view's score): the difference two
stills of one build leave, which is what the method itself cannot tell from a change. What the hold
cannot make the same is whatever depends on the instant it falls at: the hold stops the wildlife
and the simulation where they are, and they are not at the same place on two pages. Read a score
against its floor, never alone.

Run it on a rented rig (`tools/rig/session.sh`, then `--remote <port>`) or a runner, not on a
development machine with other work on it: a floor from a loaded machine is that machine's.
