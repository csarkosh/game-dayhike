import { describe, it, expect } from "vitest";
import type { JoinedInfo, SignalingClient } from "../../src/net/signaling.js";
import {
  createLobby,
  joinLobby,
  lobbyErrorMessage,
  parseLobbyMessage,
  sanitiseName,
  type LobbyState,
} from "../../src/net/lobby.js";

const LOBBY = "3f2504e0-4f89-41d3-9a0c-0305e82c3301";

/** A hand-driven SignalingClient: records sends, lets the test deliver. */
class FakeSignaling implements SignalingClient {
  sent: { to: string; payload: unknown }[] = [];
  verbs: string[] = [];
  closed = false;
  left = false;
  role: "host" | "client" = "client";
  private signalHandlers: ((from: string, payload: unknown) => void)[] = [];
  private leftHandlers: ((id: string) => void)[] = [];
  private rejoinedHandlers: ((info: JoinedInfo) => void)[] = [];
  private errorHandlers: ((code: string) => void)[] = [];
  constructor(private readonly reply: JoinedInfo | { error: string }) {}

  private answer(verb: string): Promise<JoinedInfo> {
    this.verbs.push(verb);
    if ("error" in this.reply) return Promise.reject(new Error(this.reply.error));
    return Promise.resolve(this.reply);
  }
  create(): Promise<JoinedInfo> {
    return this.answer("create");
  }
  join(): Promise<JoinedInfo> {
    return this.answer("join");
  }
  send(to: string, payload: unknown): void {
    this.sent.push({ to, payload });
  }
  onSignal(h: (from: string, payload: unknown) => void): () => void {
    this.signalHandlers.push(h);
    return () => this.signalHandlers.splice(this.signalHandlers.indexOf(h), 1);
  }
  onRejoined(h: (info: JoinedInfo) => void): () => void {
    this.rejoinedHandlers.push(h);
    return () => this.rejoinedHandlers.splice(this.rejoinedHandlers.indexOf(h), 1);
  }
  onPeerJoined(): void {}
  onPeerLeft(h: (id: string) => void): () => void {
    this.leftHandlers.push(h);
    return () => this.leftHandlers.splice(this.leftHandlers.indexOf(h), 1);
  }
  onError(h: (code: string) => void): () => void {
    this.errorHandlers.push(h);
    return () => this.errorHandlers.splice(this.errorHandlers.indexOf(h), 1);
  }
  // The lobby module never subscribes to this; only the roster's pending bar
  // does, so the fake just has to satisfy the interface.
  onOpen(): () => void {
    return () => undefined;
  }
  setRole(role: "host" | "client"): void {
    this.role = role;
  }
  leave(): void {
    this.left = true;
    this.closed = true;
  }
  close(): void {
    this.closed = true;
  }

  // test drivers
  deliver(from: string, payload: unknown): void {
    for (const h of [...this.signalHandlers]) h(from, payload);
  }
  peerLeft(id: string): void {
    for (const h of [...this.leftHandlers]) h(id);
  }
  rejoin(info?: JoinedInfo): void {
    if ("error" in this.reply) return;
    for (const h of [...this.rejoinedHandlers]) h(info ?? this.reply);
  }
  error(code: string): void {
    for (const h of [...this.errorHandlers]) h(code);
  }
  statesSentTo(to: string): unknown[] {
    return this.sent.filter((s) => s.to === to).map((s) => s.payload);
  }
}

describe("sanitiseName", () => {
  it("trims, clamps to 24, and falls back to Hiker", () => {
    expect(sanitiseName("  Sam  ")).toBe("Sam");
    expect(sanitiseName("x".repeat(30))).toBe("x".repeat(24));
    expect(sanitiseName("   ")).toBe("Hiker");
    expect(sanitiseName(42)).toBe("Hiker");
    expect(sanitiseName(undefined)).toBe("Hiker");
  });
});

describe("parseLobbyMessage", () => {
  it("accepts the three shapes and sanitises names", () => {
    expect(parseLobbyMessage({ lobby: "hello", name: " Sam " })).toEqual({ lobby: "hello", name: "Sam" });
    expect(parseLobbyMessage({ lobby: "name", name: "" })).toEqual({ lobby: "name", name: "Hiker" });
    expect(
      parseLobbyMessage({ lobby: "state", members: [{ id: "h", name: "Host" }, { id: "c", name: 7 }], route: "/" }),
    ).toEqual({ lobby: "state", members: [{ id: "h", name: "Host" }, { id: "c", name: "Hiker" }], route: "/" });
  });
  it("ignores WebRTC payloads and malformed state", () => {
    expect(parseLobbyMessage({ sdp: { type: "offer" } })).toBeNull();
    expect(parseLobbyMessage({ lobby: "state", members: "no", route: "/" })).toBeNull();
    expect(parseLobbyMessage({ lobby: "state", members: [{ name: "x" }], route: "/" })).toBeNull();
    expect(parseLobbyMessage(null)).toBeNull();
  });
  it("rejects a members list longer than the server's room", () => {
    const members = ["a", "b", "c", "d", "e", "f"].map((id) => ({ id, name: id }));
    expect(parseLobbyMessage({ lobby: "state", members, route: "/" })).toBeNull();
    expect(parseLobbyMessage({ lobby: "state", members: members.slice(0, 5), route: "/" })).not.toBeNull();
  });
});

describe("createLobby (host)", () => {
  it("sends create, starts with itself, and broadcasts on hello, name, peer-left, and route", async () => {
    const s = new FakeSignaling({ role: "host", hostId: "me", peers: [] });
    const changes: LobbyState[] = [];
    const lobby = await createLobby({ signaling: s, peerId: "me", lobbyId: LOBBY, name: "Host", route: "/" });
    lobby.onChange((st) => changes.push(structuredClone(st)));
    expect(s.verbs).toEqual(["create"]);
    expect(s.role).toBe("host");
    expect(lobby.state).toEqual({ id: LOBBY, role: "host", hostId: "me", members: [{ id: "me", name: "Host" }], route: "/" });

    s.deliver("c1", { lobby: "hello", name: "Cass" });
    expect(lobby.state.members).toEqual([{ id: "me", name: "Host" }, { id: "c1", name: "Cass" }]);
    expect(s.statesSentTo("c1")).toEqual([
      { lobby: "state", members: [{ id: "me", name: "Host" }, { id: "c1", name: "Cass" }], route: "/" },
    ]);

    s.deliver("c1", { lobby: "name", name: "Cassidy" });
    expect(lobby.state.members[1]).toEqual({ id: "c1", name: "Cassidy" });

    lobby.setRoute(`/game/${LOBBY}?cmd=seed%20x`);
    expect(s.statesSentTo("c1").at(-1)).toMatchObject({ route: `/game/${LOBBY}?cmd=seed%20x` });

    s.peerLeft("c1");
    expect(lobby.state.members).toEqual([{ id: "me", name: "Host" }]);
    expect(changes).toHaveLength(4);
  });

  it("ignores a name from a peer that never said hello, and a state from anyone", async () => {
    const s = new FakeSignaling({ role: "host", hostId: "me", peers: [] });
    const lobby = await createLobby({ signaling: s, peerId: "me", lobbyId: LOBBY, name: "Host" });
    s.deliver("ghost", { lobby: "name", name: "Boo" });
    s.deliver("ghost", { lobby: "state", members: [{ id: "ghost", name: "Boo" }], route: "/" });
    expect(lobby.state.members).toEqual([{ id: "me", name: "Host" }]);
    expect(s.sent).toHaveLength(0);
  });

  it("renames itself and broadcasts", async () => {
    const s = new FakeSignaling({ role: "host", hostId: "me", peers: [] });
    const lobby = await createLobby({ signaling: s, peerId: "me", lobbyId: LOBBY, name: "Host" });
    s.deliver("c1", { lobby: "hello", name: "Cass" });
    lobby.setName("  Boss ");
    expect(lobby.state.members[0]).toEqual({ id: "me", name: "Boss" });
    expect(s.statesSentTo("c1").at(-1)).toMatchObject({ members: [{ id: "me", name: "Boss" }, { id: "c1", name: "Cass" }] });
  });

  it("stops listening for departures once the lobby ends", async () => {
    const s = new FakeSignaling({ role: "host", hostId: "me", peers: [] });
    const lobby = await createLobby({ signaling: s, peerId: "me", lobbyId: LOBBY, name: "Host" });
    s.deliver("c1", { lobby: "hello", name: "Cass" });
    lobby.leave();
    s.sent.length = 0;

    // The socket outlives the lobby, so a stale `peer-left` must not reach it.
    s.peerLeft("c1");
    expect(lobby.state.members).toHaveLength(2);
    expect(s.sent).toEqual([]);
  });

  it("rejects with the server's code", async () => {
    const s = new FakeSignaling({ error: "lobby_taken" });
    await expect(createLobby({ signaling: s, peerId: "me", lobbyId: LOBBY, name: "Host" })).rejects.toThrow("lobby_taken");
  });
});

describe("joinLobby (follower)", () => {
  it("sends join then hello, adopts the host's state, and follows renames through the host", async () => {
    const s = new FakeSignaling({ role: "client", hostId: "h", peers: ["h"] });
    const lobby = await joinLobby({ signaling: s, peerId: "me", lobbyId: LOBBY, name: "Cass" });
    expect(s.verbs).toEqual(["join"]);
    expect(s.sent).toEqual([{ to: "h", payload: { lobby: "hello", name: "Cass" } }]);
    expect(lobby.state).toEqual({ id: LOBBY, role: "client", hostId: "h", members: [{ id: "me", name: "Cass" }], route: "" });

    const changes: LobbyState[] = [];
    lobby.onChange((st) => changes.push(structuredClone(st)));
    s.deliver("h", { lobby: "state", members: [{ id: "h", name: "Host" }, { id: "me", name: "Cass" }], route: "/credits" });
    expect(lobby.state.members).toEqual([{ id: "h", name: "Host" }, { id: "me", name: "Cass" }]);
    expect(lobby.state.route).toBe("/credits");

    // A state from anyone but the host is ignored.
    s.deliver("x", { lobby: "state", members: [], route: "/" });
    expect(lobby.state.members).toHaveLength(2);

    lobby.setName("Cassidy");
    expect(s.sent.at(-1)).toEqual({ to: "h", payload: { lobby: "name", name: "Cassidy" } });
    // setRoute is a host verb; a follower calling it is a no-op.
    lobby.setRoute("/downloads");
    expect(lobby.state.route).toBe("/credits");
    expect(changes).toHaveLength(2);
  });

  it("ends on host_gone and closes the socket; leave says goodbye", async () => {
    const s = new FakeSignaling({ role: "client", hostId: "h", peers: ["h"] });
    const lobby = await joinLobby({ signaling: s, peerId: "me", lobbyId: LOBBY, name: "Cass" });
    const ends: string[] = [];
    lobby.onEnd((r) => ends.push(r));
    s.error("host_away"); // transient: not an end
    expect(ends).toEqual([]);
    s.error("host_gone");
    expect(ends).toEqual(["host_gone"]);
    expect(s.closed).toBe(true);

    const t = new FakeSignaling({ role: "client", hostId: "h", peers: ["h"] });
    const other = await joinLobby({ signaling: t, peerId: "me", lobbyId: LOBBY, name: "Cass" });
    const otherEnds: string[] = [];
    other.onEnd((r) => otherEnds.push(r));
    other.leave();
    expect(t.left).toBe(true);
    expect(otherEnds).toEqual(["left"]);
  });

  it("says hello again when its own socket reconnects", async () => {
    const s = new FakeSignaling({ role: "client", hostId: "h", peers: ["h"] });
    const lobby = await joinLobby({ signaling: s, peerId: "me", lobbyId: LOBBY, name: "Cass" });
    lobby.setName("Cassidy");
    s.sent.length = 0;

    // The host was told `peer-left` while this socket was down and dropped us
    // from its list; only a fresh hello puts us back on the roster.
    s.rejoin();
    expect(s.sent).toEqual([{ to: "h", payload: { lobby: "hello", name: "Cassidy" } }]);

    // A lobby that has ended stops answering the socket it no longer owns.
    lobby.leave();
    s.sent.length = 0;
    s.rejoin();
    expect(s.sent).toEqual([]);
  });

  it("rejects with the server's code", async () => {
    const s = new FakeSignaling({ error: "no_such_lobby" });
    await expect(joinLobby({ signaling: s, peerId: "me", lobbyId: LOBBY, name: "Cass" })).rejects.toThrow("no_such_lobby");
  });
});

describe("lobbyErrorMessage", () => {
  it("has a line for every code a join or create can fail with", () => {
    expect(lobbyErrorMessage("no_such_lobby")).toMatch(/invite/i);
    expect(lobbyErrorMessage("room_full")).toMatch(/full/i);
    expect(lobbyErrorMessage("host_away")).toMatch(/reconnecting/i);
    expect(lobbyErrorMessage("lobby_taken")).toMatch(/already/i);
    expect(lobbyErrorMessage("signaling_unreachable")).toMatch(/server/i);
    expect(lobbyErrorMessage("anything_else")).toMatch(/server/i);
  });
});
