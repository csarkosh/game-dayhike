import type { InputCommand } from "../sim/types.js";
import { Button } from "../sim/types.js";

const MOUSE_SENSITIVITY = 0.0022;
const PITCH_LIMIT = Math.PI / 2 - 0.01;

export type InputSampler = {
  sample(seq: number): InputCommand;
  readonly locked: boolean;
  readonly suppressed: boolean;
  /** Held key codes, shared with freecam so the two cannot disagree. */
  readonly keys: ReadonlySet<string>;
  /**
   * Whether sprint is held right now. Same binding and same suppression rule as
   * `sample`, so the walking cue and the input command can never disagree about
   * it — the renderer needs it every frame, while `sample` is only called on
   * ticks and a frame may contain none.
   */
  readonly sprinting: boolean;
  setSuppressed(value: boolean): void;
  requestLock(): void;
  dispose(): void;
};

export function createInputSampler(canvas: HTMLCanvasElement): InputSampler {
  const keys = new Set<string>();
  let yaw = 0;
  let pitch = 0;
  let locked = false;
  let interactHeld = false;
  let suppressed = false;

  /** The single definition of the sprint binding; both readers go through it. */
  const sprintHeld = (): boolean => !suppressed && keys.has("ShiftLeft");

  const onKeyDown = (e: KeyboardEvent) => {
    keys.add(e.code);
    // Esc while locked releases the pointer, which opens the pause menu (the
    // caller watches pointerlockchange). In the browser Chromium has already
    // ejected the lock — and armed its 1.25 s relock cooldown — before the
    // page sees this key, so this is a no-op there. In the Electron shell
    // nothing ejects it: the page owns Escape outright, this release is what
    // opens the menu, and being page-initiated it arms no cooldown at all.
    // While the command bar is open, Esc belongs to the bar.
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
    if (pitch > PITCH_LIMIT) pitch = PITCH_LIMIT;
    if (pitch < -PITCH_LIMIT) pitch = -PITCH_LIMIT;
  };

  const onMouseDown = (e: MouseEvent) => {
    if (e.button === 0) interactHeld = true;
  };
  const onMouseUp = (e: MouseEvent) => {
    if (e.button === 0) interactHeld = false;
  };

  const onLockChange = () => {
    locked = document.pointerLockElement === canvas;
    // Releasing the pointer must not leave keys stuck down.
    if (!locked) {
      keys.clear();
      interactHeld = false;
    }
  };

  const onCanvasClick = () => {
    if (!locked) void canvas.requestPointerLock();
  };

  window.addEventListener("keydown", onKeyDown);
  window.addEventListener("keyup", onKeyUp);
  window.addEventListener("mousemove", onMouseMove);
  window.addEventListener("mousedown", onMouseDown);
  window.addEventListener("mouseup", onMouseUp);
  document.addEventListener("pointerlockchange", onLockChange);
  canvas.addEventListener("click", onCanvasClick);

  return {
    get locked() {
      return locked;
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
    requestLock() {
      // Chrome rate-limits a re-lock that follows an unlock too closely, which
      // is precisely this path: opening the command bar unlocks and closing it
      // locks again. The rejection is not an error worth surfacing — you click
      // the canvas and carry on — but left unhandled it prints as one.
      void Promise.resolve(canvas.requestPointerLock()).catch(() => undefined);
    },
    get sprinting() {
      return sprintHeld();
    },
    sample(seq: number): InputCommand {
      // While the command bar has focus every keystroke is text. Reporting it as
      // movement would walk the player away mid-sentence.
      if (suppressed) return { seq, moveX: 0, moveZ: 0, yaw, pitch, buttons: 0 };
      let moveX = 0;
      let moveZ = 0;
      if (keys.has("KeyW")) moveZ += 1;
      if (keys.has("KeyS")) moveZ -= 1;
      if (keys.has("KeyD")) moveX += 1;
      if (keys.has("KeyA")) moveX -= 1;

      let buttons = 0;
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
}
