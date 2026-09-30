# The trail from the treeline, as it looks in the game

**Date:** 2026-09-29
**Checks:** [`2026-09-29-trail-from-the-treeline.md`](2026-09-29-trail-from-the-treeline.md)
§9.2, its six, and two more: the car's patch and the animals that walk.
**Looked at:** commit `9544ac9`, with the forest's floor in the strip at 0.6, for every
section but the last; commit `3955efc`, with the floor at 1, for the last.
**Browser:** Chrome 154, headless, on macOS, `ANGLE (Apple, ANGLE Metal Renderer: Apple M4)`.
Both tiers drew with WebGL2: this browser is not one the engine's rule gives WebGPU to. One
more run, `hollow` on the high tier with `?engine=webgpu`, drew with WebGPU: 138 shader stages
read from the shipped map, none translated on the page.

The stills are kept outside the repository: every file under `docs/` is a dated `.md`.

## The worlds

Each opened with `seed <token>`, `weather clear`, `time 13`, at 1600 by 900 and at 390 by 844,
with `?tier=high` and again with `?tier=low`.

| World | Seed | Trees within 40 m of the pad | The nearest tree | The first edge, from straight inland | 30 m along the trail | The first fork |
| --- | --- | --- | --- | --- | --- | --- |
| `hollow` | 2032433950 | 6 | 15 m | 6.6° | 29.8 m inland, 3.4 m along the road | 139 m |
| `room-1` | -1098592628 | 10 | 20 m | 2.8° | 30.0 m inland, 1.5 m along | 122 m |
| `room-140` | 1282170952 | 12 | 14 m | 5.4° | 29.9 m inland, 2.8 m along | none: 501 m to the crest |
| `room-50` | 252151888 | 5 | 19 m | 8.4° | 28.9 m inland, 2.1 m along | 137 m |
| `room-19` | -1609472273 | 2 | 26 m | 20.8° | 25.5 m inland, 12.1 m along | 108 m |
| `room-30` | -1827287130 | 9 | 21 m | 6.3° | 29.8 m inland, 3.3 m along | 90 m |

`room-19` has the fewest trees within 40 m of the pad of `hollow` and the two hundred worlds
`room-1` to `room-200`; `room-115` and `room-160` have 3.

## The checks

| | Check | High tier | Low tier |
| --- | --- | --- | --- |
| 1 | On arrival there is grass underfoot and trees ahead, and no sand between the player and the board | Grass and no sand on all six. Trees ahead on four; on `room-50` and `room-19` the pad reads as open ground | The same |
| 2 | The board is whole in the first frame, at 1600 by 900 and at 390 by 844, with nothing between it and the player | Met on all six | Met on all six |
| 3 | The trail leaves the pad into the trees, and its first 30 m can be seen to go inland | Met on five. On `room-19` it leaves at 20.8° and then runs along the shore, on grass | The same trail |
| 4 | To either side of the strip the shore is sand, as it was, and the forest thins into it, with no line where the grass stops | Sand beyond nine of the strip's twelve sides, grass for half or more beyond three. Missed for the line: the grass stops within 6 m | The same ground |
| 5 | Walking the trail to the first fork, no part of it is on sand | Met on all six | Met on all six |
| 6 | From the road, a hundred metres along it, the strip reads as a wood that comes down to the road and not as a patch laid on the sand | Met on four from the road. Missed on `room-50` and `room-19`, where it is grass with a few trees. From above the beach, a patch on every world looked at | The same |
| 7 | The car stands on the shoulder with its soft dark patch under it, on ground painted as the ground round it is | Met on all six | Met on all six |
| 8 | Watched for two minutes from the pad and two from the first trees, no animal that walks is on the sand or the road | Met on all six | Met on all six |

### 1 and 3. On arrival

On every world the player arrives on grass, facing up the trail, with the board beside the
trail's entrance and the car behind. No sand is in the frame on any of the twelve arrivals.
The trail's bed is bare earth from the pad on.

On `hollow`, `room-1`, `room-140` and `room-30` the first trees stand 14 to 21 m from the pad
and the wood closes behind them: the trail is seen to run straight into it.

On `room-50` and `room-19` the ground inland of the shore is open, and the strip's wood is
thin: 5 and 2 trees within 40 m of the pad, the forest's density in the strip at its floor of
0.6 where it reads 1 on the other four. The pad reads as open grass with a few trees, the
nearest 19 m and 26 m away, and the forest's edge beyond them. On `room-19` the trail leaves
the pad 20.8° from straight inland, is 25.5 m inland after its first 30 m, and from there
runs along the shore for the rest of the way to its first fork, on grass, with the sand to its
seaward side.

On `room-19` a pale patch lies 12 m inland of the pad, to the left of the trail as the player
arrives: one 2 m cell of the ground reads a slope of 0.69 there and is painted rock.

### 2. The board

Whole in the first frame on all twelve arrivals at 1600 by 900 and on all twelve at 390 by
844, 11 m from where the player stands, with grass and the trail's bed between. On five worlds
it stands to the left of the trail and on `room-19` to the right.

### 4 and 6. The strip's sides, and the strip from the road

Read 21 m from the road's centre, along the road, the sand's and the pebbles' share of the
ground's paint is 0 from the pad out to 36 m to either side. At 42 m it is 0.51 to 1.0 on
nine of the twelve sides. On the other three the ground beyond the strip is grass for half or
more, and it is 0.02 (`room-1`), 0.10 (`room-19`) and 0.29 (`room-30`). The strip's weight
falls over 15 m there, but 9 m of height times that weight crosses the sand's band of heights
within 6 m, so where sand lies beyond, the grass stops within 6 m.

From 64 m along the verge at eye height, on `hollow`, `room-50` and `room-19`, that line
reads as the edge of a grass bank with sand before it. From the road a hundred metres along
it, at eye height, the ground at the trailhead is seen at too low an angle to show an outline:
on the four wooded worlds the forest's edge is what is seen, and the trailhead is where it
comes nearest the road. On `room-50` and `room-19` a few trees stand on grass that reaches the
road.

From 50 m above the beach, where no player can stand, the strip is a rectangle of grass laid
across the sand of the verge, on all three worlds looked at from there. On `hollow` the wood
stands behind it and one or two trees in it; on `room-50` and `room-19` it lies in the open.

From 110 m inland and 14 m above the ground, looking back at the road on `room-50` and
`room-19`, the grass is seen to run down to the road at the trailhead with the verge's sand
to either side of it. The rectangle's sides are behind trees and are not picked out.

### 5. The trail to the first fork

Stills were taken along the stem every 18 m, or every eighth of the way on `room-140`, which
has no fork: the bed is earth on grass or on the forest's floor in every one. The sand's and
the pebbles' share of the paint under the stem's line, read every half metre from the pad to
the first fork, is 0 on all six worlds.

### 7. The car

On the shoulder on every world, its patch under it on both tiers. The ground under it and
round it is one bare tan ground, with tufts of grass from a few metres inland of it.

### 8. The animals that walk

From the pad looking up the road for a minute and down it for a minute, then from the trail
45 m along it looking back at the road for two. Every elk, deer, rabbit and squirrel drawn was
read four times a second and its place put to the animals' own rule, forest ground by the
height the shore's rules read and 30 m or more from the road: 48,032 readings on the high
tier and 18,426 on the low, none off forest ground. The nearest that any stood to a player at
the pad was 21.2 m, an elk on `room-1`, 30.4 m from the road's centre. On `hollow`, `room-1`,
`room-30` and `room-50` an elk or a deer stood in the strip between 30.0 and 33.4 m from the
road's centre: at the trailhead the animals come as near the road as their rule lets them.

## With the strip's numbers changed on the running game

Each was set on the running game for `room-50` and `room-19`, on the high tier, at commit
`9544ac9`, and the same views taken.

| Constant | As built | Set to | What it showed |
| --- | --- | --- | --- |
| `STRIP_FOREST_FLOOR` | 0.6 | 1.0 | A wood stands at the pad on both worlds: trees to either side of the trail from 20 m in, their shade across the trail's bed by the board, and from above a stand of trees that comes down to the road. The rectangle of grass is under it still |
| `STRIP_EDGE` | 15 m | 45 m | The rectangle's sides are softer and the rectangle is 60 m longer. It still reads as a rectangle from above, and the arrival is as built |

## What follows from it

- The strip's outline is a rectangle wherever it can be seen whole, which here was only from
  above the beach. Widening the edge does not remove it. The sand's paint follows the height
  the shore's rules read, and a height that rises 9 m crosses the sand's band early in any
  ramp.
- On worlds whose shore is open the strip at its floor of 0.6 is a lawn with a tree or two.
  At 1.0 it is a wood.

## With the floor at 1

`STRIP_FOREST_FLOOR` is 1 from commit `3955efc` on. Looked at there, on the high tier on all
six worlds and on the low tier on `room-50` and `room-19`: the arrival at 1600 by 900 and at
390 by 844, the view from above the beach, and the views from the road a hundred metres along
it each way.

| World | Trees within 40 m of the pad, at 0.6 | At 1 |
| --- | --- | --- |
| `hollow` | 6 | 6 |
| `room-50` | 5 | 11, all of them giants |
| `room-19` | 2 | 7, five of them giants |

Over the 227 seeds the fewest within 40 m of a pad is 4 where it was 2, the median 10 where it
was 9, and no trail is another line.

| | Check | With the floor at 1 |
| --- | --- | --- |
| 1 | Grass underfoot, trees ahead, no sand between the player and the board | Met on all six, on `room-50` and `room-19` on both tiers |
| 2 | The board whole in the first frame at both sizes, with nothing between it and the player | Met on all six |
| 3 | The trail leaves the pad into the trees | Met on all six for the trees. `room-19`'s trail is the one it was, and turns along the shore |
| 4 | No line where the grass stops | Missed, as before: the ground is the same |
| 6 | From the road the strip reads as a wood that comes down to the road | Met on all six. From above the beach the rectangle of grass is under the trees on every world |

On `room-50` and `room-19` trees stand to either side of the trail from 19 m in, and their
shade falls across the trail's bed by the board. The four wooded worlds look as they did.

Checks 5, 7 and 8 were not looked at again. The trail, the car and the ground the animals
keep to are what they were: the floor moves no trail, and the animals' rule reads the shore's
height and the road, not the forest's density. No rabbit stands in the strip now, under its
closed canopy.
