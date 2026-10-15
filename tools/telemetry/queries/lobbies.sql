-- Parties: from the signaling server's own rows, how many lobbies formed, how
-- big each got, how long it lived, and the joins it refused, one line a New
-- York day. A lobby of one is a solo game that pressed Invite and nobody came.
-- The rooms a deploy's verification opens are left out with the rest.
-- The rows that are real play, the same text in every query (`README.md`):
-- not the deploy's verification (`build = 'verify'` on a page's rows,
-- `verify` on signaling's), not the owner's test browsers (`tester`), not a
-- session of the README's stills shoot (one with a `cmd` row, looked for over
-- the last ninety days), not a headless browser (a `SwiftShader` GPU).
WITH real AS (
  SELECT timestamp, json_payload
  FROM `fps-csarko.global.dayhike-telemetry._AllLogs`
  WHERE IFNULL(JSON_VALUE(json_payload.build), '') != 'verify'
    AND IFNULL(JSON_VALUE(json_payload.tester), '') != 'true'
    AND IFNULL(JSON_VALUE(json_payload.verify), '') != 'true'
    AND IFNULL(JSON_VALUE(json_payload.gpu), '') NOT LIKE '%SwiftShader%'
    AND IFNULL(JSON_VALUE(json_payload.sid), '') NOT IN (
      SELECT DISTINCT JSON_VALUE(json_payload.sid)
      FROM `fps-csarko.global.dayhike-telemetry._AllLogs`
      WHERE JSON_VALUE(json_payload.n) = 'cmd'
        AND JSON_VALUE(json_payload.sid) IS NOT NULL
        AND timestamp >= TIMESTAMP_SUB(CURRENT_TIMESTAMP(), INTERVAL 90 DAY)
    )
),
rooms AS (
  SELECT
    JSON_VALUE(json_payload.room) AS room,
    JSON_VALUE(json_payload.n) AS n,
    JSON_VALUE(json_payload.code) AS code,
    JSON_VALUE(json_payload.reason) AS reason,
    CAST(JSON_VALUE(json_payload.peers) AS INT64) AS peers,
    CAST(JSON_VALUE(json_payload.lifeMs) AS INT64) AS life_ms,
    JSON_VALUE(json_payload.sbuild) AS sbuild,
    timestamp
  FROM real
  WHERE JSON_VALUE(json_payload.svc) = 'signaling'
    AND timestamp >= TIMESTAMP_SUB(TIMESTAMP(DATE_ADD(CURRENT_DATE('America/New_York'), INTERVAL 1 DAY), 'America/New_York'), INTERVAL 7 DAY) -- range
)
SELECT
  DATE(timestamp, 'America/New_York') AS day,
  COUNT(DISTINCT IF(n = 'room_create', room, NULL)) AS lobbies,
  COUNT(DISTINCT IF(n = 'room_join', room, NULL)) AS lobbies_joined,
  MAX(IF(n = 'room_join', peers, NULL)) AS largest,
  APPROX_QUANTILES(IF(n = 'room_end', life_ms, NULL), 2)[OFFSET(1)] / 60000 AS median_life_min,
  COUNTIF(n = 'room_refused' AND code = 'room_full') AS refused_full,
  COUNTIF(n = 'room_refused' AND code = 'no_such_lobby') AS refused_stale_invite,
  COUNTIF(n = 'room_refused' AND code = 'host_away') AS refused_host_away,
  COUNTIF(n = 'room_end' AND reason = 'host_gone') AS hosts_lost
FROM rooms
GROUP BY day
ORDER BY day DESC;
