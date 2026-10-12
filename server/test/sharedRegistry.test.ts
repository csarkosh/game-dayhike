import { describe, it, expect, beforeEach } from "vitest";
import { WebSocket } from "ws";
import type { AddressInfo } from "node:net";
import { FakeStore } from "./fakeStore.js";
import { INSTANCE_STALE_MS, INSTANCE_TOUCH_MS, ROOM_MAX_AGE_MS, SharedRegistry } from "../src/sharedRegistry.js";
import type { RoomInfo } from "../src/registry.js";
import type { RoomEndReason } from "../src/rooms.js";
import type { ServerMessage } from "../src/protocol.js";
import { createSignalingServer, SIGNALING_PATH } from "../src/server.js";

const ROOM = "3f2504e0-4f89-41d3-9a0c-0305e82c3301";
const OTHER = "9a0c0305-e82c-4330-8f25-04e04f8941d3";

type Recorded = { id: string; sent: ServerMessage[]; send(m: ServerMessage): void };

function peer(id: string): Recorded {
  const sent: ServerMessage[] = [];
  return { id, sent, send: (m) => sent.push(m) };
}

/** Two instances of the service over one store, on one clock. */
function twoInstances(grace = 1000) {
  const store = new FakeStore();
  let clock = 10_000;
  const now = () => clock;
  const ended: { inst: string; room: RoomInfo; reason: RoomEndReason }[] = [];
  const make = (inst: string) =>
    new SharedRegistry(store, { instance: inst, maxPeers: 5, now, hostGraceMs: grace, onEnded: (room, reason) => ended.push({ inst, room, reason }) });
  return { store, a: make("A"), b: make("B"), ended, advance: (ms: number) => void (clock += ms), now };
}

describe("SharedRegistry across two instances", () => {
  let t: ReturnType<typeof twoInstances>;
  beforeEach(() => {
    t = twoInstances();
  });

  it("seats a host on one instance and a guest on another, each told of the other", async () => {
    const host = peer("H");
    const guest = peer("G");
    const created = await t.a.create(ROOM, host);
    expect(created).toMatchObject({ ok: true, role: "host", hostId: "H", peers: [], room: { id: ROOM, peerCount: 1 } });
    const joined = await t.b.join(ROOM, guest);
    expect(joined).toMatchObject({ ok: true, role: "client", hostId: "H", peers: ["H"], room: { peerCount: 2 } });
    await t.store.settle();
    expect(host.sent).toEqual([{ t: "peer-joined", peerId: "G" }]);
    expect(guest.sent).toEqual([]);
    expect(t.a.info(ROOM)).toMatchObject({ hostId: "H", peerCount: 2 });
    expect(t.b.info(ROOM)).toMatchObject({ hostId: "H", peerCount: 2 });
  });

  it("relays across instances by mail, and within one by memory alone", async () => {
    const host = peer("H");
    const guest = peer("G");
    const local = peer("L");
    await t.a.create(ROOM, host);
    await t.b.join(ROOM, guest);
    await t.a.join(ROOM, local);
    await t.store.settle();
    t.store.ops.length = 0;

    await t.a.relay(ROOM, "H", "L", { sdp: "offer" });
    expect(local.sent).toEqual([{ t: "signal", from: "H", payload: { sdp: "offer" } }]);
    expect(t.store.ops).toEqual([]);

    await t.a.relay(ROOM, "H", "G", { sdp: "offer" });
    await t.b.relay(ROOM, "G", "H", { sdp: "answer" });
    await t.store.settle();
    expect(guest.sent.filter((m) => m.t === "signal")).toEqual([{ t: "signal", from: "H", payload: { sdp: "offer" } }]);
    expect(host.sent.filter((m) => m.t === "signal")).toEqual([{ t: "signal", from: "G", payload: { sdp: "answer" } }]);
    // Each piece of mail was posted once and deleted once delivered.
    expect(t.store.ops.filter((op) => op.startsWith("post"))).toEqual([`post ${ROOM} H->G`, `post ${ROOM} G->H`]);
    expect(t.store.ops.filter((op) => op.startsWith("deleteMail"))).toHaveLength(2);
    expect(t.store.mail.get(ROOM)?.size ?? 0).toBe(0);
  });

  it("watches for mail only while a room spans instances", async () => {
    const host = peer("H");
    const local = peer("L");
    await t.a.create(ROOM, host);
    await t.a.join(ROOM, local);
    await t.store.settle();
    expect(t.store.ops.filter((op) => op.startsWith("watchMail"))).toEqual([]);
    const guest = peer("G");
    await t.b.join(ROOM, guest);
    await t.store.settle();
    expect(t.store.ops.filter((op) => op.startsWith("watchMail")).sort()).toEqual([`watchMail ${ROOM} A`, `watchMail ${ROOM} B`]);
  });

  it("refuses as the memory registry does: a full room, a stale invite, a taken lobby, a host away", async () => {
    const host = peer("H");
    await t.a.create(ROOM, host);
    for (let i = 0; i < 4; i++) expect((await t.b.join(ROOM, peer(`g${i}`))).ok).toBe(true);
    expect(await t.b.join(ROOM, peer("g5"))).toEqual({ ok: false, code: "room_full" });
    expect(await t.b.join(OTHER, peer("x"))).toEqual({ ok: false, code: "no_such_lobby" });
    expect(await t.b.create(ROOM, peer("H2"))).toEqual({ ok: false, code: "lobby_taken" });
    await t.a.disconnect(ROOM, host);
    expect(await t.b.join(ROOM, peer("late"))).toEqual({ ok: false, code: "host_away" });
  });

  it("ends the room for a guest elsewhere when the host says goodbye", async () => {
    const host = peer("H");
    const guest = peer("G");
    await t.a.create(ROOM, host);
    await t.b.join(ROOM, guest);
    await t.store.settle();
    await t.a.leave(ROOM, host);
    await t.store.settle();
    expect(guest.sent).toEqual([{ t: "error", code: "host_gone" }]);
    expect(t.ended).toEqual([{ inst: "A", room: expect.objectContaining({ id: ROOM, hostId: "H" }), reason: "host_left" }]);
    expect(t.store.rooms.has(ROOM)).toBe(false);
    expect(t.b.info(ROOM)).toBeUndefined();
  });

  it("holds a dropped host's room for its window, lets the host reclaim it anywhere, and ends it from any instance", async () => {
    const host = peer("H");
    const guest = peer("G");
    await t.a.create(ROOM, host);
    await t.b.join(ROOM, guest);
    await t.store.settle();
    await t.a.disconnect(ROOM, host);
    await t.store.settle();
    // The guest's match is untouched: it hears only that the host's seat went.
    expect(guest.sent).toEqual([{ t: "peer-left", peerId: "H" }]);
    t.advance(500);
    await t.b.sweep();
    expect(t.store.rooms.has(ROOM)).toBe(true);

    // Back, on the other instance this time: nobody is told anything but the seat's return.
    const returned = peer("H");
    const reclaimed = await t.b.join(ROOM, returned);
    expect(reclaimed).toMatchObject({ ok: true, role: "host", peers: ["G"] });
    await t.store.settle();
    expect(guest.sent).toEqual([{ t: "peer-left", peerId: "H" }, { t: "peer-joined", peerId: "H" }]);
    // The old socket's late close on A evicts nothing: its seat is not the one in the room.
    await t.a.disconnect(ROOM, host);
    await t.store.settle();
    expect(t.store.rooms.get(ROOM)?.hostDroppedAt).toBeNull();

    // Gone again and for good: the window runs out and whichever instance sweeps ends it.
    await t.b.disconnect(ROOM, returned);
    t.advance(1000);
    await t.a.sweep();
    await t.b.sweep();
    await t.store.settle();
    expect(guest.sent.at(-1)).toEqual({ t: "error", code: "host_gone" });
    expect(t.ended.map((e) => e.reason)).toEqual(["host_gone"]);
    expect(t.store.rooms.has(ROOM)).toBe(false);
  });

  it("seats out everyone on an instance that stopped saying it is alive", async () => {
    const host = peer("H");
    const guest = peer("G");
    await t.a.create(ROOM, host);
    await t.b.join(ROOM, guest);
    await t.a.sweep();
    await t.b.sweep();
    await t.store.settle();
    expect(t.store.instances.size).toBe(2);
    // A falls silent; B keeps sweeping. Past the stale mark, A's host is seated out and its grace starts.
    // (The seat's own age counts too: a seat younger than the window is never swept.)
    t.advance(INSTANCE_STALE_MS + 1);
    await t.b.sweep();
    await t.store.settle();
    expect(t.store.rooms.get(ROOM)?.peers).toEqual({ G: expect.objectContaining({ inst: "B" }) });
    expect(t.store.rooms.get(ROOM)?.hostDroppedAt).toBe(t.now());
    expect(guest.sent).toEqual([{ t: "peer-left", peerId: "H" }]);
    t.advance(1000);
    await t.b.sweep();
    await t.store.settle();
    expect(guest.sent.at(-1)).toEqual({ t: "error", code: "host_gone" });
  });

  it("touches its liveness once a minute, not on every sweep", async () => {
    await t.a.create(ROOM, peer("H"));
    await t.a.sweep();
    await t.a.sweep();
    expect(t.store.ops.filter((op) => op.startsWith("touchInstance"))).toHaveLength(1);
    t.advance(INSTANCE_TOUCH_MS);
    await t.a.sweep();
    expect(t.store.ops.filter((op) => op.startsWith("touchInstance"))).toHaveLength(2);
  });

  it("ends a room older than any match", async () => {
    await t.a.create(ROOM, peer("H"));
    t.advance(ROOM_MAX_AGE_MS + 1);
    expect(await t.b.join(ROOM, peer("G"))).toEqual({ ok: false, code: "no_such_lobby" });
    expect(t.store.rooms.has(ROOM)).toBe(false);
  });

  it("deletes a room its last guest leaves, and one its last peer drops", async () => {
    const host = peer("H");
    await t.a.create(ROOM, host);
    const guest = peer("G");
    await t.b.join(ROOM, guest);
    await t.b.leave(ROOM, guest);
    await t.store.settle();
    expect(host.sent.at(-1)).toEqual({ t: "peer-left", peerId: "G" });
    expect(t.store.rooms.get(ROOM)?.peers).toEqual({ H: expect.anything() });
    await t.a.disconnect(ROOM, host);
    expect(t.store.rooms.has(ROOM)).toBe(false);
    expect(t.ended.map((e) => e.reason)).toEqual(["empty"]);
  });

  it("on close seats out its own peers and forgets itself", async () => {
    const host = peer("H");
    const guest = peer("G");
    await t.a.create(ROOM, host);
    await t.b.join(ROOM, guest);
    await t.a.sweep();
    await t.store.settle();
    await t.a.close();
    await t.store.settle();
    expect(t.store.instances.has("A")).toBe(false);
    expect(t.store.rooms.get(ROOM)?.hostDroppedAt).toBe(t.now());
    expect(guest.sent).toEqual([{ t: "peer-left", peerId: "H" }]);
  });
});

describe("two signaling servers over one store", () => {
  it("carry a lobby between them over real sockets", async () => {
    const store = new FakeStore();
    const servers = ["A", "B"].map((inst) =>
      createSignalingServer(0, {
        role: "signaling",
        log: () => undefined,
        sweepIntervalMs: 20,
        registry: (o) => new SharedRegistry(store, { ...o, instance: inst }),
      }),
    );
    await Promise.all(servers.map((s) => new Promise<void>((resolve) => s.http.once("listening", () => resolve()))));
    const urls = servers.map((s) => `ws://127.0.0.1:${(s.http.address() as AddressInfo).port}${SIGNALING_PATH}`);
    const open = async (url: string) => {
      const socket = new WebSocket(url);
      const received: ServerMessage[] = [];
      socket.on("message", (raw) => received.push(JSON.parse(raw.toString()) as ServerMessage));
      await new Promise<void>((resolve, reject) => {
        socket.once("open", () => resolve());
        socket.once("error", reject);
      });
      const waitFor = async (predicate: (m: ServerMessage) => boolean): Promise<ServerMessage> => {
        for (let i = 0; i < 200; i++) {
          const found = received.find(predicate);
          if (found) return found;
          await new Promise((r) => setTimeout(r, 10));
        }
        throw new Error(`timed out; received ${JSON.stringify(received)}`);
      };
      return { socket, received, waitFor, send: (m: unknown) => socket.send(JSON.stringify(m)) };
    };
    try {
      const host = await open(urls[0]!);
      const guest = await open(urls[1]!);
      host.send({ t: "create", room: ROOM, peerId: "H" });
      expect(await host.waitFor((m) => m.t === "joined")).toMatchObject({ role: "host", peers: [] });
      guest.send({ t: "join", room: ROOM, peerId: "G" });
      expect(await guest.waitFor((m) => m.t === "joined")).toMatchObject({ role: "client", hostId: "H", peers: ["H"] });
      expect(await host.waitFor((m) => m.t === "peer-joined")).toEqual({ t: "peer-joined", peerId: "G" });

      guest.send({ t: "signal", to: "H", payload: { sdp: "offer" } });
      expect(await host.waitFor((m) => m.t === "signal")).toEqual({ t: "signal", from: "G", payload: { sdp: "offer" } });
      host.send({ t: "signal", to: "G", payload: { candidate: "c1" } });
      expect(await guest.waitFor((m) => m.t === "signal")).toEqual({ t: "signal", from: "H", payload: { candidate: "c1" } });

      guest.send({ t: "leave" });
      expect(await host.waitFor((m) => m.t === "peer-left")).toEqual({ t: "peer-left", peerId: "G" });
      host.socket.close();
    } finally {
      await Promise.all(servers.map((s) => s.close()));
    }
    expect(store.instances.size).toBe(0);
  });
});
