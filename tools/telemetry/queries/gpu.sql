-- One session's GPU failures, in order: each GPU error a hike told of
-- (`gpu_error`: its kind, its text, the labels it names) with the window
-- that judged the picture after it (`gpu_window`: the errors that followed
-- and how many distinct, the frames drawn meanwhile, the picture read small
-- and the verdict, `held`, `broke` or `unknown`; `judged_by` is the window
-- an error fell in and the window's own number); each lost device
-- (`device_lost`: what the device said, how many the page had had and how
-- close together, what the device held, what the bound on rebuilds made of
-- it) with how its rebuild came out (`engine_rebuilt`); and the hike's end
-- where the losses ended it (`session_end` with `why`). Beside each, what
-- was happening: the tier, the renderer (`r`, 1 the hike's first), whether it
-- stood, the frames it had drawn, whether the world was in, a switch or a
-- rebuild under way, the intro's film over the hike, the page hidden, a
-- scene or an ending playing, the weather, the lakes and the sea in view.
-- Replace SID with the session id from any other query (`errors.sql` names
-- one a line). The rows are read over a window a day either side of the
-- session's own span, as `session.sql` reads them; `row_json` is the whole
-- row, for the fields no column names.
WITH span AS (
  SELECT MIN(timestamp) AS first_at, MAX(timestamp) AS last_at
  FROM `fps-csarko.global.dayhike-telemetry._AllLogs`
  WHERE JSON_VALUE(json_payload.sid) = 'SID' -- session
)
SELECT
  timestamp,
  CAST(JSON_VALUE(json_payload.t) AS INT64) AS t,
  JSON_VALUE(json_payload.n) AS n,
  JSON_VALUE(json_payload.r) AS renderer,
  JSON_VALUE(json_payload.w) AS judged_by,
  JSON_VALUE(json_payload.tier) AS tier,
  JSON_VALUE(json_payload.state) AS state,
  CAST(JSON_VALUE(json_payload.frames) AS INT64) AS frames,
  CAST(JSON_VALUE(json_payload.stoodMs) AS INT64) AS stood_ms,
  -- A GPU error.
  JSON_VALUE(json_payload.nth) AS nth,
  JSON_VALUE(json_payload.kind) AS kind,
  JSON_VALUE(json_payload.src) AS src,
  JSON_VALUE(json_payload.labels) AS labels,
  JSON_VALUE(json_payload.msg) AS msg,
  -- Its window.
  CAST(JSON_VALUE(json_payload.errors) AS INT64) AS errors,
  -- `distinct` is a word of the language: read by its path.
  CAST(JSON_VALUE(json_payload, '$.distinct') AS INT64) AS distinct_errors,
  CAST(JSON_VALUE(json_payload.total) AS INT64) AS total_errors,
  JSON_VALUE(json_payload.picture) AS picture,
  CAST(JSON_VALUE(json_payload.luma) AS FLOAT64) AS luma,
  CAST(JSON_VALUE(json_payload.black) AS FLOAT64) AS black,
  CAST(JSON_VALUE(json_payload.spread) AS FLOAT64) AS spread,
  JSON_VALUE(json_payload.unread) AS unread,
  -- A lost device, its rebuild, and the end.
  JSON_VALUE(json_payload.reason) AS reason,
  CAST(JSON_VALUE(json_payload.losses) AS INT64) AS losses,
  CAST(JSON_VALUE(json_payload.recent) AS INT64) AS recent,
  CAST(JSON_VALUE(json_payload.sinceMs) AS INT64) AS since_ms,
  JSON_VALUE(json_payload.verdict) AS verdict,
  CAST(JSON_VALUE(json_payload.bufs) AS INT64) AS buffers,
  CAST(JSON_VALUE(json_payload.bufMB) AS FLOAT64) AS buffer_mb,
  CAST(JSON_VALUE(json_payload.texs) AS INT64) AS textures,
  CAST(JSON_VALUE(json_payload.texMB) AS FLOAT64) AS texture_mb,
  CAST(JSON_VALUE(json_payload.heapMB) AS FLOAT64) AS heap_mb,
  JSON_VALUE(json_payload.ok) AS ok,
  CAST(JSON_VALUE(json_payload.ms) AS INT64) AS ms,
  JSON_VALUE(json_payload.why) AS why,
  -- What was happening.
  JSON_VALUE(json_payload.ready) AS ready,
  JSON_VALUE(json_payload.busy) AS busy,
  JSON_VALUE(json_payload.film) AS film,
  JSON_VALUE(json_payload.hidden) AS hidden,
  CAST(JSON_VALUE(json_payload.shownMs) AS INT64) AS shown_ms,
  JSON_VALUE(json_payload.scene) AS scene,
  JSON_VALUE(json_payload.ending) AS ending,
  CAST(JSON_VALUE(json_payload.dark) AS FLOAT64) AS dark,
  CAST(JSON_VALUE(json_payload.rain) AS FLOAT64) AS rain,
  CAST(JSON_VALUE(json_payload.night) AS FLOAT64) AS night,
  CAST(JSON_VALUE(json_payload.lakes) AS INT64) AS lakes,
  JSON_VALUE(json_payload.sea) AS sea,
  CAST(JSON_VALUE(json_payload.p) AS FLOAT64) AS p,
  JSON_VALUE(json_payload.gpu) AS gpu,
  JSON_VALUE(json_payload.build) AS build,
  TO_JSON_STRING(json_payload) AS row_json
FROM `fps-csarko.global.dayhike-telemetry._AllLogs`
WHERE timestamp >= (SELECT TIMESTAMP_SUB(first_at, INTERVAL 1 DAY) FROM span)
  AND timestamp <= (SELECT TIMESTAMP_ADD(last_at, INTERVAL 1 DAY) FROM span)
  AND JSON_VALUE(json_payload.sid) = 'SID' -- session
  AND (
    JSON_VALUE(json_payload.n) IN ('gpu_error', 'gpu_window', 'device_lost', 'engine_rebuilt')
    OR (JSON_VALUE(json_payload.n) = 'engine_failed' AND JSON_VALUE(json_payload.reason) = 'lost')
    OR (JSON_VALUE(json_payload.n) = 'session_end' AND JSON_VALUE(json_payload.why) = 'device_lost')
  )
ORDER BY timestamp, t;
