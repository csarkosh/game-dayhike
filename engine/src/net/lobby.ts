import type { JoinedInfo, SignalingClient } from "./signaling.js";

/**
 * A lobby: one signaling room owned by the player who created it, holding one
 * socket per member for the whole visit. This module is the state
 * machine on both sides; it has no DOM and no Babylon so vitest can drive it.
 *
 * Messages between members ride the server's `signal` relay. Every payload
 * carries a `lobby` key, which is how `peer.ts` (looking for `sdp` and
 * `candidate`) and this module ignore each other's traffic on the shared
 * socket.
 */

export const MAX_NAME_LENGTH = 24;
export const FALLBACK_NAME = "Hiker";

/** Names come from other peers and are untrusted: shape, length, and
 * emptiness are all enforced here, on both send and receive. */
export function sanitiseName(raw: unknown): string {
  if (typeof raw !== "string") return FALLBACK_NAME;
  const trimmed = raw.trim();
  if (trimmed.length === 0) return FALLBACK_NAME;
  return trimmed.length > MAX_NAME_LENGTH ? trimmed.slice(0, MAX_NAME_LENGTH) : trimmed;
}

export type LobbyMember = { id: string; name: string };

export type LobbyState = {
  id: string;
  role: "host" | "client";
  hostId: string;
  /** Host first, then join order. A follower's list is whatever the host last sent. */
  members: LobbyMember[];
  /** The host's location relative to the base, query included; "" until known. */
  route: string;
};

export type LobbyMessage =
  | { lobby: "hello"; name: string }
  | { lobby: "name"; name: string }
  | { lobby: "state"; members: LobbyMember[]; route: string };

const MAX_ROUTE_LENGTH = 2048;
/**
 * Mirrors the server's `MAX_PEERS`, duplicated rather than imported: `net/` may
 * not reach into the server or into `game/`, and a roster longer than a room
 * can hold is a hostile host, not a bigger party.
 */
const MAX_MEMBERS = 5;

export function parseLobbyMessage(payload: unknown): LobbyMessage | null {
  if (typeof payload !== "object" || payload === null) return null;
  const m = payload as Record<string, unknown>;
  if (m.lobby === "hello" || m.lobby === "name") return { lobby: m.lobby, name: sanitiseName(m.name) };
  if (m.lobby === "state") {
    if (!Array.isArray(m.members) || typeof m.route !== "string") return null;
    if (m.members.length > MAX_MEMBERS) return null;
    const members: LobbyMember[] = [];
    for (const entry of m.members) {
      if (typeof entry !== "object" || entry === null) return null;
      const r = entry as Record<string, unknown>;
      if (typeof r.id !== "string") return null;
      members.push({ id: r.id, name: sanitiseName(r.name) });
    }
    return { lobby: "state", members, route: m.route.length > MAX_ROUTE_LENGTH ? "" : m.route };
  }
  return null;
}

export type LobbyEndReason = "host_gone" | "left";

export type Lobby = {
  /** One live object, mutated in place: read it synchronously inside
   * `onChange`, never cache the reference expecting a snapshot. */
  readonly state: LobbyState;
  readonly peerId: string;
  readonly signaling: SignalingClient;
  onChange(handler: (state: LobbyState) => void): () => void;
  onEnd(handler: (reason: LobbyEndReason) => void): () => void;
  /** Host only: record where the host is and tell everyone. A follower calling this is a no-op. */
  setRoute(route: string): void;
  setName(name: string): void;
  /** Say goodbye and close. A host leaving ends the lobby for everyone (server rule). */
  leave(): void;
};

export type LobbyOptions = {
  signaling: SignalingClient;
  peerId: string;
  lobbyId: string;
  name: string;
  /** The host's current route at creation; ignored for a follower. */
  route?: string;
};

/** Open a lobby and host it. Rejects with the server's error code. */
export async function createLobby(o: LobbyOptions): Promise<Lobby> {
  const info = await o.signaling.create(o.lobbyId, o.peerId);
  return build(o, info);
}

/** Join someone else's lobby. Rejects with the server's error code. */
export async function joinLobby(o: LobbyOptions): Promise<Lobby> {
  const info = await o.signaling.join(o.lobbyId, o.peerId);
  const lobby = build(o, info);
  o.signaling.send(info.hostId, { lobby: "hello", name: lobby.state.members[0]!.name });
  return lobby;
}

function build(o: LobbyOptions, info: JoinedInfo): Lobby {
  o.signaling.setRole(info.role);
  const state: LobbyState = {
    id: o.lobbyId,
    role: info.role,
    hostId: info.hostId,
    members: [{ id: o.peerId, name: sanitiseName(o.name) }],
    route: info.role === "host" ? (o.route ?? "") : "",
  };
  const changeHandlers = new Set<(s: LobbyState) => void>();
  const endHandlers = new Set<(r: LobbyEndReason) => void>();
  let ended = false;

  const emit = (): void => {
    for (const h of [...changeHandlers]) h(state);
  };

  /** The host sends the whole state every time; followers replace theirs. */
  const broadcast = (): void => {
    if (state.role !== "host") return;
    for (const m of state.members) {
      if (m.id === o.peerId) continue;
      o.signaling.send(m.id, { lobby: "state", members: state.members, route: state.route });
    }
  };

  // Tracked separately from the member entry because a follower's `members` is
  // replaced wholesale by whatever the host last sent, and after a socket blip
  // that list may no longer contain us at all — which is exactly when the name
  // is needed, to say hello again.
  let selfName = sanitiseName(o.name);

  const offSignal = o.signaling.onSignal((from, payload) => {
    const msg = parseLobbyMessage(payload);
    if (msg === null) return;
    if (state.role === "host") {
      if (msg.lobby === "state") return;
      const existing = state.members.find((m) => m.id === from);
      if (existing !== undefined) existing.name = msg.name;
      else if (msg.lobby === "hello") state.members.push({ id: from, name: msg.name });
      else return; // a rename from someone who never said hello
      broadcast();
      emit();
    } else {
      if (from !== state.hostId || msg.lobby !== "state") return;
      state.members = msg.members;
      state.route = msg.route;
      emit();
    }
  });

  const offPeerLeft = o.signaling.onPeerLeft((id) => {
    if (state.role !== "host") return;
    const before = state.members.length;
    state.members = state.members.filter((m) => m.id !== id);
    if (state.members.length === before) return;
    broadcast();
    emit();
  });

  /**
   * Our own socket came back. The server remembers the room, but the host does
   * not remember us: while we were away it was told `peer-left` and pruned us
   * from its list, so no `state` would ever reach us again. Saying hello again
   * puts us back on the roster — the host reads a repeat hello from a known
   * peer as a rename and from an unknown one as a join, so this is safe either
   * way. The host side needs nothing: its list is authoritative, built from
   * hellos, and every follower that dropped will re-hello.
   */
  const offRejoined = o.signaling.onRejoined(() => {
    if (state.role !== "client") return;
    o.signaling.send(state.hostId, { lobby: "hello", name: selfName });
  });

  // Assigned below; declared first because `end` unsubscribes it and the
  // error handler calls `end` — the two refer to each other.
  let offError: () => void = () => undefined;

  const end = (reason: LobbyEndReason): void => {
    if (ended) return;
    ended = true;
    offSignal();
    offPeerLeft();
    offRejoined();
    offError();
    if (reason !== "left") o.signaling.close();
    for (const h of [...endHandlers]) h(reason);
  };

  // host_away and room_full are join-time and transient (signalingPolicy.ts);
  // only host_gone means the lobby is over.
  offError = o.signaling.onError((code) => {
    if (code === "host_gone") end("host_gone");
  });

  return {
    state,
    peerId: o.peerId,
    signaling: o.signaling,
    onChange(handler) {
      changeHandlers.add(handler);
      return () => changeHandlers.delete(handler);
    },
    onEnd(handler) {
      endHandlers.add(handler);
      return () => endHandlers.delete(handler);
    },
    setRoute(route) {
      if (state.role !== "host" || state.route === route) return;
      state.route = route;
      broadcast();
      emit();
    },
    setName(name) {
      const clean = sanitiseName(name);
      selfName = clean;
      const me = state.members.find((m) => m.id === o.peerId);
      if (me !== undefined) me.name = clean;
      if (state.role === "host") broadcast();
      else o.signaling.send(state.hostId, { lobby: "name", name: clean });
      emit();
    },
    leave() {
      o.signaling.leave();
      end("left");
    },
  };
}

/** The line under the roster when a create or join fails. */
export function lobbyErrorMessage(code: string): string {
  switch (code) {
    case "no_such_lobby":
      return "That invite is no longer valid.";
    case "room_full":
      return "That lobby is full.";
    case "host_away":
      return "The host is reconnecting — try again in a moment.";
    case "lobby_taken":
      return "That lobby already has a host.";
    default:
      return "Could not reach the server.";
  }
}
