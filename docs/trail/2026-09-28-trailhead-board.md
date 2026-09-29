# The trailhead board

**Date:** 2026-09-28
**Status:** Built. The steps that built it are `docs/trail/2026-09-28-trailhead-board-plan.md`; how it looks in the game is `docs/trail/2026-09-28-trailhead-board-verification.md`.
**Amends:** `docs/trail/2026-09-28-trail-14-trailhead.md` §3.3 (the sign at the entrance, which
goes) and §3.4 (the notice board, which moves). The car, the player's place and facing, the
trail's name and the road wall are unchanged.
**Depends on:** the Trail 14 trailhead (`trailEntrance`, `carSite`, `trailheadSpawn`), the fork
signs' lettering and wear (`game/signMeshes.ts`, `game/labelWear.ts`), the place names
(`sim/placeNames.ts`).

## 0. What this is

The trailhead has a post with one plank that reads "Trail 14", and a notice board off to one
side of the pad whose face is a flat brown panel with three lines of text in its corner. The
plank is an arrow, and it points away from the trail. The board's frame and roof look like real
wood; its face does not.

After this change there is one thing at the trail's entrance: **the trailhead board**, turned to
face the player as they arrive. Its face is weathered planks with the trail's name routed across
the top, and three sheets of aged paper stapled to it: a map of this world's own trails, the
missing hiker's poster with a faded photograph, and a sheet of rules. The post and its plank are
gone.

## 1. Decisions

| Question | Decision |
| --- | --- |
| What stands at the entrance | The trailhead board, alone. The post with the "Trail 14" plank is removed. |
| Which way it faces | Toward the place a player arrives, exactly. |
| Its solid shape | Five boxes in a row along the board's own line, 0.55 m deep. |
| What its face carries | The trail's name and the distance to the summit, routed into the wood; a map; the missing hiker's poster; a sheet of rules; torn corners where older notices hung. |
| The layout | The map takes the left half. The poster and the rules are pinned to its right. |
| The map | This world's own trails, drawn from its trail graph, faded. |
| The poster | A faded photograph of the missing hiker above their name. |
| The missing hiker's name | The first name is drawn from men's names only, because the hiker is one man. |
| Where the surfaces come from | Texture maps: the planks in the board's model, the paper and the photograph as images. Words, lines and wear are drawn over them when the match starts. |
| How it is read | In the world, by walking up to it. "Read the poster" still opens the poster's panel. |
| The wire | Protocol 5 stands. |
| The level id | Moves (§7). |

## 2. Measured

Read from the world generator over the 227 seeds of `client/test/sim/trailGateSeeds.ts`, for the
place and the shape of §3.

| Measure | Least | Median | Most |
| --- | --- | --- | --- |
| The board's centre, off the centre of the player's view | 4.62° | 13.28° | 15.09° |
| The board's far end, off the centre of the player's view | 10.88° | 18.75° | 20.56° |
| The board's centre, from the player | 7.19 m | 11.48 m | 11.72 m |
| The bed's centreline, from the board's boxes | 1.27 m | 1.33 m | 1.74 m |
| The board's boxes, from the road's centreline | 10.00 m | 20.79 m | 22.06 m |
| The board's boxes, from the car's box | 9.14 m | 13.35 m | 13.69 m |
| The board's boxes, from the player | 6.81 m | 11.17 m | 11.38 m |

- A place clears the road and the bed on every seed. The board stands 4.5 m past the entrance
  on 224 seeds, 3.5 m on 1 and 3 m on 2.
- The board stands on the side of `+n` on 63 seeds and of `−n` on 164.
- **The whole board is within 21° of the centre of the view on every seed.** The view's 1.4 rad
  is its height, so a phone held upright sees 25.4° to each side at 9 by 16 and 21.3° at 390 by
  844, and the board is in the first frame on both.
- Five other places were measured and set aside:

| Place | The board's far end, off the view's centre | From the player | Why not |
| --- | --- | --- | --- |
| At the pad's rim, 2.35 m off the bed | 23.76°–38.69° | 4.63–7.49 m | Within 25° on only 4 seeds: part of the board is out of an upright phone's frame on the rest. |
| 3 m past the rim, 2.35 m off the bed | 13.66°–22.73° | 7.10–10.25 m | The bed comes within 1.10 m of a box, under the 1.15 m a player needs, and neither side clears on 72 seeds. |
| 2 m past the rim, 2.5 m off the bed | 17.31°–26.04° | 6.31–9.37 m | Over 25° on some seeds, once the side is chosen by the line of sight as §3.1 has it. |
| 2.5 m past the rim, 2.5 m off the bed | 15.86°–24.72° | 6.74–9.83 m | Built first. Over 21.3° on 189 seeds: on a phone of 390 by 844 the board's far edge is cut by the frame. |
| 4.5 m past the rim, 2.5 m off the bed, and nowhere nearer | 10.88°–38.17° | 8.02–11.72 m | On 3 seeds the trail bends into the side the player looks toward, and the board would stand on the far side, 34° to 38° off the view's centre. |

## 3. Where the board stands

Everything here follows from the seed and the trail graph on every peer. `sim/` rules hold: no
trigonometry, no `Math.pow`, no `**`, no `Math.hypot`; lengths by `Math.sqrt`; directions as unit
vectors.

It uses what the trailhead already gives: **E** and **d**, the entrance and the trail's direction
(`trailEntrance`); **C**, the car's place (`carSite`); **S**, where a player arrives
(`trailheadSpawn`).

### 3.1 Its place and facing

1. The candidate centres are `E + k · d ± BOARD_OFFSET · n`, where `n` is `d` turned a quarter
   turn and `k` runs from `BOARD_ALONG` back to `BOARD_ALONG_MIN` in steps of
   `BOARD_ALONG_STEP`: ten places, five to each side.
2. For each, the board faces S: its facing **f** is the unit direction from the centre to S, and
   its own line **a** is `(−f.z, f.x)`, which is the player's right as they look at it.
3. A candidate **clears** when every one of its boxes (§3.2) is at least `BOARD_ROAD_CLEAR` from
   the road's centreline at the box's own z, and the bed's centreline, on any edge, is at least
   `BOARD_BED_CLEAR` from every box.
4. Of the candidates that clear, the board takes the one nearest the centre of the player's
   view, which is the line from S to E. Where none clears, it takes the nearest of them all.
   A tie goes to the place further along, and then to `+n`.

| Constant | Value | Why |
| --- | --- | --- |
| `BOARD_ALONG` | 4.5 m | Far enough past the pad's rim that the whole board is inside an upright phone's view (§2). |
| `BOARD_ALONG_MIN` | 2.5 m | The nearest the board may stand, where the trail bends into the side the player looks toward. |
| `BOARD_ALONG_STEP` | 0.5 m | The step between one place and the next. |
| `BOARD_OFFSET` | 2.5 m | The board's centre from the bed's centreline. |
| `BOARD_BED_CLEAR` | 1.15 m | `TRAIL_BED_HALF` plus `PLAYER_HALF.x`, as for the car. |
| `BOARD_ROAD_CLEAR` | 6 m | `ROAD_BED_HALF` plus 0.5, the shoulder the car keeps. |

### 3.2 Its solid shape

Boxes in the simulation are axis-aligned and cannot turn. A board 2.2 m wide that faces any way
is therefore five boxes in a row:

- centres at `centre + k · BOARD_BOX_STEP · a` for k = −2 … 2;
- each `BOARD_BOX_HALF` = { x 0.275, y 1.25, z 0.275 }, standing on the ground at its own centre;
- material `kiosk`, as today.

`BOARD_BOXES` is 5 and `BOARD_BOX_STEP` is 0.44 m, so the row is 2.31 m long and covers the board's 2.2 m at any angle,
and nowhere thicker than 0.78 m. The roof overhangs the row; it is above a hiker's head and has
no box, so a player can stand in under its edge to read.

Until the model arrives, or for good if it never does, the five boxes are drawn in its place.

### 3.3 The poster's place

The poster is one of three sheets (§4.2). Its prompt stands at its own sheet:

`centre + POSTER_ALONG · a + (BOARD_BOX_HALF.z + POSTER_STANDOFF) · f`, at `POSTER_HEIGHT` above
the ground at the board's centre.

| Constant | Value |
| --- | --- |
| `POSTER_ALONG` | 0.36 m (the sheet's centre, right of the board's) |
| `POSTER_HEIGHT` | 1.32 m (was 1.4) |
| `POSTER_STANDOFF` | 0.05 m (unchanged) |
| `POSTER_RADIUS` | 0.4 m (unchanged) |

Its kind and its id keep their numbers, 2 and 2.

### 3.4 What is removed

- The post at the entrance and its plank: `trailSignSite`, `trailSign`, `allSignPosts`, the
  `TRAIL_SIGNS` tunable, and the box pass 9 emitted for it. Pass 9 emits the junction posts only.
  `TRAIL_NAME` stays; the board and the poster read it.
- The board's place in the road's frame: `SIGN_ROAD_U`, `SIGN_ROAD_Z`, `KIOSK_HALF`, `PROPS`,
  `roadProp`, `propSite` and its mirrored-site rule, and `kioskFacing`. `trailheadSite` goes with
  them; the car is asked for by `carSite` and the board by `boardSite`.

## 4. The board's face

The face is 2.0 m wide and 1.0 m tall, its centre 1.37 m above the board's foot, 0.159 m in front
of the board's centre plane.

### 4.1 Layers

| Layer | What | Where it comes from |
| --- | --- | --- |
| 1 | Weathered planks, with their relief | Texture maps in the board's model (§6) |
| 2 | The trail's name and the distance to the summit, routed into the wood and painted: pale paint in the grooves, since lettering as dark as the fork signs' cannot be read on the board's dark planks | Drawn when the match starts |
| 3 | Three sheets of aged paper, and the torn corners of older ones | The paper image (§6), placed and stained from the seed |
| 4 | The map, the poster's words and photograph, the rules | Drawn when the match starts; the photograph is an image (§6) |
| 5 | Fading, water stains, rust under the staples, scratches | Seeded wear |

Layers 2 to 5 are one texture, 2048 by 1024, clear wherever the planks show. It is drawn on a
plane 2 mm in front of the face, biased toward the eye in depth, as the fork signs' lettering is drawn in front of their planks.
The game places that plane by the face's size and place above, which are the model's to keep; it
does not look for the face by a material or a name.

### 4.2 Layout

As fractions of the face, from its top-left corner as the player sees it:

| Part | Left | Top | Width | Height | Turned |
| --- | --- | --- | --- | --- | --- |
| The trail's name | centred | 0.035 | — | letters 0.10 tall | — |
| The distance | centred | 0.155 | — | letters 0.04 tall | — |
| The map | 0.035 | 0.23 | 0.50 | 0.73 | −0.4° |
| The poster | 0.57 | 0.24 | 0.22 | 0.62 | 1.2° |
| The rules | 0.81 | 0.27 | 0.165 | 0.52 | −1.0° |
| A torn corner | 0.60 | 0.88 | 0.06 | 0.07 | 3° |

Each sheet has a staple near each corner.

### 4.3 The words

| Part | Reads |
| --- | --- |
| The trail's name | `TRAIL 14`, from `TRAIL_NAME`, upper case |
| The distance | `SUMMIT <n.n> MI`: the shortest trail from the pad to the crest (`graph.shortestHome`) in miles, to one decimal place. On the world `hollow` it is 1274 m, `SUMMIT 0.8 MI`. |
| The map's heading | `TRAIL 14 · TRAILS` |
| The poster | `MISSING`, the photograph, the hiker's name, `Last seen at Trail 14.`, `If you have seen them, call the ranger station.` |
| The rules | `BEFORE YOU GO`, `STAY ON THE TRAIL`, `BE OFF THE MOUNTAIN BY DARK`, `PACK IT IN, PACK IT OUT`, and in small print `No fires. No camping. Tell someone where you are going.` |

The poster's panel (`game/posterPanel.ts`) is unchanged.

### 4.4 The map

Drawn from the world's trail graph, as a player standing at the road and facing inland would
hold it: up the sheet is inland (+x), and right across it is −z.

- **Fit:** the graph's nodes, with a 60 m margin all round, fitted inside the sheet's inner
  rectangle with their proportions kept.
- **Trails:** stem edges as one solid line; loop, strand and rung edges dashed and thinner.
- **The road:** a heavier line along its centreline.
- **Places:** each pond as a filled oval; the summit as a small triangle; every named place
  lettered with the name the fork signs give it (`signSites`).
- **The pad:** a red dot and `YOU ARE HERE`.
- **The mountain:** five rings round the peak.
- **Fading:** drawn at about three-quarters strength, then stained and worn from the seed.

The map shows every trail, the web below the summit included.

### 4.5 The wear

Seeded by the world's seed and each part's own name, so every peer sees the same marks, and
worked out by the same pure functions that wear the fork signs' lettering (`labelWear`):

- the routed letters fade unevenly, flake and chip;
- each sheet takes a water stain, a sun-bleached corner and rust under its staples;
- the map's ink fades in patches;
- the photograph is bleached, its colour mostly gone.

## 5. The missing hiker's name

The photograph and the body at the crest are one man. `hikerNames` draws the first name from
`HIKER_FIRST_NAMES`, the sixteen men's names of `FIRST_NAMES`, in their order there:

Owen, Miles, Elias, Theo, Hugh, Silas, Reuben, Abel, Cyrus, Jonah, Felix, Amos, Rafe, Boyd,
Callum, Ansel.

- The surnames and the draws are unchanged: one draw for the first name, one for the surname.
- `FIRST_NAMES` stays whole for the place names, which may be anyone's.
- A world's hiker changes wherever the old draw fell on a name that is not in the sixteen. The
  world `hollow` keeps Hugh Kowalski: Hugh was the tenth of thirty-two and is the fifth of
  sixteen, and the same draw lands on both.

## 6. What the models and images provide

| File | What it must be |
| --- | --- |
| `client/assets/models/trailhead.kiosk.glb` | As today (footprint centred on the origin, base at y 0, 2.2 × 2.5 × 1.1 m, the face toward +Z), with the face a weathered-plank surface carrying a base colour and a normal map. Two materials and four textures at most. |
| `client/assets/textures/board.paper.webp` | Aged paper, 512 by 512, even enough to be cut into sheets of any shape. |
| `client/assets/textures/board.portrait.webp` | The missing hiker's head and shoulders, 512 by 512, facing the camera. |

Each is listed in `client/assets/catalog.json` and credited in `CREDITS.md`.

**When one is missing,** the board is never blank:

| Missing | Drawn in its place |
| --- | --- |
| The model | The five boxes (§3.2); the face's layers are not drawn. |
| The model's plank maps (the face still flat) | Layers 2 to 5 over the flat face. |
| The paper | Sheets of one flat paper colour, `#E8E2D2`. |
| The photograph | A grey print, as a photograph bleached past reading. |

## 7. The level id and the pinned values

| Value | Where | What happens |
| --- | --- | --- |
| The trailhead pass's tunables | `client/src/sim/passes/trailhead.ts` | `SIGN_ROAD_U`, `SIGN_ROAD_Z` and `KIOSK_HALF_*` go; `BOARD_ALONG`, `BOARD_OFFSET`, `BOARD_BED_CLEAR`, `BOARD_ROAD_CLEAR`, `BOARD_BOX_HALF_*`, `BOARD_BOX_STEP` and `BOARD_BOXES` join |
| The signs pass's tunables | `client/src/sim/passes/signs.ts` | `TRAIL_SIGNS` goes |
| The level id's probe | `client/src/sim/forest.ts` | The chunks that hold the car and the board's boxes for the probe's seed are measured again and recorded |
| The pass hash, 178231578 | `client/test/sim/groundGradient.test.ts` | Re-pinned |
| The watcher's sweep, 875 of 936 stands | `client/test/sim/watcherSweep.test.ts` | Measured again: the board's boxes now stand beside the trail, about 10.5 m from the pad's centre, and the old board's no longer stand on the pad |
| `hikerNames` | `client/test/sim/hikerNames.test.ts`, `placeNames.test.ts` | The names the tests expect, where a world's hiker changes |
| `GEN_VERSION` | `client/src/sim/forest.ts` | Stays 7: what is generated changes, which the pass hash already reads |

## 8. Where the code changes

| File | Change |
| --- | --- |
| `client/src/sim/trailhead.ts` | New. The trailhead's geometry and constants, moved out of the pass's module so that reading one registers nothing; `boardSite`, `boardBoxes`, `trailheadPlaces`; the road-frame props go (§3.4). |
| `client/src/sim/passes/trailhead.ts` | Pass 8 alone: it emits the car's box and the board's five. |
| `client/src/sim/signs.ts`, `client/src/sim/passes/signs.ts` | The post at the entrance goes. |
| `client/src/sim/search.ts` | The poster's point from the board's place and facing. |
| `client/src/sim/hikerNames.ts` | `HIKER_FIRST_NAMES`. |
| `client/src/sim/world.ts` | Asks for the board's place by `boardSite`. |
| `client/src/game/boardFace.ts` | New. Pure: the layout's rectangles in pixels, every line of text, the distance in miles. |
| `client/src/game/boardMap.ts` | New. Pure: the map's lines, places and labels in the sheet's own space, from a graph and its names. |
| `client/src/game/boardWear.ts` | New. Pure: each part's wear from the seed and its name. |
| `client/src/game/boardPaint.ts` | New. Draws the face's texture from those three and the two images. The one module that touches a canvas. |
| `client/src/game/boardImages.ts` | New. The two images' addresses, found by a glob, so a checkout without them builds. |
| `client/src/game/trailheadMeshes.ts` | Places the board at its place and facing; draws the face's plane; falls back to the five boxes. `posterMaterial` and the painted poster go. |
| `client/src/game/signMeshes.ts` | `paintedMaterial` goes with its one caller. |
| `client/src/app.ts` | Gives the board its place, the graph, the names and the seed. |
| `ARCHITECTURE.md`, `README.md` | The trailhead's description; the model convention for the board's face. |

The painter is handed in, as the fork signs' is, so every module but `boardPaint.ts` runs in
tests with no canvas.

## 9. Verification

### 9.1 Tests

Every numeric expectation is a literal.

**Over the 227 seeds**, in `client/test/sim/trailhead.test.ts`:

| Clause | Bound |
| --- | --- |
| The board's far end, off the player's facing | at most 21° |
| The board's centre, from the player | between 7 m and 12 m |
| The bed's centreline, from every box | at least 1.15 m |
| Every box, from the road's centreline | at least 6 m |
| The board's boxes, from the car's box | at least 8.5 m |
| The board's facing: its angle off the direction to the player | 0, to nine places |
| The side the board takes | `+n` on 63 seeds, `−n` on 164 |
| How far past the entrance the board stands | 4.5 m on 224 seeds, 3.5 m on 1, 3 m on 2 |
| The poster's point | within reach (`POSTER_RADIUS`) of a player standing 1 m in front of the poster sheet and facing it |

**Unit tests:**

- The board's place, facing and five boxes on a hand-built graph, at known numbers; the row is
  2.31 m long at any facing.
- The side rule: the nearer side when both clear, the clear side when one does.
- Pass 8 emits five `kiosk` boxes and one `car`; pass 9 emits one box for each junction and no
  more.
- `hikerNames` draws only from the sixteen, and the world `hollow` keeps Hugh Kowalski.
- The layout's rectangles at 2048 by 1024; the distance line for 1274 m is `SUMMIT 0.8 MI`.
- The map of a hand-built graph: the stem's line, a loop dashed, the pad's dot, the summit's
  mark and each label at known places; up the sheet is inland.
- The wear of a part is the same for the same seed and name, and differs for another seed.
- The painter is asked for one texture of 2048 by 1024, once, and the fallbacks of §6 are each
  taken when their file is missing.

### 9.2 In the game

Looked at in the running game before it ships, on the worlds the trailhead was checked on
(`hollow`, `room-1`, `room-140`, `room-50`, `room-19`, `room-30`):

1. On arrival, before any input, the whole board is in the frame and faces the player.
2. From where the player arrives the trail's name can be read.
3. Walking up to it, every sheet can be read: the map's names, the poster's lines, the rules'
   small print, on the high tier and on the low one.
4. The map matches the world: walking the trail to the first fork, the fork is where the map
   draws it.
5. The planks, the paper and the photograph read as photographed surfaces, and the wear as wear.
6. A player can walk round the board and cannot walk through it at any angle; nothing solid
   stands where nothing is drawn.
7. "Read the poster" appears at the poster's sheet.
8. By headlamp after dark, the board can still be read.

## 10. Boundaries

Not part of this change:

- The opening, summit and closing scenes.
- The car, the player's place and facing, and the road wall.
- The junction posts and their planks.
- A panel for the map or the rules.
- A Hollow's walk out of the road corridor, and the terrain's trail distance near the pad, both
  recorded in `docs/trail/2026-09-28-trail-14-trailhead.md`.
