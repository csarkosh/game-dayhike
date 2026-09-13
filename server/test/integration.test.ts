import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { WebSocket } from "ws";
import type { AddressInfo } from "node:net";
import { createSignalingServer, SIGNALING_PATH, type SignalingServer } from "../src/server.js";
import type { ServerMessage } from "../src/protocol.js";

const ROOM = "3f2504e0-4f89-41d3-9a0c-0305e82c3301";

let server: SignalingServer;
let url: string;

beforeAll(async () => {
  // Port 0 asks the OS for a free port, so tests never collide with a dev
  // server or with each other.
  server = createSignalingServer(0);
  await new Promise<void>((resolve) => server.http.once("listening", () => resolve()));
  const { port } = server.http.address() as AddressInfo;
  url = `ws://127.0.0.1:${port}${SIGNALING_PATH}`;
});

afterAll(async () => {
  await server.close();
});

/** A connected client that records everything the server sends it. */
class Client {
  readonly received: ServerMessage[] = [];
  private constructor(readonly socket: WebSocket) {}

  static async connect(target: string = url): Promise<Client> {
    const socket = new WebSocket(target);
    const client = new Client(socket);
    socket.on("message", (raw) => {
      client.received.push(JSON.parse(raw.toString()) as ServerMessage);
    });
    await new Promise<void>((resolve, reject) => {
      socket.once("open", () => resolve());
      socket.once("error", reject);
    });
    return client;
  }

  send(msg: unknown): void {
    this.socket.send(JSON.stringify(msg));
  }

  /** Waits for a message matching `predicate`, or throws after `timeoutMs`. */
  async waitFor(predicate: (m: ServerMessage) => boolean, timeoutMs = 2000): Promise<ServerMessage> {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      const found = this.received.find(predicate);
      if (found) return found;
      if (Date.now() > deadline) {
        throw new Error(`timed out; received: ${JSON.stringify(this.received)}`);
      }
      await new Promise((r) => setTimeout(r, 10));
    }
  }

  close(): void {
    this.socket.close();
  }
}

describe("signaling server over real websockets", () => {
  it("assigns host to the creator and client to a joiner", async () => {
    const a = await Client.connect();
    const b = await Client.connect();
    a.send({ t: "create", room: ROOM, peerId: "a1" });
    const joinedA = await a.waitFor((m) => m.t === "joined");
    expect(joinedA).toMatchObject({ t: "joined", role: "host", hostId: "a1" });

    b.send({ t: "join", room: ROOM, peerId: "b1" });
    const joinedB = await b.waitFor((m) => m.t === "joined");
    expect(joinedB).toMatchObject({ t: "joined", role: "client", hostId: "a1" });

    await a.waitFor((m) => m.t === "peer-joined");
    a.close();
    b.close();
  });

  it("relays a signal payload between two peers", async () => {
    const room = "11111111-2222-4333-8444-555555555555";
    const host = await Client.connect();
    const client = await Client.connect();
    host.send({ t: "create", room, peerId: "h" });
    await host.waitFor((m) => m.t === "joined");
    client.send({ t: "join", room, peerId: "c" });
    await client.waitFor((m) => m.t === "joined");

    client.send({ t: "signal", to: "h", payload: { sdp: "offer-blob" } });
    const relayed = await host.waitFor((m) => m.t === "signal");
    expect(relayed).toEqual({ t: "signal", from: "c", payload: { sdp: "offer-blob" } });

    host.close();
    client.close();
  });

  it("rejects a malformed room id", async () => {
    const c = await Client.connect();
    c.send({ t: "join", room: "not-a-uuid", peerId: "x" });
    const err = await c.waitFor((m) => m.t === "error");
    expect(err).toEqual({ t: "error", code: "bad_message" });
    c.close();
  });

  it("rejects a sixth peer with room_full", async () => {
    const room = "99999999-8888-4777-8666-555555555555";
    const clients: Client[] = [];
    for (let i = 0; i < 5; i++) {
      const c = await Client.connect();
      c.send({ t: i === 0 ? "create" : "join", room, peerId: `p${i}` });
      await c.waitFor((m) => m.t === "joined");
      clients.push(c);
    }
    const sixth = await Client.connect();
    sixth.send({ t: "join", room, peerId: "p5" });
    const err = await sixth.waitFor((m) => m.t === "error");
    expect(err).toEqual({ t: "error", code: "room_full" });

    for (const c of clients) c.close();
    sixth.close();
  });

  it("holds the room when the host's socket drops, and ends it when the host stays gone", async () => {
    const room = "abcdef00-1111-4222-8333-444444444444";
    // Its own server with a tiny grace window, so this does not wait a minute.
    const own = createSignalingServer(0, { hostGraceMs: 150, sweepIntervalMs: 25 });
    await new Promise<void>((resolve) => own.http.once("listening", () => resolve()));
    const ownUrl = `ws://127.0.0.1:${(own.http.address() as AddressInfo).port}${SIGNALING_PATH}`;

    // `finally`, not a trailing close: a failed assertion below would otherwise
    // leave this listener and its sweep timer running for the rest of the file.
    try {
      const host = await Client.connect(ownUrl);
      const client = await Client.connect(ownUrl);
      host.send({ t: "create", room, peerId: "H" });
      await host.waitFor((m) => m.t === "joined");
      client.send({ t: "join", room, peerId: "C" });
      await client.waitFor((m) => m.t === "joined");

      // Drop the host's socket outright, the way Cloud Run's 60-minute cap does.
      host.socket.terminate();

      // The peer-to-peer match is untouched, so the client must not be told the
      // session is over.
      await new Promise((r) => setTimeout(r, 50));
      expect(client.received.some((m) => m.t === "error")).toBe(false);

      // A host that comes back resumes without the client ever noticing.
      const returned = await Client.connect(ownUrl);
      returned.send({ t: "join", room, peerId: "H" });
      const rejoined = await returned.waitFor((m) => m.t === "joined");
      expect(rejoined).toMatchObject({ t: "joined", role: "host", hostId: "H" });
      expect(client.received.some((m) => m.t === "error")).toBe(false);

      // But a host that stays gone past the window ends the session.
      returned.socket.terminate();
      const gone = await client.waitFor((m) => m.t === "error");
      expect(gone).toEqual({ t: "error", code: "host_gone" });

      client.close();
    } finally {
      await own.close();
    }
  });

  it("keeps two different rooms isolated", async () => {
    const roomA = "aaaaaaaa-1111-4111-8111-111111111111";
    const roomB = "bbbbbbbb-2222-4222-8222-222222222222";
    const a = await Client.connect();
    const b = await Client.connect();
    a.send({ t: "create", room: roomA, peerId: "ra" });
    await a.waitFor((m) => m.t === "joined");
    b.send({ t: "create", room: roomB, peerId: "rb" });
    await b.waitFor((m) => m.t === "joined");

    // Both are hosts of their own room, and neither saw the other join.
    expect(a.received.some((m) => m.t === "peer-joined")).toBe(false);
    expect(b.received.some((m) => m.t === "peer-joined")).toBe(false);

    // A cross-room signal must not be delivered.
    a.send({ t: "signal", to: "rb", payload: { sdp: "leak" } });
    await new Promise((r) => setTimeout(r, 150));
    expect(b.received.some((m) => m.t === "signal")).toBe(false);

    a.close();
    b.close();
  });

  it("survives a garbage frame without dropping the connection", async () => {
    const c = await Client.connect();
    c.socket.send("{not json at all");
    const err = await c.waitFor((m) => m.t === "error");
    expect(err).toEqual({ t: "error", code: "bad_message" });
    expect(c.socket.readyState).toBe(WebSocket.OPEN);
    c.close();
  });

  it("refuses a join to a lobby nobody created", async () => {
    const c = await Client.connect();
    c.send({ t: "join", room: crypto.randomUUID(), peerId: "stranger" });
    const err = await c.waitFor((m) => m.t === "error");
    expect(err).toEqual({ t: "error", code: "no_such_lobby" });
    c.close();
  });
});
