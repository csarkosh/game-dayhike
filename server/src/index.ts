import { randomUUID } from "node:crypto";
import { createSignalingServer, parseRole, SIGNALING_PATH } from "./server.js";
import { DEFAULT_ALLOWED_ORIGINS } from "./admission.js";
import { TELEMETRY_PATH } from "./telemetry.js";
import { FirestoreStore } from "./firestoreStore.js";
import { SharedRegistry } from "./sharedRegistry.js";
import { createAdminAuth, parseAllowlist } from "./adminAuth.js";
import { createAdminData } from "./adminData.js";

const PORT = Number(process.env.PORT ?? 8080);

// Which service this process is (`Role`): Terraform sets `signaling` on the
// one-instance service and `telemetry` on the one that scales; unset, as in
// development, the process serves both.
const ROLE = parseRole(process.env.ROLE);

// The git short sha the image was built from, baked in by the Dockerfile
// (`npm run deploy:server` passes it), so every telemetry row names the
// server's build beside the client's. Unset outside an image.
const BUILD_SHA = process.env.BUILD_SHA || "dev";

// Where the rooms live: `memory`, this process's own, which is right for one
// instance and is development's default; or `firestore`, the store every
// instance shares (`sharedRegistry.ts`, `firestoreStore.ts`), which Terraform
// sets on the signaling service so it can run on more than one instance.
// This instance's name is its Cloud Run revision and a fresh id, so two
// instances of one revision never share a seat.
const REGISTRY = process.env.REGISTRY === "firestore" ? "firestore" : "memory";
const INSTANCE = `${process.env.K_REVISION ?? "local"}-${randomUUID().slice(0, 8)}`;

// The admin page's readers (`adminAuth.ts`): the accounts on the list, and the
// Firebase project their tokens name, which is this project. With no list
// the admin routes are not served. The dataset is the telemetry bucket's
// linked one (`_infra/modules/gcp-telemetry`).
const ADMIN_EMAILS = parseAllowlist(process.env.ADMIN_EMAILS);
const PROJECT = process.env.GOOGLE_CLOUD_PROJECT || process.env.GCP_PROJECT || "";
const TELEMETRY_DATASET = process.env.TELEMETRY_DATASET || "dayhike_telemetry";

// Comma-separated, so a new domain is an environment change rather than a
// deploy of new code. An unset or empty variable keeps the built-in list —
// setting it to something meaningless should not silently open the server up.
const ALLOWED_ORIGINS =
  process.env.ALLOWED_ORIGINS?.split(",")
    .map((origin) => origin.trim())
    .filter((origin) => origin !== "") ?? [];

const allowedOrigins =
  ALLOWED_ORIGINS.length > 0 ? ALLOWED_ORIGINS : DEFAULT_ALLOWED_ORIGINS;

// A failed promise nobody awaited is logged, not fatal: the rooms are in the
// store, so a restart buys nothing a log line does not, and a service that
// scales from zero should not be made to start again for one refused call.
process.on("unhandledRejection", (reason) => {
  console.error("unhandled rejection", reason);
});

const store = REGISTRY === "firestore" ? new FirestoreStore() : null;
// The shared registry is the signaling role's: it writes the store (its
// seats, its liveness) and the telemetry role's account may only read, so a
// telemetry process gets no registry and sweeps nothing. The store itself is
// still the admin page's live view.
const server = createSignalingServer(PORT, {
  allowedOrigins,
  role: ROLE,
  serverBuild: BUILD_SHA,
  ...(store !== null && ROLE !== "telemetry" ? { registry: (o) => new SharedRegistry(store, { ...o, instance: INSTANCE }) } : {}),
  ...(ADMIN_EMAILS.length > 0 && PROJECT !== ""
    ? {
        admin: {
          auth: createAdminAuth({ projectId: PROJECT, allowed: ADMIN_EMAILS }),
          data: createAdminData({ projectId: PROJECT, dataset: TELEMETRY_DATASET, store }),
        },
      }
    : {}),
});
console.log(`allowing origins: ${allowedOrigins.join(", ")}`);
const serving = [ROLE !== "telemetry" ? `signaling on ${SIGNALING_PATH}` : null, ROLE !== "signaling" ? `telemetry on ${TELEMETRY_PATH}` : null]
  .filter((line) => line !== null)
  .join(", ");
console.log(`${ROLE} server (build ${BUILD_SHA}, ${REGISTRY} rooms, instance ${INSTANCE}, admin for ${ADMIN_EMAILS.length} account(s)) listening on :${PORT}: ${serving}`);

// Cloud Run sends SIGTERM on scale-down and on every deploy. Shutting down
// deliberately means peers learn about it immediately instead of discovering it
// by timeout — but not gracefully: `close()` calls `terminate()` on every live
// socket, so what a peer actually sees is an abnormal 1006. That is a
// deliberate trade, since a half-open socket would otherwise hold the listener
// open until its own timeout. The client treats 1006 the same as any other
// close and reconnects, and `RoomRegistry`'s host grace period is what makes
// the gap harmless.
for (const signal of ["SIGTERM", "SIGINT"] as const) {
  process.on(signal, () => {
    void server.close().then(() => process.exit(0));
  });
}
