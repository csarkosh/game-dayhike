/**
 * The admin page's sign-in: a Google account through Firebase Auth, whose ID
 * token the server's admin routes check against the allowlist
 * (`server/src/adminAuth.ts`). Only this page loads the Firebase library;
 * the game's bundle carries none of it.
 *
 * The sign-in handler is served on the site's own host by Firebase Hosting
 * (`/__/auth/`), so the popup stays on games.csarko.sh and needs no
 * third-party cookie. Development has no key, so the page shows its gate
 * with the sample behind `?preview`.
 */

import { initializeApp } from "firebase/app";
import { getAuth, GoogleAuthProvider, onAuthStateChanged, signInWithPopup, signOut, type User } from "firebase/auth";

export type AuthConfig = { apiKey: string; authDomain: string; projectId: string };

export type Session = {
  /** The signed-in account, or null. Reported now and on every change. */
  watch(onChange: (user: { email: string; token(): Promise<string> } | null) => void): () => void;
  signIn(): Promise<void>;
  signOut(): Promise<void>;
};

/** The build's sign-in configuration, or null in development. */
export function authConfig(env: { VITE_FIREBASE_API_KEY?: string; VITE_FIREBASE_AUTH_DOMAIN?: string; VITE_FIREBASE_PROJECT_ID?: string }): AuthConfig | null {
  if (!env.VITE_FIREBASE_API_KEY || !env.VITE_FIREBASE_AUTH_DOMAIN || !env.VITE_FIREBASE_PROJECT_ID) return null;
  return { apiKey: env.VITE_FIREBASE_API_KEY, authDomain: env.VITE_FIREBASE_AUTH_DOMAIN, projectId: env.VITE_FIREBASE_PROJECT_ID };
}

export function createSession(config: AuthConfig): Session {
  const app = initializeApp(config);
  const auth = getAuth(app);
  const provider = new GoogleAuthProvider();
  provider.setCustomParameters({ prompt: "select_account" });
  const account = (user: User) => ({ email: user.email ?? "", token: () => user.getIdToken() });
  return {
    watch: (onChange) => onAuthStateChanged(auth, (user) => onChange(user === null ? null : account(user))),
    async signIn() {
      await signInWithPopup(auth, provider);
    },
    signOut: () => signOut(auth),
  };
}
