import { describe, it, expect } from "vitest";
import fc from "fast-check";
import { parseJoinLink, inviteLink } from "../../src/game/joinLink.js";

const BASE = "https://games.csarko.sh/dayhike";
const ID = "3f2504e0-4f89-41d3-9a0c-0305e82c3301";

describe("inviteLink", () => {
  it("is the party route on the web base, whatever origin the page has", () => {
    expect(inviteLink(ID, BASE)).toBe(`${BASE}/party/${ID}`);
    expect(inviteLink(ID, "http://localhost:5173/dayhike")).toBe(`http://localhost:5173/dayhike/party/${ID}`);
  });
  it("tolerates a trailing slash on the base", () => {
    expect(inviteLink(ID, `${BASE}/`)).toBe(`${BASE}/party/${ID}`);
  });
});

describe("parseJoinLink", () => {
  it("accepts a full invite URL", () => {
    expect(parseJoinLink(`${BASE}/party/${ID}`, BASE)).toBe(ID);
  });
  it("accepts the URL without a scheme, with a trailing slash, and with whitespace around it", () => {
    expect(parseJoinLink(`  games.csarko.sh/dayhike/party/${ID}/\n`, BASE)).toBe(ID);
  });
  it("accepts a bare lobby id, lower-casing it", () => {
    expect(parseJoinLink(ID.toUpperCase(), BASE)).toBe(ID);
  });
  it("refuses another site's link, the wrong base path, a game link, a malformed id, and empty text", () => {
    expect(parseJoinLink(`https://evil.example/dayhike/party/${ID}`, BASE)).toBeNull();
    expect(parseJoinLink(`https://games.csarko.sh/other/party/${ID}`, BASE)).toBeNull();
    expect(parseJoinLink(`${BASE}/game/${ID}`, BASE)).toBeNull();
    expect(parseJoinLink(`${BASE}/party/not-a-uuid`, BASE)).toBeNull();
    expect(parseJoinLink(`${BASE}/`, BASE)).toBeNull();
    expect(parseJoinLink("", BASE)).toBeNull();
  });
  it("round-trips every generated lobby id, as a URL and bare", () => {
    fc.assert(
      fc.property(fc.uuid({ version: 4 }), (id) => {
        expect(parseJoinLink(inviteLink(id, BASE), BASE)).toBe(id.toLowerCase());
        expect(parseJoinLink(id, BASE)).toBe(id.toLowerCase());
      }),
    );
  });
});
