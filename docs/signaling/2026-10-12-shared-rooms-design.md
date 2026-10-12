# Shared rooms

**Date:** 2026-10-12
**Status:** Built 2026-10-12; not yet applied to production.
**Parent:** [`../telemetry/2026-10-12-telemetry-design.md`](../telemetry/2026-10-12-telemetry-design.md) §7,
which named this as the follow-up.

## 0. What this is

The signaling server kept its rooms in process memory, which pinned the service to one
Cloud Run instance: a second instance would have held a second, disjoint set of rooms, and
a party split across the two would never have found each other. One instance holds 250
sockets, which is 50 full games, and past that the service would have refused connections
rather than grown.

The rooms now live in Firestore, shared by every instance, so the service scales from zero
to as many instances as a spike needs and back to none, and stays within Firestore's free
quota at any traffic the game has seen. Three things were held to:

- **Free when idle.** No instance runs when nobody plays, and the database holds a few
  kilobytes: the open rooms, the mail between instances while a room spans them, and each
  instance's last word. Nothing accrues.
- **Free at the volumes a game this size makes.** A party costs the store about a dozen
  operations; the free tier is 20,000 writes, 50,000 reads and 20,000 deletes a day.
- **Nothing tips over.** The instance ceiling is a cost control, not a correctness one; a
  room split across instances works, and an instance that dies without a word is noticed.

## 1. The shape

```
browser ──ws──▶ instance A ──┐                      ┌── instance B ◀──ws── browser
                 (sockets,   │   signalingRooms/     │   (sockets,
                  local      ├──▶ {roomId}  ◀────────┤    local
                  seats)     │     mail/{id}         │    seats)
                             │   signalingInstances/ │
                             └──  {inst}  ◀──────────┘
```

**The registry interface** (`server/src/registry.ts`). The server speaks to a `Registry`
with asynchronous `create`, `join`, `leave`, `disconnect`, `relay`, `sweep` and `close`.
Two implement it: `MemoryRegistry` (`memoryRegistry.ts`), the rooms in this process as
they always were, which is development's default and the tests'; and `SharedRegistry`
(`sharedRegistry.ts`) over a `Store` (`store.ts`). `REGISTRY=firestore` in the service's
environment, set by Terraform, chooses the shared one; its instance name is the Cloud Run
revision plus a fresh id.

**The room document** is the truth: its host, when it opened, whether the host's socket is
in its grace window, and a seat per peer naming the instance that holds its socket, a token
that socket alone knows, and when it sat down. Every admission and departure is one
transaction on it; the memory registry's rules — a lobby is opened by `create`, a join to
none is `no_such_lobby`, a dropped host's room admits nobody (`host_away`) until the host
reclaims it or the window runs out, a full room refuses, a host's goodbye ends the room — are
the same rules on the document.

**Watching.** An instance holds the sockets of its own peers (`local`) and watches the
document of every room one of them sits in. The difference between one snapshot and the
next is what it tells those peers: `peer-joined`, `peer-left`, and `host_gone` when the
document is deleted. The same code path serves whichever instance made the change, so a
join on instance B is announced to the host on instance A by A's own watch.

**Relay.** A signaling payload for a peer on this instance goes straight to its socket. One
for a peer elsewhere is posted as mail addressed to that peer's instance, which watches for
its mail in that room only while the room spans instances, delivers it, and deletes it. The
mail is deleted by the registry and not by a TTL policy, because TTL deletes are outside the
free tier.

**Liveness.** No peer heartbeats the store. A socket's death is noticed by the instance
holding it, which seats the peer out. An instance that dies without a word — a crash, not a
scale-down, which gets a SIGTERM and seats its peers out itself — leaves seats behind, so
each instance writes its own liveness once a minute and the sweep seats out everyone on an
instance not heard from in three. A seat younger than that window is kept whatever the
record says: the instance that filled it was alive to do so and may not have written its
first word yet. A room older than a day is a leak and is ended.

**The stale socket.** A host that reconnects, on any instance, takes its seat back with a
new token. The old socket's close, arriving later on the old instance, finds a seat with a
token not its own and evicts nothing, which is the memory registry's `forget` on the
document.

## 2. What it costs the store

| Operation | Writes | Reads | Deletes |
|---|---|---|---|
| Create a lobby | 1 | 1 | |
| Join, leave or drop | 1 | 1 | |
| The room's end | | 1 | 1 |
| A watched room, per change, per watching instance | | 1 | |
| Mail, per message, only while a room spans instances | 1 | 1 | 1 |
| An instance's liveness, per minute, while it is up | 1 | 1 | |

A party of five on one instance is about a dozen writes and reads and one delete. The same
party split across two instances adds a handshake's mail per pair across the split, about
thirty messages each. A day with a hundred parties, some split, is a few thousand of each,
against the free tier's 20,000 writes, 50,000 reads and 20,000 deletes. Past it, Firestore
bills about 18 cents per 100,000 writes.

Cloud Run's bill is unchanged in shape: an instance is billed while it holds sockets, as
before, and there are more of them only while there are more sockets than one holds.

## 3. What changed for the service

- `max_instance_count` is a variable, 3 by default, a cost ceiling. With `REGISTRY=memory`
  it must be 1, and the Terraform variable says so.
- Session affinity is on, so a party's sockets tend to land on one instance and relay in
  memory. Cloud Run promises only best effort, so a split party works too.
- The service account has one role, `roles/datastore.user`, on the project's default
  Firestore database, which Terraform creates in the service's region in native mode.
- A deploy no longer splits the rooms: the superseded revision's instances seat their peers
  out on SIGTERM, and a host that reconnects to the new revision reclaims a room the store
  still holds. The deploy script still retires superseded revisions, now for tidiness.

## 4. Testing

The registry is tested under Node with no emulator: `server/test/fakeStore.ts` is the store
in memory, shared by two registries that stand for two instances, with watches firing on
the next microtask as a real listener fires after the write. `server/test/sharedRegistry.test.ts`
covers admission across instances, relay by mail and by memory, the mail watch's lifetime,
every refusal, the host's goodbye, the grace window and the reclaim from another instance,
the stale socket, the silent instance, the aged room, and two real signaling servers over
one store carrying a lobby between them over sockets. The Firestore adapter
(`firestoreStore.ts`) is a thin translation of the interface and is exercised in production
by `deploy:verify`'s real lobby create.
