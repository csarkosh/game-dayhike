# The summit scene

**Status:** Built 2026-10-08. Amended the same day: the mechanics held through the scene, the
`summit` command for a look, and the one camera move replaced by the five shots.

## 0. What this is

The find, in the game itself: the world is loaded and drawn by the time anyone reaches the
crest, so the scene that introduces the chase is the game's own camera over the game's own
Hollow, not a film (the intro is a film because its world is not built yet). For
`SUMMIT_SCENE_S` (21 s, the sum of the shots below, which `SUMMIT_REVEAL_S` matches) from the
frame the phase flips, on every screen, the controls are stilled (no move, no press, the look
held), the frame is letterboxed to the film's 2.39:1 (the HUD's bars; the roster leaves) and the
camera is the scene's, cut to cut. The inner voice is the scene's too: a line up or on its way at
the flip is cut, and only the scene's own (the find's, the Hollow's) come through it.

### The shots (`game/cutscene.ts`, `SHOTS`, `summitShot`)

Five shots, each one of the jobs an opening does (the research behind the intro: place, person,
problem, the wrong note, the threshold), hard cuts between them, one slow move within each, a
film lens on all but the last (`LENS_24` 0.57, `LENS_32` 0.43 and `LENS_50` 0.28 rad vertical;
the game's own is 1.4). The summit at night has no light but the sky and the local player's own
headlamp, worn on the body the scene shows (on for the scene's length, whatever its switch; the
lamp on the lens is off, since a third-person shot lit from its lens is lit from nowhere), so
every shot frames its subject against the sky.

| Shot | Seconds | Lens | Camera | What it says |
| --- | --- | --- | --- | --- |
| 1. The arrival | 0 to 4 | 24 mm | Over the party's shoulder, no face, 0.6 m over their eye and 2.4 m back, pushing 0.9 m up the last of the trail; aimed 1.6 m up the stake ahead, which crosses the frame, what is on it cut off at the top, unremarked | place, person |
| 2. The find | 4 to 8 | 32 mm | Locked off 2.4 m from the stake on the party's side, 0.5 m up, tilting from its foot to the hiker on it (`BODY_TOP_M` 3.6 m) against the sky; the inner voice's `body` line, shock, on every screen, held for this shot | problem |
| 3. The reveal | 8 to 13 | 24 mm | 1.6 m beside the stake, 1.3 m up (a camera on the ground had the ridge hiding the rise), panning in its first `REVEAL_PAN_S` (0.8 s) from the hiker to the bare ground 6 m past the stake, where the Hollow then comes up out of the mist in full view, the aim climbing with it to its head (`HOLLOW_HEAD_M` 4.5 m); the cry comes at 9.5 s (`REVEAL_SILENCE_S`), as it rises | the wrong note made whole |
| 4. The predator's view | 13 to 17 | 32 mm | High behind the Hollow's shoulder, 5.2 m up, 4.5 m back and 1.8 m to the side, pushing in 1.2 m; aimed down at the party, small beyond the stake in the mist; the inner voice's `hollow` line, terror, lands here (the scene's cry is the reveal's and gets no cry line) | why to run |
| 5. The threshold | 17 to 21 | the game's | The player's own eye, live: for `SCENE_LOOK_S` (1.2 s) held on the Hollow as it takes its first steps toward them (`HOLLOW_STEP_S`, `HOLLOW_STALK_SPEED` 1.5 m/s, `sim/hollow.ts`); over `SCENE_TURN_S` (1 s) the eye turns to the way down the trail (`DOWN_TRAIL_M` 8 m back down the stem, `app.ts`); then the legs, a sprint down it, the controls theirs as it ends with the look kept (`input.setLook`) and the `chaseStart` line saying so | the handoff |

The Hollow waits `SUMMIT_RISE_DELAY_S` (8.8 s, `entityViews.ts`; `SUMMIT_RISE_AT_S` in `cutscene.ts`
is the same beat) before its rise, so the arrival and the find see the stake alone and the reveal's
camera is on its spot before it moves; it rises as the shades do, in the shadow form with its dulled eyes,
facing the finder, still. The lamp flickers through the scene as the stare fills it, which is
the game's own language.

### The mechanics through it

The Hollow steps out `SUMMIT_SPAWN_DIST` past the body on the line from the finder through it:
its reveal timer is the scene's length, and the haunt's director waits while any Hollow is
stepping out. Every shade and lunge of the climb is cleared at the flip. The scene is a phase
of its own, `Phase.Scene` (`sim/types.ts`), between the climb and the chase, on the phase byte
already on the wire: the find sets it, and the Hollow's leaving its emergence sets `Chase`.
**Through it (`revealing`, `sim/hollow.ts`) nothing kills:** no contact, no strike; and the
stare closes only to `REVEAL_STARE_CAP` (0.25), at half its pace, so the vignette is minor and
its pulse slow. The cast turns and the woods hush as from the chase (the escalation and the
woods' voice read the scene as the chase begun); the haunt's chase rules, the cut and the end
rule, and the inner voice's chase lines, wait for `Chase`. The dark and the kill return the tick
the scene ends: the Hollow hunts, and the guide shades stand beside the way down.

## 1. The party (`sim/summit.ts`, `gatherParty`)

The find is the party's: at the flip every other living player, wherever they were, is brought
to the finder's side as if they had all come up together, in a file down the stem behind the
finder (`GATHER_STEP_M` 2.2 m apart, `GATHER_SIDE_M` 0.9 m off the stem's line, alternating
sides), turned as the finder is (at the body; the sim has no trig to face them itself), still. In
id order, so every peer agrees; the snapshot carries the
positions, and a client that was elsewhere sees its own camera arrive there. A dead player lies
where they fell.

## 2. Where it lives

- `game/cutscene.ts`: `SHOTS`, `shotAt(t)` and `summitShot(t, ctx)`, the camera and lens by
  the seconds since the flip from the eye at the flip, the body, the Hollow's feet and the
  party's eye; Babylon-free. (`summitPose`, the first scene's one move, stays for the cap's.)
- `game/renderer.ts`: `setScene("summit", body, { hollow, party })`; the shot over the player's
  camera, as the ending's is, its lens on the camera, for `SUMMIT_SCENE_S`; the local body shown
  (`views.showLocal`) through all but the last shot, the lens's lamp off meanwhile.
- `game/entityViews.ts`: the local body drawn and its lamp lit while `showLocal`; the summit
  Hollow's rise held `SUMMIT_RISE_DELAY_S`.
- `game/hud.ts`: `setBars(on)`, the letterbox, the roster hidden under it.
- `app.ts`: the flip seen in `syncAtmosphere` (the phase in the snapshot), `setScene` with the
  Hollow and the party, the bars, the controls stilled (`stilled`), then the threshold's look, turn and run
  through the same; the `body` line held for the find, the voice's `chase` held until the scene ends.
- `sim/hollow.ts`: `SUMMIT_REVEAL_S` 21, the reveal the scene's length; `HOLLOW_STEP_S`, `HOLLOW_STALK_SPEED`, its steps through the threshold. `sim/haunt.ts`: the
  director waits while a Hollow is stepping out. `game/woodsVoice.ts`: `REVEAL_SILENCE_S` 9.5,
  the cry in the reveal shot.

## 3. A look at it

The console's `summit` (host only; not persisted): the host's own player stands at the body
and the next tick is the find, so the scene plays as it will. A client is told it is the host's
to call.

## 4. Tests

`test/game/cutscene.test.ts` (the five shots: their seconds the reveal's, the look's
conventions, each shot's lens and move, the last the eye), `test/game/entityViews.test.ts` (the
local body and its lamp in a scene),
`test/sim/summit.test.ts` (the party gathered, the dead left; the shades cleared, nothing
killing and the stare capped through the reveal, the kill back after), `test/sim/haunt.test.ts` (the
director's wait), and the summit and hollow suites on the reveal's new length.
