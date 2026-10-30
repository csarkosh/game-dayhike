import { describe, it, expect } from "vitest";
import { holdKey } from "../../src/admin/hold.js";

// The key is shared with the host's own dashboards (csarko.sh `admin/public/charts.js`,
// `holdKey`), so a card remembers one height a view, whichever code wrote it.
describe("a card's remembered height is kept by view", () => {
  const at = (search: string): { pathname: string; search: string } => ({ pathname: "/game-dayhike/", search });

  it("names the page, the card, the query's parameters in order, and the width to 40 px", () => {
    expect(holdKey("kpis+visitors", at("?range=30&preview"), 1280)).toBe("admin:hold:/game-dayhike/|kpis+visitors|preview=&range=30|32");
  });

  it("is one view whatever order the parameters come in", () => {
    expect(holdKey("funnel", at("?preview&range=30"), 1280)).toBe(holdKey("funnel", at("?range=30&preview"), 1280));
  });

  it("tells ranges, cards and widths apart", () => {
    const base = holdKey("funnel", at("?range=30"), 1280);
    expect(holdKey("funnel", at("?range=7"), 1280)).not.toBe(base);
    expect(holdKey("lobbies", at("?range=30"), 1280)).not.toBe(base);
    expect(holdKey("funnel", at("?range=30"), 390)).not.toBe(base);
    expect(holdKey("funnel", at("?range=30"), 1290)).toBe(base);
  });
});
