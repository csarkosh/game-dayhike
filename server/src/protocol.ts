export type ClientMessage =
  | { t: "create"; room: string; peerId: string }
  | { t: "join"; room: string; peerId: string }
  | { t: "signal"; to: string; payload: unknown }
  | { t: "leave" };

export type ServerMessage =
  | { t: "joined"; role: "host" | "client"; hostId: string; peers: string[] }
  | { t: "peer-joined"; peerId: string }
  | { t: "peer-left"; peerId: string }
  | { t: "signal"; from: string; payload: unknown }
  | {
      t: "error";
      code:
        | "room_full"
        | "invalid_room"
        | "bad_message"
        | "host_gone"
        | "host_away"
        | "no_such_lobby"
        | "lobby_taken";
    };

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isValidRoomId(value: unknown): value is string {
  return typeof value === "string" && UUID_RE.test(value);
}

export function parseClientMessage(raw: string): ClientMessage | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof parsed !== "object" || parsed === null) return null;
  const msg = parsed as Record<string, unknown>;

  if (msg.t === "create" || msg.t === "join") {
    if (!isValidRoomId(msg.room) || typeof msg.peerId !== "string" || msg.peerId.length === 0) {
      return null;
    }
    return { t: msg.t, room: msg.room, peerId: msg.peerId };
  }
  if (msg.t === "signal") {
    if (typeof msg.to !== "string" || msg.to.length === 0) return null;
    return { t: "signal", to: msg.to, payload: msg.payload };
  }
  if (msg.t === "leave") return { t: "leave" };
  return null;
}
