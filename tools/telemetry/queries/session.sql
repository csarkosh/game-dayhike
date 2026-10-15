-- One session, in order: every row the page sent with its payload and, where
-- it hosted or joined a lobby, the signaling rows of that lobby. The page's
-- rows share the session id; the lobby's share its id. Replace SID with the
-- session id from any other query. The timeline is how an error is read back
-- to its cause: what the page had done, which stage it was in, and what came
-- after. The rows are read over a window a day either side of the session's
-- own span, found first, so the scan is of those days and not of everything;
-- `row_json` is the whole row, for the fields no column names.
WITH span AS (
  SELECT MIN(timestamp) AS first_at, MAX(timestamp) AS last_at
  FROM `fps-csarko.global.dayhike-telemetry._AllLogs`
  WHERE JSON_VALUE(json_payload.sid) = 'SID' -- session
),
page AS (
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
    AND JSON_VALUE(json_payload.sid) = 'SID' -- session
),
rooms AS (
  SELECT
    timestamp,
    JSON_VALUE(json_payload.n) AS n,
    CAST(NULL AS INT64) AS t,
    JSON_VALUE(json_payload.svc) AS svc,
    CAST(NULL AS STRING) AS sid,
    CAST(NULL AS STRING) AS vid,
    CAST(NULL AS STRING) AS game,
    JSON_VALUE(json_payload.room) AS lobby,
    CAST(NULL AS STRING) AS at_page,
    CAST(NULL AS STRING) AS kind,
    JSON_VALUE(json_payload.reason) AS reason,
    CAST(NULL AS STRING) AS result,
    CAST(NULL AS STRING) AS act,
    CAST(NULL AS STRING) AS phase,
    CAST(NULL AS STRING) AS tier,
    CAST(NULL AS FLOAT64) AS fps,
    CAST(JSON_VALUE(json_payload.lifeMs) AS INT64) AS dur,
    CAST(NULL AS INT64) AS trouble,
    CAST(NULL AS FLOAT64) AS p,
    JSON_VALUE(json_payload.code) AS msg,
    CAST(NULL AS STRING) AS stack,
    JSON_VALUE(json_payload.sbuild) AS build,
    TO_JSON_STRING(json_payload) AS row_json
  FROM `fps-csarko.global.dayhike-telemetry._AllLogs`
  WHERE timestamp >= (SELECT TIMESTAMP_SUB(first_at, INTERVAL 1 DAY) FROM span)
    AND timestamp <= (SELECT TIMESTAMP_ADD(last_at, INTERVAL 1 DAY) FROM span)
    AND JSON_VALUE(json_payload.svc) = 'signaling'
    AND JSON_VALUE(json_payload.room) IN (SELECT DISTINCT lobby FROM page WHERE lobby IS NOT NULL AND lobby != '')
)
SELECT * FROM page
UNION ALL
SELECT * FROM rooms
ORDER BY timestamp;
