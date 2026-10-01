# Water terrain: design

**Spec, 2026-09-30.** The second of the water sub-projects: the ground the water
lies in. The trail's pond becomes a lake with a real basin, murky or clear by
where it lies, with a marsh end and floating plants when it is murky; the shore
in front of the trailhead becomes a pebble pocket beach between two headlands.
All of it is sim ground or sim-placed clutter, so it moves the level id, once,
for the whole release.

The water material that draws it is sub-project 1
([the water material](2026-09-29-water-material-design.md)); the physics and the
measurements behind the numbers here are in
[Photorealistic water rendering: lakes and oceans](https://csarko.sh/research/photorealistic-water-rendering)
(section numbers below are the research's: §4 the real coast, §5 lakes).

The owner's rulings that shape it:

- The water is built as if the player can reach it, in this game later and in
  other games built on these systems.
- Lakes sit at low ground and at high ground: a murky lowland lake with marsh at
  an end, a clear high lake; one water system, murk a parameter of the lake.
- The coast gains a pebble pocket beach, a face of about 1:12 between two
  headlands. The dunes stay elsewhere.
- The terrain changes ship in one level-id release.
- The pond's placement is unchanged: loops are destinations, not every world
  has one. This work makes the lake photoreal where it is placed.
- The cove sits in front of the trailhead, built walk-on ready; the road wall
  stays in this release.

## 1. The ground today

**The pond.** One of the trail's loop features (`features.ts`), drawn in about
half of the worlds: in 110 of 200 scanned, at most one a world. Its placement
is the loop plan's (`planFeatures`) and the candidate search in the loop's band,
20 to 85 % of the way from the pad to the crest. It is a disc 25 to 40 m in
radius, and `basinD` carves `height − POND_DEPTH·(1 − (q/R)²)²` into it with
`POND_DEPTH` 0.6 m: a dish, not a lake. Bare ground to 4 m past the rim, no
trees to 8 m. The renderer draws every pond with the lowland lake's water.

Where ponds land, over the same 200 worlds: 18 to 163 m up (median 110), with
crests at 114 to 287 m (median 216); the median pond lies 114 m below its
crest, and 25 of the 110 within 80 m of it. Low ponds and high ponds both occur
already.

**The coast.** `olympic.ts`: a coastline warped along z near x = −400, sand
bays and headland bluffs, the beach rising at 1:40 (`BEACH_GRADE`) and the bed
falling at 1:67 (`SURF_GRADE`) to an 8 m shelf break and a 25 m floor, sea
stacks in a band 40 to 280 m offshore, foredunes in a 0.1 to 8 m altitude
window, and the coastal road along the shore. The players are held inland of
the road by a wall (`containment.ts`).

In front of the trailhead, over 60 worlds: the road at 2.3 to 4.7 m above the
sea (median 3.2), the waterline 72 to 99 m seaward of the road (median 83), the
beach falling about 3 m over 70 m (roughly 1:30), and the shore within 150 m
either side of the pad wandering only about 2 m. The pad stands in a long sand
bay, with no headlands of its own.

## 2. What must be true

1. A lake's water is murky or clear by where the lake lies, continuously: the
   lowest lakes brown with a marsh end, the highest clear to their beds (§5.1,
   §5.5).
2. A lake has a basin: a shallow shore shelf, then a deeper middle, deep enough
   that a clear lake's bed reads to the metres its water allows.
3. The bed and the shore are the ground a real lake of that kind has: silt,
   mud and sunken wood under murky water, stones under clear.
4. A murky lake has its marsh and its plants: reeds and cattails at the margin
   and in the marsh, pond-lilies in patches, duckweed and algae skins in the
   sheltered shallows (§5.2).
5. The shore in front of the trailhead is a pebble pocket beach: a berm, a face
   of 1:12 through the waterline, a sea bed of 1:50 beyond, two headlands, drift
   logs, stacks (§4.1, §4.2).
6. Nothing the players already stand on changes: the road, the pad, the
   trailhead's doorway, the trail, the loops' reach.
7. Everything here moves the level id once, and none of it is placed by the
   renderer alone.

## 3. Approach

The systems that already exist, extended, rather than a new module:

- The pond feature gains a murk value, a new basin profile and, when murky, a
  marsh on its shelf: a stage in `features.ts`, as `basinD` is now.
- The cove is a stage of the coast in `olympic.ts`, keyed to the pad's
  frontage, C² with exact derivatives like `shoreProfileD`.
- The reeds, the lilies and the cove's drift logs are placed by the sim's
  clutter field (`clutter.ts`), as the grass and the driftwood are; the reeds
  and lilies are meshes built in code, beside the blade and duff clumps.
- The duckweed and algae skins are a layer in the water plugin, masked from sim
  data, so every peer sees the same skin without the sim placing it.
- The terrain variant exposes one list of water bodies, which the renderer reads
  in place of deriving the lake from features by hand.

Rejected: a separate water-bodies module in the sim that owns the lake and the
cove (cleaner for other games, but it restructures what the trail builder reads
today, for no gain in this game); plants placed by the client alone (they would
never move the level id, but every other cover here is sim-decided so all peers
agree, and plants would be the one exception).

## 4. The lake

### 4.1 Murk

For a pond at rim height h, with the pad at h_pad and the crest at h_crest:

```
f    = (h − h_pad) / (h_crest − h_pad)
murk = 1 − smoothstep(0.25, 0.75, f)
```

stored on the feature (`murk`, 0..1) and folded into nothing new: it is a pure
function of placed values, so it moves no draw. The lower quarter of the climb
is fully murky, the upper quarter fully clear, a gradient between. The pad's
and the crest's heights are the builder's own (`crestH` is already written onto
the peak).

The renderer turns `murk` into the water's row with one pure function beside
the water's other maths (`waterShading.ts`), interpolating the research's
measured rows (§2.3): Kd from the very clear lake (0.2, 0.12, 0.2 per metre) at
murk 0, through the clear lake (0.75, 0.8, 1.6), to the moderately humic forest
lake (1.1, 1.5, 3.5) at murk 1; L∞ in step; shelter from 0.3 (a clear lake,
exposed) to 0.1 (a murky one, in the trees). A test pins the three rows at murk
0, 0.5 and 1.

### 4.2 The basin

The rim, the radius and the placement are unchanged. Below the rim, in the
feature's local radius q (0 at the centre, R at the rim), the profile replaces
today's dish:

- A shore shelf: from the rim inward the bed falls to 0.9 m deep at 10 m from
  the rim (the depth the Crocker survey found, §5.1).
- A slope from the shelf's edge to a flat middle, whose depth is interpolated by
  murk: 3 m at murk 1, 6 m at murk 0. A clear lake's bed then reads to about
  5 m, as the research's subalpine lakes do (§5.5).
- C² at every joint, with exact derivatives, the same shape of function as
  `basinD` and through the variant's derivative check.
- The shore band (bare ground to 4 m past the rim, no trees to 8 m, the 12 m
  apron back to the hillside) is unchanged.

The smallest pond (R 25) keeps a middle: the shelf takes its outer 10 m, the
slope the next 8, the flat the rest.

The player wades the shelf and no further. Sub-project 1's ruling is that a
player wades to the waist and the camera never goes under; the old 0.6 m dish
kept that by being shallow, and a 3 to 6 m middle does not. So a wall stands at
the shelf's inner edge, 10 m in from the rim, where the water is 0.9 m deep, in
the sim beside the road's wall (`containment.ts`); and wading slows a player by
the lake's level as it does by the sea's.

### 4.3 The bed and the shore ground

The ground paint under and beside the water takes murk: silt and mud, with dark
patches of sunken wood, where murk is high; the existing pebble ground class,
with stones, where it is low; a blend between. A wet band at the edge is the
wet plugin's (sub-project 1). Paint and ground class only, no new models.

### 4.4 The marsh end

A lake with murk above 0.5 gets one marsh at its rim: its shallow end, the shelf
there silted up to the water's level.

- It lies on the shelf, from the rim in to the shelf's edge 10 m in, and is 0.6
  to 1.0 × R across (wider the murkier).
- It lies where the ground just outside the rim is nearest the water's level:
  of 16 directions, the one whose shore (before the lake) stands least far off
  the level on average, since a marsh is flat ground the water spreads over.
  Downhill was the first thought (a marsh at the outlet) and measured wrong:
  over 101 ponds in 200 worlds the ground off a downhill rim lies a median
  3.2 m off the level (to 13 m); the best direction's lies 1.1 m off (at most
  2.6 m), a median 86° from downhill, along the contour.
- Its ground is held between 5 cm below and 5 cm above the water level,
  varied by a seeded noise, so standing water and tussocks alternate: it reads
  as marsh, not open lake. C² into the lake's bed and the apron.
- It stays inside the rim, where the trail never comes, so it moves nothing
  placed and needs no room of its own. It was first drafted beyond the rim,
  reaching 0.6 to 1.0 × R past it, and measured wrong: the loop that rings each
  pond runs its corridor within 7 m of the rim in most directions (a median
  7 m, a quarter within 4 m, 20 ponds of 101 at the rim itself), so such a lobe
  fitted clear of the trail on flat ground for only 39 to 45 % of murky lakes,
  and on any ground for 75 % with its ground up to 10 m off the level.
- It lies outside the wall at the shelf's edge (§4.2), so a player can wade
  through it, and never through its inner edge into deep water.

### 4.5 The plants

- **Reeds and cattails.** In the marsh, and along the murky shore in water 0 to
  0.6 m deep and on the wet band; density follows murk. Built in code by the
  blade-clump builder that makes the grass (`bladeClumpGeometry`), with reed
  characters: tall blades 1.2 to 2 m, some with cattail heads. They take the
  existing wind, have no collision, and are placed by the clutter field as a new
  class.
- **Yellow pond-lilies.** Patches of floating pads on murky lakes in water 0.5
  to 2 m deep, where the survey found them (§5.1); about a third of the patches
  (seeded) flower. A small mesh built in code (a notched disc, a cupped yellow flower),
  instanced 1 cm above the water; placed by the clutter field as a new class.
- **Duckweed and algae mats.** Skins of fronds, not objects: a surface layer in
  the water plugin. A mask from the lake's depth, murk and a seeded noise
  decides where the skin lies: duckweed on sheltered shallows, clumpy
  yellow-green algae mats along the margin. The layer is a matte green film
  with a tiled frond pattern over the water, hiding the reflection where it
  lies. Derived from sim data, so every peer sees the same skin.
- **Clear lakes** get none of these; their margin stays bare apart from the
  existing needle and leaf litter, and their bed shows stones (§5.5).

## 5. The cove

### 5.1 Where

Centred on the pad's frontage (the pad's z, `TRAIL_Z_ANCHOR`), 260 to 360 m wide
along the shore (seeded). It lies wholly seaward of the road's corridor
(`ROAD_CORRIDOR_HALF`), so the road, the pad, the doorway and the shore strip's
rules at the pad are untouched.

### 5.2 The profile

In the coast's own coordinate, from the road seaward:

- A backshore between the road's corridor (30 m either side of the centreline)
  and the berm's crest: flat at 3 m, with drift logs (the existing driftwood
  clutter class, given a density here). It is 6 to 33 m wide over 60 worlds
  (median about 17 m), whatever ground is left between the corridor and a crest
  36 m inland of the waterline.
- A pebble berm, its crest about 3 m above the sea.
- The face at 1:12 from the berm's crest down through the waterline to 2 m
  deep. The waterline lands where it is today, about 80 m from the road.
- The bed at 1:50 from there out to the existing 8 m shelf break (the sand bays
  keep 1:67), so swell reaches the face unbroken: the ground the plunging wave
  needs (a later sub-project).
- Blended into the bay's own profile across the cove's two ends, inside the
  headlands; C² throughout, with exact derivatives, like `shoreProfileD`.

### 5.3 The headlands

Two arms bound the cove:

- Each a ridge running out to sea, rising from the backshore to a crest of 12 to
  25 m (seeded), reaching 100 to 150 m past the waterline.
- Their steep sides take the existing rock ground class; trees stand on their
  tops, as on the real coast's headlands.
- Each arm's height fades to nothing before the road's corridor, so the road is
  never cut.
- One or two sea stacks (seeded) are guaranteed off each tip, from the existing stack
  builder (`stackFieldD`).

### 5.4 Ground and dunes

Pebble ground class on the berm and the face, sand on the bed below the water,
the driftwood class on the backshore. Dunes are held off inside the cove only (a
pebble pocket beach has none); they stay everywhere else on the coast.

### 5.5 Walk-on ready

The berm and the face stay under the walkable grade cap (1:12 is 0.083); the
waterline and the swash band are shaped for standing on. The road wall stays
where it is in this release: the beach is built to be opened, not opened.

## 6. The water bodies

The terrain variant gains `waterBodies(seed)`:

```ts
type WaterBodySource =
  | { kind: "sea"; level: number }
  | { kind: "lake"; level: number; x: number; z: number; radius: number;
      murk: number; lobe: { dirX: number; dirZ: number; width: number } | null };
```

The sea is the variant's `waterLevel`; the lake is the world's pond feature, if
any. The renderer reads this list in `createWater`: the lake's water row from
murk (§4.1), its mesh, the wet plugin's footprint from the lake's disc. The water material then draws a clear high lake clear,
not every lake brown.

## 7. Where the pieces live

| Piece | Where | Level id |
| --- | --- | --- |
| Murk, the basin, the marsh | `client/src/sim/features.ts` | yes |
| The wall at the shelf, wading by a lake's level | `client/src/sim/containment.ts`, `world.ts` | yes (behaviour) |
| The cove and the headlands | `client/src/sim/olympic.ts` | yes |
| Reeds, lilies (placement), drift logs in the cove | `client/src/sim/clutter.ts` | yes |
| `waterBodies` | the variant (`terrain.ts`, `olympic.ts`) | no (derived) |
| Reed and lily meshes | `client/src/game/`, beside `bladeClump.ts` and `duffClump.ts` | no |
| Murk to water row, the skin layer | `client/src/game/waterShading.ts`, the water plugin | no |
| Bed and shore paint | `client/src/game/featurePaint.ts`, `terrainSurface.ts` | no |

Every new sim number folds into the level id through the tunables the files
already export into it (`FEATURE_TUNABLES`, the olympic variant's, the
clutter's). The level id moves once, for the whole release.

## 8. Tests and gates

Node tests:

- The murk function at its ends and middle.
- The basin: 0.9 m deep 10 m in from the rim, the middle depth by murk, and a
  middle on the smallest pond.
- The marsh: flat within its tolerance, on the shelf and inside the rim only,
  in the direction whose shore is nearest the level, absent at murk 0.5 and
  below.
- The wall at the shelf's edge: a player walking into a lake stops where the
  water is 0.9 m deep, and slows by the lake's level as in the sea.
- The cove: the berm's crest, 1:12 at the waterline, 1:50 beyond, the headlands
  at zero before the road corridor.
- Every new stage through the variant's check that its derivatives match its
  values.
- Murk to water row: the three measured rows at murk 0, 0.5 and 1.

Scans over 200 worlds, run before and after (a builder invariant is gated on
the composed field, never on a few probe seeds):

- No trail edge comes inside a lake's rim.
- Every feature's position, radius and rim height is identical to today's
  (the pond's placement unchanged), from a fixture recorded before the change.
- The loops build for as many worlds as they do today.
- The field inside the road corridor and at the pad is identical to today's.
- No ground below sea level inland of the berm (no accidental puddles).
- No dunes inside the cove.

The WGSL shader corpus is recorded again at noon and at night, with a lake world
among the visits, and checked live after the deploy (fresh first visits,
`?wgsl=record`), as for sub-project 1.

Look gates, each a still at a pose matched to photos of the approved reference
set, the sun pinned per reading:

| Gate | Pose | Reference |
| --- | --- | --- |
| The cove | from the pad, looking out | `rialto-03`, `ruby-05` |
| A murky lake | across it, marsh and lilies in view | `ozette-08`, `lily-pond-08`, `duckweed-11` |
| A clear high lake | a shallow bed in view | `crescent-04`, `crescent-13` |

A gate passes on the owner's word.

Stills taken 2026-10-01 on the high tier on WebGPU, weather clear, at noon
(sun direction (0, −0.97, 0.243), intensity 3.95) and at night with the
headlamp, the console clean on every page: the cove from the pad, from the
berm and along the beach toward a headland; a murky lake (room-3's, murk 0.99)
from across, from its shelf and from inside its marsh; a clear high lake
(room-1's, murk 0.15) from its shelf and from across. Judged 2026-10-01: every
posed gate passes, with no change asked.

Cost, measured as the water material's was (the water material's §8): frame
times at 3840×2160 where every tier is fragment-bound, scaled to each tier's
pixels, a control build of `main`, a silent machine; at the worst poses (a lake
world close to the lake; the cove from the pad); reported as cost added over
`main` on the three tiers, for the owner to judge. No bar is set in advance.

Measured 2026-10-01 at 3840×2160 (hardware scaling 0.5), fresh pages, the
order control/branch/branch/control and then the reverse, three 5 s samples a
page, the control a build of `main` at b43952d, twice: once with another
session's load rising from 3 to 140 over the run, and again in the quietest
window the day offered, at load 3 to 16 with page-to-page spreads of up to
30 ms. Neither run was silent, so the figures are the sign and the order of
the cost, not its size. Cost added over `main`, in ms per frame at that size,
per round, the first run then the second:

| Pose | Tier | first run | second run |
| --- | --- | --- | --- |
| The murky lake, close, reeds and skin in view | high / WebGPU | −0.1, +0.4 | +10.1 (one page drifting 60 → 82 ms), the second round lost |
| | medium / WebGL2 | +0.3, −0.1 | +0.7, −1.4 |
| | low / WebGL2 | +1.2, −0.8 | −6.3, −1.8 |
| The cove from the pad | high / WebGPU | −2.5, −1.5 | −1.3, −1.7 |
| | medium / WebGL2 | −6.9, −4.8 | −4.8, −2.3 |
| | low / WebGL2 | −2.1, −1.5 | +0.7, −1.6 |

At the lake the branch costs nothing the noise can tell apart on the medium
and low tiers; on the high tier three rounds of four lie within half a
millisecond and one, taken on a drifting page, read +10 ms, so the high tier
at the lake is not settled. At the cove the branch drew faster than `main` in
eleven rounds of twelve, on every tier: the cove's ground replaces the dunes
and the inland blend in the pad's view. The silent reading came on 2026-10-01 at
14:05, load 2.0 to 2.5 and no other page in the browser, the control `main`
at 07c9914: at the lake on the high tier the four pages of the first round
lay within 41.7 and 42.2 ms, branch less control −0.14 ms, so the lake costs
the high tier nothing measurable; the two rounds after it climbed on both
builds alike, the rig warming. The cove on the high tier read −1.8, −0.5 and
−1.4 ms over three rounds. No tier pays for the water's ground.

## 9. Out of scope

Opening the beach (the road wall stays); waves, swash and breakers (their own
sub-projects, which this cove's profile is built for); the lake's mirror of its
banks; insects and their sound; tides.
