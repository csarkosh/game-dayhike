-- One match (a `game`), in order: every row of every session that was in it,
-- the sessions side by side, each row with its session, so the host's and
-- the followers' accounts of one match can be read against each other, from
-- their landing to their goodbye. Replace GAME with the game id from the
-- progress query or a session's rows. The rows are read over a window a day
-- either side of the match's own span, found first; `row_json` is the whole
-- row.
WITH span AS (
  SELECT MIN(timestamp) AS first_at, MAX(timestamp) AS last_at
  FROM `fps-csarko.global.dayhike-telemetry._AllLogs`
  WHERE JSON_VALUE(json_payload.game) = 'GAME' -- match
),
members AS (
  SELECT DISTINCT JSON_VALUE(json_payload.sid) AS sid
  FROM `fps-csarko.global.dayhike-telemetry._AllLogs`
  WHERE timestamp >= (SELECT first_at FROM span)
    AND timestamp <= (SELECT last_at FROM span)
    AND JSON_VALUE(json_payload.game) = 'GAME' -- match
    AND JSON_VALUE(json_payload.sid) IS NOT NULL
)
SELECT
  timestamp,
  JSON_VALUE(json_payload.n) AS n,
  CAST(JSON_VALUE(json_payload.t) AS INT64) AS t,
  JSON_VALUE(json_payload.svc) AS svc,
  JSON_VALUE(json_payload.sid) AS sid,
  JSON_VALUE(json_payload.vid) AS vid,
  JSON_VALUE(json_payload.game) AS game,
  JSON_VALUE(json_payload.lobby) AS lobby,
  JSON_VALUE(json_payload.where) AS at_page,
  JSON_VALUE(json_payload.kind) AS kind,
  JSON_VALUE(json_payload.reason) AS reason,
  JSON_VALUE(json_payload.result) AS result,
  JSON_VALUE(json_payload.act) AS act,
  JSON_VALUE(json_payload.phase) AS phase,
  JSON_VALUE(json_payload.tier) AS tier,
  CAST(JSON_VALUE(json_payload.fps) AS FLOAT64) AS fps,
  CAST(JSON_VALUE(json_payload.dur) AS INT64) AS dur,
  CAST(JSON_VALUE(json_payload.trouble) AS INT64) AS trouble,
  CAST(JSON_VALUE(json_payload.p) AS FLOAT64) AS p,
  JSON_VALUE(json_payload.msg) AS msg,
  JSON_VALUE(json_payload.stack) AS stack,
  JSON_VALUE(json_payload.build) AS build,
  TO_JSON_STRING(json_payload) AS row_json
FROM `fps-csarko.global.dayhike-telemetry._AllLogs`
WHERE timestamp >= (SELECT TIMESTAMP_SUB(first_at, INTERVAL 1 DAY) FROM span)
  AND timestamp <= (SELECT TIMESTAMP_ADD(last_at, INTERVAL 1 DAY) FROM span)
  AND JSON_VALUE(json_payload.sid) IN (SELECT sid FROM members)
ORDER BY timestamp;
