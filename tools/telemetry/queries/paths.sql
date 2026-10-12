-- Every position sample, for a heat map of where parties went: x and z in
-- metres on the world's frame (so one world version at a time), the climb
-- and the health at the sample. The seed is the world's, so samples from
-- different worlds of one version do not overlay.
SELECT
  JSON_VALUE(json_payload.world) AS world,
  CAST(JSON_VALUE(json_payload.seed) AS INT64) AS seed,
  JSON_VALUE(json_payload.sid) AS sid,
  CAST(JSON_VALUE(json_payload.tick) AS INT64) AS tick,
  CAST(JSON_VALUE(json_payload.x) AS FLOAT64) AS x,
  CAST(JSON_VALUE(json_payload.z) AS FLOAT64) AS z,
  CAST(JSON_VALUE(json_payload.p) AS FLOAT64) AS p,
  CAST(JSON_VALUE(json_payload.hp) AS FLOAT64) AS hp
FROM `fps-csarko.global.dayhike-telemetry._AllLogs`
WHERE JSON_VALUE(json_payload.svc) = 'telemetry'
  AND timestamp >= TIMESTAMP_SUB(CURRENT_TIMESTAMP(), INTERVAL 7 DAY) -- range
  AND JSON_VALUE(json_payload.n) = 'pos'
  AND JSON_VALUE(json_payload.build) != 'verify'
ORDER BY world, seed, sid, tick;
