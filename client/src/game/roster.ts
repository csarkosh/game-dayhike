import type { RosterView } from "./rosterModel.js";

/**
 * The roster. Mounted once on document.body by main.ts so the
 * per-route `replaceChildren` on #app never touches it, and repainted from a
 * `RosterView`. DOM APIs and textContent only: names come from other peers.
 *
 * Bottom-right, Halo-style: a header with the count and the invite, then one
 * row per member. While a match is being played the panel ignores the pointer
 * (it is locked) and is faded; on the pause menu it comes back to full and
 * takes the pointer again, so Invite and Copy work there. The name field is
 * offered on the landing page only — renaming mid-match is the one thing the
 * pause menu still does not offer.
 *
 * While a lobby is being opened the invite control becomes a stage label and a
 * bar, and after long enough a Retry: a cold signaling instance can take
 * seconds to answer, and the panel used to spend all of it looking untouched.
 */
const STYLE = `
  .roster {
    position: fixed; right: 0.75rem; bottom: 0.75rem; z-index: 20;
    min-width: 14rem; max-width: 22rem;
    font-family: ui-monospace, monospace; font-size: 0.85rem; color: #fff;
    background: rgba(16, 16, 20, 0.72); border: 1px solid rgba(198, 222, 222, 0.20);
    border-radius: 6px; padding: 0.5rem 0.6rem; backdrop-filter: blur(4px);
    /* The same rim-light the controls inside carry, so the panel reads as one
       lit slab rather than a box with lit things in it. */
    box-shadow: inset 0 1px 0 rgba(226, 236, 236, 0.14), 0 6px 22px rgba(0, 0, 0, 0.32);
    transition: opacity 250ms ease;

    /* The cold cast the controls are drawn in — the part of it this panel
       uses. pauseMenu.ts and landing.ts carry the same tokens, deliberately
       repeated rather than shared: each renderer owns exactly one STYLE
       literal, and the pale slab these replace was already written out in all
       three. Change one, change all three; landing.ts has the full set. */
    --btn-edge-lit: rgba(214, 234, 234, 0.58);
    --btn-bloom: rgba(198, 222, 222, 0.24);
    --btn-solid: rgba(214, 234, 234, 0.48);
    --btn-solid-lit: rgba(232, 248, 248, 0.68);
    --btn-solid-hit: rgba(242, 253, 253, 0.86);
  }
  /* Playing: the pointer is locked to the canvas and there is nothing to click. */
  .roster.locked { pointer-events: none; }
  /* Playing: the game has the screen. Full again on the pause menu. */
  .roster.subdued { opacity: 0.35; backdrop-filter: none; }
  /* Playing on touch: the screen belongs to the controls. */
  .roster.hidden { opacity: 0; pointer-events: none; transition: opacity 200ms ease; }
  @media (max-width: 480px) {
    .roster { left: 1rem; right: 1rem; min-width: 0; max-width: none; }
  }
  @media (max-height: 420px) {
    .roster { min-width: 0; max-width: 40vw; }
  }
  .roster .head {
    display: flex; align-items: center; justify-content: space-between; gap: 0.5rem;
    margin-bottom: 0.4rem; color: rgba(255, 255, 255, 0.62);
    letter-spacing: 0.08em; text-transform: uppercase; font-size: 0.7rem;
  }
  .roster button {
    font: inherit; font-size: 0.75rem; cursor: pointer; color: #0c0f11;
    /* The header's vocabulary, carried onto the controls beside it. */
    letter-spacing: 0.1em; text-transform: uppercase;
    /* A fixed gradient over an animated flat colour: only background-color
       moves between states, which interpolates cleanly and costs nothing,
       while the sheen keeps the slab from reading as a flat wash. */
    background-image: linear-gradient(rgba(255, 255, 255, 0.20), rgba(198, 222, 222, 0));
    background-color: var(--btn-solid);
    border: 1px solid var(--btn-solid);
    border-radius: 4px; padding: 0.2rem 0.6rem;
    box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.40), 0 0 0 rgba(198, 222, 222, 0);
    /* No lift here, unlike the landing and pause menu: on a control this short
       a 1 px rise reads as jitter rather than as weight, so the press is
       carried entirely by colour and bloom. */
    transition:
      background-color 160ms ease-out, border-color 160ms ease-out,
      box-shadow 160ms ease-out;
  }
  .roster button:hover:not([disabled]) {
    background-color: var(--btn-solid-lit); border-color: var(--btn-solid-lit);
    box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.5), 0 0 12px var(--btn-bloom);
  }
  /* A finger gets no hover, and Invite and Copy are the two controls a phone
     actually reaches. Faster than the hover so the press reads as mechanical. */
  .roster button:active:not([disabled]) {
    background-color: var(--btn-solid-hit); border-color: var(--btn-solid-hit);
    box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.5), 0 0 5px var(--btn-bloom);
    transition-duration: 70ms;
  }
  /* These are keyboard-reachable and showed no focus at all. */
  .roster button:focus-visible { outline: 2px solid var(--btn-edge-lit); outline-offset: 2px; }
  .roster button[disabled] { opacity: 0.45; cursor: default; box-shadow: none; }
  /* The stage the attempt is in, in place of the button it replaces. */
  .roster .stage { color: rgba(255, 255, 255, 0.82); }
  .roster .bar {
    height: 2px; margin-bottom: 0.45rem; border-radius: 1px;
    background: rgba(255, 255, 255, 0.14); overflow: hidden;
  }
  .roster .bar span {
    display: block; height: 100%; width: 0;
    background: rgba(255, 255, 255, 0.72);
    /* Smooths the 100 ms ticks into motion, and gives the milestone snap a
       shape. Linear, because an eased tick reads as stuttering. */
    transition: width 120ms linear;
  }
  .roster .stalled {
    display: flex; align-items: center; justify-content: space-between; gap: 0.5rem;
    margin-bottom: 0.4rem; color: rgba(255, 255, 255, 0.62); font-size: 0.75rem;
  }
  .roster .invite { display: flex; gap: 0.4rem; align-items: center; margin-bottom: 0.4rem; }
  .roster .invite input {
    flex: 1; min-width: 0; font: inherit; font-size: 0.7rem; color: rgba(255, 255, 255, 0.85);
    background: rgba(255, 255, 255, 0.08); border: 1px solid rgba(255, 255, 255, 0.25);
    border-radius: 4px; padding: 0.2rem 0.4rem;
  }
  .roster ul { list-style: none; margin: 0; padding: 0; }
  .roster li {
    display: flex; align-items: center; gap: 0.5rem; padding: 0.25rem 0.3rem; border-radius: 4px;
  }
  .roster li.self { background: rgba(255, 255, 255, 0.1); }
  .roster li.self.editable { cursor: text; }
  .roster li .mark {
    font-size: 0.65rem; letter-spacing: 0.08em; color: #ffd24d; text-transform: uppercase;
  }
  .roster li input {
    flex: 1; min-width: 0; font: inherit; color: #fff; background: transparent;
    border: none; border-bottom: 1px solid rgba(255, 255, 255, 0.45); outline: none; padding: 0;
  }
  .roster .note { margin: 0.3rem 0 0; color: rgba(255, 255, 255, 0.45); font-size: 0.75rem; }
  .roster .error { margin: 0.3rem 0 0; color: #ff8a7d; font-size: 0.75rem; }
`;

export type Roster = {
  setView(view: RosterView): void;
  /**
   * Moves the pending bar without rebuilding the panel.
   *
   * `setView` rebuilds through `replaceChildren`, and the bar is repainted ten
   * times a second: driving it through `setView` would tear the Retry button
   * out from under a keyboard user every 100 ms, the same way the rename field
   * is guarded against. So the caller repaints the structure only when the
   * structure actually changes — the stage label, the Retry row — and moves
   * the bar through here in between. A no-op when nothing is pending.
   */
  setPendingProgress(progress: number): void;
  dispose(): void;
};

export function createRoster(handlers: {
  onInvite(): void;
  onRetry(): void;
  onRename(name: string): void;
}): Roster {
  const style = document.createElement("style");
  style.textContent = STYLE;
  const root = document.createElement("aside");
  root.className = "roster";
  root.setAttribute("aria-label", "Party");
  document.body.append(style, root);

  let editing = false;
  // Held so dispose() can cancel it: the timer's callback touches a button
  // that may already be gone by the time it fires.
  let copyReset: ReturnType<typeof setTimeout> | undefined;
  // The live bar fill, so `setPendingProgress` can move it between paints.
  // Null whenever the current view has no bar in it.
  let barFill: HTMLSpanElement | null = null;

  function paint(view: RosterView): void {
    if (editing) return; // never yank the field out from under a typist
    root.classList.toggle("locked", !view.interactive);
    root.classList.toggle("subdued", view.presence === "subdued");
    root.classList.toggle("hidden", view.presence === "hidden");
    const parts: Node[] = [];

    const head = document.createElement("div");
    head.className = "head";
    const count = document.createElement("span");
    count.textContent = `Party ${view.count.members} / ${view.count.max}`;
    head.append(count);
    if ("action" in view.invite) {
      const invite = document.createElement("button");
      invite.type = "button";
      invite.className = "create";
      invite.textContent = "Invite";
      // Disabled the instant an attempt starts, well before the bar is worth
      // drawing: the guard in main.ts would refuse a second attempt anyway,
      // and a button that still looks live while being ignored is the thing
      // this whole pending state exists to stop.
      invite.disabled = view.invite.busy;
      invite.addEventListener("click", handlers.onInvite);
      head.append(invite);
    }
    if ("pending" in view.invite) {
      const stage = document.createElement("span");
      stage.className = "stage";
      stage.textContent = view.invite.pending.label;
      head.append(stage);
    }
    parts.push(head);

    barFill = null;
    if ("pending" in view.invite) {
      const track = document.createElement("div");
      track.className = "bar";
      const fill = document.createElement("span");
      fill.style.width = `${(view.invite.pending.progress * 100).toFixed(1)}%`;
      track.append(fill);
      parts.push(track);
      barFill = fill;

      if (view.invite.pending.overrun) {
        const row = document.createElement("div");
        row.className = "stalled";
        const note = document.createElement("span");
        note.textContent = "Still waiting…";
        const retry = document.createElement("button");
        retry.type = "button";
        retry.className = "retry";
        retry.textContent = "Retry";
        retry.addEventListener("click", handlers.onRetry);
        row.append(note, retry);
        parts.push(row);
      }
    }

    if ("url" in view.invite) {
      const row = document.createElement("div");
      row.className = "invite";
      const field = document.createElement("input");
      field.type = "text";
      field.readOnly = true;
      field.value = view.invite.url;
      field.addEventListener("focus", () => field.select());
      const copy = document.createElement("button");
      copy.type = "button";
      copy.className = "copy";
      copy.textContent = "Copy";
      copy.addEventListener("click", () => {
        const url = field.value;
        const done = () => {
          copy.textContent = "Copied";
          clearTimeout(copyReset);
          copyReset = setTimeout(() => {
            copy.textContent = "Copy";
          }, 1200);
        };
        // Clipboard access needs a secure context and a gesture; this is the
        // gesture, and the fallback is the selected field the user can copy.
        if (navigator.clipboard?.writeText) {
          navigator.clipboard.writeText(url).then(done, () => field.select());
        } else {
          field.select();
        }
      });
      // The share sheet where the browser has one: on a phone that is how a
      // link gets to a friend. Copy stays beside it for everyone.
      const share = view.share && typeof navigator.share === "function"
        ? (() => {
            const b = document.createElement("button");
            b.type = "button";
            b.className = "share";
            b.textContent = "Share";
            b.addEventListener("click", () => {
              void navigator.share({ url: field.value }).catch(() => field.select());
            });
            return b;
          })()
        : null;
      row.append(field, copy);
      if (share !== null) row.append(share);
      parts.push(row);
    }

    const list = document.createElement("ul");
    for (const r of view.rows) {
      const item = document.createElement("li");
      item.classList.toggle("self", r.isSelf);
      item.classList.toggle("editable", r.isSelf && view.editable);
      const name = document.createElement("span");
      name.className = "name";
      name.textContent = r.name;
      item.append(name);
      if (r.isHost) {
        const mark = document.createElement("span");
        mark.className = "mark";
        mark.textContent = "host";
        item.append(mark);
      }
      if (r.isSelf && view.editable) {
        item.title = "Click to change your name";
        item.addEventListener("click", () => beginEdit(name, r.name));
      }
      list.append(item);
    }
    parts.push(list);

    if (view.joining) {
      const note = document.createElement("p");
      note.className = "note";
      note.textContent = "Joining…";
      parts.push(note);
    }
    if (view.error !== undefined) {
      const error = document.createElement("p");
      error.className = "error";
      error.textContent = view.error;
      parts.push(error);
    }
    root.replaceChildren(...parts);
    // The landing's panels reserve this much at the bottom on a phone, where
    // the roster is a fixed full-width panel: without it the Back button and
    // the last credit scroll in underneath it, and the reservation has to
    // grow with the party, so it is measured rather than guessed.
    document.documentElement.style.setProperty("--roster-height", `${root.offsetHeight}px`);
  }

  function beginEdit(label: HTMLSpanElement, current: string): void {
    if (editing) return;
    editing = true;
    const field = document.createElement("input");
    field.type = "text";
    field.maxLength = 24;
    field.value = current;
    field.autocomplete = "off";
    field.spellcheck = false;
    label.replaceWith(field);
    field.focus();
    field.select();
    let finished = false;
    // The contract with main.ts: `onRename` MUST lead to a `setView` repaint.
    // That repaint is what removes this field — committing does not replace it
    // with the label, because the repainted row carries the new name — so
    // without one the input stays on screen and inert.
    const finish = (commit: boolean) => {
      if (finished) return;
      finished = true;
      editing = false;
      if (commit) handlers.onRename(field.value);
      else field.replaceWith(label);
    };
    field.addEventListener("keydown", (e) => {
      if (e.key === "Enter") finish(true);
      else if (e.key === "Escape") finish(false);
      e.stopPropagation(); // the game's key handlers must not see typing
    });
    field.addEventListener("blur", () => finish(true));
  }

  return {
    setView: paint,
    setPendingProgress(progress) {
      if (barFill !== null) barFill.style.width = `${(progress * 100).toFixed(1)}%`;
    },
    dispose() {
      clearTimeout(copyReset);
      root.remove();
      style.remove();
    },
  };
}
