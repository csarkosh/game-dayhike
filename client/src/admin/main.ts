/**
 * The admin page: who is playing right now, and what the telemetry says of
 * the last day, week, month or quarter. A page of its own under the site
 * (`/dayhike/admin/`), built beside the game and sharing nothing with it but
 * the favicon: the game's bundle carries none of this.
 *
 * Behind a sign-in. With `?preview` the page shows the sample data set
 * (`sample.ts`) with no sign-in, for looking at the page itself; otherwise it
 * asks for a Google account and shows the real numbers to an account on the
 * allowlist (the server's admin routes decide, not this page).
 */

import { el } from "./charts.js";
import { sampleSource } from "./sample.js";
import { remoteSource, type Range, type Source } from "./source.js";
import { authConfig, createSession, type Session } from "./auth.js";
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
// `?theme=light|dark` overrides the OS scheme, for looking at both.
const theme = params.get("theme");
if (theme === "light" || theme === "dark") document.documentElement.dataset.theme = theme;

/** The gate: a sign-in button, or why there is none; a line for a refused account. */
function gate(session: Session | null, note: string | null): void {
  const button = el("button", { type: "button", ...(session === null ? { disabled: "" } : {}) }, "Sign in with Google");
  const line = el("p", { class: "note" }, note ?? (session === null ? "This build has no sign-in. Add ?preview to the address to see the page with sample data." : "An account on the list."));
  button.addEventListener("click", () => {
    if (session === null) return;
    void session.signIn().catch((error: unknown) => {
      line.textContent = `Could not sign in: ${error instanceof Error ? error.message : String(error)}`;
    });
  });
  root!.replaceChildren(el("div", { class: "gate" }, el("h1", {}, "Day Hike admin"), el("p", {}, "Who is playing, and how it went."), button, line));
}

/** The admin routes' base: the telemetry service, whose `/t` is the batches' route. */
function adminBase(): string | null {
  const url = import.meta.env.VITE_TELEMETRY_URL;
  if (!url) return null;
  return url.replace(/\/t$/, "");
}

function dashboard(source: Source, account: { email: string; signOut(): Promise<void> } | null): void {
  let range: Range = 7;
  // The trail builder, one worker for the page's life, its answers kept.
  const trailFor = trailBuilder();
  const who = el("div", { class: "who" }, el("span", { class: `badge${source.kind === "sample" ? " sample" : ""}` }, source.kind === "sample" ? "Sample data" : "Live"));
  if (account !== null) {
    const out = el("button", { class: "ghost", type: "button" }, "Sign out");
    out.addEventListener("click", () => void account.signOut());
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
  window.addEventListener("pagehide", () => clearInterval(timer));
}

if (preview) {
  const sample = sampleSource();
  dashboard(sample, null);
  // `?preview&session=<id>` opens a session's drawer at once, for looking at it.
  const open = params.get("session");
  if (open !== null) document.body.append(sessionDrawer(open, sample.session(open)));
} else {
  const config = authConfig(import.meta.env);
  const base = adminBase();
  if (config === null || base === null) {
    gate(null, null);
  } else {
    const session = createSession(config);
    let shown: string | null = null;
    session.watch((user) => {
      if (user === null) {
        shown = null;
        gate(session, null);
        return;
      }
      if (shown === user.email) return;
      shown = user.email;
      // The server decides whether the account is on the list: a 401 on
      // the first request sends the page back to the gate with the reason.
      const source = remoteSource(base, user.token);
      source
        .live()
        .then(() => dashboard(source, { email: user.email, signOut: () => session.signOut() }))
        .catch((error: unknown) => {
          shown = null;
          const message = error instanceof Error ? error.message : String(error);
          gate(session, message.endsWith(": 401") ? `${user.email} is not on the list. Sign out and try another account.` : `Could not reach the admin routes: ${message}`);
        });
    });
  }
}
