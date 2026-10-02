# The title loop

**Date:** 2026-10-01
**Status:** Designed, not built.
**Builds on:** [`2026-09-29-intro-scene.md`](2026-09-29-intro-scene.md) §5.1, which leaves the
title page a still frame until "the looping title video comes later"; this is that video, and the
page that shows it. The scene player and the scene route are the intro's (§2 there).

## 0. What this is

The title page is the game's first impression. Today it is one still frame of the intro film
behind the party's roster and the Play button. It becomes a slow, silent, 30-second film of the
world the game is played in, looping without a visible seam, while the page stays as light to load
as it is now: the still paints with the page, the loop arrives behind it and fades in, and Play
takes the bandwidth back the moment it is pressed.

## 1. What a visitor sees

1. **The first paint.** The title page appears with a still, the loop's own first frame (a view
   across the world in soft overcast light), behind the roster and the buttons. Nothing heavy is
   fetched.
2. **The loop arrives.** Once the page has finished loading, the loop's file downloads in the
   background. When the browser says enough of it is in hand to play through, the loop starts on
   the same frame as the still and the still fades out over half a second, so the change is not
   seen.
3. **The loop.** Five slow shots of about six seconds, each dissolving into the next over a
   second; the last dissolves into the first, so the repeat is one more dissolve. Silent; slow
   camera moves only; no people.
4. **Play.** The loop's download is cancelled at once, so the game's load has the bandwidth, and
   the intro film starts as it does today.
5. **The still stays** when the browser asks to save data, on a slow connection, when the visitor
   prefers reduced motion, and when the video fails to load or the browser refuses to play it.
   The page never shows a broken or black video.
6. **Everyone sees the same page,** a party's host and the players joining it alike.

## 2. The title scene

A second scene beside the intro on the scene route: `/dayhike/scene/title`, with the same
`window.dayhikeScene` (`seek`, `frame`, `time`, `ready`, `engine`) the intro has.

**Setting.** The intro's world (`hollow`), so the place in the title, the film and the hike is one
place; the `overcast` weather (cloud 0.8, mist 0.25), so the coast, the hills and the summit stand
in a soft grey light with distant haze; one afternoon hour, held, so the light never changes across
the loop (the hour is set at the look). No people, no car, no captions, no wildlife.

**The shots.** Five, each 7 s long and starting on a whole second (0, 7, 14, 21 and 28 s), so no
frame of the film straddles a cut. Each is placed from the world's own features, found the way the
intro finds the trailhead, so it lands on every world the scene is built from:

| # | What | The camera |
| --- | --- | --- |
| 1 | The coast | Low over the sea, drifting toward the pebble cove between its headlands, the road and the forest's edge above it. The loop's first frame and the title still: open sea and sky where the page sets its title and buttons. |
| 2 | Over the forest | A slow glide just above the canopy, toward the hills. |
| 3 | The lake | A slow pan across the trail's lake, its water and its shore; its marsh end in view where the lake lies low. |
| 4 | The trailhead | A slow rise from the trail's mouth and the board up to the forest it leads into. |
| 5 | The summit | A slow push toward the peak rising out of the haze. |

The camera is slow everywhere: under 2 m/s and under 0.12 rad/s (about 7° a second) in every shot,
a test. Framing (heights, lenses, where a drift starts and stops) is set by looking at frames.
Each shot keeps its subject toward the frame's middle: on a phone held upright the page shows the
middle of the 2:1 frame.

**Joins.** Each shot's first and last second are its handles for the dissolves: on screen it runs
alone from its second second to its sixth, and dissolves with the shot before in its first second
and with the shot after in its last, so five shots of 7 s make 30 s with five dissolves. The scene
itself has no dissolves: it is five plain shots end to end (35 s), and the joining is the file's.

## 3. The file

One video and its still, delivered through the asset repository like every asset, LFS-tracked,
listed in `client/assets/catalog.json`'s `video` array with id `title`, content-hashed by the build
and served immutable:

- H.264 in MP4, 8-bit, 1280 by 640 (2:1), 24 frames a second, key frames every 2 s, `faststart`;
  **no audio track**. Exactly 30 s (720 frames): the five shots' middles joined by one-second
  dissolves, the last into the first, the file starting just after that last dissolve, so its last
  frame runs on into its first.
- Dithered against banding in the haze and gated on a banding score, as the intro film is; its
  loop's seam gated: the change from its last frame to its first is no larger than an ordinary
  frame-to-frame change. Its size is measured at the encode, not promised (about 15 to 17 MB is the
  estimate from the film's rate).
- The still: the file's first frame, as a WebP of 1280 by 640 under 200 KB, so the fade from the
  still to the loop shows no change.

The intro's still (`images/intro.still.webp`) is no longer shown anywhere and stops shipping.

## 4. The title page

Built as the game's other screens are, a pure model and a renderer that draws what it says.

**The model** (`client/src/game/titleLoopModel.ts`) decides what the backdrop shows from plain
inputs, and is tested without a browser:

- Still only: `navigator.connection.saveData`; `navigator.connection.effectiveType` of `slow-2g`,
  `2g` or `3g` (a browser without `navigator.connection` counts as fast); `prefers-reduced-motion:
  reduce`; no title film in the catalog.
- Otherwise: on the page's `load` event, start the download; on `canplaythrough`, show the loop;
  on any `error`, or a refused `play()`, the still for good; on Play, stop and release the download;
  on the tab hidden, pause, and play again when it shows.

**The renderer** (`client/src/game/titleLoop.ts`) puts a muted, inline (`playsinline`), looping
`<video>` behind the still with `preload="none"` and no `src` until the model says load, hidden from
screen readers (`aria-hidden`) and from picture-in-picture; it reports the video's events to the
model and fades the still out over 0.5 s when the loop shows. The still is the title still from
the catalog (`assetUrls.ts`: `titleVideoUrl`, `titleStillUrl`); `landingBackdrop.ts`'s still gives
way to it.

**The look.** The still and the loop sit under the page's vignette as the still does today, but
softened by a 2 px blur (scaled 1.03 to hide the blur's edge) where the still had 6 px: the coast,
the forest and the summit read, and the title and buttons stay in front.

**Weight.** The page's first load stays under 1.5 MB and fetches the still alone; the loop's code
is a few kilobytes and loads no engine.

**The seam.** A browser's own `loop` can hold a frame or two while it goes back to the start. The
frame timing at the wrap is measured in Chrome, Safari and Firefox; where it holds, the page plays
the loop from two `<video>` elements, handing over at the end.

## 5. Deploy

`npm run deploy:verify` checks the title film and its still on the live site: present, a real MP4
(`ftyp`), the still under 200 KB, neither fetched in the title page's first load. The check finds
their hashed names in every chunk the entry names, where the asset-url map lives
(`engineChoice-*.js`), as the models' check does; the film's and the still's checks do the same.

## 6. Testing

**In Node.** The title scene: five shots of 7 s on whole seconds, the weather and the held hour, no
actors, car or captions, each shot placed from a test world's features, the camera under its speed
limits at every frame. The model: every rule of §4 in turn. The renderer: on the stand-in DOM the
other screens' tests use, the video's attributes, no `src` before load, the fade. The scene route:
the title scene builds with no film models loaded and says `ready`.

**In the browser.** A fast draft of the 840 frames first, played back and checked frame by frame for
one-frame pops, then the full record. On the title page: the frame timing at the loop's wrap in
Chrome, Safari and Firefox; a first load that fetches the still alone; data saving, a slow
connection and reduced motion keeping the still; Play cancelling the loop's request. Then a look on a
desktop and a phone.

## 7. Not in this

Sound on the title page; an AV1 version; a second encode for phones; the title rendered live
(it would bring back the engine and the download the light page removed); changes to the intro film.
