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

const STYLE = `
  .touch {
    position: absolute; inset: 0; pointer-events: none; z-index: 15;
    font-family: ui-monospace, monospace; color: #fff;
    opacity: 0; transition: opacity 400ms ease-out;
  }
  /* .on's own transition is the idle-wake speed (any touch, 0.35 -> 1); .fresh
     overrides it for the slower engage fade (0 -> 1, first touch or lock). */
  .touch.on { opacity: 1; transition: opacity 120ms ease-out; }
  .touch.on.fresh { transition: opacity 400ms ease-out; }
  .touch.on.idle { opacity: 0.35; transition: opacity 600ms ease-out; }
  .touch.on.paused { opacity: 0; transition: opacity 200ms ease-out; }
  /* Invisible is not inert: without this the Lamp and Pause buttons keep
     taking pointer events while faded out, sitting above the pause menu and
     eating its taps. */
  .touch.on.paused button { pointer-events: none; }
  .touch.off { display: none; }
  .touch .stick {
    position: absolute; left: 0; top: 0; width: 120px; height: 120px;
    margin: -60px 0 0 -60px; border-radius: 50%;
    border: 2px solid rgba(255, 255, 255, 0.18);
    opacity: 0; transform: scale(0.8);
    transition: opacity 180ms ease-out, transform 180ms ease-out;
  }
  .touch .stick.live { opacity: 1; transform: scale(1); transition: opacity 120ms ease-out, transform 120ms ease-out; }
  .touch .thumb {
    position: absolute; left: 50%; top: 50%; width: 56px; height: 56px;
    margin: -28px 0 0 -28px; border-radius: 50%;
    background: rgba(16, 16, 20, 0.72); border: 1px solid rgba(255, 255, 255, 0.18);
    backdrop-filter: blur(4px);
    transition: transform 180ms cubic-bezier(0.2, 1.4, 0.4, 1);
  }
  .touch .stick.live .thumb { transition: none; }
  .touch button {
    position: absolute; pointer-events: auto; touch-action: none;
    display: flex; align-items: center; justify-content: center;
    font: inherit; font-size: 0.6rem; letter-spacing: 0.08em; text-transform: uppercase;
    color: #fff; background: rgba(16, 16, 20, 0.72);
    border: 1px solid rgba(255, 255, 255, 0.18); border-radius: 50%;
    backdrop-filter: blur(4px); -webkit-user-select: none; user-select: none;
    transition: transform 80ms ease-out, background 80ms ease-out, box-shadow 300ms ease-out;
  }
  .touch button.pressed { transform: scale(0.92); background: rgba(255, 255, 255, 0.18); }
  .touch .lamp {
    width: 56px; height: 56px;
    left: calc(32px + env(safe-area-inset-left, 0px));
    bottom: calc(200px + env(safe-area-inset-bottom, 0px));
  }
  .touch .lamp.lit { box-shadow: 0 0 0 1px #ffd24d; }
  .touch .lamp.pulse { box-shadow: 0 0 0 3px #ffd24d; transition: none; }
  .touch .pause {
    width: 40px; height: 40px; font-size: 0.9rem;
    right: calc(20px + env(safe-area-inset-right, 0px));
    top: calc(20px + env(safe-area-inset-top, 0px));
  }
`;

export type TouchLayer = {
  sync(): void;
  show(): void;
  dispose(): void;
};

/**
 * The dumb half: paints `model.state` and forwards pointer events. The canvas
 * gets the stick and look pointers (captured, so a finger sliding off still
 * ends its role); the two buttons get their own. Never decides anything.
 */
export function createTouchLayer(
  container: HTMLElement,
  canvas: HTMLCanvasElement,
  model: TouchModel,
  hooks: { engaged(): boolean; onFirstTouch(): void; visible: boolean },
): TouchLayer {
  const style = document.createElement("style");
  style.textContent = STYLE;
  const root = document.createElement("div");
  root.className = "touch";

  const stick = document.createElement("div");
  stick.className = "stick";
  const thumb = document.createElement("div");
  thumb.className = "thumb";
  stick.append(thumb);

  const lamp = document.createElement("button");
  lamp.type = "button";
  lamp.className = "lamp";
  lamp.textContent = "Lamp";
  const pause = document.createElement("button");
  pause.type = "button";
  pause.className = "pause";
  pause.textContent = "‖";
  pause.setAttribute("aria-label", "Pause");

  root.append(stick, lamp, pause);
  container.append(style, root);

  let visible = hooks.visible;
  root.classList.toggle("off", !visible);
  let wasLampOn = model.state.lampOn;
  let pulseTimer: ReturnType<typeof setTimeout> | undefined;
  // Whether the layer was engaged-and-visible as of the last sync, so the
  // 0 -> 1 engage fade (`fresh`, 400ms) is applied once on the frame it
  // starts, not fought every frame by the idle-wake speed (`.on`'s own
  // 120ms) that also applies once engaged.
  let wasEngagedVisible = false;
  let freshTimer: ReturnType<typeof setTimeout> | undefined;

  const now = () => performance.now();

  // The stick and look pointers live on the canvas; a device that started
  // without the layer gets it on its first real touch.
  const onCanvasDown = (e: PointerEvent) => {
    if (e.pointerType !== "touch") return;
    if (!visible) {
      visible = true;
      root.classList.remove("off");
      hooks.onFirstTouch();
    }
    if (!hooks.engaged()) return;
    canvas.setPointerCapture(e.pointerId);
    model.down({ id: e.pointerId, x: e.clientX, y: e.clientY, hit: "canvas" }, now());
  };
  const onCanvasMove = (e: PointerEvent) => {
    if (e.pointerType === "touch") model.move(e.pointerId, e.clientX, e.clientY, now());
  };
  const onCanvasUp = (e: PointerEvent) => {
    if (e.pointerType === "touch") model.up(e.pointerId, now());
  };
  const onCanvasCancel = (e: PointerEvent) => {
    if (e.pointerType === "touch") model.cancel(e.pointerId, now());
  };
  canvas.addEventListener("pointerdown", onCanvasDown);
  canvas.addEventListener("pointermove", onCanvasMove);
  canvas.addEventListener("pointerup", onCanvasUp);
  canvas.addEventListener("pointercancel", onCanvasCancel);

  function bindButton(el: HTMLButtonElement, hit: "lamp" | "pause"): void {
    el.addEventListener("pointerdown", (e) => {
      if (!hooks.engaged() && hit !== "pause") return;
      e.preventDefault();
      el.setPointerCapture(e.pointerId);
      model.down({ id: e.pointerId, x: e.clientX, y: e.clientY, hit }, now());
    });
    el.addEventListener("pointerup", (e) => model.up(e.pointerId, now()));
    el.addEventListener("pointercancel", (e) => model.cancel(e.pointerId, now()));
  }
  bindButton(lamp, "lamp");
  bindButton(pause, "pause");

  return {
    sync() {
      const s = model.state;
      const engaged = hooks.engaged();
      const engagedVisible = visible && engaged;
      if (engagedVisible && !wasEngagedVisible) {
        // The layer just engaged (a first touch or a pointer lock): the
        // slower 400ms fade in from fully hidden, not the 120ms idle-wake
        // speed `.on` carries for every touch after.
        root.classList.add("fresh");
        clearTimeout(freshTimer);
        freshTimer = setTimeout(() => root.classList.remove("fresh"), 400);
      }
      wasEngagedVisible = engagedVisible;
      root.classList.toggle("on", visible);
      root.classList.toggle("paused", visible && !engaged);
      root.classList.toggle("idle", visible && engaged && s.idle);
      if (s.stick !== null) {
        stick.classList.add("live");
        stick.style.transform = `translate(${s.stick.anchorX}px, ${s.stick.anchorY}px)`;
        thumb.style.transform = `translate(${s.stick.dx}px, ${s.stick.dy}px)`;
      } else {
        stick.classList.remove("live");
        thumb.style.transform = "translate(0px, 0px)";
      }
      lamp.classList.toggle("pressed", s.lampPressed);
      pause.classList.toggle("pressed", s.pausePressed);
      lamp.classList.toggle("lit", s.lampOn);
      if (s.lampOn !== wasLampOn) {
        wasLampOn = s.lampOn;
        lamp.classList.add("pulse");
        clearTimeout(pulseTimer);
        pulseTimer = setTimeout(() => lamp.classList.remove("pulse"), 300);
      }
    },
    show() {
      visible = true;
      root.classList.remove("off");
    },
    dispose() {
      clearTimeout(pulseTimer);
      clearTimeout(freshTimer);
      canvas.removeEventListener("pointerdown", onCanvasDown);
      canvas.removeEventListener("pointermove", onCanvasMove);
      canvas.removeEventListener("pointerup", onCanvasUp);
      canvas.removeEventListener("pointercancel", onCanvasCancel);
      root.remove();
      style.remove();
    },
  };
}
