# The way down

**Date:** 2026-11-13
**Status:** Built: the path, the rules that hold a player to it, its light, the crowd of
shades beside it, the lunges that step out of it into the path, and the ranger's lines. The
whispers are a later piece.
**Parents:** `2026-09-16-the-summit.md` (§5, the chase, whose guide and fork cuts this replaces),
`2026-10-06-the-haunt.md` (§3, §3b), `2026-10-07-the-inner-voice.md`, `2026-10-08-the-summit-scene.md`
(the threshold, where the light comes up), `2026-10-06-the-mist-shades.md` (the ground mist).

## 0. What this is

In the chase there is one way home and the player can see it. From the crest to the pad runs a
drawn path, nearly straight, its bends long and soft, that leaves the trail wherever that is
shorter. It is shown by the ground mist alone: thin and low on a path 12 m wide, thickening over
metres into the mist that fills the woods either side, never still, and everything outside it
about half as bright. Nothing else marks its edge. The player may still go anywhere; the mist,
the dark, and what the chase does to a player off the way are what keep them on the path.

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

**Its length.** `wayTarget(straight)`: a fiftieth over the straight line from its start to the
pad (`WAY_RATIO`, 1.02). Straight lines run from a few hundred metres to over a kilometre, so a
clean run is from under a minute to two and a half at the sprint's 7 m/s. What stands across
the line (a lake, a cliff band, the crest itself where the party stands on its far side) is
gone round, and that is length the aim did not ask for: on seven worlds measured, five ways are
within 8 % of their line, one is 13 % over and one 30 %; of the sweep's fifty the longest is
42 % over, where the party stands on the crest's far side with steep ground between them and
the pad, and its first 160 m take it 87 m further from the pad.

**Its shape.** Soft. The way turns only as far as its ground makes it: over any 14 m of it (a
sprint's two seconds) its heading turns by no more than 110 degrees, and by more than a gentle
bend's 15 degrees over no more than three tenths of its length (measured on seven worlds: the
sharpest 40 to 78 degrees, where a fallen trunk or a rock band holds the line, 6 to 16 % past
gentle; and on two of the sweep's fifty a rounded S of 100 and 104 degrees round the end of a
fallen trunk that lies across the way, 20 and 24 % past gentle). The
distance to the pad never grows by more than about 10 m before it falls again
(`WAY_BACK_MAX_M`), and no two stretches come within 25 m (`WAY_APART_M`); heading back is
measured past the way's first 160 m, which may be going round the crest.

Until 2026-11-19 the way wound to a length of its own (840 m, or twice a short line) on waves of
100 to 220 m, and any stretch that ran straight for 46 m was bent by walling the ground at its
middle. It read as a zigzag, with square corners where it went round a wall.

**How it is drawn** (`drawWay`, a generator):

1. A meander about the straight line: parabola arches to alternate sides, a little less at the
   ends, a whole wave every 320 m (`WAY_WAVE_M`), their amplitude found by bisection so the
   meander is the target's length: some 14 m to either side, on a radius of about 200 m.
2. A search (A*) over a grid of 3 m cells in the line's own axes for the cheapest line from the
   start's cell to the pad's. A cell is priced the first time it is touched: refused on the
   crest's ground above, in a lake (or within 3 m of its shore), under the sea's level, or on
   ground steeper than a player can stand on with a margin; dearer by a quarter for each metre it
   is off the meander or the nearest of its copies, which lie 80 m apart; a twentieth cheaper
   where the trail passes. The trail's own cells are never refused for slope.
3. Along the line found, and only there: anything a runner could not step over (a trunk, a
   fallen one, a rock, a cliff) walls its cell, and with it every cell joined to it in which
   something stands too (up to 96 a round: a fallen trunk lies across a dozen cells, and gone
   round a cell a round it used the rounds up and the line was left through it), and the
   search goes again, up to 24 rounds; the last round's line stands with whatever is still on
   it, a trunk to run round.
4. The line is pulled taut: from each of its points it runs straight to the furthest of the
   next fourteen (some 40 m) it can reach over clear ground, which takes out the search's steps
   and its weaving between trunks. Clear is asked by squares of half a metre: in no cell the
   ground rules out, where a player stands with slope to spare, and with nothing they could not
   step over within 0.4 m of them.
5. It is eased: 150 times each point moves half way to the middle of its two neighbours,
   wherever that place is clear, which leaves no corner shorter than some 80 m; then 150 more,
   each followed by a step back out, which holds the long shapes where they are and lets the
   points either side of a corner that something pins swing wide of it.
6. Each of the eased line's own points is checked as a player would stand on it: one on ground
   they would slide on, or where something stands, walls its cell and its squares, and the
   search goes again.
7. A length that misses the target by a twentieth corrects the amplitude and the whole goes
   again, up to three rounds.
8. Where nothing gets through the ground searched, the search widens (40, 160, 400 m past the
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
`chaseLineDistance`. The way is wider than the trail was, so 4 m (`WAY_SLACK_M`) is taken off
the distance from the line: 8 m out (`WAY_RIM_M`), 2 m into the thick mist beside the path,
reads as the trail's 4 m edge, and every threshold keeps its meaning. (The rim was 5.5 m out
until 2026-11-19, when the path was widened.) Before the find, and on any level with no way,
it is the trail's distance as before. The place the party stood at the find, and 15 m round
it (`CREST_GRACE_M`), is on the line whatever the way's distance: a player caught there, or just
returned there, did not leave the way.

- **The death's cause** (`deathCause.ts`): off the way is the "off the trail" cause.
- **The haunt** (`haunt.ts`): a player off the way is pressed as one off the trail was, and its
  shades stand 15 to 20 m off the way.
- **The lens and the ranger's warning** (`escalation.ts`, `app.ts`): measured off the way.
- **The threshold's turn** (`app.ts` `wayDownFrom`): the eye turns to the way's point 10 m on.
- **A hunting Hollow** (`hollow.ts` `pursue`): comes down the way itself, toward its player's
  place along it, walking to places that stand 4 m apart on the line (`WAY_AIM_STEP_M`: the next
  but one from its own, 4 to 8 m on), and turns straight for them when it is within 12 m of them
  along the way (`WAY_LEAD_M`) or near them in plain sight. At 6.3 m/s it loses ground to a
  sprint and gains on a walk, as before. (It walked to a point always 12 m ahead of itself
  until 2026-11-19: on a straight stretch a point that kept its distance read as no progress,
  and the chord cut across what a bend goes round.)

A Hollow that steps out to a place and then hunts (`spawnHollowStepping`, once the forks'
Hollow) is kept for what will step into the way.

**What stands in the path** (`haunt.ts`, the way's lungers). The crowd beside the way (§3a) is
dressing: it lunges at a runner and never lands, and a player who learns that stops fearing
it. So some of what lunges is real. All the way down, a lunge stands up beside the path ahead
of whoever leads each group of runners (players within 60 m of one ahead of them are that
one's group): 40 to 60 m down the way from them, 7 to 8 m from its line, in the thick mist at
the path's edge among the crowd, on a drawn side, 40 to 70 m of way on from the one before
(1.6 times that at the way's start, easing to once by three tenths of it), never within 40 m
of one that stands already whoever it stands for (a runner who takes the lead is not given one
beside the last leader's), and none in the
way's first 110 m, a quarter of a minute's sprint. It waits there. When its player is within
24 m of it down the way, over three seconds of sprint, it lunges onto the path as the crowd's
do, at 8 m/s, straight out from where it waited to a metre short of the way's line, and stands
there. Whoever comes within 2 m of it, it has: its strike lands at once. It never crosses the
line and it follows nobody; six seconds after it is loosed, or once its player is 8 m past
it, it is gone. So the middle of the path and a strip of its own half are death, and the far
half, from a metre off the line, is safe however the meeting is timed: a clean run reads the
red eyes in the mist ahead and goes round each one on the side it did not come from, and no
two are met within five seconds of each other. The episode's own lunge, which walks in from
15 to 20 m off the line at 4 m/s, is not raised on the way: what answers a player who leaves
the way is as it was.

**Leaving it is answered where the player is.** A shade or a lunge stands 15 to 20 m off the
line, and while the line was the trail there was always trail near enough for one to stand
beside. The way is the only line: a player 25 m and more off it, looking away, had nowhere in
view for anything to stand, and met nothing until the crest's Hollow reached them a minute and
a half later. On the way, the place a shade is tried at round the player's own look may stand as
much further off the line as the player has gone (`placeShadeOffTrail`), never nearer it than
15 m, so nothing of it stands on the path; and off the line every shade is a lunge, as
before. The chase's first episode also comes at once: the rest it began under (up to half a
minute late in a climb, a minute and more for a find that came early) is cut to the chase's own
2 s as the chase begins (`summit.ts`).

## 3. The light (`game/wayLightGeometry.ts`, `game/wayLight.ts`, `game/lite/wayLightMeshes.ts`, `game/wayHaze.ts`, `game/wayLevel.ts`)

**The shape.** Taller ground mist, not a wall, and its thickness is all that marks the path's
edge. Across the way the mist is thin on the path (`WAY_PATH_SHARE`, 0.3 of the banks',
standing to 1.3 m; 0.55 and 1.7 m until the owner asked for it lighter on the path floor),
within 2.5 m of the line, and thickens to whole by 6 m from it (`WAY_EDGE_M`, `WAY_FLOOR_M`):
a path 12 m across, its edge a rise in the mist over three and a half metres. The banks stand
2.3 to 3.5 m and taller and shorter as they go, and this mesh's own mist goes out between 7 m
and 10.5 m, where the mist beyond takes over. Under it the ground glows faintly on the path
alone. (Until 2026-11-19 the path was 6 m across, the mist filling between 1 m and 3.1 m, with
a band of glow on the ground under each bank and the banks lit brighter: the path's edges were
two pale lines.) Every vertex stands on the ground the players stand on (the
simulation's field, the walkable rock's rise with it), which the app gives the renderer with the
way. (Until 2026-11-14 the way was a half pipe: a lit floor and a wall curving up a quarter
circle from either edge. It read as a literal wall.)

**How it is drawn.** As sheets that all read one field of noise in the world, the ground mist's
own map (`cloudNoiseMap`), so together they look like a volume: seven sheets that follow the
ground across the whole width (`WAY_SHEETS_M`, to 1.6 m over it, a vertex every 1.5 m to 10.5 m
either side), the mist a plant on the path stands in; three veils a side along the way (`WAY_VEILS`), each wandering in and out; and a fin
a side across the way at every point, which is what an eye looking down the way sees, where the
veils are edge on. A fin fades as it turns edge on to the eye, and a sheet as the eye looks along
it, judged from the face itself so a sheet on a slope is judged by its own lie. The way across at
a point is taken over six points either side of it (`WAY_ACROSS_POINTS`): where the way goes
round something it may turn hard, and a way across taken at the point alone folds the mist over
itself inside the turn. One
material of its own (`wayLight`), a mesh every 64 m of way, built a chunk a slice, 23 of the
ground's heights a point. No other material's shader knows of it, so it costs geometry and its
own pixels rather than work on every lit pixel, on every tier. Its stages are WGSL
(`shaders/wayLight/`), a vertex's four numbers ride in its mesh's colour, and a mesh of no size
wears the material from the renderer's start, so the pipeline every stretch draws with is made
while the hike loads and not as the chase begins. Among the frame's see-through draws the
chase's own stand between the valley's mist banks and the rain: the crowd's bodies, this mist,
the mist beyond its banks, then the crowd's eyes.

**Its colour.** The ground mist's own (`cloudColourUnder` of the air's near colour, which every
tier has), a quarter of the way toward a cold tint and lit to 5.5 times it before the tone map
(`WAY_POST_LIFT`; 8.5 times in the frame's own terms on the low tier, `WAY_MATERIAL_LIFT`), so it
belongs to the night it stands in: paler than the dark round it, never a lit band (8 and 14
until 2026-11-19). The blend is premultiplied:
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

**The mist beyond the banks** (`wayMistFieldGeometry.ts`, `wayMistField.ts`,
`lite/wayFieldMesh.ts`). On the tiers with no marched ground mist (the tiers with no post chain:
phones) the way's banks stood alone in dark woods.
There the mist goes on past them over all the ground round the eye, thicker than the banks
themselves (a sheet's strength 0.8 and a fin's 0.6, against the banks' 0.28 and 0.21), so the
way is the thinner, darker lane through it. It is one mesh: a square of 25 by 25 cells of 3 m
round the eye, moved a cell at a time so every vertex is a place in the world, with three sheets
that follow the ground and a fin standing on every second line of the lattice both ways, about
3 m tall and wandering off its line. It reads the way's own noise and moves with it. It comes
in from 7 m to 10.5 m off the way's line, exactly where the way's own mist goes out, so no band
between them is twice as thick, and fades out from 22 m to 34 m from the eye. The ground under it is asked for forty cells a frame, the nearest the eye first,
and kept by the cell's place in the world, so a step asks for one new row. The tiers that march
the night's ground mist have that beyond the banks already.

**The haze over it, on phones** (`wayHaze.ts`). The tiers that march the ground mist stand the
whole frame in it: trunks and crowd fall away into a soft mauve grey. The tiers with no post
chain had the mist on the ground and black woods over it. There the woods now stand in a haze of
the mist's own colour, by no pass and no mesh: every material on those tiers already draws the
air between the eye and itself, and while the way's mist is up that air is thickened
(`WAY_HAZE_DENSITY`: a trunk 40 m off keeps about three fifths of itself) and takes 0.82 of the
mist's colour (`WAY_HAZE_SHARE`), by the mist's level, so it comes and goes with the mist.

**The chase's red on the material path.** No pass grades the frame there, and the grade the
tier's other materials lay on themselves is not in a stage of the mist's kind, which writes its
colour as it is, so the mist takes the chase's cast itself: its colour times the cast's tint over the tint's own weight on a grey
(`wayCastOnMaterial`: for (0.9, 0.64, 0.7), about (1.29, 0.92, 1.0)), mixed in as the cast comes
in. The hue is the desktop's and the mist is as bright as it was.

**The dark round it.** While the light is up the rest of the frame is dimmed to half
(`WAY_DIM`) through the frame's exposure, beside the stare's dimming: the exposure every material
ends with on the tiers with no post chain, the grade's on the others. The way's mist itself is exempt.

**The mist.** Where the tier has ground mist, its map of "how far off the trail" is built over
the way instead while the light is up: thin within 2.5 m of the line, whole past 7 m
(`WAY_MIST_EDGE_M`, `WAY_MIST_FADE_M`; `wayDistanceWithin`: only the cells near a place are
asked). The way's own mist stands
where the ground mist is thinned.

**When.** The level (`wayLevelFor`) rises over two seconds from the summit scene's threshold,
the shot in which the player turns to run, holds through the chase, a death and the return to
the crest, and falls once the match is decided. The console's `way on` and `way off` hold it.

**The turn to it.** In the summit scene's last shot the player's eye is turned to the way and
their legs run them down it before the controls are theirs (`cutscene.ts` `thresholdLook`). The
way down from where they stand is asked for again every tick of that shot (`wayDownFrom`, 10 m
down the line), so the run follows the way as it bends and never the trail beside it. A find the
draw was not done by (a console's `summit`, a peer admitted late) gives the draw 10 ms a frame
while the scene's shots play (`WAY_DRAW_SCENE_MS`) and finishes it at that shot's cut. Until
2026-11-14 the look was taken once, at the find, and where the way was not yet drawn it was the
trail's.

**What is reported.** Each page sends one `way` telemetry event as its way settles: its length,
its straight line, and whether it is the fallback.

## 3a. The crowd (`game/crowdField.ts`, `sim/taken.ts`, `game/crowdKillers.ts`, `game/crowdEyes.ts`, `game/crowdCards.ts`, `game/lite/crowdEyeMeshes.ts`, `game/lite/crowdCardMeshes.ts`)

In the chase the woods beside the way are full of shades, and all of them are coming for the
player. Each screen makes and moves its own round its own player, from its own random stream.
The host knows none of them, nothing of them is on the wire, and two players side by side do
not see the same ones. **They are what a runner must not touch**: none of them comes the last
metres to a player, but a player who walks into one dies of it (below). What hunts is still the
host's (a Hollow, a shade's lunge: `2026-10-06-the-haunt.md`), told apart by its solid figure
and red eyes. (Until 2026-11-19 the crowd hurt nobody: once a player knew it, the owner found,
its numbers were no pressure at all.)

**How many, and where they rise.** Up to ninety a screen on every tier (`CROWD_MOST`; sixty
until 2026-11-19, which the owner found too few): a third
of that near the crest, all of it from three tenths of the way to eight, half by the road
(`crowdTarget`). The crowd is up from the summit scene's turn to the way through the chase
(`crowdOn`). A figure rises beside the way ahead of its player: to 85 m down it, on a drawn
side, a metre and more into the thick mist beyond the path's edge (7 m from the line,
`CROWD_EDGE_M`), seven in ten within 15 m of the edge and the rest out to 35 m, never within
4.5 m of another, on dry ground a figure can stand on with nothing
solid in it. Nothing rises in plain view inside the mist's reach (30 m): a figure rises out of
view, or far off in view as a pair of eyes opening. Round a player who has left the way they
rise 8 to 15 m from them on any bearing, and still clear of the path.

**Each figure** is the same for as long as it lives, from its own number (`figureOf`): its size
(a fifth small at 0.5 to 0.7 of a Hollow, one in seven large at 1.4 to 1.75, the rest 0.8 to
1.25), how bright its eyes are, their colour from pale to a dull ember (never the Hollow's red)
and the pace it stalks at (0.6 to 1.4 m/s).

**How they close** (`crowdSpeed`, `stepCrowd`). A figure runs in from far off and stalks the
last metres: its own pace at 3 m from its player, rising to 3.6 times that from 22 m and
further. Ahead of the player's place on the way it comes to the path's edge and waits there,
sliding along it toward them, so the mist either side of a runner is full of figures. **Then it
lunges**: two figures in three (`crowdLunges`, from a figure's own number) come onto the path
at the player once they are within 12 m of it down the way (`CROWD_LUNGE_M`), at 8 m/s, faster
than a sprint (7 m/s), from both sides, and fall in at their back as they pass. The rest hold
the edge. One the player has passed gives chase at up to 9 m/s: what follows settles where its
speed is the runner's, some 9 m behind a sprint (`CROWD_CHASE_M`), and closes on a player who
slows. (Until 2026-11-19 nothing came nearer a runner on the path than 8.5 m to the side and
16 m behind.) At a runner's back there are ten at the most (`CROWD_PACK`), the furthest going first,
so the rest of the crowd is ahead of them, where they look. No figure walks into another:
within 3 m of one it is turned aside, and directly behind one it waits.

**Where they stop.** No figure steps nearer its player than 3 m (`CROWD_KEEP_M`): there it
stands, and stays, so a runner passes among standing figures and one who stops is stood round.
(Until 2026-11-19 a figure that came within 3 m went, and nothing of the crowd could be walked
into.) And none steps into the ground right in front of its player: within 1.6 m of the line of
their look for 10 m along it (`CROWD_LANE_M`, `CROWD_LANE_AHEAD_M`) no figure moves in, and one
already there (the player turned to it) comes no nearer. So the way a player is looking and
going is always open, and whoever looks where they run and keeps straight on passes through the
crowd untouched, at a sprint or a walk, down the middle or off to a side, or after standing a
while. A player dies of the crowd only by turning into it.

**The touch** (`stepCrowd`, `sim/taken.ts`). A figure's arms open as its player comes within
2.4 m of it (`CROWD_REACH_FROM_M`), by how near they are, and shut as they go: one brushed past
at the lane's edge has them part open, so the touch is seen coming. A player who comes within
1 m of a figure (`CROWD_TOUCH_M`; one at least half risen, and not one that is going) is had by
it: it stands where it is with both arms out. The player's own screen is the only one that can
know, so it says so to the host in a bit of its commands' buttons (`Button.Taken`) until it
sees the death, and the host makes the death where every death is made: on the tick it hears
it, for a living player in the chase who is not on the road, not in the hold after a return and
not in a decided match. It is a death of the chase like any other (they fall where they stood
and come back on the crest), and its cause is walking into what killed them (`DeathCause.Into`)
or, past the path's edge, leaving the path. The host takes a player's word for their own death
and for nothing else. The figure holds its reach over them until they are back, then goes; one
the host did not give it it lets go after 2 s. Nothing is had while a scene has the player's
legs (the return's run down the way), nor for the four seconds of the host's hold after a
return, and a living player who cannot be had (on the road) is let go of at once. **A return
scatters the crowd**: while a player lies dead the crowd comes in and stands round them, on the
path, and more stand down the way where they ran; left there, a death near the crest was run
back into on every return. So on a return every figure goes, and the woods fill again by the
crowd's own rules.

**How they go.** A figure goes when it is
left 30 m behind, is too far down the way, or, round a player off the way, is over 25 m from
them: at once where it is out of view, over 2.6 s where it is in it. It comes in over 2.4 s.

**What kills is one of the shadows** (`crowdKillers.ts`). While the crowd is up, in the chase,
everything that can kill (the Hollow that hunts, a lunge, a strike) is drawn as the crowd is
drawn, a dark figure that glides, and not as the model that walks: the owner liked how the
shadows move and not how the monster did. A killer's figure stands where its body is each
frame, 1.15 times a Hollow's size, first among what is drawn so a full crowd never leaves it
out. Two things tell it from the crowd: its eyes are the Hollow's red, twice as bright and 1.7
times as large as a figure's of the crowd, where the crowd's are never red; and its body is
solid where theirs are veils. Its arms are out as its body's are: in a lunge's last metres and
in its strike. The summit scene's Hollow steps out as the model, as before, and
is a shadow from the moment the chase begins, when the player has turned to run.

**The crowd and what kills.** When a killer first appears in the state while the crowd is up,
the nearest living figure within 12 m of it begins to go as the killer comes in (`crowdGives`),
so one of the crowd is seen to turn. A shade or a lunge gone from the state leaves a figure
where it stood (`crowdTakes`), unless that is on the path, on its clear ground or on ground
that refuses a figure. On the way down the haunt raises no shade that only stands, the crowd
being those, and a standing shade does not close the dark (`2026-10-06-the-haunt.md` §3c).

**What is drawn.** A figure's eyes are two small additive quads (`crowdEyes.ts`), seen through
the mist at any distance and dimming from 40 to 120 m, so the eyes far down the way are what
make the crowd deep. Inside 36 m its body is a card facing the eye (`crowdCards.ts`): an
antlered figure drawn in the fragment stage, written into the shades' mask
(`lite/shadeMask.ts`, whose pass draws the cards' mesh with a material of the cards' own in place
of the one it wears) as a darkness in the mist, and into the frame as a dark body with a
faint rim the mist lights, so it shows against black woods as well as pale mist. One that
reaches opens both arms wide at an eye's height, a hand at the end of each, on a card as wide
again, with a brighter rim and its eyes twice as bright (arms raised over its head were out of
a near player's view). Both are one
mesh each, rewritten every frame. The ground under a figure is asked for a few figures a frame
and again only once one has moved a metre (`crowdHeights`), and whether the ground admits a
figure's step is asked one step in eight.

**The console.** `crowd on`, `crowd off` and `crowd <count>` hold this screen's crowd for a
look.

## 3b. The chase's dark (`game/stareLens.ts`, `game/chaseThreat.ts`)

Looking at a Hollow closes a darkness over the frame on a heartbeat (the stare,
`2026-10-05-the-stare.md`). On the way down that left a runner nothing to see by, so in the
chase the darkness is the chase's own (2026-11-19):

- **It is there the whole chase**, for a living player who is off the road in an undecided
  match: it comes in over a second or two as the chase begins and goes as it lets them go.
- **It never closes far.** At the top of a beat it is three tenths closed (`CHASE_REACH`),
  between beats a little over half of that (`CHASE_PULSE`), however long the player looks at
  what hunts them; and it is centred, where the stare's leans from the Hollow's side. A
  death's closing dark still takes the whole frame.
- **It beats faster with a shadow or a hunter at the centre of the view**: 48 beats a minute
  with nothing there, up to the heart's fastest (84, the most a screen may pulse at) with
  something whole there. What is at the centre (`threatOf`) is the nearest of the screen's own
  crowd and the state's enemies to the middle of the player's look: whole within 6 degrees of
  it and 6 m, falling to nothing at 25 degrees and at 30 m. The beat quickens within half a
  second and slows over a few.
- **The stare itself is as it was**: its level still dims the frame a little and muffles the
  world when a player looks back at the Hollow. But a lunge that waits beside the way or
  stands in the path (§2) fills no stare, as the crowd's shades fill none: a runner has one in
  front of them most of the way down.

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
  without stalling or leaving the way, and the Hollow never comes within 3 m.
- `test/sim/summitRun.test.ts`: one whole match on one world, the climb included.
- `test/game/wayLightGeometry.test.ts`, `wayLight.test.ts`, `wayMistFieldGeometry.test.ts`,
  `wayMistField.test.ts`, `wayHaze.test.ts`, `wayShow.test.ts`: the mist's sheets, veils and fins, that it never
  folds at a kink, its colour, drift and heave, a stretch stood on the ground in slices, the
  field's cells round the eye, the level, the dim on both colour paths, the mist's map, and the
  renderer's and the app's wiring.
- `test/game/lite/wayLightMeshes.test.ts`, `wayFieldMesh.test.ts`, `crowdEyeMeshes.test.ts`,
  `crowdCardMeshes.test.ts`: each drawer's stages, its blend and its place among the draws, and
  the cards in the shades' mask.
- `test/game/crowdField.test.ts`, `crowdEyes.test.ts`, `crowdCards.test.ts`, `crowdShow.test.ts`:
  the crowd's numbers, where a figure may stand, a crowd stepped round a player who stands,
  runs and leaves the way, how it closes (the speed's shape, the pack and its cap, figures
  kept apart), the hand-over to and from what kills, and what is drawn and wired. And the
  touch: a player who walks into a figure is had by it, its arms opening as they near; nobody
  is had who cannot be, or by one rising or going; the reach held over a death and let go; the
  lane in front of a player kept open; four kinds of runner who keep straight on, on four
  crowds each, never touched; and one who turns into the crowd, had.
- `test/sim/taken.test.ts`: the host's side of the touch: the bit, the death and its cause, a
  return like any other, everywhere nothing kills, and that movement reads nothing of it.
- `test/game/stareLens.test.ts`, `chaseThreat.test.ts`: the chase's dark (there the whole
  chase, never closed far, its beat by what is at the centre of the view, centred, gone when
  the chase lets go, giving way to a death's dark) and the measure of what is at the centre.
- `test/sim/haunt.test.ts`, `hauntOffWay.test.ts`: on the way down no shade that only stands
  is raised and none closes the dark, and a player who leaves the way is still lunged at.
- `test/sim/waylay.test.ts`: the way's lungers' numbers; one standing up ahead of a player and
  waiting; its lunge onto the path, where it stands and when it goes; none in the way's first
  110 m or for a player off the way; that one in plain view fills no stare; and three whole runs down a real way: a runner who goes
  round each one on its far side reaches the road, one who holds the middle of the path is
  struck down, and so is one who keeps to each one's own side.
- `test/game/crowdKillers.test.ts`, and in `crowdEyes.test.ts`, `crowdCards.test.ts`,
  `entityPoses.test.ts`, `crowdShow.test.ts`: the killers' figures among the crowd, their red
  eyes and solid bodies, the pose that says a body is a shadow, and the wiring.
