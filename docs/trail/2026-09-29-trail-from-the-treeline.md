# The trail from the treeline

**Date:** 2026-09-29
**Status:** Designed, not built.
**Builds on:** [`2026-09-28-trailhead-board.md`](2026-09-28-trailhead-board.md) (the car, where a
player arrives, the board), [`2026-09-11-trail-system.md`](2026-09-11-trail-system.md) (the
trail's search).

## 0. What this is

The road runs along the shore in a cleared strip 30 m to each side, low enough that the ground
there is painted as sand and grows nothing. The trailhead's pad stands in that strip, so the
trail begins on sand, with the forest some way off, and on many worlds it runs along the road
across the sand before it turns inland.

After this, the forest comes down to the road at the trailhead. A player arrives beside the
car on the shoulder with grass underfoot and the treeline a few metres ahead; the board stands
among the first trees; and the trail goes straight back into the forest. Nowhere does a trail
cross sand.

## 1. Decisions

| Question | Decision |
| --- | --- |
| What lies between the road and the trail's start | The forest comes to the road, at the trailhead only. The car stays on the shoulder. |
| How the forest is brought there | A strip inland of the pad in which the shore's rules read the ground as higher than it is. The ground's shape does not change. |
| How the trail is kept off the sand | The trail's search may not enter shore ground, except through a doorway two cells wide, 16 m, straight inland of the pad. |
| Where a player arrives, the car | As they are, each placed from the trail's first leg. |
| The board | Placed from the trail's first leg as it is, but the place it takes is judged by the board's further end against the way the player faces (§6). |
| The wire | Protocol 5 stands. |
| The level id | Moves (§7). |

## 2. Measured

Read from the world generator over the 227 seeds of `client/test/sim/trailGateSeeds.ts`.
Distances are from the road's centreline, straight inland of the pad, unless said otherwise.

### 2.1 Today

| Measure | Least | Median | Most |
| --- | --- | --- | --- |
| The pad's centre | 9.0 m | 9.0 m | 9.0 m |
| The ground's height at the pad | 2.1 m | 3.3 m | 5.5 m |
| Where the ground reaches 4 m, and sand begins to give way | 0.0 m | 20.5 m | 35.5 m |
| Where the ground reaches 9 m, and no sand is left | 23.0 m | 45.0 m | 85.0 m |
| Where grass cover begins | 23.0 m | 45.5 m | 146.0 m |
| The nearest tree | 13.5 m | 23.3 m | 103.7 m |
| The stem's length on ground under 4 m | 0.0 m | 12.9 m | 205.5 m |
| Of that, its run along the road | 0.0 m | 1.5 m | 198.4 m |
| The first edge's turn from straight inland | 0.5° | 11.5° | 107.8° |

On 54 seeds the stem runs more than 10 m along the road while on ground under 4 m.

### 2.2 With the doorway of §4, tried on the trail's own search

The doorway measured is the two rows of cells whose centres are 4 m to either side of the pad's
line, 16 m in all.

| Measure | Least | Median | Most |
| --- | --- | --- | --- |
| The stem's length on ground under 4 m, all of it inside the strip of §3 | 0.0 m | 11.5 m | 27.8 m |
| Of that, its run along the road | 0.0 m | 1.0 m | 3.3 m |
| The first edge's turn from straight inland | 0.5° | 5.3° | 20.8° |
| The stem, from the doorway's line, 30 m from the road | 0.2 m | 2.0 m | 6.6 m |
| The stem's whole length | 276.2 m | 1036.0 m | 2140.4 m |
| The least height the shore's rules read under any edge of any kind | 8.87 m | 12.21 m | 14.47 m |
| Trees within 40 m of the pad's centre, with the forest's floor at 1 (§3.3) | 4 | 10 | 15 |
| The nearest tree to the pad's centre, the same | 9.0 m | 19.2 m | 29.3 m |

The trail is built on all 227 seeds with no fallback. The stem's median length was 1029.7 m
without the doorway. A doorway three cells wide was tried too: the first edge turned up to
56.7°, and on one seed the stem still ran 12 m along the road.

The last three rows were measured with the strip of §3 in place as well. Four seeds have an
edge on ground the rules read under 9 m, at 8.87 to 8.99 m, where the sand's share of the paint
is under half of one part in a hundred. With the trail leaving straight inland the car stands at
the pad on all 227 seeds; it slid along the road on 11 before.

A straight first edge, fixed and not searched for, was measured and set aside: the ground along
it is steeper than the search's own limit of 0.6 on 52 seeds, and steeper than 0.9 on 9.

### 2.3 What would grow in the strip

Each figure is the mean over a band of the strip, 8 to 28 m to either side of the trail, with
the shore's rules reading the ground 9 m higher:

| Band, from the road | Forest density, today | Forest density, lifted | Grass cover, lifted | Bush cover, lifted |
| --- | --- | --- | --- | --- |
| 12 to 20 m | 0.00 (0.00–0.17) | 0.17 (0.00–0.19) | 1.40 (1.02–1.42) | 0.62 (0.09–0.65) |
| 20 to 30 m | 0.35 (0.00–0.93) | 0.90 (0.00–0.93) | 0.98 (0.81–1.50) | 0.95 (0.10–1.00) |
| 30 to 45 m | 0.91 (0.00–1.00) | 1.00 (0.00–1.00) | 0.94 (0.84–1.50) | 0.95 (0.10–1.00) |

Medians, with the least and the most in brackets. Two things follow. On some seeds no forest
grows in the strip even lifted, so the strip needs a floor on the forest's density (§3.3). And
bushes would grow thickly round the board and where a player arrives, so the trailhead needs a
clearing (§5).

## 3. The strip

Everything here follows from the seed on every peer. `sim/` rules hold: no trigonometry, no
`Math.pow`, no `**`, no `Math.hypot`.

### 3.1 Its shape

The strip is a function of a place, `shoreStrip(seed, x, z)`, from 0 to 1, in the road's own
frame: `u` is the distance inland of the road's centreline at the place's `z`, and `w` is the
distance along the road from the pad's `z`, without its sign.

| Across the road's direction | The strip's weight |
| --- | --- |
| `w` up to `STRIP_HALF` | 1 |
| `w` from `STRIP_HALF` to `STRIP_HALF + STRIP_EDGE` | falls smoothly to 0 |

| Inland | The strip's weight |
| --- | --- |
| `u` of 0 or less: the centreline and everything seaward of it | 0 |
| `u` from 0 to the road bed's half-width, 5.5 m | rises smoothly to 1, under the pavement |
| `u` up to `STRIP_REACH` | 1 |
| `u` from `STRIP_REACH` to `STRIP_REACH + STRIP_FADE` | falls smoothly to 0 |

The strip's weight is the product of the two. It does not depend on the trail's graph, so the
ground, the forest and the trail's search can each read it without waiting on another.

| Constant | Value | Why |
| --- | --- | --- |
| `STRIP_HALF` | 30 m | The stem stays within 6.6 m of the doorway's line (§2.2); 30 m leaves a wood to either side of it. |
| `STRIP_EDGE` | 15 m | The forest thins into the sand and does not end at a line. |
| `STRIP_REACH` | 100 m | Past the furthest place the ground first reaches 9 m (85.0 m). |
| `STRIP_FADE` | 20 m | |
| `STRIP_LIFT` | 9 m | The height at which no sand is left. |

### 3.2 What reads it

`shoreHeight(seed, x, z, h)` is `h + STRIP_LIFT · shoreStrip(seed, x, z)`. The shore's rules
read it in place of the ground's height. Nothing else does: the ground's shape, every
collision, the snow line and the rules for high ground are as they were.

| Rule | Where | Reads today |
| --- | --- | --- |
| The forest begins above the shore | `client/src/sim/vegetation.ts`, `SHORE_ALT` | the ground's height |
| Grass, meadow and flower cover begin above the shore | `client/src/sim/clutter.ts`, `CLUTTER_GRASS_ALT_LO` | the ground's height |
| Bushes begin above the shore | `client/src/sim/clutter.ts`, `CLUTTER_BUSH_ALT_LO` | the ground's height |
| Rocks begin above the shore | `client/src/sim/clutter.ts`, `CLUTTER_ROCK_ALT_LO` | the ground's height |
| Sand is painted below 4 m, fading out by 9 m | `client/src/game/terrainSurface.ts`, `SAND_TOP` | the ground's height |
| Stumps and mushrooms grow above the shore | `client/src/sim/clutter.ts`, the fungus class, by `CLUTTER_GRASS_ALT_LO` | the ground's height |
| An animal may stand on ground that is not sand | `client/src/game/wildlifeField.ts` | the ground's height |

The rules that keep things off the road are unchanged: trees 12 m from its centreline, grass
7.5 m, bushes 8.5 m. So is the rule that keeps trees 8 m from a trail. The shoulder, the car
and the place a player arrives stay in the open.

Driftwood is left reading the ground's height: it belongs to the sand, and the strip is not
sand.

### 3.3 A floor on the forest

Inside the strip the forest's density is at least `STRIP_FOREST_FLOOR` times the strip's
weight, times the road's own gate, the way a talus field's floor lets boulders stand on ground
the slope rule would leave bare. `STRIP_FOREST_FLOOR` is 1: where the strip is whole and the
road's gate is open, the forest is as dense as it is anywhere.

It was 0.6 as first built. On `room-50` and `room-19`, whose shores are open, that stood 5 and
2 trees within 40 m of the pad, saplings among them, and the pad read as open ground
([the look](2026-09-29-trail-from-the-treeline-verification.md)). At 1 the same two stand 11
and 7.

## 4. The doorway

The trail's search runs on a grid of 8 m cells in the road's frame. A cell is **shore** when
its ground is under `SHORE_GATE_ALT`, or it is within `SHORE_GATE_U` of the road's centreline.
A shore cell is closed to the search unless it is in the **doorway**: its centre within
`DOORWAY_HALF` of the pad's `z`. The rows' centres stand 4 m to either side of the pad's line,
so the doorway is two rows of cells, 16 m wide, running straight inland from the pad.

| Constant | Value | Why |
| --- | --- | --- |
| `SHORE_GATE_ALT` | 9 m | The height at which no sand is left. The search reads the ground's own height here, not the lifted one: what is closed is what would be sand without the strip. |
| `SHORE_GATE_U` | 30 m | The cleared strip's half-width, `ROAD_CORRIDOR_HALF`. |
| `DOORWAY_HALF` | 4 m | Half a cell: the two rows beside the pad's line. |

The doorway closes cells and opens none: a doorway cell too steep for the search stays closed.
The pad's own ring, which the search has always been let through, is closed like any other
shore ground outside the doorway's rows. The search finds its own way up the
doorway, so the trail's first leg is as walkable as any other (§2.2). Every search reads the
same grid, so loops, strands and rungs keep off the shore as the stem does.

The cells a feature's dome re-reads are closed again after it, as the pad's ring is opened
again.

## 5. The trailhead's clearing

Nothing that stands tall grows within `TRAILHEAD_CLEARING` of the pad's centre: no bush, rock,
boulder, stump or mushroom (stumps and mushrooms are one class). Grass, flowers and leaf litter do. `TRAILHEAD_CLEARING` is 24 m, which takes
in where a player arrives, the entrance 8 m from the pad's centre, and the board, which
stands at most 12.75 m from it.

Trees need no rule of their own: none stands within 8 m of a trail, and the board is 2.5 m
from the bed, so no tree can stand between a player and the board.

## 6. What does not change

- The pad, the car's place and its slide along the road, where a player arrives and the way
  they face, and the board's boxes: each is placed from the trail's first leg by the rules it
  has.
- The board's place is chosen among the places it always had. What changes is how they are
  judged. A player faces the entrance to within 4°, which is the most the facing's own
  arithmetic is out by, and the rule measured the board's centre against the line to the
  entrance and not against the facing. With the trail leaving nearly straight inland that put
  the board's further end 23.5° from the view's centre on 4 of the 227 seeds, past the 21.3° an
  upright phone shows. The rule now takes the place whose further end is nearest the centre of
  the view as the player faces, and the further end is within 17.9° on every seed.
- The road's cleared strip is still the ground a Hollow never enters. Trees stand in part of
  it now; the rule reads the distance from the road and not what grows there.
- The board's face, its words and its map. The map draws the trail the world has.

## 7. The level id

| What | Where | Change |
| --- | --- | --- |
| The strip's constants | `client/src/sim/shoreStrip.ts` (new), registered with pass 8's tunables | New |
| The doorway's constants | `client/src/sim/trailGrid.ts`, in `TRAIL_GRID_TUNABLES` | New |
| The clearing | `client/src/sim/clutter.ts`, in `CLUTTER_TUNABLES` | New |
| The probe | `client/src/sim/forest.ts` | The chunks round the pad hold trees; the record says which |
| `GEN_VERSION` | `client/src/sim/forest.ts` | 8 |

The pass hash is re-pinned in `client/test/sim/groundGradient.test.ts` and
`client/test/game/tierDeterminism.test.ts`. A match made before this cannot be joined after it.

## 8. Files

| File | Change |
| --- | --- |
| `client/src/sim/shoreStrip.ts` | New: `shoreStrip`, `shoreHeight`, the constants. |
| `client/src/sim/vegetation.ts` | The shore rule reads `shoreHeight`; the floor of §3.3. |
| `client/src/sim/clutter.ts` | The shore rules read `shoreHeight`; the clearing. |
| `client/src/sim/trailGrid.ts`, `client/src/sim/trailBuild.ts` | The doorway. |
| `client/src/sim/facing.ts`, `client/src/sim/trailhead.ts` | The way a yaw faces, as a direction; the board's place judged by its further end. |
| `client/src/game/terrainSurface.ts` | The sand's paint reads `shoreHeight`. |
| `client/src/game/wildlifeField.ts` | An animal's ground reads `shoreHeight`. |
| `client/src/sim/forest.ts` | `GEN_VERSION`, the probe's record. |
| `client/test/sim/`, `client/test/game/` | §9.1. |
| `ARCHITECTURE.md` | The strip and the doorway, where the trail's build is described. |

## 9. Testing

### 9.1 Tests

Every numeric expectation is a literal.

**`shoreStrip` and `shoreHeight`**, on a straight road: 1 at the pad and 30 m to a side, a half
at 37.5 m, 0 at 45 m and beyond; 1 at 100 m inland, 0 at 120 m; the height lifted by 9 m, 4.5 m
and 0.

**The doorway**, on a hand-built grid: a shore cell outside the doorway is closed; one inside
it is left as it was; a steep doorway cell stays closed; a cell above the shore and beyond
30 m is untouched.

**Over the 227 seeds:**

| Clause | Bound |
| --- | --- |
| The trail is built, with no fallback | on every seed |
| The height the shore's rules read under any edge of any kind, sampled each metre | at least 8.8 m |
| The first edge's turn from straight inland | at most 21° |
| The stem, from the doorway's line, 30 m from the road | at most 7 m |
| The stem's run along the road on ground under 4 m | at most 3.5 m |
| Trees within 40 m of the pad's centre | at least 4, on every seed |
| The board's further end, from the centre of the view as the player faces | at most 18° |
| The car's slide along the road | none, on every seed |
| A tree within 8 m of any trail | none, as now |
| A bush, rock, boulder or stump within 24 m of the pad's centre | none |
| `shoreHeight` on the bed, from the pad to where the ground reaches 9 m | at least 9 m |
| Everything else the trailhead board's spec holds (its §9.1) | unchanged |

**The watcher's sweep and the Hollow's walk** are run again. Trees stand near the pad, so the
watcher's stands at the pad may move; every stand that does is named with the tree on its
sightline, as the sweep's record has it.

### 9.2 In the running game

On `hollow`, `room-1`, `room-140`, `room-50`, `room-19` and `room-30`, on the high tier and the
low:

1. On arrival there is grass underfoot and trees ahead, and no sand between the player and the
   board.
2. The board is whole in the first frame, at 1600 by 900 and at 390 by 844, with nothing
   standing between it and the player.
3. The trail leaves the pad into the trees, and from the pad its first 30 m can be seen to go
   inland.
4. To either side of the strip the shore is sand, as it was, and the forest thins into it.
5. Walking the trail to the first fork, no part of it is on sand.
6. From the road, a hundred metres along it, the strip reads as a wood that comes down to
   the road and not as a patch laid on the sand.

## 10. Boundaries

- The road, its cleared strip and the pad are not moved or reshaped.
- No tree is placed by hand: the forest's own rule places them, with a floor on its density.
- Animals' own rules are another change, made before this one; this one only lets them read
  the strip as forest.
- The Hollow's and the watcher's rules are not changed; their sweeps are measured again.
