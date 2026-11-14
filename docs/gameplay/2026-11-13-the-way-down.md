# The way down

**Date:** 2026-11-13
**Status:** Built: the path, the rules that hold a player to it, its light, and the ranger's
lines. The crowd of shades beside it, the obstacles on it and the whispers are later pieces.
**Parents:** `2026-09-16-the-summit.md` (§5, the chase, whose guide and fork cuts this replaces),
`2026-10-06-the-haunt.md` (§3, §3b), `2026-10-07-the-inner-voice.md`, `2026-10-08-the-summit-scene.md`
(the threshold, where the light comes up), `2026-10-06-the-mist-shades.md` (the ground mist).

## 0. What this is

In the chase there is one way home and the player can see it. From the crest to the pad runs a
drawn path, direct and never straight, that leaves the trail wherever that is shorter. It is
shown as a channel of pale ground mist: thin and low on the path, standing in tall banks either
side of it, never still, and everything outside it about half as bright. The player may still go anywhere; the light,
the dark, and what the chase does to a player off the way are what keep them in the channel.

Before this the chase drew a hidden guide route down the trail's branches, one and a half to two
and a half times the shortest way home, and stood a Hollow in every branch the guide did not take.
The way home was three to four minutes at a sprint, doubled round loops, and was found by running
into Hollows. The guide, the cuts and the forks' Hollows are gone.

## 1. The path (`sim/wayDown.ts`, `sim/wayDraw.ts`)

**What it is.** A line of points 2 m apart (`WAY_STEP_M`) from where the party stands at the
find to the pad, with
the metres along at each and a 16 m grid of its segments, so that "how far off the way is this
place" (`wayDistance`), "how far along" (`wayProject`), and the point and direction at a distance
along (`wayPoint`, `wayDirection`) are a few segments' arithmetic.

**Where it begins.** Not at the body: on the stem, 12 m down it from the crest (`WAY_START_M`,
the discovery's radius), where a party coming up the trail stands when the scene takes them. The
Hollow steps out past the body from there, so no part of the way comes within 8 m of the body
(`WAY_BODY_CLEAR_M`) or within 22 m of it on the side away from the party
(`WAY_CREST_CLEAR_M`): the light's mouth is on the party's side, and where the pad lies behind
the crest the way goes round it.

**Its length.** `wayTarget(straight)`: 840 m (`WAY_TARGET_M`, two minutes at the sprint's 7 m/s)
or twice the straight line from its start to the pad (`WAY_MAX_RATIO`), whichever is less, and never under
1.12 times the line (`WAY_MIN_RATIO`), the least that leaves it room to bend. Straight lines run
from a few hundred metres to over a kilometre: a line over 1,027 m winds less than that so as to
stay under 1,150 m (`WAY_MAX_M`), and one over 1,095 m is 1.05 times itself (`WAY_LONG_RATIO`).

On a short world, where the aim is over one and a half times the line, the way winds as much as
its ground lets it: an aim of twice the line takes swings of 100 m and more to either side, and
the steep ground round a crest that near the pad does not always allow them. Two worlds in the
sweep's fifty come out 0.70 and 0.77 of their aim, 1.4 and 1.5 times their line.

**Its shape.** No stretch runs straight for more than about 40 m (`WAY_STRAIGHT_MAX_M`), the
distance to the pad never grows by more than about 10 m before it falls again
(`WAY_BACK_MAX_M`), and no two stretches come within 25 m (`WAY_APART_M`). These two are the
design's "about": the tests give a straight stretch 8 m and a way gone round a lake 5 m, and
measure heading back past the way's first 60 m, which may be going round the crest. The draw
holds the first itself: a stretch of the drawn line that measures straight for over 46 m
(`WAY_STRAIGHT_MOST_M`) has the cells round its middle walled, as if a boulder stood there, and
the search goes again and round them. Without it a line that left the meander for one of its
copies, round a lake or a cliff band, crossed to it and back in straight diagonals of 60 m and
more.

**How it is drawn** (`drawWay`, a generator):

1. A meander about the straight line: parabola arches to alternate sides, a little less at the
   ends, their amplitude found by bisection so the meander is the target's length. Waves are
   100 m at the least winding and up to 220 m at the most, so a long way's bends stay gentle.
2. A search (A*) over a grid of 3 m cells in the line's own axes for the cheapest line from the
   start's cell to the pad's. A cell is priced the first time it is touched: refused on the
   crest's ground above, in a lake (or within 3 m of its shore), under the sea's level, or on
   ground steeper than a player can stand on with a margin; dearer by a quarter for each metre it
   is off the meander or the nearest of its copies, which lie 80 m apart, so a line gone wide
   round a lake still winds; a twentieth cheaper where the trail passes. The trail's own cells
   are never refused for slope.
3. Along the line found, and only there: anything a runner could not step over (a trunk, a
   fallen one, a rock, a cliff) walls its cell, and so does a point of the line itself that
   stands on ground a player would slide on; then the search goes again, up to 24 rounds, and
   the last round's line stands with whatever is still on it, a trunk to run round.
4. The cells' centres are averaged with their neighbours and resampled. A length that misses the
   target corrects the amplitude and the whole goes again, up to three rounds.
5. Where nothing gets through the ground searched, the search widens (40, 160, 400 m past the
   meander); where nothing gets through at all, the way is the trail's stem and says so
   (`fallback`).

**Every peer draws the same one.** The way comes from the seed alone: no draw from the world's
random stream, nothing on the wire. So that the host's rules and a client's light are the same
line, these two files use only arithmetic every browser rounds alike (+ − × ÷, square roots,
floors, comparisons), which a test holds them to.

**When it is drawn.** A forest world that has a chase starts with its draw waiting
(`World.wayDraw`). The app advances it 1.5 ms a frame from ten seconds into the match
(`stepWay`), on the host and on a client alike, so it is done long before the find and never
under the intro. The flip from the scene into the chase settles it (`wayOf`) if it somehow is not
done. A whole draw is half a second to a few seconds of work on a laptop; its box checks build
the forest's collision chunks along the way early.

## 2. What holds a player to it (`sim/chaseLine.ts`)

Once the scene or the chase is on and the world has its way (`onWay`), every rule that asked how
far a player is from the trail asks how far they are from the way, through one function,
`chaseLineDistance`. The channel is wider than the trail was, so 1.5 m (`WAY_SLACK_M`) is taken
off the distance from the line: the far side of the mist banks, 5.5 m out (`WAY_RIM_M`), reads as the trail's
4 m edge, and every threshold keeps its meaning. Before the find, and on any level with no way,
it is the trail's distance as before. The place the party stood at the find, and 15 m round
it (`CREST_GRACE_M`), is on the line whatever the way's distance: a player caught there, or just
returned there, did not leave the way.

- **The death's cause** (`deathCause.ts`): off the way is the "off the trail" cause.
- **The haunt** (`haunt.ts`): a player off the way is pressed as one off the trail was, and its
  shades stand 15 to 20 m off the way.
- **The lens and the ranger's warning** (`escalation.ts`, `app.ts`): measured off the way.
- **The threshold's turn** (`app.ts` `wayDownFrom`): the eye turns to the way's point 10 m on.
- **A hunting Hollow** (`hollow.ts` `pursue`): comes down the way itself, toward its player's
  place along it, 12 m ahead of its own at a time (`WAY_LEAD_M`), and turns straight for them
  when it is that near them along the way or near them in plain sight. At 6.3 m/s it loses
  ground to a sprint and gains on a walk, as before.

A first attempt meets the crest's Hollow alone. A Hollow that steps out to a place and then
hunts (`spawnHollowStepping`, once the forks' Hollow) is kept for what will step into the way.

## 3. The light (`game/wayLightGeometry.ts`, `game/wayLight.ts`, `game/wayLevel.ts`)

**The shape.** Taller ground mist, not a wall. Across the way the mist is thin on the path
(`WAY_PATH_SHARE`, 0.55 of the banks', standing to 1.7 m) and whole in a bank either side,
filling between 1 m and 3.1 m from the line and gone between 4.6 m and 6.4 m, the banks standing
2.3 to 3.5 m and taller and shorter as they go. Under it the ground glows faintly, a core on the
path and a band under the banks. Every vertex stands on the ground the players stand on (the
simulation's field, the walkable rock's rise with it), which the app gives the renderer with the
way. (Until 2026-11-14 the way was a half pipe: a lit floor and a wall curving up a quarter
circle from either edge. It read as a literal wall.)

**How it is drawn.** As sheets that all read one field of noise in the world, the ground mist's
own map (`cloudNoiseMap`), so together they look like a volume: seven sheets that follow the
ground across the whole width (`WAY_SHEETS_M`, to 1.6 m over it), the mist a plant on the path
stands in; three veils a side along the way (`WAY_VEILS`), each wandering in and out; and a fin
a side across the way at every point, which is what an eye looking down the way sees, where the
veils are edge on. A fin fades as it turns edge on to the eye, and a sheet as the eye looks along
it, judged from the face itself so a sheet on a slope is judged by its own lie. The way across at
a point is taken over four points either side of it (`WAY_ACROSS_POINTS`): the drawn way has
kinks, and a way across taken at the point alone folds the mist over itself inside a bend. One
material of its own (`wayLight`), a mesh every 64 m of way, built a chunk a slice, 23 of the
ground's heights a point. No other material's shader knows of it, so it costs geometry and its
own pixels rather than work on every lit pixel, on every tier.

**Its colour.** The ground mist's own (`cloudColourUnder` of the air's near colour, which every
tier has), a quarter of the way toward a cold tint and lit to 8 times it before the tone map
(`WAY_POST_LIFT`; 14 times in the frame's own terms on the low tier, `WAY_MATERIAL_LIFT`), so it
belongs to the night it stands in and still reads as the lit way. The blend is premultiplied:
the mist hides 0.85 of its amount of what is behind it (`WAY_HIDE_SHARE`) and adds its colour,
so thin mist glows a little and thick mist settles at its own colour. Added light alone, as the
half pipe was, went white wherever sheets piled up.

**Its movement.** The shapes drift on the ground mist's wind, 2.2 times as fast
(`WAY_WIND_SCALE`), the small shapes another way from the large and carried by them
(`WAY_CURL`), so they curl and change and never only slide; and the banks' tops heave by up to
three tenths of their height (`WAY_HEAVE`) on two crossed waves, a turn every 7 s and every
11 s. A veil and a fin are built 1.3 times as high as their mist stands at rest (`WAY_HEAD`)
and the shader holds the mist under that head, so a bank never shows a cut edge along its top. Near the eye the shapes smooth out and the mist thins, so it hangs round a runner and
does not rush past.

**The dark round it.** While the light is up the rest of the frame is dimmed to half
(`WAY_DIM`) through the frame's exposure, beside the stare's dimming: the lighting's on the tiers
with no post chain, the grade's on the others. The way's mist itself is exempt.

**The mist.** Where the tier has ground mist, its map of "how far off the trail" is built over
the way instead while the light is up: thin from the line to where the way's banks begin, whole
past them (`wayDistanceWithin`: only the cells near a place are asked). The way's own mist stands
where the ground mist is thinned.

**When.** The level (`wayLevelFor`) rises over two seconds from the summit scene's threshold,
the shot in which the player turns to run, holds through the chase, a death and the return to
the crest, and falls once the match is decided. The console's `way on` and `way off` hold it.

**What is reported.** Each page sends one `way` telemetry event as its way settles: its length,
its straight line, and whether it is the fallback.

## 4. The ranger's lines

The chase's lines speak of the light: at the start "Down. Follow the light. NOW."; off the way
"The light. Stay in the light." / "Not through there. Back!" / "I'm out of the light. Go back.
Now!"; after dying off it "Right. The light. Stay in the light." / "Out of the light is where it
keeps them. Noted." The four recordings of the old words are gone; those lines are captions
until they are made again.

## 5. Tests

- `test/sim/wayDown.test.ts`, `wayDraw.test.ts`, `wayWorld.test.ts`: the geometry; the target;
  on a real world the ends, the length, the shape, the ground under every point, the same way
  whole or sliced, the fallback; the world's draw, its budget and the chase's first tick.
- `test/sim/chaseLine.test.ts`, `hollowWay.test.ts`: the rim and the floor, the cause, the
  haunt's pressure and its shades' stand, a Hollow's descent of the way.
- `test/sim/waySweep.part1..10.test.ts`: on fifty worlds the way is drawn and keeps its rules
  (a way gone round a lake may run a quarter over its target), and the chase is run as a
  first-timer meets it: the find from the stem, the scene and its threshold's run down the way,
  then a runner who sprints with real input, turning only for what is in the way
  (`helpers/wayRunner.ts`), the crest's Hollow hunting behind. The runner reaches the road
  without stalling or leaving the channel, and the Hollow never comes within 3 m.
- `test/sim/summitRun.test.ts`: one whole match on one world, the climb included.
- `test/game/wayLightGeometry.test.ts`, `wayLight.test.ts`, `wayShow.test.ts`: the mist's
  sheets, veils and fins, that it never folds at a kink, its colour, drift and heave, the mesh and
  its material, the level, the dim on both colour paths, the
  mist's map, and the renderer's and the app's wiring.
