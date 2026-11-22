// The pure parts of the preview-channel script: its arguments, the rule for a
// channel's name, the expiry in the site tool's whole days, and the channel's
// address read back from the tool's output. No files, no processes.

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

/** `7d` as the site tool's whole days (1 to 30); anything else is refused with a sentence. */
export function expiresDays(expires) {
  const match = /^(\d+)d$/.exec(expires);
  const days = match ? Number(match[1]) : NaN;
  if (!(days >= 1 && days <= 30)) {
    throw new Error(`--expires takes whole days from 1d to 30d, such as 7d; got \`${expires}\``);
  }
  return days;
}

/**
 * The site tool prints the channel's address as its last line, with the site path
 * (`https://fps-csarko--name-abc123.web.app/dayhike`). Returned with a trailing slash.
 */
export function channelUrlFrom(stdout, sitePath) {
  const lines = stdout.split('\n').map((line) => line.trim()).filter((line) => line !== '');
  const last = lines.at(-1) ?? '';
  const address = last.replace(/\/+$/, '');
  if (!/^https:\/\/\S+$/.test(address) || !address.endsWith(sitePath)) {
    throw new Error(`the site tool's last line is not the channel's address (https://…${sitePath}):\n${stdout}`);
  }
  return `${address}/`;
}

/**
 * What the script prints when the channel is up. The address is the LAST line:
 * `tools/rig/session.sh` shows `tail -1` of the script's log as the channel.
 */
export function channelPublishedText(url) {
  return `\n✓ channel published\n${url}`;
}
