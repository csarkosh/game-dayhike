#!/usr/bin/env node
// Prove production is actually serving a playable build.
//
// Everything here is checked against the live site over the network, with no
// reference to what the deploy scripts believed they did. A deploy that exits 0
// is not evidence; this is.
//
// The output contract matters as much as the checks: a future deploy skill
// parses this, so every failure — including a total outage — has to come out as
// the aggregated `✗` list at the bottom rather than as a stack trace.
//
// Usage: npm run deploy:verify

import { readFileSync } from 'node:fs';
import { fail, tfOutput } from './lib/preconditions.mjs';
import { validateLatest } from './lib/desktopRelease.mjs';
import { findModelUrls, findTextureUrls } from './lib/modelUrls.mjs';

const siteUrl = tfOutput('site_url');
const signalingUrl = tfOutput('signaling_url');
const siteOrigin = new URL(siteUrl).origin;
const legacyHost = tfOutput('legacy_domain_name');

const failures = [];
const pass = (what) => console.log(`  ✓ ${what}`);
const check = (ok, what, detail) => (ok ? pass(what) : failures.push(`${what} — ${detail}`));

// The client needs the WebSocket scheme and the path the server binds. Derived
// the same way `tools/deploy/client.mjs` derives what it bakes into the build,
// from the same Terraform output, so the two cannot drift.
const wsUrl = `${signalingUrl.replace(/^https:/, 'wss:')}/ws`;

async function verify() {
  console.log(`\nVerifying ${siteUrl}\n`);

  // 1. The page loads.
  const index = await fetch(`${siteUrl}/`);
  check(index.status === 200, 'index.html returns 200', `got ${index.status}`);
  const html = await index.text();
  check(html.includes('<script'), 'index.html carries a script tag', 'no <script> found');
  check(
    (index.headers.get('cache-control') ?? '').includes('no-cache'),
    'index.html is not cached',
    `cache-control: ${index.headers.get('cache-control')}`,
  );

  // 2. A deep game link resolves rather than 404ing, so the SPA rewrite works.
  const deep = await fetch(`${siteUrl}/game/3f2504e0-4f89-41d3-9a0c-0305e82c3301`);
  check(deep.status === 200, 'a /game/<uuid> link resolves', `got ${deep.status}`);

  // 2b. The old host and the new root both serve the redirect page, which
  // carries the new base URL in its script and its fallback link.
  for (const target of [`https://${legacyHost}/game/3f2504e0-4f89-41d3-9a0c-0305e82c3301?cmd=x`, `${siteOrigin}/`]) {
    const res = await fetch(target, { redirect: 'manual' });
    const body = res.status === 200 ? await res.text() : '';
    check(
      res.status === 200 && body.includes(`${siteUrl}/`) && body.includes('function redirectTarget'),
      `${target} serves the redirect page`,
      `status ${res.status}${body ? '' : ', empty body'}`,
    );
  }

  // 3. The hashed bundle is cached hard — and, more importantly, was built
  // against the real signaling URL.
  const bundle = html.match(/src="([^"]*\/assets\/[^"]+\.js)"/)?.[1];
  // Check 4 reads the model URLs out of this same source rather than fetching it
  // twice, so it has to outlive this block.
  let bundleSource = '';
  if (!bundle) {
    failures.push('could not find a hashed bundle in index.html — did the build succeed?');
  } else {
    // Vite emits the bundle's src base-absolute (`/dayhike/assets/...`), not
    // relative to siteUrl, so it has to be fetched against the site's origin.
    const asset = await fetch(`${siteOrigin}${bundle}`);
    check(asset.status === 200, `${bundle} returns 200`, `got ${asset.status}`);
    check(
      (asset.headers.get('cache-control') ?? '').includes('immutable'),
      `${bundle} is immutable`,
      `cache-control: ${asset.headers.get('cache-control')}`,
    );

    // This catches the likeliest deploy mistake there is: `npm run build &&
    // firebase deploy` by hand instead of `npm run deploy:client`. Then
    // VITE_SIGNALING_URL is unset, `signalingUrl()` falls back to same-origin
    // wss://games.csarko.sh/ws, Firebase answers that upgrade with index.html,
    // and the site is completely unplayable — while every other check here
    // passes. This project shipped in exactly that state once.
    bundleSource = asset.status === 200 ? await asset.text() : '';
    check(
      bundleSource.includes(wsUrl),
      'the bundle was built against the real signaling URL',
      `${wsUrl} does not appear in ${bundle} — was it built by \`npm run deploy:client\`?`,
    );
  }

  // 4. The models are real geometry, not LFS pointers. This is the check that
  // catches a deploy which looks perfect and has no rangers or Hollow in it.
  //
  // Their URLs are content-hashed, so they cannot be spelled out here. They are
  // discovered out of the bundle source check 3 already fetched — the same
  // technique, and the same reason: what the deploy scripts believed they shipped
  // is not evidence. An id the bundle never mentions is its own failure, because
  // that means the model map did not make it into the entry chunk and no amount
  // of correct hosting would help.
  //
  // `clutter.fungus_b` rides along with the two characters for a second reason: at
  // 4,236 bytes it is the model closest to Vite's 4,096-byte `assetsInlineLimit`,
  // and `client/vite.config.ts` opts .glb out of inlining by only 140 bytes of
  // margin. Nothing else in the repo guards that opt-out — deleting it passes
  // typecheck, lint, the suite and the build today. An inlined model has no
  // `/assets/<id>-<hash>.glb` in the bundle at all, so the "does not reference"
  // failure below catches a lost guard for free, in production, which is where it
  // would actually matter.
  const modelIds = ['ranger.nathan', 'hollow.antlered', 'clutter.fungus_b'];
  if (!bundleSource) {
    // Check 3 already reported why. Running the loop here would add one
    // "the bundle does not reference …" line per id, all blaming the model map
    // for a bundle that was never fetched.
    failures.push('skipped the model checks — no bundle source to read their URLs from');
  } else {
    const modelUrls = findModelUrls(bundleSource, modelIds);
    for (const id of modelIds) {
      const url = modelUrls[id];
      if (!url) {
        failures.push(`the bundle does not reference ${id} — was the model map built?`);
        continue;
      }
      const res = await fetch(`${siteOrigin}${url}`);
      if (res.status !== 200) {
        failures.push(`${url} — got ${res.status}`);
        continue;
      }
      const magic = Buffer.from(await res.arrayBuffer()).subarray(0, 4).toString('latin1');
      check(magic === 'glTF', `${id} is a real glTF binary`, `magic was ${JSON.stringify(magic)}`);
      // The whole point of hashing the URL: it may now be cached forever. If
      // Firebase's `/assets/**` rule ever stops covering these, models go back to
      // being re-fetched on every load and nothing else here would notice.
      check(
        (res.headers.get('cache-control') ?? '').includes('immutable'),
        `${id} is served immutable`,
        `cache-control: ${res.headers.get('cache-control')}`,
      );
    }
  }

  // 4b. The ground textures shipped as real bytes, not an LFS pointer and not
  // inlined away. This is check 4's failure mode again, one asset kind over:
  // eighteen `ground.<layer>.webp` / `.normal.webp` / `.rah.webp` files (six
  // ground layers, three maps each) ship the same way models do — `?url`
  // imports Vite content-hashes — but nothing here checked
  // them before, and a WebP is small enough to hit a failure mode a model
  // never does: Vite's 4,096-byte `assetsInlineLimit` turns a small `?url`
  // asset into a base64 `data:` URI instead of a separate, cacheable request,
  // so it never appears in the bundle as an `/assets/…-<hash>.webp` string at
  // all. `ground.asphalt.rah.webp` is the one to watch — at ~2.7 KB it is by
  // far the closest of the eighteen to the limit, and `client/vite.config.ts`
  // opts every `textures/ground.*.webp` out of inlining for exactly this
  // reason. The "does not reference" failure below is what would catch that
  // guard going missing, in production, the same way check 4's model loop
  // catches a lost `.glb` guard.
  const groundLayers = ['grass', 'forest_floor', 'rock', 'sand', 'pebble', 'asphalt'];
  const textureIds = groundLayers.flatMap((id) => [`ground.${id}`, `ground.${id}.normal`, `ground.${id}.rah`]);
  if (!bundleSource) {
    // Check 3 already reported why. One "does not reference" line per id would
    // all blame the texture map for a bundle that was never fetched.
    failures.push('skipped the ground-texture checks — no bundle source to read their URLs from');
  } else {
    const textureUrls = findTextureUrls(bundleSource, textureIds);
    for (const id of textureIds) {
      const url = textureUrls[id];
      if (!url) {
        failures.push(
          `the bundle does not reference ${id} — inlined under assetsInlineLimit, or the texture map was not built?`,
        );
        continue;
      }
      const res = await fetch(`${siteOrigin}${url}`);
      if (res.status !== 200) {
        failures.push(`${url} — got ${res.status}`);
        continue;
      }
      const bytes = Buffer.from(await res.arrayBuffer());
      const riff = bytes.subarray(0, 4).toString('latin1');
      const webp = bytes.subarray(8, 12).toString('latin1');
      check(riff === 'RIFF' && webp === 'WEBP', `${id} is a real WebP image`, `magic was ${JSON.stringify(riff)}/${JSON.stringify(webp)}`);
      // Same immutable-cache reasoning as the model check above.
      check(
        (res.headers.get('cache-control') ?? '').includes('immutable'),
        `${id} is served immutable`,
        `cache-control: ${res.headers.get('cache-control')}`,
      );
    }
  }

  // 5. Signaling is healthy. Not /healthz: Google's frontend on *.run.app
  // intercepts that exact literal path and answers it itself, never reaching
  // the container. /healthcheck is the path the server actually binds.
  const health = await fetch(`${signalingUrl}/healthcheck`);
  check(health.status === 200, 'signaling /healthcheck returns 200', `got ${health.status}`);

  // 6. And it actually creates a lobby — the thing a player depends on. Node
  // 22 ships a global WebSocket, so this needs no extra dependency.
  //
  // The room id is fresh per run. It used to be a constant, which meant two
  // runs overlapping — a retry, or a skill and a human at once — landed in the
  // same room, and the second one came back `role: 'client'` and reported a
  // failure that was really just the first run still holding the host slot.
  //
  // This sends `create`, not `join`: a bare `join` to a room nobody created is
  // now refused with `no_such_lobby`, since lobbies are a concept the server
  // tracks rather than a room id anyone can walk into. `role === 'host'` is
  // what proves the server actually registered the lobby.
  const room = crypto.randomUUID();
  const joined = await new Promise((resolve) => {
    const socket = new WebSocket(wsUrl);
    const done = (result) => {
      clearTimeout(timer);
      resolve(result);
    };
    const timer = setTimeout(() => {
      socket.close();
      done({ ok: false, why: 'timed out after 15s' });
    }, 15000);

    socket.addEventListener('open', () =>
      socket.send(JSON.stringify({ t: 'create', room, peerId: `verify-${Date.now()}` })),
    );
    socket.addEventListener('message', (event) => {
      const msg = JSON.parse(event.data.toString());
      if (msg.t === 'joined') {
        socket.send(JSON.stringify({ t: 'leave' }));
        socket.close();
        done({ ok: msg.role === 'host', why: `role was ${msg.role}` });
      }
    });
    socket.addEventListener('error', (event) =>
      done({ ok: false, why: event.message ?? 'websocket error' }),
    );
    // Without this a silently dropped socket — the shape a misrouted upgrade
    // or a dead revision actually takes — burns the full 15 s before reporting
    // nothing useful. The close code says which.
    socket.addEventListener('close', (event) =>
      done({ ok: false, why: `closed before joining (code ${event.code})` }),
    );
  });
  check(joined.ok, 'a real WebSocket create succeeds over wss', joined.why);

  // 7. The desktop release the landing page will advertise exists and is
  // whole: latest.json parses, names the version the repo believes is
  // current, and every build it points at — the dmg and the Windows
  // installer — is really there at the stated size.
  //
  // The web gate must not depend on the desktop release order forever: the
  // very first `deploy:verify` run has to pass before any desktop release has
  // ever been cut, so a missing latest.json while desktop/package.json is
  // still 0.0.0 is expected, not an outage. Once a real release exists (the
  // version bump is the release script's last commit), the same 404 means
  // production lost the file, and that is a real failure.
  const downloadsUrl = tfOutput('downloads_url');
  const pkgVersion = JSON.parse(readFileSync('desktop/package.json', 'utf8')).version;
  const latestRes = await fetch(`${downloadsUrl}/desktop/latest.json`, { cache: 'no-store' });
  if (latestRes.status !== 200) {
    if (pkgVersion === '0.0.0') {
      console.log('  ! desktop: no release published yet (desktop/package.json is 0.0.0) — skipping');
    } else {
      failures.push(`desktop/latest.json — got ${latestRes.status} (no desktop release published yet?)`);
    }
  } else {
    check(
      (latestRes.headers.get('cache-control') ?? '').includes('no-cache'),
      'latest.json is not cached',
      `cache-control: ${latestRes.headers.get('cache-control')}`,
    );
    const latest = validateLatest(await latestRes.json());
    if (!latest) {
      failures.push('latest.json is malformed');
    } else {
      check(latest.version === pkgVersion, `latest.json advertises ${pkgVersion}`, `it says ${latest.version}`);
      for (const [platform, build] of Object.entries(latest.platforms)) {
        const head = await fetch(build.url, { method: 'HEAD' });
        check(head.status === 200, `the advertised ${platform} artifact exists`, `HEAD ${build.url} → ${head.status}`);
        check(
          Number(head.headers.get('content-length')) === build.size,
          `the ${platform} artifact has the advertised size`,
          `content-length ${head.headers.get('content-length')} vs size ${build.size}`,
        );
      }
      // From the first Windows release on, a Mac-only latest.json is a
      // regression: half the download page would advertise nothing.
      check('win32-x64' in latest.platforms, 'latest.json advertises a Windows build', 'no win32-x64 entry');
    }
  }
}

try {
  await verify();
} catch (err) {
  // A total outage throws out of fetch. Funnelled into the same list so the
  // output shape is identical whether one check failed or nothing is up at all.
  failures.push(`verification aborted — ${err instanceof Error ? err.message : String(err)}`);
}

if (failures.length > 0) {
  fail(`${failures.length} check(s) failed:\n  ✗ ` + failures.join('\n  ✗ '));
}
console.log(`\n✓ production verified\n`);
