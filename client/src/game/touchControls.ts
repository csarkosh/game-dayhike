import { Button } from "../sim/types.js";

/** Fraction of the viewport width, from the left, that anchors the stick. */
export const STICK_ZONE = 0.45;
/** Thumb travel from the anchor that reads as full deflection, CSS px. */
export const STICK_RADIUS = 60;
/** Fraction of the radius inside which the stick reads zero. */
export const DEAD_ZONE = 0.15;
/** Radians per CSS px of drag: about twice the mouse rate. */
export const LOOK_RATE = 0.0045;
/** A second down inside this window of the previous one is a double tap. */
export const DOUBLE_TAP_MS = 300;
/** A press held longer than this is not a tap. */
export const TAP_MAX_MS = 250;
/** A press that travels further than this is a drag, not a tap. */
export const TAP_MAX_TRAVEL = 10;
/** Without a touch for this long the layer fades to its idle level. */
export const IDLE_AFTER_MS = 3000;

export type TouchPointer = { id: number; x: number; y: number; hit: "canvas" | "lamp" | "pause" };
export type Viewport = { width: number; height: number };

/** What the input sampler reads from touch, alongside keys and the mouse. */
export type TouchSource = {
  /** Move axes in [-1, 1], already dead-zoned. Right is +X, screen-up is +Z. */
  readonly moveX: number;
  readonly moveZ: number;
  /** Look accumulated since the last drain, in radians. Zeroed by the call. */
  takeLook(): { yaw: number; pitch: number };
  /** Held bits plus any latched edges; edges clear once taken. */
  takeButtons(): number;
  readonly sprinting: boolean;
};

/** What the layer paints. Read every frame; never mutated by the layer. */
export type TouchState = {
  stick: { anchorX: number; anchorY: number; dx: number; dy: number } | null;
  lampPressed: boolean;
  pausePressed: boolean;
  lampOn: boolean;
  idle: boolean;
};

export type TouchModel = TouchSource & {
  readonly state: TouchState;
  down(p: TouchPointer, nowMs: number): void;
  move(id: number, x: number, y: number, nowMs: number): void;
  up(id: number, nowMs: number): void;
  /** The browser took the pointer (a system gesture, a tab switch): same as up. */
  cancel(id: number, nowMs: number): void;
  /** The in-world prompt was pressed: an Interact edge now, and the bit while held. */
  interactDown(): void;
  interactUp(): void;
  /** The local player's lamp, so the layer can draw the lit ring. */
  setLampOn(on: boolean): void;
  resize(viewport: Viewport): void;
  /** Advances the idle clock. Once a frame. */
  tick(nowMs: number): void;
};

type Role =
  | { kind: "stick" }
  | { kind: "look"; downX: number; downY: number; lastX: number; lastY: number; downAt: number; dragged: boolean; jumped: boolean }
  | { kind: "lamp" }
  | { kind: "pause" };

/**
 * The pure half of the touch controls: pointer events in, axes, look, button
 * bits and paint state out. No DOM, no clock of its own — every call carries
 * `nowMs` so the double-tap windows and the idle fade are testable.
 */
export function createTouchModel(viewport: Viewport, hooks: { onPause(): void }): TouchModel {
  let width = viewport.width;
  const roles = new Map<number, Role>();
  const state: TouchState = { stick: null, lampPressed: false, pausePressed: false, lampOn: false, idle: false };

  let moveX = 0;
  let moveZ = 0;
  let lookYaw = 0;
  let lookPitch = 0;
  let sprinting = false;
  let latched = 0;
  let interactHeld = false;
  let lastStickDownAt = -Infinity;
  let lastTapDownAt = -Infinity;
  let lastTouchAt = -Infinity;

  function stickAxes(dx: number, dy: number): void {
    const dist = Math.hypot(dx, dy);
    const clamped = Math.min(dist, STICK_RADIUS);
    // The thumb stops at the rim; the finger may keep going.
    const scale = dist > 0 ? clamped / dist : 0;
    state.stick = state.stick && { ...state.stick, dx: dx * scale, dy: dy * scale };
    const t = clamped / STICK_RADIUS;
    if (t <= DEAD_ZONE) {
      moveX = 0;
      moveZ = 0;
      return;
    }
    // The edge of the dead zone reads as 0 and the rim as 1.
    const mag = (t - DEAD_ZONE) / (1 - DEAD_ZONE);
    moveX = (dx / dist) * mag;
    moveZ = (-dy / dist) * mag;
  }

  function endStick(): void {
    state.stick = null;
    moveX = 0;
    moveZ = 0;
    sprinting = false;
  }

  function release(id: number, nowMs: number, cancelled: boolean): void {
    const role = roles.get(id);
    if (role === undefined) return;
    roles.delete(id);
    if (role.kind === "stick") endStick();
    else if (role.kind === "lamp") {
      state.lampPressed = false;
      if (!cancelled) latched |= Button.Lamp;
    } else if (role.kind === "pause") {
      state.pausePressed = false;
      if (!cancelled) hooks.onPause();
    } else if (role.kind === "look" && !cancelled && !role.jumped) {
      if (nowMs - role.downAt <= TAP_MAX_MS && !role.dragged) lastTapDownAt = role.downAt;
    }
  }

  return {
    get moveX() {
      return moveX;
    },
    get moveZ() {
      return moveZ;
    },
    get sprinting() {
      return sprinting;
    },
    get state() {
      return state;
    },
    takeLook() {
      const out = { yaw: lookYaw, pitch: lookPitch };
      lookYaw = 0;
      lookPitch = 0;
      return out;
    },
    takeButtons() {
      let bits = latched;
      latched = 0;
      if (sprinting) bits |= Button.Sprint;
      if (interactHeld) bits |= Button.Interact;
      return bits;
    },
    down(p, nowMs) {
      lastTouchAt = nowMs;
      state.idle = false;
      if (p.hit === "lamp") {
        roles.set(p.id, { kind: "lamp" });
        state.lampPressed = true;
        return;
      }
      if (p.hit === "pause") {
        roles.set(p.id, { kind: "pause" });
        state.pausePressed = true;
        return;
      }
      if (state.stick === null && p.x < width * STICK_ZONE) {
        roles.set(p.id, { kind: "stick" });
        state.stick = { anchorX: p.x, anchorY: p.y, dx: 0, dy: 0 };
        // A second stick down inside the window is "double-tap and hold": sprint
        // for as long as this finger stays down.
        sprinting = nowMs - lastStickDownAt <= DOUBLE_TAP_MS;
        lastStickDownAt = nowMs;
        return;
      }
      const jumped = nowMs - lastTapDownAt <= DOUBLE_TAP_MS;
      if (jumped) {
        latched |= Button.Jump;
        // Consumed: a third tap starts a new pair rather than jumping again.
        lastTapDownAt = -Infinity;
      }
      roles.set(p.id, { kind: "look", downX: p.x, downY: p.y, lastX: p.x, lastY: p.y, downAt: nowMs, dragged: false, jumped });
    },
    move(id, x, y, nowMs) {
      const role = roles.get(id);
      if (role === undefined) return;
      lastTouchAt = nowMs;
      if (role.kind === "stick" && state.stick !== null) {
        stickAxes(x - state.stick.anchorX, y - state.stick.anchorY);
      } else if (role.kind === "look") {
        lookYaw += (x - role.lastX) * LOOK_RATE;
        lookPitch += (y - role.lastY) * LOOK_RATE;
        role.lastX = x;
        role.lastY = y;
        if (Math.hypot(x - role.downX, y - role.downY) > TAP_MAX_TRAVEL) role.dragged = true;
      }
    },
    up(id, nowMs) {
      release(id, nowMs, false);
    },
    cancel(id, nowMs) {
      release(id, nowMs, true);
    },
    interactDown() {
      latched |= Button.Interact;
      interactHeld = true;
    },
    interactUp() {
      interactHeld = false;
    },
    setLampOn(on) {
      state.lampOn = on;
    },
    resize(next) {
      width = next.width;
    },
    tick(nowMs) {
      state.idle = nowMs - lastTouchAt > IDLE_AFTER_MS;
    },
  };
}
