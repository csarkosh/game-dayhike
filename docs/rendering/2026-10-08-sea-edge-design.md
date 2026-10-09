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

## References

- [The water material](2026-09-29-water-material-design.md), §6.1 and §7.
- [The water terrain](2026-09-30-water-terrain-design.md), §5.
- [Ocean waves](2026-10-02-ocean-waves-design.md), §2.2, §7.4, §9, §12.
- [The lake's mirror and ripples](2026-10-07-lake-mirror-design.md), §8.
- Photorealistic water rendering, the research page at
  https://csarko.sh/research/photorealistic-water-rendering: the plunging
  lip's speed and the tube's proportions, Hunt's run-up rule, the surf's
  levels and spectra.
