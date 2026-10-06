# The chase's cast

**Date:** 2026-10-06
**Status:** Built 2026-10-06.
**Parent:** [`2026-10-05-three-acts.md`](2026-10-05-three-acts.md) (the night the chase runs in) and
[`2026-09-16-the-summit.md`](2026-09-16-the-summit.md) §5 (the chase).

## 0. What this is

The chase looked like the end of the climb: the same night, the same rain. Two things now say
that everything has changed.

**The cast.** From the moment the body is found, the whole frame is pulled toward burgundy:
the sky, the rain, the ground and the trees alike, since it is the grade's last colour step
before the stare's darkness. It comes in over 25 s and never goes back. The night stays night:
the cast multiplies each channel (red up a tenth, green down a quarter, blue down a sixth) and
adds almost nothing, so nothing gets brighter.

**The pulse.** A low thump on every beat and a dry tick between, at 104 beats a minute with
nothing near and 132 with the Hollow at the ear, under a drone of three rough low tones whose
low-pass opens from 320 Hz to 1.8 kHz as it closes. It comes in with the cast and does not stop
until the match does. It plays beside the world's bus, so no hush and no stare takes it.

Thunder and lightning are a later piece on the same night.

## 1. Where it lives

- `game/escalation.ts`: `EscalationState.chase`, lagged toward 1 from the flip with
  `CHASE_EASE_S` (25 s), held for the dead, never lowered.
- `game/gradeParams.ts`: the record's `chase`; `CHASE_TINT` (1.1, 0.72, 0.84) and `CHASE_LIFT`
  (0.014, 0, 0.005); `shaders/grade.fragment.fx` mixes toward `c · tint + lift` by it, after the
  lift and before the vignette. On the material path, Babylon's shadow curve turns to hue 345
  and deepens by 35.
- `game/post.ts`, `game/renderer.ts` (`setChase`): the cast to the pass.
- `game/chaseAudio.ts`, `game/ambientAudio.ts` (`setChase`): the pulse, scheduled a quarter
  second ahead on the context's clock, the tempo read afresh at every beat; `near` is the local
  lens (the Hollow's nearness, or being far off the trail).
- `app.ts`: both set every frame beside the escalation, ahead of the weather's gate.

## 2. Tests

`test/game/escalation.test.ts` (the cast's ease, held for the dead, never back),
`test/game/gradeParams.test.ts` (the record's cast and the tint's shape), `test/game/post.test.ts`
(the material path's shadows), `test/game/ambientAudio.test.ts` (the bus beside the world, the
beats by turns at the far tempo, the near tempo and the drone opening).
