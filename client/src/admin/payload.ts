/** A row's payload, read once for every admin module that needs it. Imports nothing from them. */

import type { Row } from "./source.js";

export type Payload = Record<string, unknown>;

/** A row's payload: the whole row the query carries as `row_json`, or the row's own columns where there is none (the sample). */
export function payloadOf(row: Row): Payload {
  const json = row.row_json;
  if (typeof json === "string" && json !== "") {
    try {
      const parsed: unknown = JSON.parse(json);
      if (parsed !== null && typeof parsed === "object") return parsed as Payload;
    } catch {
      // Not JSON: the columns will do.
    }
  }
  return row as Payload;
}
