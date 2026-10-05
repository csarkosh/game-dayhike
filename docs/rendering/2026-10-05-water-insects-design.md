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
most, 25–40 m across its rim, clear or murky, with a marsh on a murky lake's
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
- The card is 2 mm across in the world but never less than 1.2 px on screen,
  its alpha scaled down by how much it was enlarged, so a far midge reads as a
  faint speck rather than a big one.
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

The `midge` mote species goes. The pollen and the frost motes keep the
existing capacity between them (`MOTE_CAPACITY` unchanged), and dusk no longer
fills the camera's box with midges where there is no water.

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
  0.3–1 m at about 1 m/s, low, to another stem in its bed.
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
- The summer temperature: 11 °C at 05:00 rising to 21 °C at 15:00 along a
  cosine, its swing halved under full cloud, 3 °C cooler at full rain.
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
  voice in a stretch restarts first; the others join over the next 5–15 s.
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
| Dragonflies | 09:00–17:00, ramping in from 08:00 and out by 18:00; darners at a third until 19:00 | perch above 0.7 | none above 0.05 | full below cloud 0.4, none by 0.7: skimmers stay perched and seen, darners and damselflies go to cover |
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
