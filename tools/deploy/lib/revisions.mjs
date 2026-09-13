// Retiring Cloud Run revisions that a deploy has superseded.
//
// This exists to close the deploy split-brain. Cloud Run does not drop
// established WebSockets on a revision swap — it *drains* them, and the old
// revision keeps serving its own sockets until they end, up to the 60-minute
// request cap. For the length of that drain two revisions are live with
// disjoint in-memory room registries: `max_instance_count = 1` holds per
// revision, not across a swap, so two different rooms can hold the same UUID.
//
// The match itself is unaffected, being peer-to-peer. What breaks is that
// room's invite link: a new joiner is routed to the new revision, does not find
// the room, and becomes host of a parallel world under the same id. Observed in
// production, not theorised.
//
// Deleting the superseded revisions ends their instances, which closes those
// sockets. Every peer then reconnects onto the one revision serving traffic and
// the host recreates the room there. The window shrinks from up to an hour to
// the client's reconnect backoff.

import { run } from './preconditions.mjs';

function gcloudJson(args) {
  return JSON.parse(run('gcloud', [...args, '--format=json']));
}

/**
 * Deletes every revision of `service` that is not currently serving traffic.
 *
 * Deliberately never fails the deploy. By the time this runs the new revision
 * is live and healthy, so a cleanup problem is worth reporting and not worth
 * turning into a non-zero exit that invites someone to re-run a deploy that
 * already succeeded.
 */
export function retireSupersededRevisions(service, region, project) {
  const scope = ['--region', region, '--project', project];

  let serving;
  let all;
  try {
    const described = gcloudJson(['run', 'services', 'describe', service, ...scope]);
    serving = new Set(
      (described.status?.traffic ?? [])
        .filter((entry) => (entry.percent ?? 0) > 0)
        .map((entry) => entry.revisionName)
        .filter(Boolean),
    );
    all = gcloudJson(['run', 'revisions', 'list', '--service', service, ...scope]).map(
      (revision) => revision.metadata?.name,
    );
  } catch (error) {
    console.warn(`! could not read revisions, skipping cleanup: ${error.message}`);
    return;
  }

  // An empty serving set means the traffic block could not be read. Deleting on
  // that basis would delete the revision actually serving the game, so stop.
  if (serving.size === 0) {
    console.warn('! no revision appears to be serving traffic; skipping cleanup to be safe');
    return;
  }

  const superseded = all.filter((name) => name && !serving.has(name));
  if (superseded.length === 0) return;

  console.log(`→ retiring ${superseded.length} superseded revision(s)`);
  for (const name of superseded) {
    try {
      run('gcloud', ['run', 'revisions', 'delete', name, ...scope, '--quiet']);
      console.log(`  ✓ ${name}`);
    } catch (error) {
      // Most likely another deploy got there first, or the revision is mid
      // delete. Either way the next deploy sweeps it.
      console.warn(`  ! ${name}: ${error.message.split('\n')[0]}`);
    }
  }
}
