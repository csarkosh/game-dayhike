/**
 * The admin page's gate: the shared admin host's sign-in module, re-exported.
 *
 * The page is served from admin.csarko.sh (the csarko.sh repository's
 * `admin/`), whose shell serves `/auth.js` at the host's root: a Google
 * sign-in through Firebase Auth on that repository's project, `csarko-sh`, a
 * `fetch` that sends the account's ID token as a bearer, and the gate that
 * asks for the sign-in. Every app's page imports that one module, so one
 * sign-in opens every app, and this bundle carries no sign-in code of its own:
 * the import is left external by the build (`vite.admin.config.ts`) and
 * resolved by the browser against the host.
 *
 * The server's admin routes verify the ID token against that project's issuer
 * and their own allowlist (`server/src/adminAuth.ts`, `ADMIN_EMAILS`): the
 * sign-in proves who the account is, the server decides whether it may read.
 * A 401 is the shell's to notice (`admin:unauthorized`) and to answer with
 * the gate again, saying which account was refused; this page's part is to
 * stop asking (`main.ts`). The module's shape is declared in `auth-shell.d.ts`;
 * in development the dev server proxies the path to the shell's local preview
 * (`vite.config.ts`).
 */

export { fetchWithAuth, requireSession, signOut, user, UNAUTHORIZED, type User } from "/auth.js";
