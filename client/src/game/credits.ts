/**
 * The Credits screen. CC-BY-4.0 requires the credit to be reasonably visible to the people
 * receiving the work, and a file in the repository is not that; this screen is. It renders
 * CREDITS.md, imported at build time.
 *
 * `creditsModel` parses that file's fixed shape only: an `## <id>` heading followed by
 * `- **Field:** value` lines. It is not a markdown renderer and must not grow into one.
 */
import credits from "../../../CREDITS.md?raw";

export type CreditEntry = {
  id: string;
  source: string;
  author: string;
  license: string;
  licenseUrl: string;
  url: string;
  /** CC-BY asks for a note when the work was changed; every third-party asset here was adapted for the game (resized, re-meshed, re-encoded), so this is always true. */
  modified: boolean;
};

const LICENSE_URLS: Record<string, string> = {
  "CC0-1.0": "https://creativecommons.org/publicdomain/zero/1.0/",
  "CC-BY-4.0": "https://creativecommons.org/licenses/by/4.0/",
};

export function creditsModel(markdown: string): CreditEntry[] {
  const entries: CreditEntry[] = [];
  let current: Partial<CreditEntry> | null = null;
  const flush = (): void => {
    // UNLICENSED is this project's own work: crediting ourselves to ourselves
    // is noise, and the screen exists for other people's licences.
    if (current?.id && current.license && current.license !== "UNLICENSED") {
      entries.push({
        id: current.id,
        source: current.source ?? "",
        author: current.author ?? "",
        license: current.license,
        licenseUrl: LICENSE_URLS[current.license] ?? "",
        url: current.url ?? "",
        modified: true,
      });
    }
    current = null;
  };
  for (const raw of markdown.split("\n")) {
    const line = raw.trim();
    const heading = /^## (.+)$/.exec(line);
    if (heading) {
      flush();
      current = { id: heading[1]!.trim() };
      continue;
    }
    // "Licence" with a c: that is the spelling CREDITS.md uses.
    const field = /^- \*\*(Source|Author|Licence|URL):\*\* (.*)$/.exec(line);
    if (field && current) {
      const value = field[2]!.trim();
      switch (field[1]) {
        case "Source":
          current.source = value;
          break;
        case "Author":
          current.author = value;
          break;
        case "Licence":
          current.license = value;
          break;
        case "URL":
          current.url = value;
          break;
      }
    }
  }
  flush();
  return entries;
}

/** The licences that ask for nothing to be shown. Everything else on this screen is
 * there because a licence REQUIRES it, which is what decides the order below. */
const ATTRIBUTION_OPTIONAL = new Set(["CC0-1.0", "UNLICENSED"]);

export function requiresAttribution(license: string): boolean {
  return !ATTRIBUTION_OPTIONAL.has(license);
}

/**
 * What the screen actually shows: the same entries, ordered and deduped.
 *
 * ORDER — attribution-REQUIRED licences (today: CC-BY-4.0) first, then CC0, each group
 * in catalog order. The list scrolls, and at 1080p its `max-height: 60vh` showed half
 * of it; with the catalog's own ordering the only three rows the licences legally
 * require were the last three, below the fold behind a macOS
 * overlay scrollbar that draws nothing until you scroll. A stable sort keeps catalog
 * order inside each group, so nothing else moves.
 *
 * DEDUPE — two catalog ids can be two assets cut from ONE third-party pack
 * (one third-party model used at two scales, say), and the credit is a property of the pack,
 * not of the id: the row is identical word for word. Repeating it credits nobody twice
 * and pushes the rest further down. Keyed on everything the row RENDERS (source, author,
 * licence, URL) rather than on the id, so two genuinely distinct works that happen to
 * share an author stay two rows.
 */
export function creditsRows(entries: readonly CreditEntry[]): CreditEntry[] {
  const seen = new Set<string>();
  const unique: CreditEntry[] = [];
  for (const e of entries) {
    const key = JSON.stringify([e.source, e.author, e.url, e.license]);
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(e);
  }
  // Array.prototype.sort is required to be stable (ES2019), which is what "each group in
  // catalog order" rests on — no tiebreaker is needed or wanted.
  return unique.sort((a, b) => Number(requiresAttribution(b.license)) - Number(requiresAttribution(a.license)));
}

export function creditsEntries(): CreditEntry[] {
  return creditsRows(creditsModel(credits));
}

/**
 * The href a catalog-derived URL may be given, or null when it may not have
 * one. Two cases reach here: a licence this file has no deed URL for (an empty
 * string), and the `URL` field, which is third-party text copied through
 * unexamined. A `javascript:` URL in the catalog would be an
 * authoring mistake rather than an attack, but this file's rule is that
 * third-party strings are never trusted structurally — textContent for text,
 * and a scheme check for anything that becomes a navigation.
 */
export function safeHref(url: string): string | null {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  return parsed.protocol === "http:" || parsed.protocol === "https:" ? url : null;
}

/** A link when the URL is one we will navigate to, and the bare words when it
 * is not — never an `<a>` with a dead or dangerous href. */
function linkOrText(text: string, url: string): Node {
  const href = safeHref(url);
  if (href === null) return document.createTextNode(text);
  const anchor = document.createElement("a");
  anchor.href = href;
  anchor.target = "_blank";
  anchor.rel = "noreferrer";
  anchor.textContent = text;
  return anchor;
}

/** DOM only, textContent only — the same no-innerHTML rule as landing.ts: the
 * strings come from third parties' pages via the catalog. */
export function renderCredits(root: HTMLElement, entries: CreditEntry[], onBack: () => void): void {
  const heading = document.createElement("h2");
  heading.textContent = "Credits";
  const list = document.createElement("ul");
  list.className = "credits";
  // The list scrolls (max-height in landing.ts), and a scroll container that
  // is not focusable can only be reached by tabbing to a link inside it. This
  // makes the box itself a tab stop, so arrow keys and Page Down work.
  list.tabIndex = 0;
  for (const e of entries) {
    const item = document.createElement("li");
    const work = linkOrText(e.source, e.url);
    const by = document.createTextNode(` — ${e.author} · `);
    const lic = linkOrText(e.license, e.licenseUrl);
    const mod = document.createTextNode(e.modified ? " · modified" : "");
    item.append(work, by, lic, mod);
    list.append(item);
  }
  const back = document.createElement("button");
  back.type = "button";
  back.textContent = "Back";
  back.addEventListener("click", onBack);
  root.append(heading, list, back);
}
