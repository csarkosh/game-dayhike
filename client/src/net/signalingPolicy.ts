export type SignalingErrorAction = "end-session" | "ignore";

/**
 * Whether a signaling-level error should end the running match.
 *
 * Signaling is join-time scaffolding. Once the WebRTC data channels are up it
 * carries nothing the match needs, so losing it — or being told the host's
 * socket lapsed — says nothing about whether the game is still playable. Before
 * those channels exist, the same message means the game never started.
 *
 * `host_away` (the host is inside its reconnect grace window) is always
 * transient and join-time only: it can only ever be handed to someone who
 * has not connected yet, and it resolves itself within the grace window or
 * not at all, so it never justifies tearing anything down.
 *
 * `room_full` is the same story once peers are connected: the code is a
 * reply to somebody's join attempt (either the original join, or the resend
 * a reconnecting signaling socket issues under its own backoff), and a
 * full room only matters to whoever is still trying to get in. A player who
 * already has a live transport is not "trying to get in" — signaling being
 * told the room is full says nothing about whether their match is still
 * running.
 *
 * Kept in `net/` rather than in `app.ts` because `app.ts` reaches Babylon and so
 * cannot be unit tested.
 */
export function actionForSignalingError(
  code: string,
  peersConnected: boolean,
): SignalingErrorAction {
  if (code === "room_full") return peersConnected ? "ignore" : "end-session";
  if (code === "host_gone") return peersConnected ? "ignore" : "end-session";
  if (code === "host_away") return "ignore";
  return "ignore";
}
