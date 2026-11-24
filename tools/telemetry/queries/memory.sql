-- What players' machines have, and how much of it the game holds: one row a
-- band of device memory, over the sessions of the last ninety days that
-- reached a match.
-- A session says once what its machine has: `mem`, the browser's own figure
-- for the device's memory in gigabytes (rounded down to a power of two, and
-- 0 where the browser does not say: Safari and Firefox), `cores`, and
-- `heapLimit`, the most megabytes the browser lets the page's JS heap grow
-- to. From the first build that sends them, its `match_start` row and every
-- heartbeat (`hb`) say what the page holds then: `heap` and `heapTotal`, the
-- page's JS heap used and reserved, and `gpuBuf` and `gpuTex`, the megabytes
-- the WebGPU device was asked to hold in buffers and in textures. A
-- session's own figure here is the most any of its rows said.
-- Read with care: the browser rounds its heap figures and may hold a reading
-- for minutes; the heap counts the page's own thread, not its workers; and
-- the device's bytes are what the page asked for, of which a browser's GPU
-- process holds about twice. `measured` is how many of a band's sessions
-- sent any of the four, so a band of older builds reads as none and not as
-- nothing held.
-- The rows that are real play, the same text in every query (`README.md`):
-- not the deploy's verification (`build = 'verify'` on a page's rows,
-- `verify` on signaling's), not the owner's test browsers (`tester`), not a
-- session of the README's stills shoot (one with a `cmd` row, looked for over
-- the last ninety days), not a headless or automated browser (a `SwiftShader`
-- GPU, a `HeadlessChrome` user agent, or `wd`, the page's navigator.webdriver:
-- headless Chrome on a real GPU names NVIDIA or Apple, not SwiftShader).
WITH real AS (
  SELECT timestamp, json_payload
  FROM `fps-csarko.global.dayhike-telemetry._AllLogs`
  WHERE IFNULL(JSON_VALUE(json_payload.build), '') != 'verify'
    AND IFNULL(JSON_VALUE(json_payload.tester), '') != 'true'
    AND IFNULL(JSON_VALUE(json_payload.verify), '') != 'true'
    AND IFNULL(JSON_VALUE(json_payload.gpu), '') NOT LIKE '%SwiftShader%'
    AND IFNULL(JSON_VALUE(json_payload.ua), '') NOT LIKE '%HeadlessChrome%'
    AND IFNULL(JSON_VALUE(json_payload.wd), '') != 'true'
    AND IFNULL(JSON_VALUE(json_payload.sid), '') NOT IN (
      SELECT DISTINCT JSON_VALUE(json_payload.sid)
      FROM `fps-csarko.global.dayhike-telemetry._AllLogs`
      WHERE JSON_VALUE(json_payload.n) = 'cmd'
        AND JSON_VALUE(json_payload.sid) IS NOT NULL
        AND timestamp >= TIMESTAMP_SUB(CURRENT_TIMESTAMP(), INTERVAL 90 DAY)
    )
),
sessions AS (
  SELECT
    JSON_VALUE(json_payload.sid) AS sid,
    MAX(SAFE_CAST(JSON_VALUE(json_payload.mem) AS FLOAT64)) AS mem,
    MAX(SAFE_CAST(JSON_VALUE(json_payload.cores) AS INT64)) AS cores,
    MAX(JSON_VALUE(json_payload.mobile)) AS mobile,
    MAX(SAFE_CAST(JSON_VALUE(json_payload.heapLimit) AS INT64)) AS heap_limit,
    MAX(SAFE_CAST(JSON_VALUE(json_payload.heap) AS INT64)) AS heap,
    MAX(SAFE_CAST(JSON_VALUE(json_payload.heapTotal) AS INT64)) AS heap_total,
    MAX(SAFE_CAST(JSON_VALUE(json_payload.gpuBuf) AS INT64) + SAFE_CAST(JSON_VALUE(json_payload.gpuTex) AS INT64)) AS gpu,
    COUNTIF(JSON_VALUE(json_payload.n) = 'match_start') AS matches
  FROM real
  WHERE timestamp >= TIMESTAMP_SUB(CURRENT_TIMESTAMP(), INTERVAL 90 DAY)
    AND JSON_VALUE(json_payload.sid) IS NOT NULL
  GROUP BY sid
)
SELECT
  IFNULL(mobile, '') AS mobile,
  IFNULL(mem, 0) AS device_gb,
  COUNT(*) AS sessions,
  APPROX_QUANTILES(cores, 2)[OFFSET(1)] AS cores_median,
  COUNTIF(heap IS NOT NULL OR gpu IS NOT NULL) AS measured,
  APPROX_QUANTILES(heap_limit, 2 IGNORE NULLS)[OFFSET(1)] AS heap_limit_mb_median,
  APPROX_QUANTILES(heap, 2 IGNORE NULLS)[OFFSET(1)] AS heap_mb_median,
  APPROX_QUANTILES(heap, 20 IGNORE NULLS)[OFFSET(19)] AS heap_mb_p95,
  MAX(heap) AS heap_mb_max,
  APPROX_QUANTILES(gpu, 2 IGNORE NULLS)[OFFSET(1)] AS gpu_mb_median,
  APPROX_QUANTILES(gpu, 20 IGNORE NULLS)[OFFSET(19)] AS gpu_mb_p95,
  MAX(gpu) AS gpu_mb_max
FROM sessions
WHERE matches > 0
GROUP BY mobile, device_gb
ORDER BY mobile, device_gb
