import { ICE_TIMEOUT_MS } from "../sim/constants.js";
import type { Transport } from "./transport.js";
import {
  EVENT_CHANNEL,
  EVENT_CHANNEL_INIT,
  STATE_CHANNEL,
  STATE_CHANNEL_INIT,
  createDataChannelTransport,
} from "./channels.js";
import type { SignalingClient } from "./signaling.js";

// STUN only. TURN is a deliberate non-goal for this milestone.
const ICE_SERVERS: RTCIceServer[] = [
  { urls: ["stun:stun.l.google.com:19302", "stun:stun1.l.google.com:19302"] },
];

type SignalPayload = {
  sdp?: RTCSessionDescriptionInit;
  candidate?: RTCIceCandidateInit;
};

function newConnection(): RTCPeerConnection {
  return new RTCPeerConnection({ iceServers: ICE_SERVERS });
}

function waitForOpen(channel: RTCDataChannel): Promise<void> {
  return new Promise((resolve) => {
    if (channel.readyState === "open") resolve();
    else channel.onopen = () => resolve();
  });
}

function withTimeout<T>(promise: Promise<T>, ms: number, message: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(message)), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (err: unknown) => {
        clearTimeout(timer);
        reject(err instanceof Error ? err : new Error(String(err)));
      },
    );
  });
}

/** The joining side creates the channels and sends the offer. */
export async function connectAsClient(
  signaling: SignalingClient,
  hostPeerId: string,
  onClose?: () => void,
): Promise<Transport> {
  const pc = newConnection();
  const state = pc.createDataChannel(STATE_CHANNEL, STATE_CHANNEL_INIT);
  const event = pc.createDataChannel(EVENT_CHANNEL, EVENT_CHANNEL_INIT);

  pc.onicecandidate = (e) => {
    if (e.candidate) signaling.send(hostPeerId, { candidate: e.candidate.toJSON() });
  };

  let offSignal: () => void = () => undefined;
  const answered = new Promise<void>((resolve, reject) => {
    // Registered before the offer goes out so no answer or candidate is missed.
    offSignal = signaling.onSignal((from, payload) => {
      if (from !== hostPeerId) return;
      const data = payload as SignalPayload;
      if (data.sdp) {
        pc.setRemoteDescription(data.sdp).then(() => resolve(), reject);
      } else if (data.candidate) {
        void pc.addIceCandidate(data.candidate).catch(() => undefined);
      }
    });
  });

  try {
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    signaling.send(hostPeerId, { sdp: offer });

    await withTimeout(answered, ICE_TIMEOUT_MS, "ice_failed");
    await withTimeout(
      Promise.all([waitForOpen(state), waitForOpen(event)]),
      ICE_TIMEOUT_MS,
      "ice_failed",
    );
  } catch (err) {
    // A handshake that throws never reaches `createDataChannelTransport`, so
    // nothing else will ever run `offSignal` or close this connection. On a
    // socket that outlives the game that is a handler and a candidate-trickling
    // RTCPeerConnection left behind per failed attempt, for the life of the
    // lobby. Cleaned up here rather than in a `finally`, which would also fire
    // on the success path where both must stay alive.
    offSignal();
    pc.close();
    throw err;
  }

  // A lobby socket now outlives many games, so a handler per past connection
  // must not accumulate — `offSignal` runs as `onDispose`, on every teardown,
  // not only the peer-left path `onClose` covers.
  return createDataChannelTransport(state, event, onClose, offSignal);
}

/** The host answers and receives the channels the client created. */
export async function acceptAsHost(
  signaling: SignalingClient,
  remotePeerId: string,
  firstOffer: RTCSessionDescriptionInit,
  onClose?: () => void,
): Promise<Transport> {
  const pc = newConnection();

  // Registered synchronously, before any await: the client starts trickling
  // candidates the moment it sends its offer, and anything arriving before
  // this handler exists is simply lost.
  const offSignal = signaling.onSignal((from, payload) => {
    if (from !== remotePeerId) return;
    const data = payload as SignalPayload;
    if (data.candidate) void pc.addIceCandidate(data.candidate).catch(() => undefined);
  });

  const channels = new Promise<{ state: RTCDataChannel; event: RTCDataChannel }>((resolve) => {
    const found: Record<string, RTCDataChannel> = {};
    pc.ondatachannel = (e) => {
      found[e.channel.label] = e.channel;
      const state = found[STATE_CHANNEL];
      const event = found[EVENT_CHANNEL];
      if (state && event) resolve({ state, event });
    };
  });

  pc.onicecandidate = (e) => {
    if (e.candidate) signaling.send(remotePeerId, { candidate: e.candidate.toJSON() });
  };

  let state: RTCDataChannel;
  let event: RTCDataChannel;
  try {
    await pc.setRemoteDescription(firstOffer);
    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);
    signaling.send(remotePeerId, { sdp: answer });

    ({ state, event } = await withTimeout(channels, ICE_TIMEOUT_MS, "ice_failed"));
    await withTimeout(
      Promise.all([waitForOpen(state), waitForOpen(event)]),
      ICE_TIMEOUT_MS,
      "ice_failed",
    );
  } catch (err) {
    // See `connectAsClient`: nothing downstream exists to clean up after a
    // handshake that throws, and a host answers many of these over one socket.
    offSignal();
    pc.close();
    throw err;
  }

  // A lobby socket now outlives many games, so a handler per past connection
  // must not accumulate — `offSignal` runs as `onDispose`, on every teardown,
  // not only the peer-left path `onClose` covers.
  return createDataChannelTransport(state, event, onClose, offSignal);
}
