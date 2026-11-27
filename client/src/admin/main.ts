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
import { rangeFrom, remoteSource, searchWithRange, type QueryName, type Range, type Row, type Source } from "./source.js";
import { accountMenu, requireSession, UNAUTHORIZED, type User } from "./auth.js";
import { machinesView } from "./machines.js";
import { errorsView, failedCard, nowIndicator, overviewView, playersView, sessionDrawer, sessionsDrawer, waitingCard, type Shape } from "./views.js";
import { hold, settle } from "./hold.js";
import { fadeIn, fadeOut, tokens } from "./motion.js";
import { pathsSection, trailBuilder } from "./paths.js";
import { zoneName } from "./timeline.js";

/**
 * The ranges, in calendar days of the viewer's zone back from today: "Today"
 * is that calendar day, "7 days" today and the six before. Each title names
 * the zone (`PDT`).
 */
const RANGES: { days: Range; label: string; title: (zone: string) => string }[] = [
  { days: 1, label: "Today", title: (zone) => `Today, the calendar day in ${zone}` },
  { days: 7, label: "7 days", title: (zone) => `Today and the six before, calendar days in ${zone}` },
  { days: 30, label: "30 days", title: (zone) => `Today and the 29 before, calendar days in ${zone}` },
  { days: 90, label: "90 days", title: (zone) => `Today and the 89 before, calendar days in ${zone}` },
];
const LIVE_EVERY_MS = 30_000;

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

/**
 * A card keeps its element for the page's life, so its height can ease and its content fade
 * (Material 3 motion, Cyrus 2026-10-29): what a view renders, a whole card, moves into it.
 */
function adopt(card: HTMLElement, next: HTMLElement): void {
  card.className = next.className;
  card.replaceChildren(...next.childNodes);
}

/** What fades as a card's content changes: everything under its title, which stays. */
const content = (card: HTMLElement): HTMLElement[] => [...card.children].filter((node): node is HTMLElement => node instanceof HTMLElement && node.localName !== "h2");

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
 * keep asking, and keep being refused, every thirty seconds. `trailFor` is the
 * trail builder, one worker for the page's life, its answers kept; the sample
 * shares the page's so its trail is built once, off the main thread.
 */
function dashboard(source: Source, account: User | null | undefined, trailFor = trailBuilder()): () => void {
  let range: Range = rangeFrom(location.search);
  // The chrome is the host's markup (`client/admin/index.html`, the same as
  // csarko.sh's own dashboard), and the nav's account menu (the Live or Sample
  // badge, the email, Sign out) is the shell's: `accountMenu` renders it. The
  // session is the host's, shared by every app's page: signing out there signs
  // out of all of them, and the shell's gate comes back on its own; the live
  // refresh stops through the UNAUTHORIZED listener and the auth state change.
  const accountHost = document.querySelector<HTMLElement>("#account");
  // `undefined`: the session is still being restored, and the menu comes with it (below).
  if (accountHost !== null && account !== undefined) accountMenu(accountHost, { account, preview: source.kind === "sample" });
  drawerSource = source;
  const zone = zoneName();
  const buttons = RANGES.map((r) => {
    const b = el("button", { type: "button", "aria-pressed": String(r.days === range), title: r.title(zone) }, r.label);
    b.addEventListener("click", () => {
      range = r.days;
      history.replaceState(history.state, "", location.pathname + searchWithRange(location.search, range) + location.hash);
      for (const other of buttons) other.setAttribute("aria-pressed", String(other === b));
      void load();
    });
    return b;
  });
  // Who is playing now sits at the end of the range bar, one small mark (Cyrus, 2026-11-21:
  // a whole card was too big for how few play): it waits blank, then refreshes in place every
  // thirty seconds, the heartbeat's own pace, its words cross-fading (short3) when they change.
  const now = el("span", { class: "now", role: "status" }, el("span", { class: "dot", "aria-hidden": "true" }), el("span", { class: "words" }, "\u00a0"));
  const filters = el("div", { class: "filters" }, el("span", { class: "label", title: `Calendar days in ${zone}` }, "Range"), ...buttons, now);
  const grid = el("div", { class: "grid" });
  root!.replaceChildren(filters, grid);

  async function refreshLive(): Promise<void> {
    let next: HTMLElement;
    try {
      next = nowIndicator(await source.live());
    } catch (error) {
      next = el("span", { class: "now", role: "status", title: error instanceof Error ? error.message : String(error) }, el("span", { class: "dot", "aria-hidden": "true" }), el("span", { class: "words" }, "Playing now unknown"));
    }
    const before = now.textContent;
    now.className = next.className;
    now.title = next.title;
    now.replaceChildren(...next.childNodes);
    if (now.textContent !== before) fadeIn(now.querySelector(".words")!, tokens().short3);
  }

  // The three cards, each over a query or a few: each is on the page at once
  // as a skeleton the shape of what it waits for, fills on its own as its
  // queries answer, and shows its own error, so a slow or failed query holds
  // only its card. The title and copy here are the waiting card's; the
  // rendered card brings its own, with what the rows say.
  const CARDS: { names: QueryName[]; title: string; sub: string; cls: string; shape: Shape; render(rows: Row[][]): HTMLElement }[] = [
    { names: ["funnel", "places"], title: "Overview", sub: "", cls: "overview", shape: { rows: 2, row: 26 }, render: ([funnelRows = [], placeRows = []]) => overviewView(funnelRows, placeRows) },
    { names: ["kpis", "players"], title: "Players", sub: "Each person in this range, how far they got and how the game ran for them, and where they went", cls: "", shape: { tiles: 3, chart: 60, rows: 12, row: 34 }, render: ([kpis = [], players = []]) => playersView(kpis, players, wentSlot()) },
    { names: ["machines"], title: "Machines and tiers", sub: "How each kind of graphics chip ran on each tier, over this range", cls: "", shape: { rows: 6, row: 30 }, render: ([rows = []]) => machinesView(rows) },
    { names: ["errors"], title: "What went wrong", sub: "Problems in this range, grouped by their first hundred characters", cls: "", shape: { rows: 5 }, render: ([rows = []]) => errorsView(rows) },
  ];
  const slots = CARDS.map((c) => waitingCard(c.title, c.sub, c.cls, c.shape));

  // Where they went, the Players card's last part: its query (and in the sample, the trail it is
  // built on) is the slowest on the page, so the players show as soon as theirs answer and this
  // part fills in under them when its own does, fading in. A load started since drops it.
  function wentSlot(): HTMLElement {
    const asked = loading;
    const slot = el("div", { class: "where-went" }, el("h3", {}, "Where they went"), el("p", { class: "sub" }, "Reading the paths…"));
    void source.query("paths", range).then(
      (rows) => {
        if (asked !== loading) return;
        const section = pathsSection(rows, trailFor);
        slot.replaceWith(section);
        fadeIn(section);
      },
      (error: unknown) => {
        if (asked !== loading) return;
        slot.replaceChildren(el("h3", {}, "Where they went"), el("p", { class: "error", role: "status" }, `Could not be read. ${error instanceof Error ? error.message : String(error)}`));
      },
    );
    return slot;
  }
  grid.replaceChildren(...slots);
  const holdId = (c: (typeof CARDS)[number]): string => c.names.join("+");
  CARDS.forEach((c, i) => hold(slots[i]!, holdId(c)));

  let loading = 0;
  async function load(): Promise<void> {
    const token = ++loading;
    await Promise.all(
      CARDS.map(async (c, i) => {
        const slot = slots[i];
        if (slot === undefined) return;
        const answers = Promise.all(c.names.map((name) => source.query(name, range)));
        answers.catch(() => {});
        // A rendered card goes back to its skeleton while it reloads (its content fades out, the
        // skeleton in), held at the height this view had last, else the one it has now, so
        // nothing under it moves but by easing.
        if (slot.querySelector(".skeleton") === null) {
          const now = slot.getBoundingClientRect().height;
          hold(slot, holdId(c), now);
          await Promise.all(content(slot).map((node) => fadeOut(node)?.finished.catch(() => {})));
          if (token !== loading) return;
          adopt(slot, waitingCard(c.title, c.sub, c.cls, c.shape));
          content(slot).forEach((node) => fadeIn(node, tokens().short3));
          hold(slot, holdId(c), now);
        }
        let next: HTMLElement;
        try {
          const rows = await answers;
          if (token !== loading) return;
          next = c.render(rows);
        } catch (error) {
          if (token !== loading) return;
          next = failedCard(c.title, c.sub, c.cls, error instanceof Error ? error.message : String(error));
        }
        // The content fades in over the place its skeleton held, and the card eases from the
        // held height to its own, which is what it remembers.
        adopt(slot, next);
        content(slot).forEach((node) => fadeIn(node));
        settle(slot, holdId(c));
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
  const trails = trailBuilder();
  const sample = sampleSource(trails);
  dashboard(sample, null, trails);
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
    // The page from the first paint (Cyrus, 2026-10-29): restoring the sign-in takes a second
    // or so, and a page drawn only after it popped in and pushed everything down. Its cards
    // wait, held at their last heights, on a source whose every request is parked until the
    // session is restored and the routes have answered; then they fill in place.
    let openSource: (s: Source) => void = () => {};
    const opened = new Promise<Source>((resolve) => {
      openSource = resolve;
    });
    const parked: Source = {
      kind: "live",
      query: (name, range) => opened.then((s) => s.query(name, range)),
      live: () => opened.then((s) => s.live()),
      session: (sid) => opened.then((s) => s.session(sid)),
      visitor: (vid) => opened.then((s) => s.visitor(vid)),
      match: (game) => opened.then((s) => s.match(game)),
    };
    // What stops the page shown last: the parked page, until an account is let in.
    let stop: (() => void) | null = dashboard(parked, undefined);
    let first = true;
    // The gate, then the page; the first request proves the account is on the
    // list, and a refusal (a 401) is the shell's to show: its gate comes back
    // with "<email> is not on the list." and a Sign out, so another account
    // can be tried. Anything else is this page's to say.
    const start = (account: User): void => {
      source
        .live()
        .then(() => {
          // The first account let in fills the page already drawn; a later one (after a
          // refusal or a sign-out) gets the page drawn again, as before.
          if (first && stop !== null) {
            first = false;
            const accountHost = document.querySelector<HTMLElement>("#account");
            if (accountHost !== null) accountMenu(accountHost, { account, preview: false });
            openSource(source);
            return;
          }
          first = false;
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
