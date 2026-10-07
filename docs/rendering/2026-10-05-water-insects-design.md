# Insects over the water: design

**Spec, 2026-10-05.** The fourth of the water sub-projects: the life a person
meets at the lake. At dawn and dusk, midges hang in swarms over the shore's
shrubs, reeds and snags and over open water, glinting when the low sun is
behind them, humming when you stand among them, and forming over a player who
stands still. By day, darners patrol the shore and hover, skimmers dart out
from their perches and back, and damselflies flutter low in the reeds. At
night the lake belongs to the Pacific chorus frog, whose voices fall silent as
a player comes near and start again, one first, when they have gone. Wind,
rain, cloud and the dread each switch them off the way they would.

It builds on the lake the water terrain made
([the water terrain](2026-09-30-water-terrain-design.md)): one lake a world at
most, 25–40 m in radius, clear or murky, with a marsh on a murky lake's
shelf and reeds and lilies along it. It leaves the sea alone: surf and wind
keep these insects off the open coast. It replaces the midge share of the
atmosphere's motes ([the atmosphere restyle](2026-09-15-atmosphere-restyle-design.md)),
which float in a box around the camera everywhere at dawn and dusk.

What shapes it:

- As realistic as performance allows; costs are measured and reported, not set
  as bars beforehand.
- Summer: the insects and the frogs are the coast's summer ones.
- Cosmetic, like the animals ([the wildlife director](2026-09-23-wildlife-director-design.md)):
  render-side, reading `sim/` and never writing it. Where each swarm, beat and
  perch lies is seeded from the world's seed, so every player has the same
  lake; the motion is each player's own, driven by the shared clock where that
  costs nothing, and peers need not agree byte for byte.
- Sound is synthesized where it can be (the hum, the wings), as the rain and
  the wind already are, and recorded only where it cannot (the frogs), from
  CC0 or CC-BY recordings credited in [`CREDITS.md`](../../CREDITS.md).
- As the world turns eerie the lake falls quiet with the animals.

## 1. The lake today

- **Insects.** The butterfly is the one insect species
  (`wildlifeField.ts`, `SPECIES_BUTTERFLY`): one a 16 m cell over open ground
  with flowers, by day, silent. The animals read no water.
- **Midges.** `motesParams.ts` has a `midge` mote species: 1–2 cm specks living
  1.5–3 s, emitted from a ±10 m × ±5 m box centred on the camera at dawn and
  dusk (about 05:00–07:30 and 16:30–19:00), denser under the dread, thinned by
  rain. Nothing ties them to water or to any marker.
- **Sound.** The ambient graph (`ambientAudio.ts`) has a rain bed, a wind bed,
  synthesized drips and one-shot positional calls (`emitter`). It has no
  looping positional source. At night the lake is silent.

## 2. What the lake must do

The figures are from field studies of the species of the Washington coast and
the National Park Service's acoustic monitoring at Lake Ozette (references at
the end).

### 2.1 Midge swarms

- Non-biting midges (Chironomidae) swarm over a marker: a shrub's top, a post,
  a reed clump, open water, a person's head. A swarm holds 69–607 midges,
  2.6–7.5 cm apart, flying at 0.07–0.23 m/s; a few hundred fill a ball about
  0.6–0.7 m across, and the big ones stand as a column that swirls.
- Each midge flies straight for about half a second and turns back at the
  swarm's edge, about 1.5× faster across than up and down. They do not align
  as a flock does (polarization 0.12–0.36): independent fliers, each held to
  the marker as if on a spring, look like a real swarm.
- In wind each midge flies upwind to the far edge, drifts back and flies up
  again, so the swarm surges along the wind and flattens while holding its
  place. Swarms break up at 5–6 m/s.
- They swarm for an hour or so around sunrise and from just after sunset, in
  still, humid air; rain shrinks and ends them; overcast does not stop them.
- A swarm reads as a shimmer when the sun is behind it against dark trees,
  each midge a glint whose wings flash once or twice a beat; against bright
  sky the midges are dark specks.
- The hum: *Chironomus* males about 229 Hz, rising about 10 Hz per °C; heard
  within a few metres.

### 2.2 Dragonflies and damselflies

- **Darners** (paddle-tailed, shadow, California; about 7 cm): one male a
  stretch of shore, patrolling a beat about 20 m long at about 1.8 m/s,
  hovering facing the shore for up to 30 s and returning to the same spots;
  chases between males reach 3.6 m/s. Darners fly into dusk.
- **Skimmers** (four-spotted skimmer, striped meadowhawk; 3–5 cm): perch on a
  reed tip, a shrub or a log, dart out a few metres after prey and return; a
  territory is 5–10 m of shore. They need sun.
- **Damselflies** (Pacific forktail, bluets, spotted spreadwing; 2.5–4 cm):
  weak, fluttering hops low among the reeds and marsh plants, dozens together.
- Turns run at 170°/s and often 1000°/s; wings beat at 30–50 Hz (damselflies
  16–20 Hz), a shimmer rather than visible flaps.
- Rain ends their flight; a cloud over the sun drops them into the vegetation.

### 2.3 The night

- At Lake Ozette in late summer, amphibians were audible 42–66 % of each hour
  from 21:00 to midnight and insects 0 % from 22:00 to 04:00. The night at a
  coastal Olympic lake is the Pacific chorus frog, not crickets.
- A chorus frog's call is a two-part "rib-it"; a pond falls silent as a person
  approaches and starts again, one voice first, soon after they have gone.

## 3. Approach

A water-life module beside the animals, not inside them.

- **Placement** (`waterLifeField.ts`, Babylon-free): from the world's seed and
  its lake, once a world, the swarm markers, the darners' beats, the skimmers'
  perches, the damselflies' reed beds and the frogs' voices.
- **Presence** (`waterLifeParams.ts`, Babylon-free): every share by the hour,
  the weather, the wind and the dread, and the summer temperature the hum's
  pitch follows.
- **Midges** (`midgeSwarms.ts`, `shaders/midge.*.fx`): one thin-instance mesh
  of camera-facing specks and one `ShaderMaterial`; each midge's position comes
  from its seed and the shared clock in the vertex stage.
- **Dragonflies** (`dragonflies.ts`, `dragonflyBehaviour.ts`): a few dozen
  small state machines on the CPU, drawn as thin-instance cards with the wing
  shimmer of `wingPlugin.ts`.
- **Sound** (`waterLifeAudio.ts`, and a looping positional source in
  `ambientAudio.ts`): the swarms' hum, the dragonflies' wings, the frogs.

The animals' system stays as it is: adding a species there touches about ten
per-species tables and the director's measured cadence, it reads no water, and
it steps every unit on the CPU, which hundreds of midges a swarm would not
suit. Particle systems were the other choice: they emit, carry and kill, so a
swarm would read as a fountain rather than holding its place, and each swarm
would be a draw.

## 4. Placement

All of it exists only in a world with a lake (`waterBodies(seed)` holds a
`lake`). The **shore band** is the ring from 8 m inside the rim to 15 m outside
it, with the marsh (`marshWeightAt > 0`) wherever it reaches.

### 4.1 Swarm markers

- About one marker per 10 m of rim: 16–25 for a 25–40 m lake.
- Each is seeded onto the nearest real candidate in its stretch of the band,
  in this order of preference: a shrub or bush (`CLUTTER_SHRUB`,
  `CLUTTER_BUSH`), a reed clump (`CLUTTER_REED`), a driftlog
  (`CLUTTER_DRIFTLOG`), a snag (`COHORT_SNAG`) within 20 m of the rim; or, for
  one marker in three, open water 2–8 m out from the rim.
- A marker carries its centre (over the candidate's top by 1–4 m, or 1–2 m over
  open water), its size (60–400 midges, skewed small) and its shape (a ball
  below 200 midges, a column, up to 3 m tall, above).
- **Heads.** While midges are present and a player stands or walks slower than
  0.5 m/s within the shore band for 10 s, a swarm of 80–150 forms 0.5–1 m over
  the player's head and follows them, easing after them at up to 1.5 m/s; it
  lets go when they move faster than 2 m/s for 3 s or leave the band. At most
  one a player.

### 4.2 Dragonfly beats and perches

- **Darner beats:** the rim cut into stretches of about 20 m, one darner each;
  a beat runs along the stretch 1–3 m out over the water, 0.5–2 m up, with two
  or three hover points facing the shore.
- **Skimmer perches:** one about every 8 m of rim, on the same candidates as
  the markers (reed tips, shrubs, driftlogs), 0.3–1.5 m up.
- **Damselfly beds:** where reeds or marsh plants stand
  (`clutterDensity` of `CLUTTER_REED` or `CLUTTER_WETPLANT` above 0.3), one
  damselfly per 4 m² of bed up to 40 in a lake.

### 4.3 Frog voices

- 6–12 voices, one per 20–30 m of rim and more along the marsh (half again its
  share), each at the water's edge, seeded.

## 5. The midges

### 5.1 Drawing

- One mesh, one draw for every swarm: a thin instance a midge, a two-triangle
  card facing the camera. Its seed, its swarm's index and its slot in the swarm
  are per-instance; each swarm's centre, size, shape and current presence are
  in a small uniform table (up to 32 swarms: the markers and one over each player's head).
- The card is 3 mm across in the world, half again a real midge's 2 mm, but
  never less than 2 px on screen, with a tent footprint; its alpha is scaled
  down by how much it was enlarged, but within 6 m of the eye never below
  0.6, a floor that fades to nothing at 15 m, so a close midge reads as a dot
  and a far one as a faint speck rather than a big one.
- **Glint.** Each midge's brightness is a forward-scatter lobe on the angle
  between the view and the sun (bright with the sun behind the swarm, dim
  otherwise) times the sun's light, plus a wing flash: a narrow pulse at a
  per-midge rate of 9–14 Hz with a random phase. Against the sky's luminance
  the speck darkens instead, so a swarm against a bright sky reads dark.
- Blended additively for the glint and with alpha for the dark speck, in the
  effects group the water's see-through effects share on the high tier
  (`effectsGroupFor`, `WATER_GROUP`), so they draw over the water correctly.
- **Far swarms.** A swarm draws its full count within 15 m, fewer with distance
  (down to a tenth at 60 m: a midge whose slot is above the count collapses to
  nothing in the vertex stage) and nothing beyond 80 m.

### 5.2 Motion

- Each midge's offset from its swarm's centre is a sum of three sinusoids per
  axis at incommensurate rates (0.7–2.1 Hz), with amplitudes that put 90 % of
  the midges inside the swarm's radius and make the horizontal legs 1.5× the
  vertical. Summed this way a path runs nearly straight and turns back near
  the edge, as the field studies' midges do, with no neighbour search.
- Columns stretch the vertical amplitude to the column's height and add a slow
  swirl about the vertical axis (0.05–0.15 rev/s).
- **Wind.** The swarm's centre moves downwind by up to its radius as the wind
  rises, and surges along the wind axis, out and back, with a period of 3–6 s;
  the vertical amplitude shrinks by up to half (flattening).
- Driven by the shared clock (`sharedSeconds`) and the swarm's seed, so the
  swarms move alike on every player's screen at no cost.

### 5.3 Counts

| Tier | Midges in view, at most |
| --- | --- |
| High | 4,000 |
| Medium | 2,000 |
| Low | 800 |

Every tier gets them: it is one draw of tiny cards. A swarm keeps its share of
the tier's total by its size and distance.

### 5.4 The motes

The `midge` mote species goes. The pollen and the frost motes keep their third
of the existing capacity each, at the size and the rate they had
(`MOTE_CAPACITY` unchanged, the midges' third left unspent), and dusk no
longer fills the camera's box with midges where there is no water.

## 6. The dragonflies

### 6.1 Drawing

| Kind | Length | Colour | Wingbeat shown |
| --- | --- | --- | --- |
| Darner | 7 cm | blue and green on brown | 36 Hz |
| Skimmer | 4.5 cm | brown, dark wing spots | 30 Hz |
| Damselfly | 3 cm | slender, blue | 18 Hz |

- Each is a card mesh: a body (two crossed quads) and four wings, coloured per
  instance, one thin-instance draw per kind, in the same effects group as the
  midges on the high tier.
- The wings shimmer through `wingPlugin.ts`: a fast, small flap whose rate is
  a whole multiple of the plugin's wrap (`WING_TIME_WRAP`) and a translucent
  wing that reads as a blur. Perched, the wings stop: a skimmer's lie flat, a
  damselfly's fold along its body.

### 6.2 Behaviour

Units exist within 60 m of the camera; each steps every frame, with no
allocation.

- **Darner:** patrols its beat at 1.6–2.0 m/s, turning at up to 300°/s at the
  ends; at a hover point hovers facing the shore for 2–30 s; when its beat
  meets a neighbour's and both are near the meeting point, both chase at
  3.6 m/s for 1–3 s and return.
- **Skimmer:** perched for 1–10 s, then darts 2–5 m out in a quick loop and
  back to the same perch at up to 3 m/s.
- **Damselfly:** perched on a stem for 2–15 s, then a weak, fluttering hop of
  0.3–3 m (about 2 m, as far apart as a bed's stems stand) at about 1 m/s,
  low, to another stem in its bed, the stems within 3 m of its own.
- **Players:** anything perched within 2 m of a player flushes to another perch
  or hover point; a darner bends its beat around a player standing on it.
- Episodes are drawn from a hash of the unit, its episode and the seed, keyed
  on tick slots as the animals' are, so peers see much the same flight.

## 7. Sound

### 7.1 A looping positional source

`ambientAudio.ts` gains a source that loops, moves and changes gain without a
restart (`loopEmitter`), behind the same equal-power panner and inverse
distance model as the calls. A cap holds the voices: 8 swarm hums, 12 frog
voices and 2 dragonfly rustles at once, the nearest winning.

### 7.2 The swarms' hum

- Synthesized: six oscillators a swarm, detuned ±8 % about the pitch, through a
  band-pass, their amplitudes drifting slowly and independently.
- Pitch: 230 Hz at 15 °C, plus 10 Hz per °C, held between 180 and 330 Hz.
- The summer temperature: 11 °C at 03:00 rising to 21 °C at 15:00 along a
  24-hour cosine, its swing halved under full cloud, 3 °C cooler at full rain.
- Heard to 10 m (reference distance 0.5 m), its gain by the swarm's size and
  presence; a swarm over the listener's own head is the loudest.

### 7.3 The dragonflies' wings

- Synthesized: a short burst of noise, band-passed and pulsed at the
  wingbeat, as a darner or skimmer passes within 2 m; a louder clatter at a
  chase's start.

### 7.4 The frogs

- Recorded: the Pacific chorus frog's two-part call and a few chorus bouts,
  from CC0 or CC-BY recordings checked for species, region, licence and
  derivatives, credited in `CREDITS.md`, shipped as the catalog's audio. If no
  suitable recording exists, the call is synthesized: two pulsed tones at
  2–2.5 kHz in the call's rhythm.
- Each voice calls in bouts with its own rhythm; neighbours alternate rather
  than overlap.
- **Near players:** a voice with a player within 12 m stops. When no player has
  been within 12 m for 20–40 s (per voice), it may start again, but only one
  voice in a stretch restarts first; the others join at the later of a 5–15 s
  draw and the end of their own wait.
- **The Hollow:** within 60 m of the Hollow every voice stops at once and stays
  silent until it is beyond 80 m.

## 8. Time, weather and dread

The game's sun rises at 06:00 and sets at 18:00. The wind's speed (0–1,
`windSpeedUnder`, or the `/wind` override) is read as m/s at
`WATER_LIFE_WIND_MPS` = 8 m/s for 1: clear weather near 2 m/s, overcast near
5 m/s.

| | Hours | Wind | Rain | Cloud, mist |
| --- | --- | --- | --- | --- |
| Midges | dawn 05:15–07:00; dusk 17:45–19:45, fullest just after sunset | full to 0.5, thinning to none by 0.75 | none by 0.3 | cloud no effect; mist fills swarms up to 30 % fuller |
| Dragonflies | 09:00–17:00, ramping in from 08:00 and out by 18:00; darners at a third to 18:30, gone by 19:00 | none flies above 0.7, from 0.6: skimmers and damselflies perch, darners go to cover | none above 0.05 | full below cloud 0.4, none by 0.7: skimmers stay perched and seen, darners and damselflies go to cover |
| Frogs | 19:30 to 05:00, fullest 21:00–24:00 | no effect (the wind's bed masks them) | keep calling | no effect |

- Each share ramps over the stated edges with a smoothstep, and every change
  of presence eases over 3 s, as the animals' does.
- **The dread.** Every share is multiplied by `1 − k` with
  `k = clamp((dread − 0.3) / 0.2)`, the ground animals' curve, so the lake is
  quiet by the middle of the dread. The eerie weather's rain grounds the
  insects on its own. As a climb moves the hour toward 22:00, a player may
  pass from the dusk swarms into the frog night and then into silence.

## 9. Tiers and costs

- Draws: one for the midges, one for each kind of dragonfly. All tiers get all
  of it; the low tier with fewer midges (§5.3).
- No allocation per frame in placement, behaviour or audio.
- **WebGPU.** The midges' `ShaderMaterial` and any material define combination
  the dragonflies bring are recorded into the shader corpus on every tier, at
  the lake by day, at dusk and at night, and merged with the corpus tool.
- **Cost.** Measured against `main` at 4K at the lake at dusk (the swarms) and
  at midday (the dragonflies), on every tier, and reported. Expected under
  0.5 ms.

## 10. Tests and checks

- Placement is the same for a seed and a lake; marker, beat, perch, bed and
  voice counts sit in their ranges for lakes of 25 and 40 m; a world without a
  lake has none.
- Presence by hour, weather, wind and dread, as tables of literal values.
- The midges' shader constants mirror the TypeScript's (`const float` in
  lockstep), its texture-free vertex path, and the count falling with
  distance.
- The dragonflies' state machines: a darner stays on its beat, a skimmer
  returns to its perch, flushing within 2 m, no allocation on a quiet frame.
- The looping source: it loops, moves, changes gain without a restart and
  holds its cap.
- The frogs: silent within 12 m of a player, one voice restarting first, all
  silent within 60 m of the Hollow.
- The draw budgets hold; the `midge` mote species is gone.
- In a browser, on every tier: stills at the lake at dawn, dusk, midday and
  night beside the field references, with no console error; the corpus misses
  nothing on a first visit.

## 11. Out of scope

Life on still water (water striders' rings and shadows, whirligig rafts); the
beach (seaweed flies from the wrack, beach hoppers at night); mosquitoes and
their whine; a daytime insect buzz; seasons; the breaker, swash and the lake's
mirror.

## 12. As built (2026-10-05)

What the build changed from the sections above, and what the cost and the
checks showed.

- **§8: the hours.** Every row of the table gives a share's outer edges, where
  it starts to rise from nothing and where it is gone, each edge a smoothstep.
  The frogs are silent until 19:30, reach 0.6 by 20:00 and 1 by 21:00, hold it
  to midnight, fall back to 0.6 by 00:30 and hold that to 04:30, and are gone
  by 05:00. The darners fall to a third of their share over 17:00–18:00, hold
  it to 18:30 and are gone by 19:00. No dragonfly flies above a wind of 0.7
  (5.6 m/s), the share falling from 0.6.
- **§7.2: the temperature.** A 24-hour cosine through 21 °C at 15:00 has its
  minimum, 11 °C, at 03:00, not 05:00.
- **§4.2: the perches and the stems.** A perch on land (a shrub's, a bush's or
  a drift log's) stands 0.3–1.5 m above its own ground, and one whose ground
  lies more than 1 m below the lake's level is left out: a skimmer sallying
  from it toward the lake would fly into the bank. Only a reed's perch or a
  damselfly's stem with water under it, inside the rim or on the marsh, stands
  up from the water's level; on dry ground each stands on its own. A stem
  stands 0.3–1 m up.
- **§6.2 and §8: out of the air.** Each unit draws once, for life, against its
  kind's two shares, out of cover and aloft. A skimmer that is not aloft sits
  on its perch and a damselfly on its stem; a darner has nothing to settle on,
  so one not flying is in cover and not drawn, and there are no roosts. A
  damselfly hops to another stem of its bed, the stems within 3 m of its own,
  0.3–3 m from the one it sits on: about 2 m, as far apart as a bed's stems
  stand (4 m² a stem). At the design's 0.3–1 m most stems had no other within
  reach; at 3 m one in twenty has none, and its damselfly stays on it.
- **§7.4: the restart.** Each voice waits out its own 20–40 s after a player
  leaves it. Its stretch is the silent voices linked neighbour by neighbour (a
  neighbour within 30 m, or the nearest voice). The first of the stretch to
  call again is the one nearest its centre among those whose wait has run
  out, and the others with no player near join at the later of a 5–15 s draw
  and the end of their own wait, so a joiner can come in up to about 40 s
  after the first. A voice a player still stands by keeps waiting.
- **§7.4: the calls.** The calls are recorded: five clips from three
  recordings (CC0 and CC BY 4.0) credited in [`CREDITS.md`](../../CREDITS.md),
  three single calls and two chorus loops. Each voice calls one of the single
  calls at a playback rate of its own (0.94–1.06), both fixed by the voice's
  index, so every voice keeps its call and its pitch; until its clip is
  decoded, or for good if the clip fails to load, it calls the synthesized
  call instead. Under the voices lies a far chorus, the frogs farther out: the
  two loops at two places 0.3 m over the water (the marsh's middle, or without
  a marsh the rim across the lake from the first voice, and the rim across
  from that). Its level follows the frogs' presence, so the dread silences it;
  it is gone while the Hollow holds the voices silent, and thins toward 0.35
  of itself with the share of the near voices a player's nearness holds
  silent, those still waiting to join their stretch among them. Each loop
  also falls quiet around the player nearest its place, as the voices there
  do: to 0.35 within the voices' 12 m, rising linearly to whole at 30 m.
- **§7.4: the levels.** At the first levels the frogs were heard only now and
  then, under the ambience. A call keeps its gain, 1–2 by the voice, to 3 m
  and falls as 3/d beyond (0.25–0.5 at the 12 m quiet radius, 0.06–0.125 at
  48 m); the chorus loops play at 0.5 and 0.35 to 30 m and fall as 30/d
  beyond (0.2 for the far one from 52 m, across a lake of 26 m radius).
- **§7.1 and §7.2: the loops.** Every loop goes through the animals' bus into
  the world's, so a stare muffles the lake and a hush cuts it, as they do the
  animals' calls. The world bus reaches the master through the stare's
  low-pass and then a brick-wall limiter (threshold −3 dB, knee 0, ratio 20,
  attack 3 ms, release 0.1 s), so the frogs, a hum over the head and a rustle
  together cannot clip; its makeup gain raises the whole world bus by about
  1.7 dB. Every hum starts silent and is raised to its gain through the loop's
  0.1 s ramp, so a swarm forming at the ear never starts at full strength; a
  hum that drops out fades over 0.5 s and is stopped once its gain has
  followed to nothing.
- **§4.1: the head swarms.** A swarm over a head gathers over 3 s once it
  forms, and once it lets go it thins out over 3 s where the head last was.
  With the camera out of the lake's reach the heads let go outright.
- **§5.1 and §6.1: drawn to be seen.** Drawn at the design's 2 mm and 1.2 px
  the midges did not show, and the dragonflies were specks at play distance.
  The midge's card is 3 mm across and never under 2 px, and the fragment lays
  a tent on it, (1 − |u|)(1 − |v|), whose values at the pixel centres a
  two-pixel card covers sum the same wherever a midge on the view axis lies,
  so a far midge holds steady as it crosses them. Its coverage falls with its
  enlargement but, near the eye, never below 0.6, and against the brightest
  sky a speck hides 0.9 of what lies behind it. The floor holds to 6 m and
  fades to nothing at 15 m: held at every distance, it summed the dozens of
  2 px dots of a swarm across the lake into a solid, sunset-coloured blob, and
  without it a far midge is a faint speck, its coverage only what its
  enlargement leaves. Beside the sun's glint lies a second, the sky's:
  a broad lobe (the cosine squared) toward the sun's azimuth, level, lit by up
  to 0.6 of the horizon's colour toward the sun as the dome draws it, blended
  toward the mist's air by the mist's weight as the dome blends its horizon.
  It carries no night factor, so a swarm glints against the glow that outlasts
  the sun and fades with it. The dragonflies are drawn 3× their length (at
  1.5× a skimmer 5 m off was about 12 px and a darner 12 m off about 8), and
  their colours are 1.3× the real insects' in every channel, which keeps each
  hue and its saturation.
- **§5.1: the low tier.** On the material colour path (the low tier, with no
  post chain) the light a speck adds takes the frame's exposure, bound at each
  draw so the stare's dimming is in it, then the Khronos PBR Neutral tone map,
  the sRGB encode and the contrast, in Babylon's order, as the sky dome takes
  them; the coverage is never toned. On the post path the light goes out
  linear, for the post chain to tone with the frame.
- **§5.1 and §6.1: the draw order.** The midges and the dragonflies draw last
  among the see-through effects, after the rain, the mist and the blended
  water (an `alphaIndex` of infinity), so the water and the mist never wash
  them out. Their bounds sit at the origin, so a sort by distance would flip
  with the camera, and the mist banks and the water's blended surface off the
  high tier keep Babylon's default index, the largest finite number: only
  infinity draws after them.

### Cost

§9 asked for the cost against `main` at 4K on every tier. It was not
measured that way: the development machine was never quiet while this was
built, and a round of fresh pages at dusk on the high tier, `main` and the
branch in the order A, B, B, A, drifted 18 ms within the round as the load
rose from 3 to 17, and was set aside. In its place, one page at 4K hid and
showed the lake's meshes in turn, six pairs of 2 s each. Showing them read
−2.5 ms at dusk on the high tier (the pairs from −6 to +1 ms), +2.8 ms at dusk
on the low tier (a median of −1 ms, with one pair far out) and −2.7 ms at noon
on the high tier (−18 to +8 ms). All of it lies within the noise of a loaded
machine: no draw cost was measured on any tier, and §9's expected 0.5 ms is
neither confirmed nor ruled out. What the lake adds is four thin-instanced
draws, the midges' on one shader material and one a kind of dragonfly, and a
step that allocates nothing on a frame without calls.

### Checks

At the murky lake of `room-3`, at 18:30 unless said, on WebGPU pages unless
said, with no console error on any page.

- **First visits.** With the toned midges' stages recorded, the high tier met
  234 stages and missed none, the medium 208 and the low 176 (on a WebGPU
  page). Pages that fell back to WebGL under load met every stage from the
  shipped maps too, some only once the map had landed. Once the fading
  floor's vertex stage was recorded, the high tier met 222 stages, the medium
  216 and the low 174, all on WebGPU pages and none missing, the midges' new
  stage served from the shipped map on every tier.
- **Stills** on every tier at dawn, dusk and noon (the dragonflies, four
  frames), in mist, eerie and overcast weather, and on the low tier at 18:15
  and 18:30 close and at middle distance: no regression against the earlier
  set.
- **Drawn and heard.** At dusk 3,645 midge instances and 16 swarms humming at
  273 Hz; at noon 8 darners, 20 skimmers and 40 damselflies; at 22:00 158 frog
  calls a minute from 7 voices 15–55 m from the north shore, the far chorus at
  a level of 1.
- **By eye**, at dusk from 1.5 m and 4.5 m, at noon and at night: the close
  swarms read; the far swarms, which first read as pink blobs, fade to specks;
  the dragonflies read at 3×; the frogs are heard across the lake.

### Left open

- The sky glint's lobe is broader than the sky's own glow off its axis near
  sunrise and sunset.
- A value that is not a finite number reaching an audio setter is not guarded.
- Frames with calls make small allocations.
- The midges' instance buffers are larger than needed: Babylon counts thin
  instances by their matrices, so each midge carries an identity the stages
  never read.
- The lake's clips load on every world with a lake, whether or not the hike
  nears it.
- A dragonfly whose share takes it out of the air vanishes where it is.
- The midges and the dragonflies draw over the mist banks.
- A chorus loop falls quiet around the player nearest its place, not around
  the listener, so a camera elsewhere hears it quieted.
- On the material path a contrast below 1 would show each midge's card as a
  grey square; the contrast there is 1.1.
- On the low tier the specks darken a bright sky more than on the high tier:
  the blend works in the encoded space there, as every blended material's
  does.

## References

- National Park Service, Olympic National Park acoustic monitoring report
  (Lake Ozette, Third Beach): https://irma.nps.gov/DataStore/DownloadFile/664808
- Attanasi et al., collective behaviour in wild midge swarms:
  https://arxiv.org/pdf/1307.5631
- Kelley and Ouellette, emergent dynamics of laboratory midge swarms:
  https://pmc.ncbi.nlm.nih.gov/articles/PMC3545223
- Missouri Department of Conservation, midges:
  https://mdc.mo.gov/discover-nature/field-guide/midges
- Chironomid swarming, light and wingbeat frequencies (ICUP):
  https://www.icup.org.uk/media/d31i1xku/icup225.pdf
- Bomphrey et al., dragonfly and damselfly flight in the field:
  https://pmc.ncbi.nlm.nih.gov/articles/PMC4992713/
- Paulson, the Odonata of Washington:
  https://www.pugetsound.edu/puget-sound-museum-natural-history/biodiversity-resources/insects/dragonflies/world-odonata-list/washington-odonata
- Pacific chorus frog calls and behaviour:
  https://archive.seattletimes.com/archive/20020506/peeper06m/tiny-chorus-frogs-belt-out-love-songs
  and https://californiaherps.com/frogs/pages/p.regilla.sounds.html
