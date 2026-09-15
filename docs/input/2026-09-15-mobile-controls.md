# Mobile touch controls and the in-world interact prompt

Design, agreed 2026-09-15. Day Hike is keyboard-and-mouse only: `game/input.ts` samples held
keys and pointer-locked mouse movement, and pointer-lock state is the single source of
"paused" for the pause menu and the roster. Phones have neither keys nor pointer lock, so a
player who opens an invite on a phone can watch the world but cannot move. This adds a touch
input path that fits the existing sampler, a touch layer drawn in the game's own visual
language, and an in-world prompt for interacting that replaces a button on every device.

## Goals

- A phone or tablet can play a full match: move, sprint, look, jump, toggle the lamp,
  interact, pause, resume, invite and join.
- The controls look like part of the game (the roster's and pause menu's language), and
  every appearance, press and disappearance is a fade or a spring, never a pop.
- The screen stays uncluttered: nothing is drawn that is not needed right now, and what is
  drawn fades when idle.
- Nothing about the simulation, the wire protocol or the host changes. Touch produces the
  same `InputCommand`s a keyboard does.

## Non-goals

- Frame rate on phones. Phones already land on the `low` quality tier; a rendering budget for
  them is separate work, measured separately. This design reports what an emulated phone
  viewport renders at and stops there.
- Gamepads, tap-to-move, on-screen keyboard for the command bar, the netgraph on touch.
- A games index, host migration, or any lobby feature beyond what exists today.

## Detection

`game/platform.ts` gains `isTouchDevice(nav = navigator, mq = matchMedia)`: true when the
primary pointer is coarse (`(pointer: coarse)`) and `nav.maxTouchPoints > 0`. Pure, tested
with injected facts like `isDesktop` and `hostPlatform`.

Two safety nets, both in the touch layer rather than the probe:

- A real `pointerdown` with `pointerType === "touch"` on the canvas shows the touch layer on
  any device, so a tablet with a keyboard attached, or a touch laptop that reports a fine
  primary pointer, still gets controls the moment a finger lands.
- Once shown, the layer stays for the life of the game. A device does not flip back and
  forth.

The quality tier's `mobile` capability (`renderer.ts`, a user-agent regex) is a different
question, device class rather than input, and is left alone: a touch Windows laptop should
keep its tier.

## The engaged state

The sampler gains one concept, **engaged**: the player's controls are live and the pause
menu is down. It replaces `locked` as the thing callers read.

| | Desktop | Touch |
| --- | --- | --- |
| Engaged means | pointer lock held on the canvas | touch layer active |
| Becomes engaged | canvas click requests lock; `pointerlockchange` confirms | the game starts engaged; Resume on the pause menu re-engages |
| Becomes disengaged | Esc, alt-tab, focus loss release the lock | the Pause button; the page going hidden (`visibilitychange`) |

On a hybrid device — a touch-screen laptop that starts in desktop mode and then takes a touch,
which flips it into touch mode while a real pointer lock still sits underneath — a lost pointer
lock still disengages and a regained one still engages, on top of the touch layer's own edges.
A pure phone never has a pointer lock to lose or gain, so this is unobservable there.

`InputSampler` changes:

- `readonly engaged: boolean` replaces `locked`. `freecam.ts` and `app.ts` read it.
- `onEngagedChange(handler)` replaces `app.ts`'s direct `pointerlockchange` listener. On
  desktop the sampler subscribes to `pointerlockchange` itself and forwards; on touch it
  fires when the touch layer engages or disengages.
- `engage()` replaces `requestLock()`: requests pointer lock on desktop, sets engaged on
  touch. `disengage()` is new and is what the Pause button calls; on desktop it exits
  pointer lock.
- `createInputSampler(canvas, { touch?: TouchSource })`: the optional second source.

`app.ts`'s `onLockStateChange` becomes the `onEngagedChange` handler, unchanged in body:
engaged hides the menu and reports `onPauseChange(false)`; disengaged with the command bar
closed shows the menu and reports `onPauseChange(true)`. The house rule holds: one source of
paused, now named for what it means rather than how desktop implements it.

The canvas click-to-lock handler is not installed on touch, and `touch-action: none` is set
on the canvas so the browser never scrolls, zooms or selects on the game route.

## The touch model

`game/touchControls.ts` exports a pure model, tested headless like `rosterModel`, and a DOM
layer that only paints. The model is a `TouchSource`, which is the interface the sampler
reads:

```ts
type TouchSource = {
  /** Move axes in [-1, 1], already dead-zoned. */
  readonly moveX: number;
  readonly moveZ: number;
  /** Accumulated look since the last drain, in radians. Drained by the sampler each frame. */
  takeLook(): { yaw: number; pitch: number };
  /** Held bits plus any latched edges; edges clear once taken. */
  takeButtons(): number;
  readonly sprinting: boolean;
};
```

The model consumes pointer events tagged `{ id, x, y, type: "down" | "move" | "up" | "cancel" }`
in CSS pixels, plus the viewport size, plus a clock in milliseconds for the double-tap
windows. It exposes its state for the layer to paint: the stick's anchor and thumb offset or
`null`, which buttons are pressed, whether the lamp is lit, and the idle level.

### Zones and roles

Every pointer gets one role on its `down`, kept until `up` or `cancel`. Roles are by pointer
id, so one thumb walks while the other looks.

- **Stick zone:** `x < 0.45 * width`, below the Lamp button and above the safe-area inset. A
  `down` here with no stick pointer active becomes the **stick pointer** and anchors the stick
  at that point.
- **Buttons:** a `down` inside a button's circle becomes that button's pointer.
- **Look zone:** any other `down` on the canvas becomes a **look pointer**.

### Stick

- Axes are the thumb's offset from the anchor over a **60 px** radius, clamped to the unit
  disc. Inside a **15 %** dead zone both axes are 0; outside it the magnitude is remapped so
  the edge of the dead zone reads as 0 and the rim reads as 1. `moveX` is right, `moveZ` is
  up on the screen.
- The thumb is drawn at the clamped offset, so it stops at the rim while the finger keeps
  going.
- `up` or `cancel` zeroes the axes and clears the stick.

### Sprint: double-tap and hold the stick

A stick `down` within **300 ms** of the previous stick `down` anchors the stick as usual and
sets **sprinting** for as long as that pointer stays down. Lifting ends it. Nothing to untoggle.
The Sprint bit rides `takeButtons()` while sprinting, and `sprinting` is exposed for the
walking cue exactly as `sprintHeld` is for Shift.

### Look

Each `move` of a look pointer adds `dx * 0.0045` to yaw and `dy * 0.0045` to pitch, about
twice the mouse rate; the sampler clamps pitch as it does for the mouse. `takeLook()` returns
the accumulated delta and zeroes it, so a frame with two moves and a frame with none both
apply exactly what happened.

### Jump: double-tap the look zone

A **tap** is a look pointer whose `up` comes within **250 ms** of its `down` with at most
**10 px** of travel. A look `down` within **300 ms** of the previous tap's `down` latches one
Jump edge, taken by the next `takeButtons()`. A pointer that drags is a look, never a tap, so
looking around cannot jump; a single tap does nothing.

### Buttons

Three, no more:

- **Lamp**, bottom-left above the stick zone: a tap latches one Lamp edge; the host toggles on
  the edge as it does for the F key. The model tracks `lampOn` from the local player's state
  (fed by the app each frame) so the layer can draw the lit ring.
- **Pause**, top-right: a tap calls the layer's `onPause`, which is the sampler's
  `disengage()`.
- **Interact** is not a button. See the prompt below.

Jump and Lamp edges latch until taken because a frame may contain no tick: the sampler is
only called on ticks, and an edge that fell between two ticks must still arrive.

### Idle level

The model tracks the last time any pointer was down. `idle` is 0 for **3 s** after a touch
and 1 afterwards; the layer maps it to opacity. Any `down` resets it.

## The touch layer

A `.touch` element appended to the game container, `pointer-events: none` itself, with the
stick, the Lamp button and the Pause button as children that take pointer events. Look and
stick pointers are captured on the canvas via `pointerdown`/`pointermove`/`pointerup`/
`pointercancel` with `setPointerCapture`, so a finger that slides off a button or off the
canvas still ends its role.

Styling is the roster's: `rgba(16, 16, 20, 0.72)` fill, `1px solid rgba(255, 255, 255, 0.18)`
border, `backdrop-filter: blur(4px)`, `ui-monospace` uppercase labels at 0.6 rem, letter
spacing 0.08 em. Pressed state is the pause menu's `rgba(255, 255, 255, 0.18)`. The lit lamp
ring is the roster's `#ffd24d` at 1 px. Every position adds the safe-area inset for its edge.

| Element | Size | Position |
| --- | --- | --- |
| Stick base | 120 px circle, 2 px border, no fill | at the anchor |
| Stick thumb | 56 px circle, filled | anchor plus clamped offset |
| Lamp | 56 px circle, label "Lamp" | left 32 px, bottom 200 px |
| Pause | 40 px circle, label "‖" as text | right 20 px, top 20 px |

Motion, all `ease-out` unless said:

| What | Timing |
| --- | --- |
| Stick appears | opacity 0 → 1 and scale 0.8 → 1 over 120 ms |
| Stick disappears | thumb springs to the anchor over 180 ms `cubic-bezier(0.2, 1.4, 0.4, 1)` while the base fades over 180 ms |
| Button press | scale 1 → 0.92 over 80 ms; release reverses |
| Lamp toggled | one 300 ms pulse of the lit ring from 3 px back to 1 px |
| Layer engaged | opacity 0 → 1 over 400 ms |
| Layer idle | opacity 1 → 0.35 over 600 ms after 3 s without a touch; any touch returns it to 1 over 120 ms |
| Pause menu open | layer opacity → 0 over 200 ms; the menu already fades itself; the layer's buttons stop taking pointer events and the interact prompt hides |

The layer paints from the model each frame (`sync(model)`), the same shape as the roster:
it never decides anything.

## The in-world interact prompt

Interact has no button. When something is in reach, a prompt floats at the object.

- `sim/interact.ts` already has the pure resolver, `resolveInteract(world, player)`. The
  client session exposes `readonly world: World` (the predicted world) so `app.ts` can resolve
  against the local player on both sessions. The host resolves authoritatively as today; the
  client's resolution only drives the prompt.
- **Registry on both sides.** Today only the host registers interactables, and only the
  debug pad marker under `?cmd=debug`. That registration moves into
  `registerInteractables(world, seed, debugOn)` in `app.ts`, called for the host world and
  the client's predicted world, so the client can see what is in reach. Nothing crosses the
  wire; the registry is seeded, like everything else about the world.
- `game/interactPrompt.ts` exports a pure `promptModel(target, projected, viewport)` and a
  DOM renderer. The model returns `null` or `{ x, y, label, scale }`: `label` from the
  target's `kind` (0 → "Interact"; register kinds will add their own strings), `scale`
  from 1.0 at 1 m to 0.7 at `INTERACT_REACH`. `x`, `y` are clamped 24 px inside the viewport.
- The renderer exposes `project(pos): { x, y, depth } | null` in CSS pixels, `null` when the
  point is behind the camera.
- The prompt is a 12 px dot with the label beside it in the HUD's type and shadow, positioned
  with `transform: translate(...)`. It fades in over 150 ms with a 4 px rise, drifts by ±2 px
  on a 3 s loop, and fades out over 150 ms. On desktop the label reads "Click to interact";
  on touch just the label, and tapping the prompt latches one Interact edge in the touch
  model. Holding it holds the bit, matching the mouse button.
- The HUD's `pointer-events: none` stays; the prompt alone is `pointer-events: auto` on touch.

Today the prompt is dormant in normal play, since no content registers interactables yet;
the browser gate proves it against the debug marker.

## The lobby on a phone

- `rosterModel` gains a third presence, `"hidden"`, when the game is on a touch device, in
  game and not paused. The roster fades to 0 over 200 ms and takes no pointer events. It is
  `"full"` on the landing and on the pause menu as today.
- The roster is **interactive on the pause menu on every device**. Today it is drawn full
  there but stays `locked`, which is the parked "Invite looks clickable exactly when it is
  not" item; on a phone the pause menu is the only place to invite from, so the lock goes.
- **Invite on touch uses the share sheet:** `navigator.share({ url })` when the browser
  offers it, else the existing clipboard copy. Copy stays for both.
- Joining is a URL and is unchanged. A follower on a phone is routed into the host's game
  exactly as on desktop.

## The landing at phone width

Two viewports must work with 16 px gutters and no horizontal scroll: **400 × 800** portrait
and **667 × 375** landscape.

- Portrait: the title at 1.4 rem, the copy at 0.85 rem with `text-wrap: balance`, buttons
  full-width up to 20 rem. The roster stays a fixed panel — not stacked into the page's flow
  under the buttons — but widens to fill the viewport at 1 rem gutters instead of pinning to
  the corner, so it reads as a bottom panel.
- Landscape: the panel already scrolls (`justify-content: safe center`); the roster narrows
  to 40 % and keeps the corner.
- The Downloads panel hides the two desktop download cards behind a one-line note on touch
  ("Day Hike is a desktop download; play in the browser here."), since a phone cannot install
  either.

## Files

New:

- `client/src/game/touchControls.ts`: the pure model (`createTouchModel`) and the layer
  (`createTouchLayer`).
- `client/src/game/interactPrompt.ts`: `promptModel` and `createInteractPrompt`.
- `client/test/game/touchControls.test.ts`, `client/test/game/interactPrompt.test.ts`.

Changed:

- `client/src/game/platform.ts`: `isTouchDevice`.
- `client/src/game/input.ts`: engaged state, `onEngagedChange`, `engage`/`disengage`, the
  `TouchSource` merged into `sample()` and `sprinting`.
- `client/src/game/freecam.ts`, `client/src/app.ts`: read `engaged`; `app.ts` wires the touch
  layer, the prompt, `registerInteractables`, and the visibility-change disengage.
- `client/src/game/renderer.ts`: `project`.
- `client/src/net/clientSession.ts`: `readonly world`.
- `client/src/game/rosterModel.ts`, `roster.ts`: `"hidden"` presence, unlocked on the pause
  menu, share-sheet Invite.
- `client/src/game/landing.ts`, `landingModel.ts`: phone-width rules and the touch download
  note.
- `client/src/main.ts`: passes `touch` into the roster model and the game options.

The layering rule is untouched: `sim/` gains nothing, `net/` gains a getter.

## Tests

Headless vitest, following the house split of pure model tested and renderer untested:

- `touchControls.test.ts`: stick anchors at the first down in its zone and nowhere else;
  dead zone and rim remap; a second stick down inside 300 ms sprints until up, outside it does
  not; look accumulates and drains once; a tap under 10 px and 250 ms counts, a drag does not;
  two taps inside 300 ms latch one Jump edge, taken once; a third finger gets the role its zone
  dictates; `cancel` ends a role like `up`; Lamp latches one edge; idle flips at 3 s and any
  down resets it.
- `interactPrompt.test.ts`: null with no target or behind the camera; label by kind; scale by
  distance; clamped inside the viewport.
- `platform.test.ts`: `isTouchDevice` on the four combinations of coarse and touch points.
- `rosterModel.test.ts`: `"hidden"` only when touch, in game and not paused; interactive on the
  pause menu.
- `input.test.ts`: `sample()` merges a touch source's axes and edges; `engaged` mirrors
  pointer lock on desktop and the source on touch; edges taken once.
- `architecture.test.ts` unchanged and still green.

## Browser gates

Driven by the controller against `npm run dev` with the `chrome-devtools` CLI, emulating an
iPhone-class viewport (390 × 844 and 844 × 390) with touch, every shot archived outside the
repo:

1. The landing at both viewports: no horizontal scroll, Play reachable, roster readable.
2. Start a game: the layer fades in; the stick appears under a synthesized touch, walks the
   player, and disappears on release.
3. Double-tap-hold the stick: the netgraph-free check is the walking cue's sprint state and
   the distance covered in two seconds versus a walk.
4. Drag look turns the camera; a double-tap in the look zone jumps once and a drag never does.
5. Lamp toggles and the ring lights; idle fade to 35 % after three seconds.
6. `?cmd=debug`: walk to the pad marker, the prompt appears at it, tapping it logs the
   interact on the host.
7. Pause: the menu opens, the roster is live, Invite offers share or copy; Resume returns.
8. Two pages, one at phone size, one desktop: the phone joins by invite and both see each
   other, with the joiner's prediction error at 0 cm.
9. Frame time on the emulated phone viewport at the `low` tier, reported, not gated.
