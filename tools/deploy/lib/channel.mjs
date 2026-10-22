// The pure parts of the preview-channel script: its arguments, the rule for a
// channel's name, the Firebase command, and the channel's address read back
// from the command's output. No files, no processes.

export const CHANNEL_NAME = /^[a-z0-9](?:[a-z0-9-]{0,34}[a-z0-9])?$/;

/** `<name> [--expires <d>] [--dry-run]`, in any order. */
export function parseChannelArgs(argv) {
  let expires = '7d';
  let dryRun = false;
  const names = [];
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--dry-run') dryRun = true;
    else if (arg === '--expires') {
      expires = argv[++i];
      if (!expires || expires.startsWith('--')) throw new Error('--expires needs a duration, such as 7d');
    } else if (arg.startsWith('--')) throw new Error(`unknown option ${arg}`);
    else names.push(arg);
  }
  if (names.length === 0) throw new Error('a channel needs a name: npm run preview:channel -- <name>');
  if (names.length > 1) throw new Error(`a channel takes one name, not ${names.length}: ${names.join(' ')}`);
  return { name: names[0], expires, dryRun };
}

export function checkChannelName(name) {
  if (!CHANNEL_NAME.test(name)) {
    throw new Error(
      `channel name \`${name}\` is not allowed: lowercase letters, digits and hyphens, 1 to 36 characters, not starting or ending with a hyphen`,
    );
  }
}

export function channelDeployArgs(name, expires, project) {
  return ['firebase-tools', 'hosting:channel:deploy', name, '--expires', expires, '--project', project, '--non-interactive'];
}

/** The CLI prints `Channel URL (<site>): https://… [expires …] [version …]`. */
export function channelUrlFrom(stdout, sitePath) {
  const match = /Channel URL \([^)]*\):\s*(https:\/\/\S+)/.exec(stdout);
  if (!match) throw new Error('the Firebase CLI printed no `Channel URL` line:\n' + stdout);
  return `${match[1].replace(/\/+$/, '')}${sitePath}/`;
}
