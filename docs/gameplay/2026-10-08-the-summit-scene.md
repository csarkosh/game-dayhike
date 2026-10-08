# The summit scene

**Status:** Built 2026-10-08. Amended the same day: the mechanics held through the scene, and
the `summit` command for a look.

## 0. What this is

The find, in the game itself: the world is loaded and drawn by the time anyone reaches the
crest, so the scene that introduces the chase is the game's own camera over the game's own
Hollow, not a film (the intro is a film because its world is not built yet). For
`SUMMIT_REVEAL_S` (12 s) from the frame the phase flips, on every screen:

1. **Arrival** (0 to 2.5 s). The controls are stilled (no move, no press, the look held) and the
   camera comes down and in from the player's eye to `SCENE_STAND_M` (2.6 m) from the body, at
   `SCENE_EYE_HEIGHT` (0.9 m) over it, looking down at it (`SCENE_PITCH`), eased out; the woods'
   voice falls silent (the reveal's hush, `woodsVoice.ts`).
2. **The find** (from 2 s). The inner voice's `body` line, urgent, on the finder's screen and on
   any screen within 4 m of the body, which after the gathering is every living player's.
3. **Behind it** (from the flip). The Hollow steps out `SUMMIT_SPAWN_DIST` past the body on the
   line from the finder through it, and comes up out of the ground as the shades do (the rise,
   `entityViews.ts`), in the shadow form with its dulled eyes, facing the finder, still: its
   reveal timer is the scene's length, and the haunt's director waits while any Hollow is
   stepping out. Every shade and lunge of the climb is cleared at the flip. The scene is a
   phase of its own, `Phase.Scene` (`sim/types.ts`), between the climb and the chase, on the
   phase byte already on the wire: the find sets it, and the Hollow's leaving its emergence sets
   `Chase`. **Through it (`revealing`, `sim/hollow.ts`) nothing kills:** no contact, no strike;
   and the stare closes only to `REVEAL_STARE_CAP` (0.25), at half its pace, so the vignette is
   minor and its pulse slow. The cast turns and the woods hush as from the chase (the escalation
   and the woods' voice read the scene as the chase begun); the haunt's chase rules, the cut
   and the end rule, and the inner voice's chase lines, wait for `Chase`. The dark and the kill
   return the tick the scene ends.
4. **The cry** (the woods' voice's reveal call, after its hush), close.
5. **The turn** (9 to 12 s). The camera eases back to the player's eye as the chase's cast comes
   in (`escalation.ts`), and the controls return.
6. **Release** (12 s). The Hollow hunts; the inner voice's `chaseStart` line (held until the
   scene ends: the voice reads the chase as begun only then); the guide shades stand beside the
   way down.

## 1. The party (`sim/summit.ts`, `gatherParty`)

The find is the party's: at the flip every other living player, wherever they were, is brought
to the finder's side as if they had all come up together, in a file down the stem behind the
finder (`GATHER_STEP_M` 2.2 m apart, `GATHER_SIDE_M` 0.9 m off the stem's line, alternating
sides), turned as the finder is (at the body; the sim has no trig to face them itself), still. In
id order, so every peer agrees; the snapshot carries the
positions, and a client that was elsewhere sees its own camera arrive there. A dead player lies
where they fell.

## 2. Where it lives

- `game/cutscene.ts`: `summitPose(t, base, body)`, the camera's pose by the seconds since the
  flip, the eye at the flip and the body; Babylon-free.
- `game/renderer.ts`: `setScene(body)`; the pose over the player's camera, as the ending's is,
  for `SUMMIT_REVEAL_S`.
- `app.ts`: the flip seen in `syncAtmosphere` (the phase in the snapshot), `setScene`, the
  controls stilled (`stilled`), the voice's `chase` held until the scene ends.
- `sim/hollow.ts`: `SUMMIT_REVEAL_S` 12, the reveal the scene's length. `sim/haunt.ts`: the
  director waits while a Hollow is stepping out.

## 3. A look at it

The console's `summit` (host only; not persisted): the host's own player stands at the body
and the next tick is the find, so the scene plays as it will. A client is told it is the host's
to call.

## 4. Tests

`test/game/cutscene.test.ts` (the stand, the way in, the hold, the way back inside the reveal),
`test/sim/summit.test.ts` (the party gathered, the dead left; the shades cleared, nothing
killing and the stare capped through the reveal, the kill back after), `test/sim/haunt.test.ts` (the
director's wait), and the summit and hollow suites on the reveal's new length.
