---
name: doc-artifact
description: Use when the user asks to view, read, open, or share a repo document as a web page or HTML artifact — a spec, plan, research note, or design doc. Renders the markdown as a published Artifact in this project's dark arctic (Nord) house style. Also use when asked to update or restyle an artifact that was already published from a repo doc.
---

# Repo docs as artifacts

This project's documents are long, structured, and read on screen: a spec with numbered
sections, a plan with phased task lists, a research note with source tables. Read as raw
markdown they are a wall of text. Rendered, their structure does the work.

This skill is the house style for that rendering, so every doc published from this repo
looks like it came from the same place.

## The house style

**Dark arctic, built on [Nord](https://www.nordtheme.com/).** Nord is literally an arctic
palette, and its greys are blue-biased by construction, so the neutrals already lean
toward the accent rather than reading as unconsidered mid-grey.

| Role | Dark (Polar Night) | Light (Midnight Sun) |
| --- | --- | --- |
| Ground / surface / raised | `#2E3440` `#3B4252` `#434C5E` | `#ECEFF4` `#E5E9F0` `#DDE3EC` |
| Text primary / body / muted | `#ECEFF4` `#D8DEE9` `#97A3B6` | `#2E3440` `#3B4252` `#5C6879` |
| Accent (Frost) | `#88C0D0` `#5E81AC` `#8FBCBB` | `#4C7FA8` `#3F6591` `#5A8F8E` |
| Status (Aurora) | `#A3BE8C` `#EBCB8B` `#B48EAD` `#BF616A` | `#5C7F45` `#A07D24` `#8A5F84` `#A03B45` |

Dark is the primary world. The light theme is **not a naive inversion** — it is the same
arctic subject at polar day, which is why it gets its own hand-picked Frost and Aurora
values (the dark accents wash out on a light ground).

**Aurora hues carry status, never decoration.** Green ships now, amber is deferred, purple
is specified-but-not-built, red is a stop. If a doc has no status states, it gets no
Aurora — do not sprinkle it for colour.

**Typography.** Do **not** link a webfont: the Artifact CSP blocks font CDNs and the page
will silently fall back. Use deliberate stacks instead, and treat **monospace as a
structural face** — eyebrows, labels, table headers, file paths, function names, metadata.
Monospace is the vernacular of this subject matter, so it carries the identity while the
sans just reads.

```css
--sans: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
--mono: ui-monospace, "SF Mono", SFMono-Regular, "Cascadia Code", "JetBrains Mono", Menlo, Consolas, monospace;
```

**Layout.** Single column at ~68ch measure, with a sticky section rail on wide screens
(`min-width: 1020px`) that collapses away below it. Tables, code blocks and diagrams each
get their own `overflow-x: auto` container so the body never scrolls sideways.

**One flourish, and only one:** a 3px aurora gradient band across the very top. No hero.
These are documents.

## Treatment

These are utilitarian documents, not landing pages. Polished — real hierarchy, considered
spacing, a proper palette — but restrained. No giant hero, no scroll animation, no
decorative iconography.

**Structure must encode something true.** A spec's §-numbers, or a deploy or release
process's genuinely ordered phases, are honest to number. A flat list of considerations is
not a sequence — do not number it just to have numbers.

## How to build one

1. **Read the source document in full.** Render its real content — never summarise it into
   bullets and never invent sections it does not have.
2. **Find its structure.** Numbered sections become the rail and the section headers.
   Repeated `key: value` prose becomes a table. Status words like "deferred", "shipped",
   "not built" become chips. Ordered pipelines become numbered stages.
3. **Pull the warnings out.** Anything the doc flags as a trap, a gap, or a thing that has
   already gone wrong becomes a callout — those are the highest-value lines in the file and
   they get lost in prose.
4. **Write the page**, then publish with the `Artifact` tool.

Write the file to the scratchpad directory, not into the repo — published artifacts are
build output, and the markdown remains the source of truth.

### Required mechanics

- Content only: no `<!doctype>`, `<html>`, `<head>` or `<body>` tags. A `<title>` and a
  `<style>` block at the top of the content are correct and work.
- Theme through **tokens**: define on `:root`, redefine under
  `@media (prefers-color-scheme: dark|light)`, then redefine again under
  `:root[data-theme="dark"]` and `:root[data-theme="light"]` so the viewer's toggle wins in
  both directions. Style components through tokens only — never inside the media query.
- `text-wrap: balance` on headings, `text-wrap: pretty` on body copy.
- `font-variant-numeric: tabular-nums` anywhere digits align in a column.
- Visible `:focus-visible` outlines; a `prefers-reduced-motion` block.
- Everything inlined. No CDN, no remote font, no remote image — the CSP blocks all of it.
- Pass a `favicon` (🧊 fits the arctic house style) and keep it stable across redeploys.

### Updating an existing artifact

Republishing **the same file path in the same conversation** keeps the URL. From a fresh
conversation, find it with `Artifact` `action: "list"` and pass its URL as `url`, or a new
URL gets minted.

## Anti-patterns

| Don't | Why |
| --- | --- |
| Link Tailwind, Bootstrap, or Google Fonts | The CSP blocks external hosts. It fails silently and the page renders unstyled |
| Invert the dark palette to make the light theme | Frost accents wash out on a light ground. Pick light values deliberately |
| Add Aurora colour to a doc with no status states | Colour then means nothing, which is worse than no colour |
| Number a list that is not a sequence | Numbering claims an order the content does not have |
| Summarise the doc | The point is to read the document, rendered. Summarising loses exactly the detail someone opened it for |
| Commit the HTML to the repo | The markdown is the source of truth; the artifact is build output. Scratchpad only |
