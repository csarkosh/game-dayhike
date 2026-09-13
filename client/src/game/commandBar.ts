const STYLE = `
  .cmdbar {
    position: absolute; left: 0; right: 0; bottom: 0; padding: 0.5rem 0.75rem;
    background: rgba(0,0,0,0.75); font-family: ui-monospace, monospace;
    display: none;
  }
  .cmdbar.open { display: block; }
  .cmdbar input {
    width: 100%; background: transparent; border: 0; outline: 0;
    color: #fff; font: inherit; font-size: 1rem;
  }
  .cmdbar .error { color: #ff8a7d; font-size: 0.85rem; padding-top: 0.25rem; }
`;

export type CommandBar = {
  open(): void;
  close(): void;
  readonly isOpen: boolean;
  showError(message: string): void;
  dispose(): void;
};

/**
 * A single-line command entry across the bottom of the page.
 *
 * Deliberately ignorant of what commands do: it collects a line, hands it to
 * `onSubmit`, and displays whatever error comes back. `onOpenChange` is how the
 * caller suppresses movement input while typing.
 *
 * Built with DOM APIs and `textContent` rather than innerHTML, matching the
 * HUD's rule that anything carrying arbitrary text cannot become markup.
 */
export function createCommandBar(
  container: HTMLElement,
  options: { onSubmit(line: string): string | null; onOpenChange(open: boolean): void },
): CommandBar {
  const style = document.createElement("style");
  style.textContent = STYLE;

  const root = document.createElement("div");
  root.className = "cmdbar";

  const input = document.createElement("input");
  input.type = "text";
  input.spellcheck = false;
  input.autocomplete = "off";

  const error = document.createElement("div");
  error.className = "error";

  root.append(input, error);
  container.append(style, root);

  let isOpen = false;

  function setOpen(next: boolean): void {
    if (isOpen === next) return;
    isOpen = next;
    root.classList.toggle("open", next);
    options.onOpenChange(next);
  }

  function open(): void {
    setOpen(true);
    error.textContent = "";
    // Pre-filled rather than fed the keystroke, so the `/` that opened the bar
    // is not also typed into it.
    input.value = "/";
    // Text entry needs focus, which pointer lock prevents.
    document.exitPointerLock();
    input.focus();
    // Put the caret after the slash.
    input.setSelectionRange(1, 1);
  }

  function close(): void {
    // Pointer lock is re-acquired by the caller, through `onOpenChange(false)`:
    // the bar has no reference to the sampler and is not given one for this.
    setOpen(false);
    input.value = "";
    error.textContent = "";
    input.blur();
  }

  const onKeyDown = (e: KeyboardEvent) => {
    if (!isOpen) {
      if (e.key === "/") {
        e.preventDefault();
        open();
      }
      return;
    }
    if (e.key === "Escape") {
      e.preventDefault();
      close();
      return;
    }
    if (e.key === "Enter") {
      e.preventDefault();
      const message = options.onSubmit(input.value);
      // An unrecognised command leaves the bar open showing why. Closing
      // silently would train you to distrust it.
      if (message === null) close();
      else error.textContent = message;
    }
  };

  window.addEventListener("keydown", onKeyDown);

  return {
    open,
    close,
    get isOpen() {
      return isOpen;
    },
    showError(message) {
      setOpen(true);
      error.textContent = message;
    },
    dispose() {
      window.removeEventListener("keydown", onKeyDown);
      root.remove();
      style.remove();
    },
  };
}
