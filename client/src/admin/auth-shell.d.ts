/**
 * The shape of `/auth.js`, the admin host's sign-in module (csarko.sh,
 * `admin/public/auth.js`), which `auth.ts` imports and the build leaves to
 * the browser. TypeScript cannot resolve a root-absolute module name through
 * an ambient declaration, so `tsconfig.json` maps `/auth.js` to this file
 * (`paths`); the file declares and ships nothing. Keep it in step with the
 * shell's module (its exports are a contract, csarko.sh `admin/CONTRACT.md`,
 * "Auth"): a change there is a change here.
 */

/** The signed-in account, as the shell knows it. */
export type User = { email: string };

/** The name of the event the shell dispatches on `window` when a request was answered 401. */
export const UNAUTHORIZED: "admin:unauthorized";

/** The signed-in account, or null when nobody is. */
export function user(): User | null;

/**
 * `fetch` with `Authorization: Bearer <fresh ID token>` added, no credentials,
 * CORS mode. A 401 answer dispatches `admin:unauthorized` on `window`, with
 * `detail: { email, url }`, before the response is returned; the shell's own
 * gate listens and comes back with "<email> is not on the list." and a Sign
 * out, so the page need not render that itself.
 */
export function fetchWithAuth(url: string, init?: RequestInit): Promise<Response>;

/** Signs the account out; the gate returns on its own through the auth state. */
export function signOut(): Promise<void>;

/**
 * Renders the gate ("Sign in with Google") into `root` until someone is signed
 * in, hiding the root's children behind it, and calls `onReady` with the
 * account: at once when a session is already kept in this browser, otherwise
 * when the popup sign-in finishes. The gate comes back on sign-out and on
 * `admin:unauthorized`. Call it once a page: each call adds its own listeners.
 */
export function requireSession(root: HTMLElement, onReady: (user: User) => void): void;

/**
 * The nav's account, rendered into `host` (the chrome's `#account`): a round
 * profile button that toggles a menu with the Live or Sample badge, the
 * signed-in email and Sign out. With `preview` and no account the menu says
 * nobody is signed in and has no Sign out. The shell clears it on sign-out.
 */
export function accountMenu(host: HTMLElement, options: { account: User | null; preview: boolean }): void;

// The shell also still exports the names of the gate it had for a day
// (2026-10-13), so the bundle built against them keeps loading until this one
// replaces it. They are not declared here: nothing in this page may use them.
