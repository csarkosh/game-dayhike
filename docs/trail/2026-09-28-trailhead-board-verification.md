# The trailhead board, as it looks in the game

**Date:** 2026-09-28
**Checks:** [`2026-09-28-trailhead-board.md`](2026-09-28-trailhead-board.md) §9.2.
**Looked at:** commit `b304873` for the stills; commit `6a22a93` for the depth measurement and
the two-player view; the board's place as it stands now, 4.5 m past the entrance, for the last
two sections.
**Browser:** Chrome 154 on macOS, `ANGLE (Apple, ANGLE Metal Renderer: Apple M4)`. `?tier=high`
drew with WebGPU at 1600 by 900; `?tier=low` drew with WebGL2 at 1066 by 600 (scaling 1.5).
**Images:** the stand-ins, for every section but the last. There the model's face carries its
planks and the paper and the photograph are in.

The stills are kept outside the repository: every file under `docs/` is a dated `.md`.

## The worlds

Each opened with `seed <token>`, `weather clear`, `time 13`.

The board stood 2.5 m past the entrance for every section but the last.

| World | Seed | The hiker | The board reads | Board from arrival |
| --- | --- | --- | --- | --- |
| `hollow` | 2032433950 | Hugh Kowalski | Summit 0.8 mi | 8.9 m |
| `room-1` | -1098592628 | Silas Harlan | Summit 0.7 mi | 9.5 m |
| `room-140` | 1282170952 | Miles Quennell | Summit 0.3 mi | 6.7 m |
| `room-50` | 252151888 | Ansel Petersen | Summit 0.8 mi | 6.9 m |
| `room-19` | -1609472273 | Hugh Ibarra | Summit 0.6 mi | 9.8 m |
| `room-30` | -1827287130 | Miles Duran | Summit 0.8 mi | 8.7 m |

## The checks

| | Check | High tier | Low tier |
| --- | --- | --- | --- |
| 1 | On arrival the whole board is in the frame and faces the player | Met on all six | Met on all six |
| 2 | From arrival the trail's name can be read | Met on all six | Met on four; missed on `room-50` and `room-19` |
| 3 | At a metre every sheet can be read | Met on all six | Met on four; missed on `room-50` and `room-19` |
| 4 | The map matches the world | Met on five; `room-140` has no fork | The same map |
| 5 | The planks and the wear read as a weathered board | Missed with the stand-ins; met with the planks and the images (last section) | The same |
| 6 | The board can be walked round and not through | Met on all six | The same simulation |
| 7 | "Read the poster" at the poster's sheet and nowhere else | Missed: see below | The same simulation |
| 8 | By headlamp after dark the board can be read | Missed on all six | Not looked at |
| | An upright phone, 390 by 844: the whole board in the first frame | Missed on five of six; met on all six once the board was moved (last section) | Not looked at |
| | Two players see the same marks | Met | Not looked at |

### 1 and 2. On arrival

On every world the board stands beside the trail's entrance, to the side the player looks
toward, its face turned to them and all of it in the frame at 1600 by 900. Its words are not
mirrored: the map is on the left, the poster in the middle, the rules on the right.

The trail's name is read from arrival on the high tier on every world. On the low tier it is
read on four. On `room-50` and `room-19` the board's face is turned from the sun, the low
tier's shade is dark, and the face is a dark panel on which the name is hard to make out. The
same two are why check 3 is missed on the low tier: at a metre the headings are read and the
small print is not.

### 3. At a metre

On the high tier the map's place names, the poster's three lines and the rules' small print
are all read at a metre on every world.

### 4. The map against the world

For each world, the first fork met on the way up the stem, the side its branch leaves on as a
player walks up, and the side the map draws it on, measured from the map's own lines:

| World | The fork | In the world | On the map | Stem edge before it, world and map | Branch, world and map |
| --- | --- | --- | --- | --- | --- |
| `hollow` | node 2 | right | right | 92.6 m, 92.6 m | 16.0 m, 16.0 m |
| `room-1` | node 2 | right | right | 39.9 m, 39.9 m | 12.9 m, 12.9 m |
| `room-50` | node 3 | right | right | 40.9 m, 40.9 m | 11.5 m, 11.5 m |
| `room-19` | node 1 | left | left | 116.2 m, 116.2 m | 47.1 m, 47.1 m |
| `room-30` | node 36 | left | left | 55.5 m, 55.5 m | 171.5 m, 171.5 m |

A still taken 9 m before each fork, looking up the trail, shows the branch leaving on that
side. `room-140` has no fork on its stem; its map is one line from the road to the summit.

### 5. The look

Missed, as it must be until the model and the images are in. The face behind the sheets is a
plain pale panel, so the sheets are pale paper on a pale board, told apart by their shadows,
staples and stains, and the routed name is cut into a pale board and not into wood. Two things
to judge again with the images in:

- Each sheet's water stain reads as a round disc with an even edge.
- On the high tier the face is cooler and greyer than on the low, where it is warm.

### 6. Walking into the board

The player was set 2.2 m in front of the board and behind it, at its middle, 1 m to each side
and 1.9 m to each side, and walked straight at it for 2.2 s. On all six worlds:

- At the middle, the player stops 0.71 to 0.74 m from the board's centre plane, in front and
  behind. The face is 0.16 m from that plane and the player is 0.4 m from centre to side.
- 1 m to a side, the player either stops at the same distance or slides along the row and
  passes its end, ending 1.84 to 2.20 m along the board. The drawn board ends at 1.1 m.
- 1.9 m to a side, the player walks past freely.

No walk passed through the drawn board, and none was stopped where nothing is drawn.

### 7. The prompt

A metre in front of the face, looking square at it:

| Looking at | The prompt |
| --- | --- |
| The poster | On, on all six |
| The rules | On, on all six |
| The map | Off, on all six |
| The board's left end | Off, on all six |
| The trail's name | Off on five; on, on `room-1` |
| The poster, from behind the board | On, on all six |

Pressed at the poster, the panel opens with the hiker's name, "Last seen at Trail 14." and the
line about the ranger station. The prompt is on wherever the poster's point is within the
reach and the cone every prompt in the game uses, which takes in the rules beside it and the
board's back. That is how the prompt has always worked and is not changed here.

### 8. By headlamp

Missed. At `time 23` with the lamp on, the board is seen from arrival as a bright panel. From
1 to 1.6 m the lamp's centre washes the face out to white: the name at the top and the rules
at the edge of the beam are read, the poster's name and lines in the middle of it are not. The
lamp lights a pale surface at a metre far past white, and paper is the palest surface in the
game. The poster's words are still read in the panel the prompt opens.

Two settings were tried on the running game, neither kept:

| The face's share of direct light | At 1.3 m, by lamp | At 6 m, by lamp | By day |
| --- | --- | --- | --- |
| 1 (as built) | Washed out | A white panel | As the stills |
| 0.15 | The rules read, the poster faint | Read | Not tried |
| 0.05 | Every sheet read | Read, a little dim | The sheets go dark where the sun is on them |

### The phone

Missed. At 390 by 844 the view takes in 21.3° to each side. The board's far end is further
from the view's centre than that on five of the six worlds, and its far edge is cut by the
frame: a sliver on `hollow`, more on the others. `room-19` alone has it all in.

Over the 227 seeds of the trail's sweep, the far end of the drawn board (2.2 m wide) is
15.9° to 24.7° from the view's centre, and past 21.3° on 189. The spec's bound of 25° is the
view of a phone of 9 by 16, which is 25.4°. Were the board 2 m further along the trail, the
far end would be 10.9° to 20.6°, within 21.3° on all 227, and the board 8.5 to 11.7 m from
where a player arrives. That is an estimate made by moving the board along the entrance's
direction, with the side it stands on kept.

### Two players

One page made a party, a second joined by its invite link, and the match was started. Both
pages showed the same board: the same hiker's name (Theo Pryor), the same stains in the same
places on each sheet, the same faint letters in the trail's name.

## Found in the look, and fixed: the paint lost its depth test

From some places a player stands, parts of the painted face were not drawn: the sheets and the
trail's name were cut away in wedges, and the model's plain face showed through. It was first
seen from the player's eye 1.6 m and 5 m from the board on the high tier.

The painted plane stood 1 mm in front of the model's face. With the model hidden, or the
plane's depth test off, or the plane 5 mm out, the paint was whole again; the material's
slope bias changed nothing where the face is looked at square on. With the view's near plane
at 5 cm, a vertex lands in depth to within about 0.7 mm for every metre of range, so from
beyond a metre or two a 1 mm gap can go either way, and which way depends on where the eye is.

The plane stands 2 mm out now, with a constant depth bias of 120 steps on its material
(`BOARD_FACE_LIFT`, `BOARD_FACE_BIAS`). Measured on `hollow` from 80 standpoints on each tier,
1 to 18 m in front of the board and up to 1.5 m to either side, by reading the screen at five
points on the paint and comparing each with the same point read with the depth test off:

| | Standpoints with the board in clear view | Paint lost at 1 mm, no bias | Paint lost as built |
| --- | --- | --- | --- |
| High tier, WebGPU | 75 | 16 | 0 |
| Low tier, WebGL2 | 78 | 1 | 0 |

The standpoints left out, 5 and 2, had the car between the eye and the board.

The fork signs' lettering stands 1 mm in front of its planks with no constant bias, as the
board's paint did. It was not looked at here.

## The board moved further along

For the phone, the board was moved from 2.5 m past the entrance to 4.5 m, with leave to step
back in half metres, to 2.5 m at the least, where the trail bends into the side the player
looks toward (the spec's §3.1). Over the 227 seeds its far end is 10.88° to 20.56° from the
view's centre; it stands 4.5 m past the entrance on 224, 3.5 m on 1 and 3 m on 2.

| World | Board from arrival | The board's ends, off the view's centre |
| --- | --- | --- |
| `hollow` | 10.8 m | 4.2° and 15.8° |
| `room-1` | 11.5 m | 8.0° and 18.9° |
| `room-140` | 7.2 m | 0.6° and 18.1° |
| `room-50` | 8.7 m | 2.3° to one side and 12.1° to the other |
| `room-19` | 11.7 m | 0.6° and 11.3° |
| `room-30` | 10.6 m | 2.8° and 14.7° |

Looked at on arrival on the high tier, before any input:

| View | Seen |
| --- | --- |
| 390 by 844 | The whole board, roof and posts, is in the frame on all six. |
| 360 by 800 | The same, on all six; on `room-1` the roof's end is at the frame's edge. |
| 1600 by 900 | The whole board on all six. The trail's name is read on `room-140` and `room-50`, the two nearest. On the four that stand 10.6 to 11.7 m away its letters are a few pixels tall and are read only with the still enlarged. |

So the move costs the name its reading from arrival on the worlds where the board stands
furthest. The watcher's sweep was run with the board in both places and no count and no stand
differs between them.

The board by headlamp and the fork signs' lettering are left as they are.

## With the planks, the paper and the photograph

Looked at on `hollow` and `room-140`, on both tiers, on arrival, from 2.3 m and from a metre.

| | Seen |
| --- | --- |
| The face | Weathered planks lying across the board, grey-brown, with knots and gaps between them. |
| The sheets | Grey-beige paper with fibre and flecks, each with its staples, its stain and its bleached corner. They stand out from the planks on both tiers. |
| The poster | The photograph of the missing hiker, head and shoulders, facing the reader, cut to its print and not stretched, faded toward the paper. Under it the name and the two lines, read at a metre. |
| The map and the rules | As before, read at a metre. |
| The model's own materials | Two, both textured; the game changes neither. |
| The images | Both are asked for and arrive: the stand-ins are replaced on the first frames. |

**The trail's name was lost on the planks, and is painted now.** The name and the distance were
drawn as the fork signs' lettering is, dark in the wood. On the pale stand-in face that read; on
the dark planks it could barely be made out on either tier. The grooves carry pale paint now
(`ROUTED_PAINT`, `ROUTED_SHADOW`), worn as before. With it the name and the distance are read
at a metre and from 2.3 m on the high tier, and at a metre on the low; from 2.3 m on the low
tier they are faint.

Still as the earlier sections found: each sheet's stain is a round disc with an even edge; by
headlamp at a metre the sheets wash out to white.
