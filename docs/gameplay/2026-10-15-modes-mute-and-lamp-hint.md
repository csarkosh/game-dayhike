# Modes, the page's mute, and the lamp's hint

**Design, 2026-10-15.** Three additions to how a hike is entered and read:
a mode setting with its command, `/mode game|explore|freecam`; one mute
button that stands on every page; and a HUD hint for the headlamp.

## 1. The modes

| Mode | The world | The sky and the voice |
|---|---|---|
| `game` | The hike as it is: the climb's three acts, the watcher, the haunt, the summit's find, the chase. | The escalation's. |
| `explore` | The same mountain with no one in it: the sim builds no watcher and no haunt, and the summit is never found (`sim/summit.ts` returns before the finder), so the climb never flips. The wall at the road (`sim/containment.ts`) comes down, so the road and the beach beyond it are open; the car keeps its own box. The trail, the car, the board and the headlamp stay. | The escalation's world, lens, chase and haunt are held at nothing. The day is the explore day's (§1.2). The woods' calls never come (the climb is read as zero), the night's odd sounds never start (the acts' night is read as zero, the sky's night comes with the hour), and the inner voice keeps the trailhead's line and its answers to the rain and the fog (`CALM_LINES`, `innerVoice.ts`). |
| `freecam` | Explore. | Explore, with the camera freed from the start (`/freecam`), unless the address names a `freecam` entry of its own. |

The mode is the world's: every peer must run the same one, so it is a
world entry of the address's script (`commands.ts`, `kind: "world"`),
resolved at the start as `seed` is and never dispatched. A follower goes
where the host is and takes the host's address with its script, so the
mode travels with the invite. The player's choice is kept in localStorage
(`gameMode.ts`, `dayhike.mode`) and read where the address names no mode;
a hike started on it writes `mode <x>` into its address, so an invite
copied from that page carries it too. Typed at the bar or picked on the
pause screen, a new mode re-initialises the hike through the path a typed
`/seed` takes: the pause screen's line says so.

### 1.1 The screen

Settings gains a second group, Mode, under Graphics: a native select in
the same look, with the chosen mode's line under it (`settings.ts`). On the
title screen a pick is kept; on the pause screen it is kept and applied at
once, which starts the hike over at its trailhead.

### 1.2 The explore day

`exploreDay.ts`: a clock round the twenty-four hours at forty seconds an hour,
a day in sixteen minutes, so the hike meets its nights and its dawns, and the
whole of the weather several times over. `/time` sets where it starts. The
weather is read off a schedule with a preset every hour and a half or two,
midnight to midnight (overcast, clear, mist, clear, bright, overcast, rain,
bright, clear, overcast, mist, rain, bright, clear, mist, overcast), and the
lerp between neighbours in between, so a rain comes in over an hour and a half
and goes out over the next, twice a day; the eerie preset is never on it, and
every preset on it carries no dread. The night's dark is the sky's own, as any
hike's night is; nothing of the dread's comes with it. The name the lake's calm
reads is the nearer preset's, faded over twenty seconds. `/weather <preset>` on
a calm world answers with the day's weather and sets nothing.

Amended 2026-10-15 after the first hike in it: the day ran dawn to dusk at two
minutes an hour, and a hike started at noon sat under the schedule's one rain
for most of its length; the clock now runs the whole day three times faster and
the schedule turns twice as often.

The inner voice reads the day's rain as the wet act and the day's mist as
the mist act, so its two weather lines come as the weather does.

## 2. The mute

One button, top right, on every page: the title screen, the intro film,
the scenes and the hike (`muteButton.ts`, placed on the body so the pages'
container never replaces it). Pressed, nothing sounds: the hike's ambient
master is held at silence (`ambientAudio.ts` `setMuted`, kept across the
unlock and under `setVolume`), and the intro film's track follows it. The
state is kept in localStorage (`dayhike.muted`). On a page the button
draws plain; over a hike it sits as faint as the touch controls do and
comes up under the pointer, on keyboard focus, and whenever it is pressed,
so a muted hike always shows why it is silent.

*Since 2026-10-17:* over a hike the button sits at the top left, under the
Pause button (the touch layer's on a touch screen, the HUD's for a keyboard,
section 3), 44 px below its top at the same 14 px from the corner; on a page
it stays top right.

The intro's own sound button is gone with it. A follower's film still
starts muted, as a browser plays a film without a gesture no other way;
the page's first gesture, a press or a key, turns its track on unless the
page's mute holds.

## 3. The lamp's hint

The HUD shows a keyboard player the headlamp: the torch and the key that
lights it, `F`, at the bottom left corner (the roster sits at the right), as faint as the touch controls
and lit with the lamp (`hud.ts` `setLamp`). A touch screen has its lamp
button already and shows no hint; the hint goes with a scene's bars and at
the hike's end.

*Since 2026-10-17:* the HUD shows a keyboard player the pause the same way:
a Pause button at the top left corner, where the touch layer's own sits,
with the key that pauses, `Esc`, beside the bars (`hud.ts` `setPause`), as
faint as the lamp's hint, up under the pointer and on focus; pressed, it
lets the controls go as the key does (`app.ts`, `input.disengage`). The
page's mute sits under it. A touch screen has its Pause button already and
shows none; it goes with a scene's bars and at the hike's end.

## 4. Where it lives

| File | What |
|---|---|
| `client/src/game/gameMode.ts` | The modes, their labels and lines, the stored choice, `peaceful()`. |
| `client/src/game/exploreDay.ts` | The clock and the weather schedule. |
| `client/src/game/commands.ts` | `/mode`, a world entry. |
| `client/src/game/settings.ts` | The Mode group. |
| `client/src/game/muteButton.ts`, `icons.ts` | The button and the line icons the HUD and the touch layer share. |
| `client/src/game/hud.ts` | The lamp hint and the Pause button for a keyboard. |
| `client/src/sim/world.ts`, `summit.ts`, `client/src/net/*Session.ts` | `World.peaceful`. |
| `client/src/app.ts`, `main.ts` | The mode resolved and written to the address; the calm atmosphere; the mute bound to the ambient; the hint synced with the lamp, the Pause button with the lamp's hint. |
