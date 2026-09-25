import type { Lobby } from "./lobby.js";
import type { SignalingClient } from "./signaling.js";
import type { Transport } from "./transport.js";
import { acceptAsHost } from "./peer.js";

/** The part of a host session that admitting a lobby's members needs. */
export type AdmittingHost = {
  addPeer(peerId: string, transport: Transport): number;
  removePeer(peerId: string): void;
  retainPeers(ids: ReadonlySet<string>): void;
};

export type HostAdmissionOptions = {
  /** Answers one offer with a transport. The WebRTC handshake unless a test says otherwise. */
  accept?: (
    signaling: SignalingClient,
    from: string,
    offer: RTCSessionDescriptionInit,
    onClose: () => void,
  ) => Promise<Transport>;
  /** Applied to every transport before the host takes it (the link degradation, in the game). */
  wrap?: (transport: Transport) => Transport;
  /** Told the entity the host spawned for each peer it admitted. */
  onAdmitted?: (entityId: number, peerId: string) => void;
};

export type HostAdmission = {
  /**
   * Answer offers over this lobby's socket from now on, and keep the host's
   * peers to the lobby's members. Replaces any lobby attached before.
   */
  attach(lobby: Lobby): void;
  dispose(): void;
};

/**
 * How a running host takes in the players a lobby brings. Hosting covers
 * solo play too — a host session with zero peers is exactly a local game —
 * so the only difference a lobby makes is whether offers are answered, and
 * the lobby can appear at any point: Play with no party opens one only when
 * Invite is pressed mid-game. Whatever the game registers on the lobby's
 * socket must be undone on dispose, because the socket outlives the game.
 */
export function createHostAdmission(
  host: AdmittingHost,
  options: HostAdmissionOptions = {},
): HostAdmission {
  const accept = options.accept ?? acceptAsHost;
  const wrap = options.wrap ?? ((t: Transport) => t);
  let detach: (() => void) | null = null;

  return {
    attach(lobby) {
      detach?.();
      const signaling = lobby.signaling;
      const offSignal = signaling.onSignal((from, payload) => {
        const data = payload as { sdp?: RTCSessionDescriptionInit };
        if (!data.sdp || data.sdp.type !== "offer") return;
        void accept(signaling, from, data.sdp, () => host.removePeer(from))
          .then((transport) => {
            // The host sends pairings and never receives one: it records the
            // entity `addPeer` just spawned for this peer itself. Spawned
            // before the callback is looked up: an optional call skips its
            // arguments when there is no callback, and the peer must be
            // admitted whether or not anyone wants to hear about it.
            const entityId = host.addPeer(from, wrap(transport));
            options.onAdmitted?.(entityId, from);
          })
          .catch(() => undefined);
      });
      // A data channel only closes when the other side closes it. A closed tab
      // or a dead phone never does, and the lobby is told at once either way
      // (`pagehide` says goodbye; the server reaps a silent socket), so the
      // lobby's list decides who is still in the world.
      const offChange = lobby.onChange((s) => host.retainPeers(new Set(s.members.map((m) => m.id))));
      detach = () => {
        offSignal();
        offChange();
        detach = null;
      };
    },
    dispose() {
      detach?.();
    },
  };
}
