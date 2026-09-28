export type Panel = "downloads" | "credits" | "settings";

export type Route =
  | { kind: "landing" }
  | { kind: "downloads" }
  | { kind: "credits" }
  | { kind: "settings" }
  /** An invite: join this lobby, then show the landing page. */
  | { kind: "party"; lobbyId: string }
  /** A world. The token feeds the seed and nothing else. */
  | { kind: "game"; token: string };

/**
 * The path the bundle is served under: `/dayhike/` on the web, `/` in the
 * desktop shell and under vitest. Vite fills this from its `base` option, so
 * the router is the one place that knows the prefix exists. Every function
 * below takes the base as a parameter so tests can pass it explicitly.
 */
export const BASE: string = import.meta.env.BASE_URL ?? "/";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TOKEN_RE = /^[a-z0-9-]{1,36}$/i;

export function isValidLobbyId(value: string): boolean {
  return UUID_RE.test(value);
}

export function isValidToken(value: string): boolean {
  return TOKEN_RE.test(value);
}

function prefixOf(base: string): string {
  return base.replace(/\/+$/, "");
}

/**
 * The route-relative path for a pathname under the base. A pathname outside
 * the base cannot be reached in production (Firebase only rewrites under the
 * prefix) and is sent to the landing page rather than parsed as if it were.
 */
export function stripBase(pathname: string, base: string = BASE): string {
  const prefix = prefixOf(base);
  if (prefix === "") return pathname;
  if (pathname === prefix || pathname === `${prefix}/`) return "/";
  if (pathname.startsWith(`${prefix}/`)) return pathname.slice(prefix.length);
  return "/";
}

export function withBase(path: string, base: string = BASE): string {
  return `${prefixOf(base)}${path}`;
}

export function parseRoute(pathname: string, base: string = BASE): Route {
  const trimmed = stripBase(pathname, base).replace(/\/+$/, "");
  // The panels are routes rather than toggles so they can be linked and so
  // the browser's back button leaves them.
  if (trimmed === "/downloads") return { kind: "downloads" };
  if (trimmed === "/credits") return { kind: "credits" };
  if (trimmed === "/settings") return { kind: "settings" };
  const party = /^\/party\/([^/]+)$/.exec(trimmed);
  if (party) {
    const id = party[1] as string;
    if (isValidLobbyId(id)) return { kind: "party", lobbyId: id.toLowerCase() };
    return { kind: "landing" };
  }
  const game = /^\/game\/([^/]+)$/.exec(trimmed);
  if (game) {
    const token = game[1] as string;
    if (isValidToken(token)) return { kind: "game", token: token.toLowerCase() };
  }
  return { kind: "landing" };
}

export function createLobbyId(): string {
  // crypto.randomUUID needs a secure context. localhost qualifies; a bare
  // http:// LAN address does not, which is exactly where multi-machine
  // testing tends to happen, so fall back rather than crash.
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  bytes[6] = ((bytes[6] as number) & 0x0f) | 0x40;
  bytes[8] = ((bytes[8] as number) & 0x3f) | 0x80;
  const hex = [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/** The landing page and its panels: one place, as far as a lobby is concerned. */
function isLandingFamily(route: Route): boolean {
  return route.kind === "landing" || route.kind === "downloads" || route.kind === "credits" || route.kind === "settings";
}

function routeOf(path: string): Route {
  const query = path.indexOf("?");
  return parseRoute(query === -1 ? path : path.slice(0, query), "/");
}

/**
 * What a lobby host announces for where it is (a route-relative path, query
 * included): a landing panel is announced as the landing page, since the
 * panels (Downloads, Settings, Credits) are each player's own, and a follower
 * is not to be slid into the host's.
 */
export function announcedPath(path: string): string {
  const route = routeOf(path);
  return isLandingFamily(route) && route.kind !== "landing" ? "/" : path;
}

/**
 * Whether a follower at `current` is already where the host's `target` is:
 * any two landing routes count as one place, so a follower in its own
 * Settings is not taken out of it by the host being on the landing page.
 */
export function sameFollowPlace(target: string, current: string): boolean {
  if (target === current) return true;
  return isLandingFamily(routeOf(target)) && isLandingFamily(routeOf(current));
}

/**
 * The query parameters that belong to this page alone: `?tier=` and
 * `?probe=`, a tester's overrides. Stripped from the route a lobby host
 * announces (`stripOverrides`), so neither follows a host onto a follower's
 * machine, and from a route a follower is sent to, for a host that still
 * announces them.
 */
const OVERRIDES = ["tier", "probe"] as const;

/**
 * `route` (a path and query, as a lobby host announces it) without the
 * overrides. A route with none comes back byte for byte.
 */
export function stripOverrides(route: string): string {
  const at = route.indexOf("?");
  if (at < 0) return route;
  const params = new URLSearchParams(route.slice(at));
  if (!OVERRIDES.some((name) => params.has(name))) return route;
  for (const name of OVERRIDES) params.delete(name);
  const query = params.toString();
  return query === "" ? route.slice(0, at) : `${route.slice(0, at)}?${query}`;
}

/** The route a lobby host announces for where it is (`current`): a landing
 * panel as the landing page (`announcedPath`), the overrides stripped. */
export function hostRoute(current: string): string {
  return stripOverrides(announcedPath(current));
}

/** Where the page is, relative to the base, query included. This is what a
 * lobby host broadcasts and what a follower navigates to. */
export function currentRoutePath(): string {
  return `${stripBase(location.pathname)}${location.search}`;
}

function popstate(): void {
  window.dispatchEvent(new PopStateEvent("popstate"));
}

/** Push a route-relative path (it may carry a query) and re-render. */
export function navigateTo(path: string): void {
  history.pushState({}, "", withBase(path));
  popstate();
}

export function navigateToGame(token: string): void {
  navigateTo(`/game/${token}`);
}

export function navigateToLanding(): void {
  navigateTo("/");
}

/** Rewrites the current entry to the landing route without re-rendering:
 * used after an invite has been consumed so back/forward never re-join. */
export function replaceWithLanding(): void {
  history.replaceState({}, "", withBase("/"));
}

/** The state stamped on a panel entry, so Back can tell an entry this app
 * pushed from one the player arrived at directly. */
type PanelState = { fromLanding?: boolean };

export function navigateToPanel(panel: Panel): void {
  history.pushState({ fromLanding: true } satisfies PanelState, "", withBase(`/${panel}`));
  popstate();
}

/**
 * Whether the current history entry is one this app pushed on the way to a
 * panel — i.e. whether going back lands on our own landing page rather than
 * leaving the site.
 *
 * `history.length` cannot answer this, and measuring it was the bug: a tab
 * opened straight at /credits already reports length 2, because the entry it
 * started on (about:blank, a new-tab page) counts. Back would then leave the
 * game entirely. pushState's state object is the honest signal — it is null on
 * a typed or shared URL, and it is restored with the entry across a reload.
 */
export function pushedFromLanding(): boolean {
  return (history.state as PanelState | null)?.fromLanding === true;
}

/** The moves leaving a panel can make, injected so the choice is testable. */
export type PanelExit = {
  pushedFromLanding(): boolean;
  back(): void;
  toLanding(): void;
};

/** The real browser wiring; main.ts passes this. */
export const browserExit: PanelExit = {
  pushedFromLanding,
  back: () => history.back(),
  toLanding: navigateToLanding,
};

/**
 * Leave a secondary panel. Popping is right only when the entry behind us is
 * our own landing page: a directly loaded /credits has someone else's entry
 * behind it (or the new-tab page), and popping there walks out of the game, so
 * that case pushes the landing route instead.
 */
export function leavePanel(exit: PanelExit): void {
  if (exit.pushedFromLanding()) exit.back();
  else exit.toLanding();
}
