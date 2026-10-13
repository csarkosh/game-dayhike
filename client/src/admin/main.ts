/**
 * The admin page: who is playing right now, and what the telemetry says of
 * the last day, week, month or quarter. A page of its own on the shared admin
 * host (admin.csarko.sh/game-dayhike/, the csarko.sh repository's `admin/`),
 * built apart from the game (`vite.admin.config.ts`) and sharing nothing with
 * it: the game's bundle carries none of this.
 *
 * Behind the host's sign-in (`auth.ts`). With `?preview` the page shows the
 * sample data set (`sample.ts`) with no sign-in, for looking at the page
 * itself; otherwise it asks for a Google account, once for every app on the
 * host, and shows the real numbers to an account on the allowlist (the
 * server's admin routes decide, not this page).
 */

import { el } from "./charts.js";
import { sampleSource } from "./sample.js";
import { remoteSource, type Range, type Source } from "./source.js";
import { requireSession, signOut, UNAUTHORIZED, type User } from "./auth.js";
import { errorsView, funnelView, healthView, liveView, lobbiesView, progressView, sessionDrawer } from "./views.js";
import { pathsCard, trailBuilder } from "./paths.js";

const RANGES: { days: Range; label: string }[] = [
  { days: 1, label: "Today" },
  { days: 7, label: "7 days" },
  { days: 30, label: "30 days" },
  { days: 90, label: "90 days" },
];
const LIVE_EVERY_MS = 10_000;

const root = document.querySelector<HTMLDivElement>("#admin");
if (root === null) throw new Error("#admin not found");

const params = new URLSearchParams(location.search);
const preview = params.has("preview");
// `?theme=light|dark` overrides the OS scheme, for looking at both; the
// host's stylesheet reads the attribute.
const theme = params.get("theme");
if (theme === "light" || theme === "dark") document.documentElement.dataset.theme = theme;

/** Why there is nothing to show: a build without the routes' address, or an answer they refused. */
function notice(title: string, line: string): void {
  root!.replaceChildren(el("div", { class: "gate" }, el("h1", {}, title), el("p", { class: "note" }, line)));
}

/** The admin routes' base: the telemetry service, whose `/t` is the batches' route. */
function adminBase(): string | null {
  const url = import.meta.env.VITE_TELEMETRY_URL;
  if (!url) return null;
  return url.replace(/\/t$/, "");
}

/**
 * The page itself, for the account given (null for the sample). Returns what
 * stops its live refresh, for when the account signs out or is refused: the
 * shell hides the page behind its gate then, and the refresh would otherwise
 * keep asking, and keep being refused, every ten seconds.
 */
function dashboard(source: Source, account: User | null): () => void {
  let range: Range = 7;
  // The trail builder, one worker for the page's life, its answers kept.
  const trailFor = trailBuilder();
  const who = el("div", { class: "who" }, el("span", { class: `badge${source.kind === "sample" ? " sample" : ""}` }, source.kind === "sample" ? "Sample data" : "Live"));
  if (account !== null) {
    // The session is the host's, shared by every app's page: signing out here
    // signs out of all of them, and the shell's gate comes back on its own.
    const out = el("button", { class: "ghost", type: "button" }, "Sign out");
    out.addEventListener("click", () => {
      stop();
      void signOut();
    });
    who.append(el("span", {}, account.email), out);
  }
  const top = el("div", { class: "top" }, el("h1", {}, "Day Hike admin"), el("span", { class: "badge" }, "games.csarko.sh/dayhike"), who);
  const buttons = RANGES.map((r) => {
    const b = el("button", { type: "button", "aria-pressed": String(r.days === range) }, r.label);
    b.addEventListener("click", () => {
      range = r.days;
      for (const other of buttons) other.setAttribute("aria-pressed", String(other === b));
      void load();
    });
    return b;
  });
  const filters = el("div", { class: "filters" }, el("span", { class: "label" }, "Range"), ...buttons);
  const liveSlot = el("div", { class: "grid" });
  const grid = el("div", { class: "grid" });
  root!.replaceChildren(top, filters, liveSlot, el("div", { style: "height:16px" }), grid);
  // A session id anywhere on the page opens its timeline in a drawer.
  root!.addEventListener("click", (event) => {
    const target = event.target;
    if (!(target instanceof HTMLElement)) return;
    const link = target.closest<HTMLElement>("[data-sid]");
    if (link === null || link.dataset.sid === undefined) return;
    event.preventDefault();
    const sid = link.dataset.sid;
    const drawer = sessionDrawer(sid, source.session(sid));
    document.body.append(drawer);
  });

  async function refreshLive(): Promise<void> {
    try {
      liveSlot.replaceChildren(liveView(await source.live()));
    } catch (error) {
      liveSlot.replaceChildren(el("section", { class: "card" }, el("h2", {}, "Right now"), el("p", { class: "sub" }, `Could not read the rooms: ${error instanceof Error ? error.message : String(error)}`)));
    }
  }

  let loading = 0;
  async function load(): Promise<void> {
    const token = ++loading;
    for (const card of grid.children) card.classList.add("loading");
    try {
      const [funnel, lobbies, progress, errors, health, paths] = await Promise.all([
        source.query("funnel", range),
        source.query("lobbies", range),
        source.query("progress", range),
        source.query("errors", range),
        source.query("health", range),
        source.query("paths", range),
      ]);
      if (token !== loading) return;
      grid.replaceChildren(funnelView(funnel), lobbiesView(lobbies), progressView(progress), errorsView(errors), healthView(health), pathsCard(paths, trailFor));
    } catch (error) {
      if (token !== loading) return;
      grid.replaceChildren(el("section", { class: "card" }, el("h2", {}, "The numbers could not be read"), el("p", { class: "sub" }, error instanceof Error ? error.message : String(error))));
    }
  }

  void refreshLive();
  void load();
  const timer = setInterval(() => void refreshLive(), LIVE_EVERY_MS);
  const stop = (): void => clearInterval(timer);
  window.addEventListener("pagehide", stop);
  return stop;
}

if (preview) {
  const sample = sampleSource();
  dashboard(sample, null);
  // `?preview&session=<id>` opens a session's drawer at once, for looking at it.
  const open = params.get("session");
  if (open !== null) document.body.append(sessionDrawer(open, sample.session(open)));
} else {
  const base = adminBase();
  if (base === null) {
    notice("Day Hike admin", "This build has no admin routes. Add ?preview to the address to see the page with sample data.");
  } else {
    const source = remoteSource(base);
    // What stops the page shown last, if one is; nothing until then.
    let stop: (() => void) | null = null;
    // The gate, then the page; the first request proves the account is on the
    // list, and a refusal (a 401) is the shell's to show: its gate comes back
    // with "<email> is not on the list." and a Sign out, so another account
    // can be tried. Anything else is this page's to say.
    const start = (account: User): void => {
      source
        .live()
        .then(() => {
          stop?.();
          stop = dashboard(source, account);
        })
        .catch((error: unknown) => {
          const message = error instanceof Error ? error.message : String(error);
          if (!message.endsWith(": 401")) notice("Day Hike admin", `Could not reach the admin routes: ${message}`);
        });
    };
    // A request refused after the page was shown: the shell has put its gate
    // over the page, and the live refresh stops asking for an account that was
    // turned away. The shell's listener does the rest.
    window.addEventListener(UNAUTHORIZED, () => {
      stop?.();
      stop = null;
    });
    requireSession(root, start);
  }
}
