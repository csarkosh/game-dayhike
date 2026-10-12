/**
 * The store on Firestore (`store.ts`): the project's default database, which
 * is the one the free quota applies to, three collections, and nothing else.
 *
 *   signalingRooms/{roomId}            the room document (`RoomDoc`)
 *   signalingRooms/{roomId}/mail/{id}  mail for an instance, deleted once delivered
 *   signalingInstances/{inst}          { seenAt }, each instance's last word
 *
 * Costs, against the free tier's 20,000 writes, 50,000 reads and 20,000
 * deletes a day: a party is a write to create, a read and a write a join, a
 * write a departure and a delete at the end; mail is a write, a read and a
 * delete a message and is only posted while a room spans instances; each
 * instance writes its liveness once a minute and reads the instances once a
 * minute while it is up. Mail is deleted by the registry, not by a TTL
 * policy, because TTL deletes are outside the free tier.
 *
 * Every timestamp is a number, the registry's clock, so the document holds
 * no type the fake store would have to imitate.
 */

import { Firestore, type DocumentReference } from "@google-cloud/firestore";
import type { Mail, RoomDoc, Store } from "./store.js";

export const ROOMS = "signalingRooms";
export const MAIL = "mail";
export const INSTANCES = "signalingInstances";

export type FirestoreStoreOptions = {
  /** The database's project; by default the environment's, as the library resolves it on Cloud Run. */
  projectId?: string;
  /** What to do with a watch that fails: logged, so a lost listener is not a silent one. */
  onError?: (where: string, error: unknown) => void;
};

export class FirestoreStore implements Store {
  private readonly db: Firestore;
  private readonly onError: (where: string, error: unknown) => void;

  constructor(options: FirestoreStoreOptions = {}) {
    this.db = new Firestore(options.projectId === undefined ? {} : { projectId: options.projectId });
    this.onError = options.onError ?? ((where, error) => console.error(`firestore: ${where}`, error));
  }

  private room(roomId: string): DocumentReference {
    return this.db.collection(ROOMS).doc(roomId);
  }

  updateRoom(roomId: string, fn: (doc: RoomDoc | null) => RoomDoc | null | undefined): Promise<RoomDoc | null> {
    const ref = this.room(roomId);
    return this.db.runTransaction(async (t) => {
      const snap = await t.get(ref);
      const current = snap.exists ? (snap.data() as RoomDoc) : null;
      const next = fn(current);
      if (next === undefined) return current;
      if (next === null) t.delete(ref);
      else t.set(ref, next);
      return next;
    });
  }

  watchRoom(roomId: string, onChange: (doc: RoomDoc | null) => void): () => void {
    return this.room(roomId).onSnapshot(
      (snap) => onChange(snap.exists ? (snap.data() as RoomDoc) : null),
      (error) => this.onError(`watching room ${roomId}`, error),
    );
  }

  async post(roomId: string, mail: Omit<Mail, "id">): Promise<void> {
    await this.room(roomId).collection(MAIL).add(mail);
  }

  watchMail(roomId: string, inst: string, onMail: (mail: Mail) => void): () => void {
    return this.room(roomId)
      .collection(MAIL)
      .where("inst", "==", inst)
      .onSnapshot(
        (snap) => {
          for (const change of snap.docChanges()) {
            if (change.type !== "added") continue;
            onMail({ id: change.doc.id, ...(change.doc.data() as Omit<Mail, "id">) });
          }
        },
        (error) => this.onError(`watching mail in room ${roomId}`, error),
      );
  }

  async deleteMail(roomId: string, id: string): Promise<void> {
    await this.room(roomId).collection(MAIL).doc(id).delete();
  }

  async touchInstance(inst: string, at: number): Promise<void> {
    await this.db.collection(INSTANCES).doc(inst).set({ seenAt: at });
  }

  async instancesSeenSince(since: number): Promise<string[]> {
    const snap = await this.db.collection(INSTANCES).where("seenAt", ">=", since).get();
    return snap.docs.map((doc) => doc.id);
  }

  async forgetInstance(inst: string): Promise<void> {
    await this.db.collection(INSTANCES).doc(inst).delete();
  }
}
