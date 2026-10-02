# The title loop, as staged and measured

**Date:** 2026-10-02
**Design:** [`2026-10-01-title-loop.md`](2026-10-01-title-loop.md). **Plan:** [`2026-10-01-title-loop-plan.md`](2026-10-01-title-loop-plan.md).

Measured on an Apple M4 Mac (macOS 26.6.2), Chrome 154, the title scene drawn on WebGPU at the
high tier, the world `hollow` in the overcast at the held hour 15.

## The shots

The world's places the shots are set from: the trail's start at (−312, 0.3) facing +x; the
shoreline near x −405 at z 0, the sea to −x; the cove at z 0, its half-width 177 m, its headlands
narrow ridges at z ±177 reaching 103 and 113 m out to sea; the lake at (165, 60), radius 36 m, its
water at 175.3 m; the summit at (408, −172), 256 m, with a higher shoulder (300 m) 100 m to its
north.

| # | Shot | Set at | Why |
| --- | --- | --- | --- |
| 1 | The coast | Inside the cove, 70 m out from the shoreline and 6 m over the water, drifting 12 m along the beach, looking along it to a point 0.7 of the half-width beyond the cove's middle. | From 250 m out the lens held neither headland and the mist left a band of trees; beside the near headland its bare ridge filled half the frame. Along the beach the frame holds the water, the beach and the forest's edge, with a headland in the haze. |
| 2 | Over the forest | 90 m over the ground a quarter of the way from the start to the summit, gliding 12 m toward it. | At 45 m the camera was inside the crowns. |
| 3 | The lake | 25 m over the water or the bank, 55 m beyond the rim on the trail's side, panning 0.6 rad across. | From 4 to 10 m up the lake read edge-on. |
| 4 | The trailhead | 1 m behind the start, rising from 1.6 to 7.6 m, looking 30 m up the trail. | From 6 m behind, the camera stood over the hike's parked car, whose roof crossed the bottom of the frame as it rose. |
| 5 | The summit | 300 m short of the summit on the trail's side, 110 m over the ground (about the summit's own height), pushing 12 m toward it. | The trail's side is forested to the top; the open ground near the summit lies only on its north side. From above the canopy the summit and its ridge stand out of the haze. |

Every shot keeps the camera under 2 m/s and 0.12 rad/s and above the ground and the water at every
frame (`client/test/game/scene/title.test.ts`).

After each cut the scene route draws 48 frames at the new camera and waits for the world before the
frame that counts. Read frame by frame, the recording showed no tile changing out of step with its
neighbours after any cut.

## The file

`video/title.mp4`: 720 frames, 1280 by 640, 24 frames a second, no sound track, 17,270,210 bytes.
Its banding score (CAMBI) is 0.42 at worst over all 720 frames. The change from its last frame to
its first is 0.48 levels a pixel, against 3.23 at most between consecutive frames inside the shots.
The still, `images/title.still.webp`, is the file's first frame: 117,088 bytes.

## The title page, in Chrome

- **First load:** the page fetched the still before its `load` event ended (at 247 ms of 260 ms).
  The film was its last request, after the still and every script, and the intro film was not
  fetched.
- **The loop:** it played muted with the still faded off it. On a 4g connection
  (`effectiveType` 4g, no data saving) the loop was not kept back.
- **The wrap:** frame callbacks were timed over 65 s, across two wraps. The gap at each wrap was 65
  and 67 ms, and no frame was skipped. The largest gap anywhere was 67 ms and the median 48 ms: a
  24 fps film on a 60 Hz display, under the 83 ms (two frames) the wrap is allowed. The browser's
  own `loop` holds here, so no handover between two videos is needed in Chrome.

**Not measured:** the wrap in Safari and Firefox, and a phone. The page's rules for a slow
connection, saved data, reduced motion and Play are pinned in Node
(`client/test/game/titleLoopModel.test.ts`, `client/test/game/titleLoop.test.ts`), not in a
browser.
