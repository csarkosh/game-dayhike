// Shared checks and helpers for the deploy scripts.
//
// These scripts are the interface a deploy skill drives, so every failure has
// to be specific enough to act on: which precondition failed, and what to run
// to fix it. A generic non-zero exit is not enough.

import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';

/** Exits with a message naming the fix, rather than a stack trace. */
export function fail(message) {
  console.error(`\n✗ ${message}\n`);
  process.exit(1);
}

export function run(file, args, options = {}) {
  return execFileSync(file, args, { encoding: 'utf8', stdio: 'pipe', ...options });
}

/** Streams output through, for long builds where silence looks like a hang. */
export function runLoud(file, args, options = {}) {
  return execFileSync(file, args, { stdio: 'inherit', ...options });
}

export function requireCommand(command, install) {
  try {
    run('which', [command]);
  } catch {
    fail(`\`${command}\` is not on PATH. ${install}`);
  }
}

/**
 * The Windows launch smoke runs as a GitHub Actions workflow the release
 * dispatches and waits on, so an unauthenticated `gh` does not fail late — it
 * fails after the dmg is already built and the installer already uploaded.
 */
export function requireGhAuth() {
  requireCommand('gh', 'brew install gh');
  const r = spawnSync('gh', ['auth', 'status'], { encoding: 'utf8' });
  if (r.status !== 0) fail(`gh is not authenticated:\n${r.stderr}\nRun: gh auth login`);
}

/**
 * Where production is, when Terraform cannot say.
 *
 * Terraform keeps its state in a local, git-ignored file, which means it
 * answers only in the one checkout that ran `apply` — and only for as long as
 * that checkout exists. Both halves of that have bitten: the state was created
 * inside a git worktree and went with it when the worktree was removed, and a
 * concurrent session working in its own worktree could never deploy at all.
 *
 * So the values are committed too. They are addresses, not configuration:
 * every one of them is already public, and none of them changes unless the
 * infrastructure is rebuilt. Terraform still wins when it can answer — it owns
 * the infrastructure and this file only describes it — but a missing state
 * file now blocks `terraform apply`, not a deploy.
 */
const PRODUCTION_PATH = 'tools/deploy/production.json';

let productionCache;
function production() {
  if (productionCache !== undefined) return productionCache;
  if (!existsSync(PRODUCTION_PATH)) {
    fail(`${PRODUCTION_PATH} is missing. Run this from the repository root.`);
  }
  try {
    productionCache = JSON.parse(readFileSync(PRODUCTION_PATH, 'utf8'));
  } catch (error) {
    fail(`${PRODUCTION_PATH} is not valid JSON: ${error.message}`);
  }
  return productionCache;
}

/**
 * One value describing production: from Terraform if its state is present,
 * otherwise from the committed copy. Warns when the two disagree, which means
 * the infrastructure moved and the committed copy is stale.
 */
export function tfOutput(name) {
  const fallback = production()[name];

  let fromTerraform;
  try {
    fromTerraform = run('terraform', ['-chdir=_infra', 'output', '-raw', name]).trim();
  } catch {
    if (fallback === undefined) {
      fail(
        `no Terraform state and no \`${name}\` in ${PRODUCTION_PATH}. ` +
          `Either run \`terraform -chdir=_infra apply\`, or add the value to that file.`,
      );
    }
    return fallback;
  }

  if (fallback !== undefined && fallback !== fromTerraform) {
    console.warn(
      `! ${name}: Terraform says \`${fromTerraform}\`, ${PRODUCTION_PATH} says ` +
        `\`${fallback}\`. Using Terraform's. Update that file.`,
    );
  }
  return fromTerraform;
}

export function requireGcloudAuth() {
  requireCommand('gcloud', 'Install the Google Cloud CLI.');
  const accounts = run('gcloud', [
    'auth',
    'list',
    '--filter=status:ACTIVE',
    '--format=value(account)',
  ]).trim();
  if (accounts === '') fail('no active gcloud account. Run `gcloud auth login`.');
}

/**
 * The active gcloud project must match the one Terraform manages, or a deploy
 * silently targets the wrong place.
 */
export function requireProjectMatchesTerraform() {
  const expected = tfOutput('gcp_project_id');
  const actual = run('gcloud', ['config', 'get-value', 'project']).trim();
  if (actual !== expected) {
    fail(
      `gcloud project is \`${actual}\` but Terraform manages \`${expected}\`. ` +
        `Run \`gcloud config set project ${expected}\`.`,
    );
  }
  return expected;
}

/**
 * Shipped models are Git LFS objects. If they were never fetched, the working
 * tree holds ~130-byte pointer files, `vite build` hashes and emits those into
 * dist exactly as if they were models, and the game falls back to capsules with
 * no error anywhere. The deploy looks clean and the enemies are gone. A real
 * .glb starts with the ASCII magic "glTF".
 */
export function requireLfsMaterialized(files) {
  for (const file of files) {
    if (!existsSync(file)) fail(`expected asset is missing: ${file}`);
    const head = readFileSync(file).subarray(0, 4).toString('latin1');
    if (head !== 'glTF') {
      fail(
        `${file} is a Git LFS pointer, not a real model. ` +
          `Run \`git lfs install && git lfs pull\` before deploying.`,
      );
    }
  }
}
