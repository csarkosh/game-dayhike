import { describe, it, expect } from "vitest";
import type { JoinedInfo, SignalingClient } from "../../src/net/signaling.js";
import type { Transport } from "../../src/net/transport.js";
import { createLobby, type Lobby } from "../../src/net/lobby.js";
import { createHostAdmission, type AdmittingHost } from "../../src/net/hostAdmission.js";

const LOBBY = "3f2504e0-4f89-41d3-9a0c-0305e82c3301";
const HOST = "host-1";
const JOINER = "joiner-2";
const OFFER = { sdp: { type: "offer", sdp: "v=0" } };

/** A hand-driven SignalingClient: records sends, lets the test deliver. */
class FakeSignaling implements SignalingClient {
  sent: { to: string; payload: unknown }[] = [];
  private signalHandlers: ((from: string, payload: unknown) => void)[] = [];
  private leftHandlers: ((id: string) => void)[] = [];

  create(): Promise<JoinedInfo> {
    return Promise.resolve({ role: "host", hostId: HOST, peers: [] });
  }
  join(): Promise<JoinedInfo> {
    return Promise.resolve({ role: "host", hostId: HOST, peers: [] });
  }
  send(to: string, payload: unknown): void {
    this.sent.push({ to, payload });
  }
  onSignal(h: (from: string, payload: unknown) => void): () => void {
    this.signalHandlers.push(h);
    return () => this.signalHandlers.splice(this.signalHandlers.indexOf(h), 1);
  }
  onRejoined(): () => void {
    return () => undefined;
  }
  onPeerJoined(): void {}
  onPeerLeft(h: (id: string) => void): () => void {
    this.leftHandlers.push(h);
    return () => this.leftHandlers.splice(this.leftHandlers.indexOf(h), 1);
  }
  onError(): () => void {
    return () => undefined;
  }
  onOpen(): () => void {
    return () => undefined;
  }
  setRole(): void {}
  leave(): void {}
  close(): void {}

  // test drivers
  deliver(from: string, payload: unknown): void {
    for (const h of [...this.signalHandlers]) h(from, payload);
  }
  peerLeft(id: string): void {
    for (const h of [...this.leftHandlers]) h(id);
  }
  get handlerCount(): number {
    return this.signalHandlers.length;
  }
}

/** Records what the game's host session would be told. */
class FakeHost implements AdmittingHost {
  added: { peerId: string; transport: Transport }[] = [];
  removed: string[] = [];
  retained: string[][] = [];
  private nextEntity = 2;

  addPeer(peerId: string, transport: Transport): number {
    this.added.push({ peerId, transport });
    return this.nextEntity++;
  }
  removePeer(peerId: string): void {
    this.removed.push(peerId);
  }
  retainPeers(ids: ReadonlySet<string>): void {
    this.retained.push([...ids].sort());
  }
}

/** A transport the tests can tell apart by name. */
type LabelledTransport = Transport & { label: string };

function fakeTransport(label: string): LabelledTransport {
  return {
    label,
    sendState() {},
    sendEvent() {},
    onState() {},
    onEvent() {},
    open: true,
    close() {},
  };
}

function labelOf(transport: Transport | undefined): string | null {
  if (transport === undefined || !("label" in transport)) return null;
  return String(transport.label);
}

/** Stands in for the WebRTC handshake: answers every offer with a fresh transport. */
function fakeAccept() {
  const calls: { from: string; onClose: () => void }[] = [];
  const accept = (
    _signaling: SignalingClient,
    from: string,
    _offer: RTCSessionDescriptionInit,
    onClose: () => void,
  ): Promise<Transport> => {
    calls.push({ from, onClose });
    return Promise.resolve(fakeTransport(`transport-${from}`));
  };
  return { accept, calls };
}

async function hostedLobby(): Promise<{ lobby: Lobby; signaling: FakeSignaling }> {
  const signaling = new FakeSignaling();
  const lobby = await createLobby({ signaling, peerId: HOST, lobbyId: LOBBY, name: "Ada" });
  return { lobby, signaling };
}

/** Lets the accept promise and the admission's `.then` settle. */
async function settle(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

describe("host admission", () => {
  it("answers an offer over a lobby attached when the game starts", async () => {
    const { lobby, signaling } = await hostedLobby();
    const host = new FakeHost();
    const { accept, calls } = fakeAccept();
    const admitted: { entityId: number; peerId: string }[] = [];
    const admission = createHostAdmission(host, {
      accept,
      onAdmitted: (entityId, peerId) => admitted.push({ entityId, peerId }),
    });
    admission.attach(lobby);

    signaling.deliver(JOINER, OFFER);
    await settle();

    expect(calls.length).toBe(1);
    expect(calls[0]?.from).toBe(JOINER);
    expect(host.added.length).toBe(1);
    expect(host.added[0]?.peerId).toBe(JOINER);
    expect(admitted).toEqual([{ entityId: 2, peerId: JOINER }]);
  });

  it("answers an offer that arrives only once a lobby opened mid-game is attached", async () => {
    // The game started with no lobby at all: nothing listens for offers, and
    // a joiner's first offer is lost. Invite then opens a lobby; the joiner's
    // next offer must be answered.
    const host = new FakeHost();
    const { accept, calls } = fakeAccept();
    const admission = createHostAdmission(host, { accept });

    const { lobby, signaling } = await hostedLobby();
    signaling.deliver(JOINER, OFFER);
    await settle();
    expect(calls.length).toBe(0);
    expect(host.added.length).toBe(0);

    admission.attach(lobby);
    signaling.deliver(JOINER, OFFER);
    await settle();

    expect(calls.length).toBe(1);
    expect(calls[0]?.from).toBe(JOINER);
    expect(host.added.length).toBe(1);
    expect(host.added[0]?.peerId).toBe(JOINER);
  });

  it("ignores everything on the socket that is not an offer", async () => {
    const { lobby, signaling } = await hostedLobby();
    const host = new FakeHost();
    const { accept, calls } = fakeAccept();
    createHostAdmission(host, { accept }).attach(lobby);

    signaling.deliver(JOINER, { sdp: { type: "answer", sdp: "v=0" } });
    signaling.deliver(JOINER, { candidate: { candidate: "candidate:1 1 udp 1 127.0.0.1 1 typ host" } });
    signaling.deliver(JOINER, { lobby: "hello", name: "Grace" });
    await settle();

    expect(calls.length).toBe(0);
    expect(host.added.length).toBe(0);
  });

  it("hands the host the wrapped transport", async () => {
    const { lobby, signaling } = await hostedLobby();
    const host = new FakeHost();
    const { accept } = fakeAccept();
    createHostAdmission(host, {
      accept,
      wrap: (t) => fakeTransport(`wrapped:${labelOf(t)}`),
    }).attach(lobby);

    signaling.deliver(JOINER, OFFER);
    await settle();

    expect(labelOf(host.added[0]?.transport)).toBe(`wrapped:transport-${JOINER}`);
  });

  it("removes a peer whose transport closes", async () => {
    const { lobby, signaling } = await hostedLobby();
    const host = new FakeHost();
    const { accept, calls } = fakeAccept();
    createHostAdmission(host, { accept }).attach(lobby);

    signaling.deliver(JOINER, OFFER);
    await settle();
    calls[0]?.onClose();

    expect(host.removed).toEqual([JOINER]);
  });

  it("keeps the host's peers to the lobby's members", async () => {
    const { lobby, signaling } = await hostedLobby();
    const host = new FakeHost();
    const { accept } = fakeAccept();
    createHostAdmission(host, { accept }).attach(lobby);

    signaling.deliver(JOINER, { lobby: "hello", name: "Grace" });
    expect(host.retained.length).toBe(1);
    expect(host.retained[0]).toEqual([HOST, JOINER]);

    signaling.peerLeft(JOINER);
    expect(host.retained.length).toBe(2);
    expect(host.retained[1]).toEqual([HOST]);
  });

  it("stops listening on dispose", async () => {
    const { lobby, signaling } = await hostedLobby();
    const host = new FakeHost();
    const { accept, calls } = fakeAccept();
    const admission = createHostAdmission(host, { accept });
    // The lobby's own handler is the one that stays.
    expect(signaling.handlerCount).toBe(1);
    admission.attach(lobby);
    expect(signaling.handlerCount).toBe(2);

    admission.dispose();
    expect(signaling.handlerCount).toBe(1);
    signaling.deliver(JOINER, OFFER);
    signaling.deliver(JOINER, { lobby: "hello", name: "Grace" });
    await settle();

    expect(calls.length).toBe(0);
    expect(host.retained.length).toBe(0);
  });

  it("lets go of an earlier lobby when a later one is attached", async () => {
    const first = await hostedLobby();
    const second = await hostedLobby();
    const host = new FakeHost();
    const { accept, calls } = fakeAccept();
    const admission = createHostAdmission(host, { accept });
    admission.attach(first.lobby);
    admission.attach(second.lobby);
    expect(first.signaling.handlerCount).toBe(1);

    first.signaling.deliver(JOINER, OFFER);
    await settle();
    expect(calls.length).toBe(0);

    second.signaling.deliver(JOINER, OFFER);
    await settle();
    expect(calls.length).toBe(1);
  });
});
