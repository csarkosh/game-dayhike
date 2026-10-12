/**
 * The one way this server writes a telemetry row: a JSON object, one a line,
 * to stdout.
 *
 * That is the whole of the pipeline's first half. Cloud Run reads a process's
 * stdout, and a line that parses as a JSON object becomes a structured log
 * entry: `severity` and `message` are lifted into the entry's own fields and
 * everything else lands under `jsonPayload`, where Logs Explorer filters on it
 * and Log Analytics queries it by SQL. No client library, no credentials and
 * no permission on the service account: the service that writes these has
 * none, and needs none.
 *
 * `dh: 1` marks a row as the game's. The log sink in
 * `_infra/modules/gcp-telemetry` routes every entry carrying it into the
 * telemetry bucket and nothing else, so a row from either service — the
 * telemetry service writing what players' pages sent, the signaling service
 * writing what it saw of its rooms — lands in one place, and Cloud Run's own
 * request logs do not.
 */

export type LogRow = Record<string, unknown>;

export type LogSink = (row: LogRow) => void;

/** The severities Cloud Logging knows that a row here uses. */
export type Severity = "INFO" | "WARNING" | "ERROR";

/** Writes a row to stdout, one line. The default sink. */
export const stdoutSink: LogSink = (row) => {
  process.stdout.write(`${JSON.stringify(row)}\n`);
};

/**
 * A row's fixed part: the mark the sink routes on, the severity Cloud Logging
 * lifts out, the event's name, and a message so the Logs Explorer's summary
 * column reads as the event rather than as a wall of JSON. The fixed part
 * wins over a field of the same name: a page cannot unmark its own row.
 */
export function row(severity: Severity, name: string, fields: LogRow, message: string = name): LogRow {
  return { ...fields, dh: 1, severity, message, n: name };
}
