/**
 * Who may read the admin routes: an account on the allowlist, proven by a
 * Firebase Auth ID token.
 *
 * The page signs the account in with Google through Firebase Auth and sends
 * the ID token it gets as a bearer token. The token is a JWT signed by
 * Google's `securetoken` keys, with the project as issuer and audience and
 * the account's verified email as a claim; verifying it needs the public
 * keys and nothing else, so no Firebase library runs here. The allowlist is
 * the service's environment (`ADMIN_EMAILS`, comma-separated), so a
 * collaborator is an environment change, not a deploy of new code.
 *
 * Pure over the key set and the clock, so the check is tested with a key
 * made in the test.
 */

import { createRemoteJWKSet, jwtVerify, type JWTVerifyGetKey } from "jose";

/** Where Google publishes the keys Firebase Auth signs ID tokens with. */
export const SECURETOKEN_JWKS = "https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com";

export type AdminIdentity = { email: string };

export type AdminAuthOptions = {
  /** The Firebase project: the token's issuer is `https://securetoken.google.com/<project>` and its audience the project. */
  projectId: string;
  /** The accounts allowed, lower-cased. */
  allowed: readonly string[];
  /** The keys, by default Google's; a test's are its own. */
  keys?: JWTVerifyGetKey;
  /** The clock the token's times are checked against, seconds. */
  now?: () => number;
};

export function parseAllowlist(raw: string | undefined): string[] {
  return (raw ?? "")
    .split(",")
    .map((email) => email.trim().toLowerCase())
    .filter((email) => email.includes("@"));
}

export type AdminAuth = {
  /** The account a bearer token proves and the allowlist admits, or null. */
  verify(authorization: string | undefined): Promise<AdminIdentity | null>;
};

export function createAdminAuth(options: AdminAuthOptions): AdminAuth {
  const keys = options.keys ?? createRemoteJWKSet(new URL(SECURETOKEN_JWKS));
  const allowed = new Set(options.allowed.map((email) => email.toLowerCase()));
  return {
    async verify(authorization) {
      if (authorization === undefined || !authorization.startsWith("Bearer ")) return null;
      const token = authorization.slice("Bearer ".length).trim();
      if (token === "") return null;
      try {
        const { payload } = await jwtVerify(token, keys, {
          issuer: `https://securetoken.google.com/${options.projectId}`,
          audience: options.projectId,
          algorithms: ["RS256"],
          ...(options.now === undefined ? {} : { currentDate: new Date(options.now() * 1000) }),
        });
        const email = typeof payload.email === "string" ? payload.email.toLowerCase() : "";
        if (email === "" || payload.email_verified !== true || !allowed.has(email)) return null;
        return { email };
      } catch {
        return null;
      }
    },
  };
}
