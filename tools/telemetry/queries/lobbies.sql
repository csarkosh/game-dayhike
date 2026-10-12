-- Parties: from the signaling server's own rows, how many lobbies formed, how
-- big each got, how long it lived, and the joins it refused. A lobby of one
-- is a solo game that pressed Invite and nobody came.
WITH rooms AS (
  SELECT
    JSON_VALUE(json_payload.room) AS room,
    JSON_VALUE(json_payload.n) AS n,
    JSON_VALUE(json_payload.code) AS code,
    JSON_VALUE(json_payload.reason) AS reason,
    CAST(JSON_VALUE(json_payload.peers) AS INT64) AS peers,
    CAST(JSON_VALUE(json_payload.lifeMs) AS INT64) AS life_ms,
    JSON_VALUE(json_payload.sbuild) AS sbuild,
    timestamp
  FROM `fps-csarko.global.dayhike-telemetry._AllLogs`
  WHERE JSON_VALUE(json_payload.svc) = 'signaling'
    AND timestamp >= TIMESTAMP_SUB(CURRENT_TIMESTAMP(), INTERVAL 7 DAY) -- range
)
SELECT
  DATE(timestamp) AS day,
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
