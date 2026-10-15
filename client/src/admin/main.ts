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
import { errorsView, failedCard, funnelView, healthView, liveView, lobbiesView, progressView, sessionDrawer, sessionsDrawer, visitorsView, waitingCard } from "./views.js";
import { pathsCard, trailBuilder } from "./paths.js";

/** The ranges, in New York calendar days back from today: "Today" is that calendar day, "7 days" today and the six before. */
const RANGES: { days: Range; label: string; title: string }[] = [
  { days: 1, label: "Today", title: "The New York calendar day" },
  { days: 7, label: "7 days", title: "Today and the six New York days before" },
  { days: 30, label: "30 days", title: "Today and the 29 New York days before" },
  { days: 90, label: "90 days", title: "Today and the 89 New York days before" },
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

/**
 * The source the drawers read from: the page shown last. A session, visitor or
 * match id anywhere on the page or in a drawer opens its drawer over whatever
 * is open; the listener is on the document, once, since the drawers are
 * appended to the body and the page can be shown more than once (a sign-in
 * after a sign-out).
 */
let drawerSource: Source | null = null;
document.addEventListener("click", (event) => {
  const target = event.target;
  if (!(target instanceof HTMLElement) || drawerSource === null) return;
  const link = target.closest<HTMLElement>("[data-sid], [data-vid], [data-game]");
  if (link === null) return;
  event.preventDefault();
  const source = drawerSource;
  const { sid, vid, game } = link.dataset;
  if (sid !== undefined) document.body.append(sessionDrawer(sid, source.session(sid)));
  else if (vid !== undefined) document.body.append(sessionsDrawer("visitor", vid, source.visitor(vid)));
  else if (game !== undefined) document.body.append(sessionsDrawer("match", game, source.match(game)));
});

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
  drawerSource = source;
  const buttons = RANGES.map((r) => {
    const b = el("button", { type: "button", "aria-pressed": String(r.days === range), title: r.title }, r.label);
    b.addEventListener("click", () => {
      range = r.days;
      for (const other of buttons) other.setAttribute("aria-pressed", String(other === b));
      void load();
    });
    return b;
  });
  const filters = el("div", { class: "filters" }, el("span", { class: "label", title: "New York calendar days" }, "Range"), ...buttons);
  const liveSlot = el("div", { class: "grid" });
  const grid = el("div", { class: "grid" });
  root!.replaceChildren(filters, liveSlot, el("div", { style: "height:16px" }), grid);

  async function refreshLive(): Promise<void> {
    try {
      liveSlot.replaceChildren(liveView(await source.live()));
    } catch (error) {
      liveSlot.replaceChildren(el("section", { class: "card" }, el("h2", {}, "Right now"), el("p", { class: "sub" }, `Could not read the rooms: ${error instanceof Error ? error.message : String(error)}`)));
    }
  }

  // The seven cards, each over one query or two: each is on the page at once
  // as a skeleton the shape of what it waits for, fills on its own as its
  // queries answer, and shows its own error, so a slow or failed query holds
  // only its card. The title and copy here are the waiting card's; the
  // rendered card brings its own, with what the rows say.
  const CARDS: { names: QueryName[]; title: string; sub: string; cls: string; shape: { tiles?: number; chart?: boolean; lines?: number }; render(rows: Row[][]): HTMLElement }[] = [
    { names: ["funnel"], title: "From landing to the end", sub: "Sessions by what they reached, each stage of the one before", cls: "half", shape: { chart: true, lines: 3 }, render: ([rows = []]) => funnelView(rows) },
    { names: ["lobbies"], title: "Lobbies a day", sub: "From signaling's own rows", cls: "half", shape: { chart: true, lines: 1 }, render: ([rows = []]) => lobbiesView(rows) },
    { names: ["kpis", "visitors"], title: "Visitors", sub: "Distinct browsers in this range, and how many came back on another day", cls: "", shape: { tiles: 3, lines: 3 }, render: ([kpis = [], visitors = []]) => visitorsView(kpis, visitors) },
    { names: ["progress"], title: "How far parties got", sub: "One line a match; each match's farthest climb, 0 at the trailhead and 1 at the crest; the night falls from 30%", cls: "", shape: { chart: true, lines: 4 }, render: ([rows = []]) => progressView(rows) },
    { names: ["errors"], title: "What went wrong", sub: "Problems in this range, grouped by their first hundred characters", cls: "", shape: { lines: 4 }, render: ([rows = []]) => errorsView(rows) },
    { names: ["health"], title: "Load times and frame rates", sub: "By build, tier and engine; the start is the tier's decision, the engine and the build, the ready is the world's first whole frame", cls: "", shape: { tiles: 5, lines: 3 }, render: ([rows = []]) => healthView(rows) },
    { names: ["paths"], title: "Where parties went", sub: "One world at a time: the trail rebuilt from its seed, each session's path over it", cls: "", shape: { chart: true, lines: 2 }, render: ([rows = []]) => pathsCard(rows, trailFor) },
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
          const rows = await Promise.all(c.names.map((name) => source.query(name, range)));
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
  // `?preview&session=<id>` opens a session's drawer at once, for looking at
  // it; `&visitor=<id>` and `&match=<id>` the lists of sessions.
  const session = params.get("session");
  if (session !== null) document.body.append(sessionDrawer(session, sample.session(session)));
  const visitor = params.get("visitor");
  if (visitor !== null) document.body.append(sessionsDrawer("visitor", visitor, sample.visitor(visitor)));
  const match = params.get("match");
  if (match !== null) document.body.append(sessionsDrawer("match", match, sample.match(match)));
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
