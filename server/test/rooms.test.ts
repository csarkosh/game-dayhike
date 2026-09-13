import { describe, it, expect, beforeEach } from "vitest";
import { RoomRegistry } from "../src/rooms.js";
import { parseClientMessage, isValidRoomId } from "../src/protocol.js";
import type { ServerMessage } from "../src/protocol.js";

const ROOM = "3f2504e0-4f89-41d3-9a0c-0305e82c3301";
const OTHER = "9a0c0305-e82c-4330-8f25-04e04f8941d3";

type Recorded = { id: string; sent: ServerMessage[]; send(m: ServerMessage): void };

function peer(id: string): Recorded {
  const sent: ServerMessage[] = [];
  return { id, sent, send: (m) => sent.push(m) };
}

describe("isValidRoomId", () => {
  it("accepts uuids and rejects anything else", () => {
    expect(isValidRoomId(ROOM)).toBe(true);
    expect(isValidRoomId("lobby")).toBe(false);
    expect(isValidRoomId(42)).toBe(false);
    expect(isValidRoomId(null)).toBe(false);
  });
});

describe("parseClientMessage", () => {
  it("parses a valid join", () => {
    expect(parseClientMessage(JSON.stringify({ t: "join", room: ROOM, peerId: "a" }))).toEqual({
      t: "join",
      room: ROOM,
      peerId: "a",
    });
  });

  it("parses a valid create", () => {
    expect(parseClientMessage(JSON.stringify({ t: "create", room: ROOM, peerId: "a" }))).toEqual({
      t: "create",
      room: ROOM,
      peerId: "a",
    });
  });

  it("rejects a join with a non-uuid room", () => {
    expect(parseClientMessage(JSON.stringify({ t: "join", room: "x", peerId: "a" }))).toBeNull();
  });

  it("rejects malformed json", () => {
    expect(parseClientMessage("{not json")).toBeNull();
  });

  it("rejects unknown message types", () => {
    expect(parseClientMessage(JSON.stringify({ t: "hack" }))).toBeNull();
  });
});

describe("RoomRegistry", () => {
  let registry: RoomRegistry;
  beforeEach(() => {
    registry = new RoomRegistry(5);
  });

  it("create registers the caller as host", () => {
    const a = peer("a");
    expect(registry.create(ROOM, a)).toEqual({ ok: true, role: "host", hostId: "a", peers: [] });
  });

  it("join never creates: an unknown lobby is refused", () => {
    expect(registry.join(ROOM, peer("b"))).toEqual({ ok: false, code: "no_such_lobby" });
    expect(registry.size).toBe(0);
  });

  it("join after create is a client and is told the host", () => {
    const a = peer("a");
    const b = peer("b");
    registry.create(ROOM, a);
    expect(registry.join(ROOM, b)).toEqual({ ok: true, role: "client", hostId: "a", peers: ["a"] });
    expect(a.sent).toContainEqual({ t: "peer-joined", peerId: "b" });
  });

  it("create on a lobby with a live host is refused", () => {
    registry.create(ROOM, peer("a"));
    expect(registry.create(ROOM, peer("b"))).toEqual({ ok: false, code: "lobby_taken" });
  });

  it("create by the same host replaces its socket and tells nobody", () => {
    const a1 = peer("a");
    const b = peer("b");
    registry.create(ROOM, a1);
    registry.join(ROOM, b);
    b.sent.length = 0;
    const a2 = peer("a");
    expect(registry.create(ROOM, a2)).toEqual({ ok: true, role: "host", hostId: "a", peers: ["b"] });
    registry.relay(ROOM, "b", "a", { x: 1 });
    expect(a2.sent).toContainEqual({ t: "signal", from: "b", payload: { x: 1 } });
    expect(a1.sent).toHaveLength(1); // only b's peer-joined from before
    expect(b.sent).toHaveLength(0);
  });

  it("ignores a stale socket's disconnect after the host recreated", () => {
    const a1 = peer("a");
    const b = peer("b");
    registry.create(ROOM, a1);
    registry.join(ROOM, b);
    const a2 = peer("a");
    registry.create(ROOM, a2);
    b.sent.length = 0;

    // The old socket's close lands late (a half-open socket is only noticed
    // when the heartbeat gives up on it) and must not evict the replacement
    // that already took its place.
    registry.disconnect(ROOM, a1);

    expect(registry.get(ROOM)?.peers.get("a")).toBe(a2);
    expect(registry.get(ROOM)?.hostDroppedAt).toBeNull();
    registry.relay(ROOM, "a", "b", { x: 1 });
    expect(b.sent).toContainEqual({ t: "signal", from: "a", payload: { x: 1 } });
    expect(registry.join(ROOM, peer("c")).ok).toBe(true);
  });

  it("ignores a stale socket's leave after the host recreated", () => {
    const a1 = peer("a");
    const b = peer("b");
    registry.create(ROOM, a1);
    registry.join(ROOM, b);
    const a2 = peer("a");
    registry.create(ROOM, a2);
    b.sent.length = 0;

    registry.leave(ROOM, a1);

    expect(registry.get(ROOM)?.peers.get("a")).toBe(a2);
    expect(b.sent).not.toContainEqual({ t: "error", code: "host_gone" });
  });

  it("notifies existing peers when someone joins", () => {
    const a = peer("a");
    const b = peer("b");
    registry.create(ROOM, a);
    registry.join(ROOM, b);
    expect(a.sent).toContainEqual({ t: "peer-joined", peerId: "b" });
  });

  it("rejects a sixth peer", () => {
    registry.create(ROOM, peer("a"));
    for (const id of ["b", "c", "d", "e"]) registry.join(ROOM, peer(id));
    const result = registry.join(ROOM, peer("f"));
    expect(result).toEqual({ ok: false, code: "room_full" });
  });

  it("keeps lobbies with different ids fully separate", () => {
    const a = peer("a");
    const b = peer("b");
    registry.create(ROOM, a);
    expect(registry.create(OTHER, b)).toEqual({ ok: true, role: "host", hostId: "b", peers: [] });
    expect(a.sent).toHaveLength(0);
  });

  it("relays a signal only to the addressed peer", () => {
    const a = peer("a");
    const b = peer("b");
    const c = peer("c");
    registry.create(ROOM, a);
    registry.join(ROOM, b);
    registry.join(ROOM, c);
    registry.relay(ROOM, "b", "a", { sdp: "offer" });
    expect(a.sent).toContainEqual({ t: "signal", from: "b", payload: { sdp: "offer" } });
    expect(c.sent).not.toContainEqual({ t: "signal", from: "b", payload: { sdp: "offer" } });
  });

  it("ignores a relay addressed to a peer in another room", () => {
    const a = peer("a");
    const outsider = peer("z");
    registry.create(ROOM, a);
    registry.create(OTHER, outsider);
    registry.relay(ROOM, "a", "z", { sdp: "offer" });
    expect(outsider.sent).toHaveLength(0);
  });

  it("tells everyone the host is gone when the host leaves", () => {
    const a = peer("a");
    const b = peer("b");
    registry.create(ROOM, a);
    registry.join(ROOM, b);
    registry.leave(ROOM, a);
    expect(b.sent).toContainEqual({ t: "error", code: "host_gone" });
  });

  it("reports a departing client as peer-left, not host-gone", () => {
    const a = peer("a");
    const b = peer("b");
    registry.create(ROOM, a);
    registry.join(ROOM, b);
    registry.leave(ROOM, b);
    expect(a.sent).toContainEqual({ t: "peer-left", peerId: "b" });
    expect(a.sent).not.toContainEqual({ t: "error", code: "host_gone" });
  });

  it("deletes the room once the last peer leaves", () => {
    const a = peer("a");
    registry.create(ROOM, a);
    registry.leave(ROOM, a);
    expect(registry.size).toBe(0);
    expect(registry.get(ROOM)).toBeUndefined();
  });

  it("frees a slot when a peer leaves so a new one can join", () => {
    registry.create(ROOM, peer("a"));
    const e = peer("e");
    for (const id of ["b", "c", "d"]) registry.join(ROOM, peer(id));
    registry.join(ROOM, e);
    registry.leave(ROOM, e);
    expect(registry.join(ROOM, peer("f")).ok).toBe(true);
  });

  describe("host disconnect grace period", () => {
    let clock: number;
    let graced: RoomRegistry;

    beforeEach(() => {
      clock = 1_000;
      graced = new RoomRegistry(5, () => clock, 60_000);
    });

    it("says nothing when the host's socket merely drops", () => {
      const a = peer("a");
      const b = peer("b");
      graced.create(ROOM, a);
      graced.join(ROOM, b);
      b.sent.length = 0;

      graced.disconnect(ROOM, a);

      // The match is peer-to-peer and still healthy; telling clients the host
      // is gone would end it for no reason.
      expect(b.sent).not.toContainEqual({ t: "error", code: "host_gone" });
      expect(graced.get(ROOM)).toBeDefined();
    });

    it("lets the host reclaim its role inside the window", () => {
      const a = peer("a");
      const b = peer("b");
      graced.create(ROOM, a);
      graced.join(ROOM, b);
      graced.disconnect(ROOM, a);
      b.sent.length = 0;

      clock += 5_000;
      const result = graced.join(ROOM, peer("a"));

      expect(result).toEqual({ ok: true, role: "host", hostId: "a", peers: ["b"] });
      // b never saw the host leave, so it must not be told it arrived either.
      expect(b.sent).toHaveLength(0);
    });

    it("lets the dropped host reclaim with create inside the window", () => {
      const a = peer("a");
      const b = peer("b");
      graced.create(ROOM, a);
      graced.join(ROOM, b);
      graced.disconnect(ROOM, a);
      b.sent.length = 0;

      clock += 5_000;
      expect(graced.create(ROOM, peer("a"))).toEqual({ ok: true, role: "host", hostId: "a", peers: ["b"] });
      expect(b.sent).toHaveLength(0);
    });

    it("ends the session once the window lapses", () => {
      const a = peer("a");
      const b = peer("b");
      graced.create(ROOM, a);
      graced.join(ROOM, b);
      graced.disconnect(ROOM, a);
      b.sent.length = 0;

      clock += 60_001;
      // Any access sweeps; nothing here runs on a timer.
      expect(graced.get(ROOM)).toBeUndefined();
      expect(b.sent).toContainEqual({ t: "error", code: "host_gone" });
      expect(graced.size).toBe(0);
    });

    it("refuses a reclaim after the window lapsed", () => {
      const a = peer("a");
      graced.create(ROOM, a);
      graced.join(ROOM, peer("b"));
      graced.disconnect(ROOM, a);

      clock += 60_001;
      const result = graced.join(ROOM, peer("a"));

      // The room is gone, and join never creates: unlike the old first-in-is-
      // host rule, "a" does not silently become host of a fresh room here —
      // it has to `create` again, deliberately.
      expect(result).toEqual({ ok: false, code: "no_such_lobby" });
    });

    it("still ends the session immediately on a deliberate leave", () => {
      const a = peer("a");
      const b = peer("b");
      graced.create(ROOM, a);
      graced.join(ROOM, b);

      graced.leave(ROOM, a);

      expect(b.sent).toContainEqual({ t: "error", code: "host_gone" });
      expect(graced.get(ROOM)).toBeUndefined();
    });

    it("admits nobody while the host is away, even with slots free", () => {
      const a = peer("a");
      graced.create(ROOM, a);
      for (const id of ["b", "c", "d"]) graced.join(ROOM, peer(id));
      graced.disconnect(ROOM, a);

      // Three peers (b, c, d) remain out of a room sized for five, so a slot
      // is technically free — but it's reserved for the host's own return,
      // not up for grabs, so any other join is refused outright.
      expect(graced.join(ROOM, peer("e"))).toEqual({ ok: false, code: "host_away" });
      expect(graced.join(ROOM, peer("a")).ok).toBe(true);
    });

    it("still reports room_full, not host_away, for a genuinely full room", () => {
      // maxPeers is 5 and the host is present throughout: this is ordinary
      // capacity exhaustion, not the host-away condition, so it must keep the
      // existing code rather than being swallowed by the new one.
      graced.create(ROOM, peer("a"));
      for (const id of ["b", "c", "d", "e"]) graced.join(ROOM, peer(id));
      expect(graced.join(ROOM, peer("f"))).toEqual({ ok: false, code: "room_full" });
    });

    it("deletes the room outright when the host drops with nobody left", () => {
      const solo = peer("solo");
      graced.create(ROOM, solo);
      graced.disconnect(ROOM, solo);
      // Nobody to preserve the room for, so there is nothing to grace.
      expect(graced.size).toBe(0);
    });

    it("treats a client's dropped socket as an ordinary departure", () => {
      const a = peer("a");
      const b = peer("b");
      graced.create(ROOM, a);
      graced.join(ROOM, b);

      graced.disconnect(ROOM, b);

      expect(a.sent).toContainEqual({ t: "peer-left", peerId: "b" });
      expect(graced.get(ROOM)).toBeDefined();
    });

    it("sweepExpired ends a lapsed room when called directly", () => {
      const a = peer("a");
      const b = peer("b");
      graced.create(ROOM, a);
      graced.join(ROOM, b);
      graced.disconnect(ROOM, a);
      b.sent.length = 0;

      clock += 60_001;
      // No get/size/join/leave/disconnect/relay call at all here — this pins
      // the public method itself, independent of whatever periodically calls
      // it (the server drives it on a timer; this test drives it directly).
      graced.sweepExpired();

      expect(b.sent).toContainEqual({ t: "error", code: "host_gone" });
      expect(graced.size).toBe(0);
    });

    it("sweeps a lapsed room on a relay call, not just get/size/join", () => {
      const a = peer("a");
      const b = peer("b");
      graced.create(ROOM, a);
      graced.join(ROOM, b);
      graced.disconnect(ROOM, a);
      b.sent.length = 0;

      clock += 60_001;
      // A survivor mid-game only ever calls relay, not get/size/join — the
      // sweep still has to catch the lapse from here, or the room and its
      // host_gone notification would never fire.
      graced.relay(ROOM, "b", "a", { sdp: "offer" });

      expect(b.sent).toContainEqual({ t: "error", code: "host_gone" });
      expect(graced.size).toBe(0);
    });
  });
});
