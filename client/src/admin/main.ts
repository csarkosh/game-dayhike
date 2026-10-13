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
import { remoteSource, type QueryName, type Range, type Row, type Source } from "./source.js";
import { accountMenu, requireSession, UNAUTHORIZED, type User } from "./auth.js";
import { errorsView, failedCard, funnelView, healthView, liveView, lobbiesView, progressView, sessionDrawer, waitingCard } from "./views.js";
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
  // The chrome is the host's markup (`client/admin/index.html`, the same as
  // csarko.sh's own dashboard), and the nav's account menu (the Live or Sample
  // badge, the email, Sign out) is the shell's: `accountMenu` renders it. The
  // session is the host's, shared by every app's page: signing out there signs
  // out of all of them, and the shell's gate comes back on its own; the live
  // refresh stops through the UNAUTHORIZED listener and the auth state change.
  const accountHost = document.querySelector<HTMLElement>("#account");
  if (accountHost !== null) accountMenu(accountHost, { account, preview: source.kind === "sample" });
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
  root!.replaceChildren(filters, liveSlot, el("div", { style: "height:16px" }), grid);
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

  // The six cards, one a query: each is on the page at once as a skeleton the
  // shape of what it waits for, fills on its own as its query answers, and
  // shows its own error, so a slow or failed query holds only its card. The
  // title and copy here are the waiting card's; the rendered card brings its
  // own, with what the rows say.
  const CARDS: { name: QueryName; title: string; sub: string; cls: string; shape: { tiles?: number; chart?: boolean; lines?: number }; render(rows: Row[]): HTMLElement }[] = [
    { name: "funnel", title: "From landing to the end", sub: "Sessions by what they reached", cls: "half", shape: { chart: true, lines: 3 }, render: funnelView },
    { name: "lobbies", title: "Lobbies a day", sub: "From signaling's own rows", cls: "half", shape: { chart: true, lines: 1 }, render: lobbiesView },
    { name: "progress", title: "How far parties got", sub: "Each match's farthest climb, 0 at the trailhead and 1 at the crest; the night falls from 30%", cls: "", shape: { chart: true, lines: 4 }, render: progressView },
    { name: "errors", title: "What went wrong", sub: "Problems in this range, grouped by their first hundred characters", cls: "", shape: { lines: 4 }, render: errorsView },
    { name: "health", title: "Load times and frame rates", sub: "By build, tier and engine; the start is the tier's decision, the engine and the build, the ready is the world's first whole frame", cls: "", shape: { tiles: 4, lines: 3 }, render: healthView },
    { name: "paths", title: "Where parties went", sub: "One world at a time: the trail rebuilt from its seed, each session's path over it", cls: "", shape: { chart: true, lines: 2 }, render: (rows) => pathsCard(rows, trailFor) },
  ];
  const slots = CARDS.map((c) => waitingCard(c.title, c.sub, c.cls, c.shape));
  grid.replaceChildren(...slots);

  let loading = 0;
  async function load(): Promise<void> {
    const token = ++loading;
    await Promise.all(
      CARDS.map(async (c, i) => {
        const slot = slots[i];
        if (slot === undefined) return;
        // A skeleton is already the loading state; a rendered card dims while it reloads.
        if (slot.querySelector(".skeleton") === null) slot.classList.add("loading");
        let next: HTMLElement;
        try {
          const rows = await source.query(c.name, range);
          if (token !== loading) return;
          next = c.render(rows);
        } catch (error) {
          if (token !== loading) return;
          next = failedCard(c.title, c.sub, c.cls, error instanceof Error ? error.message : String(error));
        }
        slot.replaceWith(next);
        slots[i] = next;
      }),
    );
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
