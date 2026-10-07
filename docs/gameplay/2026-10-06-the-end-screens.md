# The end screens

**Date:** 2026-10-06
**Status:** Built 2026-10-06. Amended the same day: the panel of names is gone, the line is the
end, and the pages switch behind a veil (§3).
**Parent:** [`2026-09-16-the-summit.md`](2026-09-16-the-summit.md) §2 (the end and the death) and the
title's line in `game/landing.ts`, whose shape the two lines here take: three parts, and a turn
(the win's of ten words, the title's count). The counting is the title's alone; neither line
speaks of it.

## 0. What this is

*Amended 2026-10-07.* Each end has a title over its line, in the title screen's voice (the
landing's heading: monospace, uppercase, spaced): YOU LIVED and YOU DIED (`WON_TITLE`,
`DEATH_TITLE` in `passages.ts`; `hud.setEnding`).

A player's death was a fade to dark with a line over it, and the end of a match was the panel
of names at once. Both are staged now, each in the camera.

**Won, and alive to see it.** The camera lifts from where the player stands to the sky, fast at
first and slowing, over 5 s; from 0.8 s the picture softens over 3.5 s; the line is up
throughout: "The night, outlasted; the car, at last; and in the mirror, a shadow, where no one
sat." At 7 s the view goes dark under the line, and the landing comes at 10 s. A player
who is dead when the match is won stays under their own last line. There is no panel of names
(there was one, as first built; it read as a text box over the end).

**Died.** The body goes down on its back: over 1.3 s, slowly and then all at once, the eye drops
to 22 cm off the ground, the look turns to near straight up and the head settles a little over.
From 1 s the dark closes over 3 s, the stare's own darkness driven to full, and the view's fade
finishes the black at 3.5 s. The line sits on top throughout, the searcher become one of the
searched-for: "The light guttering; their name, unanswered; and the help, cold beneath the leaves,
sought nevermore." The landing comes at 8 s.

## 1. Where it lives

- `game/ending.ts`: `endingPose(kind, seconds, base)`, a pure function of the seconds since the
  end began and the pose the camera had then (the eye, the look, the feet's height), giving the
  eye, the look, the roll, the blur and the closing. The eases: cubic out for the lift, quadratic
  in for the fall.
- `game/renderer.ts`: `setEnding(kind)`, once; from its first frame the camera is the ending's,
  the base taken then. The closing rides the stare's shade (the lens's level driven up), so it
  closes from the Hollow's side if there was one, and the material path has it too.
- `game/post.ts`: two blur passes ahead of the finish, attached while there is any blur, their
  kernel by it (`END_BLUR_KERNEL`, 28 texels at full).
- `game/passages.ts`: `WON_LINE`, `DEATH_LINE`, `WON_PANEL_AFTER_MS` (6 s), `DEATH_FADE_AFTER_MS`
  (3.5 s).
- `app.ts`: death sets the ending and the line and schedules the fade; the end, won and alive,
  sets the ending and the line and schedules the panel; otherwise the panel at once.

## 2. The veil (`game/veil.ts`, `main.ts`)

The title and the game used to swap in one frame. A black sheet over the whole page now comes
down over `VEIL_COVER_MS` (0.6 s) before any change of page (the title, the game, a scene),
the page is swapped under it, and it lifts over `VEIL_LIFT_MS` (1.6 s) a quarter second after
the new page is up. It takes no input. The intro's film carries the title into the game on its
own and goes without.

## 3. Tests

`test/game/ending.test.ts`: the eases; the win's lift from the given pose, its end and its
softening; the death's fall, its end, its roll and its closing. The browser pass is the camera
and the lines as they play.
