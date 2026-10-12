/**
 * The little of a document store the shared registry needs
 * (`sharedRegistry.ts`): a room document read and written atomically and
 * watched for change, mail posted to an instance and watched for by it, and
 * each instance's own liveness. Firestore implements it (`firestoreStore.ts`);
 * the tests' fake implements it in memory, so the registry's behaviour across
 * instances is tested under Node with no emulator.
 *
 * Every number here is epoch milliseconds, by the registry's own clock, so
 * the store holds no type of its own and a test's clock is the only clock.
 */

/** One peer's seat in a room: which instance holds its socket, a token that
 * socket alone knows (so a stale socket's close cannot evict its
 * replacement), and when it sat down. */
export type Seat = { inst: string; token: string; at: number };

export type RoomDoc = {
  hostId: string;
  createdAt: number;
  /** When the host's socket died, or null while it is connected; see `rooms.ts`. */
  hostDroppedAt: number | null;
  peers: Record<string, Seat>;
};

/** A signaling payload on its way to a peer another instance holds. */
export type Mail = { id: string; to: string; from: string; inst: string; payload: unknown };

export interface Store {
  /**
   * Read-modify-write one room atomically: `fn` sees the document or null
   * and returns the document to keep, null to delete it, or undefined to
   * leave it as it is. Resolves to what stands afterwards.
   */
  updateRoom(roomId: string, fn: (doc: RoomDoc | null) => RoomDoc | null | undefined): Promise<RoomDoc | null>;
  /** The room as it stands, and again on every change; null once deleted. Returns the unwatch. */
  watchRoom(roomId: string, onChange: (doc: RoomDoc | null) => void): () => void;
  /** Posts mail for the instance `mail.inst`. */
  post(roomId: string, mail: Omit<Mail, "id">): Promise<void>;
  /** Every piece of mail for `inst` in the room, as it arrives. Returns the unwatch. */
  watchMail(roomId: string, inst: string, onMail: (mail: Mail) => void): () => void;
  /** Mail delivered: gone. */
  deleteMail(roomId: string, id: string): Promise<void>;
  /** This instance is alive at `at`. */
  touchInstance(inst: string, at: number): Promise<void>;
  /** The instances alive at or after `since`. */
  instancesSeenSince(since: number): Promise<string[]>;
  /** This instance is going. */
  forgetInstance(inst: string): Promise<void>;
}
