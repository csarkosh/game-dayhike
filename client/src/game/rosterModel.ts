import type { LobbyState } from "../net/lobby.js";

/** Mirrors the server's MAX_PEERS; the count shows "n / 5". */
export const ROSTER_MAX = 5;

export type RosterRow = { id: string; name: string; isHost: boolean; isSelf: boolean };

/**
 * Below this an attempt is not worth reporting: a bar that appears and
 * disappears inside a wait nobody perceives is noise. The button is disabled
 * from the first millisecond regardless, so the wait is never mistaken for a
 * click that missed.
 *
 * 250 rather than 150 because 150 was not actually clear of the warm path: a
 * warm invite measured 201 ms end to end against production and 211 ms
 * page-to-page, so the bar flashed for ~34 ms of it. This sits past both with
 * room to spare, and costs a cold start — which is seconds — nothing.
 */
export const PENDING_AFTER_MS = 250;

/** Past this the wait has stopped being a cold start, and a way out is offered. */
export const OVERRUN_MS = 6000;

/**
 * What the socket handshake is expected to cost against a cold Cloud Run
 * instance: the container boot the startup probe waits out (~2 s, see
 * `_infra/modules/gcp-signaling/main.tf`) plus the handshake itself, which is
 * ~130 ms once the server is up.
 */
const CONNECT_EXPECTED_MS = 2200;

/** `create`/`join` out, `joined` back: one round trip, measured at ~75 ms. */
const REPLY_EXPECTED_MS = 150;

/** What reaching the socket-open milestone is worth on the bar. */
const CONNECTED = 0.6;

/**
 * How far short of a milestone the bar parks once it has run out of patience,
 * as a fraction of the stage's span. Without it `Math.exp` underflows to zero
 * at absurd waits and the bar silently claims a milestone that has not
 * happened.
 */
const CEILING_GAP = 0.01;

/** A create-or-join in flight, as the two facts the bar needs. */
export type RosterAttempt = {
  /** Which verb is in flight. Only the stage label differs. */
  kind: "invite" | "join";
  /** Milliseconds since the attempt began. */
  elapsedMs: number;
  /** `elapsedMs` at which the socket came up; null while it is still opening. */
  connectedAtMs: number | null;
};

export type RosterPendingView = {
  label: "Connecting" | "Creating" | "Joining";
  /** 0..1, and deliberately short of each milestone until that milestone fires. */
  progress: number;
  /** Long enough that something is wrong; the renderer offers Retry. */
  overrun: boolean;
};

/**
 * Approaches `to` from `from` over `expectedMs`, and never arrives.
 *
 * Linear to 90% of the span over the expected duration, so the ordinary case
 * reads as steady progress rather than the front-loaded crawl a pure
 * exponential gives, then exponential over the last 10%, so a server slower
 * than expected keeps the bar moving without letting it claim a milestone
 * that has not happened. Continuous at the join: both branches give
 * `from + 0.9 * span` at `expectedMs`.
 */
function approach(elapsedMs: number, expectedMs: number, from: number, to: number): number {
  const span = to - from;
  if (elapsedMs <= 0) return from;
  if (elapsedMs < expectedMs) return from + span * 0.9 * (elapsedMs / expectedMs);
  const eased = from + span * (1 - 0.1 * Math.exp(-(elapsedMs - expectedMs) / expectedMs));
  return Math.min(eased, to - span * CEILING_GAP);
}

/**
 * Where an attempt has got to, or null while it is too young to be worth
 * showing. Two real events land in this: the socket opening (worth
 * `CONNECTED`) and the `joined` reply (which ends the attempt altogether,
 * because by then there is a lobby and a link to show). Between them the bar
 * only ever approaches the next one.
 *
 * Exported so the bar's ticker can ask for this number alone rather than
 * rebuilding the whole view ten times a second — and so the two can never
 * disagree about what the bar should read.
 */
export function attemptPending(attempt: RosterAttempt): RosterPendingView | null {
  if (attempt.elapsedMs < PENDING_AFTER_MS) return null;
  const overrun = attempt.elapsedMs >= OVERRUN_MS;
  const connectedAt = attempt.connectedAtMs;
  if (connectedAt === null) {
    return {
      label: "Connecting",
      progress: approach(attempt.elapsedMs, CONNECT_EXPECTED_MS, 0, CONNECTED),
      overrun,
    };
  }
  return {
    label: attempt.kind === "join" ? "Joining" : "Creating",
    progress: approach(attempt.elapsedMs - connectedAt, REPLY_EXPECTED_MS, CONNECTED, 1),
    overrun,
  };
}

/** The invite control: a link, the button, or the attempt in flight. */
function inviteView(attempt: RosterAttempt | null): RosterView["invite"] {
  if (attempt === null) return { action: "create", busy: false };
  const pending = attemptPending(attempt);
  return pending === null ? { action: "create", busy: true } : { pending };
}

export type RosterView = {
  rows: RosterRow[];
  count: { members: number; max: number };
  /**
   * A link once a lobby exists; before then either the Invite action — `busy`
   * while an attempt is too young to report, so a second click cannot start a
   * second attempt — or the progress of the attempt in flight.
   */
  invite: { url: string } | { action: "create"; busy: boolean } | { pending: RosterPendingView };
  /** Your own row can be clicked to rename — not in-game, where a match is running. */
  editable: boolean;
  /**
   * Whether the panel takes the pointer at all. Deliberately not `editable`:
   * that one is about the name field, and reusing it as the pointer gate is
   * what made the pause menu's Invite and Copy buttons look live and do
   * nothing. Paused is a cursor the player can aim, so the panel answers it.
   */
  interactive: boolean;
  /** Faded while a match is being played; full on the landing and on the pause menu. */
  presence: "full" | "subdued";
  /** A follower that has not yet heard from the host. */
  joining: boolean;
  error?: string;
};

/**
 * What the roster shows, as data. Host first, then join order;
 * the host's own list is already in that order, and a stable sort keeps a
 * follower's copy honest if it ever is not.
 */
export function rosterModel(input: {
  lobby: LobbyState | null;
  selfId: string;
  selfName: string;
  inviteUrl(lobbyId: string): string;
  inGame: boolean;
  /** The pause menu is open (only meaningful in-game). */
  paused: boolean;
  /** A create-or-join in flight, or null. Ignored once `lobby` is set. */
  attempt: RosterAttempt | null;
  error?: string;
}): RosterView {
  const view: RosterView = {
    rows: [],
    count: { members: 1, max: ROSTER_MAX },
    invite: inviteView(input.attempt),
    editable: !input.inGame,
    interactive: !input.inGame || input.paused,
    presence: input.inGame && !input.paused ? "subdued" : "full",
    joining: false,
  };
  if (input.error !== undefined) view.error = input.error;

  const lobby = input.lobby;
  if (lobby === null) {
    view.rows = [{ id: input.selfId, name: input.selfName, isHost: false, isSelf: true }];
    return view;
  }

  const ordered = [...lobby.members].sort((a, b) => Number(b.id === lobby.hostId) - Number(a.id === lobby.hostId));
  view.rows = ordered.map((m) => ({
    id: m.id,
    name: m.name,
    isHost: m.id === lobby.hostId,
    isSelf: m.id === input.selfId,
  }));
  view.count = { members: ordered.length, max: ROSTER_MAX };
  view.invite = { url: input.inviteUrl(lobby.id) };
  view.joining = lobby.role === "client" && lobby.route === "";
  return view;
}
