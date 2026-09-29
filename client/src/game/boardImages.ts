/**
 * The paper's and the photograph's addresses, where the files exist. A glob
 * and not an import by name, so a checkout without one of the files still
 * builds: the board then draws a stand-in for it (`boardPaint.ts`).
 */
const found = import.meta.glob("../../assets/textures/board.*.webp", { query: "?url", import: "default", eager: true }) as Record<string, string>;

function urlOf(file: string): string | null {
  for (const [path, url] of Object.entries(found)) if (path.endsWith(`/${file}`)) return url;
  return null;
}

export const BOARD_IMAGE_URLS: { paper: string | null; portrait: string | null } = {
  paper: urlOf("board.paper.webp"),
  portrait: urlOf("board.portrait.webp"),
};
