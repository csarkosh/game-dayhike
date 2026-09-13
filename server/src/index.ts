import { createSignalingServer, SIGNALING_PATH } from "./server.js";
import { DEFAULT_ALLOWED_ORIGINS } from "./admission.js";

const PORT = Number(process.env.PORT ?? 8080);

// Comma-separated, so a new domain is an environment change rather than a
// deploy of new code. An unset or empty variable keeps the built-in list —
// setting it to something meaningless should not silently open the server up.
const ALLOWED_ORIGINS =
  process.env.ALLOWED_ORIGINS?.split(",")
    .map((origin) => origin.trim())
    .filter((origin) => origin !== "") ?? [];

const allowedOrigins =
  ALLOWED_ORIGINS.length > 0 ? ALLOWED_ORIGINS : DEFAULT_ALLOWED_ORIGINS;

const server = createSignalingServer(PORT, { allowedOrigins });
console.log(`allowing origins: ${allowedOrigins.join(", ")}`);
console.log(`signaling server listening on :${PORT}${SIGNALING_PATH}`);

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
