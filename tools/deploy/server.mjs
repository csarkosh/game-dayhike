#!/usr/bin/env node
// Build the server image, push it, roll out a Cloud Run revision of each
// service that runs it — signaling, and telemetry in its own role — and prove
// each answers before reporting success.
//
// Terraform owns the services' shapes; this script owns only the image tag.
// That split is why the Cloud Run resources ignore changes to their image.
//
// Usage: npm run deploy:server

import {
  buildTag,
  fail,
  requireCommand,
  requireGcloudAuth,
  requireProjectMatchesTerraform,
  runLoud,
  tfOutput,
} from './lib/preconditions.mjs';
import { retireSupersededRevisions } from './lib/revisions.mjs';

requireCommand('docker', 'Install Docker and make sure the daemon is running.');
requireGcloudAuth();
const project = requireProjectMatchesTerraform();

const repository = tfOutput('signaling_image_repository');
const region = repository.split('-docker.pkg.dev')[0];
// Both services run this one image; the role is each service's environment
// (`_infra/modules/gcp-signaling`, `_infra/modules/gcp-telemetry`).
const services = [
  { name: tfOutput('signaling_service_name'), url: tfOutput('signaling_url') },
  { name: tfOutput('telemetry_service_name'), url: tfOutput('telemetry_url') },
];

// Tag by commit so a revision is traceable to a source state. Dirty trees get a
// suffix, so an untested local change is never mistaken for a committed one.
// The same tag is baked into the image, so the rows it writes name it.
const tag = buildTag();
const image = `${repository}/signaling:${tag}`;

console.log(`→ project ${project}`);
console.log(`→ image   ${image}`);

runLoud('gcloud', ['auth', 'configure-docker', `${region}-docker.pkg.dev`, '--quiet']);

// linux/amd64 explicitly: Cloud Run will not run an arm64 image, and an Apple
// Silicon machine builds arm64 by default. The failure otherwise appears as a
// container that will not start, far from its cause.
runLoud('docker', [
  'build',
  '--platform',
  'linux/amd64',
  '--build-arg',
  `BUILD_SHA=${tag}`,
  '-f',
  'server/Dockerfile',
  '-t',
  image,
  '.',
]);
runLoud('docker', ['push', image]);

// If a Terraform apply just changed a container field (e.g. the startup
// probe's path), this rollout can produce a revision that fails its startup
// probe — expected, not a rollback signal. See the comment on `startup_probe`
// in `_infra/modules/gcp-signaling/main.tf` for why, and why this deploy is
// the fix rather than something to retry away from.
for (const service of services) {
  runLoud('gcloud', [
    'run',
    'deploy',
    service.name,
    '--image',
    image,
    '--region',
    region,
    '--quiet',
  ]);
}

for (const service of services) {
  // Not /healthz: Google's frontend on *.run.app intercepts that exact literal
  // path and answers it itself, so a real deploy's poll would never see the
  // container. /healthcheck is the path the server, the Terraform startup
  // probe, and this poll all agree on instead.
  const health = `${service.url}/healthcheck`;
  process.stdout.write(`→ polling ${health} `);

  let ok = false;
  for (let attempt = 0; attempt < 30; attempt++) {
    try {
      const res = await fetch(health);
      if (res.ok && (await res.text()).trim() === 'ok') {
        ok = true;
        break;
      }
    } catch {
      // Cold start or rollout still in progress.
    }
    process.stdout.write('.');
    await new Promise((resolve) => setTimeout(resolve, 2000));
  }
  process.stdout.write('\n');

  if (!ok) fail(`deployed revision never answered ${health}. Check \`gcloud run services logs read ${service.name} --region ${region}\`.`);

  retireSupersededRevisions(service.name, region, project);
}

console.log(`\n✓ signaling live at ${services[0].url}`);
console.log(`✓ telemetry live at ${services[1].url}`);
