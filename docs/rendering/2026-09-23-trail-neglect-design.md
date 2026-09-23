# Trail neglect: an abandoned path that still reads as a path

The trail paints as evenly kept gravel with a little wear noise — a
maintained path. The fiction is a mostly abandoned one. This design makes the
bed read as neglected everywhere: leaf and needle drifts on it, gravel washed
out to dirt in patches, grass and duff creeping across the margins and
standing in islands, loose stone and twigs along the edges, the grass beside
it no longer trampled flat — while a continuous line of bed survives through
every stretch, because the trail is the player's route in both acts.

It is the second of four concurrent world-richness sub-projects and the one
that depends on the first: the ground-cover field
(`docs/rendering/2026-09-23-ground-cover-design.md`) carries its encroachment
and its bed litter as two terms of that field, built by that work. This
design owns the paint, the litter density and the trample, and runs after the
ground cover lands.

## 1. Rulings

| question | ruling |
| --- | --- |
| Abandonment model | Uniform along the whole trail; the trailhead's own elements are iterated later |
| Legibility | Always readable as a path: neglect is texture, never navigation difficulty |
| Approach | Everything through the ground-cover field and the existing trail paint; no trail-litter system of its own |
| Frame budget | +0.5 ms at 4× pixels, paired both orders, re-based against `main` after the ground cover lands |

## 2. Goals and non-goals

Goals:

- The bed reads as unkempt at every distance: drifts of dead leaves and
  needles, dirt where the gravel has washed out, litter and twigs along the
  margins, grass standing in on the edges and in islands.
- The bed's core is traceable from the near edge to the far fade in every
  still.
- Every patch and edge is a smoothstep of noise. No threshold, no repeating
  stamp.
- Paint and geometry agree: a painted drift has pieces lying on it.

Non-goals:

- Anything about the trailhead pad, the poster, the car or the box.
- Neglect that varies with distance from the trailhead (ruled out; the field
  terms are written so a positional ramp could be added later without
  restructuring).
- New assets. The pieces are the ground cover's duff generator.
- The bank, the bench geometry, the trail's route or its width.

## 3. What the ground-cover field already does for the trail

Two terms of `groundCover` (`sim/clutter.ts`), specified and planned with the
ground cover so both are built once:

- **Encroachment.** The grass trail ramp's reach varies along the trail by a
  9 m value noise, between 0.35 and 1.3 of its default, with a core of
  `CLUTTER_GRASS_TRAIL_CORE = 0.35` m that never opens. The blades, the cards
  and the duff all follow, since they read the same field.
- **Bed litter.** `duff` gains a bed term: a 6 m drift noise raises it on the
  bed and its margins in drifts, to `CLUTTER_DUFF_BED_MAX = 0.8`, fading out
  half a metre past the bed's edge. The duff field draws the pieces; the
  terrain paint receives `duff` at every vertex as a forest-floor weight.

This design adds nothing to the field. It reads the vertex's duff weight for
its drift paint, which is what keeps paint and geometry in step by
construction rather than by a mirrored noise.

## 4. The paint

`trailPaint.ts` paints the bed as four bands from the centreline — core,
margin, trample, bare — each darkened, widened and shifted by along-length
wear noise, with a ragged edge and a wet core. Three things change, all on
the core and margin bands, none on the bank:

- **Drifts.** The bed's gravel blends toward a needle-and-leaf bed by the
  vertex's duff weight, through `smoothstep(0.25, 0.7, duff)`. The needle bed
  is the forest-floor layer tinted to the needle colour the ground cover
  introduces (`NEEDLE_BED`). Under a drift the gravel's normal and relief
  fade out with the same weight, so a drift reads soft, not bumpy.
- **Wash-outs.** A second, finer patch field, a 4 m value noise in the
  paint's own GLSL (mirrored in TypeScript as the wear and edge noises are),
  through `smoothstep(0.55, 0.8, washout)`: gravel gone to bare dirt, the
  forest-floor layer darkened, roughness raised, pebble relief off.
- **A darker core.** The packed core's brightness drops 10 % overall. A
  maintained bed is pale because it is walked; this one is not.

Drift and wash-out weights are clamped so together they never exceed 1;
where both are high, the wash-out wins, because dirt under leaves is still
dirt at the edges of the drift.

## 5. The small things

- **Pebble litter** `CLUTTER_LITTER_D` 0.6 → 0.9: more loose stone along the
  margins. A tunable, so the level id moves.
- **Twigs and branches** on the margins come from the duff bed term with the
  generator's existing character weights. No rule of their own.
- **Trample** weakened to 0.6 of today's strength in `trailBenchParams.ts`:
  the grass beside the bed stands up more.

## 6. Budget, tests and gates

**Budget:** +0.5 ms at 4× pixels, paired both orders, two pairs, at TRAIL and
TRAILSIDE, re-based against `main` after the ground cover lands; native p95
under 17.5 ms. The paint is per-fragment work the bed already does; the
litter density adds a few dozen pebbles inside the reach.

**Tests, pure and Babylon-free:**

- *Paint mirrors.* The drift and wash-out weights at a point from the
  TypeScript mirror match the constants the GLSL carries (the wavelength,
  the salt, the smoothstep edges), in the pattern the bands are pinned
  today; both are 0 off the bed and rise only through their smoothsteps;
  their sum never exceeds 1.
- *The path reads.* Along the core the drift weight leaves the core band's
  own weight above a floor: a painted drift darkens the bed, it does not
  erase it. Pinned on the mirror over 300 core points.
- *Litter and trample.* `CLUTTER_LITTER_D` is 0.9 and in the tunables;
  `trampleAt` returns 0.6 of its former strength at the same inputs and the
  identity frame off the band.
- *Level id.* The tunables change moves it.

**Gates, before/after against `main`, sun pinned, every game page blanked
before each sample:** TRAIL and TRAILSIDE under clear noon and mist, at eye
level and looking down at the bed; counts of duff and litter instances on the
bed; a walk along 40 m of stem as three stills, to check the drifts read as
gathered litter and not as a repeating stamp. The one pass/fail by eye: in
every still the bed's core line is traceable from the near edge to the far
fade.

## 7. Fallbacks

In order, each a constant: `CLUTTER_DUFF_BED_MAX` 0.8 → 0.5 (in the ground
cover's field); the drift and wash-out smoothstep edges narrowed, for fewer
and smaller patches; the encroachment reach's floor 0.35 → 0.5 if islands read
as blocking.

## 8. Ownership and order

- The ground cover builds: `trailReach`, `grassTrailRamp`, `trailDriftNoise`,
  the bed-duff term, their constants and tests, and carries `duff` to the
  terrain vertex.
- This design builds: the two paint modulations and the core darkening with
  their mirror tests; `CLUTTER_LITTER_D`; the trample strength; a verification
  note; an `ARCHITECTURE.md` sentence. Three tasks.
- It runs after the ground cover lands and merges on top of it. Rock relief
  and wildlife touch none of these files and run at any point.

## 9. Follow-ups

- A positional ramp: neglect rising with distance from the trailhead, once
  the trailhead's own elements are designed.
- Puddles that sit in wash-outs when it rains, reusing the wet core.
- Footprints and drag marks in the dirt patches, keyed to the match's
  second act.
