-- One session, in order: every row the page sent and, where it hosted or
-- joined a lobby, the signaling rows of that lobby. The page's rows share
-- the session id; the lobby's share its id. Replace SID with the session id
-- from any other query. The timeline is how an error is read back to its
-- cause: what the page had done, which stage it was in, and what came after.
WITH page AS (
  SELECT
    timestamp,
    JSON_VALUE(json_payload.n) AS n,
    CAST(JSON_VALUE(json_payload.t) AS INT64) AS t,
    JSON_VALUE(json_payload.svc) AS svc,
    JSON_VALUE(json_payload.where) AS at_page,
    JSON_VALUE(json_payload.kind) AS kind,
    JSON_VALUE(json_payload.msg) AS msg,
    JSON_VALUE(json_payload.stack) AS stack,
    JSON_VALUE(json_payload.lobby) AS lobby,
    JSON_VALUE(json_payload.build) AS build,
    TO_JSON_STRING(json_payload) AS row_json
  FROM `fps-csarko.global.dayhike-telemetry._AllLogs`
  WHERE JSON_VALUE(json_payload.sid) = 'SID' -- session
),
rooms AS (
  SELECT
    timestamp,
    JSON_VALUE(json_payload.n) AS n,
    CAST(NULL AS INT64) AS t,
    JSON_VALUE(json_payload.svc) AS svc,
    CAST(NULL AS STRING) AS at_page,
    JSON_VALUE(json_payload.reason) AS kind,
    JSON_VALUE(json_payload.code) AS msg,
    CAST(NULL AS STRING) AS stack,
    JSON_VALUE(json_payload.room) AS lobby,
    JSON_VALUE(json_payload.sbuild) AS build,
    TO_JSON_STRING(json_payload) AS row_json
  FROM `fps-csarko.global.dayhike-telemetry._AllLogs`
  WHERE JSON_VALUE(json_payload.svc) = 'signaling'
    AND JSON_VALUE(json_payload.room) IN (SELECT DISTINCT lobby FROM page WHERE lobby IS NOT NULL AND lobby != '')
)
SELECT * FROM page
UNION ALL
SELECT * FROM rooms
ORDER BY timestamp, t;
