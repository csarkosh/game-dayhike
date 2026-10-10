# The sea's edge: design

**Spec, 2026-10-08.** The water sub-project after the lake's mirror: the sea's
edge. On the pebble cove the swell no longer spills on the face; it plunges,
throwing a lip that curls over, closes into a tube and collapses in a burst of
foam and spray. The bore that follows runs up the face as a thin sheet, sinks
into the pebbles, and leaves a wet line that climbs and falls with every wave
and dries over a minute. The surf is heard: a bed that swells and ebbs with the
sets, a thud on each plunge, a rattle as the sheet draws back. Every player sees
the same wave plunge and the same sheet climb.

It fills the slots the earlier specs left for it:
[the water material](2026-09-29-water-material-design.md) §7's `wetLine`, held
until now at a still 0.3 m above the level; and
[the ocean waves](2026-10-02-ocean-waves-design.md) §9's two interfaces, the
crest at a shore point for the breaker and the bores' arrivals at the face's
toe for the swash, which that spec built so the face "spills by the same rule"
only until this one lands. The surf's sound sits with the breaker, as that spec
said it would.

The decisions that shape it: build as if the player reaches the water, and
future games built on these systems will; the camera never goes under; the
road wall stays, so the beach is seen from the road and the free camera in
this release and walked in a later one; no cost line is set in advance, and
every tier's cost is measured and reported.

## 1. The sea's edge today

- **The swell and its break.** Twelve Gerstner components summed once a
  vertex, shoaled and refracted along the coast through the atlas, capped by
  Weggel's breaker index where a crest outgrows its depth, rolling on as a bore
  of 0.42 of the depth with white water that thins to lace over 20 s. On the
  cove's 1:50 bed a typical day breaks 50 to 160 m out; between sets the
  smaller waves reach the 1:12 face and spill there. The surface is a single
  valued function of the ring vertices: nothing overhangs.
- **The feeds.** `crestAt` (`oceanWaves.ts`) gives, at a shore point, the
  crest's height, period, direction and phase, the depth and the bed's slope,
  the offshore height and length, whether it has broken, and the Iribarren
  number. `boreArrivals` gives the times and heights at which broken crests
  pass a point, for the face's toe. Both are pure functions of the seed and
  the shared clock.
- **The wet line.** One number a frame: the nearest body's level plus 0.3 m,
  pushed to every wet material (the terrain, props, clutter and the players'
  legs). Below it the ground is at 0.40 of its brightness and glossy, over a
  10 cm band.
- **The cove.** A pebble berm with its crest 3 m above the sea, a 1:12 face
  from the crest through the waterline to 2 m deep, a 1:50 bed to the 8 m
  shelf break; 260 to 360 m wide, blended into the bays over 30 m at each end.
  The waterline is 72 to 99 m seaward of the road. From the road at eye height
  the berm hides most of the surf zone; from the free camera and from 18 m up
  the break line shows.
- **Sound.** An ambient graph with a world bus under a limiter, a muffle the
  stare closes and a hush the reveal applies; loop emitters and one-shot
  emitters on an equal-power panner with the inverse distance model; the frog
  chorus as two recorded loops placed over the water. No sea sound exists.

## 2. What the sea's edge must do

1. **Plunge where the bed says so.** On the cove's face, where the Iribarren
   number is 0.6 to 0.9, a crest plunges; on the bays' sand at 0.1 to 0.2 it
   spills as today. An onshore wind pushes a column back toward a spiller.
2. **Show the curl.** On the high tier the lip overhangs: a real curl and a
   tube seen from the beach side, the back of the wave and the thrown lip from
   the road side. On medium and low the face steepens, the crest line takes a
   highlight and the collapse bursts, with no overhang.
3. **Run up and dry.** Each bore sends a sheet up the face whose reach follows
   Hunt's rule, thin at its leading edge, and the sheet sinks into the pebbles
   rather than draining back. The wet line is per position and time-varying
   inside the cove, soaked, then damp, then dry over about a minute, with a
   faint foam speckle for ten seconds after each retreat.
4. **Be heard.** A surf bed whose level rises and falls with the sets and
   with the swell's height, a thud for each plunge and a rattle for each
   backwash that line up with the waves the player sees, quieter and duller
   inland and under the canopy, muffled and hushed with the rest of the world.
5. **Throw spray.** On high, each plunge throws a short burst of spray the
   wind carries. No haze.
6. **Stay shared and deterministic.** The breaker, the sheet and the sound's
   events come from the shared clock and the seed, so every peer sees and
   hears the same wave. Nothing new crosses the network. The sound itself is
   each page's own, as the frogs' is.
7. **Leave the lake alone.** The lake's shader text stays byte-identical. The
   sea's changes live under its `OCEAN` define.

## 3. Approach

Four pieces on the two feeds the ocean sub-project built, and nothing new in
the simulation:

- **The breaker** rides the break rule's own number. The ratio of a crest's
  height to its depth, which the cap already tracks from 1.0 to 1.5, is the
  plunge's progress: the face steepens from 1.0, the lip is thrown by 1.3,
  the curl has collapsed into the burst by 1.5. A crest moving shoreward
  over deepening breaking makes that progress monotone in time with no state
  to carry. On high a strip of geometry swept along the break line carries
  the curl; on medium and low a shader term on the existing face carries the
  lip and the burst.
- **The swash** is a one-dimensional run-up along the shore normal for each
  shore column, held in a small table the CPU fills once a frame and uploads
  as a texture. The sea surface reads it to extend a sheet up the face; the
  wet materials read it for the moving wet line. The table is also the
  sound's source, so there is no lockstep to keep between the two.
- **The sound** is a record the renderer fills each frame with no allocation,
  driven into a new audio shell beside the water life's.
- **Spray** is a capped sprite burst at each plunge event.

Rejected: a shallow-water simulation of the last 20 m (0.13 ms on a desktop
GPU to 3 ms in a browser port, needs compute on high and a CPU twin below,
and the hardest to keep identical across peers; the analytic sheet gives the
climb, the sinking and the wet line the eye needs); geometry on every tier
(medium and low have no compute, so the strip's animation would move to the
CPU or the vertex stage and low's cost would rise most); a synthesized sea
(matches every wave but is the hardest to make convincing).

## 4. The breaker

### 4.1 Plunge or spill

A column's plunge share is `smoothstep(0.4, 0.6, iribarren)` times
`1 - onshore`, where `onshore` is the wind's component toward the shore
scaled by its speed, clamped to one. The cove gives 0.6 to 0.9 and plunges;
the bays give 0.1 to 0.2 and spill. The strip exists only across the cove's
width, blended out over the cove's 30 m end fades.

### 4.2 Progress

For a crest at ratio `r` of height to depth, progress is `p = clamp((r - 1)
/ 0.5, 0, 1)`: the cap's own window. At `p` under 0.6 the face steepens and
the lip forms; at 0.6 the lip is thrown at 1.3 to 1.5 times the wave's
speed; by 1.0 the curl has closed and collapsed. The tube is 2.5 times
longer than wide at full throw, per the research.

### 4.3 High: the swept strip

One mesh of columns at 1 m across the cove, two slots a column so two crests
can plunge in one column at once, each slot a cross-section of 24 vertices
running from the back face over the crest, out along the lip and under the
tube to the trough. A baked profile texture holds that cross-section at eight
progress keyframes in units of the crest's height, with a tangent for the
normal. The vertex stage finds the slot's crest from the swell sum at the
column's break point, so the strip's base vertices land on the ring's surface
and show no seam, then lifts the profile into the curl by the keyframes at
`p`. The strip draws with the sea's material under an `OCEAN_LIP` define, so
lighting, refraction, foam and the depth test are the sea's own; the lip's
leading edge and the tube's underside carry foam and aeration from the
existing white-water rules. Columns coarsen to 2 m beyond 150 m from the
camera; the strip is skipped when no plunging crest is in view.

### 4.4 Medium and low: the lip

In the sea's fragment stage, on a column with plunge share above zero, the
face's normal tilts shoreward by `p` up to a steeper face, the crest line
takes a highlight over a 0.3 m band, and at `p` of 1.0 a burst lifts the
foam to full cover and decays over two seconds through the foam age. A few
operations a pixel inside the ocean branch.

## 5. The swash

### 5.1 The run-up

For each column, each bore arrival at the face's toe launches a sheet. Its
vertical reach is Hunt's rule, the Iribarren number times the bore's height:
a 1 m bore on the cove climbs about 0.8 m, about 10 m along the face. The
front climbs at the bore's speed and slows to its reach over `t_up`, then
retreats over `t_down` of about twice `t_up`, and the sheet's thickness at a
point is thin at the front and thicker toward the toe, falling with the
front's retreat as the pebbles take it. Two sheets overlapping take the
greater thickness and the greater reach.

### 5.2 The table

One row of 512 float columns, one a metre of shore across the cove, each
holding the front's distance up the face, the sheet's thickness scale, the
wet reach and the time since the column was last wetted. The CPU recomputes
it from the shared clock once a frame and uploads it as a one-row texture.
Column zero is the cove's seaward left end; the shaders map world `z` to a
column through the cove's centre and width, which the sea already carries in
its coast uniform.

### 5.3 The water

On the face, the sea's depth test gains the sheet's thickness at the pixel's
column and distance up the face, so the surface extends up the pebbles as a
thin transparent film with the lace at its edge, through the refraction path
on high and the blend on medium and low. The rings covering the face count
as wet up to the largest reach so they are not culled.

### 5.4 The wet ground

Inside the cove the wet materials read the table in place of the one line:
the line sits at each column's wet reach, and wetness follows the column's
age through three states, soaked (albedo 0.40, roughness 0.15, as today),
damp (0.70, roughness 0.5) and dry, over `WET_DRY_S` of 60 s. A foam speckle
of 0.2 weight rides the wet band for 10 s after each retreat. The bays keep
the static line, blended across the cove's end fades, so no seam shows where
the pebbles meet the sand.

## 6. The sound

### 6.1 The record

Each frame the renderer fills one record with no allocation: the listener's
nearest point on the cove's break line; the set envelope, the mean breaking
along the visible break line over the last 4 s; the listener's distance
inland of the waterline; and this frame's events, a plunge where a 20 m
stretch's progress crosses 1.0 and a backwash where a column's front turns
from its reach with a reach over 2 m. Events come from the shared clock, so a
thud lands on the wave the player sees.

### 6.2 The shell

A new file beside the water life's audio. One looping bed, a public-domain
Olympic coast surf recording cut to a seamless stretch, on a loop emitter that
follows the nearest break point, reference 40 m and range 400 m, its gain
`SURF_LEVEL` times `0.5 + 0.5 · envelope` times the swell's height over 2 m
clamped to one. A lowpass per emitter whose cutoff falls from 8 kHz at the
waterline to 1.5 kHz at 300 m inland and under the canopy, so from the road,
behind the berm that hides the break line, the surf is the sea's main cue.
Plunge thuds and backwash rattles are short one-shots cut from the same
recording, capped at four and two voices, nearest first, gain by the wave's
height. Everything joins the world bus through the wildlife gain, so the
stare's muffle, the reveal's hush and the limiter act on it as on the frogs.
Gain changes under 0.005 are not sent.

### 6.3 Assets

The loop and the one-shots enter the catalog as `ambience.surf_cove`,
`call.surf_plunge_a` to `_c` and `call.surf_backwash_a` and `_b`, credited in
`CREDITS.md`.

## 7. Spray

On high, each plunge event emits 40 to 80 soft sprites along its 20 m stretch,
thrown forward and up at the lip's speed, pulled down by gravity, slowed by
drag and drifted by the wind field, living 1 to 2 s and fading out. They take
the foam's white under the sun's intensity, draw after the sea with the depth
test and no shadows, and are capped at six live bursts, nearest first. No
haze.

## 8. Tiers, costs and shaders

| Tier | Breaker | Swash | Sound | Spray |
| --- | --- | --- | --- | --- |
| high | the swept strip | the sheet through refraction, the table | yes | yes |
| medium | the shader lip | the sheet through the blend, the table | yes | no |
| low | the shader lip | the sheet through the blend, the table | yes | no |

No cost line is set in advance; the figures are reported per tier and judged
on them. GPU timestamp queries per pass for the strip, the spray and the sea
itself, at 3840 × 2160 on a quiet machine, paired against a control build of
`main` at three poses: the cove from the trailhead pad, the waterline through
the free camera, and the open sea; the CPU table timed on its own and expected
under 0.1 ms. Expected on high: the strip under 0.5 ms (about 17,000 vertices
with the swell sum each, roughly half a ring's vertex work, and little
fragment coverage), the spray under 0.3 ms, the sheet and the lip a few
operations a pixel. The cut order if a number surprises: the spray's cap, the
strip's columns to 2 m everywhere, the lowpass filters.

The sea's stages change, so the four pinned hashes of its text are re-pinned
and the corpus is recorded again on every tier. The lake's stages are
unchanged and their hashes hold.

## 9. Tests and checks

- **Run-up.** Hunt's reach at literal values (a 1 m bore at Iribarren 0.8 on
  the 1:12 face climbs 0.8 m vertical, 9.6 m along the face); the table's
  fronts, thicknesses, reaches and ages for given arrivals; the overlap of
  two sheets; the drying over 60 s; the speckle's 10 s.
- **The breaker.** Plunge share on the cove and the bays and under an onshore
  wind; progress from the ratio; the profile's eight keyframes; the strip's
  base vertices on the ring's surface; the strip skipped with no plunging
  crest in view.
- **The sound.** The record's events for a known swell (a plunge per stretch
  once per crest, a backwash per column once per bore); the caps and the
  nearest-first choice; no allocation a frame; the audio graph's order; gain
  changes under 0.005 not sent.
- **Lockstep.** The shader's constants against the TypeScript's; the sea's
  four hashes re-pinned and the lake's unchanged; the corpus recorded again
  on every tier at the cove and open-sea poses by hour and weather, and
  checked live after the deploy for no misses on a first visit.
- **Look.** Stills at the waterline and from the road, the sun pinned,
  against the approved surf references (`ruby-01`, `ruby-05`, `ruby-11`,
  `kalaloch-11`, `rialto-11`, `rialto-03`, `second-beach-06`): a curl with a
  tube from the beach side, a thrown lip from the road side, a sheet climbing
  the pebbles with lace at its edge, a wet band that climbs and falls, spray
  blown by the wind.
- **Architecture.** The architecture doc gains a sea's-edge paragraph.

## 10. Out of scope

Salt haze over the surf zone; the ground changing underfoot as the water
arrives (the road wall keeps players off the beach); tide; opening the beach;
the bays' swash (they keep the static line); a simulation twin of the sheet
in the sim (built when the beach opens, with the swell's).

## 11. As built (2026-10-09)

The build followed §3 to §7 with the departures below, each from what the code or the measurements showed.

**The plunge is the shore break on the face (§3, §4.1).** The 1:50 bed spills: its Iribarren number is about 0.2, and big crests arrive at the toe as bores with the ocean's foam, as before. Crests that reach the toe (2 m deep, 24 m seaward of the still waterline) unbroken plunge on the 1:12 face, where the number is about 0.8 to 0.9. The strip and the shader lip live over the face, between the toe and the run-up; a crest already broken at the toe gets no lip and no plunge. Progress reads the swell sample's break ratio, which the cap already tracks from 1.0 to 1.5, not the crest's capped height.

**The run-up is measured from the still waterline (§5).** Every up-face distance, the front, the sheet's thickness and the wet reach, starts at the waterline rather than the toe; measured from the toe a 9.6 m reach would end under 1.2 m of water. Every crest reaching the toe sends a sheet, broken or not, launched at the waterline a transit after the toe. Hunt's reach on the 1:12 face often exceeds the cap, so the line sits most of a metre above the level through most of a set.

**No swell sample per column per frame (§5.2, §4.3).** One evaluation of the swell costs about 2.6 µs, so 512 columns a frame would cost over a millisecond. The table and the tracker take each column's time-invariant part once and sum by angle addition from the twelve phases each frame: 0.04 to 0.1 ms for the table and 0.13 to 0.18 ms for the tracker on a quiet machine, checked against the full evaluation by tests to 1e-14 s.

**The wet ground reads a uniform array, not a sampler (§5.4).** The terrain's fragment stage already binds sixteen of sixteen textures, so the swash reaches the wet materials as 256 vec4s packed once a frame by two module-level setters, with the cove's centre, width, toe and grade as a second uniform. On Chrome on macOS, where uniform buffers are off, that is 256 plain uniform vectors on every wet material; the terrain still links there.

**The sheet lifts the vertices (§5.3).** On the dry face the rings' depth attribute is clamped to zero, so the lift reads the coast profile's depth from the atlas: a vertex rises to the ground plus the sheet where the sheet covers it, and the sea's depth there is the sheet's thickness. Two rules follow that the spec did not state: a sea ring whose footprint holds only the dry face is no longer culled while the face is within the largest reach (1.6 m above the level), so the sheet is not cut along a ring's edge; and outside the bed-height square the sea's depth is the shallower of its own ground's and the profile's, so the film reads thin on the face and a far headland or stack keeps its own ground.

**The set envelope is the sheet's share (§6.1).** Mean breaking along the break line barely moves between sets, since every crest that reaches the toe is at or past its break by then: on the murky cove it swung by 0.08. The envelope is the mean of the sheet's thickness at the waterline across the cove's columns, as a share of the thickest sheet a swell of the current significant height sends (0.1 of it), still averaged over 4 s. Over ten minutes it runs from 0.30 to 1.00 on the murky cove and from 0.39 to 0.74 on the trailhead's, so the bed breathes with the sets.

**The sea rests on the pebbles between sheets (§5.3).** Lifting only the vertices a sheet covers left the next vertex up the face at the still level, under the pebbles, so the surface dived into the ground between them and the terrain's depth cut the sheet along the ring's grid: a staircase from above, triangular teeth at eye height. Within the cove's share the lift now also holds the surface to the ground wherever the swell would put it lower, the surface's height summed once for both stages, so the depth where the sea rests is exactly 0 and the fragment discards there; the sheet's edge is the table's metre columns. Along the cove the sea's bed is the shallower of its own ground and the profile's inside the bed's square as well as outside it, since the two differ by millimetres on the face and a film of that thickness would otherwise draw on the pebbles.

**The sheet is a film, its reach lobed along the shore, its wetting smooth (§5.1, §5.2, §5.4).** Seen from the waterline looking seaward at noon on high, the first build's sheet read as a flat dark plane: 0.3 of the bore's height at the waterline made it a wedge up to half a metre deep over the pebbles, and with every bore at the one 12 m clamp every sheet ended on the same line. The sheet now lays 0.1 of the bore's height at the waterline, 6 to 21 cm live, and each column's reach is held to its own cap, 8.5 to 12 m along the shore from two sine waves of 23 and 61 m with fixed phases, the same on every peer, so the sheets end in lobes. The lobes exposed the wet line's rule: a column was wet again only when a sheet came within 0.1 m of its held line, so a sheet that hit one column's cap and stopped 0.2 m short of the next left the two 10 to 40 s apart in age, a soaked column beside a dry one, a straight seam along the shore normal. A sheet now caps a column's age once, from the age it found as it began to rise, by its shortfall's share of 2 m, and the nearer the column was to dry the more the sheet counts as a fresh wetting, its line sinking toward the front; every term is continuous in the front, the line and the age, which vary smoothly along the shore, and the largest age step between neighbouring columns over two minutes of swell is 1.65 s, 0.05 to 0.4 s live.

**The strip's end caps (§4.3).** Where a slot goes free beside a live one, the free slot takes its neighbour's crest position at zero size, so the curl ends in a short cap on the surface instead of a sheet folding to the coastline.

**One plunge a crest (§6.1).** The tracker re-arms a 20 m stretch only half a period after its last plunge; without that the along-shore phase unwrap could number one crest twice near a group node and fire two or three thuds.

**The strip on the WebGPU high tier while the FFT draws (§8).** The sea's wind mode is known only after the FFT starts asynchronously, so the strip is built on the WebGPU high path and shown only while the FFT draws the wind sea; in every other state, the FFT still compiling, the loop, or the high tier under WebGL2 (Safari, Firefox), the fragment lip draws instead, so the two never draw together. The strip is not registered with the rain map: its vertex positions are indexes, not places, and the rings stand for the face there.

**The recordings (§6.3).** The Park Service's Olympic ocean recording is 6.6 s, so it is cut into the five one-shots; the bed is a 30 s seamless loop from a CC0 recording of Short Sand Beach on the Oregon coast, credited beside it. The spray is thrown along the swell's travel, as the curl is.

### Cost

| Tier | Pose | Pair | Frame A | Frame B | B − A | Load |
|---|---|---|---|---|---|---|
| High, 4K, WebGPU | the waterline, noon | main → the edge | 28.9 ms | 34.9 ms | +6.0 ms | 3.5 |
| High, 4K, WebGPU | the waterline, noon | main → the edge | 32.3 ms | 34.9 ms | +2.7 ms | 3.0 |
| High, 4K, WebGPU | the waterline, noon | the edge → itself | 34.4 ms | 34.4 ms | -0.1 ms | 3.7 |
| High, 4K, WebGPU | the waterline, noon | the edge off → on | 34.9 ms | 37.5 ms | +2.6 ms | 3.2 |
| High, 4K, WebGPU | the waterline, noon | the edge off → on | 35.7 ms | 37.9 ms | +2.2 ms | 3.4 |
| High, 4K, WebGPU | the pad, noon | main → the edge | 35.7 ms | 36.2 ms | +0.5 ms | 2.6 |
| High, 4K, WebGPU | the pad, noon | the edge off → on | 37.4 ms | 35.5 ms | -1.9 ms | 3.1 |
| High, 4K, WebGPU | 18 m up, noon | main → the edge | 40.4 ms | 44.5 ms | +4.1 ms | 3.4 |
| High, 4K, WebGPU | the waterline, dawn | main → the edge | 35.6 ms | 37.5 ms | +1.9 ms | 3.8 |
| High, 4K, WebGPU | the storm cove, noon | main → the edge | 31.6 ms | 34.1 ms | +2.6 ms | 4.0 |
| High, 4K, WebGPU | along the shore, noon | main → the edge | 31.8 ms | 31.0 ms | -0.8 ms | 4.6 |
| Medium, 1080p | the waterline, noon | main → the edge | 54.5 ms | 62.8 ms | +8.3 ms | 3.9 |
| Medium, 1080p | the waterline, noon | main → the edge | 49.4 ms | 52.0 ms | +2.6 ms | 4.2 |
| Medium, 1080p | the waterline, noon | the edge off → on | 40.6 ms | 41.7 ms | +1.1 ms | 2.5 |
| Medium, 1080p | the waterline, noon | the edge off → on | 40.5 ms | 41.0 ms | +0.5 ms | 5.2 |
| Medium, 1080p | the pad, noon | main → the edge | 36.9 ms | 37.7 ms | +0.8 ms | 3.3 |
| Medium, 1080p | the pad, noon | the edge off → on | 36.4 ms | 37.1 ms | +0.7 ms | 3.8 |
| Medium, 1080p | 18 m up, noon | main → the edge | 43.3 ms | 46.5 ms | +3.2 ms | 2.3 |
| Medium, 1080p | the waterline, dawn | main → the edge | 40.7 ms | 44.2 ms | +3.4 ms | 4.5 |
| Low, 720p | the waterline, noon | main → the edge | 25.4 ms | 28.3 ms | +3.0 ms | 2.9 |
| Low, 720p | the waterline, noon | main → the edge | 25.7 ms | 28.2 ms | +2.6 ms | 3.2 |
| Low, 720p | the waterline, noon | the edge off → on | 27.3 ms | 28.1 ms | +0.8 ms | 2.5 |
| Low, 720p | the waterline, noon | the edge off → on | 27.6 ms | 28.4 ms | +0.7 ms | 8.4 |
| Low, 720p | the pad, noon | main → the edge | 20.0 ms | 21.0 ms | +1.0 ms | 3.0 |
| Low, 720p | the pad, noon | the edge off → on | 20.6 ms | 21.1 ms | +0.4 ms | 4.5 |
| Low, 720p | 18 m up, noon | main → the edge | 28.6 ms | 32.1 ms | +3.5 ms | 3.4 |
| Low, 720p | the waterline, dawn | main → the edge | 26.6 ms | 28.2 ms | +1.6 ms | 5.7 |

### Checks

- The corpus lost the sea's 15 stages and the wet ground's 523 that no page can ask for again, and gained 252 from 112 pages at the cove, the storm cove and the dawn cove on every tier, the lake's mirror pass on high and the lake's and the trailhead's poses; then, when the sea came to rest on the pebbles, its 8 stages again from 40 pages: 1,017 stages in all, the high tier's map 5.2 MB, the build's per-tier maps checking against every translation. Thirty-one old variants no single-page pose reaches (the skinned figures, a party's four to seven headlamps, a few prop variants) are retired without replacement; a first encounter translates them on the page thread, as the corpus's four light stages already did. One fresh page a tier at the cove at dawn and at noon asked for no stage the maps lack, with no console error: medium 200 and 214 stages, high 204 and 218, low 156 and 164, every page on WebGPU.
- Ninety-four stills on the branch, every tier, from the pad, the waterline and 18 m up at dawn, noon, dusk, night, rain and mist, with the storm cove and the dawn cove on high, beside sixty-five controls from before this work. The first set found the sheet's edge following the sea mesh's grid, a staircase from 18 m up and triangular teeth at eye height, which the controls' still line did not have (§11, the sea rests on the pebbles); the set shot after shows the sheet's edge as a smooth line from above and lacy along the waterline, and the wet band climbing with the sets and drying behind them, the band's dry edge straight along the shore where every reach sat at the 12 m clamp, lobed since. From 18 m up the soaked face reads as a pale sky sheen, main's own look over its 0.3 m band spread over up to 12 m of face, and a faint seam shows where the terrain's near ring hands over to the next, a detail seam of the rings, not the swash's.
- Looked at on the high tier from the six poses above at the waterline, along the shore, from 18 m up, at dawn, at night and in the storm cove, and at the waterline looking seaward at noon, where the first build's sheet read as a flat plane and the lobed build showed a seam along the shore normal; with the film, the lobes and the smooth wetting it passed (2026-10-09).

### Left open

- The soaked face's sheen: at a grazing angle under a bright sky the soaked pebbles (roughness 0.15) mirror the sky into a flat grey plane with the pebbles' relief lost, from the soaked line out past the waterline; and the ring seam in it from above. A roughness and relief change in the wet ground's stage, which every wet material carries.
- The film's foam: the open sea's inner-surf cover paints its large blobs over the sheet on the face; a lace held to the front and backwash streaks would read as swash. The sea's two stages.
- Near the eye the wet band's 5 cm speckle cells give the soaked line a blocky edge.
- A one-cell row of teeth may remain at each end fade's outer edge, where the rest's step meets a sheet in the table's last metre.
- In a flat calm with an onshore wind the sea's unfaded wind height can draw a film flush with the pebbles at the waterline.
- The skinned figures', the party's and a few props' wet variants are not in the corpus.

## References

- [The water material](2026-09-29-water-material-design.md), §6.1 and §7.
- [The water terrain](2026-09-30-water-terrain-design.md), §5.
- [Ocean waves](2026-10-02-ocean-waves-design.md), §2.2, §7.4, §9, §12.
- [The lake's mirror and ripples](2026-10-07-lake-mirror-design.md), §8.
- Photorealistic water rendering, the research page at
  https://csarko.sh/research/photorealistic-water-rendering: the plunging
  lip's speed and the tube's proportions, Hunt's run-up rule, the surf's
  levels and spectra.
