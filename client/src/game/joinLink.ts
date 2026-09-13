import { isValidLobbyId } from "./router.js";

/**
 * Invites are web URLs on the web base baked into the build
 * (`VITE_WEB_BASE`, e.g. https://games.csarko.sh/dayhike). The desktop shell
 * loads that same site, so the page's own origin would do as well; the baked
 * base keeps development invites pointing at production. Lives in game/
 * rather than net/ because it needs the router's id check.
 */
export function inviteLink(lobbyId: string, webBase: string): string {
  return `${webBase.replace(/\/+$/, "")}/party/${lobbyId}`;
}

/** A lobby id from pasted text: a bare id, or a /party/<id> URL on our base. */
export function parseJoinLink(text: string, webBase: string): string | null {
  const trimmed = text.trim();
  if (trimmed === "") return null;
  if (isValidLobbyId(trimmed)) return trimmed.toLowerCase();

  let url: URL;
  try {
    url = new URL(/^[a-z]+:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`);
  } catch {
    return null;
  }
  let expected: URL;
  try {
    expected = new URL(webBase);
  } catch {
    return null;
  }
  if (url.origin !== expected.origin) return null;
  const prefix = expected.pathname.replace(/\/+$/, "");
  if (!url.pathname.startsWith(`${prefix}/`)) return null;
  const m = /^\/party\/([^/]+)\/?$/.exec(url.pathname.slice(prefix.length));
  if (!m || !isValidLobbyId(m[1] as string)) return null;
  return (m[1] as string).toLowerCase();
}
