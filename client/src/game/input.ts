import type { InputCommand } from "../sim/types.js";
import { Button } from "../sim/types.js";
import type { TouchSource } from "./touchControls.js";

const MOUSE_SENSITIVITY = 0.0022;
const PITCH_LIMIT = Math.PI / 2 - 0.01;

export type InputSampler = {
  sample(seq: number): InputCommand;
  /**
   * The player's controls are live and the pause menu is down. On desktop this
   * is exactly pointer lock; in touch mode it is the touch layer's own state.
   * The single source of "paused" for the pause menu and the roster.
   */
  readonly engaged: boolean;
  readonly suppressed: boolean;
  /** Held key codes, shared with freecam so the two cannot disagree. */
  readonly keys: ReadonlySet<string>;
  /**
   * Whether sprint is held right now, by Shift or by the touch gesture. Same
   * suppression rule as `sample`, so the walking cue and the input command can
   * never disagree about it.
   */
  readonly sprinting: boolean;
  setSuppressed(value: boolean): void;
  /** Fires on every change of `engaged`. One handler; the caller is app.ts. */
  onEngagedChange(handler: (engaged: boolean) => void): void;
  /** Requests pointer lock on desktop; engages outright in touch mode. */
  engage(): void;
  /** Exits pointer lock on desktop; disengages outright in touch mode. */
  disengage(): void;
  /**
   * Switches engaged semantics to the touch layer. Idempotent. Turning it on
   * engages at once: the game starts playable on a phone with nothing to click.
   * A switch in either direction announces any resulting change to the
   * observed `engaged` value, exactly once, through `onEngagedChange`.
   */
  setTouchMode(on: boolean): void;
  dispose(): void;
};

export type InputOptions = {
  /** Axes, look and buttons from the touch layer, merged into every sample. */
  touch?: TouchSource;
  /** Start in touch mode. `isTouchDevice()` decides; the layer can flip it later. */
  touchMode?: boolean;
};

export function createInputSampler(canvas: HTMLCanvasElement, opts: InputOptions = {}): InputSampler {
  const touch = opts.touch ?? null;
  const keys = new Set<string>();
  let yaw = 0;
  let pitch = 0;
  let locked = false;
  let touchMode = false;
  let touchEngaged = false;
  let interactHeld = false;
  let suppressed = false;
  let engagedHandler: ((engaged: boolean) => void) | null = null;

  const engaged = (): boolean => (touchMode ? touchEngaged : locked);

  /** The single definition of the sprint binding; both readers go through it. */
  const sprintHeld = (): boolean => !suppressed && (keys.has("ShiftLeft") || (touch?.sprinting ?? false));

  const clampPitch = (): void => {
    if (pitch > PITCH_LIMIT) pitch = PITCH_LIMIT;
    if (pitch < -PITCH_LIMIT) pitch = -PITCH_LIMIT;
  };

  const setTouchEngaged = (next: boolean): void => {
    if (touchEngaged === next) return;
    touchEngaged = next;
    if (!next) {
      keys.clear();
      interactHeld = false;
    }
    engagedHandler?.(next);
  };

  const onKeyDown = (e: KeyboardEvent) => {
    keys.add(e.code);
    // Esc while locked releases the pointer, which opens the pause menu (the
    // caller watches engaged). In the browser Chromium has already ejected the
    // lock — and armed its 1.25 s relock cooldown — before the page sees this
    // key, so this is a no-op there. In the Electron shell nothing ejects it:
    // the page owns Escape outright, this release is what opens the menu, and
    // being page-initiated it arms no cooldown at all. While the command bar
    // is open, Esc belongs to the bar.
    if (!suppressed && e.code === "Escape" && locked) {
      document.exitPointerLock();
      return;
    }
    // Space scrolls the page and Tab moves focus out of the canvas.
    // But only while gameplay is actually reading these keys: while suppressed
    // (the command bar is open) the sampler already reports zero movement, and
    // the bar's focused <input> needs the real Space character to reach it —
    // preventDefault here would silently swallow every space typed into it.
    if (!suppressed && (e.code === "Space" || e.code === "Tab")) e.preventDefault();
  };
  const onKeyUp = (e: KeyboardEvent) => keys.delete(e.code);

  const onMouseMove = (e: MouseEvent) => {
    if (!locked) return;
    yaw += e.movementX * MOUSE_SENSITIVITY;
    pitch += e.movementY * MOUSE_SENSITIVITY;
    clampPitch();
  };

  const onMouseDown = (e: MouseEvent) => {
    if (e.button === 0) interactHeld = true;
  };
  const onMouseUp = (e: MouseEvent) => {
    if (e.button === 0) interactHeld = false;
  };

  const onLockChange = () => {
    const was = locked;
    locked = document.pointerLockElement === canvas;
    // Releasing the pointer must not leave keys stuck down.
    if (!locked) {
      keys.clear();
      interactHeld = false;
    }
    // In touch mode pointer lock is not what engaged means, so it says nothing.
    if (!touchMode && was !== locked) engagedHandler?.(locked);
  };

  const onCanvasClick = () => {
    if (!touchMode && !locked) void canvas.requestPointerLock();
  };

  window.addEventListener("keydown", onKeyDown);
  window.addEventListener("keyup", onKeyUp);
  window.addEventListener("mousemove", onMouseMove);
  window.addEventListener("mousedown", onMouseDown);
  window.addEventListener("mouseup", onMouseUp);
  document.addEventListener("pointerlockchange", onLockChange);
  canvas.addEventListener("click", onCanvasClick);

  const sampler: InputSampler = {
    get engaged() {
      return engaged();
    },
    get suppressed() {
      return suppressed;
    },
    get keys() {
      return keys as ReadonlySet<string>;
    },
    setSuppressed(value: boolean) {
      suppressed = value;
      // Held keys are left tracked, not cleared: `sample` already reports zero
      // movement/buttons whenever suppressed, and clearing here would forget a
      // key that is still physically held once suppression lifts.
    },
    onEngagedChange(handler) {
      engagedHandler = handler;
    },
    engage() {
      if (touchMode) {
        setTouchEngaged(true);
        return;
      }
      // Chrome rate-limits a re-lock that follows an unlock too closely, which
      // is precisely this path: opening the command bar unlocks and closing it
      // locks again. The rejection is not an error worth surfacing — you click
      // the canvas and carry on — but left unhandled it prints as one.
      void Promise.resolve(canvas.requestPointerLock()).catch(() => undefined);
    },
    disengage() {
      if (touchMode) {
        setTouchEngaged(false);
        return;
      }
      if (locked) document.exitPointerLock();
    },
    setTouchMode(on) {
      if (touchMode === on) return;
      const was = engaged();
      touchMode = on;
      if (on) touchEngaged = true;
      const is = engaged();
      if (is !== was) engagedHandler?.(is);
    },
    get sprinting() {
      return sprintHeld();
    },
    sample(seq: number): InputCommand {
      // Drained every sample, kept or dropped: a look or a jump that happened
      // while the menu was up must not land the moment it comes down.
      const look = touch?.takeLook() ?? { yaw: 0, pitch: 0 };
      const touchButtons = touch?.takeButtons() ?? 0;
      // While the command bar has focus every keystroke is text. Reporting it as
      // movement would walk the player away mid-sentence.
      if (suppressed) return { seq, moveX: 0, moveZ: 0, yaw, pitch, buttons: 0 };
      yaw += look.yaw;
      pitch += look.pitch;
      clampPitch();

      let moveX = touch?.moveX ?? 0;
      let moveZ = touch?.moveZ ?? 0;
      if (keys.has("KeyW")) moveZ += 1;
      if (keys.has("KeyS")) moveZ -= 1;
      if (keys.has("KeyD")) moveX += 1;
      if (keys.has("KeyA")) moveX -= 1;
      moveX = Math.max(-1, Math.min(1, moveX));
      moveZ = Math.max(-1, Math.min(1, moveZ));

      let buttons = touchButtons;
      if (interactHeld) buttons |= Button.Interact;
      if (keys.has("Space")) buttons |= Button.Jump;
      if (sprintHeld()) buttons |= Button.Sprint;
      if (keys.has("KeyF")) buttons |= Button.Lamp;

      return { seq, moveX, moveZ, yaw, pitch, buttons };
    },
    dispose() {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mousedown", onMouseDown);
      window.removeEventListener("mouseup", onMouseUp);
      document.removeEventListener("pointerlockchange", onLockChange);
      canvas.removeEventListener("click", onCanvasClick);
    },
  };
  if (opts.touchMode) sampler.setTouchMode(true);
  return sampler;
}
