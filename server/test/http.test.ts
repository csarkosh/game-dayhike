import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { WebSocket } from "ws";
import type { AddressInfo } from "node:net";
import {
  createSignalingServer,
  MAX_PAYLOAD_BYTES,
  SIGNALING_PATH,
  type SignalingServer,
} from "../src/server.js";

let server: SignalingServer;
let port: number;

beforeAll(async () => {
  server = createSignalingServer(0);
  await new Promise<void>((resolve) => server.http.once("listening", () => resolve()));
  port = (server.http.address() as AddressInfo).port;
});

afterAll(async () => {
  await server.close();
});

describe("http surface", () => {
  it("answers /healthcheck with 200 and body ok", async () => {
    const res = await fetch(`http://127.0.0.1:${port}/healthcheck`);
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("ok");
  });

  it("answers an unknown path with 404", async () => {
    const res = await fetch(`http://127.0.0.1:${port}/nope`);
    expect(res.status).toBe(404);
  });
});

describe("websocket upgrade", () => {
  it("accepts an upgrade on the signaling path", async () => {
    const socket = new WebSocket(`ws://127.0.0.1:${port}${SIGNALING_PATH}`);
    await new Promise<void>((resolve, reject) => {
      socket.once("open", () => resolve());
      socket.once("error", reject);
    });
    expect(socket.readyState).toBe(WebSocket.OPEN);
    socket.close();
  });

  it("refuses an upgrade on any other path", async () => {
    const socket = new WebSocket(`ws://127.0.0.1:${port}/not-signaling`);
    const err = await new Promise<Error>((resolve) => {
      socket.once("error", resolve);
      socket.once("open", () => resolve(new Error("unexpectedly opened")));
    });
    expect(err.message).not.toBe("unexpectedly opened");
  });
});

describe("payload limit", () => {
  it("rejects an oversized frame and stays up for everyone else", async () => {
    const attacker = new WebSocket(`ws://127.0.0.1:${port}${SIGNALING_PATH}`);
    await new Promise<void>((resolve, reject) => {
      attacker.once("open", () => resolve());
      attacker.once("error", reject);
    });

    const closed = new Promise<number>((resolve) => attacker.once("close", (code) => resolve(code)));
    // An error event also fires on the sending side; swallow it so it does not
    // surface as an unhandled error and fail the run for the wrong reason.
    attacker.once("error", () => undefined);
    attacker.send("x".repeat(MAX_PAYLOAD_BYTES * 2));

    // 1009 is "message too big": the frame was refused rather than buffered.
    expect(await closed).toBe(1009);

    // The point of the limit is not that the big frame fails — it is that the
    // one instance holding every live room is still there afterwards. Both
    // surfaces have to answer, since a heap death would take the whole process.
    const health = await fetch(`http://127.0.0.1:${port}/healthcheck`);
    expect(health.status).toBe(200);
    expect(await health.text()).toBe("ok");

    const survivor = new WebSocket(`ws://127.0.0.1:${port}${SIGNALING_PATH}`);
    const joined = await new Promise<Record<string, unknown>>((resolve, reject) => {
      survivor.once("open", () =>
        survivor.send(
          JSON.stringify({
            t: "create",
            room: "7c9e6679-7425-40de-944b-e07fc1f90ae7",
            peerId: "after-the-flood",
          }),
        ),
      );
      survivor.once("message", (raw) =>
        resolve(JSON.parse(raw.toString()) as Record<string, unknown>),
      );
      survivor.once("error", reject);
    });
    expect(joined).toMatchObject({ t: "joined", role: "host" });
    survivor.close();
  });
});

/** Starts a server on an ephemeral port and hands back its port. */
async function startServer(
  options: Parameters<typeof createSignalingServer>[1],
): Promise<{ server: SignalingServer; port: number }> {
  const own = createSignalingServer(0, options);
  await new Promise<void>((resolve) => own.http.once("listening", () => resolve()));
  return { server: own, port: (own.http.address() as AddressInfo).port };
}

/** Resolves with the handshake error, or rejects if the socket opens. */
function expectRefused(socket: WebSocket): Promise<Error> {
  return new Promise<Error>((resolve, reject) => {
    socket.once("error", resolve);
    socket.once("open", () => {
      socket.close();
      reject(new Error("socket opened but should have been refused"));
    });
  });
}

function opened(socket: WebSocket): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    socket.once("open", () => resolve());
    socket.once("error", reject);
  });
}

function nextMessage(socket: WebSocket): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    socket.once("message", (raw) => resolve(JSON.parse(raw.toString()) as Record<string, unknown>));
    socket.once("error", reject);
  });
}

async function joinRoom(
  port: number,
  room: string,
  peerId: string,
): Promise<{ socket: WebSocket; reply: Record<string, unknown> }> {
  const socket = new WebSocket(`ws://127.0.0.1:${port}${SIGNALING_PATH}`);
  await opened(socket);
  const reply = nextMessage(socket);
  socket.send(JSON.stringify({ t: "join", room, peerId }));
  return { socket, reply: await reply };
}

/** Like `joinRoom`, but opens the lobby rather than joining an existing one. */
async function createRoom(
  port: number,
  room: string,
  peerId: string,
): Promise<{ socket: WebSocket; reply: Record<string, unknown> }> {
  const socket = new WebSocket(`ws://127.0.0.1:${port}${SIGNALING_PATH}`);
  await opened(socket);
  const reply = nextMessage(socket);
  socket.send(JSON.stringify({ t: "create", room, peerId }));
  return { socket, reply: await reply };
}

/**
 * Stops the client from ever seeing another frame, which is what a half-open
 * socket looks like from the server: no FIN, no close, and — crucially — no
 * automatic pong, since `ws` can only answer a ping it has read.
 */
function goSilent(socket: WebSocket): void {
  (socket as unknown as { _socket: { pause(): void } })._socket.pause();
}

describe("origin allowlist", () => {
  it("accepts the production origin", async () => {
    const socket = new WebSocket(`ws://127.0.0.1:${port}${SIGNALING_PATH}`, {
      origin: "https://game.csarko.sh",
    });
    await opened(socket);
    expect(socket.readyState).toBe(WebSocket.OPEN);
    socket.close();
  });

  it("refuses another site's page with 403", async () => {
    const socket = new WebSocket(`ws://127.0.0.1:${port}${SIGNALING_PATH}`, {
      origin: "https://evil.example",
    });
    const err = await expectRefused(socket);
    expect(err.message).toContain("403");
  });

  it("honours an overridden allowlist", async () => {
    const { server: own, port: ownPort } = await startServer({
      allowedOrigins: ["https://staging.example"],
    });
    try {
      const allowed = new WebSocket(`ws://127.0.0.1:${ownPort}${SIGNALING_PATH}`, {
        origin: "https://staging.example",
      });
      await opened(allowed);
      allowed.close();

      const refused = new WebSocket(`ws://127.0.0.1:${ownPort}${SIGNALING_PATH}`, {
        origin: "https://game.csarko.sh",
      });
      expect((await expectRefused(refused)).message).toContain("403");
    } finally {
      await own.close();
    }
  });
});

describe("connection limits", () => {
  it("refuses a third socket from one address with 429, then admits one after a close", async () => {
    const { server: own, port: ownPort } = await startServer({ limits: { maxPerIp: 2 } });
    try {
      const first = new WebSocket(`ws://127.0.0.1:${ownPort}${SIGNALING_PATH}`);
      const second = new WebSocket(`ws://127.0.0.1:${ownPort}${SIGNALING_PATH}`);
      await Promise.all([opened(first), opened(second)]);

      const third = new WebSocket(`ws://127.0.0.1:${ownPort}${SIGNALING_PATH}`);
      expect((await expectRefused(third)).message).toContain("429");

      // The slot has to come back, or a busy address locks itself out forever.
      const gone = new Promise<void>((resolve) => first.once("close", () => resolve()));
      first.close();
      await gone;

      const fourth = new WebSocket(`ws://127.0.0.1:${ownPort}${SIGNALING_PATH}`);
      await opened(fourth);
      expect(fourth.readyState).toBe(WebSocket.OPEN);
      fourth.close();
      second.close();
    } finally {
      await own.close();
    }
  });

  it("refuses churn past the attempt ceiling even when nothing is held open", async () => {
    const { server: own, port: ownPort } = await startServer({
      limits: { maxAttemptsPerWindow: 2, windowMs: 60_000 },
    });
    try {
      for (let i = 0; i < 2; i += 1) {
        const socket = new WebSocket(`ws://127.0.0.1:${ownPort}${SIGNALING_PATH}`);
        await opened(socket);
        const gone = new Promise<void>((resolve) => socket.once("close", () => resolve()));
        socket.close();
        await gone;
      }

      const extra = new WebSocket(`ws://127.0.0.1:${ownPort}${SIGNALING_PATH}`);
      expect((await expectRefused(extra)).message).toContain("429");
    } finally {
      await own.close();
    }
  });
});

describe("heartbeat", () => {
  const ROOM = "3f2504e0-4f89-11d3-9a0c-0305e82c3301";

  it("leaves a healthy socket alone across several intervals", async () => {
    const { server: own, port: ownPort } = await startServer({ heartbeatIntervalMs: 20 });
    try {
      const { socket, reply } = await createRoom(ownPort, ROOM, "healthy");
      expect(reply).toMatchObject({ t: "joined", role: "host" });

      // Long enough for many ping/pong rounds. `ws` answers each automatically,
      // exactly as a browser does, so nothing here should be terminated.
      await new Promise((resolve) => setTimeout(resolve, 200));
      expect(socket.readyState).toBe(WebSocket.OPEN);
      socket.close();
    } finally {
      await own.close();
    }
  });

  it("ends a room whose host went silent without ever closing its socket", async () => {
    // The hole this closes: with no ping, a half-open host socket raises no
    // close event, `hostDroppedAt` is never set, and the sweep skips that room
    // for the life of the process — stranding the survivors and turning away
    // everyone holding the invite link with `host_away`, forever.
    const { server: own, port: ownPort } = await startServer({
      heartbeatIntervalMs: 20,
      hostGraceMs: 60,
      sweepIntervalMs: 20,
    });
    try {
      const { socket: host, reply: hostReply } = await createRoom(ownPort, ROOM, "silent-host");
      expect(hostReply).toMatchObject({ t: "joined", role: "host" });

      const { socket: client, reply: clientReply } = await joinRoom(ownPort, ROOM, "survivor");
      expect(clientReply).toMatchObject({ t: "joined", role: "client" });

      const ended = nextMessage(client);
      goSilent(host);

      expect(await ended).toEqual({ t: "error", code: "host_gone" });
      client.close();
      host.terminate();
    } finally {
      await own.close();
    }
  });

  it("tells the remaining peers when a client goes silent", async () => {
    const { server: own, port: ownPort } = await startServer({ heartbeatIntervalMs: 20 });
    try {
      const { socket: host } = await createRoom(ownPort, ROOM, "host");

      // The host is told about the arrival before it is told about the
      // departure, and nothing buffers an unlistened-for message, so this
      // listener has to be attached before the second peer joins at all.
      const arrived = nextMessage(host);
      const { socket: client } = await joinRoom(ownPort, ROOM, "vanishing-client");
      expect(await arrived).toEqual({ t: "peer-joined", peerId: "vanishing-client" });

      const departed = nextMessage(host);
      goSilent(client);

      expect(await departed).toEqual({ t: "peer-left", peerId: "vanishing-client" });
      host.close();
      client.terminate();
    } finally {
      await own.close();
    }
  });
});

/** Resolves with the close code, or -1 if the socket stayed open. */
function closeCodeWithin(socket: WebSocket, ms: number): Promise<number> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(-1), ms);
    socket.once("close", (code) => {
      clearTimeout(timer);
      resolve(code);
    });
    socket.once("error", () => undefined);
  });
}

describe("message rate", () => {
  const ROOM = "0b5a1f22-8f5e-4a26-9b8b-2f0a3c7d5e11";

  it("closes a socket that floods past its burst", async () => {
    const { server: own, port: ownPort } = await startServer({
      messageRate: { capacity: 5, refillPerSecond: 1 },
    });
    try {
      const socket = new WebSocket(`ws://127.0.0.1:${ownPort}${SIGNALING_PATH}`);
      await opened(socket);

      const closed = closeCodeWithin(socket, 2000);
      for (let i = 0; i < 50; i += 1) {
        socket.send(JSON.stringify({ t: "signal", to: "nobody", payload: {} }));
      }

      // 1008 is "policy violation" — refused for what it did, not for a
      // protocol fault.
      expect(await closed).toBe(1008);
    } finally {
      await own.close();
    }
  });

  it("leaves a normal join-and-signal exchange alone", async () => {
    const { server: own, port: ownPort } = await startServer({
      messageRate: { capacity: 5, refillPerSecond: 1 },
    });
    try {
      const { socket: host } = await createRoom(ownPort, ROOM, "host");
      const { socket: client, reply } = await joinRoom(ownPort, ROOM, "client");
      expect(reply).toMatchObject({ t: "joined", role: "client" });

      // A real handshake is a handful of frames. Well inside a budget of five,
      // which is itself twenty times smaller than the shipped default.
      const relayed = nextMessage(host);
      client.send(JSON.stringify({ t: "signal", to: "host", payload: { sdp: "offer" } }));
      expect(await relayed).toEqual({
        t: "signal",
        from: "client",
        payload: { sdp: "offer" },
      });

      expect(client.readyState).toBe(WebSocket.OPEN);
      expect(host.readyState).toBe(WebSocket.OPEN);
      host.close();
      client.close();
    } finally {
      await own.close();
    }
  });

  it("charges the budget per socket, not per server", async () => {
    const { server: own, port: ownPort } = await startServer({
      messageRate: { capacity: 5, refillPerSecond: 1 },
    });
    try {
      const flooder = new WebSocket(`ws://127.0.0.1:${ownPort}${SIGNALING_PATH}`);
      const bystander = new WebSocket(`ws://127.0.0.1:${ownPort}${SIGNALING_PATH}`);
      await Promise.all([opened(flooder), opened(bystander)]);

      const flooderClosed = closeCodeWithin(flooder, 2000);
      for (let i = 0; i < 50; i += 1) {
        flooder.send(JSON.stringify({ t: "signal", to: "nobody", payload: {} }));
      }
      expect(await flooderClosed).toBe(1008);

      // One peer exhausting its budget must not spend anyone else's.
      expect(bystander.readyState).toBe(WebSocket.OPEN);
      const reply = nextMessage(bystander);
      bystander.send(JSON.stringify({ t: "create", room: ROOM, peerId: "unaffected" }));
      expect(await reply).toMatchObject({ t: "joined", role: "host" });
      bystander.close();
    } finally {
      await own.close();
    }
  });
});

describe("backpressure", () => {
  const ROOM = "6d1c9e40-3b77-4c1a-9f2e-8a4b5c6d7e80";

  it("closes a peer whose backlog passes the ceiling instead of buffering more", async () => {
    // The backlog is reported rather than produced: congesting a real socket
    // far enough is timing-dependent, and a flaky test would prove less than
    // this does about the rule itself.
    let backlog = 0;
    const { server: own, port: ownPort } = await startServer({
      maxBufferedBytes: 1024,
      bufferedAmountOf: () => backlog,
    });
    try {
      const { socket: host } = await createRoom(ownPort, ROOM, "host");

      // Attached before the join it is waiting for: nothing buffers a message
      // no listener wanted, so the arrival notice would otherwise be gone.
      const arrived = nextMessage(host);
      const { socket: client } = await joinRoom(ownPort, ROOM, "slow-consumer");
      await arrived;

      backlog = 2048;
      const closed = closeCodeWithin(client, 2000);
      host.send(JSON.stringify({ t: "signal", to: "slow-consumer", payload: { sdp: "x" } }));

      // 1013 is "try again later": the peer is not at fault, it is just not
      // keeping up, and reconnecting is the right response.
      expect(await closed).toBe(1013);
      host.close();
    } finally {
      await own.close();
    }
  });

  it("leaves a peer alone while its backlog is under the ceiling", async () => {
    let backlog = 0;
    const { server: own, port: ownPort } = await startServer({
      maxBufferedBytes: 1024,
      bufferedAmountOf: () => backlog,
    });
    try {
      const { socket: host } = await createRoom(ownPort, ROOM, "host");
      const arrived = nextMessage(host);
      const { socket: client } = await joinRoom(ownPort, ROOM, "keeping-up");
      await arrived;

      backlog = 1024; // at the ceiling, not past it
      const relayed = nextMessage(client);
      host.send(JSON.stringify({ t: "signal", to: "keeping-up", payload: { sdp: "y" } }));

      expect(await relayed).toMatchObject({ t: "signal", from: "host" });
      expect(client.readyState).toBe(WebSocket.OPEN);
      host.close();
      client.close();
    } finally {
      await own.close();
    }
  });
});

describe("lifecycle", () => {
  it("closes live sockets when the server closes", async () => {
    const own = createSignalingServer(0);
    await new Promise<void>((resolve) => own.http.once("listening", () => resolve()));
    const ownPort = (own.http.address() as AddressInfo).port;

    const socket = new WebSocket(`ws://127.0.0.1:${ownPort}${SIGNALING_PATH}`);
    await new Promise<void>((resolve, reject) => {
      socket.once("open", () => resolve());
      socket.once("error", reject);
    });

    const closed = new Promise<void>((resolve) => socket.once("close", () => resolve()));
    await own.close();
    await closed;
    expect(socket.readyState).toBe(WebSocket.CLOSED);
  });
});
