/**
 * The store in memory (`store.ts`), shared by as many registries as a test
 * makes: each is an instance of the service, and the fake is their
 * Firestore. Watches fire on the next microtask, as a real listener fires
 * after the write that caused it, never inside it; `settle` waits for every
 * pending notification so a test asserts on a quiet store.
 */

import type { Mail, RoomDoc, Store } from "../src/store.js";

export class FakeStore implements Store {
  readonly rooms = new Map<string, RoomDoc>();
  readonly mail = new Map<string, Map<string, Mail>>();
  readonly instances = new Map<string, number>();
  private readonly roomWatchers = new Map<string, Set<(doc: RoomDoc | null) => void>>();
  private readonly mailWatchers = new Map<string, Set<{ inst: string; onMail: (mail: Mail) => void; seen: Set<string> }>>();
  private nextMail = 1;
  private pending = 0;
  /** Every operation, in order, so a test can count the store's work. */
  readonly ops: string[] = [];

  private later(fn: () => void): void {
    this.pending += 1;
    queueMicrotask(() => {
      this.pending -= 1;
      fn();
    });
  }

  /** Resolves once no notification is pending. */
  async settle(): Promise<void> {
    for (let i = 0; i < 20; i++) {
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
      if (this.pending === 0) return;
    }
    throw new Error("the fake store never settled");
  }

  updateRoom(roomId: string, fn: (doc: RoomDoc | null) => RoomDoc | null | undefined): Promise<RoomDoc | null> {
    this.ops.push(`updateRoom ${roomId}`);
    const current = this.rooms.get(roomId) ?? null;
    const next = fn(current === null ? null : structuredClone(current));
    if (next === undefined) return Promise.resolve(current);
    if (next === null) this.rooms.delete(roomId);
    else this.rooms.set(roomId, structuredClone(next));
    const watchers = this.roomWatchers.get(roomId);
    if (watchers !== undefined) {
      const snapshot = next === null ? null : structuredClone(next);
      for (const watcher of [...watchers]) this.later(() => watchers.has(watcher) && watcher(snapshot === null ? null : structuredClone(snapshot)));
    }
    return Promise.resolve(next);
  }

  watchRoom(roomId: string, onChange: (doc: RoomDoc | null) => void): () => void {
    this.ops.push(`watchRoom ${roomId}`);
    let watchers = this.roomWatchers.get(roomId);
    if (watchers === undefined) {
      watchers = new Set();
      this.roomWatchers.set(roomId, watchers);
    }
    watchers.add(onChange);
    const first = this.rooms.get(roomId) ?? null;
    this.later(() => watchers.has(onChange) && onChange(first === null ? null : structuredClone(first)));
    return () => void watchers.delete(onChange);
  }

  post(roomId: string, mail: Omit<Mail, "id">): Promise<void> {
    this.ops.push(`post ${roomId} ${mail.from}->${mail.to}`);
    let box = this.mail.get(roomId);
    if (box === undefined) {
      box = new Map();
      this.mail.set(roomId, box);
    }
    const stored: Mail = { id: `m${this.nextMail++}`, ...mail };
    box.set(stored.id, stored);
    for (const watcher of this.mailWatchers.get(roomId) ?? []) {
      if (watcher.inst !== mail.inst || watcher.seen.has(stored.id)) continue;
      watcher.seen.add(stored.id);
      this.later(() => watcher.onMail(structuredClone(stored)));
    }
    return Promise.resolve();
  }

  watchMail(roomId: string, inst: string, onMail: (mail: Mail) => void): () => void {
    this.ops.push(`watchMail ${roomId} ${inst}`);
    let watchers = this.mailWatchers.get(roomId);
    if (watchers === undefined) {
      watchers = new Set();
      this.mailWatchers.set(roomId, watchers);
    }
    const watcher = { inst, onMail, seen: new Set<string>() };
    watchers.add(watcher);
    // What is already waiting is delivered too, as a listener's first snapshot does.
    for (const stored of this.mail.get(roomId)?.values() ?? []) {
      if (stored.inst !== inst) continue;
      watcher.seen.add(stored.id);
      this.later(() => watchers.has(watcher) && onMail(structuredClone(stored)));
    }
    return () => void watchers.delete(watcher);
  }

  deleteMail(roomId: string, id: string): Promise<void> {
    this.ops.push(`deleteMail ${roomId} ${id}`);
    this.mail.get(roomId)?.delete(id);
    return Promise.resolve();
  }

  touchInstance(inst: string, at: number): Promise<void> {
    this.ops.push(`touchInstance ${inst}`);
    this.instances.set(inst, at);
    return Promise.resolve();
  }

  instancesSeenSince(since: number): Promise<string[]> {
    this.ops.push(`instancesSeenSince`);
    return Promise.resolve([...this.instances].filter(([, at]) => at >= since).map(([inst]) => inst));
  }

  forgetInstance(inst: string): Promise<void> {
    this.ops.push(`forgetInstance ${inst}`);
    this.instances.delete(inst);
    return Promise.resolve();
  }

  listRooms(): Promise<{ id: string; doc: RoomDoc }[]> {
    return Promise.resolve([...this.rooms].map(([id, doc]) => ({ id, doc: structuredClone(doc) })));
  }

  listInstances(): Promise<{ id: string; seenAt: number }[]> {
    return Promise.resolve([...this.instances].map(([id, seenAt]) => ({ id, seenAt })));
  }
}
